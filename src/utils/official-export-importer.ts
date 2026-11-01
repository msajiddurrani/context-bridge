import type { MessageTurn, PlatformId, StoredContext, VerbatimCodeBlock } from "../types"
import { isObjectSafeFromPollution } from "./import-validator"
import {
  buildLocalStateMemory,
  computeContentHash,
  computeConversationStatistics
} from "./local-mode"

/**
 * Extracts fenced code blocks from markdown text.
 */
export function extractFencedCodeBlocks(text: string, turnIndex: number): VerbatimCodeBlock[] {
  if (!text) return []
  const blocks: VerbatimCodeBlock[] = []
  const regex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  let count = 0
  while ((match = regex.exec(text)) !== null) {
    const language = (match[1] || "text").trim()
    const code = match[2]?.trim() || ""
    if (code.length > 0) {
      blocks.push({
        id: `code-${turnIndex}-${count++}`,
        language,
        code,
        turnIndex
      })
    }
  }
  return blocks
}

export interface OfficialExportParseResult {
  success: boolean
  platform: PlatformId
  conversations: StoredContext[]
  totalMessages: number
  error?: string
}

/**
 * Parses official platform data exports (ChatGPT conversations.json or Claude conversations.json).
 * Allows recovering 100% full historical conversations offline without webpage scrolling.
 */
export function parseOfficialPlatformExport(jsonText: string): OfficialExportParseResult {
  let rawData: unknown
  try {
    rawData = JSON.parse(jsonText)
  } catch (err: any) {
    return {
      success: false,
      platform: "chatgpt",
      conversations: [],
      totalMessages: 0,
      error: `Invalid JSON: ${err?.message || "parse error"}`
    }
  }

  if (!isObjectSafeFromPollution(rawData) || !Array.isArray(rawData)) {
    return {
      success: false,
      platform: "chatgpt",
      conversations: [],
      totalMessages: 0,
      error: "Export file must be a JSON array of conversations"
    }
  }

  if (rawData.length === 0) {
    return {
      success: false,
      platform: "chatgpt",
      conversations: [],
      totalMessages: 0,
      error: "Export file contains no conversations"
    }
  }

  // Detect platform format
  const sample = rawData[0]
  if (sample && typeof sample === "object") {
    if ("mapping" in sample) {
      return parseChatGptOfficialExport(rawData)
    }
    if ("chat_messages" in sample || "uuid" in sample) {
      return parseClaudeOfficialExport(rawData)
    }
  }

  return {
    success: false,
    platform: "chatgpt",
    conversations: [],
    totalMessages: 0,
    error: "Unrecognized platform export format. Supported formats: ChatGPT (conversations.json) and Claude (conversations.json)."
  }
}

/**
 * Parses official OpenAI ChatGPT export array.
 */
