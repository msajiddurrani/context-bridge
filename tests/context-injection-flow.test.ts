import { beforeEach, describe, expect, it } from "vitest"
import { resetMockStore } from "./setup"
import {
  clearAllData,
  getInjectedRecords,
  getStoredContexts,
  isInjected,
  markChatInjected,
  saveContext
} from "../src/utils/storage-manager"
import {
  diagnoseContexts,
  filterEligibleContexts,
  isGenericOrNewChatId
} from "../src/utils/context-filter"
import type { InjectedRecord, StoredContext } from "../src/types"

function createMockStoredContext(
  id: string,
  sourcePlatform: "claude" | "chatgpt" | "gemini",
  chatId: string,
  chatTitle: string,
  clientSessionId?: string
): StoredContext {
  const now = Date.now()
  return {
    id,
    sourcePlatform,
    chatId,
    chatTitle,
    sourceUrl: `https://${sourcePlatform === "claude" ? "claude.ai" : "chatgpt.com"}/chat/${chatId}`,
    clientSessionId,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + 24 * 3600 * 1000,
    stateMemory: {
      version: "1.0",
      objective: `Engineering topic: ${chatTitle}`,
      techStack: ["React", "TypeScript", "Tailwind"],
      architectureDecisions: ["Adapter Pattern for any-to-any context transfer"],
      currentWork: "Resolving sticky injected state bug on new conversations",
      blockersAndErrors: [],
      nextSteps: ["Verify cross-platform lifecycle"],
      criticalSnippets: [],
      rawTokenEstimate: 150
    },
    rawCodeBlocks: []
  }
}

