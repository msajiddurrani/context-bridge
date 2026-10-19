import type {
  InjectionDensityMode,
  PlatformId,
  StoredContext
} from "../types"
import { buildLocalStateMemory } from "./local-mode"
import { formatStateMemoryPrompt } from "./prompt-formatter"

/**
 * Builds the exact preview string of what the Inject button will insert,
 * following the exact execution path as bridge-csui.tsx handleInject.
 */
export function buildPreviewInjectedText(
  targetContext: StoredContext,
  targetPlatform: PlatformId = "chatgpt",
  densityMode: InjectionDensityMode = "compact"
): string {
  const adjustedMemory = buildLocalStateMemory(
    targetContext.turns || [],
    targetContext.rawCodeBlocks || [],
    targetContext.chatTitle,
    densityMode
  )
  if (!adjustedMemory.objective && targetContext.stateMemory?.objective) {
    adjustedMemory.objective = targetContext.stateMemory.objective
  }
  return formatStateMemoryPrompt(adjustedMemory, targetContext.sourcePlatform, targetPlatform)
}
