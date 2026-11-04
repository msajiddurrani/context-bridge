import { Storage } from "@plasmohq/storage"
import {
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  type DroppedTurnDiagnostic,
  type InjectionDensityMode,
  type InjectionFormat,
  type MessageTurn,
  type SaveDecisionRecord,
  type StoredContext,
  type UserSettings
} from "../types"
import { isGenericOrNewChatId } from "./context-filter"
import type { InjectedRecord, PlatformId } from "../types"

const storage = new Storage({ area: "local" })

/**
 * Retrieves the user settings (auto-expiry, auto-import, handover style).
 */
export async function getSettings(): Promise<UserSettings> {
  const settings = await storage.get<UserSettings>(STORAGE_KEYS.SETTINGS)
  return { ...DEFAULT_SETTINGS, ...settings }
}

/**
 * Saves user settings.
 */
export async function saveSettings(settings: Partial<UserSettings>): Promise<UserSettings> {
  const current = await getSettings()
  const updated = { ...current, ...settings }
  await storage.set(STORAGE_KEYS.SETTINGS, updated)
  return updated
}

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
    // Purge any legacy temporary or invalid entries immediately
    if (
      !context.chatId ||
      context.chatId === "new" ||
      context.chatId.startsWith("active-") ||
      context.chatId.startsWith("session_") ||
      context.chatId.startsWith("local-") ||
      isGenericOrNewChatId(context.chatId)
    ) {
      hasPruned = true
      continue
    }

    // Pinned contexts NEVER expire
    if (context.isPinned) {
      prunedMap[id] = context
      validContexts.push(context)
      continue
    }

    // Prune if expired
    if (context.expiresAt && context.expiresAt > 0 && context.expiresAt <= now) {
      hasPruned = true
      continue
    }

    prunedMap[id] = context
    validContexts.push(context)
  }

  if (hasPruned) {
    await storage.set(STORAGE_KEYS.CONTEXTS, prunedMap)
  }

  // Sort: pinned first, then newest updatedAt first
  return validContexts.sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1
    if (!a.isPinned && b.isPinned) return 1
    return b.updatedAt - a.updatedAt
  })
}

/**
 * Saves or updates a conversation context in local storage.
 * Enforces atomic state, auto-expiry TTL, and preserves pinned flags.
 */
export async function saveContext(context: StoredContext): Promise<void> {
  const contexts = (await storage.get<Record<string, StoredContext>>(STORAGE_KEYS.CONTEXTS)) || {}
  const existing = contexts[context.id]
  const now = Date.now()

  const isPinned = context.isPinned !== undefined ? context.isPinned : existing?.isPinned ?? false
  const settings = await getSettings()
  const defaultHours = context.isImported ? 7 * 24 : settings.autoExpiryHours > 0 ? settings.autoExpiryHours : 24
  const expiresAt = context.expiresAt && context.expiresAt > 0
    ? context.expiresAt
    : now + defaultHours * 60 * 60 * 1000

  const sanitized: StoredContext = {
    ...context,
    isPinned,
    expiresAt,
    updatedAt: now,
    createdAt: existing?.createdAt || context.createdAt || now,
    summaryMode: "local"
  }

  contexts[context.id] = sanitized
  await storage.set(STORAGE_KEYS.CONTEXTS, contexts)
}

/**
 * Toggles the pinned status of a context. Pinned contexts never auto-expire.
 */
export async function togglePinContext(id: string): Promise<boolean> {
  const contexts = (await storage.get<Record<string, StoredContext>>(STORAGE_KEYS.CONTEXTS)) || {}
  const ctx = contexts[id]
  if (!ctx) return false

  const newPinned = !ctx.isPinned
  ctx.isPinned = newPinned
  ctx.updatedAt = Date.now()
  contexts[id] = ctx
  await storage.set(STORAGE_KEYS.CONTEXTS, contexts)
  return newPinned
}

export async function cleanupExpiredContexts(): Promise<{ prunedCount: number }> {
  const contexts = (await storage.get<Record<string, StoredContext>>(STORAGE_KEYS.CONTEXTS)) || {}
  const now = Date.now()
  let prunedCount = 0
  const kept: Record<string, StoredContext> = {}

  for (const [id, ctx] of Object.entries(contexts)) {
    if (ctx.isPinned) {
      kept[id] = ctx
      continue
    }
    if (ctx.expiresAt && ctx.expiresAt <= now) {
      prunedCount++
      continue
    }
    kept[id] = ctx
  }

  if (prunedCount > 0) {
    await storage.set(STORAGE_KEYS.CONTEXTS, kept)
  }

  return { prunedCount }
}

