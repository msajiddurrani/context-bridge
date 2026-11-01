/**
 * Context Bridge - Secure JSON Backup Import Validator
 *
 * Implements strict schema validation and prototype pollution defense
 * for user backups according to Master Instruction Part 5B.
 */

import type { PlatformId, StoredContext, VerbatimCodeBlock, MessageTurn } from "../types"

const VALID_PLATFORMS: PlatformId[] = ["claude", "chatgpt", "gemini"]

/**
 * Validates that an object does not contain malicious prototype pollution keys
 * such as __proto__, constructor, or prototype.
 */
export function isObjectSafeFromPollution(obj: any): boolean {
  if (!obj || typeof obj !== "object") return true

  // Check own keys and prototype
  const keys = Object.keys(obj)
  for (const key of keys) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      return false
    }
    const val = obj[key]
    if (val && typeof val === "object" && !isObjectSafeFromPollution(val)) {
      return false
    }
  }
  return true
}

/**
 * Validates a single VerbatimCodeBlock.
 */
function validateCodeBlock(raw: any, index: number): VerbatimCodeBlock | null {
  if (!raw || typeof raw !== "object") return null
  if (!isObjectSafeFromPollution(raw) || typeof raw === "function") return null

  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.slice(0, 100) : `code-${index}`
  const language = typeof raw.language === "string" ? raw.language.slice(0, 50) : "text"
  const code = typeof raw.code === "string" ? raw.code : ""
  const turnIndex = typeof raw.turnIndex === "number" && Number.isFinite(raw.turnIndex) ? raw.turnIndex : index

  return {
    id,
    language,
    code,
    turnIndex,
    ...(typeof raw.filePath === "string" ? { filePath: raw.filePath.slice(0, 200) } : {})
  }
}

/**
 * Validates a single MessageTurn.
 */
function validateTurn(raw: any, index: number): MessageTurn | null {
  if (!raw || typeof raw !== "object") return null
  if (!isObjectSafeFromPollution(raw) || typeof raw === "function") return null

  const role = raw.role === "user" || raw.role === "assistant" || raw.role === "system" ? raw.role : null
  if (!role) return null

  const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.slice(0, 120) : `turn-${index}`
  const text = typeof raw.text === "string" ? raw.text : ""

  const rawBlocks = Array.isArray(raw.codeBlocks) ? raw.codeBlocks : []
  const codeBlocks: VerbatimCodeBlock[] = []
  for (let i = 0; i < rawBlocks.length; i++) {
    const validBlock = validateCodeBlock(rawBlocks[i], i)
    if (validBlock) codeBlocks.push(validBlock)
  }

  return {
    id,
    role,
    text,
    codeBlocks,
    ...(typeof raw.timestamp === "number" && Number.isFinite(raw.timestamp) ? { timestamp: raw.timestamp } : {}),
    ...(typeof raw.chatId === "string" ? { chatId: raw.chatId.slice(0, 120) } : {})
  }
}

/**
 * Validates a single StoredContext.
 * Rejects invalid platforms, empty IDs, or polluted objects.
 */
