import type { PlatformId } from "../types"
import { ClaudeAdapter } from "./claude"
import { ChatGPTAdapter } from "./chatgpt"
import type { PlatformAdapter } from "./types"

export * from "./types"
export * from "./claude"
export * from "./chatgpt"

/**
 * Registry of all available platform adapters.
 * In Stage A: Claude and ChatGPT are fully registered.
 * Future stages will register Gemini, DeepSeek, Grok, and Perplexity.
 */
const REGISTERED_ADAPTERS: PlatformAdapter[] = [
  new ClaudeAdapter(),
  new ChatGPTAdapter()
]

/**
 * Resolves the appropriate PlatformAdapter based on URL.
 */
export function getAdapterForUrl(url: string): PlatformAdapter | null {
  if (!url || typeof url !== "string") return null
  return REGISTERED_ADAPTERS.find((adapter) => adapter.matches(url)) || null
}

/**
 * Resolves an adapter by its platform ID.
 */
export function getAdapterById(id: PlatformId): PlatformAdapter | null {
  return REGISTERED_ADAPTERS.find((adapter) => adapter.id === id) || null
}

/**
 * Returns all active registered adapters.
 */
export function getAllAdapters(): PlatformAdapter[] {
  return [...REGISTERED_ADAPTERS]
}