/**
 * Records an individual auto-save decision in the persistent audit timeline.
 */
export async function recordSaveDecision(decision: SaveDecisionRecord): Promise<void> {
  try {
    const timeline = (await storage.get<SaveDecisionRecord[]>(STORAGE_KEYS.SAVE_TIMELINE)) || []
    timeline.unshift(decision)
    // Retain up to 50 recent decisions
    const trimmed = timeline.slice(0, 50)
    await storage.set(STORAGE_KEYS.SAVE_TIMELINE, trimmed)
  } catch (err) {
    console.warn(`[ContextBridge Storage] Failed to record save decision:`, err)
  }
}

/**
 * Retrieves the recorded save decision audit timeline.
 */
export async function getSaveTimeline(): Promise<SaveDecisionRecord[]> {
  try {
    return (await storage.get<SaveDecisionRecord[]>(STORAGE_KEYS.SAVE_TIMELINE)) || []
  } catch {
    return []
  }
}

/**
 * Deletes a single context by its ID and cleans up associated injection references.
 */
export async function deleteContext(id: string): Promise<void> {
  const contexts = (await storage.get<Record<string, StoredContext>>(STORAGE_KEYS.CONTEXTS)) || {}
  delete contexts[id]
  await storage.set(STORAGE_KEYS.CONTEXTS, contexts)

  // Prune any injected map records pointing to this deleted context
  try {
    const map = (await storage.get<Record<string, InjectedRecord>>(STORAGE_KEYS.INJECTED_MAP)) || {}
    let modified = false
    for (const [k, rec] of Object.entries(map)) {
      if (rec?.contextId === id) {
        delete map[k]
        modified = true
      }
    }
    if (modified) {
      await storage.set(STORAGE_KEYS.INJECTED_MAP, map)
    }
  } catch {
    // Ignore injection map cleanup errors
  }
}

/**
 * Wipes all conversation contexts and chat timeline data while strictly preserving
 * user settings, density mode, and injection format preferences.
 */
export async function clearAllConversationData(): Promise<void> {
  await storage.set(STORAGE_KEYS.CONTEXTS, {})
  await storage.set(STORAGE_KEYS.MESSAGE_OWNERSHIP, {})
  await storage.set(STORAGE_KEYS.SAVE_TIMELINE, [])
  await storage.set(STORAGE_KEYS.INJECTED_MAP, {})
  await storage.set(STORAGE_KEYS.DEBUG_TELEMETRY, {})
}

// Backwards compatibility alias
export const clearAllData = clearAllConversationData

/**
 * Complete Factory Reset: Wipes ALL extension data including settings, health,
 * diagnostics, timeline, message ownership, and obsolete legacy keys.
 * Restores clean default settings.
 */
