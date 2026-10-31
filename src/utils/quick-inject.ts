import { getAdapterForUrl } from "../adapters"
import { getStoredContexts } from "./storage-manager"
import { filterEligibleContexts } from "./context-filter"
import { buildInjectedPrompt } from "./prompt-preview"
import type { InjectionDensityMode } from "../types"

let quickInjectHandler: (() => Promise<{ success: boolean; contextId?: string; error?: string }>) | null = null

export function registerQuickInjectHandler(
  handler: (() => Promise<{ success: boolean; contextId?: string; error?: string }>) | null
): void {
  quickInjectHandler = handler
}

export function getRegisteredQuickInjectHandler(): (() => Promise<{ success: boolean; contextId?: string; error?: string }>) | null {
  return quickInjectHandler
}

/**
 * Directly executes quick injection into the active platform's input box.
 * 1. Resolves platform adapter from window.location.href.
 * 2. Finds the target input box without auto-submitting.
 * 3. Retrieves eligible cross-platform contexts.
 * 4. Formats and inserts context safely via adapter.insertText.
 */
export async function executeQuickInjectDirect(
  doc: Document = typeof document !== "undefined" ? document : (null as any),
  win: Window = typeof window !== "undefined" ? window : (null as any),
  densityMode: InjectionDensityMode = "standard"
): Promise<{ success: boolean; contextId?: string; error?: string }> {
  if (!win || !doc) return { success: false, error: "NO_WINDOW" }
  const matchedAdapter = getAdapterForUrl(win.location.href)
  if (!matchedAdapter) {
    return { success: false, error: "NO_ADAPTER" }
  }
  const inputBox = matchedAdapter.getInputBox(doc)
  if (!inputBox) {
    return { success: false, error: "NO_INPUT_BOX" }
  }
  const currentChatId = matchedAdapter.getChatId(win.location.href, doc)
  const isCurrentNew = matchedAdapter.isNewOrEmptyChat(doc)
  const stored = await getStoredContexts().catch(() => [])
  const eligible = filterEligibleContexts(stored, matchedAdapter.id, currentChatId, isCurrentNew)
  if (eligible.length === 0) {
    return { success: false, error: "NO_ELIGIBLE_CONTEXT" }
  }
  const target = eligible[0]
  const promptText = buildInjectedPrompt(target, matchedAdapter.id, densityMode)
  try {
    if (win.navigator?.clipboard?.writeText) {
      await win.navigator.clipboard.writeText(promptText).catch(() => {})
    }
  } catch {}
  const ok = matchedAdapter.insertText(inputBox, promptText)
  return ok ? { success: true, contextId: target.id } : { success: false, error: "INSERT_FAILED" }
}
