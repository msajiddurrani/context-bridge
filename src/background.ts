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

const ALLOWED_ORIGIN_HOSTS = [
  "claude.ai",
  "chatgpt.com",
  "gemini.google.com",
  "perplexity.ai",
  "chat.deepseek.com",
  "grok.com"
]

/**
 * Validates message sender ID and URL origin against permitted AI platform domains.
 */
function isAuthorizedSender(sender: chrome.runtime.MessageSender): boolean {
  // 1. Verify extension runtime ID
  if (sender.id !== chrome.runtime.id) {
    console.warn("[ContextBridge Security] Unauthorized sender ID:", sender.id)
    return false
  }

  // 2. If message came from a web page tab, verify allowed hostname
  if (sender.tab?.url) {
    try {
      const parsed = new URL(sender.tab.url)
      const isAllowed = ALLOWED_ORIGIN_HOSTS.some(
        (host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`)
      )
      if (!isAllowed) {
        console.warn("[ContextBridge Security] Rejected message from untrusted host:", parsed.hostname)
        return false
      }
    } catch {
      return false
    }
  }

  return true
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
 */
async function handleAutoSave(payload: {
  sourcePlatform: PlatformId
  chatId: string
  chatTitle: string
  sourceUrl: string
  rawTranscript: string
  rawCodeBlocks: VerbatimCodeBlock[]
}): Promise<{ success: boolean; contextId?: string; error?: string }> {
  if (isSummarizing) {
    pendingPayload = payload
    return { success: false, error: "SUMMARIZATION_IN_PROGRESS" }
  }

  isSummarizing = true
  updateBadge("SYNC")

  let currentSettings: any = null

  try {
    // 1. Fetch user BYOK credentials & configuration
    const settings = await getSettings()
    currentSettings = settings
    const activeKey =
      settings.provider === "openai" ? settings.openaiApiKey : settings.geminiApiKey

    if (!activeKey || !activeKey.trim()) {
      updateBadge("ERR")
      const errText = `NO_API_KEY: Please configure your ${settings.provider.toUpperCase()} API key in Context Bridge settings.`
      await saveLastError({
        message: errText,
        timestamp: Date.now(),
        provider: settings.provider,
        model: settings.provider === "gemini" ? settings.geminiModel : settings.openaiModel
      })
      return {
        success: false,
        error: errText
      }
    }

    if (!payload.rawTranscript || payload.rawTranscript.trim().length < 30) {
      updateBadge("IDLE")
      return { success: false, error: "TRANSCRIPT_TOO_SHORT" }
    }

    // 2. REDACT SENSITIVE DATA BEFORE ANY TEXT LEAVES THE BROWSER
    const { redactedText, redactionCount, matchedCategories } = redactSensitiveData(payload.rawTranscript)
    if (redactionCount > 0) {
      console.info(
        `[ContextBridge Security] Redacted ${redactionCount} sensitive items (${matchedCategories.join(", ")})`
      )
    }

    // 3. Summarize with LLM (current verified Gemini Flash or OpenAI)
    console.info(
      `[ContextBridge Brain] Synthesizing context for ${payload.sourcePlatform} chat "${payload.chatTitle}"...`
    )
    const stateMemory = await summarizeWithLLM(redactedText, payload.rawCodeBlocks || [], settings)

    // 4. Construct StoredContext with auto-expiry
    const now = Date.now()
    const expiryMs = (settings.autoExpiryHours || 24) * 60 * 60 * 1000
    const contextId = `${payload.sourcePlatform}:${payload.chatId}`

    const context: StoredContext = {
      id: contextId,
      sourcePlatform: payload.sourcePlatform,
      chatId: payload.chatId,
      chatTitle: payload.chatTitle || "Active Discussion",
      sourceUrl: payload.sourceUrl,
      createdAt: now,
      updatedAt: now,
      expiresAt: now + expiryMs,
      stateMemory,
      rawCodeBlocks: payload.rawCodeBlocks || []
    }

    // 5. Save in chrome.storage.local
    await saveContext(context)
    await clearLastError()
    console.info(`[ContextBridge Brain] Context saved: ${contextId}`)
    updateBadge("OK")

    return { success: true, contextId }
  } catch (err: any) {
    console.error("[ContextBridge Brain] Summarization error:", err)
    updateBadge("ERR")
    const errorMsg = err?.message || "Unknown summarization error"
    const activeModel =
      currentSettings?.provider === "openai"
        ? currentSettings?.openaiModel || DEFAULT_OPENAI_MODEL
        : currentSettings?.geminiModel || DEFAULT_GEMINI_MODEL

    await saveLastError({
      message: errorMsg,
      timestamp: Date.now(),
      provider: currentSettings?.provider || "gemini",
      model: activeModel
    })

    return { success: false, error: errorMsg }
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
 * Message routing with strict sender authorization
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!isAuthorizedSender(sender)) {
    sendResponse({ success: false, error: "UNAUTHORIZED_SENDER" })
    return false
  }

  // 1. Auto-save conversation transcript from content scripts
  if (message?.type === "AUTO_SAVE_TRANSCRIPT") {
    handleAutoSave(message.payload).then(sendResponse)
    return true // Keep channel open for async response
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
