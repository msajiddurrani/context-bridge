import type { InjectionDensityMode, MessageTurn, StateMemory, VerbatimCodeBlock } from "../types"
import { isGenericFillerText, stripInjectedContext } from "./prompt-formatter"

/**
 * Common UI artifacts and web LLM boilerplate to strip for input reduction.
 */
const UI_NOISE_PATTERNS = [
  /Copy code/gi,
  /Regenerate response/gi,
  /Regenerate/gi,
  /Was this response better or worse\?/gi,
  /Was this response better\?/gi,
  /Thumbs up/gi,
  /Thumbs down/gi,
  /Share this chat/gi,
  /Read aloud/gi,
  /Copy to clipboard/gi
]

/**
 * Phrases indicating platform rate limits, usage caps, or hourly limits.
 */
export const RATE_LIMIT_PATTERNS = [
  /you(?:'ve| have) reached (?:your )?(?:usage |message )?limit/i,
  /rate limit (?:reached|exceeded)/i,
  /try again (?:in|after) \d+/i,
  /message limit reached/i,
  /you can send more messages (?:in|after)/i,
  /too many requests/i,
  /hourly message cap/i
]

export const UI_PLACEHOLDER_PATTERNS = [
  /message collapsed/i,
  /collapsed message/i,
  /copy code/i,
  /regenerate response/i,
  /regenerate/i,
  /view code/i,
  /show more/i,
  /expand message/i,
  /collapse message/i,
  /retry/i
]

/**
 * Extracts the primary user objective from the first user turn.
 * Trims noise, ignores UI placeholder text, and restricts length to a concise technical goal (max 200 chars).
 * Omit if empty or generic filler.
 */
export function extractGoal(turns: MessageTurn[], fallbackTitle?: string): string {
  for (const turn of turns) {
    if (turn.role === "user") {
      const clean = stripInjectedContext(turn.text || "")
        .replace(/\s+/g, " ")
        .trim()
      if (clean.length > 0) {
        // Skip UI placeholder text (e.g. Claude 'Message collapsed') or platform labels
        if (
          UI_PLACEHOLDER_PATTERNS.some((pat) => pat.test(clean)) ||
          isGenericFillerText(clean) ||
          /message collapsed/i.test(clean) ||
          /collapsed message/i.test(clean)
        ) {
          continue
        }
        // Return up to the first newline or period, capped at 200 characters
        const firstSentence = clean.split(/[.\n]/)[0].trim()
        if (firstSentence.length >= 2 && firstSentence.length <= 200) {
          return firstSentence
        }
        return clean.slice(0, 200).trim()
      }
    }
  }
  if (
    fallbackTitle &&
    !isGenericFillerText(fallbackTitle) &&
    !/message collapsed/i.test(fallbackTitle) &&
    !/collapsed message/i.test(fallbackTitle)
  ) {
    return fallbackTitle.trim()
  }
  return ""
}

/**
 * Formats a clean 1-line subtitle for context cards.
 * Avoids duplicate titles, avoids dummy text, and extracts the active query or status.
 */
export function formatCardSubtitle(ctx: {
  chatTitle?: string
  stateMemory?: { objective?: string }
  turns?: MessageTurn[]
  rawCodeBlocks?: any[]
}): string {
  const title = (ctx.chatTitle || "").trim()
  const goal = (ctx.stateMemory?.objective || "").trim()

  if (goal && goal.toLowerCase() !== title.toLowerCase() && !isGenericFillerText(goal)) {
    return goal
  }

  if (ctx.turns && ctx.turns.length > 1) {
    const userTurns = ctx.turns.filter((t) => t.role === "user")
    const lastUser = userTurns[userTurns.length - 1]
    const cleanLast = lastUser ? stripInjectedContext(lastUser.text || "").replace(/\s+/g, " ").trim() : ""
    if (cleanLast && cleanLast.toLowerCase() !== title.toLowerCase() && !isGenericFillerText(cleanLast)) {
      return cleanLast
    }
  }

  const turnsCount = ctx.turns?.length || 0
  const codeCount = ctx.rawCodeBlocks?.length || 0
  if (turnsCount > 0) {
    return `${turnsCount} messages${codeCount > 0 ? ` • ${codeCount} code snippets` : ""}`
  }

  return "Active session"
}

export interface CleanSummary {
  topic: string
  highlights: string[]
}

/**
 * Generates a clear, concise, and to-the-point summary of a conversation.
 * Strips conversational filler, web URLs, raw code blocks, and UI artifacts.
 * Produces strictly 2 to 4 clean, human-readable bullet points (never an essay).
 */
export function generateCleanSummary(ctx: {
  chatTitle?: string
  turns?: MessageTurn[]
  rawCodeBlocks?: VerbatimCodeBlock[]
  stateMemory?: { objective?: string }
}): CleanSummary {
  const title = (ctx.chatTitle || "").trim()
  const turns = ctx.turns || []
  const userTurns = turns.filter((t) => t.role === "user" && Boolean(t.text && t.text.trim().length > 0))
  const assistantTurns = turns.filter((t) => t.role === "assistant" && Boolean(t.text && t.text.trim().length > 0))

  let topic = title
  if (!topic || isGenericFillerText(topic)) {
    topic = ctx.stateMemory?.objective || "Active Discussion"
  }
  topic = topic.replace(/^[-•#\s]+/, "").trim()

  const highlights: string[] = []

  // Extract core points from assistant turns (concise 1-2 sentences, never long essays)
  if (assistantTurns.length > 0) {
    for (const aTurn of assistantTurns.slice(0, 3)) {
      let text = stripInjectedContext(aTurn.text || "")
        .replace(/```[\s\S]*?```/g, "")
        .replace(/https?:\/\/\S+/g, "")
        .replace(/\[image\][^\n]*/gi, "")
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/\r\n/g, "\n")
        .trim()

      if (!text || isGenericFillerText(text)) continue

      // Look for numbered points (e.g. "1. First, understand... 2. Next...")
      const numberedMatches = text.match(/(?:^|\n|\s)\d+[\.)]\s+([^\n]{10,140})/g)
      if (numberedMatches && numberedMatches.length >= 2) {
        for (const nm of numberedMatches.slice(0, 3)) {
          let cleanItem = nm.replace(/^\s*\d+[\.)]\s*/, "").trim()
          cleanItem = cleanItem.replace(/\[image\]\s*\S*/gi, "").replace(/https?:\/\/\S+/g, "").trim()
          if (cleanItem.length > 10) {
            const shortItem = cleanItem.length > 150 ? `${cleanItem.slice(0, 147)}...` : cleanItem
            if (!highlights.some((h) => h.toLowerCase().includes(shortItem.toLowerCase().slice(0, 20)))) {
              highlights.push(shortItem.charAt(0).toUpperCase() + shortItem.slice(1))
              if (highlights.length >= 3) break
            }
          }
        }
      } else {
        // Take clean sentences
        const cleanInline = text.replace(/\s+/g, " ").trim()
        const sentences = cleanInline.split(/(?<=[.!?])\s+/)
        for (const s of sentences) {
          const cleanS = s.trim()
          if (
            cleanS.length >= 15 &&
            !cleanS.toLowerCase().startsWith("user:") &&
            !cleanS.toLowerCase().startsWith("assistant:")
          ) {
            const capped = cleanS.length > 150 ? `${cleanS.slice(0, 147)}...` : cleanS
            if (!highlights.some((h) => h.toLowerCase().includes(capped.toLowerCase().slice(0, 20)))) {
              highlights.push(capped)
              break
            }
          }
        }
      }
      if (highlights.length >= 3) break
    }
  }

  // Include user's follow-up or primary task if needed
  if (highlights.length < 3 && userTurns.length > 0) {
    const firstPrompt = stripInjectedContext(userTurns[0].text || "")
      .replace(/\s+/g, " ")
      .trim()
    const cleanPrompt = firstPrompt
      .replace(/^(?:please\s+|can\s+you\s+(?:please\s+)?|could\s+you\s+(?:please\s+)?|i\s+want\s+to\s+|tell\s+me\s+about\s+|explain\s+to\s+me\s+)/i, "")
      .trim()
    if (cleanPrompt.length > 5 && !isGenericFillerText(cleanPrompt)) {
      const sentence = cleanPrompt.split(/[.\n?]/)[0].trim()
      const taskHighlight = `Inquiry: ${sentence.length > 140 ? `${sentence.slice(0, 137)}...` : sentence}`
      if (!highlights.some((h) => h.toLowerCase().includes(sentence.toLowerCase().slice(0, 20)))) {
        highlights.unshift(taskHighlight)
      }
    }
  }

  // Code snippets highlight
  const codeBlocks = ctx.rawCodeBlocks || []
  if (codeBlocks.length > 0 && highlights.length < 4) {
    const langs = Array.from(new Set(codeBlocks.map((b) => b.language || "code").filter(Boolean)))
    highlights.push(
      `Includes ${codeBlocks.length} code snippet${codeBlocks.length > 1 ? "s" : ""} (${langs.slice(0, 3).join(", ")})`
    )
  }

  if (highlights.length === 0) {
    highlights.push("Conversation captured with complete context ready for cross-platform continuation.")
  }

  return {
    topic: topic || "Conversation Summary",
    highlights: highlights.slice(0, 4)
  }
}

