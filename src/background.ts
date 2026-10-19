import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_OPENAI_MODEL,
  type MessageTurn,
  type PlatformId,
  type SaveDiagnosticInfo,
  type StoredContext,
  type SummarizeTrigger,
  type VerbatimCodeBlock
} from "./types"
import {
  clearLastError,
  cleanupGarbageContexts,
  deleteContext,
  filterTurnsByMessageOwnership,
  getAllDebugInfo,
  getDensityMode,
  getSaveTimeline,
  getSettings,
  getStoredContexts,
  getTokenTelemetry,
  migrateTemporarySessions,
  recordSaveDecision,
  recordTokenUsage,
  saveContext,
  saveDebugInfo,
  saveLastError,
  setDensityMode,
  togglePinContext
} from "./utils/storage-manager"
import { isGenericOrNewChatId } from "./utils/context-filter"
import { summarizeWithLLM, testLLMConnection } from "./utils/llm-client"
import { redactSensitiveData } from "./utils/redaction"
import {
  buildLocalStateMemory,
  computeContentHash,
  countExchanges,
  mergeTurnsForSameChat
} from "./utils/local-mode"
import {
  isGenericFillerText,
  isInjectedTurn,
  stripInjectedContext
} from "./utils/prompt-formatter"


// In-flight concurrency lock & queuing
let isSummarizing = false
let pendingPayload: any = null

export const ALLOWED_ORIGIN_HOSTS = [
  "claude.ai",
  "chatgpt.com"
]

/**
 * Validates message sender ID and URL origin against permitted AI platform domains.
 * Logs clear, actionable reasons on rejection for security diagnostics.
 */
