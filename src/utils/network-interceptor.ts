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

  // 1. Detect Gemini batchexecute RPC payload
  if ("rawRpcText" in obj && typeof obj.rawRpcText === "string") {
    return parseGeminiIntercepted(obj.rawRpcText, hintChatId)
  }

  // 1b. Detect Next.js RSC Flight text (ChatGPT initial page payload)
  if ("rawRscText" in obj && typeof obj.rawRscText === "string") {
    const extracted = extractConversationFromNextJsChunk(obj.rawRscText)
    if (extracted) {
      return parseChatGptIntercepted(extracted, hintChatId)
    }
  }

  // 2. Detect ChatGPT payload (has mapping at root or in .conversation / .data)
  if ("mapping" in obj && typeof obj.mapping === "object") {
    return parseChatGptIntercepted(obj, hintChatId)
  }
  if (obj.conversation && typeof obj.conversation === "object" && "mapping" in obj.conversation) {
    return parseChatGptIntercepted(obj.conversation, hintChatId)
  }
  if (obj.data && typeof obj.data === "object" && "mapping" in obj.data) {
    return parseChatGptIntercepted(obj.data, hintChatId)
  }

  // 3. Detect Claude payload (has chat_messages and uuid or name)
  if ("chat_messages" in obj && Array.isArray(obj.chat_messages)) {
    return parseClaudeIntercepted(obj, hintChatId)
  }
  if (obj.conversation && typeof obj.conversation === "object" && Array.isArray(obj.conversation.chat_messages)) {
    return parseClaudeIntercepted(obj.conversation, hintChatId)
  }
  if (obj.data && typeof obj.data === "object" && Array.isArray(obj.data.chat_messages)) {
    return parseClaudeIntercepted(obj.data, hintChatId)
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
  if (!mapping || typeof mapping !== "object") {
    return {
      success: false,
      platform: "chatgpt",
      chatId,
      chatTitle,
      turns: [],
      error: "No mapping object found in ChatGPT payload"
    }
  }
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

  // If path traversal collected fewer nodes than exist with messages in mapping,
  // include all message nodes in chronological order so no turns are missed
  const totalMessageNodes = Object.values(mapping).filter((n: any) => n && n.message)
  if (pathNodeIds.length < totalMessageNodes.length) {
    const sortedNodeIds = Object.entries(mapping)
      .filter(([_, n]: [string, any]) => n && n.message)
      .sort((a: [string, any], b: [string, any]) => {
        const tA = a[1].message?.create_time || 0
        const tB = b[1].message?.create_time || 0
        return tA - tB
      })
      .map(([id]) => id)
    if (sortedNodeIds.length > pathNodeIds.length) {
      pathNodeIds = sortedNodeIds
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
        .map((p: any) => {
          if (typeof p === "string") return p
          if (p && typeof p === "object") {
            if (typeof p.text === "string") return p.text
            if (typeof p.content === "string") return p.content
          }
          return ""
        })
        .filter(Boolean)
        .join("\n")
        .trim()
    } else if (typeof content.text === "string") {
      text = content.text.trim()
    } else if (typeof content === "string") {
      text = content.trim()
    } else if (typeof msg.text === "string") {
      text = msg.text.trim()
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

/**
 * Extracts a ChatGPT conversation mapping object from Next.js RSC flight strings
 * or script tag contents.
 */
export function extractConversationFromNextJsChunk(str: string): any | null {
  if (!str || typeof str !== "string") return null
  const mapIdx = str.indexOf('"mapping"')
  if (mapIdx === -1) return null

  // Find candidate opening braces before "mapping"
  const openBraces: number[] = []
  const startSearch = Math.max(0, mapIdx - 5000)
  for (let i = startSearch; i < mapIdx; i++) {
    if (str[i] === "{") openBraces.push(i)
  }

  // Check candidate opening braces from closest backwards
  for (let k = openBraces.length - 1; k >= 0; k--) {
    const start = openBraces[k]
    let depth = 0
    let inString = false
    let escape = false

    for (let j = start; j < str.length; j++) {
      const ch = str[j]
      if (escape) {
        escape = false
        continue
      }
      if (ch === "\\") {
        escape = true
        continue
      }
      if (ch === '"') {
        inString = !inString
        continue
      }
      if (!inString) {
        if (ch === "{") {
          depth++
        } else if (ch === "}") {
          depth--
          if (depth === 0) {
            const candidate = str.slice(start, j + 1)
            try {
              const parsed = JSON.parse(candidate)
              if (parsed && typeof parsed === "object") {
                if (parsed.mapping && typeof parsed.mapping === "object") {
                  return parsed
                }
                if (parsed.conversation && parsed.conversation.mapping) {
                  return parsed.conversation
                }
              }
            } catch {
              // Not valid JSON at this boundary, continue
            }
            break
          }
        }
      }
    }
  }

  return null
}

/**
 * Parses internal Gemini batchexecute response text.
 */
function parseGeminiIntercepted(
  rawText: string,
  hintChatId?: string
): InterceptedPayloadParseResult {
  const chatId = hintChatId || ""
  if (!rawText) {
    return {
      success: false,
      platform: "gemini",
      chatId,
      chatTitle: "",
      turns: [],
      error: "Empty Gemini RPC text"
    }
  }

  try {
    let jsonText = rawText.trim()
    if (jsonText.startsWith(")]}'")) {
      jsonText = jsonText.slice(4).trim()
    }

    const turns: MessageTurn[] = []
    const now = Date.now()

    const envelopes: any[] = []

    if (rawText.includes("AF_initDataCallback")) {
      const match =
        rawText.match(/data:\s*(\[[\s\S]*?\])\s*,\s*sideChannel:/) ||
        rawText.match(/data:\s*(\[[\s\S]*?\])\s*\}\s*\);?/)
      if (match && match[1]) {
        try {
          const parsedData = JSON.parse(match[1])
          if (Array.isArray(parsedData)) {
            envelopes.push(parsedData)
          }
        } catch {}
      }
    }

    try {
      const parsed = JSON.parse(jsonText)
      if (Array.isArray(parsed)) {
        envelopes.push(...parsed)
      }
    } catch {
      // Chunked format (lines with chunk byte lengths)
      const lines = jsonText.split(/\r?\n/)
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || /^\d+$/.test(trimmed)) continue
        if (trimmed.startsWith("[[") || trimmed.startsWith("[")) {
          try {
            const parsed = JSON.parse(trimmed)
            if (Array.isArray(parsed)) {
              if (Array.isArray(parsed[0])) {
                envelopes.push(...parsed)
              } else {
                envelopes.push(parsed)
              }
            }
          } catch {}
        }
      }
    }

    for (const env of envelopes) {
      if (Array.isArray(env)) {
        for (const item of env) {
          if (typeof item === "string" && (item.startsWith("[") || item.startsWith("{"))) {
            try {
              const inner = JSON.parse(item)
              if (Array.isArray(inner)) {
                findGeminiTurnsInArray(inner, turns, chatId, now)
              }
            } catch {}
          }
        }
      }
    }

    if (turns.length > 0) {
      const allCodeBlocks = turns.flatMap((t) => t.codeBlocks || [])
      const stats = computeConversationStatistics(turns, allCodeBlocks, "complete")
      const stateMemory = buildLocalStateMemory(
        turns,
        allCodeBlocks,
        "Gemini Conversation",
        "standard"
      )

      return {
        success: true,
        platform: "gemini",
        chatId,
        chatTitle: "Gemini Conversation",
        turns,
        storedContext: {
          id: `gemini:${chatId}`,
          sourcePlatform: "gemini",
          chatId,
          chatTitle: "Gemini Conversation",
          sourceUrl: `https://gemini.google.com/app/${chatId}`,
          createdAt: now,
          updatedAt: now,
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
      }
    }
  } catch {
    // Ignore RPC parse failures
  }

  return {
    success: false,
    platform: "gemini",
    chatId,
    chatTitle: "",
    turns: [],
    error: "No Gemini turns could be extracted from RPC payload"
  }
}

