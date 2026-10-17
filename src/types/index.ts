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
}

/**
 * Neutral StateMemory JSON format.
 * Code blocks are stored strictly VERBATIM; only the discussion surrounding them is distilled.
 */
export interface StateMemory {
  version: "1.0"
  objective: string
  techStack: string[]
  architectureDecisions: string[]
  currentWork: string
  blockersAndErrors: string[]
  nextSteps: string[]
  criticalSnippets: VerbatimCodeBlock[]
  rawTokenEstimate: number
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
  createdAt: number
  updatedAt: number
  expiresAt: number // Timestamp when context should be pruned (default 24h)
  stateMemory: StateMemory
  rawCodeBlocks: VerbatimCodeBlock[]
}

/**
 * Standard turn representation passed from adapters to the auto-saver.
 */
export interface MessageTurn {
  id: string
  role: "user" | "assistant" | "system"
  text: string
  codeBlocks: VerbatimCodeBlock[]
  timestamp: number
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
 * Configuration & BYOK settings for LLM summarization.
 */
export interface ProviderSettings {
  provider: "gemini" | "openai"
  geminiApiKey: string
  geminiModel: string // default: "gemini-2.5-flash"
  openaiApiKey: string
  openaiModel: string // default: "gpt-4o-mini"
  autoExpiryHours: number // default: 24
}

export const DEFAULT_SETTINGS: ProviderSettings = {
  provider: "gemini",
  geminiApiKey: "",
  geminiModel: "gemini-2.5-flash",
  openaiApiKey: "",
  openaiModel: "gpt-4o-mini",
  autoExpiryHours: 24
}

export const STORAGE_KEYS = {
  CONTEXTS: "context_bridge_contexts",
  SETTINGS: "context_bridge_settings",
  HEALTH: "context_bridge_health"
} as const
