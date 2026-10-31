/**
 * Context Bridge - Runtime Optional Provider Permissions Manager
 *
 * Invariants:
 * 1. Least Privilege: Core AI platforms (Claude, ChatGPT, Gemini) run without external permissions.
 * 2. User Gesture: chrome.permissions.request() is strictly called in response to direct user actions.
 * 3. Graceful Fallback: When optional permissions are denied or revoked, the extension degrades
 *    transparently to Local Mode with zero outbound network calls and 0 API tokens.
 */

export const PROVIDER_ORIGIN_MAP: Record<string, string> = {
  openrouter: "https://openrouter.ai/*",
  gemini: "https://generativelanguage.googleapis.com/*",
  openai: "https://api.openai.com/*"
}

export function getProviderOrigin(provider: string): string | undefined {
  if (!provider) return undefined
  return PROVIDER_ORIGIN_MAP[provider.toLowerCase().trim()]
}

export function getAllExternalLLMOrigins(): string[] {
  return Object.values(PROVIDER_ORIGIN_MAP)
}

/**
 * Checks if optional host permission is currently granted for an external LLM provider.
 */
export async function hasProviderPermission(provider: string): Promise<boolean> {
  const origin = getProviderOrigin(provider)
  if (!origin) return false

  try {
    if (typeof chrome === "undefined" || !chrome.permissions?.contains) {
      return false
    }
    return await chrome.permissions.contains({ origins: [origin] })
  } catch (err: any) {
    console.debug(`[ContextBridge Permissions] Error checking permission for ${provider}:`, err?.message)
    return false
  }
}

/**
 * Requests optional host permission for an external LLM provider.
 * CRITICAL: Must ONLY be called in direct response to a user action (button click/toggle).
 */
export async function requestProviderPermission(provider: string): Promise<boolean> {
  const origin = getProviderOrigin(provider)
  if (!origin) return false

  try {
    if (typeof chrome === "undefined" || !chrome.permissions?.request) {
      return false
    }
    return await chrome.permissions.request({ origins: [origin] })
  } catch (err: any) {
    console.warn(`[ContextBridge Permissions] Error requesting permission for ${provider}:`, err?.message)
    return false
  }
}

/**
 * Revokes optional host permission for an external LLM provider.
 */
export async function removeProviderPermission(provider: string): Promise<boolean> {
  const origin = getProviderOrigin(provider)
  if (!origin) return false

  try {
    if (typeof chrome === "undefined" || !chrome.permissions?.remove) {
      return false
    }
    return await chrome.permissions.remove({ origins: [origin] })
  } catch (err: any) {
    console.debug(`[ContextBridge Permissions] Error removing permission for ${provider}:`, err?.message)
    return false
  }
}

/**
 * Revokes all external LLM provider permissions upon deleting API keys.
 * Returns the extension to a zero-network sandbox state.
 */
export async function removeAllProviderPermissions(): Promise<boolean> {
  const origins = getAllExternalLLMOrigins()
  try {
    if (typeof chrome === "undefined" || !chrome.permissions?.remove) {
      return false
    }
    return await chrome.permissions.remove({ origins })
  } catch (err: any) {
    console.debug("[ContextBridge Permissions] Error removing all permissions:", err?.message)
    return false
  }
}
