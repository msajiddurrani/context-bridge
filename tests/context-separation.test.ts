import { beforeEach, describe, expect, it } from "vitest"
import { resetMockStore } from "./setup"
import {
  clearAllData,
  getStoredContexts,
  getTokenTelemetry,
  recordTokenUsage,
  saveContext
} from "../src/utils/storage-manager"
import { handleAutoSave } from "../src/background"
import { ChatGPTAdapter } from "../src/adapters/chatgpt"
import { ClaudeAdapter } from "../src/adapters/claude"
import { buildLocalStateMemory } from "../src/utils/local-mode"
import { formatStateMemoryPrompt } from "../src/utils/prompt-formatter"
import { diagnoseContexts } from "../src/utils/context-filter"
import type { MessageTurn, StoredContext } from "../src/types"

describe("Context Separation & Independent Goal Computation (Chat A vs Chat B)", () => {
  beforeEach(async () => {
    resetMockStore()
    await clearAllData()
  })

  it("chat A (9387+9878) then chat B (Banana khanay ky faiday) in the same tab without reload gives two separate entries with their own goal, turns and count", async () => {
    // 1. In ONE tab, user starts Chat A: "what is 9387+9878"
    const chatASessionId = "session_tab_chatgpt_1700000001_aaa"
    const chatAPermalinkId = "6ad4dbd4-chat-a-arithmetic"
    const chatATurns: MessageTurn[] = [
      {
        id: "turn-a-1",
        role: "user",
        text: "what is 9387+9878",
        codeBlocks: []
      },
      {
        id: "turn-a-2",
        role: "assistant",
        text: "9387 + 9878 = 19265.",
        codeBlocks: []
      }
    ]

    const saveResultA = await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: chatAPermalinkId,
      chatTitle: "Arithmetic calculation",
      sourceUrl: `https://chatgpt.com/c/${chatAPermalinkId}`,
      clientSessionId: chatASessionId,
      rawTranscript: "User: what is 9387+9878\nAssistant: 19265",
      rawCodeBlocks: [],
      turns: chatATurns
    })

    expect(saveResultA.success).toBe(true)

    let stored = await getStoredContexts()
    expect(stored.length).toBe(1)
    const entryA = stored[0]
    expect(entryA.id).toBe(`chatgpt:${chatAPermalinkId}`)
    expect(entryA.chatTitle).toBe("Arithmetic calculation")
    expect(entryA.stateMemory.objective).toContain("what is 9387+9878")
    expect(entryA.exchangeCount).toBe(1)
    expect(entryA.turns?.length).toBe(2)

    // 2. In the SAME tab without reload, user navigates to /new and starts Chat B: "Banana khanay ky faiday"
    // Temporary session ID is reset for the new chat
    const chatBSessionId = "session_tab_chatgpt_1700000099_bbb"
    const chatBPermalinkId = "6ad4dbd4-e63c-83e8-b30e-971042671ad1"
    const chatBTurns: MessageTurn[] = [
      {
        id: "turn-b-1",
        role: "user",
        text: "Banana khanay ky faiday",
        codeBlocks: []
      },
      {
        id: "turn-b-2",
        role: "assistant",
        text: "Banana khanay ke bohat se faidai hain. 1. Energy barhata hai...",
        codeBlocks: []
      }
    ]

    const saveResultB = await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: chatBPermalinkId,
      chatTitle: "Banana khanay ky faiday",
      sourceUrl: `https://chatgpt.com/c/${chatBPermalinkId}`,
      clientSessionId: chatBSessionId,
      rawTranscript: "User: Banana khanay ky faiday\nAssistant: Banana ke faiday...",
      rawCodeBlocks: [],
      turns: chatBTurns
    })

    expect(saveResultB.success).toBe(true)

    // 3. Assert: Storage must contain TWO separate entries with independent goals and turns
    stored = await getStoredContexts()
    expect(stored.length).toBe(2)

    const storedA = stored.find((c) => c.chatId === chatAPermalinkId)
    const storedB = stored.find((c) => c.chatId === chatBPermalinkId)

    expect(storedA).toBeDefined()
    expect(storedB).toBeDefined()

    // Chat A assertions
    expect(storedA?.chatTitle).toBe("Arithmetic calculation")
    expect(storedA?.stateMemory.objective).toBe("what is 9387+9878")
    expect(storedA?.exchangeCount).toBe(1)
    expect(storedA?.turns?.length).toBe(2)
    expect(storedA?.stateMemory.currentWork).toContain("what is 9387+9878")
    expect(storedA?.stateMemory.currentWork).not.toContain("Banana")

    // Chat B assertions: INVARIANTS: NO CHAT A TURNS OR GOAL LEAKAGE!
    expect(storedB?.chatTitle).toBe("Banana khanay ky faiday")
    expect(storedB?.stateMemory.objective).toBe("Banana khanay ky faiday")
    expect(storedB?.stateMemory.objective).not.toContain("9387+9878")
    expect(storedB?.exchangeCount).toBe(1) // NOT 2!
    expect(storedB?.turns?.length).toBe(2) // NOT 4!
    expect(storedB?.stateMemory.currentWork).toContain("Banana")
    expect(storedB?.stateMemory.currentWork).not.toContain("9387+9878")
  })

  it("chat A then chat B on Claude in the same tab without reload gives two separate entries", async () => {
    // 1. Chat A on Claude
    const chatAId = "claude-uuid-auth-111"
    const chatATurns: MessageTurn[] = [
      { id: "c-a-1", role: "user", text: "Write an auth middleware in Express", codeBlocks: [] },
      { id: "c-a-2", role: "assistant", text: "Here is the auth middleware function...", codeBlocks: [] }
    ]

    await handleAutoSave({
      sourcePlatform: "claude",
      chatId: chatAId,
      chatTitle: "Express Auth Middleware",
      sourceUrl: `https://claude.ai/chat/${chatAId}`,
      clientSessionId: "session_claude_111",
      rawTranscript: "User: Write auth middleware\nAssistant: Here is...",
      rawCodeBlocks: [],
      turns: chatATurns
    })

    // 2. Chat B on Claude in the SAME tab without reload
    const chatBId = "claude-uuid-css-222"
    const chatBTurns: MessageTurn[] = [
      { id: "c-b-1", role: "user", text: "Explain CSS grid layout", codeBlocks: [] },
      { id: "c-b-2", role: "assistant", text: "CSS Grid is a 2D layout system...", codeBlocks: [] }
    ]

    await handleAutoSave({
      sourcePlatform: "claude",
      chatId: chatBId,
      chatTitle: "CSS Grid Layout",
      sourceUrl: `https://claude.ai/chat/${chatBId}`,
      clientSessionId: "session_claude_222",
      rawTranscript: "User: Explain CSS grid\nAssistant: 2D system...",
      rawCodeBlocks: [],
      turns: chatBTurns
    })

    const stored = await getStoredContexts()
    expect(stored.length).toBe(2)

    const storedA = stored.find((c) => c.chatId === chatAId)
    const storedB = stored.find((c) => c.chatId === chatBId)

    expect(storedA?.stateMemory.objective).toContain("auth middleware")
    expect(storedB?.stateMemory.objective).toContain("CSS grid")
    expect(storedB?.stateMemory.objective).not.toContain("auth middleware")
    expect(storedB?.exchangeCount).toBe(1)
    expect(storedB?.turns?.length).toBe(2)
  })

  it("ignores placeholder titles ('Claude', 'ChatGPT') and does NOT save entries without real turns or title", async () => {
    // Attempt to save a chat where turns are just placeholder "Claude" (e.g. from doc.title or UI element)
    const resultClaude = await handleAutoSave({
      sourcePlatform: "claude",
      chatId: "claude-uuid-placeholder-1",
      chatTitle: "Claude",
      sourceUrl: "https://claude.ai/chat/claude-uuid-placeholder-1",
      rawTranscript: "User: Claude\nAssistant: Claude",
      rawCodeBlocks: [],
      turns: [{ id: "t1", role: "user", text: "Claude", codeBlocks: [] }]
    })

    expect(resultClaude.success).toBe(false)
    expect(resultClaude.error).toBe("NO_REAL_TITLE_OR_TURNS")

    // Attempt to save a chat where turns are just placeholder "ChatGPT"
    const resultGpt = await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: "chatgpt-uuid-placeholder-2",
      chatTitle: "ChatGPT",
      sourceUrl: "https://chatgpt.com/c/chatgpt-uuid-placeholder-2",
      rawTranscript: "User: ChatGPT\nAssistant: ChatGPT",
      rawCodeBlocks: [],
      turns: [{ id: "t2", role: "user", text: "ChatGPT", codeBlocks: [] }]
    })

    expect(resultGpt.success).toBe(false)
    expect(resultGpt.error).toBe("NO_REAL_TITLE_OR_TURNS")

    // Storage must remain completely empty
    const stored = await getStoredContexts()
    expect(stored.length).toBe(0)
  })

  it("navigation from /new to /c/<id> saves nothing on /new and exactly one entry on permalink", async () => {
    const permalinkChatId = "6ad4dbd4-real-permalink-uuid"

    // 1. Chat starts on /new - must NOT save any temporary session entries (Phase 2 Requirement 1)
    const tempTurns: MessageTurn[] = [
      { id: "t-1", role: "user", text: "Banana khanay ky faiday", codeBlocks: [] },
      { id: "t-2", role: "assistant", text: "Banana ke faiday...", codeBlocks: [] }
    ]

    const resultNew = await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: "",
      chatTitle: "Banana khanay ky faiday",
      sourceUrl: "https://chatgpt.com/",
      rawTranscript: "User: Banana khanay ky faiday\nAssistant: Banana...",
      rawCodeBlocks: [],
      turns: tempTurns
    })

    expect(resultNew.success).toBe(false)
    expect(resultNew.error).toBe("NO_REAL_CHAT_ID")

    let stored = await getStoredContexts()
    expect(stored.length).toBe(0) // Nothing saved on /new!

    // 2. Chat gets permalink /c/<id>
    const resultPermalink = await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: permalinkChatId,
      chatTitle: "Banana khanay ky faiday",
      sourceUrl: `https://chatgpt.com/c/${permalinkChatId}`,
      rawTranscript: "User: Banana khanay ky faiday\nAssistant: Banana...",
      rawCodeBlocks: [],
      turns: tempTurns
    })

    expect(resultPermalink.success).toBe(true)

    // 3. Exactly ONE entry saved in storage with real permalink
    stored = await getStoredContexts()
    expect(stored.length).toBe(1)
    expect(stored[0].chatId).toBe(permalinkChatId)
    expect(stored[0].id).toBe(`chatgpt:${permalinkChatId}`)
    expect(stored[0].stateMemory.objective).toBe("Banana khanay ky faiday")
  })

  it("always emits a <goal> tag in formatStateMemoryPrompt", () => {
    // Test with explicit objective
    const memWithGoal = buildLocalStateMemory([
      { id: "1", role: "user", text: "Banana khanay ky faiday", codeBlocks: [] },
      { id: "2", role: "assistant", text: "Faiday...", codeBlocks: [] }
    ])
    const promptWithGoal = formatStateMemoryPrompt(memWithGoal, "chatgpt")
    expect(promptWithGoal).toContain("<goal>Banana khanay ky faiday</goal>")

    // Test with missing/empty objective: falls back to first user turn or active conversation
    const memEmpty: any = {
      version: "1.0",
      objective: "",
      techStack: [],
      architectureDecisions: [],
      currentWork: "User: what is 9387+9878\nAssistant: 19265",
      blockersAndErrors: [],
      nextSteps: [],
      criticalSnippets: [],
      rawTokenEstimate: 10
    }
    const promptFallback = formatStateMemoryPrompt(memEmpty, "chatgpt")
    expect(promptFallback).toContain("<goal>what is 9387+9878</goal>")

    // Test with completely blank memory: must STILL emit <goal> tag!
    const memBlank: any = {
      version: "1.0",
      objective: "",
      techStack: [],
      architectureDecisions: [],
      currentWork: "",
      blockersAndErrors: [],
      nextSteps: [],
      criticalSnippets: [],
      rawTokenEstimate: 0
    }
    const promptBlank = formatStateMemoryPrompt(memBlank, "chatgpt")
    expect(promptBlank).toContain("<goal>Active conversation</goal>")
  })

  it("API tokens today and last call strictly stay 0 in local mode", async () => {
    // In local mode (no API key configured)
    const telemetry = await getTokenTelemetry()
    expect(telemetry.tokensToday).toBe(0)
    expect(telemetry.lastCallTokens).toBe(0)

    // Attempting to record token usage without an API key must not inflate counts
    const updated = await recordTokenUsage(500)
    expect(updated.tokensToday).toBe(0)
    expect(updated.lastCallTokens).toBe(0)
  })

  it("Diagnostics provides per context: chatId, turn count, goal, and source of each turn", () => {
    const mockContext: StoredContext = {
      id: "chatgpt:6ad4dbd4-banana",
      sourcePlatform: "chatgpt",
      chatId: "6ad4dbd4-banana",
      chatTitle: "Banana khanay ky faiday",
      sourceUrl: "https://chatgpt.com/c/6ad4dbd4-banana",
      clientSessionId: "session_banana_123",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: Date.now() + 86400000,
      stateMemory: {
        version: "1.0",
        objective: "Banana khanay ky faiday",
        techStack: [],
        architectureDecisions: [],
        currentWork: "User: Banana\nAssistant: Faiday",
        blockersAndErrors: [],
        nextSteps: [],
        criticalSnippets: [],
        rawTokenEstimate: 20
      },
      rawCodeBlocks: [],
      turns: [
        { id: "t1", role: "user", text: "Banana khanay ky faiday", codeBlocks: [] },
        { id: "t2", role: "assistant", text: "Banana ke faiday...", codeBlocks: [] }
      ],
      exchangeCount: 1,
      summaryMode: "local"
    }

    const diagnostics = diagnoseContexts([mockContext], "claude", "chat-1", false, {})
    expect(diagnostics.totalStored).toBe(1)

    const diagItem = diagnostics.items[0]
    expect(diagItem.chatId).toBe("6ad4dbd4-banana")
    expect(diagItem.turnsCount).toBe(2)
    expect(diagItem.goal).toBe("Banana khanay ky faiday")

    // Source of each turn
    expect(diagItem.turnsBreakdown.length).toBe(2)
    expect(diagItem.turnsBreakdown[0].sourceChatId).toBe("6ad4dbd4-banana")
    expect(diagItem.turnsBreakdown[0].role).toBe("user")
    expect(diagItem.turnsBreakdown[0].preview).toContain("Banana khanay ky faiday")
    expect(diagItem.turnsBreakdown[1].sourceChatId).toBe("6ad4dbd4-banana")
    expect(diagItem.turnsBreakdown[1].role).toBe("assistant")
  })

  it("Chat A ('2+2') then New chat B ('banana ke fayde') then back to Chat A in ChatGPT gives two separate entries without overwrite", async () => {
    // 1. User starts Chat A ("what is 2+2") on ChatGPT
    const chatASessionId = "session_tab_chatgpt_a"
    const chatAPermalinkId = "chat-a-uuid-arithmetic"
    const chatATurns1: MessageTurn[] = [
      { id: "a-1", role: "user", text: "what is 2+2", codeBlocks: [] },
      { id: "a-2", role: "assistant", text: "2 + 2 = 4", codeBlocks: [] }
    ]

    const saveA1 = await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: chatAPermalinkId,
      chatTitle: "Arithmetic 2+2",
      sourceUrl: `https://chatgpt.com/c/${chatAPermalinkId}`,
      clientSessionId: chatASessionId,
      rawTranscript: "User: what is 2+2\nAssistant: 4",
      rawCodeBlocks: [],
      turns: chatATurns1
    })

    expect(saveA1.success).toBe(true)
    let stored = await getStoredContexts()
    expect(stored.length).toBe(1)
    expect(stored[0].chatId).toBe(chatAPermalinkId)
    expect(stored[0].chatTitle).toBe("Arithmetic 2+2")
    expect(stored[0].stateMemory.objective).toBe("what is 2+2")

    // 2. User opens New chat B ("banana ke fayde") in the SAME tab/session
    const chatBSessionId = "session_tab_chatgpt_b"
    expect(chatBSessionId).not.toBe(chatASessionId)

    // ChatGPTAdapter.getChatId("https://chatgpt.com/") returns "" (NOT Chat A's ID)
    const chatgptAdapter = new ChatGPTAdapter()
    const newChatId = chatgptAdapter.getChatId("https://chatgpt.com/")
    expect(newChatId).toBe("")

    const chatBTurns: MessageTurn[] = [
      { id: "b-1", role: "user", text: "banana ke fayde", codeBlocks: [] },
      { id: "b-2", role: "assistant", text: "Banana khanay ke fayde: 1. Energy barhata hai...", codeBlocks: [] }
    ]

    // Initial save while on /new before permalink is minted returns NO_REAL_CHAT_ID
    const saveBTemp = await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: newChatId,
      chatTitle: "",
      sourceUrl: "https://chatgpt.com/",
      clientSessionId: chatBSessionId,
      rawTranscript: "User: banana ke fayde\nAssistant: Banana khanay ke fayde...",
      rawCodeBlocks: [],
      turns: chatBTurns
    })

    expect(saveBTemp.success).toBe(false)
    expect(saveBTemp.error).toBe("NO_REAL_CHAT_ID")
    stored = await getStoredContexts()
    expect(stored.length).toBe(1) // Only Chat A is in storage; no temporary entries

    // Now ChatGPT assigns a real permalink /c/<id> to Chat B
    const chatBPermalinkId = "chat-b-uuid-banana"
    const saveBPermalink = await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: chatBPermalinkId,
      chatTitle: "Banana ke fayde",
      sourceUrl: `https://chatgpt.com/c/${chatBPermalinkId}`,
      clientSessionId: chatBSessionId,
      rawTranscript: "User: banana ke fayde\nAssistant: Banana khanay ke fayde...",
      rawCodeBlocks: [],
      turns: chatBTurns
    })

    expect(saveBPermalink.success).toBe(true)
    stored = await getStoredContexts()
    // Exactly TWO entries: Chat A permalink and Chat B permalink (temporary entry was migrated and deleted)
    expect(stored.length).toBe(2)

    // 3. User navigates BACK to Chat A in the SAME tab/session and sends follow-up
    const chatATurns2: MessageTurn[] = [
      ...chatATurns1,
      { id: "a-3", role: "user", text: "now add 3 to it", codeBlocks: [] },
      { id: "a-4", role: "assistant", text: "4 + 3 = 7", codeBlocks: [] }
    ]

    const saveA2 = await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: chatAPermalinkId,
      chatTitle: "Arithmetic 2+2",
      sourceUrl: `https://chatgpt.com/c/${chatAPermalinkId}`,
      clientSessionId: chatASessionId,
      rawTranscript: "User: what is 2+2\nAssistant: 4\nUser: now add 3 to it\nAssistant: 7",
      rawCodeBlocks: [],
      turns: chatATurns2
    })

    expect(saveA2.success).toBe(true)

    // 4. Verification: Storage STILL contains exactly TWO separate entries
    stored = await getStoredContexts()
    expect(stored.length).toBe(2)

    const entryA = stored.find((c) => c.chatId === chatAPermalinkId)
    const entryB = stored.find((c) => c.chatId === chatBPermalinkId)

    expect(entryA).toBeDefined()
    expect(entryB).toBeDefined()

    // Chat A assertions
    expect(entryA?.chatTitle).toBe("Arithmetic 2+2")
    expect(entryA?.stateMemory.objective).toBe("what is 2+2")
    expect(entryA?.exchangeCount).toBe(2)
    expect(entryA?.turns?.length).toBe(4)
    expect(entryA?.stateMemory.currentWork).toContain("2+2")
    expect(entryA?.stateMemory.currentWork).toContain("now add 3 to it")
    expect(entryA?.stateMemory.currentWork).not.toContain("banana")
    expect(entryA?.lastSaveDiagnostic?.tempId).toBe("none")
    expect(entryA?.lastSaveDiagnostic?.realChatId).toBe(chatAPermalinkId)
    expect(entryA?.lastSaveDiagnostic?.matchedEntryId).toBe(`chatgpt:${chatAPermalinkId}`)

    // Chat B assertions: INVARIANTS: NO Chat A text, NO overwrite, independent title and goal!
    expect(entryB?.chatTitle).toBe("Banana ke fayde")
    expect(entryB?.stateMemory.objective).toBe("banana ke fayde")
    expect(entryB?.stateMemory.objective).not.toContain("2+2")
    expect(entryB?.exchangeCount).toBe(1)
    expect(entryB?.turns?.length).toBe(2)
    expect(entryB?.stateMemory.currentWork).toContain("banana")
    expect(entryB?.stateMemory.currentWork).not.toContain("2+2")
    expect(entryB?.lastSaveDiagnostic?.realChatId).toBe(chatBPermalinkId)
    expect(entryB?.lastSaveDiagnostic?.matchedEntryId).toBe(`chatgpt:${chatBPermalinkId}`)
  })

  it("Chat A then New chat B then back to Chat A in Claude gives two separate entries without overwrite", async () => {
    const claudeAdapter = new ClaudeAdapter()

    // 1. Chat A on Claude: "Express Auth Middleware"
    const chatASessionId = "session_tab_claude_a"
    const chatAPermalinkId = "claude-uuid-auth-999"
    const chatATurns1: MessageTurn[] = [
      { id: "ca-1", role: "user", text: "Create an Express authentication middleware", codeBlocks: [] },
      { id: "ca-2", role: "assistant", text: "Here is the auth middleware...", codeBlocks: [] }
    ]

    await handleAutoSave({
      sourcePlatform: "claude",
      chatId: chatAPermalinkId,
      chatTitle: "Express Auth Middleware",
      sourceUrl: `https://claude.ai/chat/${chatAPermalinkId}`,
      clientSessionId: chatASessionId,
      rawTranscript: "User: Create Express auth\nAssistant: Here is...",
      rawCodeBlocks: [],
      turns: chatATurns1
    })

    // 2. User opens New chat B: "CSS Grid Layout"
    const chatBSessionId = "session_tab_claude_b"
    expect(chatBSessionId).not.toBe(chatASessionId)
    expect(claudeAdapter.getChatId("https://claude.ai/new", {} as any)).toBe("")

    const chatBTurns: MessageTurn[] = [
      { id: "cb-1", role: "user", text: "Explain CSS Grid Layout in depth", codeBlocks: [] },
      { id: "cb-2", role: "assistant", text: "CSS Grid is a two-dimensional layout system...", codeBlocks: [] }
    ]

    const chatBPermalinkId = "claude-uuid-grid-888"
    await handleAutoSave({
      sourcePlatform: "claude",
      chatId: chatBPermalinkId,
      chatTitle: "CSS Grid Layout",
      sourceUrl: `https://claude.ai/chat/${chatBPermalinkId}`,
      clientSessionId: chatBSessionId,
      rawTranscript: "User: Explain CSS Grid\nAssistant: CSS Grid is...",
      rawCodeBlocks: [],
      turns: chatBTurns
    })

    // 3. User navigates back to Chat A on Claude
    const chatATurns2: MessageTurn[] = [
      ...chatATurns1,
      { id: "ca-3", role: "user", text: "Now add JWT refresh token rotation", codeBlocks: [] },
      { id: "ca-4", role: "assistant", text: "Here is the refresh token rotation logic...", codeBlocks: [] }
    ]

    await handleAutoSave({
      sourcePlatform: "claude",
      chatId: chatAPermalinkId,
      chatTitle: "Express Auth Middleware",
      sourceUrl: `https://claude.ai/chat/${chatAPermalinkId}`,
      clientSessionId: chatASessionId,
      rawTranscript: "User: Create Express auth...\nUser: Now add JWT refresh...",
      rawCodeBlocks: [],
      turns: chatATurns2
    })

    // 4. Assert: Exactly TWO separate entries in storage, no contamination
    const stored = await getStoredContexts()
    expect(stored.length).toBe(2)

    const entryA = stored.find((c) => c.chatId === chatAPermalinkId)
    const entryB = stored.find((c) => c.chatId === chatBPermalinkId)

    expect(entryA?.stateMemory.objective).toContain("Express authentication")
    expect(entryA?.stateMemory.currentWork).toContain("JWT refresh token")
    expect(entryA?.stateMemory.currentWork).not.toContain("CSS Grid")

    expect(entryB?.stateMemory.objective).toContain("CSS Grid Layout")
    expect(entryB?.stateMemory.currentWork).toContain("two-dimensional")
    expect(entryB?.stateMemory.currentWork).not.toContain("Express authentication")
  })

  it("migrateTemporarySessions strictly migrates only temporary entries of the current session and never touches real chatId entries", async () => {
    // Context with real permalink
    const realContext: StoredContext = {
      id: "chatgpt:6ad4dbd4-existing-permalink",
      sourcePlatform: "chatgpt",
      chatId: "6ad4dbd4-existing-permalink",
      chatTitle: "Perm chat",
      sourceUrl: "https://chatgpt.com/c/6ad4dbd4-existing-permalink",
      clientSessionId: "session_shared_token_999",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: Date.now() + 86400000,
      stateMemory: {
        version: "1.0",
        objective: "Perm goal",
        techStack: [],
        architectureDecisions: [],
        currentWork: "",
        blockersAndErrors: [],
        nextSteps: [],
        criticalSnippets: [],
        rawTokenEstimate: 10
      },
      rawCodeBlocks: [],
      turns: [{ id: "t1", role: "user", text: "Perm goal", codeBlocks: [] }],
      exchangeCount: 1,
      summaryMode: "local"
    }

    // Ephemeral temporary context
    const tempContext: StoredContext = {
      id: "chatgpt:session_shared_token_999",
      sourcePlatform: "chatgpt",
      chatId: "session_shared_token_999",
      chatTitle: "Temp chat",
      sourceUrl: "https://chatgpt.com/",
      clientSessionId: "session_shared_token_999",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: Date.now() + 86400000,
      stateMemory: {
        version: "1.0",
        objective: "Temp goal",
        techStack: [],
        architectureDecisions: [],
        currentWork: "",
        blockersAndErrors: [],
        nextSteps: [],
        criticalSnippets: [],
        rawTokenEstimate: 10
      },
      rawCodeBlocks: [],
      turns: [{ id: "t2", role: "user", text: "Temp goal", codeBlocks: [] }],
      exchangeCount: 1,
      summaryMode: "local"
    }

    await saveContext(realContext)
    await saveContext(tempContext)

    // Under F1: getStoredContexts() strictly purges temporary/session_ contexts on fetch
    let stored = await getStoredContexts()
    expect(stored.length).toBe(1)
    expect(stored[0].id).toBe("chatgpt:6ad4dbd4-existing-permalink")
    expect(stored.find((c) => c.id === "chatgpt:session_shared_token_999")).toBeUndefined()
  })

  it("Strictly saves only permalinks and rejects non-permalink URLs", async () => {
    const res = await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: "active-chatgpt-fake",
      chatTitle: "Fake",
      sourceUrl: "https://chatgpt.com/",
      rawTranscript: "hello",
      rawCodeBlocks: [],
      turns: [{ id: "m1", role: "user", text: "hello", codeBlocks: [] }]
    })
    expect(res.success).toBe(false)
    expect(res.error).toBe("NO_REAL_CHAT_ID")
  })
})