export function validateSingleContext(raw: any): StoredContext | null {
  if (!raw || typeof raw !== "object") return null
  if (!isObjectSafeFromPollution(raw)) return null

  // 1. Mandatory ID
  if (typeof raw.id !== "string" || !raw.id.trim() || raw.id === "__proto__") {
    return null
  }
  const id = raw.id.trim().slice(0, 200)

  // 2. Platform validation
  if (!VALID_PLATFORMS.includes(raw.sourcePlatform)) {
    return null
  }
  const sourcePlatform = raw.sourcePlatform as PlatformId

  // 3. Chat ID and Title
  const chatId = typeof raw.chatId === "string" && raw.chatId.trim() ? raw.chatId.trim().slice(0, 150) : "imported-chat"
  const chatTitle = typeof raw.chatTitle === "string" && raw.chatTitle.trim()
    ? raw.chatTitle.trim().slice(0, 300)
    : "Imported Conversation"
  const sourceUrl = typeof raw.sourceUrl === "string" ? raw.sourceUrl.slice(0, 500) : ""

  // 4. Timestamps
  const now = Date.now()
  const createdAt = typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) ? raw.createdAt : now
  const updatedAt = typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : now
  // Default to 7 days retention for imported contexts
  const expiresAt = typeof raw.expiresAt === "number" && Number.isFinite(raw.expiresAt)
    ? raw.expiresAt
    : now + 7 * 24 * 60 * 60 * 1000

  // 5. Code blocks
  const rawCodeBlocksInput = Array.isArray(raw.rawCodeBlocks) ? raw.rawCodeBlocks : []
  const rawCodeBlocks: VerbatimCodeBlock[] = []
  for (let i = 0; i < rawCodeBlocksInput.length; i++) {
    const validBlock = validateCodeBlock(rawCodeBlocksInput[i], i)
    if (validBlock) rawCodeBlocks.push(validBlock)
  }

  // 6. Turns
  const rawTurnsInput = Array.isArray(raw.turns) ? raw.turns : []
  const turns: MessageTurn[] = []
  for (let i = 0; i < rawTurnsInput.length; i++) {
    const validTurn = validateTurn(rawTurnsInput[i], i)
    if (validTurn) turns.push(validTurn)
  }

  // 7. StateMemory (construct neutral clean structure)
  const smRaw = raw.stateMemory && typeof raw.stateMemory === "object" ? raw.stateMemory : {}
  const stateMemory = {
    version: "1.0" as const,
    objective: typeof smRaw.objective === "string" ? smRaw.objective.slice(0, 500) : (chatTitle || "Imported Work"),
    techStack: Array.isArray(smRaw.techStack) ? smRaw.techStack.filter((s: any) => typeof s === "string").slice(0, 30) : [],
    architectureDecisions: Array.isArray(smRaw.architectureDecisions)
      ? smRaw.architectureDecisions.filter((s: any) => typeof s === "string").slice(0, 50)
      : [],
    currentWork: typeof smRaw.currentWork === "string" ? smRaw.currentWork.slice(0, 2000) : "",
    blockersAndErrors: Array.isArray(smRaw.blockersAndErrors)
      ? smRaw.blockersAndErrors.filter((s: any) => typeof s === "string").slice(0, 30)
      : [],
    nextSteps: Array.isArray(smRaw.nextSteps)
      ? smRaw.nextSteps.filter((s: any) => typeof s === "string").slice(0, 30)
      : [],
    criticalSnippets: rawCodeBlocks,
    rawTokenEstimate: typeof smRaw.rawTokenEstimate === "number" ? smRaw.rawTokenEstimate : 0,
    metadata: {
      imported: true,
      importedAt: now
    }
  }

  // Return a strictly constructed, sanitized object free of inherited prototype keys
  const sanitizedContext: StoredContext = {
    id,
    sourcePlatform,
    chatId,
    chatTitle,
    sourceUrl,
    createdAt,
    updatedAt,
    expiresAt,
    stateMemory,
    rawCodeBlocks,
    rawTranscript: typeof raw.rawTranscript === "string" ? raw.rawTranscript.slice(0, 500000) : undefined,
    turns,
    isPinned: Boolean(raw.isPinned),
    isImported: true,
    summaryMode: "local"
  }

  return sanitizedContext
}

/**
 * Validates an entire imported backup file payload.
 * Supports both raw StoredContext[] and wrapped { version: string, contexts: StoredContext[] }.
 */
export function validateImportedBackup(rawInput: unknown): {
  valid: boolean
  contexts: StoredContext[]
  error?: string
} {
  if (!rawInput) {
    return { valid: false, contexts: [], error: "Empty or invalid backup payload" }
  }

  let candidates: any[] = []

  if (Array.isArray(rawInput)) {
    candidates = rawInput
  } else if (typeof rawInput === "object" && rawInput !== null) {
    if (!isObjectSafeFromPollution(rawInput)) {
      return { valid: false, contexts: [], error: "Security rejection: Detected dangerous prototype pollution payload" }
    }
    const container = rawInput as Record<string, any>
    if (Array.isArray(container.contexts)) {
      candidates = container.contexts
    } else {
      return { valid: false, contexts: [], error: "Missing 'contexts' array in backup object" }
    }
  } else {
    return { valid: false, contexts: [], error: "Invalid backup format: Must be a JSON array or object" }
  }

  if (candidates.length === 0) {
    return { valid: false, contexts: [], error: "No conversations found in backup file" }
  }

  const validContexts: StoredContext[] = []
  for (const item of candidates) {
    const valid = validateSingleContext(item)
    if (valid) {
      validContexts.push(valid)
    }
  }

  if (validContexts.length === 0) {
    return {
      valid: false,
      contexts: [],
      error: "No valid conversations passed schema verification. Required: valid ID and supported platform (claude, chatgpt, gemini)."
    }
  }

  return {
    valid: true,
    contexts: validContexts
  }
}
