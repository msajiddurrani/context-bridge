import type { MessageTurn } from "../types"
import type { PlatformAdapter } from "../adapters/types"

export interface ScrollCollectorOptions {
  adapter: PlatformAdapter
  doc: Document
  stepDelayMs?: number
  scrollStepPx?: number
  maxConsecutiveTopChecks?: number
  maxTicksWithoutNewMessages?: number
  maxTicks?: number
  onProgress?: (progress: { totalMessages: number; isScrolling: boolean }) => void
  isCancelled?: () => boolean
}

export interface ScrollCollectorResult {
  turns: MessageTurn[]
  totalMessages: number
  stoppedReason: "top_reached" | "no_new_messages" | "cancelled" | "max_ticks"
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Tests whether an element is truly scrollable with scrollable overflow.
 */
export function isElementScrollable(el: HTMLElement, doc: Document): boolean {
  if (el === doc.documentElement || el === doc.body) {
    const docH = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight || 0)
    const winH = doc.defaultView?.innerHeight || doc.documentElement.clientHeight || 0
    return docH > winH + 10
  }
  const style = doc.defaultView?.getComputedStyle(el)
  if (style) {
    const ov = style.overflowY
    if (ov !== "auto" && ov !== "scroll") {
      return false
    }
  }
  return el.scrollHeight > el.clientHeight + 10
}

/**
 * Merges newly discovered turns from a virtualized DOM slice into an accumulated list,
 * preserving chronological order without duplicates.
 */
export function mergeDiscoveredTurns(
  accumulated: MessageTurn[],
  currentTurns: MessageTurn[]
): MessageTurn[] {
  if (accumulated.length === 0) {
    return [...currentTurns]
  }
  if (currentTurns.length === 0) {
    return accumulated
  }

  const isSameTurn = (a: MessageTurn, b: MessageTurn): boolean => {
    if (a.id && b.id && a.id === b.id) return true
    if (a.role !== b.role) return false
    const aText = (a.text || "").trim()
    const bText = (b.text || "").trim()
    return aText === bText && aText.length > 0
  }

  // Find the first turn in currentTurns that already exists in accumulated
  let firstMatchInCurrent = -1
  for (let i = 0; i < currentTurns.length; i++) {
    if (accumulated.some((acc) => isSameTurn(currentTurns[i], acc))) {
      firstMatchInCurrent = i
      break
    }
  }

  const isAlreadyInAccum = (t: MessageTurn) =>
    accumulated.some((acc) => isSameTurn(t, acc))

  if (firstMatchInCurrent === -1) {
    // No direct overlap found. Because we are scrolling upwards,
    // currentTurns are older than accumulated.
    const older = currentTurns.filter((t) => !isAlreadyInAccum(t))
    return [...older, ...accumulated]
  }

  // Turns before firstMatchInCurrent in currentTurns belong BEFORE the matched turn in accumulated
  const newBefore = currentTurns.slice(0, firstMatchInCurrent).filter((t) => !isAlreadyInAccum(t))
  // Any turns after firstMatchInCurrent not yet in accumulated
  const newAfter = currentTurns.slice(firstMatchInCurrent).filter((t) => !isAlreadyInAccum(t))

  let result = [...newBefore, ...accumulated]
  if (newAfter.length > 0) {
    result = [...result, ...newAfter]
  }
  return result
}

/**
 * Resolves the primary scrollable chat container using adapter heuristics
 * and dynamic scroll-height detection across ChatGPT, Claude, and Gemini.
 */
export function findScrollableContainer(adapter: PlatformAdapter, doc: Document): HTMLElement {
  // 1. Traverse upward from sample message or input box to find true scrollable ancestor
  const sample = doc.querySelector<HTMLElement>(
    '[data-message-author-slug], [data-testid*="message"], [data-testid^="conversation-turn-"], user-query, model-response, article, div[class*="font-claude-message"], #prompt-textarea, [contenteditable="true"], form textarea'
  )
  if (sample) {
    let curr: HTMLElement | null = sample.parentElement
    while (curr && curr !== doc.body && curr !== doc.documentElement) {
      if (isElementScrollable(curr, doc)) {
        return curr
      }
      curr = curr.parentElement
    }
  }

  // 2. Check adapter preferred scroll container if truly scrollable
  const preferred = adapter.getScrollContainer?.(doc)
  if (preferred && isElementScrollable(preferred, doc)) {
    return preferred
  }

  // 3. Look for elements with explicit scrollable containers
  const selectors = [
    "#scroll-container",
    ".thread-scroll-container",
    'div[class*="react-scroll-to-bottom"]',
    'div[class*="overflow-y-auto"]',
    "infinite-scroller",
    '[data-testid="chat-history"]',
    ".chat-history",
    "chat-window",
    "main"
  ]
  for (const sel of selectors) {
    const el = doc.querySelector<HTMLElement>(sel)
    if (el && isElementScrollable(el, doc)) {
      return el
    }
  }

  if (preferred) return preferred
  return (doc.scrollingElement as HTMLElement) || doc.documentElement || doc.body
}