export function validateMessageSender(sender: chrome.runtime.MessageSender): {
  authorized: boolean
  reason: string
  origin?: string
} {
  // 1. Verify extension runtime ID
  if (!sender.id || sender.id !== chrome.runtime.id) {
    const reason = `Unauthorized sender ID '${sender.id || "undefined"}'. Expected '${chrome.runtime.id}'. Message rejected.`
    console.warn(
      `[ContextBridge Background Security] REJECTED: ${reason} (sender.tab.url='${sender.tab?.url || "none"}', allowedOrigins=[${ALLOWED_ORIGIN_HOSTS.join(", ")}])`
    )
    return { authorized: false, reason }
  }

  // 2. Identify sender URL / origin (handles tab.url, sender.url, and sender.origin)
  const rawUrl = sender.tab?.url || sender.url || (sender as any).origin
  if (!rawUrl) {
    // Internal background or popup message without tab context
    return {
      authorized: true,
      reason: "ACCEPTED: Internal extension sender (no tab URL present)"
    }
  }

  try {
    const parsed = new URL(rawUrl)
    const hostname = parsed.hostname.toLowerCase()
    const isAllowed = ALLOWED_ORIGIN_HOSTS.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`)
    )

    if (!isAllowed) {
      const reason = `Host '${hostname}' from sender.tab.url '${rawUrl}' is not in allowed origin list: [${ALLOWED_ORIGIN_HOSTS.join(", ")}]. Message rejected.`
      console.warn(
        `[ContextBridge Background Security] REJECTED: ${reason} (sender.id='${sender.id}')`
      )
      return {
        authorized: false,
        reason,
        origin: hostname
      }
    }

    console.debug(`[ContextBridge Background Security] ACCEPTED message from host '${hostname}'`)
    return {
      authorized: true,
      reason: `ACCEPTED: Authorized host '${hostname}'`,
      origin: hostname
    }
  } catch (err: any) {
    const reason = `Failed to parse sender URL '${rawUrl}': ${err?.message || "Invalid URL format"}. Message rejected.`
    console.warn(`[ContextBridge Background Security] REJECTED: ${reason}`)
    return {
      authorized: false,
      reason
    }
  }
}


/**
 * Updates extension action badge.
 */
function updateBadge(status: "IDLE" | "SYNC" | "OK" | "ERR"): void {
  try {
    switch (status) {
      case "SYNC":
        chrome.action.setBadgeText({ text: "SYNC" })
        chrome.action.setBadgeBackgroundColor({ color: "#6366F1" })
        break
      case "OK":
        chrome.action.setBadgeText({ text: "OK" })
        chrome.action.setBadgeBackgroundColor({ color: "#10B981" })
        setTimeout(() => chrome.action.setBadgeText({ text: "" }), 4000)
        break
      case "ERR":
        chrome.action.setBadgeText({ text: "ERR" })
        chrome.action.setBadgeBackgroundColor({ color: "#EF4444" })
        setTimeout(() => chrome.action.setBadgeText({ text: "" }), 5000)
        break
      case "IDLE":
      default:
        chrome.action.setBadgeText({ text: "" })
        break
    }
  } catch {
    // Ignore badge errors if action is not active
  }
}

/**
 * Handles incoming auto-save conversation payload from any supported platform.
 * Requirement 1: LOCAL MODE (default, no API key, no network):
 * - Keeps verbatim code blocks
 * - The goal (first user message, trimmed)
 * - The last 3-4 exchanges
 * - Rule-based trimming to a token budget (~1200 tokens)
 * - Capture saves raw messages with ZERO API calls!
 */
export async function handleAutoSave(payload: {
  sourcePlatform: PlatformId
  chatId: string
  chatTitle: string
  sourceUrl: string
  clientSessionId?: string
  rawTranscript: string
  rawCodeBlocks: VerbatimCodeBlock[]
  turns?: MessageTurn[]
  retryCount?: number
}): Promise<{ success: boolean; contextId?: string; mode?: "local" | "ai"; error?: string; retryCount?: number }> {
  try {
    const now = Date.now()

    // Phase 2 Requirement 1: NO TEMPORARY ENTRIES.
    // Save ONLY when the URL contains a real chat ID. On /new or temporary chat, save nothing.
    if (!payload.chatId || isGenericOrNewChatId(payload.chatId) || payload.chatId === "new") {
      await recordSaveDecision({
        id: `dec-${now}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: now,
        chatKey: `${payload.sourcePlatform}:${payload.chatId || "none"}`,
        decision: "skipped-no-chat-id",
        reason: "Skipped: URL has no real chat ID (/new or temporary chat)",
        navMechanism: (payload as any).navMechanism || "observer",
        turnsCount: 0
      })
      updateBadge("IDLE")
      return { success: false, error: "NO_REAL_CHAT_ID" }
    }

    if (!payload.rawTranscript || payload.rawTranscript.trim().length < 5) {
      updateBadge("IDLE")
      return { success: false, error: "TRANSCRIPT_TOO_SHORT" }
    }

    // Phase 2 Requirement 3: TURN OWNERSHIP BY MESSAGE ID.
    // Drops any turn whose message ID was previously claimed by another chat.
    const { validTurns, foreignCount, droppedTurns, totalReceived, totalKept, status } = await filterTurnsByMessageOwnership(
      payload.turns || [],
      payload.chatId
    )

    if (status === "NOT_READY_YET" || (foreignCount > 0 && validTurns.length === 0)) {
      const retryCount = (payload as any).retryCount || 0
      if (retryCount < 3) {
        return {
          success: false,
          error: "NOT_READY_YET",
          retryCount: retryCount + 1
        }
      }
      await recordSaveDecision({
        id: `dec-${now}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: now,
        chatKey: `${payload.sourcePlatform}:${payload.chatId}`,
        decision: "skipped-foreign-turns",
        reason: `Skipped: all turns belong to another chat (dropped ${foreignCount} foreign turns after ${retryCount} retries)`,
        navMechanism: (payload as any).navMechanism || "observer",
        turnsCount: 0,
        receivedTurnsCount: totalReceived,
        keptTurnsCount: totalKept,
        droppedTurns
      })
      updateBadge("IDLE")
      return { success: false, error: "ALL_TURNS_FOREIGN" }
    }

    // Requirement 3: Do not save an entry until it has a real chat title or at least one real turn.
    // Ignore placeholder titles ("Claude", "ChatGPT") as goal and title.
    const rawTitle = (payload.chatTitle || "").trim()
    const hasRealTitle = rawTitle.length > 0 && !isGenericFillerText(rawTitle)

    // A9c FIX: Check injected-handshake BEFORE the empty-turns guard.
    // Previously the empty-turns guard fired first with NO_REAL_TITLE_OR_TURNS
    // because a handshake chat has 0 substantive turns; the handshake block
    // was never reached, so INJECTED_HANDSHAKE_ONLY was never returned.
    //
    // A handshake chat is: ALL user turns are injected <ctx> blocks AND the
    // only non-injected turns are a single assistant "Ready" acknowledgment.
    const hadInjectedTurn = validTurns.some((t) => isInjectedTurn(t.text || ""))
    if (hadInjectedTurn) {
      const nonInjectedUserTurns = validTurns.filter((t) => {
        if (t.role !== "user") return false
        const clean = stripInjectedContext(t.text || "").trim()
        return clean.length > 0 && !isGenericFillerText(clean)
      })
      const nonHandshakeAssistantTurns = validTurns.filter((t) => {
        if (t.role !== "assistant") return false
        const clean = stripInjectedContext(t.text || "").trim()
        return !(clean.toLowerCase() === "ready" || clean.toLowerCase() === "ready.")
      })
      // Handshake-only: no real user question AND no substantive assistant reply
      if (nonInjectedUserTurns.length === 0 && nonHandshakeAssistantTurns.length === 0) {
        await recordSaveDecision({
          id: `dec-${now}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: now,
          chatKey: `${payload.sourcePlatform}:${payload.chatId}`,
          decision: "skipped-handshake",
          reason: "Skipped: only injected context handover handshake detected",
          navMechanism: (payload as any).navMechanism || "observer",
          turnsCount: validTurns.length
        })
        updateBadge("IDLE")
        return { success: false, error: "INJECTED_HANDSHAKE_ONLY" }
      }
    }

    const substantiveTurns = validTurns.filter((t) => {
      const clean = stripInjectedContext(t.text || "").trim()
      return (clean.length > 0 && !isGenericFillerText(clean)) || (t.codeBlocks && t.codeBlocks.length > 0)
    })

    if (substantiveTurns.length === 0 && !hasRealTitle) {
      await recordSaveDecision({
        id: `dec-${now}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: now,
        chatKey: `${payload.sourcePlatform}:${payload.chatId}`,
        decision: "skipped-no-turns",
        reason: "Skipped: no real title or substantive turns found",
        navMechanism: (payload as any).navMechanism || "observer",
        turnsCount: 0
      })
      updateBadge("IDLE")
      return { success: false, error: "NO_REAL_TITLE_OR_TURNS" }
    }

    const settings = await getSettings()

    // Phase 2 Requirement 4: Entry identity is strictly (platform, real chatId).
    const contextId = `${payload.sourcePlatform}:${payload.chatId}`
    const allContexts = await getStoredContexts()
    const safeExpiryHours =
      Number(settings.autoExpiryHours) > 0 ? Number(settings.autoExpiryHours) : 24
    const expiryMs = safeExpiryHours * 60 * 60 * 1000

    // Requirement 1 & Design A: Entry identity = (platform, real chatId from the URL).
    // An entry that already has a real chatId must never receive turns from another chatId.
    // Only merge turns inside the exact SAME chatId.
    const existing = allContexts.find((c) => c.id === contextId)
    let turns = substantiveTurns.length > 0 ? substantiveTurns : validTurns
    if (
      existing &&
      existing.chatId === payload.chatId &&
      existing.sourcePlatform === payload.sourcePlatform &&
      existing.turns &&
      existing.turns.length > 0
    ) {
      turns = mergeTurnsForSameChat(existing.turns, turns)
    }

    const contentHash = computeContentHash(turns)
    const exchangeCount = countExchanges(turns)

    // Design E: Recompute title, goal, last and code from this chat's own turns on every save.
    // Never keep an old title or goal from a previous chat or existing context.
    const densityMode = await getDensityMode()
    const localStateMemory = buildLocalStateMemory(
      turns,
      payload.rawCodeBlocks || [],
      hasRealTitle ? rawTitle : "",
      densityMode
    )

    const isPlaceholderTitle =
      !rawTitle ||
      isGenericFillerText(rawTitle) ||
      /message collapsed/i.test(rawTitle) ||
      /collapsed message/i.test(rawTitle) ||
      rawTitle.toLowerCase() === "new chat"

    let effectiveTitle = !isPlaceholderTitle ? rawTitle : (localStateMemory.objective || "Active Discussion")

    // Requirement 5 & Design K: Diagnostics: per save show temp id, real chatId, matched entry id and why.
    const tempId = "none"
    const realChatId = payload.chatId
    const matchedEntryId = existing ? existing.id : contextId
    let matchWhy = ""
    let decisionCode: import("./types").SaveDecisionCode = "saved"
    if (existing) {
      matchWhy = `Updated existing entry '${contextId}' in place`
      decisionCode = "updated"
    } else {
      matchWhy = `Created new permalink entry '${contextId}' from URL permalink`
      decisionCode = "saved"
    }

    const saveDiagnostic: SaveDiagnosticInfo = {
      tempId,
      realChatId,
      matchedEntryId,
      why: matchWhy,
      timestamp: now
    }

    console.debug(`[ContextBridge Save Diagnostic] tempId: ${tempId}, realChatId: ${realChatId}, matchedEntryId: ${matchedEntryId}, why: ${matchWhy}`)

    const idSourceAttrCounts: Record<string, number> = {}
    for (const t of turns) {
      const src = t.idSourceAttr || "unknown"
      idSourceAttrCounts[src] = (idSourceAttrCounts[src] || 0) + 1
    }

    await recordSaveDecision({
      id: `dec-${now}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: now,
      chatKey: contextId,
      decision: decisionCode,
      reason: matchWhy,
      navMechanism: (payload as any).navMechanism || "observer",
      turnsCount: turns.length,
      receivedTurnsCount: payload.turns?.length || turns.length,
      keptTurnsCount: turns.length,
      idSourceAttrCounts
    })

    console.debug(`[ContextBridge Save Diagnostic] tempId: ${tempId}, realChatId: ${realChatId}, matchedEntryId: ${matchedEntryId}, why: ${matchWhy}`)

    // Check if an existing context was already AI-synthesized and content has NOT changed
    let stateMemory = localStateMemory
    let summaryMode: "local" | "ai" = "local"

    if (existing?.stateMemory?.isAiSynthesized && existing.contentHash === contentHash) {
      // Preserve existing AI summary if content hash is identical
      stateMemory = existing.stateMemory
      summaryMode = "ai"
    }

    const context: StoredContext = {
      id: contextId,
      sourcePlatform: payload.sourcePlatform,
      chatId: payload.chatId,
      chatTitle: effectiveTitle,
      sourceUrl: payload.sourceUrl,
      clientSessionId: payload.clientSessionId,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      expiresAt: now + expiryMs,
      stateMemory,
      rawCodeBlocks: payload.rawCodeBlocks || [],
      rawTranscript: payload.rawTranscript,
      turns,
      contentHash,
      lastSummarizedTurnIndex: existing?.lastSummarizedTurnIndex,
      exchangeCount,
      summaryMode,
      lastSaveDiagnostic: saveDiagnostic
    }

    // Save strictly to local storage. ZERO network / API calls on capture!
    await saveContext(context)
    console.debug(`[ContextBridge Background] local save done: ${contextId} (exchanges: ${exchangeCount}, hash: ${contentHash})`)
    updateBadge("OK")

    // Update telemetry for popup debug diagnostics panel
    try {
      const telemetryMap = await getAllDebugInfo()
      const existingTelem = telemetryMap[payload.sourcePlatform]
      if (existingTelem) {
        existingTelem.lastSaveDiagnostic = saveDiagnostic
        existingTelem.lastSaveTime = now
        await saveDebugInfo(existingTelem)
      }
    } catch {
      // Ignored
    }

    return { success: true, contextId, mode: summaryMode }
  } catch (fatalErr: any) {
    console.error("[ContextBridge Background] Fatal error during auto-save:", fatalErr)
    updateBadge("ERR")
    return { success: false, error: fatalErr?.message || "Fatal error during save" }
  }
}

