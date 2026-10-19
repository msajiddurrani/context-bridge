import type { PlatformId, StateMemory } from "../types"

/**
 * Delimiters for injected handover blocks.
 * Plain ASCII ONLY to avoid any charset/emoji encoding corruption (e.g. U+FFFD).
 */
export const CB_INJECT_HEADER_PREFIX = "=== [CONTEXT BRIDGE: HANDOVER FROM"
export const CB_INJECT_FOOTER = "=== [END OF CONTEXT BRIDGE HANDOVER] ==="

/**
 * Detects whether a string is a generic system placeholder or empty filler.
 */
export function isGenericFillerText(text: string): boolean {
  if (!text) return true
  const lower = text.trim().toLowerCase()
  return (
    lower === "" ||
    lower === "claude" ||
    lower === "chatgpt" ||
    lower === "gemini" ||
    lower === "perplexity" ||
    lower === "deepseek" ||
    lower === "grok" ||
    lower === "continue active engineering task" ||
    lower === "ongoing engineering discussion" ||
    lower === "active technical task" ||
    lower === "technical discussion" ||
    lower === "active discussion" ||
    lower === "chatgpt conversation" ||
    lower === "claude conversation" ||
    lower === "new chat" ||
    lower === "new conversation" ||
    lower === "untitled" ||
    lower === "ready" ||
    lower === "ready." ||
    lower.startsWith("reply \"ready") ||
    lower.startsWith("reply 'ready") ||
    lower.startsWith("reply ready") ||
    lower.startsWith("please acknowledge") ||
    lower.startsWith("message collapsed") ||
    lower.startsWith("collapsed message")
  )
}

/**
 * Formats elapsed time into a compact string (e.g. "2m", "15s", "1h").
 */
export function formatCompactAge(timestamp?: number, now: number = Date.now()): string {
  if (!timestamp || typeof timestamp !== "number" || timestamp <= 0) {
    return "just now"
  }
  const diffSec = Math.max(0, Math.floor((now - timestamp) / 1000))
  if (diffSec < 60) {
    return `${Math.max(1, diffSec)}s`
  }
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) {
    return `${diffMin}m`
  }
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) {
    return `${diffHours}h`
  }
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d`
}

/**
 * Formats neutral StateMemory into a high-density, prompt-ready handover block.
 * Renders tags, not labels:
 * <ctx from="chatgpt" age="2m">
 * Continue this work. Don't re-summarize. Reply "Ready" in one word, then wait for my next message.
 * <goal>...</goal>
 * <last>short version of the last 3-4 exchanges (trimmed)</last>
 * <code file lang>...verbatim...</code>
 * </ctx>
 * Omit empty sections. No USER:/ASSISTANT: dumps, no "---", no generic filler.
 */
export function formatStateMemoryPrompt(
  memory: StateMemory,
  fromPlatform: PlatformId,
  _targetPlatform?: PlatformId,
  ageString?: string
): string {
  const platform = fromPlatform.toLowerCase()
  const age = ageString || formatCompactAge(memory.summarizedAt)

  const sections: string[] = [
    `<ctx from="${platform}" age="${age}">`,
    `Continue this work. Don't re-summarize. Reply "Ready" in one word, then wait for my next message.`
  ]

  // <goal> - Requirement 5 & Design G: Always emit a <goal> tag (first user request of THIS chat, trimmed)
  let goal = (memory.compactSummary?.goal || memory.objective || "").trim()
  if (!goal || isGenericFillerText(goal) || /message collapsed/i.test(goal) || /collapsed message/i.test(goal)) {
    if (memory.currentWork) {
      const match = memory.currentWork.match(/User:\s*([^\n]+)/i)
      if (
        match &&
        match[1]?.trim() &&
        !isGenericFillerText(match[1]) &&
        !/message collapsed/i.test(match[1]) &&
        !/collapsed message/i.test(match[1])
      ) {
        goal = match[1].trim()
      }
    }
  }
  if (!goal || isGenericFillerText(goal) || /message collapsed/i.test(goal) || /collapsed message/i.test(goal)) {
    goal = "Active conversation"
  }
  sections.push(`<goal>${goal}</goal>`)

  // <last> - short version of the last 3-4 exchanges (trimmed)
  const last = (memory.compactSummary?.state || memory.currentWork || "").trim()
  if (last && !isGenericFillerText(last)) {
    sections.push(`<last>${last}</last>`)
  }

  // Optional AI-mode tags if present - omit empty sections
  const decisions = (memory.compactSummary?.decisions || memory.architectureDecisions || []).filter(
    (d) => d && !isGenericFillerText(d)
  )
  if (decisions.length > 0) {
    sections.push(`<decisions>${decisions.join("; ")}</decisions>`)
  }

  // Verbatim code blocks preserved strictly without summarizing or paraphrasing
  if (memory.criticalSnippets && memory.criticalSnippets.length > 0) {
    for (const snippet of memory.criticalSnippets) {
      if (snippet.code && snippet.code.trim().length > 0) {
        const lang = (snippet.language || "text").trim()
        const fileAttr = snippet.filePath ? ` file="${snippet.filePath}"` : ""
        sections.push(`<code${fileAttr} lang="${lang}">\n${snippet.code}\n</code>`)
      }
    }
  }

  sections.push(`</ctx>`)

  return sections.join("\n")
}

