import { beforeEach, describe, expect, it } from "vitest"
import { resetMockStore } from "./setup"
import {
  clearAllData,
  deleteApiKeys,
  deleteContext,
  getSettings,
  getStoredContexts,
  saveContext,
  saveSettings
} from "../src/utils/storage-manager"
import type { StoredContext } from "../src/types"

describe("Storage Manager & Auto-Expiry", () => {
  beforeEach(() => {
    resetMockStore()
  })

  it("saves and retrieves settings with defaults", async () => {
    const initial = await getSettings()
    expect(initial.provider).toBe("gemini")
    expect(initial.autoExpiryHours).toBe(24)

    await saveSettings({
      provider: "openai",
      openaiApiKey: "sk-mock-key-123456",
      autoExpiryHours: 48
    })

    const updated = await getSettings()
    expect(updated.provider).toBe("openai")
    expect(updated.openaiApiKey).toBe("sk-mock-key-123456")
    expect(updated.autoExpiryHours).toBe(48)
  })

  it("deletes API keys cleanly", async () => {
    await saveSettings({
      geminiApiKey: "AIzaSy-mock",
      openaiApiKey: "sk-mock"
    })

    await deleteApiKeys()
    const settings = await getSettings()
    expect(settings.geminiApiKey).toBe("")
    expect(settings.openaiApiKey).toBe("")
  })

  it("saves and retrieves contexts, automatically pruning expired items", async () => {
    const now = Date.now()
    const validContext: StoredContext = {
      id: "claude:chat-1",
      sourcePlatform: "claude",
      chatId: "chat-1",
      chatTitle: "Valid Active Chat",
      sourceUrl: "https://claude.ai/chat/chat-1",
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 3600 * 1000, // 1 hour in future
      stateMemory: {
        version: "1.0",
        objective: "Active task",
        techStack: [],
        architectureDecisions: [],
        currentWork: "Doing work",
        blockersAndErrors: [],
        nextSteps: [],
        criticalSnippets: [],
        rawTokenEstimate: 100
      },
      rawCodeBlocks: []
    }

    const expiredContext: StoredContext = {
      id: "chatgpt:chat-old",
      sourcePlatform: "chatgpt",
      chatId: "chat-old",
      chatTitle: "Old Expired Chat",
      sourceUrl: "https://chatgpt.com/c/chat-old",
      createdAt: now - 86400 * 1000 * 2,
      updatedAt: now - 86400 * 1000 * 2,
      expiresAt: now - 1000, // Expired 1 second ago
      stateMemory: {
        version: "1.0",
        objective: "Old task",
        techStack: [],
        architectureDecisions: [],
        currentWork: "Old work",
        blockersAndErrors: [],
        nextSteps: [],
        criticalSnippets: [],
        rawTokenEstimate: 100
      },
      rawCodeBlocks: []
    }

    await saveContext(validContext)
    await saveContext(expiredContext)

    const active = await getStoredContexts()
    expect(active.length).toBe(1)
    expect(active[0].id).toBe("claude:chat-1")
  })

  it("deletes an individual context and clears all data", async () => {
    const now = Date.now()
    const ctx: StoredContext = {
      id: "claude:chat-to-delete",
      sourcePlatform: "claude",
      chatId: "chat-to-delete",
      chatTitle: "To Delete",
      sourceUrl: "https://claude.ai/chat/chat-to-delete",
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 3600 * 1000,
      stateMemory: {
        version: "1.0",
        objective: "To Delete",
        techStack: [],
        architectureDecisions: [],
        currentWork: "",
        blockersAndErrors: [],
        nextSteps: [],
        criticalSnippets: [],
        rawTokenEstimate: 50
      },
      rawCodeBlocks: []
    }

    await saveContext(ctx)
    let stored = await getStoredContexts()
    expect(stored.length).toBe(1)

    await deleteContext("claude:chat-to-delete")
    stored = await getStoredContexts()
    expect(stored.length).toBe(0)

    await saveContext(ctx)
    await clearAllData()
    stored = await getStoredContexts()
    expect(stored.length).toBe(0)
  })
})