function parseChatGptOfficialExport(items: any[]): OfficialExportParseResult {
  const contexts: StoredContext[] = []
  let totalMessages = 0
  const now = Date.now()

  for (const item of items) {
    if (!item || typeof item !== "object" || !item.id || !item.mapping) continue

    const chatId = String(item.id).trim()
    const chatTitle = String(item.title || "ChatGPT Conversation").trim()
    const createdAt = typeof item.create_time === "number" ? Math.floor(item.create_time * 1000) : now
    const updatedAt = typeof item.update_time === "number" ? Math.floor(item.update_time * 1000) : createdAt

    // Linearize DAG mapping by traversing from root to leaf
    const mapping = item.mapping
    const turns: MessageTurn[] = []
    let currentId: string | null = null

    // Find root node (node without parent or whose parent is not in mapping)
    for (const [id, node] of Object.entries<any>(mapping)) {
      if (!node.parent || !mapping[node.parent]) {
        currentId = id
        break
      }
    }

    // Traverse linear path
    const visited = new Set<string>()
    while (currentId && mapping[currentId] && !visited.has(currentId)) {
      visited.add(currentId)
      const node = mapping[currentId]
      const msg = node.message
      if (msg && msg.author && msg.content) {
        const rawRole = msg.author.role
        if (rawRole === "user" || rawRole === "assistant") {
          const parts = msg.content.parts || []
          const text = parts.filter((p: any) => typeof p === "string").join("\n").trim()
          if (text.length > 0) {
            const codeBlocks = extractFencedCodeBlocks(text, turns.length)
            turns.push({
              id: msg.id || currentId,
              role: rawRole,
              text,
              codeBlocks,
              timestamp: typeof msg.create_time === "number" ? Math.floor(msg.create_time * 1000) : undefined,
              chatId,
              captureSource: "official_export",
              capturedAt: now
            })
          }
        }
      }
      // Follow first child
      currentId = node.children && node.children.length > 0 ? node.children[0] : null
    }

    if (turns.length === 0) continue

    totalMessages += turns.length
    const allCodeBlocks = turns.flatMap((t) => t.codeBlocks || [])
    const stats = computeConversationStatistics(turns, allCodeBlocks, "complete")
    const stateMemory = buildLocalStateMemory(turns, allCodeBlocks, chatTitle, "standard")

    contexts.push({
      id: `chatgpt:${chatId}`,
      sourcePlatform: "chatgpt",
      chatId,
      chatTitle,
      sourceUrl: `https://chatgpt.com/c/${chatId}`,
      createdAt,
      updatedAt,
      expiresAt: 0, // Imported official conversations preserved permanently by default
      isPinned: true,
      isImported: true,
      snapshotVersion: 1,
      completeness: "complete",
      statistics: stats,
      turns,
      rawCodeBlocks: allCodeBlocks,
      rawTranscript: turns.map((t) => `${t.role.toUpperCase()}:\n${t.text}`).join("\n\n---\n\n"),
      stateMemory,
      contentHash: computeContentHash(turns),
      exchangeCount: stats.exchangeCount,
      summaryMode: "local"
    })
  }

  return {
    success: contexts.length > 0,
    platform: "chatgpt",
    conversations: contexts,
    totalMessages
  }
}

/**
 * Parses official Anthropic Claude export array.
 */
function parseClaudeOfficialExport(items: any[]): OfficialExportParseResult {
  const contexts: StoredContext[] = []
  let totalMessages = 0
  const now = Date.now()

  for (const item of items) {
    if (!item || typeof item !== "object") continue
    const chatId = String(item.uuid || item.id || "").trim()
    if (!chatId) continue

    const chatTitle = String(item.name || "Claude Conversation").trim()
    const createdAt = item.created_at ? new Date(item.created_at).getTime() : now
    const updatedAt = item.updated_at ? new Date(item.updated_at).getTime() : createdAt

    const rawMsgs = item.chat_messages || []
    const turns: MessageTurn[] = []

    for (const msg of rawMsgs) {
      if (!msg || typeof msg !== "object") continue
      const rawRole = msg.sender === "human" ? "user" : msg.sender === "assistant" ? "assistant" : null
      if (!rawRole) continue

      const text = String(msg.text || "").trim()
      if (text.length === 0) continue

      const codeBlocks = extractFencedCodeBlocks(text, turns.length)
      turns.push({
        id: msg.uuid || `${chatId}:turn:${turns.length}`,
        role: rawRole,
        text,
        codeBlocks,
        timestamp: msg.created_at ? new Date(msg.created_at).getTime() : undefined,
        chatId,
        captureSource: "official_export",
        capturedAt: now
      })
    }

    if (turns.length === 0) continue

    totalMessages += turns.length
    const allCodeBlocks = turns.flatMap((t) => t.codeBlocks || [])
    const stats = computeConversationStatistics(turns, allCodeBlocks, "complete")
    const stateMemory = buildLocalStateMemory(turns, allCodeBlocks, chatTitle, "standard")

    contexts.push({
      id: `claude:${chatId}`,
      sourcePlatform: "claude",
      chatId,
      chatTitle,
      sourceUrl: `https://claude.ai/chat/${chatId}`,
      createdAt,
      updatedAt,
      expiresAt: 0,
      isPinned: true,
      isImported: true,
      snapshotVersion: 1,
      completeness: "complete",
      statistics: stats,
      turns,
      rawCodeBlocks: allCodeBlocks,
      rawTranscript: turns.map((t) => `${t.role.toUpperCase()}:\n${t.text}`).join("\n\n---\n\n"),
      stateMemory,
      contentHash: computeContentHash(turns),
      exchangeCount: stats.exchangeCount,
      summaryMode: "local"
    })
  }

  return {
    success: contexts.length > 0,
    platform: "claude",
    conversations: contexts,
    totalMessages
  }
}
