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

// Monkey-patch history & fetch in the MAIN execution world of the web page
if (typeof window !== "undefined" && !(window as any).__cb_main_installed) {
  ;(window as any).__cb_main_installed = true
  ;(window as any).__cb_latest_payload = null

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
    } catch {
      // Ignore
    }
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

        // 1. ChatGPT & Claude JSON interception
        if ((isChatGptUrl || isClaudeUrl) && response && response.ok) {
          const clone = response.clone()
          clone
            .json()
            .then((payload: any) => {
              if (!payload || typeof payload !== "object") return

              // Strictly reject arrays (e.g. Claude sidebar list of all conversations)
              if (Array.isArray(payload)) return

              let platform: "chatgpt" | "claude" | null = null
              if (isClaudeUrl || ("chat_messages" in payload && !("mapping" in payload))) {
                platform = "claude"
              } else if (isChatGptUrl || "mapping" in payload || (payload.conversation && "mapping" in payload.conversation)) {
                platform = "chatgpt"
              }
              if (!platform) return
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
              } catch {
                // Ignore
              }

              // 2. Post message across world boundary
              try {
                window.postMessage(detail, "*")
              } catch {
                // Ignore
              }

              // 3. Store in DOM element to eliminate any race condition
              try {
                let cacheEl = document.getElementById(
                  "__cb_intercepted_cache"
                )
                if (!cacheEl) {
                  cacheEl = document.createElement("div")
                  cacheEl.id = "__cb_intercepted_cache"
                  cacheEl.style.display = "none"
                  ;(document.head || document.documentElement).appendChild(
                    cacheEl
                  )
                }
                cacheEl.setAttribute("data-platform", platform)
                cacheEl.setAttribute("data-url", window.location.href)
                cacheEl.setAttribute("data-timestamp", String(Date.now()))
                cacheEl.textContent = JSON.stringify(payload)
              } catch {
                // Ignore
              }
            })
            .catch(() => {
              // Ignore JSON parse errors from non-JSON responses
            })
        }
      } catch {
        // Never break host fetch
      }
      return response
    }
  }

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
        const latest = (window as any).__cb_latest_payload
        if (latest) {
          window.postMessage(latest, "*")
        }
      }
    } catch {
      // Ignore
    }
  })
}

export default function NavigationMonitor() {
  return null
}
