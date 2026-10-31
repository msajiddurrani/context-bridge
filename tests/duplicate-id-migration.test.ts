import { describe, expect, it, beforeEach } from "vitest"
import {
  deleteContext,
  getStoredContexts,
  saveContext
} from "../src/utils/storage-manager"
import type { PlatformId, StoredContext } from "../src/types"

function createTestContext(overrides: Partial<StoredContext> & { id: string; chatId: string; sourcePlatform: PlatformId; sourceUrl: string }): StoredContext {
  return {
    chatTitle: "Test Chat",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    expiresAt: Date.now() + 86400000,
    rawCodeBlocks: [],
    turns: [],
    stateMemory: {
      version: "1.0",
      objective: "Test objective",
      techStack: [],
      architectureDecisions: [],
      currentWork: "",
      blockersAndErrors: [],
      nextSteps: [],
      criticalSnippets: [],
      rawTokenEstimate: 10
    },
    ...overrides
  }
}

describe("Duplicate Context ID Migration & Cleanup (F1 Strict Invariants)", () => {
  beforeEach(async () => {
    // Clear storage before each test
    const all = await getStoredContexts()
    for (const ctx of all) {
      await deleteContext(ctx.id)
    }
  })

  it("startup cleanup automatically deletes legacy temporary entries (active-, session_, local-, new, empty)", async () => {
    const legacyContexts: StoredContext[] = [
      createTestContext({
        id: "chatgpt:local-chatgpt:9bf359b9",
        sourcePlatform: "chatgpt",
        chatId: "local-chatgpt:9bf359b9",
        chatTitle: "Temporary Chat 1",
        sourceUrl: "https://chatgpt.com/"
      }),
      createTestContext({
        id: "chatgpt:active-chatgpt-8888",
        sourcePlatform: "chatgpt",
        chatId: "active-chatgpt-8888",
        chatTitle: "Temporary Chat 2",
        sourceUrl: "https://chatgpt.com/"
      }),
      createTestContext({
        id: "claude:session_claude_123",
        sourcePlatform: "claude",
        chatId: "session_claude_123",
        chatTitle: "Temporary Chat 3",
        sourceUrl: "https://claude.ai/new"
      }),
      createTestContext({
        id: "gemini:new",
        sourcePlatform: "gemini",
        chatId: "new",
        chatTitle: "Temporary Chat 4",
        sourceUrl: "https://gemini.google.com/app"
      })
    ]

    for (const ctx of legacyContexts) {
      await saveContext(ctx)
    }

    // Also save a real permalink context
    const realContext = createTestContext({
      id: "chatgpt:68f23abc-4567-8901-cdef",
      sourcePlatform: "chatgpt",
      chatId: "68f23abc-4567-8901-cdef",
      chatTitle: "Python Add Function",
      sourceUrl: "https://chatgpt.com/c/68f23abc-4567-8901-cdef"
    })
    await saveContext(realContext)

    // On fetch / startup cleanup, getStoredContexts() strictly deletes all temporary IDs
    const stored = await getStoredContexts()
    expect(stored.length).toBe(1)
    expect(stored[0].id).toBe("chatgpt:68f23abc-4567-8901-cdef")
    expect(stored[0].chatId).toBe("68f23abc-4567-8901-cdef")
  })

  it("persists real permalink sessions independently for configured 24 hours", async () => {
    const realContextA = createTestContext({
      id: "chatgpt:conv-aaa",
      sourcePlatform: "chatgpt",
      chatId: "conv-aaa",
      chatTitle: "Kubernetes Cluster Configuration",
      sourceUrl: "https://chatgpt.com/c/conv-aaa"
    })

    const realContextB = createTestContext({
      id: "chatgpt:rust-async-777",
      sourcePlatform: "chatgpt",
      chatId: "rust-async-777",
      chatTitle: "Rust Tokio Async Runtime",
      sourceUrl: "https://chatgpt.com/c/rust-async-777"
    })

    await saveContext(realContextA)
    await saveContext(realContextB)

    const stored = await getStoredContexts()
    expect(stored.length).toBe(2)
    expect(stored.some((c) => c.chatId === "conv-aaa")).toBe(true)
    expect(stored.some((c) => c.chatId === "rust-async-777")).toBe(true)
  })
})
