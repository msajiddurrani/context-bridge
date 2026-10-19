import { describe, expect, it, beforeEach } from "vitest"
import { JSDOM } from "jsdom"
import { ChatGPTAdapter } from "../src/adapters/chatgpt"
import { handleAutoSave } from "../src/background"
import { getStoredContexts, clearAllData } from "../src/utils/storage-manager"
import type { MessageTurn } from "../src/types"

describe("PHASE 1 - Reproduce Live Multi-Chat Failure in One Tab", () => {
  beforeEach(async () => {
    await clearAllData()
  })

  it("fails on current code: /new must NOT save temporary session entries, and Chat B must NOT inherit Chat A turns", async () => {
    const adapter = new ChatGPTAdapter()

    // --- STEP 1: User at /new types Chat A ("2+2") ---
    // DOM has message IDs for Chat A
    const domA_at_new = new JSDOM(
      `
      <main>
        <div data-chatgpt-search-unit-key="unit-A-0:user" data-chatgpt-search-message-ids="msg-A-user">
          <div data-user-message-bubble="true"><p>2+2</p></div>
        </div>
        <div data-chatgpt-search-unit-key="unit-A-1:assistant" data-chatgpt-search-message-ids="msg-A-asst">
          <div data-markdown-text-style="assistant-message"><p>2 + 2 = 4</p></div>
        </div>
      </main>
      `,
      { url: "https://chatgpt.com/" } // On /new
    )

    const formatRawTranscript = (turns: MessageTurn[]) =>
      turns.map((t) => `### ${t.role.toUpperCase()}:\n${t.text}`).join("\n\n---\n\n")

    const turnsA_at_new = adapter.getMessages(domA_at_new.window.document)
    const saveA_new = await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: adapter.getChatId("https://chatgpt.com/", domA_at_new.window.document),
      chatTitle: "New chat",
      sourceUrl: "https://chatgpt.com/",
      clientSessionId: "session_1792355098517_99pdgvp",
      rawTranscript: formatRawTranscript(turnsA_at_new),
      rawCodeBlocks: [],
      turns: turnsA_at_new
    })

    // REQUIREMENT 1: On /new, nothing must be saved!
    // On current code, this FAILS because current code saves a temporary entry: chatgpt:session_1792355098517_99pdgvp!
    const storedAfterNewA = await getStoredContexts()
    expect(storedAfterNewA.length).toBe(0) // Will FAIL on current code (stored length is 1)

    // --- STEP 2: URL transitions to permalink /c/6ad52a92-A ---
    const domA_permalink = new JSDOM(
      domA_at_new.serialize(),
      { url: "https://chatgpt.com/c/6ad52a92-chat-A" }
    )
    const turnsA_permalink = adapter.getMessages(domA_permalink.window.document)
    const saveA_permalink = await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: adapter.getChatId("https://chatgpt.com/c/6ad52a92-chat-A", domA_permalink.window.document),
      chatTitle: "Calculate sum",
      sourceUrl: "https://chatgpt.com/c/6ad52a92-chat-A",
      clientSessionId: "session_1792355098517_99pdgvp",
      rawTranscript: formatRawTranscript(turnsA_permalink),
      rawCodeBlocks: [],
      turns: turnsA_permalink
    })
    console.log("saveA_new:", saveA_new, "storedAfterNewA:", storedAfterNewA.map(c => c.id))
    console.log("saveA_permalink:", saveA_permalink)
    expect(saveA_permalink.success).toBe(true)

    // Check storage after Chat A permalink
    const storedAfterA = await getStoredContexts()
    // Must be exactly 1 entry: Chat A's permalink. No leftover session_... entry!
    expect(storedAfterA.length).toBe(1)
    expect(storedAfterA[0].id).toBe("chatgpt:6ad52a92-chat-A")

    // --- STEP 3: User opens New Chat, navigating to /new, but DOM briefly has lingering turns from A ---
    // User types Chat B ("banana ke fayde") and URL gains permalink /c/6ad52b1c-chat-B
    // However, A's turns ("2+2") are still lingering in the DOM or cache alongside B's turns
    const domB_with_lingering_A = new JSDOM(
      `
      <main>
        <!-- Lingering turn from Chat A -->
        <div data-chatgpt-search-unit-key="unit-A-0:user" data-chatgpt-search-message-ids="msg-A-user">
          <div data-user-message-bubble="true"><p>2+2</p></div>
        </div>
        <!-- Fresh turns from Chat B -->
        <div data-chatgpt-search-unit-key="unit-B-0:user" data-chatgpt-search-message-ids="msg-B-user">
          <div data-user-message-bubble="true"><p>banana ke fayde</p></div>
        </div>
        <div data-chatgpt-search-unit-key="unit-B-1:assistant" data-chatgpt-search-message-ids="msg-B-asst">
          <div data-markdown-text-style="assistant-message"><p>Kele ke kai fayde hote hain.</p></div>
        </div>
      </main>
      `,
      { url: "https://chatgpt.com/c/6ad52b1c-chat-B" }
    )

    const turnsB_scraped = adapter.getMessages(domB_with_lingering_A.window.document)
    const saveB = await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: adapter.getChatId("https://chatgpt.com/c/6ad52b1c-chat-B", domB_with_lingering_A.window.document),
      chatTitle: "Banana ke fayde",
      sourceUrl: "https://chatgpt.com/c/6ad52b1c-chat-B",
      rawTranscript: formatRawTranscript(turnsB_scraped),
      rawCodeBlocks: [],
      turns: turnsB_scraped
    })
    expect(saveB.success).toBe(true)

    // --- FINAL ASSERTIONS (Matches live evidence) ---
    const allStored = await getStoredContexts()
    // Must be exactly TWO entries (Chat A and Chat B). NEVER 3 entries with a session_ entry!
    expect(allStored.length).toBe(2)

    const entryB = allStored.find((c) => c.chatId === "6ad52b1c-chat-B")
    expect(entryB).toBeDefined()
    // Chat B's goal MUST be B's own question, NOT "2+2"!
    expect(entryB!.stateMemory.objective).toBe("banana ke fayde")
    // Chat B must NOT contain Chat A's turn ("2+2")
    const entryBTexts = entryB!.turns?.map((t) => t.text) || []
    expect(entryBTexts).not.toContain("2+2")
    expect(entryBTexts).toContain("banana ke fayde")
  })
})
