import { describe, expect, it } from "vitest"
import { filterEligibleContexts, isGenericOrNewChatId } from "../src/utils/context-filter"
import type { StoredContext } from "../src/types"

function createMockContext(
  id: string,
  sourcePlatform: "claude" | "chatgpt" | "gemini",
  chatId: string,
  updatedAt: number,
  chatTitle = "Mock Title"
): StoredContext {
  return {
    id,
    sourcePlatform,
    chatId,
    chatTitle,
    sourceUrl: `https://${sourcePlatform}.example/chat/${chatId}`,
    createdAt: updatedAt - 1000,
    updatedAt,
    expiresAt: Date.now() + 86400000,
    stateMemory: {
      version: "1.0",
      objective: `Goal for ${chatTitle}`,
      techStack: ["TypeScript", "React"],
      architectureDecisions: [],
      currentWork: "Refactoring filters",
      blockersAndErrors: [],
      nextSteps: ["Ship tests"],
      criticalSnippets: [],
      rawTokenEstimate: 120
    },
    rawCodeBlocks: []
  }
}

describe("Universal Context Filter Logic (Any-to-Any Bidirectional)", () => {
  const chatGptContext = createMockContext(
    "chatgpt:chat-1",
    "chatgpt",
    "chat-1",
    1000,
    "PostgreSQL Indexing"
  )
  const claudeContext1 = createMockContext(
    "claude:chat-2",
    "claude",
    "chat-2",
    2000,
    "Auth Middleware Architecture"
  )
  const claudeContext2 = createMockContext(
    "claude:chat-3",
    "claude",
    "chat-3",
    3000,
    "WebSocket Protocols"
  )

  const allContexts = [chatGptContext, claudeContext1, claudeContext2]

  describe("ChatGPT -> Claude (Direction 1)", () => {
    it("MUST show ChatGPT contexts when viewing Claude", () => {
      // User is on Claude in chat-2
      const result = filterEligibleContexts(allContexts, "claude", "chat-2", false)

      // ChatGPT context must be present
      const hasChatGpt = result.some((c) => c.sourcePlatform === "chatgpt" && c.chatId === "chat-1")
      expect(hasChatGpt).toBe(true)

      // Other Claude context must be present
      const hasOtherClaude = result.some((c) => c.id === "claude:chat-3")
      expect(hasOtherClaude).toBe(true)

      // Current Claude context (chat-2) MUST be excluded to prevent circular self-injection
      const hasCurrentChat = result.some((c) => c.id === "claude:chat-2")
      expect(hasCurrentChat).toBe(false)
    })
  })

  describe("Claude -> ChatGPT (Direction 2)", () => {
    it("MUST show Claude contexts when viewing ChatGPT", () => {
      // User is on ChatGPT in chat-1
      const result = filterEligibleContexts(allContexts, "chatgpt", "chat-1", false)

      // Both Claude contexts must be present
      const claudeCount = result.filter((c) => c.sourcePlatform === "claude").length
      expect(claudeCount).toBe(2)

      // Current ChatGPT context (chat-1) MUST be excluded
      const hasCurrentChat = result.some((c) => c.id === "chatgpt:chat-1")
      expect(hasCurrentChat).toBe(false)
    })
  })

  describe("/new and Empty Chat Handling", () => {
    it("identifies generic and /new identifiers correctly", () => {
      expect(isGenericOrNewChatId("")).toBe(true)
      expect(isGenericOrNewChatId("new")).toBe(true)
      expect(isGenericOrNewChatId("/")).toBe(true)
      expect(isGenericOrNewChatId("default-chatgpt")).toBe(true)
      expect(isGenericOrNewChatId("claude-session")).toBe(true)
      expect(isGenericOrNewChatId("session-my-chat-xyz")).toBe(true)
      expect(isGenericOrNewChatId("c8f42d2a-real-uuid")).toBe(false)
    })

    it("does NOT hide any saved contexts when on a /new or empty chat on Claude", () => {
      // User opens a brand new chat on Claude
      const result = filterEligibleContexts(allContexts, "claude", "new", true)

      // All 3 contexts must be visible
      expect(result.length).toBe(3)
      expect(result.map((c) => c.id)).toContain("chatgpt:chat-1")
      expect(result.map((c) => c.id)).toContain("claude:chat-2")
      expect(result.map((c) => c.id)).toContain("claude:chat-3")
    })

    it("does NOT hide any saved contexts when on a /new or empty chat on ChatGPT", () => {
      // User is on https://chatgpt.com/ (empty chat, chatId = "new" or "/")
      const result = filterEligibleContexts(allContexts, "chatgpt", "/", true)

      // All 3 contexts must be visible
      expect(result.length).toBe(3)
      expect(result.map((c) => c.id)).toContain("chatgpt:chat-1")
      expect(result.map((c) => c.id)).toContain("claude:chat-2")
      expect(result.map((c) => c.id)).toContain("claude:chat-3")
    })
  })

  describe("Sorting by updatedAt", () => {
    it("sorts eligible contexts with the most recently updated first", () => {
      const result = filterEligibleContexts(allContexts, "claude", "new", true)
      expect(result[0].id).toBe("claude:chat-3") // updatedAt = 3000
      expect(result[1].id).toBe("claude:chat-2") // updatedAt = 2000
      expect(result[2].id).toBe("chatgpt:chat-1") // updatedAt = 1000
    })
  })
})
