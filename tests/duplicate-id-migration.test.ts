import { describe, expect, it, beforeEach } from "vitest"
import {
  deleteContext,
  getStoredContexts,
  migrateTemporarySessions,
  saveContext
} from "../src/utils/storage-manager"
import type { StoredContext } from "../src/types"

describe("Duplicate Context ID Migration & Cleanup", () => {
  beforeEach(async () => {
    // Clear storage before each test
    const all = await getStoredContexts()
    for (const ctx of all) {
      await deleteContext(ctx.id)
    }
  })

  it("migrates fallback local-chatgpt:<hash> to real /c/<id> and deletes the old entry", async () => {
    const fallbackId = "local-chatgpt:9bf359b9-1ab5-4921-a8a5-0a01612736e4"
    const clientSessionId = "session_tab_987654"

    // 1. Initial saved context before permalink is minted
    const fallbackContext: StoredContext = {
      id: `chatgpt:${fallbackId}`,
      sourcePlatform: "chatgpt",
      chatId: fallbackId,
      chatTitle: "ChatGPT Conversation",
      sourceUrl: "https://chatgpt.com/",
      clientSessionId,
      createdAt: Date.now() - 60000,
      updatedAt: Date.now() - 60000,
      expiresAt: Date.now() + 86400000,
      stateMemory: {
        version: "1.0",
        objective: "Write a Python function to add two numbers",
        techStack: [],
        architectureDecisions: [],
        currentWork: "User: Write a function\nAssistant: Here is add_numbers",
        blockersAndErrors: [],
        nextSteps: [],
        criticalSnippets: [],
        rawTokenEstimate: 120
      },
      rawCodeBlocks: [],
      rawTranscript: "Write a Python function to add two numbers",
      exchangeCount: 1,
      summaryMode: "local"
    }

    await saveContext(fallbackContext)

    // Verify storage has initial fallback entry
    let stored = await getStoredContexts()
    expect(stored.length).toBe(1)
    expect(stored[0].id).toBe(`chatgpt:${fallbackId}`)

    // 2. Real permalink minted: URL changes to /c/68f23abc-4567, title updates to "Python Add Function"
    const realChatId = "68f23abc-4567-8901-cdef"
    const realContextId = `chatgpt:${realChatId}`

    const realPayload = {
      sourcePlatform: "chatgpt" as const,
      chatId: realChatId,
      chatTitle: "Python Add Function",
      clientSessionId,
      rawTranscript: "Write a Python function to add two numbers with docstring"
    }

    // Run migration
    const allContexts = await getStoredContexts()
    const migratedIds = await migrateTemporarySessions(realContextId, realPayload, allContexts)

    expect(migratedIds).toContain(`chatgpt:${fallbackId}`)

    // Save real context
    const realContext: StoredContext = {
      ...fallbackContext,
      id: realContextId,
      chatId: realChatId,
      chatTitle: "Python Add Function",
      sourceUrl: `https://chatgpt.com/c/${realChatId}`,
      updatedAt: Date.now()
    }
    await saveContext(realContext)

    // 3. Assert: Old entry deleted, only ONE context exists with real ID
    stored = await getStoredContexts()
    expect(stored.length).toBe(1)
    expect(stored[0].id).toBe(realContextId)
    expect(stored[0].chatId).toBe(realChatId)
    expect(stored[0].chatTitle).toBe("Python Add Function")
    expect(stored.find((c) => c.id === `chatgpt:${fallbackId}`)).toBeUndefined()
  })

  it("migrates fallback session using transcript matching when clientSessionId is absent", async () => {
    const fallbackId = "local-chatgpt:another-hash-555"

    const fallbackContext: StoredContext = {
      id: `chatgpt:${fallbackId}`,
      sourcePlatform: "chatgpt",
      chatId: fallbackId,
      chatTitle: "New chat",
      sourceUrl: "https://chatgpt.com/new",
      createdAt: Date.now() - 30000,
      updatedAt: Date.now() - 30000,
      expiresAt: Date.now() + 86400000,
      stateMemory: {
        version: "1.0",
        objective: "Design a distributed queue in Go",
        techStack: [],
        architectureDecisions: [],
        currentWork: "User: Design a distributed queue in Go",
        blockersAndErrors: [],
        nextSteps: [],
        criticalSnippets: [],
        rawTokenEstimate: 140
      },
      rawCodeBlocks: [],
      rawTranscript: "Design a distributed queue in Go with Raft consensus",
      exchangeCount: 1,
      summaryMode: "local"
    }

    await saveContext(fallbackContext)

    const realChatId = "go-queue-uuid-999"
    const realContextId = `chatgpt:${realChatId}`

    const realPayload = {
      sourcePlatform: "chatgpt" as const,
      chatId: realChatId,
      chatTitle: "Go Distributed Queue",
      rawTranscript: "Design a distributed queue in Go with Raft consensus and WAL storage"
    }

    const allContexts = await getStoredContexts()
    const migratedIds = await migrateTemporarySessions(realContextId, realPayload, allContexts)

    expect(migratedIds).toContain(`chatgpt:${fallbackId}`)

    const stored = await getStoredContexts()
    expect(stored.length).toBe(0) // Deleted old, awaiting real context save
  })

  it("does NOT delete unrelated fallback sessions so contexts persist for configured 24 hours", async () => {
    // A completely separate chat session created earlier on ChatGPT
    const unrelatedLocalId = "local-chatgpt:unrelated-different-chat-111"
    const unrelatedContext: StoredContext = {
      id: `chatgpt:${unrelatedLocalId}`,
      sourcePlatform: "chatgpt",
      chatId: unrelatedLocalId,
      chatTitle: "Kubernetes Cluster Configuration",
      sourceUrl: "https://chatgpt.com/",
      clientSessionId: "session_unrelated_tab_111",
      createdAt: Date.now() - 15 * 60 * 1000,
      updatedAt: Date.now() - 15 * 60 * 1000,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      stateMemory: {
        version: "1.0",
        objective: "Configure a 3-node K8s cluster",
        techStack: [],
        architectureDecisions: [],
        currentWork: "User: How to setup ingress\nAssistant: Here is ingress.yaml",
        blockersAndErrors: [],
        nextSteps: [],
        criticalSnippets: [],
        rawTokenEstimate: 160
      },
      rawCodeBlocks: [],
      rawTranscript: "Configure a 3-node K8s cluster with Calico CNI",
      exchangeCount: 1,
      summaryMode: "local"
    }

    await saveContext(unrelatedContext)

    // Now a new chat on a different tab navigates to permalink /c/rust-async-777
    const newChatId = "rust-async-777"
    const newContextId = `chatgpt:${newChatId}`
    const newPayload = {
      sourcePlatform: "chatgpt" as const,
      chatId: newChatId,
      chatTitle: "Rust Tokio Async Runtime",
      clientSessionId: "session_new_tab_222",
      rawTranscript: "Explain how Tokio cooperative scheduling works in Rust"
    }

    const allContexts = await getStoredContexts()
    const migratedIds = await migrateTemporarySessions(newContextId, newPayload, allContexts)

    // Invariant: Unrelated chat MUST NOT be migrated or deleted!
    expect(migratedIds).not.toContain(`chatgpt:${unrelatedLocalId}`)
    expect(migratedIds.length).toBe(0)

    const stored = await getStoredContexts()
    expect(stored.length).toBe(1)
    expect(stored[0].id).toBe(`chatgpt:${unrelatedLocalId}`)
    expect(stored[0].chatTitle).toBe("Kubernetes Cluster Configuration")
  })
})
