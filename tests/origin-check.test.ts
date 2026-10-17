import { describe, expect, it } from "vitest"
import { validateMessageSender, ALLOWED_ORIGIN_HOSTS } from "../src/background"

describe("Security: Message Origin & Sender Authorization", () => {
  const VALID_RUNTIME_ID = typeof chrome !== "undefined" ? chrome.runtime.id : "mock-context-bridge-id"


  it("authorizes valid messages from chatgpt.com via sender.tab.url", () => {
    const sender = {
      id: VALID_RUNTIME_ID,
      tab: {
        id: 1,
        url: "https://chatgpt.com/c/67890-uuid"
      } as chrome.tabs.Tab
    } as chrome.runtime.MessageSender

    const res = validateMessageSender(sender)
    expect(res.authorized).toBe(true)
    expect(res.origin).toBe("chatgpt.com")
    expect(res.reason).toContain("Authorized host 'chatgpt.com'")
  })

  it("authorizes valid messages from claude.ai via sender.tab.url", () => {
    const sender = {
      id: VALID_RUNTIME_ID,
      tab: {
        id: 2,
        url: "https://claude.ai/chat/abc-123"
      } as chrome.tabs.Tab
    } as chrome.runtime.MessageSender

    const res = validateMessageSender(sender)
    expect(res.authorized).toBe(true)
    expect(res.origin).toBe("claude.ai")
  })

  it("authorizes messages using sender.url fallback when sender.tab is omitted", () => {
    const sender = {
      id: VALID_RUNTIME_ID,
      url: "https://chatgpt.com/"
    } as chrome.runtime.MessageSender

    const res = validateMessageSender(sender)
    expect(res.authorized).toBe(true)
    expect(res.origin).toBe("chatgpt.com")
  })

  it("authorizes internal extension messages without URL (e.g. popup / background)", () => {
    const sender = {
      id: VALID_RUNTIME_ID
    } as chrome.runtime.MessageSender

    const res = validateMessageSender(sender)
    expect(res.authorized).toBe(true)
    expect(res.reason).toContain("Internal extension sender")
  })

  it("rejects messages with an unauthorized sender ID", () => {
    const sender = {
      id: "malicious-foreign-extension-id",
      tab: {
        id: 3,
        url: "https://chatgpt.com/c/123"
      } as chrome.tabs.Tab
    } as chrome.runtime.MessageSender

    const res = validateMessageSender(sender)
    expect(res.authorized).toBe(false)
    expect(res.reason).toContain("Unauthorized sender ID")
  })

  it("rejects messages from untrusted web domains", () => {
    const untrustedOrigins = [
      "https://malicious-site.com/attack",
      "https://evil-chatgpt.com/phish",
      "https://example.org/test",
      "https://google.com/search"
    ]

    for (const url of untrustedOrigins) {
      const sender = {
        id: VALID_RUNTIME_ID,
        tab: {
          id: 4,
          url
        } as chrome.tabs.Tab
      } as chrome.runtime.MessageSender

      const res = validateMessageSender(sender)
      expect(res.authorized).toBe(false)
      expect(res.reason).toContain("not in allowed origin list")
    }
  })

  it("rejects malformed sender URLs that fail parsing", () => {
    const sender = {
      id: VALID_RUNTIME_ID,
      tab: {
        id: 5,
        url: "://invalid-unparseable-url"
      } as chrome.tabs.Tab
    } as chrome.runtime.MessageSender

    const res = validateMessageSender(sender)
    expect(res.authorized).toBe(false)
    expect(res.reason).toContain("Failed to parse sender URL")
  })


  it("contains all 6 required AI platform hostnames in ALLOWED_ORIGIN_HOSTS", () => {
    expect(ALLOWED_ORIGIN_HOSTS).toContain("claude.ai")
    expect(ALLOWED_ORIGIN_HOSTS).toContain("chatgpt.com")
    expect(ALLOWED_ORIGIN_HOSTS).toContain("gemini.google.com")
    expect(ALLOWED_ORIGIN_HOSTS).toContain("perplexity.ai")
    expect(ALLOWED_ORIGIN_HOSTS).toContain("chat.deepseek.com")
    expect(ALLOWED_ORIGIN_HOSTS).toContain("grok.com")
  })
})
