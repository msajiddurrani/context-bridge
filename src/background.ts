import {
  type MessageTurn,
  type PlatformId,
  type SaveDiagnosticInfo,
  type StoredContext,
  type VerbatimCodeBlock
} from "./types"
import {
  cleanupGarbageContexts,
  filterTurnsByMessageOwnership,
  getAllDebugInfo,
  getDensityMode,
  getSaveTimeline,
  getSettings,
  getStoredContexts,
  recordSaveDecision,
  saveContext,
  saveDebugInfo,
  setDensityMode,
  togglePinContext
} from "./utils/storage-manager"
import { isGenericOrNewChatId } from "./utils/context-filter"
import { redactSensitiveData } from "./utils/redaction"
import {
  buildLocalStateMemory,
  computeContentHash,
  countExchanges,
  deduplicateCodeBlocks,
  mergeTurnsForSameChat
} from "./utils/local-mode"
import {
  isGenericFillerText,
  isInjectedTurn,
  stripInjectedContext
} from "./utils/prompt-formatter"

export const ALLOWED_ORIGIN_HOSTS = [
  "claude.ai",
  "chatgpt.com",
  "gemini.google.com"
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

  // Internal extension pages (popup.html, sidepanel.html) have chrome-extension:// scheme
  if (rawUrl.startsWith("chrome-extension://")) {
    return {
      authorized: true,
      reason: "ACCEPTED: Internal extension page sender",
      origin: "internal"
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
      return { authorized: false, reason }
    }
    console.debug(`[ContextBridge Background Security] ACCEPTED message from host '${hostname}'`)
    return { authorized: true, reason: `ACCEPTED: Authorized host '${hostname}'`, origin: hostname }
  } catch (err: any) {
    const reason = `Failed to parse sender URL '${rawUrl}': ${err?.message || err}. Message rejected.`
    console.warn(
      `[ContextBridge Background Security] REJECTED: ${reason} (sender.id='${sender.id}')`
    )
    return { authorized: false, reason }
  }
}

/**
 * Updates extension toolbar action badge.
 */
export function updateBadge(state: "SYNC" | "OK" | "ERR" | "IDLE") {
  if (typeof chrome === "undefined" || !chrome.action) return
  switch (state) {
    case "SYNC":
      chrome.action.setBadgeText({ text: "SYNC" })
      chrome.action.setBadgeBackgroundColor({ color: "#3B82F6" }) // blue
      break
    case "OK":
      chrome.action.setBadgeText({ text: "OK" })
      chrome.action.setBadgeBackgroundColor({ color: "#10B981" }) // green
      break
    case "ERR":
      chrome.action.setBadgeText({ text: "ERR" })
      chrome.action.setBadgeBackgroundColor({ color: "#EF4444" }) // red
      break
    case "IDLE":
    default:
      chrome.action.setBadgeText({ text: "" })
      break
  }
}

