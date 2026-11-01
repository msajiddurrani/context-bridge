import type { PlasmoCSConfig } from "plasmo"
import { extractConversationFromNextJsChunk } from "../utils/network-interceptor"

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

  // --- 0. Shared Interception Dispatcher ---
  const dispatchIntercepted = (
    platform: "chatgpt" | "claude" | "gemini",
    payload: any
  ) => {
    if (!payload || typeof payload !== "object") return
    if (Array.isArray(payload)) return

    const detail = {
      source: "contextbridge-main",
      type: "CONTEXTBRIDGE_CONVERSATION_INTERCEPTED",
      platform,
      url: window.location.href,
      payload,
      timestamp: Date.now()
    }

    ;(window as any).__cb_latest_payload = detail

    // 1. Dispatch custom event for synchronous same-window listeners
    try {
      window.dispatchEvent(
        new CustomEvent("contextbridge:conversation", {
          detail
        })
      )
    } catch {}

    // 2. Post message across world boundary to isolated CSUI
    try {
      window.postMessage(detail, "*")
    } catch {}

    // 3. Store in DOM element to eliminate any startup race conditions
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
      cacheEl.textContent = JSON.stringify(payload)
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
    setTimeout(scanForHydratedConversation, 500)
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

        const isChatGptUrl =
          url.includes("/backend-api/conversation") ||
          url.includes("/backend-anon/conversation") ||
          (url.includes("/backend-api/") && (url.includes("/c/") || url.includes("/conversation")))

        // Claude conversation endpoint: must be a single conversation, not the general list
        const isClaudeUrl =
          url.includes("/chat_conversations/") && !url.endsWith("/chat_conversations")

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
          // B. ChatGPT & Claude JSON interception
          else if (isChatGptUrl || isClaudeUrl) {
            const clone = response.clone()
            clone
              .json()
              .then((payload: any) => {
                if (!payload || typeof payload !== "object" || Array.isArray(payload)) return

                let platform: "chatgpt" | "claude" | null = null
                if (isClaudeUrl || ("chat_messages" in payload && !("mapping" in payload))) {
                  platform = "claude"
                } else if (
                  isChatGptUrl ||
                  "mapping" in payload ||
                  (payload.conversation && "mapping" in payload.conversation)
                ) {
                  platform = "chatgpt"
                }
                if (platform) {
                  dispatchIntercepted(platform, payload)
                }
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
              url.includes("/chat_conversations/") && !url.endsWith("/chat_conversations")

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

  // --- 4. Hydration & In-Page Script State Scanner (ChatGPT Next.js SSR / Gemini WIZ) ---
  function scanForHydratedConversation() {
    try {
      const hostname = window.location.hostname

      // 4A. ChatGPT Next.js SSR / RSC Scan (Active on hard page reload)
      if (hostname === "chatgpt.com" || hostname.endsWith(".chatgpt.com")) {
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
            if (Array.isArray(chunk) && typeof chunk[1] === "string" && chunk[1].includes('"mapping"')) {
              const conv = extractConversationFromNextJsChunk(chunk[1])
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
          if (text.includes('"mapping"') && (text.includes('"current_node"') || text.includes('"conversation_id"'))) {
            const match = text.match(/self\.__next_f\.push\((\[.*?\])\)/s)
            if (match) {
              try {
                const arr = JSON.parse(match[1])
                if (Array.isArray(arr) && typeof arr[1] === "string") {
                  const conv = extractConversationFromNextJsChunk(arr[1])
                  if (conv) {
                    dispatchIntercepted("chatgpt", conv)
                    return
                  }
                }
              } catch {}
            }
            const conv = extractConversationFromNextJsChunk(text)
            if (conv) {
              dispatchIntercepted("chatgpt", conv)
              return
            }
          }
        }
      }

      // 4B. Gemini WIZ Data / AF_initDataCallback Scan
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
  setTimeout(scanForHydratedConversation, 800)
  setTimeout(scanForHydratedConversation, 2000)

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