export async function resetAllExtensionData(): Promise<void> {
  // Wipe all known active keys
  await storage.set(STORAGE_KEYS.CONTEXTS, {})
  await storage.set(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS)
  await storage.set(STORAGE_KEYS.HEALTH, {})
  await storage.set(STORAGE_KEYS.DEBUG_TELEMETRY, {})
  await storage.set(STORAGE_KEYS.INJECTED_MAP, {})
  await storage.set(STORAGE_KEYS.DENSITY_MODE, "standard")
  await storage.set(STORAGE_KEYS.INJECTION_FORMAT, "markdown")
  await storage.set(STORAGE_KEYS.SAVE_TIMELINE, [])
  await storage.set(STORAGE_KEYS.MESSAGE_OWNERSHIP, {})

  // Purge any legacy obsolete storage keys
  try {
    await storage.remove("context_bridge_token_usage")
    await storage.remove("context_bridge_openrouter_models_cache")
    await storage.remove("context_bridge_last_error")
  } catch {
    // Ignore removal of non-existent legacy keys
  }
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
 * Checks whether a context was recently injected into the specified chat session.
 */
export async function isChatRecentlyInjected(
  platform: PlatformId,
  chatId: string,
  contextId?: string
): Promise<boolean> {
  if (!platform || !chatId) return false
  if (isGenericOrNewChatId(chatId)) return false

  const records = (await storage.get<Record<string, InjectedRecord>>(STORAGE_KEYS.INJECTED_MAP)) || {}
  const tenMinutesAgo = Date.now() - 10 * 60 * 1000

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
 * Retrieves the preferred density mode ("compact" | "standard" | "full").
 */
export async function getDensityMode(): Promise<InjectionDensityMode> {
  const mode = await storage.get<InjectionDensityMode>(STORAGE_KEYS.DENSITY_MODE)
  if (mode === "compact" || mode === "standard" || mode === "full" || mode === "smart" || mode === "complete" || mode === "download") {
    return mode
  }
  return "complete"
}

/**
 * Saves the preferred density mode.
 */
export async function setDensityMode(mode: InjectionDensityMode): Promise<void> {
  await storage.set(STORAGE_KEYS.DENSITY_MODE, mode)
}

/**
 * Retrieves the preferred injection format ("markdown" | "xml").
 * Defaults to "markdown" (.md) for high-density, rich LLM context transfer.
 */
export async function getInjectionFormat(): Promise<InjectionFormat> {
  try {
    const format = await storage.get<InjectionFormat>(STORAGE_KEYS.INJECTION_FORMAT)
    if (format === "markdown" || format === "xml") {
      return format
    }
    return "markdown"
  } catch {
    return "markdown"
  }
}

/**
 * Saves the preferred injection format.
 */
export async function setInjectionFormat(format: InjectionFormat): Promise<void> {
  await storage.set(STORAGE_KEYS.INJECTION_FORMAT, format)
}

/**
 * Retrieves the persistent map of messageId -> chatId.
 */
export async function getMessageOwnership(): Promise<Record<string, string>> {
  try {
    return (await storage.get<Record<string, string>>(STORAGE_KEYS.MESSAGE_OWNERSHIP)) || {}
  } catch {
    return {}
  }
}

/**
 * Validates turn ownership against the persistent messageId -> chatId map.
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
          continue
        }
      }
    } else if (msgId) {
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
 * Cleans up invalid or legacy entries on startup.
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
      // Prune ghost chats captured from background prefetch where chatId mismatches page sourceUrl
      if (ctx.sourceUrl && ctx.chatId && !ctx.isPinned) {
        const urlMatch = ctx.sourceUrl.match(/\/(?:chat|c|app)\/([a-zA-Z0-9_-]+)/)
        if (urlMatch && urlMatch[1] && urlMatch[1] !== ctx.chatId) {
          removedCount++
          continue
        }
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
    if (c.sourcePlatform !== payload.sourcePlatform) return false
    if (c.id === newContextId || c.chatId === payload.chatId) return false

    if (!isGenericOrNewChatId(c.chatId) && !c.chatId.startsWith("active-")) {
      return false
    }

    if (
      payload.clientSessionId &&
      (c.clientSessionId === payload.clientSessionId || c.chatId === payload.clientSessionId)
    ) {
      return true
    }

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

/**
 * Retrieves all injected records mapping.
 */
export async function getInjectedRecords(): Promise<Record<string, InjectedRecord>> {
  return (await storage.get<Record<string, InjectedRecord>>(STORAGE_KEYS.INJECTED_MAP)) || {}
}

/**
 * Checks if a chat was recently injected with context.
 */
export function isInjected(
  records: Record<string, InjectedRecord>,
  platform: PlatformId,
  chatId: string,
  contextId?: string
): boolean {
  if (!records || !platform || !chatId) return false
  if (isGenericOrNewChatId(chatId)) return false

  const tenMinutesAgo = Date.now() - 10 * 60 * 1000

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
 * Computes an expiration timestamp based on base timestamp and configured retention hours.
 */
export function computeExpiryTimestamp(baseTime: number, hours?: number): number {
  const h = hours && hours > 0 ? hours : 24
  return baseTime + h * 3600 * 1000
}

/**
 * Token telemetry representation (strictly 0 in 100% local non-AI mode).
 */
export async function getTokenTelemetry(): Promise<import("../types").TokenUsageTelemetry> {
  return {
    tokensToday: 0,
    lastCallTokens: 0,
    lastCallTimestamp: 0,
    dailyCapTokens: 0,
    dateString: new Date().toISOString().slice(0, 10)
  }
}

export async function recordTokenUsage(tokens: number): Promise<import("../types").TokenUsageTelemetry> {
  return getTokenTelemetry()
}
