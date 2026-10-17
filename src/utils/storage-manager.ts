import { Storage } from "@plasmohq/storage"
import {
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  type ProviderSettings,
  type StoredContext
} from "../types"

const storage = new Storage({ area: "local" })

/**
 * Retrieves the user settings (BYOK credentials, model choices, auto-expiry).
 */
export async function getSettings(): Promise<ProviderSettings> {
  const settings = await storage.get<ProviderSettings>(STORAGE_KEYS.SETTINGS)
  return { ...DEFAULT_SETTINGS, ...settings }
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
 * Clears stored API keys.
 */
export async function deleteApiKeys(): Promise<void> {
  const current = await getSettings()
  current.geminiApiKey = ""
  current.openaiApiKey = ""
  await storage.set(STORAGE_KEYS.SETTINGS, current)
}

/**
 * Returns all active stored contexts, automatically pruning expired items.
 */
export async function getStoredContexts(): Promise<StoredContext[]> {
  const rawContexts = (await storage.get<Record<string, StoredContext>>(STORAGE_KEYS.CONTEXTS)) || {}
  const now = Date.now()
  const validContexts: StoredContext[] = []
  const prunedMap: Record<string, StoredContext> = {}
  let hasPruned = false

  for (const [id, context] of Object.entries(rawContexts)) {
    if (context.expiresAt && context.expiresAt <= now) {
      hasPruned = true
      continue // Expired, skip
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
 * Saves or updates a stored context in chrome.storage.local.
 */
export async function saveContext(context: StoredContext): Promise<void> {
  const contexts = (await storage.get<Record<string, StoredContext>>(STORAGE_KEYS.CONTEXTS)) || {}
  contexts[context.id] = context
  await storage.set(STORAGE_KEYS.CONTEXTS, contexts)
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
}