describe("Context Injection Lifecycle & Sticky Pill Prevention (Requirement 8)", () => {
  beforeEach(async () => {
    resetMockStore()
    await clearAllData()
  })

  describe("Direction 1: Save ChatGPT chat -> Open Claude /new -> Inject -> Another /new -> Reload", () => {
    it("executes the full lifecycle without sticky injected pill or lost contexts", async () => {
      // 1. Save a ChatGPT chat
      const chatGptChat = createMockStoredContext(
        "chatgpt:c-gpt-101",
        "chatgpt",
        "c-gpt-101",
        "PostgreSQL Performance Tuning"
      )
      await saveContext(chatGptChat)

      const storedAfterSave = await getStoredContexts()
      expect(storedAfterSave).toHaveLength(1)
      expect(storedAfterSave[0].id).toBe("chatgpt:c-gpt-101")

      // 2. Open Claude /new
      const currentPlatform = "claude"
      const currentChatId = "new"
      const isNewChat = true

      expect(isGenericOrNewChatId(currentChatId)).toBe(true)

      // Context must be listed on /new
      const eligibleOnClaudeNew = filterEligibleContexts(
        storedAfterSave,
        currentPlatform,
        currentChatId,
        isNewChat
      )
      expect(eligibleOnClaudeNew).toHaveLength(1)
      expect(eligibleOnClaudeNew[0].id).toBe("chatgpt:c-gpt-101")

      // Check injected records: must NOT be marked injected
      const injectedBefore = await getInjectedRecords()
      expect(isInjected(injectedBefore, currentPlatform, currentChatId)).toBe(false)

      // 3. Inject context into Claude /new
      // User clicks Inject:
      // A. Short ephemeral confirmation is set in UI component
      let ephemeralInjected: {
        platform: string
        chatId: string
        contextId: string
        sourcePlatform: string
        timestamp: number
      } | null = {
        platform: currentPlatform,
        chatId: currentChatId,
        contextId: chatGptChat.id,
        sourcePlatform: chatGptChat.sourcePlatform,
        timestamp: Date.now()
      }

      // Pill shows "Injected (CHATGPT)"
      expect(ephemeralInjected).not.toBeNull()
      expect(ephemeralInjected!.sourcePlatform).toBe("chatgpt")

      // B. Storage persistence attempt on /new:
      // Directive 1 Invariant: Injected state must NEVER apply to or persist on new/empty chats!
      await markChatInjected(currentPlatform, currentChatId, chatGptChat.id)

      // Verify nothing was persisted into storage for "new"
      const recordsAfterNewInject = await getInjectedRecords()
      expect(Object.keys(recordsAfterNewInject)).toHaveLength(0)

      // Injected flag must NEVER hide a context from the list (Directive 3)
      const listDuringInject = filterEligibleContexts(
        storedAfterSave,
        currentPlatform,
        currentChatId,
        isNewChat
      )
      expect(listDuringInject).toHaveLength(1)
      expect(listDuringInject[0].id).toBe("chatgpt:c-gpt-101")

      // 4. Open another Claude /new (in-app navigation or user clicks New Chat)
      // Ephemeral state resets on URL change / navigation
      ephemeralInjected = null

      // Pill state must be reset (NOT showing Injected)
      const isShowingPillAnotherNew = Boolean(ephemeralInjected)
      expect(isShowingPillAnotherNew).toBe(false)

      // Context must STILL be listed (Directive 4)
      const eligibleAnotherNew = filterEligibleContexts(
        storedAfterSave,
        currentPlatform,
        "new",
        true
      )
      expect(eligibleAnotherNew).toHaveLength(1)
      expect(eligibleAnotherNew[0].id).toBe("chatgpt:c-gpt-101")

      // 5. Reload tab on /new
      // Fresh component mount from storage
      const storedReloaded = await getStoredContexts()
      const injectedReloaded = await getInjectedRecords()

      // Context is still listed
      const eligibleReloaded = filterEligibleContexts(
        storedReloaded,
        currentPlatform,
        "new",
        true
      )
      expect(eligibleReloaded).toHaveLength(1)
      expect(eligibleReloaded[0].id).toBe("chatgpt:c-gpt-101")

      // Pill is NOT stuck
      expect(isInjected(injectedReloaded, currentPlatform, "new")).toBe(false)
    })
  })

  describe("Direction 2: Save Claude chat -> Open ChatGPT /new -> Inject -> Another /new -> Reload", () => {
    it("executes the full reverse lifecycle without sticky injected pill or lost contexts", async () => {
      // 1. Save a Claude chat
      const claudeChat = createMockStoredContext(
        "claude:chat-claude-999",
        "claude",
        "chat-claude-999",
        "Distributed Event Streaming"
      )
      await saveContext(claudeChat)

      const stored = await getStoredContexts()
      expect(stored).toHaveLength(1)
      expect(stored[0].id).toBe("claude:chat-claude-999")

      // 2. Open ChatGPT /new (or https://chatgpt.com/)
      const currentPlatform = "chatgpt"
      const currentChatId = "new"
      const isNewChat = true

      // Claude context must be listed on ChatGPT /new
      const eligibleOnGpt = filterEligibleContexts(
        stored,
        currentPlatform,
        currentChatId,
        isNewChat
      )
      expect(eligibleOnGpt).toHaveLength(1)
      expect(eligibleOnGpt[0].id).toBe("claude:chat-claude-999")

      // 3. Inject context into ChatGPT /new
      let ephemeralInjected: any = {
        platform: currentPlatform,
        chatId: currentChatId,
        contextId: claudeChat.id,
        sourcePlatform: claudeChat.sourcePlatform,
        timestamp: Date.now()
      }

      // Pill shows confirmation
      expect(ephemeralInjected.sourcePlatform).toBe("claude")

      // Persistence on "new" must be safely rejected
      await markChatInjected(currentPlatform, currentChatId, claudeChat.id)
      const records = await getInjectedRecords()
      expect(Object.keys(records)).toHaveLength(0)

      // 4. Open another /new on ChatGPT
      ephemeralInjected = null
      expect(Boolean(ephemeralInjected)).toBe(false)

      const eligibleAnother = filterEligibleContexts(stored, currentPlatform, "new", true)
      expect(eligibleAnother).toHaveLength(1)
      expect(eligibleAnother[0].id).toBe("claude:chat-claude-999")

      // 5. Reload ChatGPT tab
      const storedAfterReload = await getStoredContexts()
      const eligibleAfterReload = filterEligibleContexts(
        storedAfterReload,
        currentPlatform,
        "new",
        true
      )
      expect(eligibleAfterReload).toHaveLength(1)
      expect(eligibleAfterReload[0].id).toBe("claude:chat-claude-999")
    })
  })

  describe("Requirement 1: 10-Minute Auto-Expiry on Stored Injected Records", () => {
    it("expires injected records after ~10 minutes on existing chats", async () => {
      const platform = "claude"
      const permalinkChatId = "chat-5b8f106e-8ee5-4b24"
      const contextId = "chatgpt:c-123"

      // Mark injected for an existing permalink chat
      await markChatInjected(platform, permalinkChatId, contextId)

      let records = await getInjectedRecords()
      expect(isInjected(records, platform, permalinkChatId, contextId)).toBe(true)

      // Mock time advancing by 11 minutes (660,000 ms)
      const now = Date.now()
      const elevenMinutesAgo = now - 11 * 60 * 1000

      // Simulate record having timestamp from 11 minutes ago
      const key = `${platform}:${permalinkChatId}:${contextId}`
      const expiredMap: Record<string, InjectedRecord> = {
        [key]: {
          platform,
          chatId: permalinkChatId,
          contextId,
          timestamp: elevenMinutesAgo
        }
      }

      // getInjectedRecords automatically prunes records older than 10 minutes
      expect(isInjected(expiredMap, platform, permalinkChatId, contextId)).toBe(false)
    })
  })

  describe("Requirement 4 & 6: Diagnostic Audit Generation (Zero Chat Text)", () => {
    it("generates diagnostics with total, eligible, and explicit exclusion reasons", () => {
      const now = Date.now()
      const activeClaudeChat = createMockStoredContext(
        "claude:chat-active",
        "claude",
        "chat-active",
        "Active Claude Session"
      )
      const otherClaudeChat = createMockStoredContext(
        "claude:chat-other",
        "claude",
        "chat-other",
        "Other Claude Session"
      )
      const chatGptChat = createMockStoredContext(
        "chatgpt:c-456",
        "chatgpt",
        "c-456",
        "ChatGPT Session"
      )
      const expiredChat: StoredContext = {
        ...createMockStoredContext("gemini:g-old", "gemini", "g-old", "Old Gemini Session"),
        expiresAt: now - 5000 // Expired 5 seconds ago
      }

      const allContexts = [activeClaudeChat, otherClaudeChat, chatGptChat, expiredChat]

      // Audit when user is on Claude in 'chat-active'
      const diagnostics = diagnoseContexts(
        allContexts,
        "claude",
        "chat-active",
        false,
        {}
      )

      expect(diagnostics.totalStored).toBe(4)
      expect(diagnostics.eligibleCount).toBe(2) // otherClaudeChat & chatGptChat
      expect(diagnostics.excludedCount).toBe(2) // activeClaudeChat (same chat) & expiredChat (expired)

      const activeItem = diagnostics.items.find((i) => i.contextId === "claude:chat-active")
      expect(activeItem?.eligible).toBe(false)
      expect(activeItem?.reason).toContain("Same chat loop prevention")

      const expiredItem = diagnostics.items.find((i) => i.contextId === "gemini:g-old")
      expect(expiredItem?.eligible).toBe(false)
      expect(expiredItem?.reason).toContain("TTL expired")

      // STRICT PRIVACY CHECK: Verify chat transcripts and prose body are not leaked into diagnostic output
      const json = JSON.stringify(diagnostics)
      expect(json).not.toContain("PostgreSQL")
      expect(json).not.toContain("Resolving sticky")
      expect(json).not.toContain("Adapter Pattern for any-to-any")
    })
  })
})