/**
 * Requirement 2 & 3: AI MODE on top of Local Mode
 * Summarize ONLY on triggers:
 * 1. user clicks Inject (inject_click)
 * 2. tab hidden (visibility_hidden)
 * 3. rate-limit detection (rate_limit)
 * 4. idle >= 2 min after a completed assistant response (idle_timeout)
 * 5. manual
 *
 * Skip Logic:
 * - Content hash unchanged -> skip
 * - Fewer than 3 exchanges -> skip
 * - Incremental -> send previous summary + only new messages
 * - On any API failure (404, 429, timeout, offline, no key) -> fall back to local mode with notice
 */
export async function handleTriggerAiSummary(payload: {
  sourcePlatform: PlatformId
  chatId: string
  trigger: SummarizeTrigger
  turns?: MessageTurn[]
  rawTranscript?: string
  rawCodeBlocks?: VerbatimCodeBlock[]
}): Promise<{
  success: boolean
  mode?: "local" | "ai"
  skipped?: boolean
  fallback?: boolean
  reason?: string
  error?: string
  contextId?: string
  notice?: string
}> {
  if (isSummarizing) {
    return { success: false, error: "SUMMARIZATION_IN_PROGRESS" }
  }

  const settings = await getSettings()
  const activeKey =
    settings.provider === "openai" ? settings.openaiApiKey : settings.geminiApiKey

  // 1. Check for BYOK API key - if missing, remain in local mode
  if (!activeKey || !activeKey.trim()) {
    console.debug(
      `[ContextBridge Background] AI summary skipped (${payload.trigger}): No API key configured. Remaining in Local Mode.`
    )
    return {
      success: true,
      skipped: true,
      reason: "NO_API_KEY",
      mode: "local",
      notice: "No API key configured. Operating in 100% Local Mode."
    }
  }

  // 2. Retrieve the existing context
  const allContexts = await getStoredContexts()
  let context = allContexts.find(
    (c) => c.sourcePlatform === payload.sourcePlatform && c.chatId === payload.chatId
  )

  const turns = payload.turns || context?.turns || []
  const exchanges = countExchanges(turns)

  // 3. SKIP LOGIC: chats with fewer than 3 exchanges
  if (exchanges < 3) {
    console.debug(
      `[ContextBridge Background] AI summary skipped (${payload.trigger}): Chat has ${exchanges} exchanges (< 3). Remaining in Local Mode.`
    )
    return {
      success: true,
      skipped: true,
      reason: "FEWER_THAN_3_EXCHANGES",
      mode: "local"
    }
  }

  // 4. SKIP LOGIC: content hash unchanged
  const currentHash = computeContentHash(turns)
  if (context?.stateMemory?.isAiSynthesized && context.contentHash === currentHash) {
    console.debug(
      `[ContextBridge Background] AI summary skipped (${payload.trigger}): Content hash unchanged (${currentHash}).`
    )
    return {
      success: true,
      skipped: true,
      reason: "CONTENT_HASH_UNCHANGED",
      mode: "ai",
      contextId: context.id
    }
  }

  // 5. INCREMENTAL: Send previous summary + only new messages, never the full chat
  let transcriptToSummarize = ""
  let previousSummary = context?.stateMemory?.compactSummary
  const lastSummarizedIdx = context?.lastSummarizedTurnIndex ?? 0

  if (previousSummary && lastSummarizedIdx > 0 && lastSummarizedIdx < turns.length) {
    const newTurns = turns.slice(lastSummarizedIdx)
    transcriptToSummarize = newTurns
      .map((t) => `${t.role.toUpperCase()}:\n${t.text}`)
      .join("\n\n---\n\n")
    console.debug(
      `[ContextBridge Background] Incremental AI summary started (${payload.trigger}): ${newTurns.length} new turns since turn ${lastSummarizedIdx}`
    )
  } else {
    // Full chat summarization
    previousSummary = undefined
    transcriptToSummarize =
      payload.rawTranscript ||
      turns.map((t) => `${t.role.toUpperCase()}:\n${t.text}`).join("\n\n---\n\n")
    console.debug(
      `[ContextBridge Background] Full AI summary started (${payload.trigger}): ${turns.length} turns`
    )
  }

  if (!transcriptToSummarize || transcriptToSummarize.trim().length < 5) {
    return { success: true, skipped: true, reason: "EMPTY_TRANSCRIPT", mode: "local" }
  }

  isSummarizing = true
  updateBadge("SYNC")

  const activeModel =
    settings.provider === "openai"
      ? settings.openaiModel || DEFAULT_OPENAI_MODEL
      : settings.geminiModel || DEFAULT_GEMINI_MODEL

  try {
    // Client-side redaction before leaving browser
    const { redactedText, redactionCount, matchedCategories } =
      redactSensitiveData(transcriptToSummarize)
    if (redactionCount > 0) {
      console.info(
        `[ContextBridge Security] Redacted ${redactionCount} items before AI call (${matchedCategories.join(", ")})`
      )
    }

    const codeBlocks = payload.rawCodeBlocks || context?.rawCodeBlocks || []
    const synthesizedMemory = await summarizeWithLLM(
      redactedText,
      codeBlocks,
      settings,
      previousSummary
    )

    const usedTokens = synthesizedMemory.rawTokenEstimate || 350
    await recordTokenUsage(usedTokens)

    console.debug(`[ContextBridge Background] AI summary completed successfully (model: ${activeModel}, tokens: ${usedTokens})`)

    if (context) {
      context.stateMemory = synthesizedMemory
      context.contentHash = currentHash
      context.lastSummarizedTurnIndex = turns.length
      context.exchangeCount = exchanges
      context.summaryMode = "ai"
      context.updatedAt = Date.now()
      await saveContext(context)
    }

    await clearLastError()
    updateBadge("OK")

    return {
      success: true,
      mode: "ai",
      contextId: context?.id
    }
  } catch (err: any) {
    const errorMsg = err?.message || "Unknown summarization error"
    console.warn(
      `[ContextBridge Background] AI summary failed (${payload.trigger}): ${errorMsg}. Falling back to Local Mode.`
    )

    await saveLastError({
      message: errorMsg,
      timestamp: Date.now(),
      provider: settings.provider,
      model: activeModel
    })
    updateBadge("ERR")

    // Retain local mode
    if (context) {
      context.summaryMode = "local"
      await saveContext(context)
    }

    return {
      success: true,
      fallback: true,
      mode: "local",
      error: errorMsg,
      notice: `AI summary failed: ${errorMsg}. Operating in 100% offline Local Mode.`
    }
  } finally {
    isSummarizing = false
  }
}