function findGeminiTurnsInArray(
  arr: any[],
  turns: MessageTurn[],
  chatId: string,
  now: number
): void {
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i]
    if (Array.isArray(item)) {
      if (
        item.length >= 2 &&
        typeof item[0] === "string" &&
        Array.isArray(item[1]) &&
        typeof item[1][0] === "string"
      ) {
        const text = item[1][0].trim()
        if (text && !text.startsWith("http://") && !text.startsWith("https://")) {
          const role: "user" | "assistant" =
            item[0].includes("user") || i % 2 === 0 ? "user" : "assistant"
          const codeBlocks = extractFencedCodeBlocks(text, turns.length)
          turns.push({
            id: item[0],
            role,
            text,
            codeBlocks,
            sequence: turns.length + 1,
            chatId,
            captureSource: "network_interception",
            capturedAt: now
          })
        }
      } else if (
        item.length >= 2 &&
        typeof item[0] === "string" &&
        typeof item[1] === "string"
      ) {
        const text = item[1].trim()
        if (text && text.length > 1 && !text.startsWith("http://") && !text.startsWith("https://")) {
          const role: "user" | "assistant" =
            item[0].includes("user") || i % 2 === 0 ? "user" : "assistant"
          const codeBlocks = extractFencedCodeBlocks(text, turns.length)
          turns.push({
            id: item[0],
            role,
            text,
            codeBlocks,
            sequence: turns.length + 1,
            chatId,
            captureSource: "network_interception",
            capturedAt: now
          })
        }
      } else {
        findGeminiTurnsInArray(item, turns, chatId, now)
      }
    }
  }
}
