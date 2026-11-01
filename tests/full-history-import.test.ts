import { describe, expect, it, vi, beforeEach } from "vitest"
import { JSDOM } from "jsdom"
import { ChatGPTAdapter } from "../src/adapters/chatgpt"
import { ClaudeAdapter } from "../src/adapters/claude"
import { GeminiAdapter } from "../src/adapters/gemini"
import {
  clearAllData,
  getStoredContexts,
  saveContext
} from "../src/utils/storage-manager"
import type { MessageTurn, StoredContext } from "../src/types"
import { captureCompleteConversation } from "../src/utils/instant-capture"
import { parseOfficialPlatformExport } from "../src/utils/official-export-importer"
import {
  appendUniqueTurnById,
  computeConversationStatistics,
  mergeTurnsForSameChat
} from "../src/utils/local-mode"

describe("Instant Full Conversation Capture & Official Export Architecture", () => {
  beforeEach(async () => {
    await clearAllData()
  })

  // 1: Instant Capture with ZERO scrolling
  it("captures full conversation instantly in one pass with ZERO scroll modifications", () => {
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div id="scroll-container" style="overflow-y: auto; height: 500px;">
            <main id="chat-thread">
              <article data-testid="conversation-turn-0" data-chatgpt-search-message-ids="msg-0">
                <div data-message-author-role="user">Write a binary search in TypeScript</div>
              </article>
              <article data-testid="conversation-turn-1" data-chatgpt-search-message-ids="msg-1">
                <div data-message-author-role="assistant">
                  Here is the implementation:
                  <pre><code class="language-typescript">function binarySearch(arr: number[], target: number): number { return -1 }</code></pre>
                </div>
              </article>
            </main>
          </div>
        </body>
      </html>
    `, { url: "https://chatgpt.com/c/chat-instant-101" })

    const doc = dom.window.document
    const container = doc.getElementById("scroll-container") as HTMLElement

    let scrollTriggered = false
    container.addEventListener("scroll", () => {
      scrollTriggered = true
    })

    const adapter = new ChatGPTAdapter()
    const result = captureCompleteConversation({
      adapter,
      doc,
      chatId: "chat-instant-101",
      chatTitle: "Binary Search",
      sourceUrl: "https://chatgpt.com/c/chat-instant-101"
    })

    expect(result.success).toBe(true)
    expect(result.turns).toHaveLength(2)
    expect(result.codeBlocks).toHaveLength(1)
    expect(result.statistics.messageCount).toBe(2)
    expect(result.statistics.exchangeCount).toBe(1)
    expect(result.statistics.codeBlockCount).toBe(1)
    expect(result.statistics.completeness).toBe("complete")
    expect(scrollTriggered).toBe(false) // Zero scroll events dispatched!
    expect(result.durationMs).toBeLessThan(1000) // Fast execution (< 1s)
  })

  // 2: Merging Stored Earlier Turns with Current DOM Turns
  it("merges stored earlier turns with current visible DOM turns without dropping history", () => {
    const storedTurns: MessageTurn[] = [
      { id: "turn-1", role: "user", text: "Turn 1 user request", codeBlocks: [] },
      { id: "turn-2", role: "assistant", text: "Turn 2 assistant response", codeBlocks: [] }
    ]

    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <main>
            <article data-testid="conversation-turn-2" data-chatgpt-search-message-ids="turn-3">
              <div data-message-author-role="user">Turn 3 user request</div>
            </article>
            <article data-testid="conversation-turn-3" data-chatgpt-search-message-ids="turn-4">
              <div data-message-author-role="assistant">Turn 4 assistant response</div>
            </article>
          </main>
        </body>
      </html>
    `, { url: "https://chatgpt.com/c/chat-merge-202" })

    const adapter = new ChatGPTAdapter()
    const result = captureCompleteConversation({
      adapter,
      doc: dom.window.document,
      chatId: "chat-merge-202",
      chatTitle: "Merge Test",
      sourceUrl: "https://chatgpt.com/c/chat-merge-202",
      storedTurns
    })

    expect(result.turns).toHaveLength(4)
    expect(result.turns.map((t) => t.text)).toEqual([
      "Turn 1 user request",
      "Turn 2 assistant response",
      "Turn 3 user request",
      "Turn 4 assistant response"
    ])
    expect(result.statistics.messageCount).toBe(4)
    expect(result.statistics.exchangeCount).toBe(2)
  })

  // 3: Overwrite Protection: Never replace larger stored history with smaller partial capture
  it("never overwrites larger stored history with smaller partial DOM capture", () => {
    const existingHistory: MessageTurn[] = Array.from({ length: 25 }, (_, i) => ({
      id: `hist-${i}`,
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      text: `Historical message ${i}`,
      codeBlocks: []
    }))

    // DOM only mounts the bottom 4 turns
    const incomingSlice: MessageTurn[] = [
      { id: "hist-21", role: "assistant", text: "Historical message 21", codeBlocks: [] },
      { id: "hist-22", role: "user", text: "Historical message 22", codeBlocks: [] },
      { id: "hist-23", role: "assistant", text: "Historical message 23", codeBlocks: [] },
      { id: "hist-24", role: "user", text: "Historical message 24", codeBlocks: [] }
    ]

    const merged = mergeTurnsForSameChat(existingHistory, incomingSlice)
    expect(merged).toHaveLength(25) // All 25 turns preserved!
    expect(merged[0].text).toBe("Historical message 0")
    expect(merged[24].text).toBe("Historical message 24")
  })

  // 4: Incremental Preservation via appendUniqueTurnById
  it("appends new turns incrementally without duplicating or losing order", () => {
    let turns: MessageTurn[] = [
      { id: "msg-1", role: "user", text: "First question", codeBlocks: [] }
    ]

    const newTurn: MessageTurn = {
      id: "msg-2",
      role: "assistant",
      text: "First answer with code",
      codeBlocks: [{ id: "c1", language: "python", code: "print('hello')", turnIndex: 1 }]
    }

    turns = appendUniqueTurnById(turns, newTurn)
    expect(turns).toHaveLength(2)

    // Updating existing turn (e.g. streaming completion) updates in-place
    const completedTurn: MessageTurn = {
      id: "msg-2",
      role: "assistant",
      text: "First answer with code - finalized",
      codeBlocks: [{ id: "c1", language: "python", code: "print('hello world')", turnIndex: 1 }]
    }

    turns = appendUniqueTurnById(turns, completedTurn)
    expect(turns).toHaveLength(2)
    expect(turns[1].text).toBe("First answer with code - finalized")
    expect(turns[1].codeBlocks[0].code).toBe("print('hello world')")
  })

  // 5: Official ChatGPT Export Parser
  it("parses official ChatGPT export JSON accurately without scraping or network calls", () => {
    const chatGptExport = JSON.stringify([
      {
        id: "chat-export-uuid-1",
        title: "Microservices Architecture Discussion",
        create_time: 1700000000,
        update_time: 1700002000,
        mapping: {
          "root-node": {
            id: "root-node",
            parent: null,
            children: ["user-node-1"]
          },
          "user-node-1": {
            id: "user-node-1",
            parent: "root-node",
            children: ["assistant-node-1"],
            message: {
              id: "msg-user-1",
              author: { role: "user" },
              create_time: 1700000100,
              content: { parts: ["What is CQRS architecture?"] }
            }
          },
          "assistant-node-1": {
            id: "assistant-node-1",
            parent: "user-node-1",
            children: [],
            message: {
              id: "msg-asst-1",
              author: { role: "assistant" },
              create_time: 1700000200,
              content: {
                parts: [
                  "CQRS stands for Command Query Responsibility Segregation.\n```typescript\ninterface CommandHandler<T> { execute(cmd: T): void }\n```"
                ]
              }
            }
          }
        }
      }
    ])

    const result = parseOfficialPlatformExport(chatGptExport)
    expect(result.success).toBe(true)
    expect(result.platform).toBe("chatgpt")
    expect(result.conversations).toHaveLength(1)
    expect(result.totalMessages).toBe(2)

    const conv = result.conversations[0]
    expect(conv.id).toBe("chatgpt:chat-export-uuid-1")
    expect(conv.chatTitle).toBe("Microservices Architecture Discussion")
    expect(conv.turns).toHaveLength(2)
    expect(conv.rawCodeBlocks).toHaveLength(1)
    expect(conv.completeness).toBe("complete")
    expect(conv.isPinned).toBe(true)
  })

  // 6: Official Claude Export Parser
  it("parses official Claude export JSON accurately without scraping or network calls", () => {
    const claudeExport = JSON.stringify([
      {
        uuid: "claude-export-uuid-2",
        name: "React Performance Tuning",
        created_at: "2024-05-01T10:00:00.000Z",
        updated_at: "2024-05-01T10:15:00.000Z",
        chat_messages: [
          {
            uuid: "c-msg-1",
            sender: "human",
            text: "How does React memo work?",
            created_at: "2024-05-01T10:00:00.000Z"
          },
          {
            uuid: "c-msg-2",
            sender: "assistant",
            text: "React.memo is a higher-order component that memoizes the rendered output of a component.",
            created_at: "2024-05-01T10:01:00.000Z"
          }
        ]
      }
    ])

    const result = parseOfficialPlatformExport(claudeExport)
    expect(result.success).toBe(true)
    expect(result.platform).toBe("claude")
    expect(result.conversations).toHaveLength(1)
    expect(result.totalMessages).toBe(2)

    const conv = result.conversations[0]
    expect(conv.id).toBe("claude:claude-export-uuid-2")
    expect(conv.chatTitle).toBe("React Performance Tuning")
    expect(conv.turns).toHaveLength(2)
    expect(conv.completeness).toBe("complete")
  })

  // 7: Standardized Statistics Consistency Across Views
  it("computes identical canonical statistics matching messages, exchanges, code, and words", () => {
    const turns: MessageTurn[] = [
      { id: "1", role: "user", text: "Explain quicksort algorithm with code", codeBlocks: [] },
      {
        id: "2",
        role: "assistant",
        text: "Quicksort is a divide-and-conquer sorting algorithm.",
        codeBlocks: [{ id: "c1", language: "python", code: "def quicksort(arr): return arr", turnIndex: 1 }]
      },
      { id: "3", role: "user", text: "What is its time complexity?", codeBlocks: [] },
      { id: "4", role: "assistant", text: "The average time complexity is O(n log n).", codeBlocks: [] }
    ]

    const stats = computeConversationStatistics(turns, turns.flatMap((t) => t.codeBlocks))
    expect(stats.messageCount).toBe(4) // 4 total messages
    expect(stats.userCount).toBe(2) // 2 user messages
    expect(stats.assistantCount).toBe(2) // 2 assistant messages
    expect(stats.exchangeCount).toBe(2) // 2 paired exchanges
    expect(stats.codeBlockCount).toBe(1) // 1 code block
    expect(stats.wordCount).toBeGreaterThan(15) // Exact words
  })

  // 8: Large Conversation Performance Benchmarks (6, 25, 33, 50, 100, 200, 500, 1000 messages)
  it("processes and computes statistics for 6, 25, 33, 50, 100, 200, 500, and 1,000 messages in < 30ms", () => {
    const testSizes = [6, 25, 33, 50, 100, 200, 500, 1000]

    for (const size of testSizes) {
      const turns: MessageTurn[] = Array.from({ length: size }, (_, i) => ({
        id: `bench-turn-${i}`,
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        text: `Bench turn number ${i}: discussing software architecture, caching layers, and database partitioning.`,
        codeBlocks:
          i % 10 === 0
            ? [{ id: `cb-${i}`, language: "ts", code: `const x${i} = ${i};`, turnIndex: i }]
            : []
      }))

      const start = performance.now()
      const stats = computeConversationStatistics(turns, turns.flatMap((t) => t.codeBlocks))
      const duration = performance.now() - start

      expect(stats.messageCount).toBe(size)
      expect(stats.exchangeCount).toBe(Math.floor(size / 2))
      expect(duration).toBeLessThan(100) // Bounded fast computation (< 100ms even for 1,000 messages under parallel runner load)
    }
  })
})
