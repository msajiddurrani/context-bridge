import { describe, it, expect, beforeEach } from "vitest"
import { resetMockStore } from "./setup"
import {
  filterTurnsByMessageOwnership,
  recordSaveDecision,
  getSaveTimeline
} from "../src/utils/storage-manager"
import type { MessageTurn } from "../src/types"

describe("Diagnostic Form #3 - Logging for skipped-foreign-turns and saved decisions", () => {
  beforeEach(() => {
    resetMockStore()
  })

  it("records diagnostic fields on skipped-foreign-turns without logging message text", async () => {
    // 1. Initial turn owned by Chat A
    const turnA: MessageTurn = {
      id: "msg-1234",
      role: "user",
      text: "Secret user message that should never appear in diagnostics",
      codeBlocks: [],
      idSourceAttr: "data-chatgpt-search-message-ids"
    }

    const firstSave = await filterTurnsByMessageOwnership([turnA], "chat-a")
    expect(firstSave.validTurns.length).toBe(1)
    expect(firstSave.foreignCount).toBe(0)

    // 2. Chat B presents the same turn ID (colliding turn)
    const turnB: MessageTurn = {
      id: "msg-1234",
      role: "user",
      text: "Another secret prompt",
      codeBlocks: [],
      idSourceAttr: "data-chatgpt-search-message-ids"
    }

    const secondSave = await filterTurnsByMessageOwnership([turnB], "chat-b")
    expect(secondSave.validTurns.length).toBe(0)
    expect(secondSave.foreignCount).toBe(1)
    expect(secondSave.totalReceived).toBe(1)
    expect(secondSave.totalKept).toBe(0)
    expect(secondSave.droppedTurns.length).toBe(1)

    const dropped = secondSave.droppedTurns[0]
    expect(dropped.turnId).toBe("msg-1234")
    expect(dropped.idSourceAttr).toBe("data-chatgpt-search-message-ids")
    expect(dropped.role).toBe("user")
    expect(dropped.storedOwnerChatId).toBe("chat-a")
    expect(dropped.currentChatId).toBe("chat-b")
    expect(dropped.textLength).toBe("Another secret prompt".length)
    // Security check: ensure text property does NOT exist on DroppedTurnDiagnostic
    expect((dropped as any).text).toBeUndefined()

    // 3. Record skipped-foreign-turns save decision
    await recordSaveDecision({
      id: "dec-test-1",
      timestamp: Date.now(),
      chatKey: "chatgpt:chat-b",
      decision: "skipped-foreign-turns",
      reason: `Skipped: all turns belong to another chat (dropped ${secondSave.foreignCount} foreign turns)`,
      navMechanism: "observer",
      turnsCount: 0,
      receivedTurnsCount: secondSave.totalReceived,
      keptTurnsCount: secondSave.totalKept,
      droppedTurns: secondSave.droppedTurns
    })

    const timeline = await getSaveTimeline()
    expect(timeline.length).toBe(1)
    const event = timeline[0]
    expect(event.decision).toBe("skipped-foreign-turns")
    expect(event.receivedTurnsCount).toBe(1)
    expect(event.keptTurnsCount).toBe(0)
    expect(event.droppedTurns).toBeDefined()
    expect(event.droppedTurns?.length).toBe(1)
    expect(event.droppedTurns?.[0].turnId).toBe("msg-1234")
    expect(event.droppedTurns?.[0].idSourceAttr).toBe("data-chatgpt-search-message-ids")
    expect(event.droppedTurns?.[0].storedOwnerChatId).toBe("chat-a")
    expect(event.droppedTurns?.[0].currentChatId).toBe("chat-b")
    expect(event.droppedTurns?.[0].textLength).toBe("Another secret prompt".length)
    // Security check: ensure raw text was not logged
    expect(JSON.stringify(event)).not.toContain("Another secret prompt")
  })
})
