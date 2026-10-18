import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_OPENAI_MODEL,
  type PlatformId,
  type StoredContext,
  type VerbatimCodeBlock
} from "./types"
import {
  clearLastError,
  getSettings,
  getStoredContexts,
  saveContext,
  saveLastError
} from "./utils/storage-manager"
import { summarizeWithLLM, testLLMConnection } from "./utils/llm-client"
import { redactSensitiveData } from "./utils/redaction"


// In-flight concurrency lock & queuing
let isSummarizing = false
let pendingPayload: any = null

export const ALLOWED_ORIGIN_HOSTS = [
  "claude.ai",
  "chatgpt.com",
  "gemini.google.com",
  "perplexity.ai",
  "chat.deepseek.com",
  "grok.com"
]

/**
 * Validates message sender ID and URL origin against permitted AI platform domains.
 * Logs clear, actionable reasons on rejection for security diagnostics.
 */
export function validateMessageSender(sender: chrome.runtime.MessageSender): {
  authorized: boolean
  reason: string
  origin?: string
} {
  // 1. Verify extension runtime ID
  if (!sender.id || sender.id !== chrome.runtime.id) {
    const reason = `Unauthorized sender ID '${sender.id || "unknown"}'. Expected '${chrome.runtime.id}'`
    console.warn(`[ContextBridge Background Security] REJECTED: ${reason}`)
    return { authorized: false, reason }
  }

  // 2. Identify sender URL / origin (handles tab.url, sender.url, and sender.origin)
  const rawUrl = sender.tab?.url || sender.url || (sender as any).origin
  if (!rawUrl) {
    // Internal background or popup message without tab context
    return {
      authorized: true,
      reason: "ACCEPTED: Internal extension sender (no tab URL present)"
    }
  }

  try {
    const parsed = new URL(rawUrl)
    const hostname = parsed.hostname.toLowerCase()
    const isAllowed = ALLOWED_ORIGIN_HOSTS.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`)
    )

    if (!isAllowed) {
      const reason = `Host '${hostname}' is not in allowed origin list: [${ALLOWED_ORIGIN_HOSTS.join(", ")}]`
      console.warn(`[ContextBridge Background Security] REJECTED: ${reason}`)
      return {
        authorized: false,
        reason,
        origin: hostname
      }
    }

    console.debug(`[ContextBridge Background Security] ACCEPTED message from host '${hostname}'`)
    return {
      authorized: true,
      reason: `ACCEPTED: Authorized host '${hostname}'`,
      origin: hostname
    }
  } catch (err: any) {
    const reason = `Failed to parse sender URL '${rawUrl}': ${err?.message || "Invalid URL format"}`
    console.warn(`[ContextBridge Background Security] REJECTED: ${reason}`)
    return {
      authorized: false,
      reason
    }
  }
}


/**
 * Updates extension action badge.
 */
function updateBadge(status: "IDLE" | "SYNC" | "OK" | "ERR"): void {
  try {
    switch (status) {
      case "SYNC":
        chrome.action.setBadgeText({ text: "SYNC" })
        chrome.action.setBadgeBackgroundColor({ color: "#6366F1" })
        break
      case "OK":
        chrome.action.setBadgeText({ text: "OK" })
        chrome.action.setBadgeBackgroundColor({ color: "#10B981" })
        setTimeout(() => chrome.action.setBadgeText({ text: "" }), 4000)
        break
      case "ERR":
        chrome.action.setBadgeText({ text: "ERR" })
        chrome.action.setBadgeBackgroundColor({ color: "#EF4444" })
        setTimeout(() => chrome.action.setBadgeText({ text: "" }), 5000)
        break
      case "IDLE":
      default:
        chrome.action.setBadgeText({ text: "" })
        break
    }
  } catch {
    // Ignore badge errors if action is not active
  }
}

/**
 * Handles incoming auto-save conversation payload from any supported platform.
 * Core Principle 5: SAVE RAW BEFORE ANY API CALL. Data must never be lost.
 * Core Principle 1 & 2: LOCAL-FIRST; fallback to local mode on API error.
 */
async function handleAutoSave(payload: {
  sourcePlatform: PlatformId
  chatId: string
  chatTitle: string
  sourceUrl: string
  rawTranscript: string
  rawCodeBlocks: VerbatimCodeBlock[]
}): Promise<{ success: boolean; contextId?: string; error?: string; warning?: string }> {
  if (isSummarizing) {
    pendingPayload = payload
    return { success: false, error: "SUMMARIZATION_IN_PROGRESS" }
  }

  isSummarizing = true
  updateBadge("SYNC")

  let currentSettings: any = null

  try {
    if (!payload.rawTranscript || payload.rawTranscript.trim().length < 5) {
      updateBadge("IDLE")
      return { success: false, error: "TRANSCRIPT_TOO_SHORT" }
    }

    const settings = await getSettings()
    currentSettings = settings

    // 1. Resolve stable chatId on /new or generic paths to prevent overwriting
    let effectiveChatId = payload.chatId
    const isGenericChatId =
      !effectiveChatId ||
      effectiveChatId === "new" ||
      effectiveChatId === "/" ||
      effectiveChatId === "default" ||
      effectiveChatId.startsWith("default-") ||
      effectiveChatId.endsWith("-session")

    if (isGenericChatId) {
      const titleSlug = (payload.chatTitle || "chat")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "-")
        .slice(0, 24)
      const contentSignature = (payload.rawTranscript || "").slice(0, 100).replace(/\s+/g, "")
      let hash = 0
      for (let i = 0; i < contentSignature.length; i++) {
        hash = (hash << 5) - hash + contentSignature.charCodeAt(i)
        hash |= 0
      }
      effectiveChatId = `session-${titleSlug}-${Math.abs(hash).toString(36)}`
    }

    const contextId = `${payload.sourcePlatform}:${effectiveChatId}`
    const now = Date.now()
    const expiryMs = (settings.autoExpiryHours || 24) * 60 * 60 * 1000

    // 2. Build local-mode StateMemory (Principle 1: Local-First)
    const localStateMemory: StateMemory = {
      version: "1.0",
      objective: payload.chatTitle || "Technical discussion",
      techStack: [],
      architectureDecisions: [],
      currentWork: payload.rawTranscript.slice(0, 500),
      blockersAndErrors: [],
      nextSteps: ["Continue active engineering task"],
      criticalSnippets: (payload.rawCodeBlocks || []).slice(-5),
      rawTokenEstimate: Math.ceil(payload.rawTranscript.length / 4)
    }

    const context: StoredContext = {
      id: contextId,
      sourcePlatform: payload.sourcePlatform,
      chatId: effectiveChatId,
      chatTitle: payload.chatTitle || "Active Discussion",
      sourceUrl: payload.sourceUrl,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + expiryMs,
      stateMemory: localStateMemory,
      rawCodeBlocks: payload.rawCodeBlocks || []
    }

    // 3. Core Principle 5: SAVE RAW BEFORE ANY API CALL. Data must never be lost.
    await saveContext(context)
    console.debug(`[ContextBridge Background] local save done: ${contextId}`)

    // 4. Check for BYOK API Key
    const activeKey =
      settings.provider === "openai" ? settings.openaiApiKey : settings.geminiApiKey

    if (!activeKey || !activeKey.trim()) {
      // Local mode active (no API key configured)
      console.debug(
        `[ContextBridge Background] storage write done: ${contextId} (local mode, no API key)`
      )
      updateBadge("OK")
      return { success: true, contextId }
    }

    // 5. AI Enhancement Mode
    const activeModel =
      settings.provider === "openai"
        ? settings.openaiModel || DEFAULT_OPENAI_MODEL
        : settings.geminiModel || DEFAULT_GEMINI_MODEL

    console.debug(`[ContextBridge Background] summary started (model: ${activeModel})`)

    try {
      // Redact sensitive data before text leaves browser
      const { redactedText, redactionCount, matchedCategories } = redactSensitiveData(payload.rawTranscript)
      if (redactionCount > 0) {
        console.info(
          `[ContextBridge Security] Redacted ${redactionCount} sensitive items (${matchedCategories.join(", ")})`
        )
      }

      const synthesizedMemory = await summarizeWithLLM(redactedText, payload.rawCodeBlocks || [], settings)
      console.debug(`[ContextBridge Background] summary finished (HTTP 200)`)

      context.stateMemory = synthesizedMemory
      context.updatedAt = Date.now()
      await saveContext(context)
      console.debug(`[ContextBridge Background] storage write done: ${contextId}`)
      await clearLastError()
      updateBadge("OK")

      return { success: true, contextId }
    } catch (err: any) {
      const errorMsg = err?.message || "Unknown summarization error"
      const httpMatch = errorMsg.match(/\((\d{3})\)/)
      const httpStatus = httpMatch ? httpMatch[1] : "ERR"
      console.warn(
        `[ContextBridge Background] summary failed (HTTP ${httpStatus}): ${errorMsg}`
      )

      await saveLastError({
        message: errorMsg,
        timestamp: Date.now(),
        provider: settings.provider,
        model: activeModel
      })
      updateBadge("ERR")
      console.debug(
        `[ContextBridge Background] storage write done: ${contextId} (retained raw local context)`
      )

      // Fallback: Never fail empty-handed. Local context was already saved!
      return {
        success: true,
        contextId,
        warning: `AI summary failed (HTTP ${httpStatus}): ${errorMsg}. Local raw context saved.`
      }
    }
  } catch (fatalErr: any) {
    console.error("[ContextBridge Background] Fatal error during auto-save:", fatalErr)
    updateBadge("ERR")
    return { success: false, error: fatalErr?.message || "Fatal error during save" }
  } finally {
    isSummarizing = false

    if (pendingPayload) {
      const next = pendingPayload
      pendingPayload = null
      setTimeout(() => handleAutoSave(next), 600)
    }
  }
}

/**
 * Message routing with strict sender authorization & telemetry
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const auth = validateMessageSender(sender)
  if (!auth.authorized) {
    console.warn(`[ContextBridge Background] REJECTED (with reason: ${auth.reason})`)
    sendResponse({ success: false, error: auth.reason })
    return false
  }

  // 1. Auto-save conversation transcript from content scripts
  if (message?.type === "AUTO_SAVE_TRANSCRIPT") {
    console.debug(
      `[ContextBridge Background] background received message from ${auth.origin || "internal"} (platform: ${message.payload?.sourcePlatform})`
    )
    handleAutoSave(message.payload).then((res) => {
      if (!res.success) {
        console.warn(`[ContextBridge Background] auto-save failed: ${res.error}`)
      } else {
        console.debug(`[ContextBridge Background] auto-save succeeded: ${res.contextId}`)
      }
      sendResponse(res)
    })
    return true // Keep channel open for async response
  }

  // 2. Report adapter error (when platform's messages cannot be read)
  if (message?.type === "REPORT_ADAPTER_ERROR") {
    const issue = message.payload?.issue || "Failed to read platform messages"
    console.warn(
      `[ContextBridge Background] Adapter error reported for platform '${message.payload?.platform}': ${issue}`
    )
    updateBadge("ERR")
    saveLastError({
      message: `Adapter error on ${message.payload?.platform}: ${issue}`,
      timestamp: Date.now(),
      provider: "system",
      model: "dom-observer"
    })
    sendResponse({ success: true })
    return true
  }


  // 2. Fetch all valid stored contexts (with automatic expiration pruning)
  if (message?.type === "GET_STORED_CONTEXTS") {
    getStoredContexts().then((contexts) => {
      sendResponse({ success: true, contexts })
    })
    return true
  }

  // 3. Test API key & model configuration (lightweight ping)
  if (message?.type === "TEST_LLM_CONFIG") {
    const { provider, apiKey, model } = message.payload || {}
    testLLMConnection(provider, apiKey, model)
      .then(async (result) => {
        await clearLastError()
        sendResponse(result)
      })
      .catch(async (err: any) => {
        const errorMsg = err?.message || "Connection test failed"
        const activeModel =
          model?.trim() || (provider === "gemini" ? DEFAULT_GEMINI_MODEL : DEFAULT_OPENAI_MODEL)
        await saveLastError({
          message: errorMsg,
          timestamp: Date.now(),
          provider: provider || "gemini",
          model: activeModel
        })
        sendResponse({ success: false, error: errorMsg })
      })
    return true
  }

  // 4. Clear last error
  if (message?.type === "CLEAR_LAST_ERROR") {
    clearLastError().then(() => sendResponse({ success: true }))
    return true
  }

  // 5. Health ping
  if (message?.type === "PING_BACKGROUND") {
    sendResponse({ status: "PONG", isSummarizing, timestamp: Date.now() })
    return true
  }
})

console.info("[ContextBridge Brain] Service Worker active with security & auto-expiry pruning.")
