/**
 * Context Bridge - Core Domain Types & Schemas
 * 100% Local-First Architecture (Non-AI)
 */

export type PlatformId = "claude" | "chatgpt" | "gemini"

export interface VerbatimCodeBlock {
  id: string
  language: string
  code: string
  turnIndex: number
  filePath?: string
}

export type InjectionMode = "compact" | "standard" | "smart" | "complete" | "download" | "full"
export type InjectionDensityMode = InjectionMode
export type InjectionFormat = "markdown" | "xml"
export type AfterInjectBehavior = "focus" | "keep" | "minimize"

export interface CompactSummary {
  goal?: string
  stack?: string[]
  decisions?: string[]
  state?: string
  open?: string[]
  next?: string[]
}

/**
 * Token usage telemetry representation (always 0 in 100% local mode).
 */
export interface TokenUsageTelemetry {
  tokensToday: number
  lastCallTokens: number
  lastCallTimestamp: number
  dailyCapTokens: number
  dateString: string
}

/**
 * Neutral StateMemory JSON format.
 * Code blocks are stored strictly VERBATIM; conversation is structured deterministically offline.
 */
export interface StateMemory {
  version: "1.0"
  objective: string // goal (first user message, trimmed)
  techStack: string[] // stack
  architectureDecisions: string[] // decisions
  currentWork: string // state (last exchanges or dense summary)
  blockersAndErrors: string[] // open issues / blockers
  nextSteps: string[] // next immediate steps
  criticalSnippets: VerbatimCodeBlock[]
  rawTokenEstimate: number
  isAiSynthesized?: boolean
  compactSummary?: CompactSummary
  summarizedAt?: number
  metadata?: {
    imported?: boolean
    [key: string]: any
  }
}

export interface CanonicalStatistics {
  messageCount: number // Total individual turns (userCount + assistantCount)
  userCount: number // Total user messages
  assistantCount: number // Total assistant messages
  exchangeCount: number // Paired user-assistant interaction rounds
  codeBlockCount: number // Total verbatim code blocks
  wordCount: number // Exact count of whitespace-delimited words across all texts & code
  charCount: number // Total character count
  firstMessageTimestamp?: number
  lastMessageTimestamp?: number
  completeness: "complete" | "viewport_only" | "partial"
}

export interface MissingHistoryInfo {
  hasMissingEarlierMessages: boolean
  firstCapturedSequence?: number
  expectedStart?: number
  notice?: string
}

export interface InjectedRecord {
  platform: PlatformId
  chatId: string
  contextId: string
  timestamp: number
}

/**
 * Storage representation of a captured conversation context.
 */
export interface StoredContext {
  id: string // e.g. "claude:chat-uuid-123"
  sourcePlatform: PlatformId
  chatId: string
  chatTitle: string
  sourceUrl: string
  clientSessionId?: string
  createdAt: number
  updatedAt: number
  expiresAt: number // Timestamp when context should be pruned (default 24h)
  stateMemory: StateMemory
  rawCodeBlocks: VerbatimCodeBlock[]
  rawTranscript?: string
  turns?: MessageTurn[]
  contentHash?: string
  lastSummarizedTurnIndex?: number
  exchangeCount?: number
  summaryMode?: "local"
  lastSaveDiagnostic?: SaveDiagnosticInfo
  isPinned?: boolean
  isImported?: boolean
  snapshotVersion?: number
  statistics?: CanonicalStatistics
  completeness?: "complete" | "viewport_only" | "partial"
  missingHistoryInformation?: MissingHistoryInfo
  captureStatus?: "idle" | "capturing" | "saved" | "error"
}

/**
 * Diagnostic breakdown for every auto-save event.
 */
export interface SaveDiagnosticInfo {
  tempId: string
  realChatId: string
  matchedEntryId: string
  why: string
  timestamp: number
}

export interface TurnAttachment {
  name: string
  kind: "file" | "image"
}

/**
 * Standard turn representation passed from adapters to the auto-saver.
 */
export interface MessageTurn {
  id: string
  role: "user" | "assistant" | "system"
  text: string
  codeBlocks: VerbatimCodeBlock[]
  attachments?: TurnAttachment[]
  timestamp?: number
  chatId?: string
  idSourceAttr?: string
  conversationId?: string
  sequence?: number
  captureSource?: "live_observer" | "dom_snapshot" | "official_export" | "network_interception"
  capturedAt?: number
}

/**
 * Health check telemetry for each adapter.
 */
export interface AdapterHealthResult {
  platform: PlatformId
  ok: boolean
  inputBoxFound: boolean
  messagesFound: boolean
  lastChecked: number
  issues: string[]
}

/**
 * User Preferences & Settings for Context Bridge (100% Local-First).
 */
export interface UserSettings {
  autoExpiryHours: number
  autoImport?: boolean
  afterInjectAction?: AfterInjectBehavior
  customStyle?: string
  customResume?: string
  showSwitchSuggestions?: boolean
}

// Alias for backwards-compatibility during migration
export type ProviderSettings = UserSettings

export const DEFAULT_SETTINGS: UserSettings = {
  autoExpiryHours: 24,
  autoImport: true,
  afterInjectAction: "focus",
  customStyle: "Direct, technical, code-centric; omit polite filler.",
  customResume: "Continue this work. Don't re-summarize. Reply \"Ready\" in one word, then wait for my next message.",
  showSwitchSuggestions: true
}

export interface PlatformDebugInfo {
  platform: PlatformId
  displayName: string
  url: string
  chatId: string
  adapterSelected: string
  chatContainerFound: boolean
  containerTag?: string
  messagesCount: number
  matchedSelector: string
  lastMessageSentToBg?: string
  lastMessageSentTime?: number
  bgResult?: string
  bgResultTime?: number
  lastSaveTime?: number
  lastSaveDiagnostic?: SaveDiagnosticInfo
  lastInsertResult?: {
    charactersInserted: number
    inputContainsText: boolean
    sendButtonEnabled: "yes" | "no" | "unknown"
    timestamp: number
  }
  timestamp: number
}

export type SaveDecisionCode =
  | "saved"
  | "updated"
  | "skipped-no-chat-id"
  | "skipped-foreign-turns"
  | "skipped-no-turns"
  | "migrated"
  | "merged"
  | "skipped-placeholder"
  | "skipped-handshake"

export interface DroppedTurnDiagnostic {
  turnId: string
  idSourceAttr?: string
  role: string
  storedOwnerChatId?: string
  currentChatId: string
  textLength: number
}

export interface SaveDecisionRecord {
  id: string
  timestamp: number
  chatKey: string
  decision: SaveDecisionCode
  reason: string
  navMechanism: string
  turnsCount: number
  receivedTurnsCount?: number
  keptTurnsCount?: number
  droppedTurns?: DroppedTurnDiagnostic[]
  idSourceAttrCounts?: Record<string, number>
}

export const STORAGE_KEYS = {
  CONTEXTS: "context_bridge_contexts",
  SETTINGS: "context_bridge_settings",
  HEALTH: "context_bridge_health",
  DEBUG_TELEMETRY: "context_bridge_debug_telemetry",
  INJECTED_MAP: "context_bridge_injected_map",
  DENSITY_MODE: "context_bridge_density_mode",
  INJECTION_FORMAT: "context_bridge_injection_format",
  SAVE_TIMELINE: "context_bridge_save_timeline",
  MESSAGE_OWNERSHIP: "context_bridge_message_ownership"
} as const
