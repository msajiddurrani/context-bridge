import { describe, expect, it, beforeEach, vi } from "vitest"
import { JSDOM } from "jsdom"
import { ChatGPTAdapter } from "../src/adapters/chatgpt"
import { handleAutoSave } from "../src/background"
import {
  clearAllData,
  getStoredContexts,
  saveContext
} from "../src/utils/storage-manager"
import { buildPreviewInjectedText } from "../src/utils/prompt-preview"
import { countExchanges, computeContextMetrics } from "../src/utils/local-mode"
import type { StoredContext } from "../src/types"

describe("Round 1 Failing Tests Suite (F1 - F10)", () => {
  beforeEach(async () => {
    await clearAllData()
    vi.restoreAllMocks()
  })

  // --------------------------------------------------------------------------
  // F1: No temporary IDs on /, /new; startup cleanup of legacy temporary IDs
  // --------------------------------------------------------------------------
  describe("F1: Strict No-Temporary-IDs & Startup Cleanup", () => {
    const adapter = new ChatGPTAdapter()

    it("F1a: empty /new saves nothing, real ID creates ONE entry, Chat A then Chat B gives two entries", async () => {
      // 1. Empty /new -> saves nothing
      const emptySave = await handleAutoSave({
        sourcePlatform: "chatgpt",
        chatId: "",
        chatTitle: "New chat",
        sourceUrl: "https://chatgpt.com/",
        rawTranscript: "",
        rawCodeBlocks: [],
        turns: []
      })
      expect(emptySave.success).toBe(false)
      let stored = await getStoredContexts()
      expect(stored).toHaveLength(0)

      // 2. Chat A with real permalink /c/chat-A -> exactly ONE entry
      const domA = new JSDOM(
        `<main>
          <div data-chatgpt-search-message-ids="msg-A1"><p>Calculate 2+2</p></div>
          <div data-chatgpt-search-message-ids="msg-A2"><p>2+2 is 4</p></div>
        </main>`,
        { url: "https://chatgpt.com/c/chat-A" }
      )
      const turnsA = adapter.getMessages(domA.window.document)
      const saveA = await handleAutoSave({
        sourcePlatform: "chatgpt",
        chatId: "chat-A",
        chatTitle: "Calculate 2+2",
        sourceUrl: "https://chatgpt.com/c/chat-A",
        rawTranscript: "User: Calculate 2+2\nAssistant: 2+2 is 4",
        rawCodeBlocks: [],
        turns: turnsA
      })
      expect(saveA.success).toBe(true)
      stored = await getStoredContexts()
      expect(stored).toHaveLength(1)
      expect(stored[0].id).toBe("chatgpt:chat-A")

      // 3. Chat B with real permalink /c/chat-B in same tab -> two separate entries
      const domB = new JSDOM(
        `<main>
          <div data-chatgpt-search-message-ids="msg-B1"><p>What is Paris?</p></div>
          <div data-chatgpt-search-message-ids="msg-B2"><p>Paris is capital</p></div>
        </main>`,
        { url: "https://chatgpt.com/c/chat-B" }
      )
      const turnsB = adapter.getMessages(domB.window.document)
      const saveB = await handleAutoSave({
        sourcePlatform: "chatgpt",
        chatId: "chat-B",
        chatTitle: "What is Paris?",
        sourceUrl: "https://chatgpt.com/c/chat-B",
        rawTranscript: "User: What is Paris?\nAssistant: Paris is capital",
        rawCodeBlocks: [],
        turns: turnsB
      })
      expect(saveB.success).toBe(true)
      stored = await getStoredContexts()
      expect(stored).toHaveLength(2)
      expect(stored.map((c) => c.id).sort()).toEqual(["chatgpt:chat-A", "chatgpt:chat-B"])
    })

    it("F1b: startup purges any legacy active-, session_, local- or empty chatId entries", async () => {
      // Seed legacy bad entries
      await saveContext({
        id: "chatgpt:active-chatgpt-999",
        chatId: "active-chatgpt-999",
        sourcePlatform: "chatgpt",
        chatTitle: "Bad Temporary Entry",
        sourceUrl: "https://chatgpt.com/",
        rawTranscript: "test",
        turns: [],
        rawCodeBlocks: [],
        updatedAt: Date.now(),
        createdAt: Date.now(),
        expiresAt: Date.now() + 100000,
        stateMemory: {
          version: "1.0",
          objective: "test",
          techStack: [],
          architectureDecisions: [],
          currentWork: "",
          blockersAndErrors: [],
          nextSteps: [],
          criticalSnippets: [],
          rawTokenEstimate: 0
        }
      })
      await saveContext({
        id: "chatgpt:session_123_abc",
        chatId: "session_123_abc",
        sourcePlatform: "chatgpt",
        chatTitle: "Bad Session Entry",
        sourceUrl: "https://chatgpt.com/",
        rawTranscript: "test",
        turns: [],
        rawCodeBlocks: [],
        updatedAt: Date.now(),
        createdAt: Date.now(),
        expiresAt: Date.now() + 100000,
        stateMemory: {
          version: "1.0",
          objective: "test",
          techStack: [],
          architectureDecisions: [],
          currentWork: "",
          blockersAndErrors: [],
          nextSteps: [],
          criticalSnippets: [],
          rawTokenEstimate: 0
        }
      })

      // In current code, cleanupExpiredContexts or getStoredContexts retains active-* entries
      const contexts = await getStoredContexts()
      const hasTemporary = contexts.some(
        (c) => c.chatId.startsWith("active-") || c.chatId.startsWith("session_") || c.chatId.startsWith("local-")
      )
      // SPEC: Must NOT retain temporary entries
      expect(hasTemporary).toBe(false) // FAILS ON CURRENT CODE
    })
  })

  // --------------------------------------------------------------------------
  // F3: Single unified formatter emitting <ctx> and <goal>
  // --------------------------------------------------------------------------
  describe("F3: Unified Formatter emitting <ctx> with <goal>", () => {
    it("formatFor and buildPreviewInjectedText produce the exact same byte-for-byte string with <ctx> and <goal>", () => {
      const adapter = new ChatGPTAdapter()
      const mockContext: StoredContext = {
        id: "chatgpt:chat-test-1",
        chatId: "chat-test-1",
        sourcePlatform: "chatgpt",
        chatTitle: "Add two numbers",
        sourceUrl: "https://chatgpt.com/c/chat-test-1",
        rawTranscript: "User: 2+2\nAssistant: 4",
        turns: [
          { id: "1", role: "user", text: "2+2", codeBlocks: [] },
          { id: "2", role: "assistant", text: "4", codeBlocks: [] }
        ],
        rawCodeBlocks: [],
        stateMemory: {
          version: "1.0",
          objective: "Add two numbers in python",
          techStack: [],
          architectureDecisions: [],
          currentWork: "User: 2+2\n\nAssistant: 4",
          blockersAndErrors: [],
          nextSteps: [],
          criticalSnippets: [],
          rawTokenEstimate: 50,
          isAiSynthesized: false,
          summarizedAt: Date.now() - 60000
        },
        updatedAt: Date.now(),
        createdAt: Date.now(),
        expiresAt: Date.now() + 100000
      }

      const previewText = buildPreviewInjectedText(mockContext, "claude", "standard")
      const adapterText = adapter.formatFor(mockContext.stateMemory!, "chatgpt")

      // SPEC: Must match byte-for-byte and MUST emit <ctx> and <goal>
      expect(previewText).toBe(adapterText) // FAILS on current code because adapter defaults to markdown headers
      expect(adapterText).toContain("<ctx")
      expect(adapterText).toContain("<goal>")
    })
  })

  // --------------------------------------------------------------------------
  // F4: Message IDs fallback includes chatId; data-turn-key never used; repeated search IDs parsed
  // --------------------------------------------------------------------------
  describe("F4: Message IDs Fallback & Search Message IDs Parsing", () => {
    const adapter = new ChatGPTAdapter()

    it("F4a: repeated ID inside data-chatgpt-search-message-ids is parsed (split on whitespace, deduplicate, first ID)", () => {
      const dom = new JSDOM(
        `<main>
          <div data-chatgpt-search-message-ids="msg-uuid-1111 msg-uuid-1111 msg-uuid-1111">
            <div data-user-message-bubble="true"><p>Hello</p></div>
          </div>
        </main>`,
        { url: "https://chatgpt.com/c/chat-1" }
      )
      const turns = adapter.getMessages(dom.window.document)
      expect(turns).toHaveLength(1)
      expect(turns[0].id).toBe("msg-uuid-1111")
    })

    it("F4b: data-turn-key is NEVER used as a message ID; fallback includes chatId", () => {
      const dom = new JSDOM(
        `<main>
          <div data-turn-key="turn-key-sequential-99">
            <div data-user-message-bubble="true"><p>Short prompt</p></div>
          </div>
        </main>`,
        { url: "https://chatgpt.com/c/chat-uuid-abc" }
      )
      const turns = adapter.getMessages(dom.window.document)
      expect(turns).toHaveLength(1)
      // SPEC: turn.id must NOT contain 'data-turn-key' or 'turn-key-sequential'
      expect(turns[0].id).not.toContain("turn-key-sequential") // FAILS on current code: uses data-turn-key!
      expect(turns[0].id).toContain("chat-uuid-abc") // Must be scoped to this chat
    })

    it("F4c: identical text at same index in chat A and chat B do not collide in ownership registry", async () => {
      // Chat A has "hello" at turn 0
      const domA = new JSDOM(
        `<main><div><div data-user-message-bubble="true"><p>hello</p></div></div></main>`,
        { url: "https://chatgpt.com/c/chat-A" }
      )
      // Chat B has "hello" at turn 0
      const domB = new JSDOM(
        `<main><div><div data-user-message-bubble="true"><p>hello</p></div></div></main>`,
        { url: "https://chatgpt.com/c/chat-B" }
      )

      const turnsA = adapter.getMessages(domA.window.document)
      const turnsB = adapter.getMessages(domB.window.document)

      expect(turnsA[0].id).not.toBe(turnsB[0].id) // FAILS on current code if fallback is generic or missing chat scoping
      expect(turnsA[0].id).toContain("chat-A")
      expect(turnsB[0].id).toContain("chat-B")
    })
  })

  // --------------------------------------------------------------------------
  // F5: Title = first real user request of THIS chat, never stale page title
  // --------------------------------------------------------------------------
  describe("F5: Title from validated turns, never stale document.title", () => {
    it("uses first user turn as title when page title is from another chat", () => {
      const adapter = new ChatGPTAdapter()
      const dom = new JSDOM(
        `<html>
          <head><title>Stale Chat: Python WebSocket Server</title></head>
          <body>
            <main>
              <div data-chatgpt-search-message-ids="m1"><p>banana ke fayde</p></div>
              <div data-chatgpt-search-message-ids="m2"><p>Kele ke kai fayde hain...</p></div>
            </main>
          </body>
        </html>`,
        { url: "https://chatgpt.com/c/new-banana-chat" }
      )

      const title = adapter.getChatTitle(dom.window.document)
      // SPEC: Title must NOT be the stale document title "Stale Chat: Python WebSocket Server"
      expect(title).toBe("banana ke fayde") // FAILS on current code: current code returns document.title!
    })
  })

  // --------------------------------------------------------------------------
  // F6: Attachments are metadata, not user message turns, no glued "Document"
  // --------------------------------------------------------------------------
  describe("F6: Attachment chips detection & isolation", () => {
    it("detects attachment chip 'context-bridge-handover (2).mdDocument' as attachment metadata, not turn text", () => {
      const adapter = new ChatGPTAdapter()
      const dom = new JSDOM(
        `<main>
          <div data-chatgpt-search-message-ids="m1">
            <div data-user-message-bubble="true"><p>banana ke fayde</p></div>
          </div>
          <div data-chatgpt-search-message-ids="m2">
            <div data-markdown-text-style="assistant-message"><p>Kele me vitamin hota hai.</p></div>
          </div>
          <div data-chatgpt-search-message-ids="m3">
            <div data-user-message-bubble="true">
              <div class="file-attachment-chip" data-testid="file-attachment">
                <span class="file-name">context-bridge-handover (2).md</span>
                <span class="file-type">Document</span>
              </div>
            </div>
          </div>
        </main>`,
        { url: "https://chatgpt.com/c/banana-chat" }
      )

      const turns = adapter.getMessages(dom.window.document)
      // Turn 3 is an attachment chip only: should be marked with attachments metadata and NOT raw glued text
      const lastTurn = turns[turns.length - 1]
      expect(lastTurn.text).not.toContain("mdDocument") // FAILS on current code: textContent glues name and type
      const exchanges = countExchanges(turns)
      expect(exchanges).toBe(1) // FAILS on current code: counts 2 exchanges!
    })
  })

  // --------------------------------------------------------------------------
  // F8 & F9: Code block counting and exchange calculation
  // --------------------------------------------------------------------------
  describe("F8 & F9: Verbatim Code count & Exchange calculation", () => {
    it("counts only 1 code snippet when wrapper and inner blocks are present", () => {
      const adapter = new ChatGPTAdapter()
      const dom = new JSDOM(
        `<main>
          <div data-chatgpt-search-message-ids="m1"><p>Write python code</p></div>
          <div data-chatgpt-search-message-ids="m2">
            <div data-markdown-text-style="assistant-message">
              <pre><code class="language-python">def add(a, b):\n    return a + b\n</code></pre>
            </div>
          </div>
        </main>`,
        { url: "https://chatgpt.com/c/python-chat" }
      )

      const turns = adapter.getMessages(dom.window.document)
      const allCode = turns.flatMap((t) => t.codeBlocks || [])
      expect(allCode).toHaveLength(1)

      const metrics = computeContextMetrics(turns, allCode, "Write python code")
      expect(metrics.exchangeCount).toBe(1)
    })
  })
})
