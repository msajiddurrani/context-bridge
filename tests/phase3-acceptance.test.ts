import { describe, expect, it, beforeEach } from "vitest"
import { JSDOM } from "jsdom"
import { ChatGPTAdapter } from "../src/adapters/chatgpt"
import { ClaudeAdapter } from "../src/adapters/claude"
import { handleAutoSave } from "../src/background"
import {
  getStoredContexts,
  clearAllData,
  cleanupGarbageContexts,
  getSaveTimeline,
  saveContext
} from "../src/utils/storage-manager"
import type { MessageTurn, StoredContext, StateMemory } from "../src/types"

describe("PHASE 3: Comprehensive Acceptance Tests Suite", () => {
  beforeEach(async () => {
    await clearAllData()
  })

  const formatRawTranscript = (turns: MessageTurn[]) =>
    turns.map((t) => `### ${t.role.toUpperCase()}:\n${t.text}`).join("\n\n---\n\n")

  /**
   * Acceptance Test (a):
   * /new, send A, URL /c/A, New chat, send B, URL /c/B:
   * exactly TWO entries; A has user "2+2" and assistant "2 + 2 = 4";
   * B has its own user message and assistant reply; no foreign turns.
   */
  it("a) /new -> send A -> /c/A -> New chat -> send B -> /c/B: exactly TWO entries without foreign turns", async () => {
    const adapter = new ChatGPTAdapter()

    // 1. Chat A starts on /new
    const domA_new = new JSDOM(
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
      { url: "https://chatgpt.com/" }
    )
    const turnsA_new = adapter.getMessages(domA_new.window.document)
    const saveA_new = await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: adapter.getChatId("https://chatgpt.com/", domA_new.window.document), // returns ""
      chatTitle: "New chat",
      sourceUrl: "https://chatgpt.com/",
      rawTranscript: formatRawTranscript(turnsA_new),
      rawCodeBlocks: [],
      turns: turnsA_new
    })
    expect(saveA_new.success).toBe(false)
    expect(saveA_new.error).toBe("NO_REAL_CHAT_ID")
    expect((await getStoredContexts()).length).toBe(0)

    // 2. Chat A URL transitions to /c/6ad52a92-chat-A
    const domA_permalink = new JSDOM(domA_new.serialize(), {
      url: "https://chatgpt.com/c/6ad52a92-chat-A"
    })
    const turnsA_permalink = adapter.getMessages(domA_permalink.window.document)
    const saveA_permalink = await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: adapter.getChatId("https://chatgpt.com/c/6ad52a92-chat-A", domA_permalink.window.document),
      chatTitle: "Calculate sum",
      sourceUrl: "https://chatgpt.com/c/6ad52a92-chat-A",
      rawTranscript: formatRawTranscript(turnsA_permalink),
      rawCodeBlocks: [],
      turns: turnsA_permalink
    })
    expect(saveA_permalink.success).toBe(true)
    const storedAfterA = await getStoredContexts()
    expect(storedAfterA.length).toBe(1)
    expect(storedAfterA[0].id).toBe("chatgpt:6ad52a92-chat-A")

    // 3. User clicks New chat -> navigates to /new, starts Chat B
    const domB_new = new JSDOM(
      `
      <main>
        <div data-chatgpt-search-unit-key="unit-B-0:user" data-chatgpt-search-message-ids="msg-B-user">
          <div data-user-message-bubble="true"><p>banana ke fayde</p></div>
        </div>
        <div data-chatgpt-search-unit-key="unit-B-1:assistant" data-chatgpt-search-message-ids="msg-B-asst">
          <div data-markdown-text-style="assistant-message"><p>Banana khane ke bohot faide hain: energy, potassium aur digestion.</p></div>
        </div>
      </main>
      `,
      { url: "https://chatgpt.com/" }
    )
    const turnsB_new = adapter.getMessages(domB_new.window.document)
    const saveB_new = await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: adapter.getChatId("https://chatgpt.com/", domB_new.window.document),
      chatTitle: "New chat",
      sourceUrl: "https://chatgpt.com/",
      rawTranscript: formatRawTranscript(turnsB_new),
      rawCodeBlocks: [],
      turns: turnsB_new
    })
    expect(saveB_new.success).toBe(false)
    expect(saveB_new.error).toBe("NO_REAL_CHAT_ID")
    // Storage remains exactly 1 entry from Chat A
    expect((await getStoredContexts()).length).toBe(1)

    // 4. Chat B URL transitions to /c/6ad52b1c-chat-B
    const domB_permalink = new JSDOM(domB_new.serialize(), {
      url: "https://chatgpt.com/c/6ad52b1c-chat-B"
    })
    const turnsB_permalink = adapter.getMessages(domB_permalink.window.document)
    const saveB_permalink = await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: adapter.getChatId("https://chatgpt.com/c/6ad52b1c-chat-B", domB_permalink.window.document),
      chatTitle: "Banana ke fayde",
      sourceUrl: "https://chatgpt.com/c/6ad52b1c-chat-B",
      rawTranscript: formatRawTranscript(turnsB_permalink),
      rawCodeBlocks: [],
      turns: turnsB_permalink
    })
    expect(saveB_permalink.success).toBe(true)

    // Final Assertion: Exactly TWO entries
    const allStored = await getStoredContexts()
    expect(allStored.length).toBe(2)

    const entryA = allStored.find((c) => c.chatId === "6ad52a92-chat-A")
    const entryB = allStored.find((c) => c.chatId === "6ad52b1c-chat-B")

    expect(entryA).toBeDefined()
    expect(entryB).toBeDefined()

    // Verify Chat A contents
    expect(entryA!.stateMemory.objective).toBe("2+2")
    expect(entryA!.turns?.length).toBe(2)
    expect(entryA!.turns?.[0].text).toBe("2+2")
    expect(entryA!.turns?.[1].text).toBe("2 + 2 = 4")

    // Verify Chat B contents (isolated, independent, no foreign turns)
    expect(entryB!.stateMemory.objective).toBe("banana ke fayde")
    expect(entryB!.turns?.length).toBe(2)
    expect(entryB!.turns?.[0].text).toBe("banana ke fayde")
    expect(entryB!.turns?.[1].text).toContain("Banana khane ke bohot faide hain")

    // No cross-contamination
    const bTexts = entryB!.turns?.map((t) => t.text) || []
    expect(bTexts).not.toContain("2+2")
    expect(bTexts).not.toContain("2 + 2 = 4")
  })

  /**
   * Acceptance Test (b):
   * /new with a message-less chat: nothing saved.
   */
  it("b) /new with a message-less chat: nothing saved", async () => {
    const adapter = new ChatGPTAdapter()
    const domEmpty = new JSDOM(
      `
      <main>
        <form data-chatgpt-composer>
          <div class="ProseMirror" role="textbox"></div>
        </form>
      </main>
      `,
      { url: "https://chatgpt.com/" }
    )

    const turns = adapter.getMessages(domEmpty.window.document)
    expect(turns.length).toBe(0)

    const result = await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: adapter.getChatId("https://chatgpt.com/", domEmpty.window.document),
      chatTitle: "New chat",
      sourceUrl: "https://chatgpt.com/",
      rawTranscript: "",
      rawCodeBlocks: [],
      turns
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe("NO_REAL_CHAT_ID")
    expect((await getStoredContexts()).length).toBe(0)
  })

  /**
   * Acceptance Test (c):
   * Back to A, add a message, go to B: still two entries; A has 2 exchanges, B has 1.
   */
  it("c) Back to A, add a message, go to B: still two entries; A has 2 exchanges, B has 1", async () => {
    // Seed Chat A and Chat B
    const turnsA1: MessageTurn[] = [
      { id: "msg-A-0", role: "user", text: "2+2", codeBlocks: [] },
      { id: "msg-A-1", role: "assistant", text: "2 + 2 = 4", codeBlocks: [] }
    ]
    await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: "6ad52a92-chat-A",
      chatTitle: "Calculate sum",
      sourceUrl: "https://chatgpt.com/c/6ad52a92-chat-A",
      rawTranscript: formatRawTranscript(turnsA1),
      rawCodeBlocks: [],
      turns: turnsA1
    })

    const turnsB: MessageTurn[] = [
      { id: "msg-B-0", role: "user", text: "banana ke fayde", codeBlocks: [] },
      { id: "msg-B-1", role: "assistant", text: "Kele ke faiday", codeBlocks: [] }
    ]
    await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: "6ad52b1c-chat-B",
      chatTitle: "Banana ke fayde",
      sourceUrl: "https://chatgpt.com/c/6ad52b1c-chat-B",
      rawTranscript: formatRawTranscript(turnsB),
      rawCodeBlocks: [],
      turns: turnsB
    })

    let stored = await getStoredContexts()
    expect(stored.length).toBe(2)

    // User navigates back to Chat A and adds follow-up message: 2 exchanges (4 turns)
    const turnsA2: MessageTurn[] = [
      ...turnsA1,
      { id: "msg-A-2", role: "user", text: "now add 3 to it", codeBlocks: [] },
      { id: "msg-A-3", role: "assistant", text: "4 + 3 = 7", codeBlocks: [] }
    ]
    await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: "6ad52a92-chat-A",
      chatTitle: "Calculate sum",
      sourceUrl: "https://chatgpt.com/c/6ad52a92-chat-A",
      rawTranscript: formatRawTranscript(turnsA2),
      rawCodeBlocks: [],
      turns: turnsA2
    })

    // User navigates back to Chat B
    stored = await getStoredContexts()
    expect(stored.length).toBe(2)

    const entryA = stored.find((c) => c.chatId === "6ad52a92-chat-A")
    const entryB = stored.find((c) => c.chatId === "6ad52b1c-chat-B")

    expect(entryA?.exchangeCount).toBe(2)
    expect(entryA?.turns?.length).toBe(4)
    expect(entryB?.exchangeCount).toBe(1)
    expect(entryB?.turns?.length).toBe(2)
  })

  /**
   * Acceptance Test (d):
   * A's DOM still visible while the URL is already /c/B: A's turns are dropped by message-id ownership.
   */
  it("d) A's DOM still visible while the URL is already /c/B: A's turns are dropped by message-id ownership", async () => {
    const adapter = new ChatGPTAdapter()

    // 1. Chat A is saved first and registers its message IDs
    const turnsA: MessageTurn[] = [
      { id: "msg-A-user", role: "user", text: "2+2", codeBlocks: [] },
      { id: "msg-A-asst", role: "assistant", text: "2 + 2 = 4", codeBlocks: [] }
    ]
    await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: "chat-A-permalink",
      chatTitle: "Calculate sum",
      sourceUrl: "https://chatgpt.com/c/chat-A-permalink",
      rawTranscript: formatRawTranscript(turnsA),
      rawCodeBlocks: [],
      turns: turnsA
    })

    // 2. URL updates to /c/chat-B-permalink, but Chat A's DOM elements linger in the document!
    const domB_with_lingering_A = new JSDOM(
      `
      <main>
        <!-- Lingering Chat A elements owned by chat-A-permalink -->
        <div data-chatgpt-search-unit-key="unit-A-0:user" data-chatgpt-search-message-ids="msg-A-user">
          <div data-user-message-bubble="true"><p>2+2</p></div>
        </div>
        <div data-chatgpt-search-unit-key="unit-A-1:assistant" data-chatgpt-search-message-ids="msg-A-asst">
          <div data-markdown-text-style="assistant-message"><p>2 + 2 = 4</p></div>
        </div>
        <!-- Fresh Chat B elements -->
        <div data-chatgpt-search-unit-key="unit-B-0:user" data-chatgpt-search-message-ids="msg-B-user">
          <div data-user-message-bubble="true"><p>banana ke fayde</p></div>
        </div>
        <div data-chatgpt-search-unit-key="unit-B-1:assistant" data-chatgpt-search-message-ids="msg-B-asst">
          <div data-markdown-text-style="assistant-message"><p>Banana ke faiday...</p></div>
        </div>
      </main>
      `,
      { url: "https://chatgpt.com/c/chat-B-permalink" }
    )

    const scrapedTurns = adapter.getMessages(domB_with_lingering_A.window.document)
    expect(scrapedTurns.length).toBe(4) // Both A and B in raw DOM

    // Save Chat B
    const saveB = await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: "chat-B-permalink",
      chatTitle: "Banana ke fayde",
      sourceUrl: "https://chatgpt.com/c/chat-B-permalink",
      rawTranscript: formatRawTranscript(scrapedTurns),
      rawCodeBlocks: [],
      turns: scrapedTurns
    })
    expect(saveB.success).toBe(true)

    // Chat B entry MUST NOT contain Chat A's lingering turns
    const allStored = await getStoredContexts()
    const entryB = allStored.find((c) => c.chatId === "chat-B-permalink")
    expect(entryB).toBeDefined()
    expect(entryB!.turns?.length).toBe(2)
    expect(entryB!.turns?.[0].id).toBe("msg-B-user")
    expect(entryB!.turns?.[1].id).toBe("msg-B-asst")
    expect(entryB!.turns?.[0].text).toBe("banana ke fayde")
    expect(entryB!.stateMemory.objective).toBe("banana ke fayde")
  })

  /**
   * Acceptance Test (e):
   * Temporary Chat (no id): nothing saved, Diagnostics says why.
   */
  it("e) Temporary Chat (no id): nothing saved, Diagnostics records skipped-no-chat-id", async () => {
    const adapter = new ChatGPTAdapter()
    const domTempChat = new JSDOM(
      `
      <main>
        <div data-chatgpt-search-unit-key="unit-0:user" data-chatgpt-search-message-ids="msg-temp-user">
          <div data-user-message-bubble="true"><p>Secret ephemeral query</p></div>
        </div>
        <div data-chatgpt-search-unit-key="unit-1:assistant" data-chatgpt-search-message-ids="msg-temp-asst">
          <div data-markdown-text-style="assistant-message"><p>Ephemeral reply that will disappear.</p></div>
        </div>
      </main>
      `,
      { url: "https://chatgpt.com/?temporary-chat=true" }
    )

    const chatId = adapter.getChatId("https://chatgpt.com/?temporary-chat=true", domTempChat.window.document)
    expect(chatId).toBe("") // Temporary chat has no permalink id

    const turns = adapter.getMessages(domTempChat.window.document)
    const result = await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId,
      chatTitle: "Temporary Chat",
      sourceUrl: "https://chatgpt.com/?temporary-chat=true",
      rawTranscript: formatRawTranscript(turns),
      rawCodeBlocks: [],
      turns
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe("NO_REAL_CHAT_ID")
    expect((await getStoredContexts()).length).toBe(0)

    // Check Diagnostics / Save Timeline records reason
    const timeline = await getSaveTimeline()
    expect(timeline.length).toBeGreaterThan(0)
    expect(timeline[0].decision).toBe("skipped-no-chat-id")
    expect(timeline[0].reason).toContain("URL has no real chat ID")
  })

  /**
   * Acceptance Test (f):
   * Old stored garbage (session_, local-chatgpt:, "new") is removed on startup.
   */
  it("f) Old stored garbage (session_, local-chatgpt:, 'new') is removed on startup", async () => {
    const now = Date.now()
    const createDummyMemory = (objective: string, currentWork: string): StateMemory => ({
      version: "1.0",
      objective,
      techStack: [],
      architectureDecisions: [],
      currentWork,
      blockersAndErrors: [],
      nextSteps: [],
      criticalSnippets: [],
      rawTokenEstimate: 50
    })

    const rawContexts: Record<string, StoredContext> = {
      "chatgpt:session_1792355098517_99pdgvp": {
        id: "chatgpt:session_1792355098517_99pdgvp",
        sourcePlatform: "chatgpt",
        chatId: "session_1792355098517_99pdgvp",
        chatTitle: "2+2",
        sourceUrl: "https://chatgpt.com/",
        turns: [{ id: "new", role: "user", text: "2+2", codeBlocks: [] }],
        rawTranscript: "2+2",
        stateMemory: createDummyMemory("2+2", "2+2"),
        exchangeCount: 1,
        rawCodeBlocks: [],
        createdAt: now - 3600000,
        updatedAt: now - 3600000,
        expiresAt: now + 86400000
      },
      "chatgpt:local-chatgpt:793b781c-legacy": {
        id: "chatgpt:local-chatgpt:793b781c-legacy",
        sourcePlatform: "chatgpt",
        chatId: "local-chatgpt:793b781c-legacy",
        chatTitle: "Calculate sum",
        sourceUrl: "https://chatgpt.com/",
        turns: [{ id: "t1", role: "user", text: "Calculate sum", codeBlocks: [] }],
        rawTranscript: "Calculate sum",
        stateMemory: createDummyMemory("Calculate sum", "Calculate sum"),
        exchangeCount: 1,
        rawCodeBlocks: [],
        createdAt: now - 3600000,
        updatedAt: now - 3600000,
        expiresAt: now + 86400000
      },
      "chatgpt:new": {
        id: "chatgpt:new",
        sourcePlatform: "chatgpt",
        chatId: "new",
        chatTitle: "New chat",
        sourceUrl: "https://chatgpt.com/",
        turns: [],
        rawTranscript: "New chat",
        stateMemory: createDummyMemory("New chat", ""),
        exchangeCount: 0,
        rawCodeBlocks: [],
        createdAt: now - 3600000,
        updatedAt: now - 3600000,
        expiresAt: now + 86400000
      },
      "chatgpt:6ad52a92-valid-permalink": {
        id: "chatgpt:6ad52a92-valid-permalink",
        sourcePlatform: "chatgpt",
        chatId: "6ad52a92-valid-permalink",
        chatTitle: "Calculate sum",
        sourceUrl: "https://chatgpt.com/c/6ad52a92-valid-permalink",
        turns: [
          { id: "msg-1", role: "user", text: "2+2", codeBlocks: [], chatId: "6ad52a92-valid-permalink" },
          { id: "msg-2", role: "assistant", text: "4", codeBlocks: [], chatId: "6ad52a92-valid-permalink" }
        ],
        rawTranscript: "2+2",
        stateMemory: createDummyMemory("2+2", "4"),
        exchangeCount: 1,
        rawCodeBlocks: [],
        createdAt: now - 1800000,
        updatedAt: now - 1800000,
        expiresAt: now + 86400000
      }
    }

    for (const ctx of Object.values(rawContexts)) {
      await saveContext(ctx)
    }

    // Startup cleanup
    const { removedCount } = await cleanupGarbageContexts()
    expect(removedCount).toBe(3)

    const remaining = await getStoredContexts()
    expect(remaining.length).toBe(1)
    expect(remaining[0].id).toBe("chatgpt:6ad52a92-valid-permalink")
    expect(remaining[0].chatId).toBe("6ad52a92-valid-permalink")
  })

  /**
   * Acceptance Test (g):
   * Same flow on Claude: /new -> A -> /chat/A -> /new -> B -> /chat/B
   */
  it("g) Same flow on Claude: /new -> /chat/A -> /new -> /chat/B gives exactly two separate entries", async () => {
    const adapter = new ClaudeAdapter()

    // 1. Claude at /new
    expect(adapter.getChatId("https://claude.ai/new", {} as any)).toBe("")

    const turnsClaudeA: MessageTurn[] = [
      { id: "claude-msg-1", role: "user", text: "Explain React 19 Actions", codeBlocks: [] },
      { id: "claude-msg-2", role: "assistant", text: "React 19 introduces Actions for async transitions.", codeBlocks: [] }
    ]

    const saveClaudeA_new = await handleAutoSave({
      sourcePlatform: "claude",
      chatId: adapter.getChatId("https://claude.ai/new", {} as any),
      chatTitle: "Claude",
      sourceUrl: "https://claude.ai/new",
      rawTranscript: formatRawTranscript(turnsClaudeA),
      rawCodeBlocks: [],
      turns: turnsClaudeA
    })
    expect(saveClaudeA_new.success).toBe(false)
    expect(saveClaudeA_new.error).toBe("NO_REAL_CHAT_ID")
    expect((await getStoredContexts()).length).toBe(0)

    // 2. Claude permalink /chat/claude-uuid-react19
    const saveClaudeA_permalink = await handleAutoSave({
      sourcePlatform: "claude",
      chatId: "claude-uuid-react19",
      chatTitle: "React 19 Actions",
      sourceUrl: "https://claude.ai/chat/claude-uuid-react19",
      rawTranscript: formatRawTranscript(turnsClaudeA),
      rawCodeBlocks: [],
      turns: turnsClaudeA
    })
    expect(saveClaudeA_permalink.success).toBe(true)
    expect((await getStoredContexts()).length).toBe(1)

    // 3. User navigates to /new for Chat B
    const turnsClaudeB: MessageTurn[] = [
      { id: "claude-msg-3", role: "user", text: "Explain Rust Ownership", codeBlocks: [] },
      { id: "claude-msg-4", role: "assistant", text: "Rust ownership manages memory without garbage collection.", codeBlocks: [] }
    ]
    const saveClaudeB_new = await handleAutoSave({
      sourcePlatform: "claude",
      chatId: "",
      chatTitle: "Claude",
      sourceUrl: "https://claude.ai/new",
      rawTranscript: formatRawTranscript(turnsClaudeB),
      rawCodeBlocks: [],
      turns: turnsClaudeB
    })
    expect(saveClaudeB_new.success).toBe(false)
    expect(saveClaudeB_new.error).toBe("NO_REAL_CHAT_ID")
    expect((await getStoredContexts()).length).toBe(1)

    // 4. Claude permalink /chat/claude-uuid-rust-borrow
    const saveClaudeB_permalink = await handleAutoSave({
      sourcePlatform: "claude",
      chatId: "claude-uuid-rust-borrow",
      chatTitle: "Rust Ownership & Borrowing",
      sourceUrl: "https://claude.ai/chat/claude-uuid-rust-borrow",
      rawTranscript: formatRawTranscript(turnsClaudeB),
      rawCodeBlocks: [],
      turns: turnsClaudeB
    })
    expect(saveClaudeB_permalink.success).toBe(true)

    // Exactly TWO entries
    const allStored = await getStoredContexts()
    expect(allStored.length).toBe(2)

    const entryA = allStored.find((c) => c.chatId === "claude-uuid-react19")
    const entryB = allStored.find((c) => c.chatId === "claude-uuid-rust-borrow")

    expect(entryA?.stateMemory.objective).toBe("Explain React 19 Actions")
    expect(entryB?.stateMemory.objective).toBe("Explain Rust Ownership")
    expect(entryB?.turns?.map((t) => t.text)).not.toContain("Explain React 19 Actions")
  })

  /**
   * Acceptance Test (h):
   * Injected <ctx> text is never saved as a turn.
   */
  it("h) Injected <ctx> text is never saved as a turn", async () => {
    const adapter = new ChatGPTAdapter()

    const escapeHtml = (str: string) =>
      str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

    const injectedBlock =
      '<ctx density="standard">\n<summary>Calculated 2+2=4</summary>\n<goal>2+2</goal>\n<last>\nUser: 2+2\nAssistant: 4\n</last>\n</ctx>\n\nReply "Ready." to confirm receipt.'

    // Scenario 1: A turn is purely the injected context handover block
    const domPureInjected = new JSDOM(
      `
      <main>
        <div data-chatgpt-search-unit-key="unit-0:user" data-chatgpt-search-message-ids="msg-ctx-handshake">
          <div data-user-message-bubble="true"><div class="whitespace-pre-wrap">${escapeHtml(injectedBlock)}</div></div>
        </div>
      </main>
      `,
      { url: "https://chatgpt.com/c/chat-injected-uuid" }
    )
    const pureTurns = adapter.getMessages(domPureInjected.window.document)
    // Pure injected turn MUST be completely dropped by adapter
    expect(pureTurns.length).toBe(0)

    // Scenario 2: User prompt is preceded or followed by injected context
    const mixedText = `${injectedBlock}\n\nNow please calculate 5*5.`
    const domMixed = new JSDOM(
      `
      <main>
        <div data-chatgpt-search-unit-key="unit-0:user" data-chatgpt-search-message-ids="msg-mixed">
          <div data-user-message-bubble="true"><div class="whitespace-pre-wrap">${escapeHtml(mixedText)}</div></div>
        </div>
        <div data-chatgpt-search-unit-key="unit-1:assistant" data-chatgpt-search-message-ids="msg-mixed-reply">
          <div data-markdown-text-style="assistant-message"><p>5 * 5 = 25</p></div>
        </div>
      </main>
      `,
      { url: "https://chatgpt.com/c/chat-injected-uuid" }
    )
    const mixedTurns = adapter.getMessages(domMixed.window.document)
    expect(mixedTurns.length).toBe(2)
    // User turn must have <ctx> completely stripped!
    expect(mixedTurns[0].text).not.toContain("<ctx")
    expect(mixedTurns[0].text).not.toContain("</ctx>")
    expect(mixedTurns[0].text).toBe("Now please calculate 5*5.")

    // Save mixed chat
    const saveMixed = await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: "chat-injected-uuid",
      chatTitle: "Math Calculation",
      sourceUrl: "https://chatgpt.com/c/chat-injected-uuid",
      rawTranscript: formatRawTranscript(mixedTurns),
      rawCodeBlocks: [],
      turns: mixedTurns
    })
    expect(saveMixed.success).toBe(true)

    const stored = await getStoredContexts()
    const entry = stored.find((c) => c.chatId === "chat-injected-uuid")
    expect(entry).toBeDefined()
    expect(entry!.stateMemory.objective).toBe("Now please calculate 5*5")
    expect(entry!.stateMemory.objective).not.toContain("<ctx")
  })
})
