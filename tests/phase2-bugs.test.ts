/**
 * PHASE 1 - Failing tests for A1, A2, A3, A5, A9, A10.
 * 7 tests FAIL on current code; 16 pass (pure logic tests).
 * After Phase 2 fixes all 23 must pass.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { JSDOM } from "jsdom"
import { resetMockStore } from "./setup"
import {
  clearAllData,
  filterTurnsByMessageOwnership,
  getStoredContexts
} from "../src/utils/storage-manager"
import { handleAutoSave } from "../src/background"
import { ChatGPTAdapter } from "../src/adapters/chatgpt"
import { ClaudeAdapter } from "../src/adapters/claude"
import { buildLocalStateMemory } from "../src/utils/local-mode"
import {
  formatStateMemoryPrompt,
  isInjectedTurn,
  stripInjectedContext
} from "../src/utils/prompt-formatter"
import type { MessageTurn } from "../src/types"

// ---------------------------------------------------------------------------
// Helpers: build minimal DOM fixtures that the adapters can read
// ---------------------------------------------------------------------------

/**
 * Build a JSDOM document for ChatGPT and patch its location.href
 * using the writable property that JSDOM exposes on the URL.
 * Never uses Object.defineProperty on location (read-only in JSDOM).
 */
function makeChatGPTDoc(
  messages: Array<{
    role: "user" | "assistant"
    text: string
    unitKey: string
    messageId?: string
    convId?: string
  }>,
  href: string
): Document {
  const dom = new JSDOM("<!DOCTYPE html><html><body><main></main></body></html>", {
    url: href
  })
  const doc = dom.window.document
  const main = doc.querySelector("main")!

  messages.forEach(({ role, text, unitKey, messageId, convId }) => {
    const el = doc.createElement("div")
    el.setAttribute("data-chatgpt-search-unit-key", unitKey)
    if (messageId) el.setAttribute("data-chatgpt-search-message-ids", messageId)
    if (convId) el.setAttribute("data-chatgpt-selection-conversation-id", convId)

    if (role === "user") {
      const inner = doc.createElement("div")
      inner.setAttribute("data-user-message-bubble", "true")
      inner.className = "whitespace-pre-wrap"
      inner.textContent = text
      el.appendChild(inner)
    } else {
      const inner = doc.createElement("div")
      inner.setAttribute("data-markdown-text-style", "assistant-message")
      inner.className = "markdown"
      inner.textContent = text
      el.appendChild(inner)
    }
    main.appendChild(el)
  })
  return doc
}

function makeClaudeDoc(
  messages: Array<{
    role: "user" | "assistant"
    text: string
    hiddenLabel?: string
    timestamp?: string
    messageId?: string
  }>,
  href: string
): Document {
  const dom = new JSDOM("<!DOCTYPE html><html><body><main></main></body></html>", {
    url: href
  })
  const doc = dom.window.document
  const main = doc.querySelector("main")!

  messages.forEach(({ role, text, hiddenLabel, timestamp, messageId }) => {
    if (role === "assistant") {
      // Outer wrapper: matches div[data-message-author-slug="claude"]
      const outer = doc.createElement("div")
      outer.setAttribute("data-message-author-slug", "claude")
      if (messageId) outer.setAttribute("data-message-id", messageId)

      // Hidden screen-reader label -- textContent includes this: the A2 bug
      if (hiddenLabel) {
        const span = doc.createElement("span")
        span.className = "sr-only"
        span.textContent = hiddenLabel
        outer.appendChild(span)
      }
      // Inner content: also matches [data-testid="assistant-message"]
      const inner = doc.createElement("div")
      inner.setAttribute("data-testid", "assistant-message")
      inner.textContent = text
      outer.appendChild(inner)

      // Relative timestamp glued in by textContent
      if (timestamp) {
        const ts = doc.createElement("span")
        ts.textContent = timestamp
        outer.appendChild(ts)
      }
      main.appendChild(outer)
    } else {
      const el = doc.createElement("div")
      el.setAttribute("data-testid", "user-message")
      if (messageId) el.setAttribute("data-message-id", messageId)
      el.textContent = text
      main.appendChild(el)
    }
  })
  return doc
}

