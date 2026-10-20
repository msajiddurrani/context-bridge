import { Storage } from "@plasmohq/storage"
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  type DroppedTurnDiagnostic,
  type InjectionDensityMode,
  type LastErrorInfo,
  type MessageTurn,
  type ProviderSettings,
  type SaveDecisionRecord,
  type StoredContext,
  type TokenUsageTelemetry
} from "../types"

const storage = new Storage({ area: "local" })

/**
 * Retrieves the user settings (BYOK credentials, model choices, auto-expiry).
 */
export async function getSettings(): Promise<ProviderSettings> {
  const settings = await storage.get<ProviderSettings>(STORAGE_KEYS.SETTINGS)
  const merged = { ...DEFAULT_SETTINGS, ...settings }
  // Auto-migrate retired gemini-2.5-flash / gemini-1.5-flash to verified current model
  if (
    !merged.geminiModel ||
    merged.geminiModel === "gemini-2.5-flash" ||
    merged.geminiModel.startsWith("gemini-1.5")
  ) {
    merged.geminiModel = DEFAULT_GEMINI_MODEL
  }
  return merged
}

/**
 * Saves user settings.
 */
export async function saveSettings(settings: Partial<ProviderSettings>): Promise<ProviderSettings> {
  const current = await getSettings()
  const updated = { ...current, ...settings }
  await storage.set(STORAGE_KEYS.SETTINGS, updated)
  return updated
}

/**
 * Retrieves the last API error encountered.
 */
export async function getLastError(): Promise<LastErrorInfo | null> {
  return (await storage.get<LastErrorInfo>(STORAGE_KEYS.LAST_ERROR)) || null
}

/**
 * Saves the last API error encountered for display in the popup.
 */
export async function saveLastError(error: LastErrorInfo): Promise<void> {
  await storage.set(STORAGE_KEYS.LAST_ERROR, error)
}

/**
 * Clears the last error.
 */
export async function clearLastError(): Promise<void> {
  await storage.remove(STORAGE_KEYS.LAST_ERROR)
}

/**
 * Clears stored API keys.
 */
export async function deleteApiKeys(): Promise<void> {
  const current = await getSettings()
  current.geminiApiKey = ""
  current.openaiApiKey = ""
  await storage.set(STORAGE_KEYS.SETTINGS, current)
}


import { isGenericOrNewChatId } from "./context-filter"
import type { InjectedRecord, PlatformId } from "../types"

/**
 * Returns all active stored contexts, automatically pruning expired items.
 * Ensures valid unexpired contexts are NEVER deleted prematurely.
 */
