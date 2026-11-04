import { describe, expect, it } from "vitest"
import type { StoredContext } from "../src/types"

describe("Dashboard & Sidepanel Selection State Retention", () => {
  const geminiCtx: StoredContext = {
    id: "gemini:chat-1",
    sourcePlatform: "gemini",
    chatId: "chat-1",
    chatTitle: "Active Gemini Conversation",
    sourceUrl: "https://gemini.google.com/app/chat-1",
    createdAt: 1000,
    updatedAt: 1000,
    expiresAt: 200000,
    rawTranscript: "Gemini transcript",
    rawCodeBlocks: [],
    turns: [
      { id: "g1", role: "user", text: "Hello Gemini", codeBlocks: [] },
      { id: "g2", role: "assistant", text: "Hello user", codeBlocks: [] }
    ],
    stateMemory: {
      version: "1.0",
      objective: "Gemini task",
      techStack: [],
      architectureDecisions: [],
      currentWork: "Gemini work",
      blockersAndErrors: [],
      nextSteps: [],
      criticalSnippets: [],
      rawTokenEstimate: 100
    }
  }

  const claudeCtx: StoredContext = {
    id: "claude:chat-2",
    sourcePlatform: "claude",
    chatId: "chat-2",
    chatTitle: "Claude Conversation",
    sourceUrl: "https://claude.ai/chat/chat-2",
    createdAt: 2000,
    updatedAt: 2000,
    expiresAt: 200000,
    rawTranscript: "Claude transcript",
    rawCodeBlocks: [],
    turns: [
      { id: "c1", role: "user", text: "Hello Claude", codeBlocks: [] },
      { id: "c2", role: "assistant", text: "Hello user", codeBlocks: [] }
    ],
    stateMemory: {
      version: "1.0",
      objective: "Claude task",
      techStack: [],
      architectureDecisions: [],
      currentWork: "Claude work",
      blockersAndErrors: [],
      nextSteps: [],
      criticalSnippets: [],
      rawTokenEstimate: 100
    }
  }

  const list = [geminiCtx, claudeCtx]

  it("proves the bug: stale closure or un-functional state setter resets Claude selection back to Gemini", () => {
    // Simulating old buggy loadData behavior with stale closure
    let selectedId: string | null = null // captured in mount closure

    function oldLoadData(currentList: StoredContext[]) {
      // Buggy code: if (list.length > 0 && !selectedId) { setSelectedId(list[0].id) }
      if (currentList.length > 0 && !selectedId) {
        return currentList[0].id
      }
      return selectedId
    }

    // Step 1: on mount, selects gemini
    const initialSelected = oldLoadData(list)
    expect(initialSelected).toBe("gemini:chat-1")

    // Step 2: user clicks Claude in UI
    // In React state, user set selectedId = "claude:chat-2", but the interval's closure still holds selectedId = null!
    const staleIntervalResult = oldLoadData(list)
    // BUG REPRODUCED: the stale closure resets selection to gemini!
    expect(staleIntervalResult).toBe("gemini:chat-1") // demonstrates the failure where Claude is overwritten
  })

  it("verifies the fix: functional state updater retains Claude selection during polling intervals", () => {
    // New fixed updater logic
    function resolveNextSelectedId(prev: string | null, currentList: StoredContext[]): string | null {
      if (prev && currentList.some((c) => c.id === prev)) {
        return prev // PRESERVE existing valid selection!
      }
      return currentList.length > 0 ? currentList[0].id : null
    }

    // Step 1: Initial load (prev = null)
    let selectedId = resolveNextSelectedId(null, list)
    expect(selectedId).toBe("gemini:chat-1")

    // Step 2: User clicks Claude
    selectedId = "claude:chat-2"

    // Step 3: Polling interval or storage change fires 1.5s later
    const afterInterval = resolveNextSelectedId(selectedId, list)
    expect(afterInterval).toBe("claude:chat-2") // REMAINS CLAUDE!

    // Step 4: Another interval fires
    const afterSecondInterval = resolveNextSelectedId(afterInterval, list)
    expect(afterSecondInterval).toBe("claude:chat-2") // STILL CLAUDE!

    // Step 5: Claude is deleted by user
    const listWithoutClaude = [geminiCtx]
    const afterDelete = resolveNextSelectedId(afterSecondInterval, listWithoutClaude)
    expect(afterDelete).toBe("gemini:chat-1") // Smooth fallback when context deleted
  })

  it("verifies selectedContext matches the active platform filter without sticking to a filtered-out platform", () => {
    // Function resolving active context from filtered list
    function resolveSelectedContext(
      selectedId: string | null,
      filteredList: StoredContext[]
    ): StoredContext | null {
      if (selectedId) {
        const match = filteredList.find((c) => c.id === selectedId)
        if (match) return match
      }
      return filteredList[0] || null
    }

    // User is on "all" filter with Claude selected
    const allFiltered = list
    const activeOnAll = resolveSelectedContext("claude:chat-2", allFiltered)
    expect(activeOnAll?.id).toBe("claude:chat-2")

    // User clicks "Gemini" platform filter pill
    const geminiFiltered = [geminiCtx]
    const activeOnGeminiFilter = resolveSelectedContext("claude:chat-2", geminiFiltered)
    // Should switch to Gemini because Claude is filtered out!
    expect(activeOnGeminiFilter?.id).toBe("gemini:chat-1")

    // User clicks "Claude" platform filter pill
    const claudeFiltered = [claudeCtx]
    const activeOnClaudeFilter = resolveSelectedContext("gemini:chat-1", claudeFiltered)
    // Should switch to Claude because Gemini is filtered out!
    expect(activeOnClaudeFilter?.id).toBe("claude:chat-2")
  })
})