/**
 * Progressive virtual scroll collector engine.
 * Smoothly scrolls upward step-by-step to capture full conversation history,
 * de-duplicates turns, handles cancellation, and restores original scroll position.
 */
export async function collectFullChatHistory(
  options: ScrollCollectorOptions
): Promise<ScrollCollectorResult> {
  const {
    adapter,
    doc,
    stepDelayMs = 50,
    scrollStepPx = 400,
    maxConsecutiveTopChecks = 3,
    maxTicksWithoutNewMessages = 5,
    maxTicks = 150,
    onProgress,
    isCancelled
  } = options

  const container: HTMLElement = findScrollableContainer(adapter, doc)

  const originalScrollTop =
    container.scrollTop ?? (container === doc.documentElement ? doc.defaultView?.scrollY || 0 : 0)

  let accumulatedTurns: MessageTurn[] = []
  let consecutiveTopChecks = 0
  let ticksWithoutNew = 0
  let totalTicks = 0
  let stoppedReason: ScrollCollectorResult["stoppedReason"] = "top_reached"

  // Initial pass at current viewport
  const initialTurns = adapter.getMessages(doc)
  accumulatedTurns = mergeDiscoveredTurns(accumulatedTurns, initialTurns)
  onProgress?.({ totalMessages: accumulatedTurns.length, isScrolling: true })

  while (totalTicks < maxTicks) {
    if (isCancelled?.()) {
      stoppedReason = "cancelled"
      break
    }

    if (adapter.isLoadingOlderMessages?.(doc)) {
      await delay(100)
      continue
    }

    const currentScroll =
      container.scrollTop ?? (container === doc.documentElement ? doc.defaultView?.scrollY || 0 : 0)

    if (currentScroll <= 0) {
      consecutiveTopChecks++
      if (stepDelayMs > 0) {
        await delay(Math.max(120, stepDelayMs * 2))
      }
      if (consecutiveTopChecks >= maxConsecutiveTopChecks) {
        stoppedReason = "top_reached"
        break
      }
    } else {
      consecutiveTopChecks = 0
      const nextScroll = Math.max(0, currentScroll - scrollStepPx)
      if (container === doc.documentElement && doc.defaultView?.scrollTo) {
        doc.defaultView.scrollTo(0, nextScroll)
      } else {
        container.scrollTop = nextScroll
      }

      try {
        const EventConstructor = doc.defaultView?.Event || Event
        container.dispatchEvent(new EventConstructor("scroll", { bubbles: true }))
      } catch {
        // Ignore event dispatch failure in non-standard test DOMs
      }
    }

    if (stepDelayMs > 0) {
      await delay(stepDelayMs)
    }

    // Scrape newly mounted turns
    const currentTurns = adapter.getMessages(doc)
    const prevCount = accumulatedTurns.length
    accumulatedTurns = mergeDiscoveredTurns(accumulatedTurns, currentTurns)
    const newAdded = accumulatedTurns.length - prevCount

    onProgress?.({ totalMessages: accumulatedTurns.length, isScrolling: true })

    if (newAdded === 0) {
      ticksWithoutNew++
      if (ticksWithoutNew >= maxTicksWithoutNewMessages && currentScroll <= 0) {
        stoppedReason = "no_new_messages"
        break
      }
    } else {
      ticksWithoutNew = 0
    }

    totalTicks++
  }

  if (totalTicks >= maxTicks && stoppedReason === "top_reached") {
    stoppedReason = "max_ticks"
  }

  // Restore original scroll position exactly
  if (container === doc.documentElement && doc.defaultView?.scrollTo) {
    doc.defaultView.scrollTo(0, originalScrollTop)
  } else {
    container.scrollTop = originalScrollTop
  }

  try {
    const EventConstructor = doc.defaultView?.Event || Event
    container.dispatchEvent(new EventConstructor("scroll", { bubbles: true }))
  } catch {
    // Ignore event dispatch failure in non-standard test DOMs
  }

  return {
    turns: accumulatedTurns,
    totalMessages: accumulatedTurns.length,
    stoppedReason
  }
}
