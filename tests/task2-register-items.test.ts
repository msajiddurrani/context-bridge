/**
 * TASK 2: Remaining register items tests (A3, A6, A11, A12)
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import { JSDOM } from "jsdom"
import { resetMockStore } from "./setup"
import {
  clearAllData,
  saveContext,
  getStoredContexts,
  togglePinContext,
  recordSaveDecision,
  getSaveTimeline,
  cleanupExpiredContexts
} from "../src/utils/storage-manager"
import { buildPreviewInjectedText } from "../src/utils/prompt-preview"
import { countExchanges, computeContextMetrics } from "../src/utils/local-mode"
import { ClaudeAdapter } from "../src/adapters/claude"
import type { MessageTurn, StoredContext, SaveDecisionCode } from "../src/types"

describe("TASK 2: Register items", () => {
  beforeEach(async () => {
    resetMockStore()
    await clearAllData()
    vi.useRealTimers()
  })

  // A3: Preview Injected Text
  it("A3: buildPreviewInjectedText builds exact string with <goal> and Ready handshake", () => {
    const ctx: StoredContext = {
      id: "chatgpt:6ad52a92-chat-A",
      sourcePlatform: "chatgpt",
      chatId: "6ad52a92-chat-A",
      chatTitle: "2+2 calculation",
      sourceUrl: "https://chatgpt.com/c/6ad52a92-chat-A",
      createdAt: Date.now() - 120000,
      updatedAt: Date.now() - 60000,
      expiresAt: Date.now() + 86400000,
      stateMemory: {
        version: "1.0",
        objective: "Compute 2+2",
        techStack: [],
        architectureDecisions: [],
        currentWork: "User: 2+2\nAssistant: 4",
        blockersAndErrors: [],
        nextSteps: [],
        criticalSnippets: [],
        rawTokenEstimate: 10
      },
      rawCodeBlocks: [],
      turns: [
        { id: "msg-1", role: "user", text: "Compute 2+2", codeBlocks: [] },
        { id: "msg-2", role: "assistant", text: "4", codeBlocks: [] }
      ]
    }

    const preview = buildPreviewInjectedText(ctx, "claude", "compact", "xml")
    expect(preview).toContain('<ctx from="chatgpt"')
    expect(preview).toContain('Reply "Ready" in one word, then wait for my next message.')
    expect(preview).toContain("<goal>Compute 2+2</goal>")
    expect(preview).toContain("</ctx>")

    const mdPreview = buildPreviewInjectedText(ctx, "claude", "compact")
    expect(mdPreview).toContain("=== [CONTEXT BRIDGE: HANDOVER FROM CHATGPT] ===")
    expect(mdPreview).toContain('Reply with **"Ready"** in one single word')
    expect(mdPreview).toContain("## 🎯 Conversation Objective\nCompute 2+2")
  })

  // A6: Pinned context never expires (mocked clock test)
  it("A6: pinned context never expires after 24h TTL passes", async () => {
    const now = 1700000000000
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const ctx: StoredContext = {
      id: "claude:pinned-chat-1",
      sourcePlatform: "claude",
      chatId: "pinned-chat-1",
      chatTitle: "Important Architecture",
      sourceUrl: "https://claude.ai/chat/pinned-chat-1",
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 24 * 3600 * 1000, // 24h TTL
      isPinned: true,
      stateMemory: {
        version: "1.0",
        objective: "Architecture design",
        techStack: [],
        architectureDecisions: [],
        currentWork: "",
        blockersAndErrors: [],
        nextSteps: [],
        criticalSnippets: [],
        rawTokenEstimate: 50
      },
      rawCodeBlocks: [],
      turns: [
        { id: "m-1", role: "user", text: "Design system", codeBlocks: [] },
        { id: "m-2", role: "assistant", text: "System designed", codeBlocks: [] }
      ]
    }

    await saveContext(ctx)

    // Advance clock by 48 hours (well beyond 24h)
    vi.setSystemTime(now + 48 * 3600 * 1000)

    // Run cleanup
    const pruneRes = await cleanupExpiredContexts()
    expect(pruneRes.prunedCount).toBe(0)

    // Context must still be retrieved
    const contexts = await getStoredContexts()
    expect(contexts.some((c) => c.id === "claude:pinned-chat-1")).toBe(true)

    // Now unpin and test that it DOES prune
    await togglePinContext("claude:pinned-chat-1")
    const pruneResAfterUnpin = await cleanupExpiredContexts()
    expect(pruneResAfterUnpin.prunedCount).toBe(1)

    const remaining = await getStoredContexts()
    expect(remaining.some((c) => c.id === "claude:pinned-chat-1")).toBe(false)
  })

  // A11: Shared exchange count and token estimate on Claude-shaped fixture
  it("A11: computeContextMetrics calculates exact exchange count and token estimate on Claude fixture", () => {
    const adapter = new ClaudeAdapter()
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div data-testid="user-message" class="font-user-message">
            <p>apple ke fayde</p>
          </div>
          <div data-testid="assistant-message" class="font-claude-message">
            <span class="sr-only">Claude responded: </span>
            <p>Apple khane ke kai fayde hain.</p>
          </div>
        </body>
      </html>
    `, { url: "https://claude.ai/chat/claude-apple-123" })

    const turns = adapter.getMessages(dom.window.document)
    expect(turns.length).toBe(2)

    const metrics = computeContextMetrics(turns, [], "apple ke fayde")
    expect(metrics.exchangeCount).toBe(1)
    expect(metrics.tokenEstimate).toBeGreaterThan(0)
  })

  // A12: Confirm Save Timeline decision codes
  it("A12: writes each save decision code to Save Timeline", async () => {
    const codes: SaveDecisionCode[] = [
      "saved",
      "updated",
      "skipped-no-chat-id",
      "skipped-foreign-turns",
      "skipped-no-turns",
      "migrated",
      "merged",
      "skipped-placeholder",
      "skipped-handshake"
    ]

    for (let i = 0; i < codes.length; i++) {
      await recordSaveDecision({
        id: `dec-code-${i}`,
        timestamp: Date.now() + i,
        chatKey: `chatgpt:chat-${i}`,
        decision: codes[i],
        reason: `Testing decision code ${codes[i]}`,
        navMechanism: "test",
        turnsCount: i
      })
    }

    const timeline = await getSaveTimeline()
    expect(timeline.length).toBe(codes.length)
    codes.forEach((code) => {
      expect(timeline.some((t) => t.decision === code)).toBe(true)
    })
  })

  it("mergeTurnsForSameChat preserves virtualized earlier turns when later turns overlap", async () => {
    const { mergeTurnsForSameChat } = await import("../src/utils/local-mode")
    const existing: MessageTurn[] = [
      { id: "msg-1", role: "user", text: "Turn 1 question", codeBlocks: [] },
      { id: "msg-2", role: "assistant", text: "Turn 1 answer", codeBlocks: [] },
      { id: "msg-3", role: "user", text: "Turn 2 question", codeBlocks: [] }
    ]
    const incoming: MessageTurn[] = [
      { id: "msg-3", role: "user", text: "Turn 2 question", codeBlocks: [] },
      { id: "msg-4", role: "assistant", text: "Turn 2 answer", codeBlocks: [] }
    ]

    const merged = mergeTurnsForSameChat(existing, incoming)
    expect(merged.length).toBe(4)
    expect(merged[0].id).toBe("msg-1")
    expect(merged[3].id).toBe("msg-4")
  })

  it("mergeTurnsForSameChat prepends earlier turns in strict chronological order when scrolling up on an old past chat", async () => {
    const { mergeTurnsForSameChat } = await import("../src/utils/local-mode")
    // User opened old chat at the bottom: only recent turns loaded
    const existingAtBottom: MessageTurn[] = [
      { id: "msg-3", role: "user", text: "Turn 2 question", codeBlocks: [] },
      { id: "msg-4", role: "assistant", text: "Turn 2 answer", codeBlocks: [] }
    ]
    // User scrolled up: earlier turns now mounted in DOM
    const incomingFromTop: MessageTurn[] = [
      { id: "msg-1", role: "user", text: "Turn 1 question", codeBlocks: [] },
      { id: "msg-2", role: "assistant", text: "Turn 1 answer", codeBlocks: [] },
      { id: "msg-3", role: "user", text: "Turn 2 question", codeBlocks: [] }
    ]

    const merged = mergeTurnsForSameChat(existingAtBottom, incomingFromTop)
    expect(merged.length).toBe(4)
    expect(merged[0].id).toBe("msg-1")
    expect(merged[1].id).toBe("msg-2")
    expect(merged[2].id).toBe("msg-3")
    expect(merged[3].id).toBe("msg-4")
    // Crucial: The objective must come from the true first turn, not the middle turn!
    expect(merged[0].text).toBe("Turn 1 question")
  })

  it("mergeTurnsForSameChat replaces instead of appending when conversations are completely disjoint", async () => {
    const { mergeTurnsForSameChat } = await import("../src/utils/local-mode")
    const existing: MessageTurn[] = [
      { id: "chat1-u1", role: "user", text: "what are the top trendy games from 2000-2026", codeBlocks: [] },
      { id: "chat1-a1", role: "assistant", text: "Here are the top trendy games...", codeBlocks: [] }
    ]
    const incoming: MessageTurn[] = [
      { id: "chat2-u1", role: "user", text: "who is aariz", codeBlocks: [] },
      { id: "chat2-a1", role: "assistant", text: "Aariz is an Arabic name meaning...", codeBlocks: [] }
    ]

    const merged = mergeTurnsForSameChat(existing, incoming)
    expect(merged.length).toBe(2)
    expect(merged[0].text).toBe("who is aariz")
    expect(merged[1].text).toContain("Aariz is an Arabic name")
    expect(merged.some((t) => t.text.includes("trendy games"))).toBe(false)
  })
})

