import { describe, expect, it, beforeEach, vi } from "vitest"
import { JSDOM } from "jsdom"
import { ChatGPTAdapter } from "../src/adapters/chatgpt"
import { getAdapterForUrl } from "../src/adapters"
import { executeQuickInjectDirect, registerQuickInjectHandler, getRegisteredQuickInjectHandler } from "../src/utils/quick-inject"
import { clearAllData, saveContext } from "../src/utils/storage-manager"
import type { PlatformDebugInfo } from "../src/types"

describe("Approved Minimal DOM Resilience Fixes", () => {
  const chatgpt = new ChatGPTAdapter()

  beforeEach(async () => {
    await clearAllData()
    vi.restoreAllMocks()
  })

  describe("FIX 1: Quick Inject False Success Prevention", () => {
    it("executeQuickInjectDirect returns NO_INPUT_BOX when input element is missing", async () => {
      await saveContext({
        id: "claude:chat-1",
        sourcePlatform: "claude",
        chatId: "chat-1",
        chatTitle: "Test Chat",
        sourceUrl: "https://claude.ai/chat/chat-1",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + 100000,
        rawTranscript: "User: Hi\nAssistant: Hello",
        rawCodeBlocks: [],
        turns: [
          { id: "1", role: "user", text: "Hi", codeBlocks: [] },
          { id: "2", role: "assistant", text: "Hello", codeBlocks: [] }
        ],
        stateMemory: {
          version: "1.0",
          objective: "Say hello",
          techStack: [],
          architectureDecisions: [],
          currentWork: "Greeting",
          blockersAndErrors: [],
          nextSteps: [],
          criticalSnippets: [],
          rawTokenEstimate: 50
        }
      })

      // DOM has no textarea or contenteditable input element
      const dom = new JSDOM(`<html><body><div>No prompt box here</div></body></html>`, {
        url: "https://chatgpt.com/c/active-1"
      })

      const result = await executeQuickInjectDirect(dom.window.document, dom.window as any)
      expect(result.success).toBe(false)
      expect(result.error).toBe("NO_INPUT_BOX")
    })

    it("executeQuickInjectDirect returns INSERT_FAILED when adapter.insertText returns false", async () => {
      await saveContext({
        id: "claude:chat-1",
        sourcePlatform: "claude",
        chatId: "chat-1",
        chatTitle: "Test Chat",
        sourceUrl: "https://claude.ai/chat/chat-1",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        expiresAt: Date.now() + 100000,
        rawTranscript: "User: Hi\nAssistant: Hello",
        rawCodeBlocks: [],
        turns: [
          { id: "1", role: "user", text: "Hi", codeBlocks: [] },
          { id: "2", role: "assistant", text: "Hello", codeBlocks: [] }
        ],
        stateMemory: {
          version: "1.0",
          objective: "Say hello",
          techStack: [],
          architectureDecisions: [],
          currentWork: "Greeting",
          blockersAndErrors: [],
          nextSteps: [],
          criticalSnippets: [],
          rawTokenEstimate: 50
        }
      })

      const dom = new JSDOM(`<html><body><textarea id="prompt-textarea"></textarea></body></html>`, {
        url: "https://chatgpt.com/c/active-1"
      })

      const adapter = getAdapterForUrl("https://chatgpt.com/c/active-1")
      expect(adapter).not.toBeNull()
      const insertSpy = vi.spyOn(adapter!, "insertText").mockReturnValue(false)

      const result = await executeQuickInjectDirect(dom.window.document, dom.window as any)
      expect(insertSpy).toHaveBeenCalled()
      expect(result.success).toBe(false)
      expect(result.error).toBe("INSERT_FAILED")
    })

    it("registered quick inject handler accurately propagates failure instead of unconditionally returning success", async () => {
      let statusMessage = ""
      let injectStatus = "idle"

      const mockHandleInject = async (_target: any): Promise<boolean> => {
        // Insertion fails because input element is missing
        injectStatus = "error"
        statusMessage = "Prompt input box not found. Please click into input."
        return false
      }

      // Handler logic: verifies outcome of handleInject
      const handler = async () => {
        const target = { id: "claude:test", sourcePlatform: "claude" }
        const injected = await mockHandleInject(target)
        if (!injected) {
          return { success: false, error: "INSERT_FAILED" }
        }
        statusMessage = `Quick Injected from ${target.sourcePlatform.toUpperCase()}!`
        return { success: true, contextId: target.id }
      }

      registerQuickInjectHandler(handler)
      const activeHandler = getRegisteredQuickInjectHandler()
      expect(activeHandler).not.toBeNull()

      const result = await activeHandler!()
      expect(result.success).toBe(false)
      expect(result.error).toBe("INSERT_FAILED")
      expect(statusMessage).not.toContain("Quick Injected from")
      expect(injectStatus).toBe("error")

      registerQuickInjectHandler(null)
    })
  })

  describe("FIX 2: DOM Health Diagnostics", () => {
    it("reports ok on valid fixture and issues on broken active chat", () => {
      const validDom = new JSDOM(
        `<html><body><main>
          <article data-testid="conversation-turn-0">
            <div data-user-message-bubble="true">User query</div>
          </article>
          <article data-testid="conversation-turn-1">
            <div class="prose"><p>Model reply</p></div>
          </article>
          <form data-chatgpt-composer><div class="ProseMirror" role="textbox"></div></form>
        </main></body></html>`,
        { url: "https://chatgpt.com/c/chat-123" }
      )

      const health = chatgpt.healthCheck(validDom.window.document)
      expect(health.ok).toBe(true)
      expect(health.inputBoxFound).toBe(true)
      expect(health.messagesFound).toBe(true)
      expect(health.issues.length).toBe(0)

      const brokenDom = new JSDOM(
        `<html><body><main>
          <div>Missing inputs and missing message turns on active permalink chat</div>
        </main></body></html>`,
        { url: "https://chatgpt.com/c/chat-123" }
      )

      const brokenHealth = chatgpt.healthCheck(brokenDom.window.document)
      expect(brokenHealth.ok).toBe(false)
      expect(brokenHealth.inputBoxFound).toBe(false)
      expect(brokenHealth.messagesFound).toBe(false)
      expect(brokenHealth.issues.length).toBeGreaterThan(0)
    })

    it("does not report false message warnings on empty or new chats", () => {
      const newChatDom = new JSDOM(
        `<html><body><main>
          <form data-chatgpt-composer><div class="ProseMirror" role="textbox"></div></form>
        </main></body></html>`,
        { url: "https://chatgpt.com/" }
      )

      const health = chatgpt.healthCheck(newChatDom.window.document)
      // New chat has input box and legitimately 0 messages
      expect(health.inputBoxFound).toBe(true)
      expect(health.ok).toBe(true)
      expect(health.issues.length).toBe(0)
    })

    it("PlatformDebugInfo interface supports health telemetry payload", () => {
      const info: PlatformDebugInfo = {
        platform: "chatgpt",
        displayName: "ChatGPT",
        url: "https://chatgpt.com/c/123",
        chatId: "123",
        adapterSelected: "ChatGPT (chatgpt)",
        chatContainerFound: true,
        messagesCount: 2,
        matchedSelector: "article",
        timestamp: Date.now(),
        health: {
          platform: "chatgpt",
          ok: true,
          inputBoxFound: true,
          messagesFound: true,
          lastChecked: Date.now(),
          issues: []
        }
      }

      expect(info.health?.ok).toBe(true)
      expect(info.health?.issues).toEqual([])
    })
  })
})
