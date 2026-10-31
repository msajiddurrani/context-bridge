import type {
  InjectionDensityMode,
  InjectionFormat,
  PlatformId,
  StateMemory,
  StoredContext
} from "../types"
import { buildLocalStateMemory } from "./local-mode"
import { formatMarkdownHandoverExport, formatStateMemoryPrompt } from "./prompt-formatter"
import { generateThreadOutline, type ThreadOutline } from "./outline"

export interface InjectedPromptOptions {
  customStyle?: string
  customResume?: string
  outline?: ThreadOutline
}

/**
 * Builds the canonical injected handover prompt string.
 * Used identically by the real in-page injection click path and popup preview (Working Rule 4).
 */
export function buildInjectedPrompt(
  targetContext: StoredContext,
  targetPlatform: PlatformId = "chatgpt",
  densityMode: InjectionDensityMode = "standard",
  _format: InjectionFormat = "markdown",
  options?: InjectedPromptOptions
): string {
  if (densityMode === "download") {
    return formatMarkdownHandoverExport(targetContext, options?.customResume, options?.customStyle)
  }

  let memoryToFormat: StateMemory
  if (targetContext.turns && targetContext.turns.length > 0) {
    memoryToFormat = buildLocalStateMemory(
      targetContext.turns,
      targetContext.rawCodeBlocks || [],
      targetContext.chatTitle,
      densityMode
    )
    if (targetContext.stateMemory?.objective) {
      memoryToFormat.objective = targetContext.stateMemory.objective
    }
    // Preserve original summarizedAt timestamp if available
    if (targetContext.stateMemory?.summarizedAt) {
      memoryToFormat.summarizedAt = targetContext.stateMemory.summarizedAt
    } else if (targetContext.updatedAt) {
      memoryToFormat.summarizedAt = targetContext.updatedAt
    }
    if (targetContext.stateMemory?.architectureDecisions?.length) {
      memoryToFormat.architectureDecisions = targetContext.stateMemory.architectureDecisions
    }
  } else if (targetContext.stateMemory) {
    memoryToFormat = targetContext.stateMemory
  } else {
    memoryToFormat = buildLocalStateMemory([], targetContext.rawCodeBlocks || [], targetContext.chatTitle, densityMode)
  }

  const outline =
    options?.outline ||
    generateThreadOutline(
      targetContext.turns || [],
      targetContext.stateMemory?.objective || targetContext.chatTitle
    )

  return formatStateMemoryPrompt(memoryToFormat, targetContext.sourcePlatform, targetPlatform, {
    mode: densityMode,
    customStyle: options?.customStyle,
    customResume: options?.customResume,
    outline,
    allTurns: targetContext.turns,
    allCodeBlocks: targetContext.rawCodeBlocks || targetContext.stateMemory?.criticalSnippets || []
  })
}

/**
 * Builds the exact preview string of what the Inject button will insert,
 * following the exact execution path as bridge-csui.tsx handleInject.
 */
export function buildPreviewInjectedText(
  targetContext: StoredContext,
  targetPlatform: PlatformId = "chatgpt",
  densityMode: InjectionDensityMode = "standard",
  format: InjectionFormat = "markdown",
  options?: InjectedPromptOptions
): string {
  return buildInjectedPrompt(targetContext, targetPlatform, densityMode, format, options)
}