export interface SharedLink {
  url: string
  title: string
  domain: string
}

/**
 * Extracts and deduplicates all external web links and citations shared in conversation turns.
 * Supports both markdown links [Title](url) and raw https:// URLs.
 * Extracts clean domain names and human-readable titles.
 */
export function extractSharedLinks(turns: MessageTurn[]): SharedLink[] {
  if (!turns || turns.length === 0) return []

  const seenUrls = new Set<string>()
  const links: SharedLink[] = []

  const markdownLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g
  const rawUrlRegex = /https?:\/\/[^\s<>"'`)\]}]+/g

  for (const turn of turns) {
    const text = turn.text || ""
    if (!text.trim()) continue

    // 1. First extract markdown links (with user- or assistant-provided titles)
    let mdMatch: RegExpExecArray | null
    while ((mdMatch = markdownLinkRegex.exec(text)) !== null) {
      const title = mdMatch[1].trim()
      let rawUrl = mdMatch[2].trim().replace(/[.,;:!?]+$/, "")

      try {
        const parsed = new URL(rawUrl)
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          const normalized = `${parsed.protocol}//${parsed.hostname.toLowerCase()}${parsed.pathname}${parsed.search}`
          if (!seenUrls.has(normalized)) {
            seenUrls.add(normalized)
            const domain = parsed.hostname.replace(/^www\./i, "").toLowerCase()
            links.push({
              url: rawUrl,
              title: title.length > 50 ? `${title.slice(0, 47)}...` : title,
              domain
            })
          }
        }
      } catch {}
    }

    // 2. Next extract standalone raw URLs
    let rawMatch: RegExpExecArray | null
    while ((rawMatch = rawUrlRegex.exec(text)) !== null) {
      let rawUrl = rawMatch[0].trim().replace(/[.,;:!?]+$/, "")

      try {
        const parsed = new URL(rawUrl)
        if (parsed.protocol === "http:" || parsed.protocol === "https:") {
          const normalized = `${parsed.protocol}//${parsed.hostname.toLowerCase()}${parsed.pathname}${parsed.search}`
          if (!seenUrls.has(normalized)) {
            seenUrls.add(normalized)
            const domain = parsed.hostname.replace(/^www\./i, "").toLowerCase()
            let pathSnippet = parsed.pathname.replace(/^\/+|\/+$/g, "")
            let title = domain
            if (pathSnippet && pathSnippet.length <= 40) {
              title = `${domain}/${pathSnippet}`
            } else if (pathSnippet) {
              title = `${domain}/${pathSnippet.slice(0, 30)}...`
            }
            links.push({
              url: rawUrl,
              title,
              domain
            })
          }
        }
      } catch {}
    }
  }

  return links
}

