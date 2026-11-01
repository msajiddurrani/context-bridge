import { describe, expect, it } from "vitest"
import { createSecureWindowMessageHandler, type InterceptedPayloadEvent } from "../src/utils/security-listener"

describe("F2: Window Message Listener Security & Rate-Limiting", () => {
  it("ignores messages from other window sources or foreign realms", () => {
    let triggered = 0
    const onUrlChange = () => {
      triggered++
    }
    const handler = createSecureWindowMessageHandler(window, onUrlChange)

    // Foreign source event
    const foreignEvent = {
      source: {} as any, // Not window!
      data: { source: "contextbridge-main", type: "CONTEXTBRIDGE_NAVIGATION" }
    } as unknown as MessageEvent

    handler(foreignEvent)
    expect(triggered).toBe(0)
  })

  it("ignores messages with invalid or missing payload signature", () => {
    let triggered = 0
    const onUrlChange = () => {
      triggered++
    }
    const handler = createSecureWindowMessageHandler(window, onUrlChange)

    // Invalid shape
    const invalidShapeEvent = {
      source: window,
      data: { type: "RANDOM_PAGE_EVENT", malicious: true }
    } as unknown as MessageEvent

    handler(invalidShapeEvent)
    expect(triggered).toBe(0)
  })

  it("accepts valid message from window and rate-limits to at most one per 200ms", () => {
    let triggered = 0
    const onUrlChange = () => {
      triggered++
    }
    const handler = createSecureWindowMessageHandler(window, onUrlChange)

    const validEvent = {
      source: window,
      data: { source: "contextbridge-main", type: "CONTEXTBRIDGE_NAVIGATION" }
    } as unknown as MessageEvent

    // 1st call executes
    handler(validEvent)
    expect(triggered).toBe(1)

    // Immediate rapid repeat call is throttled
    handler(validEvent)
    handler(validEvent)
    expect(triggered).toBe(1)
  })

  it("safely routes CONTEXTBRIDGE_CONVERSATION_INTERCEPTED events to handler", () => {
    let interceptedData: InterceptedPayloadEvent | null = null
    const handler = createSecureWindowMessageHandler(
      window,
      () => {},
      (data) => {
        interceptedData = data
      }
    )

    const convEvent = {
      source: window,
      data: {
        source: "contextbridge-main",
        type: "CONTEXTBRIDGE_CONVERSATION_INTERCEPTED",
        platform: "chatgpt",
        url: "https://chatgpt.com/c/chat-123",
        payload: { conversation_id: "chat-123", mapping: {} },
        timestamp: 123456789
      }
    } as unknown as MessageEvent

    handler(convEvent)
    expect(interceptedData).not.toBeNull()
    expect(interceptedData!.platform).toBe("chatgpt")
    expect(interceptedData!.url).toBe("https://chatgpt.com/c/chat-123")
    expect(interceptedData!.payload.conversation_id).toBe("chat-123")
  })
})
