import type { MessageTurn, PlatformId, StoredContext } from "../types"
import { isObjectSafeFromPollution } from "./import-validator"
import {
  buildLocalStateMemory,
  computeConversationStatistics
} from "./local-mode"
import { extractFencedCodeBlocks } from "./official-export-importer"

export interface InterceptedPayloadParseResult {
  success: boolean
  platform: PlatformId
  chatId: string
  chatTitle: string
  turns: MessageTurn[]
  storedContext?: StoredContext
  error?: string
}

/**
 * Parses intercepted network response payloads from ChatGPT or Claude's internal web API.
 * Captures 100% of historical conversation turns instantaneously on page load
 * with zero DOM scrolling and zero network requests.
 */
export function parseInterceptedPayload(
  payload: unknown,
  hintPlatform?: PlatformId,
  hintChatId?: string
): InterceptedPayloadParseResult {
  if (!payload || typeof payload !== "object") {
    return {
      success: false,
      platform: hintPlatform || "chatgpt",
      chatId: hintChatId || "",
      chatTitle: "",
      turns: [],
      error: "Payload is not a valid object"
    }
  }

  if (!isObjectSafeFromPollution(payload)) {
    return {
      success: false,
      platform: hintPlatform || "chatgpt",
      chatId: hintChatId || "",
      chatTitle: "",
      turns: [],
      error: "Security rejection: Payload contains forbidden prototype pollution properties"
    }
  }

  const obj = payload as Record<string, any>

  // 1. Detect ChatGPT payload (has mapping and current_node or conversation_id)
  if ("mapping" in obj && typeof obj.mapping === "object") {
    return parseChatGptIntercepted(obj, hintChatId)
  }

  // 2. Detect Claude payload (has chat_messages and uuid or name)
  if ("chat_messages" in obj && Array.isArray(obj.chat_messages)) {
    return parseClaudeIntercepted(obj, hintChatId)
  }

  return {
    success: false,
    platform: hintPlatform || "chatgpt",
    chatId: hintChatId || "",
    chatTitle: "",
    turns: [],
    error: "Unrecognized conversation payload format"
  }
}

/**
 * Parses internal ChatGPT GET /backend-api/conversation/<id> response.
 */
function parseChatGptIntercepted(
  item: Record<string, any>,
  hintChatId?: string
): InterceptedPayloadParseResult {
  const chatId = String(
    item.conversation_id || item.id || hintChatId || ""
  ).trim()
  if (!chatId) {
    return {
      success: false,
      platform: "chatgpt",
      chatId: "",
      chatTitle: "",
      turns: [],
      error: "No chatId found in ChatGPT payload"
    }
  }

  const chatTitle = String(item.title || "ChatGPT Conversation").trim()
  const now = Date.now()
  const createdAt =
    typeof item.create_time === "number"
      ? Math.floor(item.create_time * 1000)
      : now
  const updatedAt =
    typeof item.update_time === "number"
      ? Math.floor(item.update_time * 1000)
      : createdAt

  const mapping = item.mapping
  const turns: MessageTurn[] = []

  // Traverse DAG mapping:
  // Prefer backward path from current_node if available for the active branch;
  // otherwise forward traversal from root node.
  let pathNodeIds: string[] = []

  if (item.current_node && mapping[item.current_node]) {
    let curr: string | null = item.current_node
    const visited = new Set<string>()
    while (curr && mapping[curr] && !visited.has(curr)) {
      visited.add(curr)
      pathNodeIds.unshift(curr)
      curr = mapping[curr].parent || null
    }
  } else {
    // Find root node
    let currentId: string | null = null
    for (const [key, node] of Object.entries(mapping)) {
      if (node && typeof node === "object") {
        if (!(node as any).parent || !mapping[(node as any).parent]) {
          currentId = key
          break
        }
      }
    }
    const visited = new Set<string>()
    while (currentId && mapping[currentId] && !visited.has(currentId)) {
      visited.add(currentId)
      pathNodeIds.push(currentId)
      const node = mapping[currentId]
      const children = Array.isArray(node.children) ? node.children : []
      currentId = children.length > 0 ? children[0] : null
    }
  }

  for (const nodeId of pathNodeIds) {
    const node = mapping[nodeId]
    if (!node || !node.message) continue
    const msg = node.message
    const author = msg.author
    if (!author) continue

    const role = author.role
    if (role !== "user" && role !== "assistant") continue

    const content = msg.content
    if (!content) continue

    let text = ""
    if (Array.isArray(content.parts)) {
      text = content.parts
        .filter((p: any) => typeof p === "string")
        .join("\n")
        .trim()
    } else if (typeof content.text === "string") {
      text = content.text.trim()
    }

    if (text.length === 0) continue

    const codeBlocks = extractFencedCodeBlocks(text, turns.length)
    turns.push({
      id: msg.id || nodeId,
      role,
      text,
      codeBlocks,
      timestamp:
        typeof msg.create_time === "number"
          ? Math.floor(msg.create_time * 1000)
          : undefined,
      sequence: turns.length + 1,
      chatId,
      captureSource: "network_interception",
      capturedAt: now
    })
  }

  if (turns.length === 0) {
    return {
      success: false,
      platform: "chatgpt",
      chatId,
      chatTitle,
      turns: [],
      error: "No valid user or assistant turns extracted from ChatGPT mapping"
    }
  }

  const allCodeBlocks = turns.flatMap((t) => t.codeBlocks || [])
  const stats = computeConversationStatistics(turns, allCodeBlocks, "complete")
  const stateMemory = buildLocalStateMemory(
    turns,
    allCodeBlocks,
    chatTitle,
    "standard"
  )

  const storedContext: StoredContext = {
    id: `chatgpt:${chatId}`,
    sourcePlatform: "chatgpt",
    chatId,
    chatTitle,
    sourceUrl: `https://chatgpt.com/c/${chatId}`,
    createdAt,
    updatedAt,
    expiresAt: now + 24 * 60 * 60 * 1000,
    turns,
    rawCodeBlocks: allCodeBlocks,
    statistics: stats,
    completeness: "complete",
    snapshotVersion: 1,
    isPinned: false,
    contentHash: `${turns.length}_${chatId.slice(0, 8)}`,
    stateMemory
  }

  return {
    success: true,
    platform: "chatgpt",
    chatId,
    chatTitle,
    turns,
    storedContext
  }
}

