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
 * Counts the number of substantive user-assistant exchanges in the chat.
 * A single exchange represents a user prompt paired with an assistant response.
 */
export function countExchanges(turns: MessageTurn[]): number {
  if (!turns || turns.length === 0) return 0
  let userTurns = 0
  for (const turn of turns) {
    if (turn.role === "user") {
      const clean = stripInjectedContext(turn.text || "").trim()
      if (clean.length > 0 && !UI_PLACEHOLDER_PATTERNS.some((p) => p.test(clean))) {
        userTurns++
      }
    }
  }
  if (userTurns === 0 && turns.length > 0) {
    return Math.max(1, Math.floor(turns.length / 2))
  }
  return userTurns
}

export interface ContextMetrics {
  exchangeCount: number
  tokenEstimate: number
}

/**
 * Single shared function for exchange count and token estimate used across
 * popup, background, and prompt formatter (Requirement A11).
 */
export function computeContextMetrics(
  turns: MessageTurn[],
  codeBlocks: VerbatimCodeBlock[] = [],
  title?: string
): ContextMetrics {
  const exchangeCount = countExchanges(turns)
  let chars = (title || "").length
  for (const t of turns) {
    chars += (t.text || "").length
  }
  for (const cb of codeBlocks) {
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
  const maxExchanges = densityMode === "compact" ? 2 : densityMode === "full" ? 6 : 4
  const exchanges = extractLastExchanges(turns, maxExchanges)
  if (exchanges.length === 0) return ""

  const charBudget = densityMode === "compact" ? 120 : densityMode === "full" ? 400 : 200

  const lines: string[] = []
  for (const turn of exchanges) {
    let clean = stripInjectedContext(turn.text || "")
    // Remove fenced code blocks so code is not duplicated into prose
    clean = clean.replace(/```[\s\S]*?```/g, "").trim()
    clean = clean.replace(/\s+/g, " ").trim()

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

    const truncated = clean.length > charBudget ? `${clean.slice(0, charBudget)}...` : clean
    const roleLabel = turn.role === "user" ? "User" : "Assistant"
    lines.push(`${roleLabel}: ${truncated}`)
  }

  return lines.join("\n")
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

  const merged = [...existingTurns]
  for (const inc of incomingTurns) {
    const incClean = stripInjectedContext(inc.text || "").trim()
    if (!incClean && (!inc.codeBlocks || inc.codeBlocks.length === 0)) continue

    const existingIndex = merged.findIndex((ex) => {
      if (ex.id && inc.id && ex.id === inc.id) return true
      return ex.role === inc.role && stripInjectedContext(ex.text || "").trim() === incClean
    })

    if (existingIndex >= 0) {
      merged[existingIndex] = {
        ...merged[existingIndex],
        ...inc,
        codeBlocks: inc.codeBlocks && inc.codeBlocks.length > 0 ? inc.codeBlocks : merged[existingIndex].codeBlocks
      }
    } else {
      merged.push(inc)
    }
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
