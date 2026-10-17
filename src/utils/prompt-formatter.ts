import type { PlatformId, StateMemory } from "../types"

/**
 * Formats neutral StateMemory into a high-density, prompt-ready handover block.
 * Code blocks are output VERBATIM from the criticalSnippets array.
 */
export function formatStateMemoryPrompt(
  memory: StateMemory,
  fromPlatform: PlatformId,
  targetPlatform: PlatformId
): string {
  const platformName = fromPlatform.toUpperCase()
  const targetName = targetPlatform.toUpperCase()

  const sections: string[] = [
    `# 🌉 [CONTEXT BRIDGE: HANDOVER FROM ${platformName} ➔ ${targetName}]`,
    `> Continuous context synchronization layer. Resume the technical engineering session without repeating context.\n`
  ]

  if (memory.objective) {
    sections.push(`### 1. Primary Objective & Goal\n${memory.objective}\n`)
  }

  if (memory.techStack && memory.techStack.length > 0) {
    sections.push(
      `### 2. Active Tech Stack & Dependencies\n${memory.techStack.map((item) => `- ${item}`).join("\n")}\n`
    )
  }

  if (memory.architectureDecisions && memory.architectureDecisions.length > 0) {
    sections.push(
      `### 3. Decisions & Architecture Established\n${memory.architectureDecisions.map((item) => `- ${item}`).join("\n")}\n`
    )
  }

  if (memory.currentWork) {
    sections.push(`### 4. Current Work & Status\n${memory.currentWork}\n`)
  }

  if (memory.blockersAndErrors && memory.blockersAndErrors.length > 0) {
    sections.push(
      `### 5. Active Blockers & Errors\n${memory.blockersAndErrors.map((item) => `- ${item}`).join("\n")}\n`
    )
  }

  // Inject verbatim code blocks (never paraphrased)
  if (memory.criticalSnippets && memory.criticalSnippets.length > 0) {
    sections.push("### 6. Critical Code State (Verbatim Snippets)\n")
    for (const snippet of memory.criticalSnippets) {
      sections.push(`\`\`\`${snippet.language || "text"}\n${snippet.code}\n\`\`\`\n`)
    }
  }

  if (memory.nextSteps && memory.nextSteps.length > 0) {
    sections.push(
      `### 7. Immediate Next Task for ${targetName}\n${memory.nextSteps.map((item) => `- ${item}`).join("\n")}\n`
    )
  }

  sections.push(
    `--- Please acknowledge this context and execute the next task directly without re-explaining the established architecture.`
  )

  return sections.join("\n")
}
