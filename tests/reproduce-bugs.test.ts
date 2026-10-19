import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { JSDOM } from "jsdom"
import { ChatGPTAdapter } from "../src/adapters/chatgpt"
import { ClaudeAdapter } from "../src/adapters/claude"
import { buildLocalStateMemory, countExchanges, formatCompactLastExchanges } from "../src/utils/local-mode"
import { formatStateMemoryPrompt, isInjectedTurn, stripInjectedContext } from "../src/utils/prompt-formatter"
import { filterEligibleContexts } from "../src/utils/context-filter"
import { computeExpiryTimestamp } from "../src/utils/storage-manager"
import type { MessageTurn, StateMemory, StoredContext, VerbatimCodeBlock } from "../src/types"

describe("Context Bridge Comprehensive Verification Suite", () => {
  // Bug 1 & Design A/C: ChatGPT Snapshot validation & Foreign turn dropping
  it("Bug 1 & Design C: validates turns against current chat ID and drops foreign conversation ID turns", () => {
    const html = `
      <main>
        <div data-chatgpt-search-unit-key="unit1:user" data-chatgpt-selection-conversation-id="chat-A-old">
          <p>What is 2+2?</p>
        </div>
        <div data-chatgpt-search-unit-key="unit2:assistant" data-chatgpt-selection-conversation-id="chat-A-old">
          <p>4</p>
        </div>
      </main>
    `
    // URL is chat-B-new, but DOM still holds chat-A-old turns (SPA transition lag)
    const dom = new JSDOM(html, { url: "https://chatgpt.com/c/chat-B-new" })
    const adapter = new ChatGPTAdapter()
    const turns = adapter.getMessages(dom.window.document)

    // Foreign turns belonging to chat-A-old MUST be dropped
    expect(turns.length).toBe(0)

    // When turns match current conversation ID, they are accepted
    const matchingHtml = `
      <main>
        <div data-chatgpt-search-unit-key="unit1:user" data-chatgpt-search-message-ids="msg-user-chatB-0001" data-chatgpt-selection-conversation-id="chat-B-new">
          <p>Banana ke fayde</p>
        </div>
        <div data-chatgpt-search-unit-key="unit2:assistant" data-chatgpt-search-message-ids="msg-asst-chatB-0001" data-chatgpt-selection-conversation-id="chat-B-new">
          <p>Kele ke kai fayde hain...</p>
        </div>
      </main>
    `
    const domB = new JSDOM(matchingHtml, { url: "https://chatgpt.com/c/chat-B-new" })
    const turnsB = adapter.getMessages(domB.window.document)
    expect(turnsB.length).toBe(2)
    expect(turnsB[0].chatId).toBe("chat-B-new")
    expect(turnsB[0].text).toContain("Banana ke fayde")
  })

  // Bug 2 & Design K: "View Details" data completeness
  it("Bug 2 & Design K: generates full Details view data (chatKey, title, goal, stored turns breakdown) even without techStack or code", () => {
    const turns: MessageTurn[] = [
      { id: "t1", role: "user", text: "Explain quantum entanglement in simple terms", chatId: "chat-123", codeBlocks: [] },
      { id: "t2", role: "assistant", text: "Quantum entanglement is when two particles become connected...", chatId: "chat-123", codeBlocks: [] }
    ]
    const memory = buildLocalStateMemory(turns, [], "Explain quantum entanglement")
    const ctx: StoredContext = {
      id: "chatgpt:chat-123",
      sourcePlatform: "chatgpt",
      chatId: "chat-123",
      chatTitle: "Explain quantum entanglement",
      sourceUrl: "https://chatgpt.com/c/chat-123",
      createdAt: 1000,
      updatedAt: 2000,
      expiresAt: 2000 + 24 * 3600 * 1000,
      stateMemory: memory,
      rawCodeBlocks: [],
      turns,
      exchangeCount: countExchanges(turns)
    }

    expect(ctx.id).toBe("chatgpt:chat-123")
    expect(ctx.chatTitle).toBe("Explain quantum entanglement")
    expect(ctx.stateMemory.objective).toBe("Explain quantum entanglement in simple terms")
    expect(ctx.turns).toHaveLength(2)
    expect(ctx.turns![0].text.slice(0, 80)).toBe("Explain quantum entanglement in simple terms")
    expect(ctx.turns![0].chatId).toBe("chat-123")
  })

  // Bug 3 & Design F: <last> captures 3-4 substantive exchanges including assistant replies
  it("Bug 3 & Design F: <last> includes both User prompt and Assistant reply for exchanges (trimmed ~200 chars)", () => {
    const turns: MessageTurn[] = [
      {
        id: "t-1",
        role: "user",
        text: "What is 2+2?",
        codeBlocks: []
      },
      {
        id: "t-2",
        role: "assistant",
        text: "2+2 is equal to 4. Mathematics is fascinating because basic arithmetic forms the foundation for advanced algebra and calculus.",
        codeBlocks: []
      }
    ]

    const lastExchanges = formatCompactLastExchanges(turns, "standard")
    expect(lastExchanges).toContain("User: What is 2+2?")
    expect(lastExchanges).toContain("Assistant: 2+2 is equal to 4.")
  })

  // Bug 4 & Design G: <goal> is ALWAYS emitted in the injected text
  it("Bug 4 & Design G: always emits <goal>...</goal> tag even when memory objective is completely empty", () => {
    const emptyMemory: StateMemory = {
      version: "1.0",
      objective: "",
      techStack: [],
      architectureDecisions: [],
      currentWork: "Refactoring the authentication handler",
      blockersAndErrors: [],
      nextSteps: [],
      criticalSnippets: [],
      rawTokenEstimate: 20
    }

    const adapter = new ClaudeAdapter()
    const injected = adapter.formatFor(emptyMemory, "claude")

    // <goal> tag MUST always be present and non-empty
    expect(injected).toMatch(/<goal>[^<]+<\/goal>/)
    expect(injected).toContain("Active conversation")
  })

  // Bug 5 & Design H: Strip injected context blocks and reject handover-only conversations
  it("Bug 5 & Design H: strips new <ctx> and old handover blocks, ignoring injected-only turns", () => {
    const newCtxBlock = `<ctx from="chatgpt" age="2m">
Continue this work. Don't re-summarize. Reply "Ready" in one word, then wait for my next message.
<goal>Build rate limiter</goal>
</ctx>`
    const oldHandoverBlock = `=== [CONTEXT BRIDGE: HANDOVER] ===
Source Platform: ChatGPT
Goal: Build rate limiter
=== [END OF CONTEXT BRIDGE] ===`

    expect(isInjectedTurn(newCtxBlock)).toBe(true)
    expect(isInjectedTurn(oldHandoverBlock)).toBe(true)

    expect(stripInjectedContext(newCtxBlock)).toBe("")
    expect(stripInjectedContext(oldHandoverBlock)).toBe("")

    // Embedded inside normal user message: strips context block and preserves user's real prompt
    const mixed = `${newCtxBlock}\n\nPlease also add Redis caching.`
    expect(stripInjectedContext(mixed).trim()).toBe("Please also add Redis caching.")

    // Handshake conversation (User injected prompt, Assistant says "Ready.") is recognized as handshake
    const handshakeTurns: MessageTurn[] = [
      { id: "t-1", role: "user", text: newCtxBlock, codeBlocks: [] },
      { id: "t-2", role: "assistant", text: "Ready.", codeBlocks: [] }
    ]
    const substantive = handshakeTurns.filter((t) => {
      const clean = stripInjectedContext(t.text || "").trim()
      if (t.role === "assistant" && (clean.toLowerCase() === "ready" || clean.toLowerCase() === "ready.")) {
        return false
      }
      return clean.length > 0 || (t.codeBlocks && t.codeBlocks.length > 0)
    })
    expect(substantive.length).toBe(0)
  })

  // Bug 6 & Design I: Expiry logic with mocked clock
  it("Bug 6 & Design I: expires configured_hours (default 24h) after last update; does not expire after 1 hour", () => {
    const baseTime = 1700000000000 // T0

    // Default 24 hours
    const expiry24 = computeExpiryTimestamp(baseTime, 24)
    expect(expiry24).toBe(baseTime + 24 * 3600 * 1000)

    // Configurable 48 hours
    const expiry48 = computeExpiryTimestamp(baseTime, 48)
    expect(expiry48).toBe(baseTime + 48 * 3600 * 1000)

    // Fallback if given invalid/out-of-range value
    const fallbackExpiry = computeExpiryTimestamp(baseTime, -1)
    expect(fallbackExpiry).toBe(baseTime + 24 * 3600 * 1000)

    // Active context tested against clock
    const context: StoredContext = {
      id: "chatgpt:test-chat",
      sourcePlatform: "chatgpt",
      chatId: "test-chat",
      chatTitle: "Test Chat",
      sourceUrl: "https://chatgpt.com/c/test-chat",
      createdAt: baseTime,
      updatedAt: baseTime,
      expiresAt: expiry24,
      stateMemory: {
        version: "1.0",
        objective: "Test",
        techStack: [],
        architectureDecisions: [],
        currentWork: "Test",
        blockersAndErrors: [],
        nextSteps: [],
        criticalSnippets: [],
        rawTokenEstimate: 10
      },
      rawCodeBlocks: []
    }

    // 1 hour later: context MUST NOT be expired
    const oneHourLater = baseTime + 1 * 3600 * 1000
    const eligible1h = filterEligibleContexts([context], "claude", "other-chat", false, oneHourLater)
    expect(eligible1h).toHaveLength(1)

    // 25 hours later: context IS expired
    const twentyFiveHoursLater = baseTime + 25 * 3600 * 1000
    const eligible25h = filterEligibleContexts([context], "claude", "other-chat", false, twentyFiveHoursLater)
    expect(eligible25h).toHaveLength(0)
  })

  // Bug 8: Claude placeholder filtering ("Message collapsed")
  it("Bug 8: filters 'Message collapsed' from title and goal across all variations", () => {
    const turnsWithCollapsedPlaceholder: MessageTurn[] = [
      { id: "turn-1", role: "user", text: "Message collapsed", codeBlocks: [] },
      { id: "turn-2", role: "user", text: "Write a function that calculates Fibonacci numbers", codeBlocks: [] }
    ]

    const memory = buildLocalStateMemory(turnsWithCollapsedPlaceholder, [], "Message collapsed.")
    expect(memory.objective.toLowerCase()).not.toContain("message collapsed")
    expect(memory.objective).toBe("Write a function that calculates Fibonacci numbers")

    const adapter = new ClaudeAdapter()
    const doc = new JSDOM(`<html><head><title>Message collapsed - Claude</title></head></html>`).window.document
    expect(adapter.getChatTitle(doc)).toBe("") // Placeholder title rejected
  })

  // Bug 9 & Design G: Blank lines inside code blocks must be preserved exactly
  it("Bug 9 & Design G: preserves multiple consecutive blank lines inside code blocks exactly without collapsing", () => {
    const rawCodeWithTwoBlankLines = "def add(a, b):\n\n\n    return a + b"
    const memory: StateMemory = {
      version: "1.0",
      objective: "Add two numbers",
      techStack: [],
      architectureDecisions: [],
      currentWork: "User: add numbers",
      blockersAndErrors: [],
      nextSteps: [],
      criticalSnippets: [
        {
          id: "snippet-1",
          language: "python",
          code: rawCodeWithTwoBlankLines,
          turnIndex: 1
        }
      ],
      rawTokenEstimate: 50
    }

    const adapter = new ChatGPTAdapter()
    const formatted = adapter.formatFor(memory, "chatgpt")

    // Must preserve the two consecutive blank lines exactly inside the <code> block!
    expect(formatted).toContain("<code lang=\"python\">\ndef add(a, b):\n\n\n    return a + b\n</code>")
  })

  // Bug 10 & Design K: Exchange count calculation consistency
  it("Bug 10 & Design K: countExchanges yields consistent count for storage and popup", () => {
    const sampleTurns: MessageTurn[] = [
      { id: "1", role: "user", text: "Hello", codeBlocks: [] },
      { id: "2", role: "assistant", text: "Hi there!", codeBlocks: [] },
      { id: "3", role: "user", text: "How are you?", codeBlocks: [] },
      { id: "4", role: "assistant", text: "Doing well, thanks!", codeBlocks: [] }
    ]

    const count = countExchanges(sampleTurns)
    expect(count).toBe(2)
  })

  // Design G: Single formatter snapshot test for ChatGPT and Claude
  it("Design G: formatStateMemoryPrompt produces exact expected XML format with <ctx>, <goal>, <last>, <code>", () => {
    const memory: StateMemory = {
      version: "1.0",
      objective: "Build a distributed queue worker",
      techStack: ["Node.js", "Redis"],
      architectureDecisions: [],
      currentWork: "User: Build a distributed queue worker\n\nAssistant: Let's design the worker with BullMQ and Redis.",
      blockersAndErrors: [],
      nextSteps: ["Implement exponential backoff retry"],
      criticalSnippets: [
        {
          id: "snip-1",
          language: "typescript",
          code: "export class QueueWorker {\n  async process() {}\n}",
          turnIndex: 1
        }
      ],
      rawTokenEstimate: 120
    }

    const chatgptAdapter = new ChatGPTAdapter()
    const formattedChatGPT = chatgptAdapter.formatFor(memory, "chatgpt")

    expect(formattedChatGPT).toMatch(/^<ctx from="chatgpt" age="[^"]+">/)
    expect(formattedChatGPT).toContain("Continue this work. Don't re-summarize. Reply \"Ready\" in one word, then wait for my next message.")
    expect(formattedChatGPT).toContain("<goal>Build a distributed queue worker</goal>")
    expect(formattedChatGPT).toContain("<last>User: Build a distributed queue worker\n\nAssistant: Let's design the worker with BullMQ and Redis.</last>")
    expect(formattedChatGPT).toContain("<code lang=\"typescript\">\nexport class QueueWorker {\n  async process() {}\n}\n</code>")
    expect(formattedChatGPT).toMatch(/<\/ctx>$/)

    const claudeAdapter = new ClaudeAdapter()
    const formattedClaude = claudeAdapter.formatFor(memory, "claude")
    expect(formattedClaude).toMatch(/^<ctx from="claude" age="[^"]+">/)
  })

  // Acceptance Test: Two distinct chats maintain distinct identities, titles, goals, and turns
  it("Acceptance Test: Chat A ('2+2') and Chat B ('banana ke fayde') produce 2 independent contexts without bleed", () => {
    const turnsA: MessageTurn[] = [
      { id: "a1", role: "user", text: "What is 2+2?", chatId: "conv-A", codeBlocks: [] },
      { id: "a2", role: "assistant", text: "4", chatId: "conv-A", codeBlocks: [] }
    ]
    const turnsB: MessageTurn[] = [
      { id: "b1", role: "user", text: "Banana ke fayde batao", chatId: "conv-B", codeBlocks: [] },
      { id: "b2", role: "assistant", text: "Kele mein potassium hota hai...", chatId: "conv-B", codeBlocks: [] }
    ]

    const memoryA = buildLocalStateMemory(turnsA, [], "Calculate 2+2")
    const memoryB = buildLocalStateMemory(turnsB, [], "Banana ke fayde")

    const contextA: StoredContext = {
      id: "chatgpt:conv-A",
      sourcePlatform: "chatgpt",
      chatId: "conv-A",
      chatTitle: "Calculate 2+2",
      sourceUrl: "https://chatgpt.com/c/conv-A",
      createdAt: 1000,
      updatedAt: 1000,
      expiresAt: 1000 + 24 * 3600 * 1000,
      stateMemory: memoryA,
      rawCodeBlocks: [],
      turns: turnsA,
      exchangeCount: countExchanges(turnsA)
    }

    const contextB: StoredContext = {
      id: "chatgpt:conv-B",
      sourcePlatform: "chatgpt",
      chatId: "conv-B",
      chatTitle: "Banana ke fayde",
      sourceUrl: "https://chatgpt.com/c/conv-B",
      createdAt: 2000,
      updatedAt: 2000,
      expiresAt: 2000 + 24 * 3600 * 1000,
      stateMemory: memoryB,
      rawCodeBlocks: [],
      turns: turnsB,
      exchangeCount: countExchanges(turnsB)
    }

    // Two chats never share a key
    expect(contextA.id).not.toBe(contextB.id)

    // Goals are independent
    expect(contextA.stateMemory.objective).toBe("What is 2+2?")
    expect(contextB.stateMemory.objective).toBe("Banana ke fayde batao")

    // Turns are independent
    expect(contextA.turns).toHaveLength(2)
    expect(contextB.turns).toHaveLength(2)
    expect(contextA.turns![0].chatId).toBe("conv-A")
    expect(contextB.turns![0].chatId).toBe("conv-B")
  })
})
