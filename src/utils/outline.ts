import type { MessageTurn } from "../types"
import { isGenericFillerText } from "./prompt-formatter"

export interface ThreadOutline {
  summary: string
  decisions: string[]
  openQuestions: string[]
}

/**
 * Heuristically extracts a structured thread outline from conversation turns.
 * Analyzes turns for high-level thread summary, architectural decisions, and open questions/tasks.
 */
export function generateThreadOutline(
  turns: MessageTurn[] = [],
  fallbackGoal?: string
): ThreadOutline {
  if (turns.length === 0) {
    const summary = fallbackGoal && !isGenericFillerText(fallbackGoal)
      ? fallbackGoal.trim()
      : "Active engineering conversation thread."
    return {
      summary,
      decisions: [],
      openQuestions: []
    }
  }

  // 1. Identify primary goal / initial task
  const firstUserTurn = turns.find((t) => t.role === "user" && t.text?.trim().length > 0)
  const initialTask = firstUserTurn?.text?.split("\n")[0].trim() || fallbackGoal || "Technical conversation"

  // 2. Identify latest progress or milestone from the last assistant turn
  const assistantTurns = turns.filter((t) => t.role === "assistant" && t.text?.trim().length > 0)
  const lastAssistantTurn = assistantTurns[assistantTurns.length - 1]

  let milestone = ""
  if (lastAssistantTurn && lastAssistantTurn.text) {
    const firstSentence = lastAssistantTurn.text
      .split(/(?<=[.!?])\s+/)[0]
      ?.trim()
      .replace(/^#+\s*/, "")
    if (firstSentence && !isGenericFillerText(firstSentence) && firstSentence.length > 15) {
      milestone = firstSentence
    }
  }

  // Construct 1-2 sentence high-level summary
  let summary = initialTask
  if (milestone && milestone.toLowerCase() !== initialTask.toLowerCase()) {
    const cleanInitial = initialTask.endsWith(".") ? initialTask : `${initialTask}.`
    const cleanMilestone = milestone.endsWith(".") ? milestone : `${milestone}.`
    summary = `${cleanInitial} Current progress: ${cleanMilestone}`
  }

  // 3. Extract Key Decisions & Facts
  const decisions: string[] = []
  const decisionRegex = /\b(decided to|we will use|use\s+[a-z0-9_-]+\s+for|chose|selected|configured|implemented|architecture|key decisions?|decision)\b/i
  const listBulletRegex = /^[-*•\d.]\s*(.*)$/

  for (const turn of turns) {
    const lines = turn.text.split("\n")
    let inDecisionSection = false

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line) {
        inDecisionSection = false
        continue
      }

      if (/key decisions?:?/i.test(line) || /architecture decisions?:?/i.test(line)) {
        inDecisionSection = true
        continue
      }

      const matchBullet = line.match(listBulletRegex)
      if (matchBullet) {
        const itemText = matchBullet[1].trim()
        if (inDecisionSection || decisionRegex.test(itemText)) {
          if (itemText.length > 5 && !isGenericFillerText(itemText) && !itemText.endsWith("?")) {
            decisions.push(itemText)
          }
        }
      } else if (inDecisionSection || (decisionRegex.test(line) && !line.endsWith("?"))) {
        const cleaned = line.replace(/^Key Decisions?:?\s*/i, "").trim()
        if (cleaned.length > 10 && !isGenericFillerText(cleaned)) {
          decisions.push(cleaned)
        }
      }
    }
  }

  // 4. Extract Open Questions & Tasks
  const openQuestions: string[] = []
  const taskKeywords = /\b(open questions?|next steps?|todo|remaining|need to|should we|how do we|how should we|can we)\b/i

  for (const turn of turns) {
    const lines = turn.text.split("\n")
    let inQuestionSection = false

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line) {
        inQuestionSection = false
        continue
      }

      if (/open questions?:?/i.test(line) || /next steps?:?/i.test(line)) {
        inQuestionSection = true
        continue
      }

      const matchBullet = line.match(listBulletRegex)
      if (matchBullet) {
        const itemText = matchBullet[1].trim()
        if (inQuestionSection || itemText.endsWith("?") || taskKeywords.test(itemText)) {
          if (itemText.length > 5 && !isGenericFillerText(itemText)) {
            openQuestions.push(itemText)
          }
        }
      } else if (inQuestionSection || line.endsWith("?") || taskKeywords.test(line)) {
        const cleaned = line.replace(/^(open questions?|next steps?):?\s*/i, "").trim()
        if (cleaned.length > 10 && !isGenericFillerText(cleaned)) {
          openQuestions.push(cleaned)
        }
      }
    }
  }

  // Deduplicate items
  const uniqueDecisions = Array.from(new Set(decisions)).slice(0, 8)
  const uniqueQuestions = Array.from(new Set(openQuestions)).slice(0, 6)

  return {
    summary: summary.slice(0, 300),
    decisions: uniqueDecisions,
    openQuestions: uniqueQuestions
  }
}

/**
 * Formats a ThreadOutline into an XML-delimited outline block.
 */
export function formatOutlineBlock(outline: ThreadOutline): string {
  const parts: string[] = ["<outline>"]
  parts.push(`Summary: ${outline.summary}`)

  if (outline.decisions.length > 0) {
    parts.push("Key Decisions:")
    for (const d of outline.decisions) {
      parts.push(`- ${d}`)
    }
  }

  if (outline.openQuestions.length > 0) {
    parts.push("Open Questions:")
    for (const q of outline.openQuestions) {
      parts.push(`- ${q}`)
    }
  }

  parts.push("</outline>")
  return parts.join("\n")
}