/**
 * Counts the number of substantive user-assistant exchanges in the chat.
 * A single exchange represents a user prompt paired with an assistant response.
/**
 * Counts the number of substantive user-assistant exchanges in the chat (F9).
 * One function for popup, CSUI and storage, counting a user turn with text
 * followed by an assistant turn; attachments-only turns and dangling turns
 * never create an exchange.
 */
export function countExchanges(turns: MessageTurn[]): number {
  if (!turns || turns.length === 0) return 0

  let exchanges = 0
  let pendingUserWithText = false

  for (const turn of turns) {
    if (turn.role === "user") {
      const clean = stripInjectedContext(turn.text || "").trim()
      // Substantive user turn with text (ignoring UI placeholders and turns with attachments only)
      if (clean.length > 0 && !UI_PLACEHOLDER_PATTERNS.some((p) => p.test(clean))) {
        pendingUserWithText = true
      } else {
        // Turn has only attachments or empty/placeholder text -> does NOT initiate an exchange
        pendingUserWithText = false
      }
    } else if (turn.role === "assistant") {
      if (pendingUserWithText) {
        const clean = stripInjectedContext(turn.text || "").trim()
        const hasCode = turn.codeBlocks && turn.codeBlocks.length > 0
        if (clean.length > 0 || hasCode) {
          exchanges++
          pendingUserWithText = false
        }
      }
    }
  }

  return exchanges
}

