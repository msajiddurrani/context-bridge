/**
 * Context Bridge - Secure Window Message Handler (F2)
 *
 * Hardens window.addEventListener("message") against spoofing by untrusted page scripts:
 * 1. Requires e.source === win.
 * 2. Requires strict message shape: { source: "contextbridge-main", type: "CONTEXTBRIDGE_NAVIGATION" }.
 * 3. Enforces rate-limiting: at most one URL update per 200 ms.
 * 4. Takes NO data from the message payload (re-reads window.location.href directly).
 * 5. Idempotent execution.
 */

export function createSecureWindowMessageHandler(
  win: Window,
  onUrlChange: () => void
): (e: MessageEvent) => void {
  let lastTriggerTime = 0

  return (e: MessageEvent) => {
    // 1. Source verification: MUST originate from the same window
    if (!e || e.source !== win) {
      return
    }

    // 2. Strict payload structure check
    if (!e.data || typeof e.data !== "object") {
      return
    }

    if (
      e.data.source !== "contextbridge-main" ||
      e.data.type !== "CONTEXTBRIDGE_NAVIGATION"
    ) {
      return
    }

    // 3. Rate-limiting: at most one trigger every 200ms
    const now = Date.now()
    if (now - lastTriggerTime < 200) {
      return
    }
    lastTriggerTime = now

    // 4. Safe callback: reads no message data; triggers pure location re-read
    onUrlChange()
  }
}