/**
 * Parses internal Claude GET /api/organizations/.../chat_conversations/<id> response.
 */
function parseClaudeIntercepted(
  item: Record<string, any>,
  hintChatId?: string
): InterceptedPayloadParseResult {
  const chatId = String(item.uuid || item.id || hintChatId || "").trim()
  if (!chatId) {
    return {
      success: false,
      platform: "claude",
      chatId: "",
      chatTitle: "",
      turns: [],
      error: "No chatId found in Claude payload"
    }
  }

  const chatTitle = String(item.name || "Claude Conversation").trim()
  const now = Date.now()
  const createdAt = item.created_at
    ? new Date(item.created_at).getTime()
    : now
  const updatedAt = item.updated_at
    ? new Date(item.updated_at).getTime()
    : createdAt

  const rawMsgs = item.chat_messages || []
  const turns: MessageTurn[] = []

  for (const msg of rawMsgs) {
    if (!msg || typeof msg !== "object") continue
    const rawRole =
      msg.sender === "human"
        ? "user"
        : msg.sender === "assistant"
          ? "assistant"
          : null
    if (!rawRole) continue

    let text = String(msg.text || "").trim()
    if (!text && Array.isArray(msg.content)) {
      text = msg.content
        .map((c: any) =>
          typeof c === "string"
            ? c
            : c && typeof c === "object" && typeof c.text === "string"
              ? c.text
              : ""
        )
        .filter(Boolean)
        .join("\n")
        .trim()
    }

    if (text.length === 0) continue

    const codeBlocks = extractFencedCodeBlocks(text, turns.length)
    turns.push({
      id: msg.uuid || `${chatId}:turn:${turns.length}`,
      role: rawRole,
      text,
      codeBlocks,
      timestamp: msg.created_at
        ? new Date(msg.created_at).getTime()
        : undefined,
      sequence: turns.length + 1,
      chatId,
      captureSource: "network_interception",
      capturedAt: now
    })
  }

  if (turns.length === 0) {
    return {
      success: false,
      platform: "claude",
      chatId,
      chatTitle,
      turns: [],
      error: "No valid user or assistant turns extracted from Claude messages"
    }
  }

  const allCodeBlocks = turns.flatMap((t) => t.codeBlocks || [])
  const stats = computeConversationStatistics(turns, allCodeBlocks, "complete")
  const stateMemory = buildLocalStateMemory(
    turns,
    allCodeBlocks,
    chatTitle,
    "standard"
  )

  const storedContext: StoredContext = {
    id: `claude:${chatId}`,
    sourcePlatform: "claude",
    chatId,
    chatTitle,
    sourceUrl: `https://claude.ai/chat/${chatId}`,
    createdAt,
    updatedAt,
    expiresAt: now + 24 * 60 * 60 * 1000,
    turns,
    rawCodeBlocks: allCodeBlocks,
    statistics: stats,
    completeness: "complete",
    snapshotVersion: 1,
    isPinned: false,
    contentHash: `${turns.length}_${chatId.slice(0, 8)}`,
    stateMemory
  }

  return {
    success: true,
    platform: "claude",
    chatId,
    chatTitle,
    turns,
    storedContext
  }
}