/**
 * Message routing with strict sender authorization & telemetry
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const auth = validateMessageSender(sender)
  if (!auth.authorized) {
    console.warn(`[ContextBridge Background] REJECTED (with reason: ${auth.reason})`)
    sendResponse({ success: false, error: auth.reason })
    return false
  }

  // 1. Auto-save conversation transcript from content scripts
  if (message?.type === "AUTO_SAVE_TRANSCRIPT") {
    console.debug(
      `[ContextBridge Background] background received message from ${auth.origin || "internal"} (platform: ${message.payload?.sourcePlatform})`
    )
    handleAutoSave(message.payload).then(async (res) => {
      const statusText = res.success
        ? `Saved (${res.contextId})`
        : `Failed (${res.error || "unknown"})`
      if (!res.success) {
        console.warn(`[ContextBridge Background] auto-save failed: ${res.error}`)
      } else {
        console.debug(`[ContextBridge Background] auto-save succeeded: ${res.contextId}`)
      }

      // Update telemetry for popup debug diagnostics panel
      try {
        const telemetryMap = await getAllDebugInfo()
        const existing = telemetryMap[message.payload.sourcePlatform]
        if (existing) {
          existing.bgResult = statusText
          existing.bgResultTime = Date.now()
          if (res.success) existing.lastSaveTime = Date.now()
          await saveDebugInfo(existing)
        }
      } catch {
        // Ignored
      }

      sendResponse(res)
    }).catch((err) => {
      console.error(`[ContextBridge Background] auto-save error:`, err)
      sendResponse({ success: false, error: err?.message || String(err) })
    })
    return true // Keep channel open for async response
  }

  // 2. Synchronize debug telemetry from content scripts (Directive 1)
  if (message?.type === "UPDATE_DEBUG_TELEMETRY") {
    if (message.payload) {
      saveDebugInfo(message.payload)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err?.message }))
      return true
    }
    sendResponse({ success: false })
    return false
  }

  // AI Summarization Trigger (Stage 2: inject_click, visibility_hidden, rate_limit, idle_timeout, manual)
  if (message?.type === "TRIGGER_AI_SUMMARY") {
    handleTriggerAiSummary(message.payload)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err?.message }))
    return true
  }

  // 3. Fetch all platform debug telemetry for the popup Diagnostics tab
  if (message?.type === "GET_ALL_DEBUG_TELEMETRY") {
    getAllDebugInfo()
      .then((telemetry) => sendResponse({ success: true, telemetry }))
      .catch((err) => sendResponse({ success: false, error: err?.message, telemetry: {} }))
    return true
  }

  // 2. Report adapter error (when platform's messages cannot be read)
  if (message?.type === "REPORT_ADAPTER_ERROR") {
    const issue = message.payload?.issue || "Failed to read platform messages"
    console.warn(
      `[ContextBridge Background] Adapter error reported for platform '${message.payload?.platform}': ${issue}`
    )
    updateBadge("ERR")
    saveLastError({
      message: `Adapter error on ${message.payload?.platform}: ${issue}`,
      timestamp: Date.now(),
      provider: "system",
      model: "dom-observer"
    })
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err?.message }))
    return true
  }

  // 2. Fetch all valid stored contexts (with automatic expiration pruning)
  if (message?.type === "GET_STORED_CONTEXTS") {
    getStoredContexts()
      .then((contexts) => sendResponse({ success: true, contexts }))
      .catch((err) => sendResponse({ success: false, error: err?.message, contexts: [] }))
    return true
  }

  // Toggle pinned status of a context (Requirement A6)
  if (message?.type === "TOGGLE_PIN_CONTEXT") {
    togglePinContext(message.payload?.contextId)
      .then((isPinned) => sendResponse({ success: true, isPinned }))
      .catch((err) => sendResponse({ success: false, error: err?.message }))
    return true
  }

  // Token Usage Telemetry & Daily Cap Handlers (Stage 2 Requirement 6)
  if (message?.type === "GET_TOKEN_TELEMETRY") {
    getTokenTelemetry()
      .then((telemetry) => sendResponse({ success: true, telemetry }))
      .catch((err) => sendResponse({ success: false, error: err?.message }))
    return true
  }

  // Density Mode Handlers (Compact / Standard / Full)
  if (message?.type === "GET_DENSITY_MODE") {
    getDensityMode()
      .then((mode) => sendResponse({ success: true, mode }))
      .catch((err) => sendResponse({ success: false, error: err?.message }))
    return true
  }

  if (message?.type === "SET_DENSITY_MODE") {
    const mode = message.payload?.mode || "standard"
    setDensityMode(mode)
      .then(() => sendResponse({ success: true, mode }))
      .catch((err) => sendResponse({ success: false, error: err?.message }))
    return true
  }

  // 3. Test API key & model configuration (lightweight ping)
  if (message?.type === "TEST_LLM_CONFIG") {
    const { provider, apiKey, model } = message.payload || {}
    testLLMConnection(provider, apiKey, model)
      .then(async (result) => {
        await clearLastError()
        sendResponse(result)
      })
      .catch(async (err: any) => {
        const errorMsg = err?.message || "Connection test failed"
        const activeModel =
          model?.trim() || (provider === "gemini" ? DEFAULT_GEMINI_MODEL : DEFAULT_OPENAI_MODEL)
        await saveLastError({
          message: errorMsg,
          timestamp: Date.now(),
          provider: provider || "gemini",
          model: activeModel
        })
        sendResponse({ success: false, error: errorMsg })
      })
    return true
  }

  // 4. Clear last error
  if (message?.type === "CLEAR_LAST_ERROR") {
    clearLastError()
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err?.message }))
    return true
  }

  // 5. Health ping
  if (message?.type === "PING_BACKGROUND") {
    sendResponse({ status: "PONG", isSummarizing, timestamp: Date.now() })
    return true
  }

  // 6. Fetch save decision timeline (Design K)
  if (message?.type === "GET_SAVE_TIMELINE") {
    getSaveTimeline()
      .then((timeline) => sendResponse({ success: true, timeline }))
      .catch((err) => sendResponse({ success: false, error: err?.message, timeline: [] }))
    return true
  }

  // Fallback: Ensure EVERY onMessage path calls sendResponse
  sendResponse({ success: false, error: "UNHANDLED_BACKGROUND_MESSAGE" })
  return false
})

// Startup cleanup: wipe legacy temporary garbage (Phase 2 Requirement 5)
cleanupGarbageContexts().catch(() => {})

console.info("[ContextBridge Brain] Service Worker active with security & auto-expiry pruning.")
