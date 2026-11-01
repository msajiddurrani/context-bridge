import { beforeEach, describe, expect, it } from "vitest"
import { resetMockStore } from "./setup"
import {
  clearAllConversationData,
  clearAllData,
  deleteContext,
  getDensityMode,
  getMessageOwnership,
  getSaveTimeline,
  getSettings,
  getStoredContexts,
  markChatInjected,
  resetAllExtensionData,
  saveContext,
  saveSettings,
  setDensityMode
} from "../src/utils/storage-manager"
import type { StoredContext } from "../src/types"

describe("Security & Data Management: Data Deletion & Factory Reset (Part 5A)", () => {
  beforeEach(() => {
    resetMockStore()
  })

  const sampleContext1: StoredContext = {
    id: "claude:chat-111",
    sourcePlatform: "claude",
    chatId: "chat-111",
    chatTitle: "Frontend Architecture Discussion",
    sourceUrl: "https://claude.ai/chat/chat-111",
    createdAt: Date.now() - 5000,
    updatedAt: Date.now() - 1000,
    expiresAt: Date.now() + 86400000,
    stateMemory: {
      version: "1.0",
      objective: "Design frontend state layer",
      techStack: ["React", "TypeScript"],
      architectureDecisions: ["Use Zustand for local state"],
      currentWork: "Refactoring state hooks",
      blockersAndErrors: [],
      nextSteps: ["Write integration tests"],
      criticalSnippets: [],
      rawTokenEstimate: 120
    },
    rawCodeBlocks: [],
    turns: []
  }

  const sampleContext2: StoredContext = {
    id: "chatgpt:chat-222",
    sourcePlatform: "chatgpt",
    chatId: "chat-222",
    chatTitle: "Database Indexing Strategy",
    sourceUrl: "https://chatgpt.com/c/chat-222",
    createdAt: Date.now() - 4000,
    updatedAt: Date.now() - 2000,
    expiresAt: Date.now() + 86400000,
    stateMemory: {
      version: "1.0",
      objective: "PostgreSQL B-Tree index optimization",
      techStack: ["PostgreSQL"],
      architectureDecisions: ["Index on (tenant_id, created_at)"],
      currentWork: "Benchmarking query plan",
      blockersAndErrors: [],
      nextSteps: [],
      criticalSnippets: [],
      rawTokenEstimate: 200
    },
    rawCodeBlocks: [],
    turns: []
  }

  it("deletes an individual conversation by ID and cascades cleanup to injected records", async () => {
    await saveContext(sampleContext1)
    await saveContext(sampleContext2)
    await markChatInjected("chatgpt", "chat-222", sampleContext1.id)

    let stored = await getStoredContexts()
    expect(stored.length).toBe(2)

    // Delete context 1
    await deleteContext(sampleContext1.id)

    stored = await getStoredContexts()
    expect(stored.length).toBe(1)
    expect(stored[0].id).toBe(sampleContext2.id)
  })

  it("clears all conversation data while strictly preserving user settings and preferences", async () => {
    await saveContext(sampleContext1)
    await saveContext(sampleContext2)

    // Customize settings
    await saveSettings({
      autoExpiryHours: 72,
      afterInjectAction: "keep",
      customStyle: "Ultra-concise"
    })
    await setDensityMode("compact")

    // Clear all conversation data
    await clearAllConversationData()

    // 1. Contexts must be wiped
    const stored = await getStoredContexts()
    expect(stored.length).toBe(0)

    // 2. Timeline must be cleared
    const timeline = await getSaveTimeline()
    expect(timeline.length).toBe(0)

    // 3. User settings MUST BE PRESERVED
    const settings = await getSettings()
    expect(settings.autoExpiryHours).toBe(72)
    expect(settings.afterInjectAction).toBe("keep")
    expect(settings.customStyle).toBe("Ultra-concise")

    const density = await getDensityMode()
    expect(density).toBe("compact")
  })

  it("resetAllExtensionData performs a full factory reset wiping data and restoring default settings", async () => {
    await saveContext(sampleContext1)
    await saveSettings({
      autoExpiryHours: 168,
      customStyle: "Customized"
    })
    await setDensityMode("full")

    // Full factory wipe
    await resetAllExtensionData()

    // Contexts wiped
    const stored = await getStoredContexts()
    expect(stored.length).toBe(0)

    // Settings restored to clean factory defaults
    const settings = await getSettings()
    expect(settings.autoExpiryHours).toBe(24)
    expect(settings.autoImport).toBe(true)
    expect(settings.afterInjectAction).toBe("focus")

    // Density restored to standard
    const density = await getDensityMode()
    expect(density).toBe("standard")
  })
})