/**
 * Strips out any previously injected Context Bridge handover prompt from captured message text
 * to prevent nested context accumulation.
 * Handles both new (<ctx from=...>) and legacy (=== [CONTEXT BRIDGE...) handover blocks,
 * including nested or repeated injections.
 */
export function stripInjectedContext(text: string): string {
  if (!text) return ""

  let cleaned = text
  let prev = ""

  // Iteratively strip from innermost to outermost to resolve nested context blocks
  while (cleaned !== prev) {
    prev = cleaned

    // 1. Remove innermost XML-style <ctx ...>...</ctx> with any trailing handshake prompt
    cleaned = cleaned.replace(
      /<ctx\b[^>]*>(?:(?!<ctx\b)[\s\S])*?<\/ctx>(?:\s*(?:Reply\s*["']?Ready[^\n]*|Please acknowledge[^\n]*))?/gi,
      ""
    )

    // 2. Remove standard legacy ASCII delimited block (both === [END OF CONTEXT BRIDGE... and variants)
    cleaned = cleaned.replace(
      /===+\s*\[?CONTEXT BRIDGE: HANDOVER[\s\S]*?===+\s*\[END OF CONTEXT BRIDGE[^\]]*\]\s*===+(?:\s*(?:Reply\s*["']?Ready[^\n]*|Please acknowledge[^\n]*))?/gi,
      ""
    )
    cleaned = cleaned.replace(
      /===+\s*\[?CONTEXT BRIDGE: HANDOVER[\s\S]*?===+\s*\[END OF CONTEXT BRIDGE[^=]*===+/gi,
      ""
    )

    // 3. Remove alternate header blocks
    cleaned = cleaned.replace(
      /(?:#+\s*)?(?:[^\w\s])?\s*\[?CONTEXT BRIDGE: HANDOVER[\s\S]*?(?:without re-explaining[^\n]*|===|(?=\n\n[A-Z]))/gi,
      ""
    )

    // 4. Remove standalone legacy === [CONTEXT BRIDGE ... === blocks
    cleaned = cleaned.replace(/===+\s*\[?CONTEXT BRIDGE[\s\S]*?===+/gi, "")
  }

  // Final cleanup of any stray tags or trailing handshake lines
  cleaned = cleaned
    .replace(/<\/ctx>/gi, "")
    .replace(/<ctx\b[^>]*>/gi, "")
    .replace(/^(?:Reply\s*["']?Ready["']?[^\n]*|Please acknowledge[^\n]*)$/gim, "")

  return cleaned.trim()
}

/**
 * Checks whether a message turn was exclusively an injected handover prompt.
 */
export function isInjectedTurn(text: string): boolean {
  if (!text) return false
  if (
    text.includes("<ctx") ||
    text.includes(CB_INJECT_HEADER_PREFIX) ||
    text.includes("CONTEXT BRIDGE: HANDOVER")
  ) {
    const stripped = stripInjectedContext(text)
    // If nothing substantial remains after stripping, this turn was purely an injected handover
    return (
      stripped.length < 10 ||
      /^reply\s*["']?ready/i.test(stripped) ||
      /^please acknowledge/i.test(stripped)
    )
  }
  return false
}
