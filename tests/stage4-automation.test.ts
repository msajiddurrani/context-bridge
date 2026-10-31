import { describe, expect, it, vi, beforeEach } from "vitest"
import { JSDOM } from "jsdom"
import { ClaudeAdapter } from "../src/adapters/claude"
import { ChatGPTAdapter } from "../src/adapters/chatgpt"
import { GeminiAdapter } from "../src/adapters/gemini"
import type { StoredContext, ProviderSettings } from "../src/types"
import { findRecentSwitchSuggestion } from "../src/utils/context-filter"
import { handleKeyboardCommand } from "../src/background"
import { executeQuickInjectDirect } from "../src/utils/quick-inject"
import { clearAllData, saveContext } from "../src/utils/storage-manager"

describe("Stage 4: Automation & UX Polish", () => {
  const claude = new ClaudeAdapter()
  const chatgpt = new ChatGPTAdapter()
  const gemini = new GeminiAdapter()

  // --------------------------------------------------------------------------
  // 1. Rate-Limit & Capacity Detection across platforms
  // --------------------------------------------------------------------------
  describe("Rate-Limit & Capacity Detection (checkRateLimitExceeded)", () => {
    it("Claude: detects message limit banner with reset time and avoids false positive on normal chat", () => {
      const normalDom = new JSDOM(
        `<main>
          <div data-testid="chat-message"><p>Here is your code.</p></div>
        </main>`,
        { url: "https://claude.ai/chat/c1" }
      )
      const normalCheck = claude.checkRateLimitExceeded(normalDom.window.document)
      expect(normalCheck.exceeded).toBe(false)

      const limitDom = new JSDOM(
        `<main>
          <div data-testid="chat-message"><p>Here is your code.</p></div>
          <div data-testid="limit-banner" class="banner-limit">
            <p>You've reached your message limit. Your limit will reset at 8:00 PM.</p>
          </div>
        </main>`,
        { url: "https://claude.ai/chat/c1" }
      )
      const limitCheck = claude.checkRateLimitExceeded(limitDom.window.document)
      expect(limitCheck.exceeded).toBe(true)
      expect(limitCheck.reason).toMatch(/message limit/i)
      expect(limitCheck.resetTime).toMatch(/8:00 PM/i)
    })

    it("ChatGPT: detects model cap warnings and avoids false positive on normal chat", () => {
      const normalDom = new JSDOM(
        `<main>
          <div data-message-author-slug="assistant"><p>Sure, let's continue.</p></div>
        </main>`,
        { url: "https://chatgpt.com/c/c2" }
      )
      const normalCheck = chatgpt.checkRateLimitExceeded(normalDom.window.document)
      expect(normalCheck.exceeded).toBe(false)

      const limitDom = new JSDOM(
        `<main>
          <div data-message-author-slug="assistant"><p>Sure, let's continue.</p></div>
          <div class="text-token-text-secondary" data-testid="usage-cap-banner">
            <p>You've hit the Free plan limit for GPT-4o. Try again after 3:30 PM.</p>
          </div>
        </main>`,
        { url: "https://chatgpt.com/c/c2" }
      )
      const limitCheck = chatgpt.checkRateLimitExceeded(limitDom.window.document)
      expect(limitCheck.exceeded).toBe(true)
      expect(limitCheck.reason).toMatch(/limit for GPT-4o/i)
      expect(limitCheck.resetTime).toMatch(/3:30 PM/i)
    })

    it("Gemini: detects quota warning banner and avoids false positive on normal chat", () => {
      const normalDom = new JSDOM(
        `<main>
          <div class="model-response-text"><p>Here is the explanation.</p></div>
        </main>`,
        { url: "https://gemini.google.com/app/c3" }
      )
      const normalCheck = gemini.checkRateLimitExceeded(normalDom.window.document)
      expect(normalCheck.exceeded).toBe(false)

      const limitDom = new JSDOM(
        `<main>
          <div class="model-response-text"><p>Here is the explanation.</p></div>
          <div class="quota-warning-banner">
            <p>You've reached your quota limit for Gemini. Gemini is currently at capacity.</p>
          </div>
        </main>`,
        { url: "https://gemini.google.com/app/c3" }
      )
      const limitCheck = gemini.checkRateLimitExceeded(limitDom.window.document)
      expect(limitCheck.exceeded).toBe(true)
      expect(limitCheck.reason).toMatch(/quota limit|capacity/i)
    })
  })

  // --------------------------------------------------------------------------
  // 2. Smart Context Handoff Suggestions
  // --------------------------------------------------------------------------
  describe("Smart Context Handoff Suggestions (findRecentSwitchSuggestion)", () => {
    const now = 1700000000000

    const recentContext: StoredContext = {
      id: "claude:chat-1",
      sourcePlatform: "claude",
      chatId: "chat-1",
      chatTitle: "React Architecture Plan",
      sourceUrl: "https://claude.ai/chat/chat-1",
      createdAt: now - 5 * 60 * 1000, // 5 minutes ago
      updatedAt: now - 5 * 60 * 1000,
      expiresAt: now + 24 * 60 * 60 * 1000,
      stateMemory: {
        version: "1.0",
        objective: "React Architecture Plan",
        techStack: ["React"],
        architectureDecisions: [],
        currentWork: "Working on state management",
        blockersAndErrors: [],
        nextSteps: [],
        criticalSnippets: [],
        rawTokenEstimate: 100
      },
      rawCodeBlocks: [],
      turns: []
    }

    const oldContext: StoredContext = {
      id: "chatgpt:chat-old",
      sourcePlatform: "chatgpt",
      chatId: "chat-old",
      chatTitle: "Old Python Script",
      sourceUrl: "https://chatgpt.com/c/chat-old",
      createdAt: now - 20 * 60 * 1000, // 20 minutes ago (> 15m)
      updatedAt: now - 20 * 60 * 1000,
      expiresAt: now + 24 * 60 * 60 * 1000,
      stateMemory: {
        version: "1.0",
        objective: "Old Python Script",
        techStack: [],
        architectureDecisions: [],
        currentWork: "Done",
        blockersAndErrors: [],
        nextSteps: [],
        criticalSnippets: [],
        rawTokenEstimate: 50
      },
      rawCodeBlocks: [],
      turns: []
    }

    const defaultSettings: ProviderSettings = {
      provider: "gemini",
      geminiApiKey: "",
      geminiModel: "gemini-2.5-flash",
      openaiApiKey: "",
      openaiModel: "gpt-4o-mini",
      openrouterApiKey: "",
      openrouterModel: "meta-llama/llama-3.3-70b-instruct:free",
      autoExpiryHours: 24,
      maxOutputTokens: 500,
      dailyCapTokens: 50000,
      showSwitchSuggestions: true
    }

    it("suggests the recent context when opening a new chat on ChatGPT within 15 minutes", () => {
      const suggestion = findRecentSwitchSuggestion(
        [recentContext, oldContext],
        "chatgpt",
        "", // fresh or new chat
        defaultSettings,
        now
      )

      expect(suggestion).not.toBeNull()
      expect(suggestion?.id).toBe("claude:chat-1")
      expect(suggestion?.chatTitle).toBe("React Architecture Plan")
    })

    it("does NOT suggest when context is older than 15 minutes", () => {
      const suggestion = findRecentSwitchSuggestion(
        [oldContext],
        "chatgpt",
        "",
        defaultSettings,
        now
      )

      expect(suggestion).toBeNull()
    })

    it("does NOT suggest when user disables showSwitchSuggestions in settings", () => {
      const disabledSettings: ProviderSettings = {
        ...defaultSettings,
        showSwitchSuggestions: false
      }

      const suggestion = findRecentSwitchSuggestion(
        [recentContext],
        "chatgpt",
        "",
        disabledSettings,
        now
      )

      expect(suggestion).toBeNull()
    })

    it("does NOT suggest the exact same chat session (loop prevention)", () => {
      const suggestion = findRecentSwitchSuggestion(
        [recentContext],
        "claude",
        "chat-1", // same chatId
        defaultSettings,
        now
      )

      expect(suggestion).toBeNull()
    })
  })

  // --------------------------------------------------------------------------
  // 3. Global Keyboard Shortcuts Dispatcher
  // --------------------------------------------------------------------------
  describe("Keyboard Shortcuts Dispatcher (handleKeyboardCommand)", () => {
    it("dispatches EXECUTE_QUICK_INJECT to active tab on allowed origin", async () => {
      const sendMessageMock = vi.fn().mockResolvedValue({ success: true })
      const queryTabsMock = vi.fn().mockResolvedValue([
        { id: 101, url: "https://chatgpt.com/c/active-chat", windowId: 1 }
      ])
      const sidePanelMock = { open: vi.fn().mockResolvedValue(undefined) }

      await handleKeyboardCommand("quick_inject", {
        queryTabs: queryTabsMock,
        sendMessage: sendMessageMock,
        sidePanel: sidePanelMock
      })

      expect(sendMessageMock).toHaveBeenCalledWith(101, { type: "EXECUTE_QUICK_INJECT" })
    })

    it("ignores EXECUTE_QUICK_INJECT on unauthorized origin", async () => {
      const sendMessageMock = vi.fn()
      const queryTabsMock = vi.fn().mockResolvedValue([
        { id: 102, url: "https://malicious-site.com/phish", windowId: 1 }
      ])
      const sidePanelMock = { open: vi.fn() }

      await handleKeyboardCommand("quick_inject", {
        queryTabs: queryTabsMock,
        sendMessage: sendMessageMock,
        sidePanel: sidePanelMock
      })

      expect(sendMessageMock).not.toHaveBeenCalled()
    })

    it("triggers sidePanel.open for open_sidepanel command", async () => {
      const sendMessageMock = vi.fn()
      const queryTabsMock = vi.fn().mockResolvedValue([
        { id: 103, url: "https://claude.ai/chat/test", windowId: 42 }
      ])
      const sidePanelMock = { open: vi.fn().mockResolvedValue(undefined) }

      await handleKeyboardCommand("open_sidepanel", {
        queryTabs: queryTabsMock,
        sendMessage: sendMessageMock,
        sidePanel: sidePanelMock
      })

      expect(sidePanelMock.open).toHaveBeenCalledWith({ windowId: 42 })
    })
  })

  // --------------------------------------------------------------------------
  // 4. In-Page Quick Inject Execution (executeQuickInjectDirect)
  // --------------------------------------------------------------------------
  describe("In-Page Quick Inject Execution (executeQuickInjectDirect)", () => {
    beforeEach(async () => {
      await clearAllData()
    })

    it("inserts standard formatted context into active chat input on ChatGPT", async () => {
      // 1. Seed a context from Claude
      await saveContext({
        id: "claude:chat-abc",
        sourcePlatform: "claude",
        chatId: "chat-abc",
        chatTitle: "Payment microservice",
        sourceUrl: "https://claude.ai/chat/chat-abc",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + 100000,
        rawTranscript: "User: let's build payments\nAssistant: Here is code",
        rawCodeBlocks: [],
        turns: [
          { id: "1", role: "user", text: "let's build payments", codeBlocks: [] },
          { id: "2", role: "assistant", text: "Here is code", codeBlocks: [] }
        ],
        stateMemory: {
          version: "1.0",
          objective: "Build payments microservice",
          techStack: ["Node"],
          architectureDecisions: [],
          currentWork: "Design schema",
          blockersAndErrors: [],
          nextSteps: [],
          criticalSnippets: [],
          rawTokenEstimate: 100
        }
      })

      // 2. Mock DOM on ChatGPT with input box
      const dom = new JSDOM(
        `<html><body>
          <textarea id="prompt-textarea"></textarea>
        </body></html>`,
        { url: "https://chatgpt.com/c/active-1" }
      )

      const result = await executeQuickInjectDirect(dom.window.document, dom.window as any)
      expect(result.success).toBe(true)
      expect(result.contextId).toBe("claude:chat-abc")

      const textarea = dom.window.document.getElementById("prompt-textarea") as HTMLTextAreaElement
      expect(textarea.value).toContain("<ctx from=\"claude\"")
      expect(textarea.value).toContain("Build payments microservice")
    })

    it("returns NO_ELIGIBLE_CONTEXT when no stored context from another platform is found", async () => {
      const dom = new JSDOM(
        `<html><body>
          <textarea id="prompt-textarea"></textarea>
        </body></html>`,
        { url: "https://chatgpt.com/c/active-1" }
      )

      const result = await executeQuickInjectDirect(dom.window.document, dom.window as any)
      expect(result.success).toBe(false)
      expect(result.error).toBe("NO_ELIGIBLE_CONTEXT")
    })
  })
})
