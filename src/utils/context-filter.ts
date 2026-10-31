import type {
  InjectedRecord,
  PlatformId,
  ProviderSettings,
  SaveDiagnosticInfo,
  StoredContext
} from "../types"
import { isInjected } from "./storage-manager"

/**
 * 15-minute recency window for smart session switch suggestions.
 */
export const HANDOFF_SUGGESTION_RECENCY_MS = 15 * 60 * 1000

/**
 * Finds the most recent eligible context for cross-platform session handoff.
 * Triggers when switching to an empty or fresh chat within 15 minutes of working on another AI platform.
 */
export function findRecentSwitchSuggestion(
  contexts: StoredContext[],
  currentPlatform: PlatformId,
  currentChatId: string = "",
  settings?: ProviderSettings,
  now: number = Date.now()
): StoredContext | null {
  if (settings && settings.showSwitchSuggestions === false) {
    return null
  }

  if (!contexts || contexts.length === 0) {
    return null
  }

  // Filter contexts from other platforms, or different chats, within the 15-minute window
  const eligible = contexts.filter((ctx) => {
    // Cannot suggest self (same platform and same chat ID)
    if (ctx.sourcePlatform === currentPlatform && currentChatId && ctx.chatId === currentChatId) {
      return false
    }

    // Must be recently active within the recency window
    const timestamp = ctx.updatedAt || ctx.createdAt || 0
    if (now - timestamp > HANDOFF_SUGGESTION_RECENCY_MS) {
      return false
    }

    // Must have a meaningful title/objective
    if (isGenericOrNewChatId(ctx.chatId)) {
      return false
    }

    return true
  })

  if (eligible.length === 0) return null

  // Return the most recently updated context
  eligible.sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
  return eligible[0]
}


/**
 * Checks whether a chatId represents a new, uninitialized, or generic conversation.
 */
export function isGenericOrNewChatId(chatId: string): boolean {
  if (!chatId) return true
  const clean = chatId.trim().toLowerCase()
  return (
    clean === "" ||
    clean === "new" ||
    clean === "/" ||
    clean === "default" ||
    clean.startsWith("default-") ||
    clean.startsWith("session-") ||
    clean.startsWith("session_") ||
    clean.startsWith("local-") ||
    clean.startsWith("local_") ||
    clean.includes("local-chatgpt") ||
    clean.endsWith("-session") ||
    clean === "chatgpt-session" ||
    clean === "claude-session"
  )
}

/**
 * Filters and sorts stored contexts for the UI injection panel.
 * Invariants:
 * 1. Panel list = all unexpired contexts except the current chat's (platform + chatId).
 * 2. On new/empty chats, NEVER filter anything.
 * 3. The injected flag must NEVER hide a context from the list. It only labels it.
 * 4. Sorted by updatedAt descending (most recent first).
 */
