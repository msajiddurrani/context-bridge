/**
 * Context Bridge - Core Domain Types & Schemas
 */

export type PlatformId =
  | "claude"
  | "chatgpt"
  | "gemini"
  | "perplexity"
  | "deepseek"
  | "grok"

export interface VerbatimCodeBlock {
  id: string
  language: string
  code: string
  turnIndex: number
  filePath?: string
}

export type InjectionDensityMode = "compact" | "standard" | "full"

export interface TokenUsageTelemetry {
  tokensToday: number
  lastCallTokens: number
  lastCallTimestamp: number
  dailyCapTokens: number
  dateString: string
}

export interface CompactSummary {
  goal: string
  stack: string[]
  decisions: string[]
  state: string
  open: string[]
  next: string[]
}

export type SummarizeTrigger =
  | "inject_click"
  | "visibility_hidden"
  | "rate_limit"
  | "idle_timeout"
  | "manual"

/**
 * Neutral StateMemory JSON format.
 * Code blocks are stored strictly VERBATIM; only the discussion surrounding them is distilled.
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
  summarizedAt?: number
  compactSummary?: CompactSummary
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
  clientSessionId?: string // Unique ephemeral session ID on /new before permalink is minted
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
  summaryMode?: "local" | "ai"
  lastSaveDiagnostic?: SaveDiagnosticInfo
  isPinned?: boolean
}

/**
 * Diagnostic breakdown for every auto-save event.
 * Requirement 5: per save show temp id, real chatId, matched entry id and why.
 */
export interface SaveDiagnosticInfo {
  tempId: string
  realChatId: string
  matchedEntryId: string
  why: string
  timestamp: number
}

/**
 * Standard turn representation passed from adapters to the auto-saver.
 */
export interface MessageTurn {
  id: string
  role: "user" | "assistant" | "system"
  text: string
  codeBlocks: VerbatimCodeBlock[]
  timestamp?: number
  chatId?: string
  idSourceAttr?: string
  conversationId?: string
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

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"
export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini"

export interface LastErrorInfo {
  message: string
  timestamp: number
  provider: "gemini" | "openai" | "system"
  model: string
}

/**
 * Configuration & BYOK settings for LLM summarization.
 */
export interface ProviderSettings {
  provider: "gemini" | "openai"
  geminiApiKey: string
  geminiModel: string
  openaiApiKey: string
  openaiModel: string
  autoExpiryHours: number
  maxOutputTokens: number
  dailyCapTokens: number
}

export const DEFAULT_SETTINGS: ProviderSettings = {
  provider: "gemini",
  geminiApiKey: "",
  geminiModel: DEFAULT_GEMINI_MODEL,
  openaiApiKey: "",
  openaiModel: DEFAULT_OPENAI_MODEL,
  autoExpiryHours: 24,
  maxOutputTokens: 500,
  dailyCapTokens: 50000
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
  LAST_ERROR: "context_bridge_last_error",
  DEBUG_TELEMETRY: "context_bridge_debug_telemetry",
  INJECTED_MAP: "context_bridge_injected_map",
  TOKEN_USAGE: "context_bridge_token_usage",
  DENSITY_MODE: "context_bridge_density_mode",
  SAVE_TIMELINE: "context_bridge_save_timeline",
  MESSAGE_OWNERSHIP: "context_bridge_message_ownership"
} as const