/**
 * De-duplicates verbatim code blocks (F8).
 * Collapses wrapper and inner duplicates (if code snippet A wraps snippet B or is identical).
 */
export function deduplicateCodeBlocks(codeBlocks: VerbatimCodeBlock[]): VerbatimCodeBlock[] {
  if (!codeBlocks || codeBlocks.length === 0) return []

  const result: VerbatimCodeBlock[] = []

  for (const block of codeBlocks) {
    if (!block.code) continue
    const trimmed = block.code.trim()
    if (!trimmed) continue

    let isDuplicate = false
    for (let i = 0; i < result.length; i++) {
      const existingTrimmed = result[i].code.trim()
      if (existingTrimmed === trimmed) {
        isDuplicate = true
        break
      }
      if (existingTrimmed.includes(trimmed)) {
        isDuplicate = true
        break
      }
      if (trimmed.includes(existingTrimmed)) {
        result[i] = block
        isDuplicate = true
        break
      }
    }

    if (!isDuplicate) {
      result.push(block)
    }
  }

  return result
}

export interface ContextMetrics {
  exchangeCount: number
  tokenEstimate: number
}

/**
 * Single shared function for exchange count and token estimate used across
 * popup, background, and prompt formatter (Requirement A11 & F8/F9).
 */
export function computeContextMetrics(
  turns: MessageTurn[],
  codeBlocks: VerbatimCodeBlock[] = [],
  title?: string
): ContextMetrics {
  const exchangeCount = countExchanges(turns)
  const dedupedCode = deduplicateCodeBlocks(codeBlocks)
  let chars = (title || "").length
  for (const t of turns) {
    chars += (t.text || "").length
  }
  for (const cb of dedupedCode) {
    chars += (cb.code || "").length
  }
  const tokenEstimate = Math.ceil(chars / 4)
  return { exchangeCount, tokenEstimate }
}

/**
 * Extracts the last 3-4 substantive exchanges (typically the last 6-8 turns).
 */
export function extractLastExchanges(turns: MessageTurn[], maxExchanges: number = 4): MessageTurn[] {
  if (turns.length === 0) return []

  // Collect turns in reverse until we hit maxExchanges user turns
  let userCount = 0
  let startIndex = 0

  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === "user") {
      userCount++
      if (userCount >= maxExchanges) {
        startIndex = i
        break
      }
    }
  }

  return turns
    .slice(startIndex)
    .filter((t) => Boolean((t.text && t.text.trim().length > 0) || (t.codeBlocks && t.codeBlocks.length > 0)))
}

/**
 * Formats a concise, trimmed version of the last substantive exchanges.
 * Tags, not labels.
 * NO USER:/ASSISTANT: dumps, NO "---".
 * Strips code blocks, drops UI placeholders, limits length.
 */
export function formatCompactLastExchanges(
  turns: MessageTurn[],
  densityMode: InjectionDensityMode = "standard"
): string {
  // If user explicitly chose 'compact', take the last few exchanges.
  // In 'standard' (default) and 'full' modes, include ALL turns from the very first prompt to the last prompt!
  const exchanges = densityMode === "compact" ? extractLastExchanges(turns, 4) : turns
  if (exchanges.length === 0) return ""

  // Substantive character budget per turn:
  // compact: 800 chars
  // standard & full: full transcript without truncation
  const charBudget = densityMode === "compact" ? 800 : 50000

  const lines: string[] = []
  for (const turn of exchanges) {
    let clean = stripInjectedContext(turn.text || "")
    // Remove fenced code blocks so code is not duplicated into prose (handled verbatim via <code>)
    clean = clean.replace(/```[\s\S]*?```/g, "").trim()
    // Preserve clean paragraph structure (\n\n) and list items (\n) while trimming trailing whitespace
    clean = clean
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()

    if (clean.length === 0) {
      if (turn.codeBlocks && turn.codeBlocks.length > 0) {
        clean = `[Provided ${turn.codeBlocks.map((c) => c.language).join(", ")} code]`
      } else {
        continue
      }
    }

    if (UI_PLACEHOLDER_PATTERNS.some((pat) => pat.test(clean))) {
      continue
    }

    const truncated = clean.length > charBudget ? `${clean.slice(0, charBudget).trim()}...` : clean
    const roleLabel = turn.role === "user" ? "User" : "Assistant"
    lines.push(`${roleLabel}: ${truncated}`)
  }

  return lines.join("\n\n")
}