export function filterEligibleContexts(
  contexts: StoredContext[],
  currentPlatform: PlatformId,
  currentChatId: string,
  isNewChat: boolean,
  now: number = Date.now()
): StoredContext[] {
  const isCurrentNew = isNewChat || isGenericOrNewChatId(currentChatId)

  return contexts
    .filter((c) => {
      // 1. Must be unexpired
      if (c.expiresAt && typeof c.expiresAt === "number" && c.expiresAt > 0 && c.expiresAt <= now) {
        return false
      }

      // 2. On new or empty chats, show ALL unexpired contexts without filtering
      if (isCurrentNew) {
        return true
      }

      // 3. Loop prevention on an active existing chat: exclude ONLY if exact same platform AND chatId
      const isSameChat = c.sourcePlatform === currentPlatform && c.chatId === currentChatId
      return !isSameChat
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export interface TurnDiagnosticItem {
  index: number
  role: "user" | "assistant" | "system"
  preview: string
  codeBlocksCount: number
  sourceChatId: string
}

export interface ContextDiagnosticItem {
  contextId: string
  sourcePlatform: PlatformId
  chatId: string
  isTemporary: boolean
  clientSessionId?: string
  createdAt: number
  updatedAt: number
  expiresAt: number
  goal: string
  turnsCount: number
  turnsSummary: string
  turnsBreakdown: TurnDiagnosticItem[]
  isExpired: boolean
  isSameChat: boolean
  isInjected: boolean
  eligible: boolean
  statusLabel: string
  reason: string
  lastSaveDiagnostic?: SaveDiagnosticInfo
}

export interface ContextFilterDiagnostics {
  totalStored: number
  eligibleCount: number
  excludedCount: number
  currentPlatform: PlatformId | "unknown"
  currentChatId: string
  isNewChat: boolean
  items: ContextDiagnosticItem[]
}

/**
 * Diagnostic analysis of stored contexts vs active chat tab.
 * Invariant: ZERO CHAT TEXT. Only metadata, timestamps, and explicit filtering reasons.
 */
export function diagnoseContexts(
  contexts: StoredContext[],
  currentPlatform: PlatformId | "unknown",
  currentChatId: string,
  isNewChat: boolean,
  injectedRecords: Record<string, InjectedRecord> = {}
): ContextFilterDiagnostics {
  const isCurrentNew = isNewChat || isGenericOrNewChatId(currentChatId)
  const now = Date.now()

  const items: ContextDiagnosticItem[] = contexts.map((c) => {
    const isExpired = Boolean(
      c.expiresAt && typeof c.expiresAt === "number" && c.expiresAt > 0 && c.expiresAt <= now
    )
    const isSameChat =
      !isCurrentNew &&
      currentPlatform !== "unknown" &&
      c.sourcePlatform === currentPlatform &&
      c.chatId === currentChatId

    const injected =
      currentPlatform !== "unknown"
        ? isInjected(injectedRecords, currentPlatform as PlatformId, currentChatId, c.id)
        : false

    let eligible = true
    let statusLabel = "ELIGIBLE"
    let reason = "Eligible for injection into active conversation"

    if (isExpired) {
      eligible = false
      statusLabel = "EXCLUDED (EXPIRED)"
      reason = `Excluded: Context TTL expired at ${new Date(c.expiresAt).toLocaleTimeString()}`
    } else if (isSameChat) {
      eligible = false
      statusLabel = "EXCLUDED (SAME CHAT)"
      reason = `Excluded: Same chat loop prevention (sourcePlatform: ${c.sourcePlatform}, chatId: ${c.chatId})`
    } else if (injected) {
      statusLabel = "ELIGIBLE (INJECTED)"
      reason = "Eligible (Labeled: already injected into this chat in last 10 minutes)"
    }

    const isTemporary = isGenericOrNewChatId(c.chatId)
    const turns = c.turns || []
    const userTurns = turns.filter((t) => t.role === "user").length
    const asstTurns = turns.filter((t) => t.role === "assistant").length
    const turnsSummary = `${turns.length} turns (${userTurns} user, ${asstTurns} assistant)`
    const goal = (c.stateMemory?.objective || "").trim().slice(0, 120)

    const turnsBreakdown: TurnDiagnosticItem[] = turns.map((t, idx) => ({
      index: idx + 1,
      role: t.role,
      preview: (t.text || "").replace(/\s+/g, " ").trim().slice(0, 80),
      codeBlocksCount: t.codeBlocks ? t.codeBlocks.length : 0,
      sourceChatId: c.chatId
    }))

    return {
      contextId: c.id,
      sourcePlatform: c.sourcePlatform,
      chatId: c.chatId,
      isTemporary,
      clientSessionId: c.clientSessionId,
      createdAt: c.createdAt || c.updatedAt,
      updatedAt: c.updatedAt,
      expiresAt: c.expiresAt,
      goal,
      turnsCount: turns.length,
      turnsSummary,
      turnsBreakdown,
      isExpired,
      isSameChat,
      isInjected: injected,
      eligible,
      statusLabel,
      reason,
      lastSaveDiagnostic: c.lastSaveDiagnostic
    }
  })

  const eligibleCount = items.filter((i) => i.eligible).length
  const excludedCount = items.filter((i) => !i.eligible).length

  return {
    totalStored: contexts.length,
    eligibleCount,
    excludedCount,
    currentPlatform,
    currentChatId,
    isNewChat: isCurrentNew,
    items
  }
}
