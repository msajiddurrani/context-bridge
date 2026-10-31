import { describe, expect, it, beforeEach } from "vitest"
import { JSDOM } from "jsdom"
import { ChatGPTAdapter } from "../src/adapters/chatgpt"
import { handleAutoSave } from "../src/background"
import { getStoredContexts, getSaveTimeline, clearAllData } from "../src/utils/storage-manager"

function hashStringToBase36(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash).toString(36)
}

/**
 * Requirement:
 * The agreed design forbids any temporary session.
 * Save ONLY when the URL has a real chat ID; otherwise save nothing
 * and show the reason in Diagnostics.
 */
describe("Strict No-Temporary-IDs Specification", () => {
  const adapter = new ChatGPTAdapter()

  beforeEach(async () => {
    await clearAllData()
  })

  it("fails on current code: must save nothing when URL is / or /new, forbidding active-<platform>-<hash> temporary sessions", async () => {
    // -------------------------------------------------------------------------
    // 1. EMPTY /new
    // -------------------------------------------------------------------------
    const emptyDom = new JSDOM(
      `<main><div data-testid="chat-container"></div></main>`,
      { url: "https://chatgpt.com/" }
    )
    const emptyUrlChatId = adapter.getChatId("https://chatgpt.com/", emptyDom.window.document)
    expect(emptyUrlChatId).toBe("") // URL has no real chat ID

    const emptySave = await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: emptyUrlChatId,
      chatTitle: "New chat",
      sourceUrl: "https://chatgpt.com/",
      rawTranscript: "",
      rawCodeBlocks: [],
      turns: []
    })
    expect(emptySave.success).toBe(false)
    expect(emptySave.error).toBe("NO_REAL_CHAT_ID")

    let stored = await getStoredContexts()
    expect(stored).toHaveLength(0)

    let timeline = await getSaveTimeline()
    const emptyDiag = timeline.find((d) => d.decision === "skipped-no-chat-id")
    expect(emptyDiag).toBeDefined()
    expect(emptyDiag?.reason).toContain("no real chat ID")

    // -------------------------------------------------------------------------
    // 2. CHAT A on /new (User sends prompt A before platform mints a permalink)
    // -------------------------------------------------------------------------
    const domChatA = new JSDOM(
      `
      <main>
        <div data-chatgpt-search-message-ids="msg-A-user">
          <div data-user-message-bubble="true"><p>Chat A: What is 2 + 2?</p></div>
        </div>
        <div data-chatgpt-search-message-ids="msg-A-asst">
          <div data-markdown-text-style="assistant-message"><p>2 + 2 is 4.</p></div>
        </div>
      </main>
      `,
      { url: "https://chatgpt.com/" }
    )
    const turnsA = adapter.getMessages(domChatA.window.document)
    expect(turnsA).toHaveLength(2)

    // Current bridge-csui.tsx calculates:
    // const promptHash = hashStringToBase36(firstUserTurn.trim())
    // resolvedChatId = `active-${adapter.id}-${promptHash}`
    const promptHashA = hashStringToBase36(turnsA[0].text)
    const activeChatIdA = `active-${adapter.id}-${promptHashA}`

    // Under current code, bridge-csui passes activeChatIdA to handleAutoSave:
    await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: activeChatIdA,
      chatTitle: "Chat A Calculation",
      sourceUrl: "https://chatgpt.com/",
      rawTranscript: "User: What is 2 + 2?\nAssistant: 2 + 2 is 4.",
      rawCodeBlocks: [],
      turns: turnsA
    })

    // SPEC REQUIREMENT: On / or /new without a real URL chat ID, NOTHING should be saved.
    // Temporary sessions like 'active-chatgpt-...' are forbidden.
    stored = await getStoredContexts()
    // THIS FAILS ON CURRENT CODE because current code saves 'chatgpt:active-chatgpt-...'
    expect(stored).toHaveLength(0)

    // -------------------------------------------------------------------------
    // 3. USER CLICKS NEW CHAT -> CHAT B on /new in same tab
    // -------------------------------------------------------------------------
    const domChatB = new JSDOM(
      `
      <main>
        <div data-chatgpt-search-message-ids="msg-B-user">
          <div data-user-message-bubble="true"><p>Chat B: What is the capital of France?</p></div>
        </div>
        <div data-chatgpt-search-message-ids="msg-B-asst">
          <div data-markdown-text-style="assistant-message"><p>The capital of France is Paris.</p></div>
        </div>
      </main>
      `,
      { url: "https://chatgpt.com/" }
    )
    const turnsB = adapter.getMessages(domChatB.window.document)
    expect(turnsB).toHaveLength(2)

    const promptHashB = hashStringToBase36(turnsB[0].text)
    const activeChatIdB = `active-${adapter.id}-${promptHashB}`

    await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: activeChatIdB,
      chatTitle: "Chat B Geography",
      sourceUrl: "https://chatgpt.com/",
      rawTranscript: "User: What is the capital of France?\nAssistant: Paris.",
      rawCodeBlocks: [],
      turns: turnsB
    })

    // SPEC REQUIREMENT: Still on /new, so neither Chat A nor Chat B should have been saved
    stored = await getStoredContexts()
    // THIS ALSO FAILS ON CURRENT CODE (current code stores 2 temporary active-* sessions)
    expect(stored).toHaveLength(0)
  })
})
