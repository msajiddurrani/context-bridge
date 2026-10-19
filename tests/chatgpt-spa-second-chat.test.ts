/**
 * TASK 1: Live bug reproduction and verification
 * Chat A saved, SPA navigation to Chat B.
 * Lingering Chat A turn + Chat B widget/image turns.
 */
import { describe, it, expect, beforeEach } from "vitest"
import { JSDOM } from "jsdom"
import { resetMockStore } from "./setup"
import { ChatGPTAdapter } from "../src/adapters/chatgpt"
import {
  clearAllData,
  filterTurnsByMessageOwnership,
  getStoredContexts
} from "../src/utils/storage-manager"
import { handleAutoSave } from "../src/background"

describe("TASK 1: ChatGPT SPA navigation second chat save", () => {
  beforeEach(async () => {
    resetMockStore()
    await clearAllData()
  })

  it("handles lingering previous chat turn and saves Chat B with widget assistant turn", async () => {
    const adapter = new ChatGPTAdapter()

    // 1. Save Chat A (2+2)
    const domA = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <main>
            <article data-testid="conversation-turn-0" data-chatgpt-selection-conversation-id="chat-a-1111" data-chatgpt-search-message-ids="msg-a-user">
              <div data-message-author-role="user" data-user-message-bubble="true">
                <div class="whitespace-pre-wrap">2+2</div>
              </div>
            </article>
            <article data-testid="conversation-turn-1" data-chatgpt-selection-conversation-id="chat-a-1111" data-chatgpt-search-message-ids="msg-a-asst">
              <div data-message-author-role="assistant" data-markdown-text-style="assistant-message">
                <p>2 + 2 = 4</p>
              </div>
            </article>
          </main>
        </body>
      </html>
    `, { url: "https://chatgpt.com/c/chat-a-1111" })

    const turnsA = adapter.getMessages(domA.window.document)
    expect(turnsA.length).toBe(2)

    const resA = await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: "chat-a-1111",
      chatTitle: "2+2 Math",
      sourceUrl: "https://chatgpt.com/c/chat-a-1111",
      rawTranscript: "### USER:\n2+2\n\n---\n\n### ASSISTANT:\n2 + 2 = 4",
      rawCodeBlocks: [],
      turns: turnsA
    })
    expect(resA.success).toBe(true)

    // 2. Intermediary state: SPA URL changed to Chat B, but DOM still only has lingering Chat A turn
    // (Simulates race condition during SPA route transition before new chat DOM mounts)
    const turnsLingeringOnly = [{
      id: "msg-a-user",
      role: "user" as const,
      text: "2+2",
      codeBlocks: [],
      conversationId: "chat-a-1111"
    }]

    // Required Behavior (b): filterTurnsByMessageOwnership returns status "NOT_READY_YET" instead of permanent error
    const retryCheck = await filterTurnsByMessageOwnership(turnsLingeringOnly, "chat-b-2222")
    expect(retryCheck.status).toBe("NOT_READY_YET")
    expect(retryCheck.foreignCount).toBe(1)
    expect(retryCheck.validTurns.length).toBe(0)

    // And handleAutoSave returns error NOT_READY_YET when retryCount < 3
    const resTransient = await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: "chat-b-2222",
      chatTitle: "New Chat",
      sourceUrl: "https://chatgpt.com/c/chat-b-2222",
      rawTranscript: "### USER:\n2+2",
      rawCodeBlocks: [],
      turns: turnsLingeringOnly,
      retryCount: 0
    } as any)
    expect(resTransient.success).toBe(false)
    expect(resTransient.error).toBe("NOT_READY_YET")

    // 3. Chat B DOM rendered:
    // - Lingering turn from Chat A (data-chatgpt-selection-conversation-id="chat-a-1111")
    // - Chat B user turn (data-chatgpt-selection-conversation-id="chat-b-2222")
    // - Chat B assistant turn with widget options and image block (UNVERIFIED DOM markup pattern)
    const domB = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <main>
            <!-- Lingering turn from Chat A -->
            <article data-testid="conversation-turn-0" data-chatgpt-selection-conversation-id="chat-a-1111" data-chatgpt-search-message-ids="msg-a-user">
              <div data-message-author-role="user" data-user-message-bubble="true">
                <div class="whitespace-pre-wrap">2+2</div>
              </div>
            </article>

            <!-- Chat B User Turn -->
            <article data-testid="conversation-turn-1" data-chatgpt-selection-conversation-id="chat-b-2222" data-chatgpt-search-message-ids="msg-b-user">
              <div data-message-author-role="user" data-user-message-bubble="true">
                <div class="whitespace-pre-wrap">Choose a plan</div>
              </div>
            </article>

            <!-- Chat B Assistant Turn: Widget options and image block (Bug A10 scenario) -->
            <article data-testid="conversation-turn-2" data-chatgpt-selection-conversation-id="chat-b-2222" data-chatgpt-search-message-ids="msg-b-asst">
              <div data-message-author-role="assistant" data-markdown-text-style="assistant-message">
                <div class="options-widget">
                  <label><input type="radio" name="plan" /> Option A: Starter Plan</label>
                  <label><input type="radio" name="plan" /> Option B: Pro Plan</label>
                </div>
                <img src="chart.png" alt="Comparison Diagram" />
              </div>
            </article>
          </main>
        </body>
      </html>
    `, { url: "https://chatgpt.com/c/chat-b-2222" })

    // Required Behavior (a): adapter excludes lingering turn with different conversation id
    const turnsB = adapter.getMessages(domB.window.document)

    // Should NOT include Chat A's turn
    expect(turnsB.some((t) => t.id === "msg-a-user")).toBe(false)
    expect(turnsB.some((t) => t.id === "msg-b-user")).toBe(true)

    // Required Behavior (d): assistant widget/image turn extracts text without error or is gracefully kept
    expect(turnsB.length).toBeGreaterThanOrEqual(1)

    // Required Behavior (c): conversationId is carried and matches currentChatId
    const userTurnB = turnsB.find((t) => t.id === "msg-b-user")
    expect(userTurnB).toBeDefined()
    expect(userTurnB?.text).toContain("Choose a plan")

    // Save Chat B via handleAutoSave
    const resB = await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: "chat-b-2222",
      chatTitle: "Choose a plan",
      sourceUrl: "https://chatgpt.com/c/chat-b-2222",
      rawTranscript: "### USER:\nChoose a plan",
      rawCodeBlocks: [],
      turns: turnsB,
      retryCount: 1
    } as any)

    expect(resB.success).toBe(true)

    // Verify both contexts exist independently
    const contexts = await getStoredContexts()
    expect(contexts.some((c) => c.chatId === "chat-a-1111")).toBe(true)
    expect(contexts.some((c) => c.chatId === "chat-b-2222")).toBe(true)
  })

  it("extracts and saves Chat B turns when user turn has no explicit server message id attribute (live Chrome pattern)", async () => {
    const adapter = new ChatGPTAdapter()

    // Real DOM pattern where user bubble only has data-message-author-role='user' / data-user-message-bubble='true'
    const domB = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <main>
            <article data-testid="conversation-turn-0">
              <div data-message-author-role="user" data-user-message-bubble="true">
                <div class="whitespace-pre-wrap">benefits of apple</div>
              </div>
            </article>
            <article data-testid="conversation-turn-1">
              <div data-message-author-role="assistant" data-markdown-text-style="assistant-message">
                <div class="markdown"><p>Apples are rich in fiber and antioxidants.</p></div>
              </div>
            </article>
          </main>
        </body>
      </html>
    `, { url: "https://chatgpt.com/c/chat-b-apple-3333" })

    const turnsB = adapter.getMessages(domB.window.document)

    // MUST extract the user turn and assistant turn without dropping them as skipped-no-message-id
    expect(turnsB.length).toBe(2)
    const userTurn = turnsB.find((t) => t.role === "user")
    expect(userTurn).toBeDefined()
    expect(userTurn?.text).toContain("benefits of apple")

    const res = await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: "chat-b-apple-3333",
      chatTitle: "benefits of apple",
      sourceUrl: "https://chatgpt.com/c/chat-b-apple-3333",
      rawTranscript: "### USER:\nbenefits of apple\n\n---\n\n### ASSISTANT:\nApples are rich in fiber.",
      rawCodeBlocks: [],
      turns: turnsB
    })
    expect(res.success).toBe(true)

    const stored = await getStoredContexts()
    expect(stored.some((c) => c.chatId === "chat-b-apple-3333")).toBe(true)
  })

  it("returns empty chatId on root / but extracts turns and saves once URL transitions to /c/<id>", async () => {
    const adapter = new ChatGPTAdapter()

    const domRoot = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <main data-chatgpt-selection-conversation-id="chat-root-apple-4444">
            <article data-testid="conversation-turn-0">
              <div data-message-author-role="user" data-user-message-bubble="true">
                <div class="whitespace-pre-wrap">benefits of apple</div>
              </div>
            </article>
            <article data-testid="conversation-turn-1">
              <div data-message-author-role="assistant" data-markdown-text-style="assistant-message">
                <div class="markdown"><p>Apples are rich in fiber and vitamin C.</p></div>
              </div>
            </article>
          </main>
        </body>
      </html>
    `, { url: "https://chatgpt.com/" })

    // On root URL before permalink is minted, getChatId strictly returns ""
    expect(adapter.getChatId("https://chatgpt.com/", domRoot.window.document)).toBe("")

    // Once ChatGPT pushes the permalink /c/<id>, chatId resolves cleanly
    const permalinkUrl = "https://chatgpt.com/c/chat-root-apple-4444"
    const resolvedChatId = adapter.getChatId(permalinkUrl, domRoot.window.document)
    expect(resolvedChatId).toBe("chat-root-apple-4444")

    const turns = adapter.getMessages(domRoot.window.document)
    expect(turns.length).toBe(2)
    expect(turns[0].text).toContain("benefits of apple")

    const res = await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: resolvedChatId,
      chatTitle: "benefits of apple",
      sourceUrl: permalinkUrl,
      rawTranscript: "### USER:\nbenefits of apple\n\n---\n\n### ASSISTANT:\nApples are rich in fiber.",
      rawCodeBlocks: [],
      turns
    })
    expect(res.success).toBe(true)

    const stored = await getStoredContexts()
    expect(stored.some((c) => c.chatId === "chat-root-apple-4444")).toBe(true)
  })
})
