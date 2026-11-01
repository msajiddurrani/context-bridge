import type { PlatformAdapter } from "../adapters/types"
import type {
  CanonicalStatistics,
  MessageTurn,
  MissingHistoryInfo,
  PlatformId,
  StoredContext,
  VerbatimCodeBlock
} from "../types"
import {
  computeConversationStatistics,
  deduplicateCodeBlocks,
  mergeTurnsForSameChat
} from "./local-mode"
import { stripInjectedContext } from "./prompt-formatter"

export interface InstantCaptureOptions {
  adapter: PlatformAdapter
  doc: Document
  chatId: string
  chatTitle: string
  sourceUrl: string
  storedTurns?: MessageTurn[]
  storedCodeBlocks?: VerbatimCodeBlock[]
}

export interface InstantCaptureResult {
  success: boolean
  chatId: string
  sourcePlatform: PlatformId
  chatTitle: string
  sourceUrl: string
  turns: MessageTurn[]
  codeBlocks: VerbatimCodeBlock[]
  rawTranscript: string
  statistics: CanonicalStatistics
  completeness: "complete" | "viewport_only" | "partial"
  missingHistoryInfo?: MissingHistoryInfo
  durationMs: number
}

/**
 * Fast, one-operation full-conversation capture without any webpage scrolling.
 * Reads currently available DOM messages in one synchronous pass,
 * merges them with previously stored messages, calculates canonical statistics,
 * and assesses completeness honestly.
 */
export function captureCompleteConversation(
  options: InstantCaptureOptions
): InstantCaptureResult {
  const startTime = Date.now()
  const { adapter, doc, chatId, chatTitle, sourceUrl, storedTurns = [], storedCodeBlocks = [] } = options

  // 1. Instantaneous synchronous read of currently mounted DOM messages (0 scrolling)
  const currentDomTurns = adapter.getMessages(doc)
  const safeStored = storedTurns.map((t) => ({ ...t, chatId: t.chatId || chatId }))
  const safeDom = currentDomTurns.map((t) => ({ ...t, chatId: t.chatId || chatId }))

  // 2. Merge stored and DOM turns without losing earlier history
  const mergedTurns = mergeTurnsForSameChat(safeStored, safeDom)

  // 3. Extract and deduplicate all verbatim code blocks
  const allCodeBlocks: VerbatimCodeBlock[] = deduplicateCodeBlocks([
    ...storedCodeBlocks,
    ...mergedTurns.flatMap((t) => t.codeBlocks || [])
  ])

  // 4. Honest completeness assessment
  let completeness: "complete" | "viewport_only" | "partial" = "complete"
  let missingHistoryInfo: MissingHistoryInfo | undefined

  // If the conversation was never observed before and DOM only mounts a small window
  // with an indicator that earlier turns exist:
  const firstTurn = mergedTurns[0]
  const isTurnOneProbable =
    firstTurn &&
    (firstTurn.role === "user" ||
      adapter.isNewOrEmptyChat(doc) ||
      mergedTurns.length >= 10 ||
      storedTurns.length > 0)

  if (storedTurns.length === 0 && mergedTurns.length > 0 && !isTurnOneProbable) {
    completeness = "viewport_only"
    missingHistoryInfo = {
      hasMissingEarlierMessages: true,
      notice: "Captured active viewport messages. Earlier historical messages in this chat were not active in this session."
    }
  }

  // 5. Calculate canonical statistics using single shared engine
  const statistics = computeConversationStatistics(mergedTurns, allCodeBlocks, completeness)

  // 6. Build clean verbatim transcript
  const rawTranscript = mergedTurns
    .map((t) => `${t.role.toUpperCase()}:\n${stripInjectedContext(t.text || "")}`)
    .join("\n\n---\n\n")

  const durationMs = Date.now() - startTime

  return {
    success: mergedTurns.length > 0,
    chatId,
    sourcePlatform: adapter.id,
    chatTitle: chatTitle || adapter.getChatTitle(doc) || "Technical Session",
    sourceUrl,
    turns: mergedTurns,
    codeBlocks: allCodeBlocks,
    rawTranscript,
    statistics,
    completeness,
    missingHistoryInfo,
    durationMs
  }
}

