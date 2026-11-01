/**
 * Context Bridge - Secure Window Message Handler (F2)
 *
 * Hardens window.addEventListener("message") against spoofing by untrusted page scripts:
 * 1. Requires e.source === win.
 * 2. Requires strict message shape: { source: "contextbridge-main", type: ... }.
 * 3. Enforces rate-limiting for navigation events.
 * 4. Dispatches verified navigation and intercepted conversation payloads safely.
 * 5. Idempotent execution.
 */

export interface InterceptedPayloadEvent {
  platform: "chatgpt" | "claude"
  url: string
  payload: any
  timestamp: number
}

export function createSecureWindowMessageHandler(
  win: Window,
  onUrlChange: () => void,
  onConversationIntercepted?: (data: InterceptedPayloadEvent) => void
): (e: MessageEvent) => void {
  let lastNavTriggerTime = 0

  return (e: MessageEvent) => {
    // 1. Source verification: MUST originate from the same window
    if (!e || e.source !== win) {
      return
    }

    // 2. Strict payload structure check
    if (!e.data || typeof e.data !== "object") {
      return
    }

    if (e.data.source !== "contextbridge-main") {
      return
    }

    // 3. Handle Navigation Event
    if (e.data.type === "CONTEXTBRIDGE_NAVIGATION") {
      const now = Date.now()
      if (now - lastNavTriggerTime < 200) {
        return
      }
      lastNavTriggerTime = now
      onUrlChange()
      return
    }

    // 4. Handle Intercepted Conversation Payload
    if (
      e.data.type === "CONTEXTBRIDGE_CONVERSATION_INTERCEPTED" &&
      typeof onConversationIntercepted === "function"
    ) {
      const { platform, url, payload, timestamp } = e.data
      if (
        (platform === "chatgpt" || platform === "claude") &&
        payload &&
        typeof payload === "object"
      ) {
        onConversationIntercepted({
          platform,
          url: typeof url === "string" ? url : win.location.href,
          payload,
          timestamp: typeof timestamp === "number" ? timestamp : Date.now()
        })
      }
    }
  }
}
