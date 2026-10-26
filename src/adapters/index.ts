import type { PlatformId } from "../types"
import { ClaudeAdapter } from "./claude"
import { ChatGPTAdapter } from "./chatgpt"
import { GeminiAdapter } from "./gemini"
import type { PlatformAdapter } from "./types"

export * from "./types"
export * from "./claude"
export * from "./chatgpt"
export * from "./gemini"

/**
 * Registry of all available platform adapters: Claude, ChatGPT, and Gemini.
 */
const REGISTERED_ADAPTERS: PlatformAdapter[] = [
  new ClaudeAdapter(),
  new ChatGPTAdapter(),
  new GeminiAdapter()
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