/**
 * Handles automatic saving of conversation transcripts from content scripts.
 * Runs 100% locally and offline without external network or AI API dependencies.
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
  isImported?: boolean
}): Promise<{ success: boolean; contextId?: string; mode?: "local"; error?: string; retryCount?: number }> {
  try {
    const now = Date.now()

    // 1. Permalinks Only: Save ONLY when the URL contains a real chat ID.
    // On /, /new, or temporary chat, save nothing.
    if (
      !payload.chatId ||
      isGenericOrNewChatId(payload.chatId) ||
      payload.chatId === "new" ||
      payload.chatId.startsWith("active-") ||
      payload.chatId.startsWith("session_") ||
      payload.chatId.startsWith("local-")
    ) {
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

    // 2. Turn Ownership by Message ID: Drops turns claimed by other chats.
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
        reason: `Skipped: all turns belong to another chat after ${retryCount} retries`,
        navMechanism: (payload as any).navMechanism || "observer",
        turnsCount: 0,
        receivedTurnsCount: totalReceived,
        keptTurnsCount: totalKept,
        droppedTurns
      })
      updateBadge("IDLE")
      return { success: false, error: "SKIPPED_FOREIGN_TURNS" }
    }

        const rawTitle = (payload.chatTitle || "").trim()
    const hasRealTitle = rawTitle.length > 0 && !isGenericFillerText(rawTitle)

    // Handshake guard: If all user turns are injected <ctx> blocks AND the only non-injected
    // turns are a single assistant "Ready" acknowledgment, skip saving.
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
        reason: "Skipped: no substantive turns and no real title (placeholder title only)",
        navMechanism: (payload as any).navMechanism || "observer",
        turnsCount: 0
      })
      updateBadge("IDLE")
      return { success: false, error: "NO_REAL_TITLE_OR_TURNS" }
    }

    const contextId = `${payload.sourcePlatform}:${payload.chatId}`
    const existingList = await getStoredContexts()
    const existing = existingList.find((c) => c.id === contextId)

    // Redact credentials and filter out injected prompts from captured turns
    const processedTurns: MessageTurn[] = (validTurns || []).map((turn) => {
      let cleanedText = turn.text || ""
      if (isInjectedTurn(cleanedText)) {
        cleanedText = stripInjectedContext(cleanedText)
      }
      return {
        ...turn,
        text: redactSensitiveData(cleanedText).redactedText,
        codeBlocks: (turn.codeBlocks || []).map((cb) => ({
          ...cb,
          code: redactSensitiveData(cb.code).redactedText
        }))
      }
    }).filter((turn) => turn.text.trim().length > 0 || (turn.codeBlocks && turn.codeBlocks.length > 0))

    // Merge turns cleanly for same chat session
    const turns = existing ? mergeTurnsForSameChat(existing.turns || [], processedTurns) : processedTurns
    const exchanges = countExchanges(turns)

    const densityMode = await getDensityMode()
    const localStateMemory = buildLocalStateMemory(
      turns,
      deduplicateCodeBlocks(payload.rawCodeBlocks || []),
      hasRealTitle ? rawTitle : "",
      densityMode
    )

    const isPlaceholderTitle =
      !rawTitle ||
      isGenericFillerText(rawTitle) ||
      /message collapsed/i.test(rawTitle) ||
      /collapsed message/i.test(rawTitle) ||
      rawTitle.toLowerCase() === "new chat"

    const effectiveTitle = !isPlaceholderTitle ? rawTitle : (localStateMemory.objective || "Active Discussion")

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
      const attr = t.idSourceAttr || "unknown"
      idSourceAttrCounts[attr] = (idSourceAttrCounts[attr] || 0) + 1
    }

    await recordSaveDecision({
      id: `dec-${now}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: now,
      chatKey: `${payload.sourcePlatform}:${payload.chatId}`,
      decision: decisionCode,
      reason: matchWhy,
      navMechanism: (payload as any).navMechanism || "observer",
      turnsCount: turns.length,
      receivedTurnsCount: totalReceived,
      keptTurnsCount: totalKept,
      droppedTurns,
      idSourceAttrCounts
    })

    const settings = await getSettings()
    const expiryHours = settings.autoExpiryHours > 0 ? settings.autoExpiryHours : 24
    const expiresAt = existing?.isPinned ? 0 : now + expiryHours * 60 * 60 * 1000

    const storedContext: StoredContext = {
      id: contextId,
      sourcePlatform: payload.sourcePlatform,
      chatId: payload.chatId,
      chatTitle: effectiveTitle,
      sourceUrl: payload.sourceUrl,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      expiresAt,
      isPinned: existing?.isPinned ?? false,
      stateMemory: localStateMemory,
      rawCodeBlocks: deduplicateCodeBlocks(payload.rawCodeBlocks || []),
      rawTranscript: redactSensitiveData(payload.rawTranscript).redactedText,
      turns,
      contentHash: computeContentHash(turns),
      lastSummarizedTurnIndex: turns.length,
      exchangeCount: exchanges,
      summaryMode: "local",
      lastSaveDiagnostic: saveDiagnostic,
      isImported: payload.isImported
    }

    await saveContext(storedContext)
    console.debug(
      `[ContextBridge Background] local save done: ${contextId} (exchanges: ${exchanges}, hash: ${storedContext.contentHash})`
    )

    updateBadge("OK")
    setTimeout(() => updateBadge("IDLE"), 2000)

    return {
      success: true,
      contextId,
      mode: "local"
    }
  } catch (err: any) {
    console.error("[ContextBridge Background] auto-save critical error:", err)
    updateBadge("ERR")
    setTimeout(() => updateBadge("IDLE"), 3000)
    return { success: false, error: err?.message || String(err) }
  }
}

// ============================================================================
// CHROME RUNTIME MESSAGE LISTENER (MV3 Service Worker)
// ============================================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const auth = validateMessageSender(sender)
  if (!auth.authorized) {
    console.warn(`[ContextBridge Background] REJECTED (with reason: ${auth.reason})`)
    sendResponse({ success: false, error: auth.reason })
    return false
  }

  // 1. Auto-save conversation transcript from content scripts
  if (message?.type === "AUTO_SAVE_TRANSCRIPT") {
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
    return true
  }

  // 2. Synchronize debug telemetry from content scripts
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

  // 3. Fetch all platform debug telemetry for the popup Diagnostics tab
  if (message?.type === "GET_ALL_DEBUG_TELEMETRY") {
    getAllDebugInfo()
      .then((telemetry) => sendResponse({ success: true, telemetry }))
      .catch((err) => sendResponse({ success: false, error: err?.message, telemetry: {} }))
    return true
  }

  // 4. Diagnostics last insert result
  if (message?.type === "UPDATE_LAST_INSERT_RESULT") {
    if (message.payload?.platform) {
      getAllDebugInfo()
        .then(async (telemetryMap) => {
          const existing = telemetryMap[message.payload.platform] || {
            platform: message.payload.platform,
            adapterLoaded: true,
            csuiMounted: true,
            inputBoxFound: true,
            turnsFound: 0,
            matchedSelector: "none",
            timestamp: Date.now()
          }
          existing.lastInsertResult = {
            charactersInserted: message.payload.charactersInserted,
            inputContainsText: message.payload.inputContainsText,
            sendButtonEnabled: message.payload.sendButtonEnabled,
            timestamp: message.payload.timestamp
          }
          await saveDebugInfo(existing)
          sendResponse({ success: true })
        })
        .catch((err) => sendResponse({ success: false, error: err?.message }))
      return true
    }
    sendResponse({ success: false })
    return false
  }

  // 5. Report adapter error (when platform's messages cannot be read)
  if (message?.type === "REPORT_ADAPTER_ERROR") {
    const issue = message.payload?.issue || "Failed to read platform messages"
    console.warn(
      `[ContextBridge Background] Adapter error reported for platform '${message.payload?.platform}': ${issue}`
    )
    updateBadge("ERR")
    setTimeout(() => updateBadge("IDLE"), 3000)
    sendResponse({ success: true })
    return true
  }

  // 6. Fetch all valid stored contexts (with automatic expiration pruning)
  if (message?.type === "GET_STORED_CONTEXTS") {
    getStoredContexts()
      .then((contexts) => sendResponse({ success: true, contexts }))
      .catch((err) => sendResponse({ success: false, error: err?.message, contexts: [] }))
    return true
  }

  // 7. Toggle pinned status of a context
  if (message?.type === "TOGGLE_PIN_CONTEXT") {
    togglePinContext(message.payload?.contextId)
      .then((isPinned) => sendResponse({ success: true, isPinned }))
      .catch((err) => sendResponse({ success: false, error: err?.message }))
    return true
  }

  // 8. Density Mode Handlers (Compact / Standard / Full)
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

  // 9. Health ping
  if (message?.type === "PING_BACKGROUND") {
    sendResponse({ status: "PONG", isLocalModeOnly: true, timestamp: Date.now() })
    return true
  }

  // 10. Fetch save decision timeline
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

// Startup cleanup: wipe legacy temporary garbage
cleanupGarbageContexts().catch(() => {})

export interface KeyboardCommandDependencies {
  queryTabs?: (queryInfo: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>
  sendMessage?: (tabId: number, message: any) => Promise<any>
  sidePanel?: { open: (options: { windowId?: number; tabId?: number }) => Promise<void> }
}

/**
 * Handles global keyboard shortcuts dispatched via chrome.commands.
 */