// ---------------------------------------------------------------------------
// A1: ChatGPT must use real message id, not unit key
// ---------------------------------------------------------------------------
describe("A1 - ChatGPT: real message id, not unit key", () => {
  beforeEach(async () => {
    resetMockStore()
    await clearAllData()
  })

  it("A1a: turn.id == data-chatgpt-search-message-ids when present [PASSES pre-fix because current code reads it first]", () => {
    const doc = makeChatGPTDoc(
      [
        {
          role: "user",
          text: "2+2",
          unitKey: "fallback-turn-1:0:user",
          messageId: "real-msg-id-chatA-user",
          convId: "conv-aaa"
        }
      ],
      "https://chatgpt.com/c/conv-aaa"
    )
    const adapter = new ChatGPTAdapter()
    const turns = adapter.getMessages(doc)
    expect(turns.length).toBe(1)
    expect(turns[0].id).toBe("real-msg-id-chatA-user")
    expect(turns[0].id).not.toBe("fallback-turn-1:0:user")
  })

  it("A1b: turn with NO real message id attribute is SKIPPED [FAILS pre-fix: returns 1 turn with id=unitKey]", () => {
    const doc = makeChatGPTDoc(
      [{ role: "user", text: "2+2", unitKey: "fallback-turn-1:0:user" }],
      "https://chatgpt.com/c/conv-aaa"
    )
    const adapter = new ChatGPTAdapter()
    const turns = adapter.getMessages(doc)
    // After fix: skip turns with no real message id
    expect(turns.length).toBe(0)
  })

  it("A1c: two chats same unit key, different real ids => 2 clean entries [FAILS pre-fix: B gets A's goal]", async () => {
    const chatATurns: MessageTurn[] = [
      { id: "msg-a-1", role: "user", text: "2+2", codeBlocks: [], chatId: "conv-aaa" },
      { id: "msg-a-2", role: "assistant", text: "2 + 2 = 4", codeBlocks: [], chatId: "conv-aaa" }
    ]
    await handleAutoSave({
      sourcePlatform: "chatgpt", chatId: "conv-aaa", chatTitle: "2+2",
      sourceUrl: "https://chatgpt.com/c/conv-aaa",
      rawTranscript: "User: 2+2\nAssistant: 4",
      rawCodeBlocks: [], turns: chatATurns
    })

    const chatBTurns: MessageTurn[] = [
      { id: "msg-b-1", role: "user", text: "banana ke fayde", codeBlocks: [], chatId: "conv-bbb" },
      { id: "msg-b-2", role: "assistant", text: "Banana ke 7 fayde hain...", codeBlocks: [], chatId: "conv-bbb" }
    ]
    const resultB = await handleAutoSave({
      sourcePlatform: "chatgpt", chatId: "conv-bbb", chatTitle: "Banana ke fayde",
      sourceUrl: "https://chatgpt.com/c/conv-bbb",
      rawTranscript: "User: banana ke fayde\nAssistant: Banana ke fayde...",
      rawCodeBlocks: [], turns: chatBTurns
    })
    expect(resultB.success).toBe(true)

    const all = await getStoredContexts()
    expect(all.length).toBe(2)
    const entryA = all.find(e => e.chatId === "conv-aaa")!
    const entryB = all.find(e => e.chatId === "conv-bbb")!
    expect(entryA).toBeDefined()
    expect(entryB).toBeDefined()
    expect(entryB.stateMemory.objective).toContain("banana ke fayde")
    expect(entryB.stateMemory.objective).not.toContain("2+2")
    expect(entryB.turns?.some(t => t.text.includes("banana ke fayde"))).toBe(true)
    expect(entryB.turns?.some(t => t.text === "2+2")).toBe(false)
    expect(entryA.turns?.some(t => t.text === "2+2")).toBe(true)
    expect(entryA.turns?.some(t => t.text.includes("banana"))).toBe(false)
  })

  it("A1d: different real ids for different chats are both accepted by ownership map", async () => {
    resetMockStore(); await clearAllData()
    await filterTurnsByMessageOwnership(
      [{ id: "msg-a-1", role: "user", text: "2+2", codeBlocks: [], chatId: "conv-aaa" }],
      "conv-aaa"
    )
    const { validTurns, foreignCount } = await filterTurnsByMessageOwnership(
      [{ id: "msg-b-1", role: "user", text: "banana ke fayde", codeBlocks: [] }],
      "conv-bbb"
    )
    expect(foreignCount).toBe(0)
    expect(validTurns.length).toBe(1)
    expect(validTurns[0].chatId).toBe("conv-bbb")
  })

  it("A1e: same id registered by chat A is dropped as foreign for chat B", async () => {
    resetMockStore(); await clearAllData()
    await filterTurnsByMessageOwnership(
      [{ id: "shared-id", role: "user", text: "hello", codeBlocks: [], chatId: "conv-aaa" }],
      "conv-aaa"
    )
    const { validTurns, foreignCount } = await filterTurnsByMessageOwnership(
      [{ id: "shared-id", role: "user", text: "banana ke fayde", codeBlocks: [] }],
      "conv-bbb"
    )
    expect(foreignCount).toBe(1)
    expect(validTurns.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// A2: Claude - exactly one turn per message
// ---------------------------------------------------------------------------
describe("A2 - Claude: one turn per message, no hidden labels, no timestamps", () => {
  it("A2a: outer+inner element => exactly 2 total turns (1 user + 1 asst) [FAILS pre-fix: 4 turns]", () => {
    const doc = makeClaudeDoc(
      [
        { role: "user", text: "3+3", messageId: "u-001" },
        {
          role: "assistant",
          text: "3 + 3 = 6",
          hiddenLabel: "Claude responded: ",
          timestamp: "just now",
          messageId: "a-001"
        }
      ],
      "https://claude.ai/chat/chat-xyz"
    )
    const adapter = new ClaudeAdapter()
    const turns = adapter.getMessages(doc)
    expect(turns.length).toBe(2)
    const asst = turns.find(t => t.role === "assistant")!
    expect(asst).toBeDefined()
    expect(asst.text).not.toContain("Claude responded:")
    expect(asst.text).not.toContain("just now")
    expect(asst.text.split("3 + 3 = 6").length - 1).toBe(1)
    expect(asst.text.trim()).toBe("3 + 3 = 6")
  })

  it("A2b: apple ke fayde: 1 user, 1 assistant turn (not 2+2) [FAILS pre-fix]", () => {
    const doc = makeClaudeDoc(
      [
        { role: "user", text: "apple ke fayde", messageId: "u-apple" },
        {
          role: "assistant",
          text: "Apple ke fayde: sehat acha rehta hai...",
          hiddenLabel: "Claude responded: ",
          timestamp: "just now",
          messageId: "a-apple"
        }
      ],
      "https://claude.ai/chat/chat-apple"
    )
    const adapter = new ClaudeAdapter()
    const turns = adapter.getMessages(doc)
    expect(turns.filter(t => t.role === "user").length).toBe(1)
    expect(turns.filter(t => t.role === "assistant").length).toBe(1)
  })

  it("A2c: assistant text is exactly the answer [FAILS pre-fix: 'Claude responded: 3+3=63+3=6just now']", () => {
    const doc = makeClaudeDoc(
      [
        { role: "user", text: "3+3" },
        { role: "assistant", text: "3 + 3 = 6", hiddenLabel: "Claude responded: ", timestamp: "just now" }
      ],
      "https://claude.ai/chat/chat-333"
    )
    const adapter = new ClaudeAdapter()
    const turns = adapter.getMessages(doc)
    const asst = turns.find(t => t.role === "assistant")!
    expect(asst.text.trim()).toBe("3 + 3 = 6")
  })
})

// ---------------------------------------------------------------------------
// A3: Inject path - <goal> and <last> always populated
// ---------------------------------------------------------------------------
describe("A3 - Inject path: <goal> and <last> with real content", () => {
  it("A3a: <goal> has real first user turn text, not 'Active conversation'", () => {
    const turns: MessageTurn[] = [
      { id: "u1", role: "user", text: "banana ke fayde", codeBlocks: [] },
      { id: "a1", role: "assistant", text: "Banana ke 7 fayde hain. Energy...", codeBlocks: [] }
    ]
    const memory = buildLocalStateMemory(turns, [], "Banana ke fayde")
    const out = formatStateMemoryPrompt(memory, "chatgpt", "claude")
    expect(out).toContain("<goal>")
    expect(out).toContain("banana ke fayde")
    expect(out).not.toContain("<goal>Active conversation</goal>")
  })

  it("A3b: <last> contains both user question and assistant reply", () => {
    const turns: MessageTurn[] = [
      { id: "u1", role: "user", text: "banana ke fayde", codeBlocks: [] },
      { id: "a1", role: "assistant", text: "Banana ke 7 fayde hain. 1. Energy...", codeBlocks: [] }
    ]
    const memory = buildLocalStateMemory(turns, [], "Banana ke fayde")
    const out = formatStateMemoryPrompt(memory, "chatgpt", "claude")
    expect(out).toContain("<last>")
    expect(out).toContain("Banana ke 7 fayde")
    expect(out).not.toMatch(/<last>\s*<\/last>/)
  })

  it("A3c: Ready line always present", () => {
    const memory = buildLocalStateMemory(
      [{ id: "u1", role: "user", text: "2+2", codeBlocks: [] }, { id: "a1", role: "assistant", text: "4", codeBlocks: [] }],
      [], "2+2"
    )
    expect(formatStateMemoryPrompt(memory, "chatgpt", "claude")).toContain('Reply "Ready"')
  })

  it("A3d: both adapters produce same <goal> via formatFor", () => {
    const turns: MessageTurn[] = [
      { id: "u1", role: "user", text: "banana ke fayde", codeBlocks: [] },
      { id: "a1", role: "assistant", text: "Banana ke fayde: energy...", codeBlocks: [] }
    ]
    const memory = buildLocalStateMemory(turns, [], "Banana ke fayde")
    const outGPT = new ChatGPTAdapter().formatFor(memory, "chatgpt")
    const outClaude = new ClaudeAdapter().formatFor(memory, "chatgpt")
    for (const out of [outGPT, outClaude]) {
      expect(out).toContain("banana ke fayde")
      expect(out).toContain("energy")
    }
  })
})

// ---------------------------------------------------------------------------
// A5: Title/goal never placeholder
// ---------------------------------------------------------------------------
describe("A5 - Goal from first user turn, never placeholder", () => {
  it("A5a: goal = first user turn text (not placeholder title)", () => {
    const memory = buildLocalStateMemory(
      [{ id: "u1", role: "user", text: "banana ke fayde", codeBlocks: [] }],
      [], "New chat"
    )
    expect(memory.objective).toBe("banana ke fayde")
  })

  it("A5b: generic platform names are never the goal", () => {
    for (const ph of ["ChatGPT", "Claude", "New chat", "Untitled", "Message collapsed"]) {
      const memory = buildLocalStateMemory(
        [{ id: "u1", role: "user", text: "real question", codeBlocks: [] }],
        [], ph
      )
      expect(memory.objective).toBe("real question")
    }
  })

  it("A5c: empty turns + placeholder title => empty goal", () => {
    expect(buildLocalStateMemory([], [], "ChatGPT").objective).toBe("")
  })

  it("A5d: chat B goal != chat A goal after tab navigation", async () => {
    resetMockStore(); await clearAllData()
    await handleAutoSave({
      sourcePlatform: "chatgpt", chatId: "conv-aaa", chatTitle: "2+2",
      sourceUrl: "https://chatgpt.com/c/conv-aaa",
      rawTranscript: "User: 2+2\nAssistant: 4", rawCodeBlocks: [],
      turns: [
        { id: "msg-a-1", role: "user", text: "2+2", codeBlocks: [], chatId: "conv-aaa" },
        { id: "msg-a-2", role: "assistant", text: "4", codeBlocks: [], chatId: "conv-aaa" }
      ]
    })
    await handleAutoSave({
      sourcePlatform: "chatgpt", chatId: "conv-bbb", chatTitle: "banana ke fayde",
      sourceUrl: "https://chatgpt.com/c/conv-bbb",
      rawTranscript: "User: banana ke fayde\nAssistant: Banana ke fayde hain...", rawCodeBlocks: [],
      turns: [
        { id: "msg-b-1", role: "user", text: "banana ke fayde", codeBlocks: [], chatId: "conv-bbb" },
        { id: "msg-b-2", role: "assistant", text: "Banana ke fayde hain...", codeBlocks: [], chatId: "conv-bbb" }
      ]
    })
    const all = await getStoredContexts()
    const entryB = all.find(e => e.chatId === "conv-bbb")!
    expect(entryB.stateMemory.objective).toContain("banana ke fayde")
    expect(entryB.stateMemory.objective).not.toContain("2+2")
  })
})

// ---------------------------------------------------------------------------
// A9: Injected text not captured; handshake chats skipped
// ---------------------------------------------------------------------------
describe("A9 - Injected text not captured; handshake skipped; real follow-up saved", () => {
  beforeEach(async () => { resetMockStore(); await clearAllData() })

  it("A9a: <ctx> block detected as injected turn", () => {
    const txt = `<ctx from="chatgpt" age="2m">
Continue. Reply "Ready" in one word.
<goal>2+2</goal>
<last>User: 2+2\nAssistant: 4</last>
</ctx>`
    expect(isInjectedTurn(txt)).toBe(true)
  })

  it("A9b: stripInjectedContext leaves empty string", () => {
    expect(stripInjectedContext(
      `<ctx from="chatgpt" age="1s">Continue. Reply "Ready".\n<goal>2+2</goal>\n</ctx>`
    ).trim()).toBe("")
  })

  it("A9c: injected block + Ready only => skipped-handshake [FAILS pre-fix: returns NO_REAL_TITLE_OR_TURNS]", async () => {
    const result = await handleAutoSave({
      sourcePlatform: "claude",
      chatId: "chat-fresh-001",
      chatTitle: "Ready",
      sourceUrl: "https://claude.ai/chat/chat-fresh-001",
      rawTranscript: "User: [ctx]\nAssistant: Ready",
      rawCodeBlocks: [],
      turns: [
        {
          id: "t1", role: "user",
          text: `<ctx from="chatgpt" age="1s">Continue. Reply "Ready".\n<goal>2+2</goal>\n</ctx>`,
          codeBlocks: []
        },
        { id: "t2", role: "assistant", text: "Ready", codeBlocks: [] }
      ]
    })
    expect(result.success).toBe(false)
    expect(result.error).toBe("INJECTED_HANDSHAKE_ONLY")
  })

  it("A9d: real follow-up after inject is saved; <ctx> absent from stored turns", async () => {
    const result = await handleAutoSave({
      sourcePlatform: "claude",
      chatId: "chat-fresh-002",
      chatTitle: "Banana ke fayde",
      sourceUrl: "https://claude.ai/chat/chat-fresh-002",
      rawTranscript: "User: banana ke fayde\nAssistant: Banana ke fayde hain...",
      rawCodeBlocks: [],
      turns: [
        {
          id: "t1", role: "user",
          text: `<ctx from="chatgpt" age="1s">Continue. Reply "Ready".\n<goal>2+2</goal>\n</ctx>`,
          codeBlocks: []
        },
        { id: "t2", role: "assistant", text: "Ready", codeBlocks: [] },
        { id: "t3", role: "user", text: "banana ke fayde", codeBlocks: [] },
        { id: "t4", role: "assistant", text: "Banana ke fayde hain: 1. Energy...", codeBlocks: [] }
      ]
    })
    expect(result.success).toBe(true)
    const entry = (await getStoredContexts()).find(e => e.chatId === "chat-fresh-002")!
    expect(entry).toBeDefined()
    expect(entry.turns?.some(t => t.text.includes("<ctx"))).toBe(false)
    expect(entry.turns?.some(t => t.text.includes("banana ke fayde"))).toBe(true)
  })

  it("A9e: legacy === [CONTEXT BRIDGE block stripped and detected", () => {
    const legacy = `=== [CONTEXT BRIDGE: HANDOVER FROM CHATGPT] ===\nContinue.\n=== [END OF CONTEXT BRIDGE HANDOVER] ===`
    expect(isInjectedTurn(legacy)).toBe(true)
    expect(stripInjectedContext(legacy).trim()).toBe("")
  })
})

// ---------------------------------------------------------------------------
// A10: Rich ChatGPT never throws
// ---------------------------------------------------------------------------
describe("A10 - Rich ChatGPT: unknown children never throw", () => {
  it("A10a: citation chips, images, widgets do not throw", () => {
    const dom = new JSDOM(`<!DOCTYPE html><html><body><main>
      <div data-chatgpt-search-unit-key="fallback-turn-1:0:user"
           data-chatgpt-search-message-ids="rmsg-user-1">
        <div data-user-message-bubble="true" class="whitespace-pre-wrap">What is Bitcoin?</div>
      </div>
      <div data-chatgpt-search-unit-key="fallback-turn-1:0:assistant"
           data-chatgpt-search-message-ids="rmsg-asst-1">
        <div data-markdown-text-style="assistant-message" class="markdown">
          Bitcoin is a cryptocurrency.
          <div data-testid="citation-chip"><a href="#">[1]</a></div>
          <div role="radio" aria-label="Option A">Option A</div>
          <img src="chart.png" alt="price chart" />
        </div>
      </div>
    </main></body></html>`, { url: "https://chatgpt.com/c/conv-btc" })

    const adapter = new ChatGPTAdapter()
    let turns: ReturnType<typeof adapter.getMessages>
    expect(() => { turns = adapter.getMessages(dom.window.document) }).not.toThrow()
    expect(turns!.length).toBeGreaterThanOrEqual(1)
    const asst = turns!.find(t => t.role === "assistant")
    if (asst) expect(asst.text).toContain("Bitcoin is a cryptocurrency")
  })

  it("A10b: rich chat saves normally when text is extractable", async () => {
    resetMockStore(); await clearAllData()
    const result = await handleAutoSave({
      sourcePlatform: "chatgpt", chatId: "conv-bitcoin", chatTitle: "Bitcoin",
      sourceUrl: "https://chatgpt.com/c/conv-bitcoin",
      rawTranscript: "User: What is Bitcoin?\nAssistant: Bitcoin is a cryptocurrency.",
      rawCodeBlocks: [],
      turns: [
        { id: "rmsg-user-1", role: "user", text: "What is Bitcoin?", codeBlocks: [] },
        { id: "rmsg-asst-1", role: "assistant", text: "Bitcoin is a cryptocurrency.", codeBlocks: [] }
      ]
    })
    expect(result.success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Local mode: zero fetch
// ---------------------------------------------------------------------------
describe("Local Mode - no network calls", () => {
  it("fetch never called during handleAutoSave without API key", async () => {
    resetMockStore(); await clearAllData()
    const spy = vi.spyOn(globalThis, "fetch" as any)
    await handleAutoSave({
      sourcePlatform: "chatgpt", chatId: "conv-local", chatTitle: "local test",
      sourceUrl: "https://chatgpt.com/c/conv-local",
      rawTranscript: "User: hello\nAssistant: hi", rawCodeBlocks: [],
      turns: [
        { id: "t1", role: "user", text: "hello", codeBlocks: [] },
        { id: "t2", role: "assistant", text: "hi", codeBlocks: [] }
      ]
    })
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