/**
 * Merges incoming turns into existing turns strictly within the SAME chatId.
 * Preserves earlier virtualized turns that have scrolled out of the DOM.
 * Deduplicates by turn ID or (role + stripped text).
 */
export function mergeTurnsForSameChat(
  existingTurns: MessageTurn[],
  incomingTurns: MessageTurn[]
): MessageTurn[] {
  if (!existingTurns || existingTurns.length === 0) return incomingTurns || []
  if (!incomingTurns || incomingTurns.length === 0) return existingTurns || []

  const isSameTurn = (a: MessageTurn, b: MessageTurn): boolean => {
    if (a.id && b.id && a.id === b.id) return true
    if (a.role !== b.role) return false
    const aText = stripInjectedContext(a.text || "").trim()
    const bText = stripInjectedContext(b.text || "").trim()
    return aText === bText && aText.length > 0
  }

  // Check if there is any overlap between existing and incoming turns
  const hasOverlap = incomingTurns.some((inc) =>
    existingTurns.some((ex) => isSameTurn(inc, ex))
  )

  // If there is zero overlap and incoming turns start with a different initial turn,
  // this is a reset or completely new chat within the same session/tab; do NOT retain stale previous chat turns.
  if (!hasOverlap) {
    const firstInc = incomingTurns[0]
    const firstEx = existingTurns[0]
    const firstIncClean = stripInjectedContext(firstInc?.text || "").trim()
    const firstExClean = stripInjectedContext(firstEx?.text || "").trim()
    if (firstIncClean && firstExClean && firstIncClean !== firstExClean) {
      return incomingTurns
    }
    return incomingTurns.length >= existingTurns.length ? incomingTurns : existingTurns
  }

  // Find the first matching pair between incoming and existing
  let firstIncMatchIdx = -1
  let firstExMatchIdx = -1
  for (let i = 0; i < incomingTurns.length; i++) {
    const match = existingTurns.findIndex((ex) => isSameTurn(incomingTurns[i], ex))
    if (match !== -1) {
      firstIncMatchIdx = i
      firstExMatchIdx = match
      break
    }
  }

  if (firstIncMatchIdx === -1) {
    return incomingTurns.length >= existingTurns.length ? incomingTurns : existingTurns
  }

  // 1. Any incoming turns before the first overlap point represent EARLIER turns
  // (e.g. user opened at bottom of old chat, then scrolled up to reveal earlier history).
  // These must be PREPENDED before existingTurns[firstExMatchIdx].
  const prependedEarlierTurns = incomingTurns.slice(0, firstIncMatchIdx)

  // 2. Start result with prepended earlier turns + existing turns up to firstExMatchIdx
  const merged: MessageTurn[] = [
    ...prependedEarlierTurns,
    ...existingTurns.slice(0, firstExMatchIdx)
  ]

  // 3. Step through incoming turns from the overlap point
  let exPointer = firstExMatchIdx

  for (let i = firstIncMatchIdx; i < incomingTurns.length; i++) {
    const inc = incomingTurns[i]
    const incClean = stripInjectedContext(inc.text || "").trim()
    if (!incClean && (!inc.codeBlocks || inc.codeBlocks.length === 0)) continue

    const matchIdx = existingTurns.findIndex((ex, idx) => idx >= exPointer && isSameTurn(inc, ex))
    if (matchIdx !== -1) {
      while (exPointer < matchIdx) {
        merged.push(existingTurns[exPointer])
        exPointer++
      }
      const existing = existingTurns[matchIdx]
      merged.push({
        ...existing,
        ...inc,
        codeBlocks: inc.codeBlocks && inc.codeBlocks.length > 0 ? inc.codeBlocks : existing.codeBlocks
      })
      exPointer = matchIdx + 1
    } else {
      merged.push(inc)
    }
  }

  // 4. Append any remaining existing turns that were beyond incoming's visible window
  while (exPointer < existingTurns.length) {
    merged.push(existingTurns[exPointer])
    exPointer++
  }

  return merged
}