export async function handleKeyboardCommand(
  command: string,
  deps?: KeyboardCommandDependencies
): Promise<void> {
  const queryTabs =
    deps?.queryTabs ||
    ((queryInfo) => chrome.tabs.query(queryInfo))
  const sendMessage =
    deps?.sendMessage ||
    ((tabId, msg) => chrome.tabs.sendMessage(tabId, msg))
  const sidePanel =
    deps?.sidePanel ||
    (typeof chrome !== "undefined" && chrome.sidePanel ? chrome.sidePanel : undefined)

  if (command === "quick_inject") {
    try {
      const tabs = await queryTabs({ active: true, currentWindow: true })
      const activeTab = tabs && tabs[0]
      if (!activeTab?.id || !activeTab.url) return

      let host = ""
      try {
        host = new URL(activeTab.url).hostname.toLowerCase()
      } catch {
        return
      }

      const isAllowed = ALLOWED_ORIGIN_HOSTS.some((ah) => host === ah || host.endsWith(`.${ah}`))
      if (!isAllowed) {
        console.warn(`[ContextBridge Command] quick_inject rejected on untrusted host: ${host}`)
        return
      }

      await sendMessage(activeTab.id, { type: "EXECUTE_QUICK_INJECT" })
    } catch (err: any) {
      console.debug("[ContextBridge Command] quick_inject error:", err?.message)
    }
  } else if (command === "open_sidepanel") {
    try {
      const tabs = await queryTabs({ active: true, currentWindow: true })
      const activeTab = tabs && tabs[0]
      if (activeTab?.windowId && sidePanel?.open) {
        await sidePanel.open({ windowId: activeTab.windowId })
      }
    } catch (err: any) {
      console.debug("[ContextBridge Command] open_sidepanel error:", err?.message)
    }
  }
}

// Global keyboard shortcut listeners (chrome.commands)
if (typeof chrome !== "undefined" && chrome.commands?.onCommand) {
  chrome.commands.onCommand.addListener((command) => {
    handleKeyboardCommand(command).catch(() => {})
  })
}

console.info("[ContextBridge Brain] Service Worker active with local-only security & auto-expiry pruning.")