export async function getStoredContexts(): Promise<StoredContext[]> {
  const rawContexts = (await storage.get<Record<string, StoredContext>>(STORAGE_KEYS.CONTEXTS)) || {}
  const now = Date.now()
  const validContexts: StoredContext[] = []
  const prunedMap: Record<string, StoredContext> = {}
  let hasPruned = false

  for (const [id, context] of Object.entries(rawContexts)) {
    // Pinned contexts never expire (Requirement A6)
    if (context.isPinned) {
      validContexts.push(context)
      prunedMap[id] = context
      continue
    }

    // Only prune if expiresAt is explicitly set, greater than 0, and has passed
    if (context.expiresAt && typeof context.expiresAt === "number" && context.expiresAt > 0 && context.expiresAt <= now) {
      hasPruned = true
      continue // Expired, skip
    }

    // Repair context missing or invalid expiresAt (default 24 hours from now)
    if (!context.expiresAt || typeof context.expiresAt !== "number" || context.expiresAt <= 0) {
      context.expiresAt = now + 24 * 60 * 60 * 1000
    }

    validContexts.push(context)
    prunedMap[id] = context
  }

  // Persist pruned state if any contexts expired
  if (hasPruned) {
    await storage.set(STORAGE_KEYS.CONTEXTS, prunedMap)
  }

  // Return sorted with most recently updated first
  return validContexts.sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * Explicit cleanup of expired contexts (Requirement A6).
 * Pinned contexts are preserved indefinitely.
 */
export async function cleanupExpiredContexts(): Promise<{ prunedCount: number }> {
  const rawContexts = (await storage.get<Record<string, StoredContext>>(STORAGE_KEYS.CONTEXTS)) || {}
  const now = Date.now()
  let prunedCount = 0
  const prunedMap: Record<string, StoredContext> = {}

  for (const [id, context] of Object.entries(rawContexts)) {
    if (context.isPinned) {
      prunedMap[id] = context
      continue
    }
    if (context.expiresAt && typeof context.expiresAt === "number" && context.expiresAt > 0 && context.expiresAt <= now) {
      prunedCount++
      continue
    }
    prunedMap[id] = context
  }

  if (prunedCount > 0) {
    await storage.set(STORAGE_KEYS.CONTEXTS, prunedMap)
  }

  return { prunedCount }
}

/**
 * Toggles the pinned state of a stored context (Requirement A6).
 * Pinned contexts are immune to TTL auto-expiry.
 */
export async function togglePinContext(contextId: string): Promise<boolean> {
  const all = (await storage.get<Record<string, StoredContext>>(STORAGE_KEYS.CONTEXTS)) || {}
  if (!all[contextId]) return false
  all[contextId].isPinned = !all[contextId].isPinned
  await storage.set(STORAGE_KEYS.CONTEXTS, all)
  return Boolean(all[contextId].isPinned)
}

/**
 * Calculates expiry timestamp configured_hours after the given base timestamp (default 24h, range 6-168h).
 */
export function computeExpiryTimestamp(updatedAt: number, expiryHours?: number): number {
  const h = Number(expiryHours)
  const safeHours = !isNaN(h) && h >= 6 && h <= 168 ? h : 24
  return updatedAt + safeHours * 60 * 60 * 1000
}

/**
 * Saves or updates a stored context in chrome.storage.local.
 * Recalculates expiresAt based on updatedAt and configured autoExpiryHours.
 */
export async function saveContext(context: StoredContext): Promise<void> {
  const contexts = (await storage.get<Record<string, StoredContext>>(STORAGE_KEYS.CONTEXTS)) || {}
  const settings = await getSettings()
  const baseTime = context.updatedAt || Date.now()
  context.expiresAt = computeExpiryTimestamp(baseTime, settings.autoExpiryHours)
  contexts[context.id] = context
  await storage.set(STORAGE_KEYS.CONTEXTS, contexts)
}

/**
 * Records a save decision into the rolling 20-entry timeline (Design K).
 */
export async function recordSaveDecision(decision: SaveDecisionRecord): Promise<void> {
  try {
    const list = (await storage.get<SaveDecisionRecord[]>(STORAGE_KEYS.SAVE_TIMELINE)) || []
    list.unshift(decision)
    const trimmed = list.slice(0, 20)
    await storage.set(STORAGE_KEYS.SAVE_TIMELINE, trimmed)
  } catch {
    // Ignore storage failure for telemetry
  }
}

/**
 * Retrieves the rolling save timeline (Design K).
 */
export async function getSaveTimeline(): Promise<SaveDecisionRecord[]> {
  try {
    return (await storage.get<SaveDecisionRecord[]>(STORAGE_KEYS.SAVE_TIMELINE)) || []
  } catch {
    return []
  }
}

/**
 * Deletes a single context by its ID.
 */
export async function deleteContext(id: string): Promise<void> {
  const contexts = (await storage.get<Record<string, StoredContext>>(STORAGE_KEYS.CONTEXTS)) || {}
  delete contexts[id]
  await storage.set(STORAGE_KEYS.CONTEXTS, contexts)
}

/**
 * Wipes all stored contexts and cache (complete data purge).
 */
export async function clearAllData(): Promise<void> {
  await storage.set(STORAGE_KEYS.CONTEXTS, {})
  await storage.set(STORAGE_KEYS.MESSAGE_OWNERSHIP, {})
}

/**
 * Saves or updates debug telemetry for a specific platform.
 */
export async function saveDebugInfo(info: import("../types").PlatformDebugInfo): Promise<void> {
  const all = (await storage.get<Record<string, import("../types").PlatformDebugInfo>>(STORAGE_KEYS.DEBUG_TELEMETRY)) || {}
  all[info.platform] = info
  await storage.set(STORAGE_KEYS.DEBUG_TELEMETRY, all)
}

/**
 * Retrieves all saved platform debug telemetry for the popup diagnostics tab.
 */
export async function getAllDebugInfo(): Promise<Record<string, import("../types").PlatformDebugInfo>> {
  return (await storage.get<Record<string, import("../types").PlatformDebugInfo>>(STORAGE_KEYS.DEBUG_TELEMETRY)) || {}
}

/**
 * Marks that a context has been injected into a specific chat session.
 * Invariants:
 * 1. Keyed strictly by (platform, chatId, contextId).
 * 2. NEVER persists for new/empty chats or generic session IDs.
 * 3. Expired after ~10 minutes.
 */
export async function markChatInjected(
  platform: PlatformId,
  chatId: string,
  contextId: string
): Promise<void> {
  if (!platform || !chatId || !contextId) return
  if (isGenericOrNewChatId(chatId)) {
    // Directive 1: Injected state must never apply to new/empty chats.
    return
  }

  const map = (await storage.get<Record<string, InjectedRecord>>(STORAGE_KEYS.INJECTED_MAP)) || {}
  const now = Date.now()
  const key = `${platform}:${chatId}:${contextId}`

  map[key] = {
    platform,
    chatId,
    contextId,
    timestamp: now
  }

  // Prune any records older than 10 minutes (600,000 ms)
  const tenMinutesAgo = now - 10 * 60 * 1000
  for (const [k, rec] of Object.entries(map)) {
    if (!rec || !rec.timestamp || rec.timestamp < tenMinutesAgo || isGenericOrNewChatId(rec.chatId)) {
      delete map[k]
    }
  }

  await storage.set(STORAGE_KEYS.INJECTED_MAP, map)
}

/**
 * Retrieves unexpired injected records keyed by (platform, chatId, contextId).
 * Automatically prunes records older than 10 minutes.
 */
export async function getInjectedRecords(): Promise<Record<string, InjectedRecord>> {
  const map = (await storage.get<Record<string, InjectedRecord>>(STORAGE_KEYS.INJECTED_MAP)) || {}
  const now = Date.now()
  const tenMinutesAgo = now - 10 * 60 * 1000
  const validMap: Record<string, InjectedRecord> = {}
  let hasPruned = false

  for (const [k, rec] of Object.entries(map)) {
    if (
      rec &&
      typeof rec === "object" &&
      rec.timestamp &&
      rec.timestamp >= tenMinutesAgo &&
      !isGenericOrNewChatId(rec.chatId)
    ) {
      validMap[k] = rec
    } else {
      hasPruned = true
    }
  }

  if (hasPruned) {
    await storage.set(STORAGE_KEYS.INJECTED_MAP, validMap)
  }

  return validMap
}

/**
 * Legacy compatibility wrapper: returns a map of `${platform}:${chatId}` -> contextId.
 */
export async function getInjectedMap(): Promise<Record<string, string>> {
  const records = await getInjectedRecords()
  const simpleMap: Record<string, string> = {}
  for (const rec of Object.values(records)) {
    simpleMap[rec.chatId] = rec.contextId
    simpleMap[`${rec.platform}:${rec.chatId}`] = rec.contextId
  }
  return simpleMap
}

/**
 * Checks whether a context (or any context) has been injected into a chat session within the last 10 minutes.
 */
export function isInjected(
  records: Record<string, InjectedRecord>,
  platform: PlatformId,
  chatId: string,
  contextId?: string
): boolean {
  if (!platform || !chatId || isGenericOrNewChatId(chatId)) return false
  const now = Date.now()
  const tenMinutesAgo = now - 10 * 60 * 1000

  if (contextId) {
    const key = `${platform}:${chatId}:${contextId}`
    const rec = records[key]
    return Boolean(rec && rec.timestamp && rec.timestamp >= tenMinutesAgo)
  }

  return Object.values(records).some(
    (rec) =>
      rec.platform === platform &&
      rec.chatId === chatId &&
      rec.timestamp &&
      rec.timestamp >= tenMinutesAgo
  )
}

/**
 * Retrieves the token usage telemetry for the current day.
 */
export async function getTokenTelemetry(): Promise<TokenUsageTelemetry> {
  const settings = await getSettings()
  const hasKey = Boolean(settings.geminiApiKey || settings.openaiApiKey)
  const todayStr = new Date().toISOString().slice(0, 10)
  const defaultTelemetry: TokenUsageTelemetry = {
    tokensToday: 0,
    lastCallTokens: 0,
    lastCallTimestamp: 0,
    dailyCapTokens: settings.dailyCapTokens || 50000,
    dateString: todayStr
  }

  // In Local Mode (no API key configured), API token counts strictly stay 0 (Directive 4)
  if (!hasKey) {
    return defaultTelemetry
  }

  const raw = await storage.get<TokenUsageTelemetry>(STORAGE_KEYS.TOKEN_USAGE)
  if (!raw) return defaultTelemetry

  // If new day, reset tokensToday
  if (raw.dateString !== todayStr) {
    const resetTelemetry: TokenUsageTelemetry = {
      ...raw,
      tokensToday: 0,
      dateString: todayStr,
      dailyCapTokens: settings.dailyCapTokens || 50000
    }
    await storage.set(STORAGE_KEYS.TOKEN_USAGE, resetTelemetry)
    return resetTelemetry
  }

  return {
    ...defaultTelemetry,
    ...raw,
    dailyCapTokens: settings.dailyCapTokens || 50000
  }
}

/**
 * Records token consumption and updates daily usage telemetry.
 */
export async function recordTokenUsage(tokens: number): Promise<TokenUsageTelemetry> {
  const settings = await getSettings()
  const hasKey = Boolean(settings.geminiApiKey || settings.openaiApiKey)
  if (!hasKey) {
    return getTokenTelemetry()
  }

  const current = await getTokenTelemetry()
  const updated: TokenUsageTelemetry = {
    ...current,
    tokensToday: current.tokensToday + tokens,
    lastCallTokens: tokens,
    lastCallTimestamp: Date.now()
  }
  await storage.set(STORAGE_KEYS.TOKEN_USAGE, updated)
  return updated
}

/**
 * Retrieves the preferred density mode ("compact" | "standard" | "full").
 */
export async function getDensityMode(): Promise<InjectionDensityMode> {
  const mode = await storage.get<InjectionDensityMode>(STORAGE_KEYS.DENSITY_MODE)
  if (mode === "compact" || mode === "standard" || mode === "full") {
    return mode
  }
  return "standard"
}

/**
 * Saves the preferred density mode.
 */
export async function setDensityMode(mode: InjectionDensityMode): Promise<void> {
  await storage.set(STORAGE_KEYS.DENSITY_MODE, mode)
}

/**
 * Retrieves the persistent map of messageId -> chatId (Phase 2 Requirement 3).
 */
export async function getMessageOwnership(): Promise<Record<string, string>> {
  try {
    return (await storage.get<Record<string, string>>(STORAGE_KEYS.MESSAGE_OWNERSHIP)) || {}
  } catch {
    return {}
  }
}

/**
 * Validates turn ownership against the persistent messageId -> chatId map (Phase 2 Requirement 3).
 * Drops turns whose message ID was previously claimed by another chat.
 * Claims unseen turns for currentChatId.
 */
export async function filterTurnsByMessageOwnership(
  turns: MessageTurn[],
  currentChatId: string
): Promise<{
  validTurns: MessageTurn[]
  foreignCount: number
  droppedTurns: DroppedTurnDiagnostic[]
  totalReceived: number
  totalKept: number
  status: "OK" | "NOT_READY_YET"
}> {
  if (!turns || turns.length === 0 || !currentChatId) {
    return {
      validTurns: [],
      foreignCount: 0,
      droppedTurns: [],
      totalReceived: turns?.length || 0,
      totalKept: 0,
      status: "OK"
    }
  }

  const ownership = await getMessageOwnership()
  let modified = false
  const validTurns: MessageTurn[] = []
  const droppedTurns: DroppedTurnDiagnostic[] = []
  let foreignCount = 0

  for (const turn of turns) {
    const msgId = turn.id
    if (msgId && ownership[msgId]) {
      if (ownership[msgId] !== currentChatId) {
        // If stored owner was an active temporary ID, update ownership to the new permalink ID
        if (ownership[msgId].startsWith("active-") || isGenericOrNewChatId(ownership[msgId])) {
          ownership[msgId] = currentChatId
          modified = true
        } else {
          foreignCount++
          droppedTurns.push({
            turnId: msgId,
            idSourceAttr: turn.idSourceAttr || "unknown",
            role: turn.role,
            storedOwnerChatId: ownership[msgId],
            currentChatId,
            textLength: (turn.text || "").length
          })
          continue // Foreign turn owned by another chat! Drop!
        }
      }
    } else if (msgId) {
      // Guard (c): Never assign a message id to a chat id different from the chat whose DOM it was read from.
      if (
        turn.conversationId &&
        !turn.conversationId.startsWith("local-") &&
        turn.conversationId !== currentChatId
      ) {
        foreignCount++
        droppedTurns.push({
          turnId: msgId,
          idSourceAttr: turn.idSourceAttr || "unknown",
          role: turn.role,
          storedOwnerChatId: turn.conversationId,
          currentChatId,
          textLength: (turn.text || "").length
        })
        continue
      }
      ownership[msgId] = currentChatId
      modified = true
    }
    turn.chatId = currentChatId
    validTurns.push(turn)
  }

  if (modified) {
    await storage.set(STORAGE_KEYS.MESSAGE_OWNERSHIP, ownership)
  }

  const status = foreignCount > 0 && validTurns.length === 0 ? "NOT_READY_YET" : "OK"

  return {
    validTurns,
    foreignCount,
    droppedTurns,
    totalReceived: turns.length,
    totalKept: validTurns.length,
    status
  }
}

/**
 * Cleans up invalid or legacy entries on startup (Phase 2 Requirement 5).
 * Removes any stored entry whose chatId is not a real id (session_..., local-..., new, or empty),
 * and ensures all turns in valid contexts carry the real chatId.
 */
export async function cleanupGarbageContexts(): Promise<{ removedCount: number }> {
  try {
    const raw = (await storage.get<Record<string, StoredContext>>(STORAGE_KEYS.CONTEXTS)) || {}
    let removedCount = 0
    const cleaned: Record<string, StoredContext> = {}

    for (const [id, ctx] of Object.entries(raw)) {
      if (!ctx.chatId || isGenericOrNewChatId(ctx.chatId) || ctx.chatId === "new") {
        removedCount++
        continue
      }
      if (ctx.turns && ctx.turns.length > 0) {
        ctx.turns = ctx.turns.filter((t) => t.chatId === ctx.chatId || !t.chatId)
        ctx.turns.forEach((t) => (t.chatId = ctx.chatId))
      }
      cleaned[id] = ctx
    }

    if (removedCount > 0) {
      await storage.set(STORAGE_KEYS.CONTEXTS, cleaned)
    }
    return { removedCount }
  } catch {
    return { removedCount: 0 }
  }
}

/**
 * Generates a brand-new random temporary session ID (legacy helper).
 */
export function mintTemporarySessionId(): string {
  return "session_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9)
}

/**
 * Checks whether an error or environment is due to extension context invalidation.
 */
export function isContextInvalidated(err?: any): boolean {
  if (typeof chrome === "undefined" || !chrome.runtime?.id) {
    return true
  }
  return Boolean(
    err?.message &&
      (err.message.includes("Extension context invalidated") ||
        err.message.includes("context invalidated"))
  )
}

/**
 * Migrates any fallback or ephemeral chat session entries when a real permalink ID is minted.
 * Invariant (Requirement 3): ONLY touches TEMPORARY entries of the current tab session,
 * and NEVER an entry with a different real chatId.
 * Deletes the old temporary entries from storage and returns the migrated IDs.
 */
export async function migrateTemporarySessions(
  newContextId: string,
  payload: {
    sourcePlatform: PlatformId
    chatId: string
    chatTitle?: string
    clientSessionId?: string
    rawTranscript?: string
    turns?: MessageTurn[]
  },
  allContexts: StoredContext[]
): Promise<string[]> {
  const deletedIds: string[] = []
  if (isGenericOrNewChatId(payload.chatId)) {
    return deletedIds
  }

  const candidateTemporarySessions = allContexts.filter((c) => {
    // 1. Must match source platform
    if (c.sourcePlatform !== payload.sourcePlatform) return false
    // 2. Never delete the new context itself
    if (c.id === newContextId || c.chatId === payload.chatId) return false

    // Invariant (Requirement 3): migrateTemporarySessions ONLY touches TEMPORARY entries,
    // and NEVER an entry with a real chatId!
    if (!isGenericOrNewChatId(c.chatId) && !c.chatId.startsWith("active-")) {
      return false
    }

    // 3. Direct client session match of the current tab session
    if (
      payload.clientSessionId &&
      (c.clientSessionId === payload.clientSessionId || c.chatId === payload.clientSessionId)
    ) {
      return true
    }

    // 4. Fallback for un-sessioned temporary entries: verified via non-default title or transcript overlap
    if (
      c.chatTitle &&
      payload.chatTitle &&
      c.chatTitle === payload.chatTitle &&
      c.chatTitle !== "New chat" &&
      c.chatTitle !== "ChatGPT Conversation" &&
      c.chatTitle !== "Active Discussion"
    ) {
      return true
    }

    if (payload.rawTranscript && c.rawTranscript && c.rawTranscript.length >= 15) {
      const sample = c.rawTranscript.slice(0, 50).trim()
      if (sample && payload.rawTranscript.includes(sample)) return true
    }

    if (
      payload.turns?.[0]?.text &&
      payload.turns[0].text.trim().length >= 10 &&
      c.rawTranscript?.includes(payload.turns[0].text.trim().slice(0, 35))
    ) {
      return true
    }

    return false
  })

  for (const tempCtx of candidateTemporarySessions) {
    console.debug(`[ContextBridge Storage] Migrating temporary context '${tempCtx.id}' -> '${newContextId}'`)
    await deleteContext(tempCtx.id)
    deletedIds.push(tempCtx.id)
  }

  return deletedIds
}

