import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: [
    "https://claude.ai/*",
    "https://chatgpt.com/*",
    "https://*.chatgpt.com/*",
    "https://gemini.google.com/*"
  ],
  world: "MAIN",
  run_at: "document_start"
}

// Monkey-patch history, fetch & XHR in the MAIN execution world of the web page
if (typeof window !== "undefined" && !(window as any).__cb_main_installed) {
  ;(window as any).__cb_main_installed = true
  ;(window as any).__cb_latest_payload = null

  function getActiveUrlChatId(): string {
    try {
      const path = window.location.pathname
      const m = path.match(/\/(?:chat|c|app)\/([a-zA-Z0-9_-]+)/)
      return m ? m[1] : ""
    } catch {
      return ""
    }
  }

  // --- 0. Shared Interception Dispatcher ---
  const dispatchIntercepted = (
    platform: "chatgpt" | "claude" | "gemini",
    payload: any
  ) => {
    if (!payload || typeof payload !== "object") return
    if (Array.isArray(payload)) return

    const activeChatId = getActiveUrlChatId()
    // Ghost chat filter: if activeChatId is in the URL, verify payload belongs to it
    if (activeChatId) {
      let payloadChatId = ""
      if (platform === "claude") {
        payloadChatId = String(payload.uuid || payload.id || payload.conversation?.uuid || "")
      } else if (platform === "chatgpt") {
        payloadChatId = String(payload.conversation_id || payload.id || "")
      }
      if (payloadChatId && payloadChatId !== activeChatId) {
        // Discard background prefetch for a different chat!
        return
      }
    }

    const detail = {
      source: "contextbridge-main",
      type: "CONTEXTBRIDGE_CONVERSATION_INTERCEPTED",
      platform,
      url: window.location.href,
      payload,
      timestamp: Date.now()
    }

    ;(window as any).__cb_latest_payload = detail

    // 1. Store in DOM element (100% shared across execution worlds)
    try {
      let cacheEl = document.getElementById("__cb_intercepted_cache")
      if (!cacheEl) {
        cacheEl = document.createElement("div")
        cacheEl.id = "__cb_intercepted_cache"
        cacheEl.style.display = "none"
        ;(document.head || document.documentElement).appendChild(cacheEl)
      }
      cacheEl.setAttribute("data-platform", platform)
      cacheEl.setAttribute("data-url", window.location.href)
      cacheEl.setAttribute("data-timestamp", String(Date.now()))
      cacheEl.textContent = JSON.stringify(detail)
    } catch {}

    // 2. Dispatch standard DOM event on document (crosses world boundaries seamlessly)
    try {
      document.dispatchEvent(new CustomEvent("contextbridge:data_ready"))
    } catch {}

    // 3. Dispatch custom event for synchronous same-window listeners
    try {
      window.dispatchEvent(
        new CustomEvent("contextbridge:conversation", {
          detail
        })
      )
    } catch {}

    // 4. Post message across world boundary to isolated CSUI
    try {
      window.postMessage(detail, "*")
    } catch {}
  }

  // --- 1. SPA Navigation Monitoring ---
  const notifyNav = () => {
    try {
      window.dispatchEvent(
        new CustomEvent("contextbridge:navigation", {
          detail: { url: window.location.href }
        })
      )
      window.postMessage(
        {
          source: "contextbridge-main",
          type: "CONTEXTBRIDGE_NAVIGATION",
          url: window.location.href
        },
        "*"
      )
    } catch {}
    // Check hydration on navigation
    setTimeout(scanForHydratedConversation, 100)
    setTimeout(scanForHydratedConversation, 350)
    setTimeout(scanForHydratedConversation, 800)
  }

  const origPush = window.history.pushState
  window.history.pushState = function (...args) {
    const res = origPush.apply(this, args)
    notifyNav()
    return res
  }

  const origReplace = window.history.replaceState
  window.history.replaceState = function (...args) {
    const res = origReplace.apply(this, args)
    notifyNav()
    return res
  }

  window.addEventListener("popstate", notifyNav)
  window.addEventListener("hashchange", notifyNav)

  // --- 2. Passive Network Interception for 100% Full-Conversation Capture ---
  const origFetch = window.fetch
  if (typeof origFetch === "function") {
    window.fetch = async function (...args: any[]) {
      const response = await (origFetch as any).apply(this, args)
      try {
        const input = args[0]
        const url =
          typeof input === "string"
            ? input
            : input && typeof input === "object" && "url" in input
              ? (input as any).url
              : ""

        const isClaudeUrl =
          url.includes("/chat_conversations") ||
          url.includes("/chat_messages") ||
          (url.includes("/api/organizations/") && url.includes("/chat"))

        const isChatGptUrl =
          url.includes("/backend-api/conversation") ||
          url.includes("/backend-anon/conversation") ||
          (url.includes("/backend-api/") && (url.includes("/c/") || url.includes("/conversation")))

        const isGeminiUrl =
          url.includes("BardChatUi") || url.includes("batchexecute")

        if (response && response.ok) {
          // A. Gemini batchexecute RPC (plain text prefixed with )]}' )
          if (isGeminiUrl) {
            const clone = response.clone()
            clone
              .text()
              .then((text: string) => {
                if (text && (text.includes("wrb.fr") || text.includes("batchexecute") || text.includes(")]}'"))) {
                  dispatchIntercepted("gemini", { rawRpcText: text })
                }
              })
              .catch(() => {})
          }
          // B. Claude JSON interception
          else if (isClaudeUrl) {
            const clone = response.clone()
            clone
              .json()
              .then((payload: any) => {
                if (!payload || typeof payload !== "object" || Array.isArray(payload)) return
                dispatchIntercepted("claude", payload)
              })
              .catch(() => {})
          }
          // C. ChatGPT JSON interception
          else if (isChatGptUrl) {
            const clone = response.clone()
            clone
              .json()
              .then((payload: any) => {
                if (!payload || typeof payload !== "object" || Array.isArray(payload)) return
                dispatchIntercepted("chatgpt", payload)
              })
              .catch(() => {})
          }
        }
      } catch {
        // Never break host fetch
      }
      return response
    }
  }

  // --- 3. Native XMLHttpRequest Interception (Essential for Gemini batchexecute RPCs) ---
  const xhrKey = "XMLHttp" + "Request"
  const nativeXhrCtor = (window as any)[xhrKey]
  if (nativeXhrCtor && nativeXhrCtor.prototype) {
    const origXhrOpen = nativeXhrCtor.prototype.open
    const origXhrSend = nativeXhrCtor.prototype.send

    nativeXhrCtor.prototype.open = function (this: any, method: string, url: any, ...rest: any[]) {
      try {
        this.__cb_req_url = typeof url === "string" ? url : (url && url.toString ? url.toString() : "")
      } catch {}
      return origXhrOpen.apply(this, [method, url, ...rest] as any)
    }

    nativeXhrCtor.prototype.send = function (this: any, ...args: any[]) {
      try {
        this.addEventListener("load", () => {
          try {
            const url = this.__cb_req_url || this.responseURL || ""
            const isGeminiUrl = url.includes("BardChatUi") || url.includes("batchexecute")
            const isChatGptUrl =
              url.includes("/backend-api/conversation") ||
              url.includes("/backend-anon/conversation")
            const isClaudeUrl =
              url.includes("/chat_conversations") ||
              url.includes("/chat_messages") ||
              (url.includes("/api/organizations/") && url.includes("/chat"))

            if (this.status >= 200 && this.status < 300 && this.responseText) {
              if (isGeminiUrl) {
                const text = this.responseText
                if (text.includes("wrb.fr") || text.includes("batchexecute") || text.includes(")]}'")) {
                  dispatchIntercepted("gemini", { rawRpcText: text })
                }
              } else if (isChatGptUrl || isClaudeUrl) {
                try {
                  const payload = JSON.parse(this.responseText)
                  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
                    const plat = isClaudeUrl ? "claude" : "chatgpt"
                    dispatchIntercepted(plat, payload)
                  }
                } catch {}
              }
            }
          } catch {}
        })
      } catch {}
      return origXhrSend.apply(this, args as any)
    }
  }

  // --- 4. Helpers for in-page state detection (100% self-contained, 0 external imports) ---
  function isChatGptMapping(mapping: any): boolean {
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) return false
    const keys = Object.keys(mapping)
    if (keys.length === 0) return false
    for (let i = 0; i < Math.min(keys.length, 15); i++) {
      const node = mapping[keys[i]]
      if (node && typeof node === "object" && (node.message || node.parent !== undefined)) {
        return true
      }
    }
    return false
  }

  function searchConversation(obj: any, visited = new Set<any>(), depth = 0): any | null {
    if (!obj || typeof obj !== "object" || visited.has(obj) || depth > 4) return null
    visited.add(obj)

    if (obj.mapping && isChatGptMapping(obj.mapping)) {
      return obj
    }
    if (obj.conversation && typeof obj.conversation === "object") {
      if (obj.conversation.mapping && isChatGptMapping(obj.conversation.mapping)) {
        return obj.conversation
      }
    }
    if (obj.data && typeof obj.data === "object") {
      if (obj.data.mapping && isChatGptMapping(obj.data.mapping)) {
        return obj.data
      }
      if (obj.data.conversation?.mapping && isChatGptMapping(obj.data.conversation.mapping)) {
        return obj.data.conversation
      }
    }
    if (typeof obj.getQueryCache === "function") {
      try {
        const queries = obj.getQueryCache().getAll()
        for (const q of queries) {
          const d = q?.state?.data
          if (d && typeof d === "object") {
            if (d.mapping && isChatGptMapping(d.mapping)) return d
            if (d.conversation?.mapping && isChatGptMapping(d.conversation.mapping)) return d.conversation
          }
        }
      } catch {}
    }
    if (Array.isArray(obj)) {
      for (const item of obj) {
        if (item && typeof item === "object") {
          const res = searchConversation(item, visited, depth + 1)
          if (res) return res
        }
      }
    }
    return null
  }

  function findConversationFromReactFiber(): any | null {
    try {
      const candidateElements = [
        document.querySelector("main"),
        document.querySelector('[data-testid^="conversation-turn-"]'),
        document.querySelector("article"),
        document.getElementById("__next"),
        document.getElementById("root"),
        document.body?.firstElementChild,
        document.body
      ].filter(Boolean) as HTMLElement[]

      if (candidateElements.length <= 2) {
        const divs = document.querySelectorAll("div")
        for (let i = 0; i < Math.min(divs.length, 10); i++) {
          candidateElements.push(divs[i] as HTMLElement)
        }
      }

      for (const el of candidateElements) {
        const fiberKey = Object.keys(el).find(
          (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")
        )
        if (!fiberKey) continue
        let fiber = (el as any)[fiberKey]
        let depth = 0
        while (fiber && depth < 250) {
          depth++
          const props = fiber.memoizedProps
          if (props && typeof props === "object") {
            const found = searchConversation(props)
            if (found) return found
          }

          let hook = fiber.memoizedState
          let hookDepth = 0
          while (hook && hookDepth < 40) {
            hookDepth++
            if (hook.memoizedState && typeof hook.memoizedState === "object") {
              const found = searchConversation(hook.memoizedState)
              if (found) return found
            }
            hook = hook.next
          }

          fiber = fiber.return
        }
      }
    } catch {}
    return null
  }

  function extractFromChunk(str: string): any | null {
    if (!str || typeof str !== "string") return null
    const mapIdx = str.indexOf('"mapping"')
    if (mapIdx === -1) {
      const escIdx = str.indexOf('\\"mapping\\"')
      if (escIdx === -1) return null
      try {
        const unescaped = str.replace(/\\"/g, '"').replace(/\\\\/g, "\\")
        return extractFromChunk(unescaped)
      } catch {
        return null
      }
    }

    const startSearch = Math.max(0, mapIdx - 5000)
    for (let i = mapIdx; i >= startSearch; i--) {
      if (str[i] === "{") {
        let depth = 0
        let inString = false
        let escape = false
        for (let j = i; j < str.length; j++) {
          const ch = str[j]
          if (escape) {
            escape = false
            continue
          }
          if (ch === "\\") {
            escape = true
            continue
          }
          if (ch === '"') {
            inString = !inString
            continue
          }
          if (!inString) {
            if (ch === "{") depth++
            else if (ch === "}") {
              depth--
              if (depth === 0) {
                const candidate = str.slice(i, j + 1)
                try {
                  const parsed = JSON.parse(candidate)
                  if (parsed && typeof parsed === "object") {
                    if (parsed.mapping && isChatGptMapping(parsed.mapping)) return parsed
                    if (parsed.conversation?.mapping && isChatGptMapping(parsed.conversation.mapping)) return parsed.conversation
                  }
                } catch {}
                break
              }
            }
          }
        }
      }
    }
    return null
  }

  // --- 5. Hydration & In-Page Script State Scanner (ChatGPT Next.js SSR / Gemini WIZ) ---
  function scanForHydratedConversation() {
    try {
      const hostname = window.location.hostname

      // 5A. ChatGPT Next.js SSR / RSC Scan (Active on hard page reload)
      if (hostname === "chatgpt.com" || hostname.endsWith(".chatgpt.com")) {
        // 0. React Fiber & TanStack Query cache traversal (Instant synchronous in-memory read)
        const fiberConv = findConversationFromReactFiber()
        if (fiberConv) {
          dispatchIntercepted("chatgpt", fiberConv)
          return
        }

        // 1. window.__NEXT_DATA__
        const nextData = (window as any).__NEXT_DATA__
        if (nextData?.props?.pageProps?.conversation) {
          dispatchIntercepted("chatgpt", nextData.props.pageProps.conversation)
          return
        }

        // 2. window.__next_f (Next.js App Router streaming chunks)
        const nextF = (window as any).__next_f
        if (Array.isArray(nextF)) {
          for (let i = 0; i < nextF.length; i++) {
            const chunk = nextF[i]
            if (Array.isArray(chunk) && typeof chunk[1] === "string" && (chunk[1].includes('"mapping"') || chunk[1].includes('\\"mapping\\"'))) {
              const conv = extractFromChunk(chunk[1])
              if (conv) {
                dispatchIntercepted("chatgpt", conv)
                return
              }
            }
          }
        }

        // 3. Document script tags
        const scripts = document.querySelectorAll("script")
        for (let s = 0; s < scripts.length; s++) {
          const text = scripts[s].textContent || ""
          if (text.includes('"mapping"') || text.includes('\\"mapping\\"')) {
            const match = text.match(/self\.__next_f\.push\((\[.*?\])\)/s)
            if (match) {
              try {
                const arr = JSON.parse(match[1])
                if (Array.isArray(arr) && typeof arr[1] === "string") {
                  const conv = extractFromChunk(arr[1])
                  if (conv) {
                    dispatchIntercepted("chatgpt", conv)
                    return
                  }
                }
              } catch {}
            }
            const conv = extractFromChunk(text)
            if (conv) {
              dispatchIntercepted("chatgpt", conv)
              return
            }
          }
        }
      }

      // 5B. Gemini WIZ Data / AF_initDataCallback Scan
      if (hostname === "gemini.google.com" || hostname.endsWith(".gemini.google.com")) {
        const scripts = document.querySelectorAll("script")
        for (let s = 0; s < scripts.length; s++) {
          const text = scripts[s].textContent || ""
          if (text.includes("AF_initDataCallback") && (text.includes("wrb.fr") || text.includes("rc_") || text.includes("BardChatUi"))) {
            dispatchIntercepted("gemini", { rawRpcText: text })
            return
          }
        }
      }
    } catch {
      // Ignore scanner errors
    }
  }

  // Run scanner on startup and lifecycle events
  scanForHydratedConversation()
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scanForHydratedConversation)
  }
  window.addEventListener("load", scanForHydratedConversation)
  setTimeout(scanForHydratedConversation, 100)
  setTimeout(scanForHydratedConversation, 300)
  setTimeout(scanForHydratedConversation, 700)
  setTimeout(scanForHydratedConversation, 1500)
  setTimeout(scanForHydratedConversation, 3000)

  // Handle re-request from isolated world in case CSUI mounts after initial fetch
  window.addEventListener("message", (e: MessageEvent) => {
    try {
      if (
        e.source === window &&
        e.data &&
        typeof e.data === "object" &&
        e.data.source === "contextbridge-isolated" &&
        e.data.type === "CONTEXTBRIDGE_REQUEST_LATEST_PAYLOAD"
      ) {
        scanForHydratedConversation()
        const latest = (window as any).__cb_latest_payload
        if (latest) {
          window.postMessage(latest, "*")
        }
      }
    } catch {}
  })
}

export default function NavigationMonitor() {
  return null
}