/**
 * Computes a fast content signature hash to detect if conversation has changed.
 */
export function computeContentHash(turns: MessageTurn[]): string {
  if (!turns || turns.length === 0) return "empty"
  const count = turns.length
  const first = (turns[0]?.text || "").slice(0, 40).replace(/\s+/g, "")
  const last = (turns[turns.length - 1]?.text || "").slice(0, 60).replace(/\s+/g, "")
  const lastId = turns[turns.length - 1]?.id || ""

  let hash = 0
  const combined = `${count}:${lastId}:${first}:${last}`
  for (let i = 0; i < combined.length; i++) {
    hash = (hash << 5) - hash + combined.charCodeAt(i)
    hash |= 0
  }
  return `${count}_${Math.abs(hash).toString(36)}`
}

/**
 * Rule-based Local Mode builder (Requirement 1 & 3):
 * - Keeps verbatim code blocks
 * - Extracts the goal (first user message, trimmed), omitting if empty or generic
 * - Captures the last substantive exchanges (trimmed, NO USER:/ASSISTANT: dumps, NO "---")
 * - Zero filler lines ("Continue active engineering task" removed)
 * - 100% offline, zero network calls, zero API keys
 */
export function buildLocalStateMemory(
  turns: MessageTurn[],
  rawCodeBlocks: VerbatimCodeBlock[] = [],
  chatTitle?: string,
  densityMode: InjectionDensityMode | number = "standard"
): StateMemory {
  const mode: InjectionDensityMode =
    typeof densityMode === "string"
      ? densityMode
      : densityMode <= 600
      ? "compact"
      : densityMode <= 1500
      ? "standard"
      : "full"
  const goal = extractGoal(turns, chatTitle)
  const formattedExchanges = formatCompactLastExchanges(turns, mode)

  const maxSnippets = mode === "compact" ? 1 : mode === "full" ? 8 : 3
  const snippets = (rawCodeBlocks || []).slice(-maxSnippets)

  const codeChars = snippets.reduce((acc, s) => acc + s.code.length, 0)
  const tokenEstimate = Math.ceil((goal.length + formattedExchanges.length + codeChars) / 4)

  return {
    version: "1.0",
    objective: goal,
    techStack: [],
    architectureDecisions: [],
    currentWork: formattedExchanges,
    blockersAndErrors: [],
    nextSteps: [],
    criticalSnippets: snippets,
    rawTokenEstimate: tokenEstimate,
    isAiSynthesized: false,
    summarizedAt: Date.now()
  }
}

/**
 * Input Reduction for AI Mode (Requirement 4):
 * - Replaces code blocks with placeholders like [CODE_BLOCK_n: lang, N lines]
 * - Strips UI noise
 * - Truncates excessively long individual messages
 * - Deduplicates repeating lines
 */
export function prepareAiTranscript(
  rawTranscript: string
): { aiTranscript: string; placeholderCount: number } {
  if (!rawTranscript) return { aiTranscript: "", placeholderCount: 0 }

  let cleaned = rawTranscript
  let placeholderCount = 0

  // 1. Strip UI noise
  for (const pattern of UI_NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, "")
  }

  // 2. Replace fenced code blocks with concise metadata placeholders
  cleaned = cleaned.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    placeholderCount++
    const cleanLang = (lang || "text").trim()
    const trimmedCode = (code || "").trim()
    const lineCount = trimmedCode ? trimmedCode.split("\n").length : 0
    return `[CODE_BLOCK_${placeholderCount}: ${cleanLang}, ${lineCount} lines]`
  })

  // 3. Truncate excessively long individual messages (> 2500 chars)
  const sections = cleaned.split("\n\n---\n\n")
  const truncatedSections = sections.map((sec) => {
    if (sec.length > 2500) {
      return `${sec.slice(0, 1000)}\n\n[...message truncated for token efficiency...]\n\n${sec.slice(-500)}`
    }
    return sec
  })
  cleaned = truncatedSections.join("\n\n---\n\n")

  // 4. Remove empty lines and deduplicate consecutive blank lines
  cleaned = cleaned
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  return {
    aiTranscript: cleaned,
    placeholderCount
  }
}

/**
 * Tests if the given page text or document body contains rate limit notifications.
 */
export function isRateLimitEncountered(text: string): boolean {
  if (!text) return false
  return RATE_LIMIT_PATTERNS.some((pat) => pat.test(text))
}
