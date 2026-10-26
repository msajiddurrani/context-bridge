import type { PlasmoCSConfig, PlasmoGetStyle } from "plasmo"
import { useEffect, useRef, useState } from "react"
import { getAdapterForUrl } from "../adapters"
import type { PlatformAdapter } from "../adapters/types"
import type { InjectedRecord, InjectionDensityMode, MessageTurn, PlatformDebugInfo, PlatformId, StoredContext, SummarizeTrigger, VerbatimCodeBlock } from "../types"
import {
  getInjectedRecords,
  getInjectionFormat,
  getStoredContexts,
  isContextInvalidated,
  isInjected,
  markChatInjected,
  mintTemporarySessionId
} from "../utils/storage-manager"
import { filterEligibleContexts, isGenericOrNewChatId } from "../utils/context-filter"
import { generateDomSkeleton } from "../utils/dom-skeleton"
import { findMarkerPathReport } from "../utils/dom-marker-path"
import {
  buildLocalStateMemory,
  isRateLimitEncountered,
  mergeTurnsForSameChat
} from "../utils/local-mode"
import {
  formatStateMemoryPrompt,
  isGenericFillerText,
  stripInjectedContext
} from "../utils/prompt-formatter"
import { buildFullSiteReport } from "../utils/dom-investigator"
import cssText from "data-text:../style.css"

export const INVESTIGATOR_HOSTS: string[] = []

export function isInvestigatorHost(hostname: string): boolean {
  if (!hostname) return false
  const h = hostname.toLowerCase()
  return INVESTIGATOR_HOSTS.some((ih) => h === ih || h.endsWith(`.${ih}`))
}

/**
 * Requirement 7: Guards chrome.runtime.sendMessage against "Extension context invalidated".
 */
export function safeSendMessage<T = any>(message: any, callback?: (response: T) => void): void {
  if (isContextInvalidated()) return
  try {
    if (typeof chrome === "undefined" || !chrome.runtime?.id) return
    chrome.runtime.sendMessage(message, (res) => {
      const err = chrome.runtime?.lastError
      if (err) {
        if (isContextInvalidated(err)) return
        console.debug("[ContextBridge SafeSend] runtime error:", err.message)
        return
      }
      callback?.(res)
    })
  } catch (err: any) {
    if (isContextInvalidated(err)) return
    console.debug("[ContextBridge SafeSend] exception:", err?.message)
  }
}

// Monkey-patch history.pushState and history.replaceState to instantly detect SPA in-app navigations
if (typeof window !== "undefined" && !(window as any).__cb_history_patched) {
  try {
    ;(window as any).__cb_history_patched = true
    const origPush = window.history.pushState
    window.history.pushState = function (...args) {
      const res = origPush.apply(this, args)
      window.dispatchEvent(new Event("contextbridge:navigation"))
      return res
    }
    const origReplace = window.history.replaceState
    window.history.replaceState = function (...args) {
      const res = origReplace.apply(this, args)
      window.dispatchEvent(new Event("contextbridge:navigation"))
      return res
    }
  } catch {
    // Ignore in strict extension contexts
  }
}

export const config: PlasmoCSConfig = {
  matches: [
    "https://claude.ai/*",
    "https://chatgpt.com/*",
    "https://*.chatgpt.com/*",
    "https://gemini.google.com/*"
  ],
  run_at: "document_idle"
}

/**
 * Creates closed Shadow DOM and injects styles via constructable stylesheets (adoptedStyleSheets).
 * Invariants:
 * 1. Shadow DOM mode is strictly "closed" (Directive 8).
 * 2. Uses adoptedStyleSheets instead of raw <style> tags to avoid CSP style-src inline violations (Directive 7).
 */
export const createShadowRoot = (shadowHost: HTMLElement) => {
  const shadowRoot = shadowHost.attachShadow({ mode: "closed" })
  // Requirement J: Strip @import rules because CSSStyleSheet.replaceSync throws DOMException if @import exists
  const safeCss = (cssText || "")
    .replace(/@import\s+[^;]+;/gi, "")
    .replaceAll(":root", ":host(plasmo-csui)")
  try {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(safeCss)
    shadowRoot.adoptedStyleSheets = [sheet]
  } catch {
    const style = document.createElement("style")
    style.textContent = safeCss
    shadowRoot.appendChild(style)
  }
  return shadowRoot
}

export const getStyle: PlasmoGetStyle = () => {
  // Empty style to prevent Plasmo from injecting an un-adopted <style> tag into DOM
  return document.createElement("style")
}

function computeHash(turns: any[]): string {
  if (turns.length === 0) return ""
  const last = turns[turns.length - 1]
  return `${turns.length}:${last?.role || ""}:${(last?.text || "").slice(0, 40)}`
}

function hashStringToBase36(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash |= 0
  }
  return Math.abs(hash).toString(36).slice(0, 8)
}

function timeAgo(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp)
  const mins = Math.floor(elapsed / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/**
 * Top-level telemetry broadcaster (Directive 6).
 * Computes turns count, container detection, and active selector without waiting for button click.
 */
function broadcastLiveTelemetry(source: string = "auto"): PlatformDebugInfo | null {
  if (typeof window === "undefined" || typeof document === "undefined" || isContextInvalidated()) return null
  const matchedAdapter = getAdapterForUrl(window.location.href)
  if (!matchedAdapter) return null

  const turns = matchedAdapter.getMessages(document)
  const resolvedContainer = matchedAdapter.getChatContainer
    ? matchedAdapter.getChatContainer(document)
    : document.body
  const containerFound = Boolean(resolvedContainer && resolvedContainer !== document.body)
  const matchedSelector =
    (matchedAdapter as any).lastMatchedSelector || (turns.length > 0 ? "matched" : "none")
  let currentChatId = matchedAdapter.getChatId(window.location.href, document)

  if (!currentChatId || isGenericOrNewChatId(currentChatId)) {
    const domConvEl = document.querySelector<HTMLElement>("[data-chatgpt-selection-conversation-id]")
    const domConvId = domConvEl?.getAttribute("data-chatgpt-selection-conversation-id")?.trim()
    if (domConvId && !isGenericOrNewChatId(domConvId)) {
      currentChatId = domConvId
    } else if (turns.length > 0) {
      const firstUserTurn = turns.find((t) => t.role === "user")?.text || ""
      if (firstUserTurn.trim().length > 0) {
        const promptHash = hashStringToBase36(firstUserTurn.trim())
        currentChatId = `active-${matchedAdapter.id}-${promptHash}`
      }
    }
  }

  const telemetry: PlatformDebugInfo = {
    platform: matchedAdapter.id,
    displayName: matchedAdapter.displayName,
    url: window.location.href,
    chatId: currentChatId,
    adapterSelected: `${matchedAdapter.displayName} (${matchedAdapter.id})`,
    chatContainerFound: containerFound,
    containerTag: resolvedContainer ? resolvedContainer.tagName.toLowerCase() : "none",
    messagesCount: turns.length,
    matchedSelector,
    timestamp: Date.now()
  }

  safeSendMessage({
    type: "UPDATE_DEBUG_TELEMETRY",
    payload: telemetry
  })

  return telemetry
}

let navWatcherTimer: any = null
let navWatcherEvents: Array<{ timeOffset: string; path: string }> = []
let navWatcherStart = 0

export function startNavigationWatcher(): void {
  navWatcherEvents = [{ timeOffset: "0.0s", path: window.location.pathname }]
  navWatcherStart = Date.now()
  if (navWatcherTimer) clearInterval(navWatcherTimer)

  const recordNav = () => {
    const elapsed = ((Date.now() - navWatcherStart) / 1000).toFixed(1) + "s"
    const currentPath = window.location.pathname
    const last = navWatcherEvents[navWatcherEvents.length - 1]
    if (!last || last.path !== currentPath) {
      navWatcherEvents.push({ timeOffset: elapsed, path: currentPath })
    }
  }

  const poller = setInterval(recordNav, 250)
  navWatcherTimer = setTimeout(() => {
    clearInterval(poller)
    recordNav()
  }, 20000)
}

if (typeof window !== "undefined") {
  ;(window as any).__cb_investigator = (marker1: string, marker2: string, navEvents?: any) => {
    return buildFullSiteReport(document, window, {
      marker1,
      marker2,
      navEvents: navEvents || navWatcherEvents
    })
  }
}

// Top-level message listener (Directive 2 & Requirement 7).
// Runs immediately on script evaluation across ALL 6 supported platforms.
if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (isContextInvalidated()) {
      sendResponse({ success: false, error: "EXTENSION_CONTEXT_INVALIDATED" })
      return false
    }

    if (msg?.type === "PING") {
      const isInvestigator = isInvestigatorHost(window.location.hostname)
      sendResponse({
        success: true,
        isInvestigator,
        hostname: window.location.hostname
      })
      return true
    }

    if (msg?.type === "START_NAVIGATION_WATCH") {
      startNavigationWatcher()
      sendResponse({ success: true, startedAt: Date.now() })
      return true
    }

    if (msg?.type === "GET_NAVIGATION_EVENTS") {
      sendResponse({ success: true, events: navWatcherEvents })
      return true
    }

    if (msg?.type === "GENERATE_FULL_SITE_REPORT") {
      try {
        const marker1 = msg.payload?.marker1 || "zzmarker1"
        const marker2 = msg.payload?.marker2 || "zzmarker2"
        const navHistory = msg.payload?.navEvents || navWatcherEvents
        const report = buildFullSiteReport(document, window, {
          marker1,
          marker2,
          navEvents: navHistory
        })
        sendResponse({
          success: true,
          report,
          hostname: window.location.hostname
        })
      } catch (err: any) {
        sendResponse({
          success: false,
          error: err?.message || "Failed to generate investigator report"
        })
      }
      return true
    }

    if (msg?.type === "REQUEST_DOM_SKELETON") {
      try {
        const matchedAdapter = getAdapterForUrl(window.location.href)
        const target =
          document.querySelector("main") ||
          (matchedAdapter?.getChatContainer ? matchedAdapter.getChatContainer(document) : null) ||
          document.body
        const skeleton = generateDomSkeleton(target, { maxDepth: 12, maxElements: 400 })
        sendResponse({
          success: true,
          platform: matchedAdapter?.id || "unknown",
          tag: target.tagName.toLowerCase(),
          skeleton
        })
      } catch (err: any) {
        sendResponse({
          success: false,
          error: err?.message || "Failed to generate skeleton"
        })
      }
      return true
    }

    if (msg?.type === "FIND_MARKER_PATH") {
      try {
        const marker = msg.payload?.marker || "zzmarker1"
        const matchedAdapter = getAdapterForUrl(window.location.href)
        const target =
          document.querySelector("main") ||
          (matchedAdapter?.getChatContainer ? matchedAdapter.getChatContainer(document) : null) ||
          document.body
        const report = findMarkerPathReport(marker, target)
        sendResponse({
          success: true,
          platform: matchedAdapter?.id || "unknown",
          tag: target.tagName.toLowerCase(),
          report
        })
      } catch (err: any) {
        sendResponse({
          success: false,
          error: err?.message || "Failed to find marker path"
        })
      }
      return true
    }

    if (msg?.type === "REQUEST_LIVE_DOM_SCRAPE") {
      try {
        const telemetry = broadcastLiveTelemetry("request_live_dom_scrape")
        if (!telemetry) {
          sendResponse({ success: false, error: "No adapter matched current URL" })
        } else {
          sendResponse({
            success: true,
            platform: telemetry.platform,
            chatId: telemetry.chatId,
            turnsCount: telemetry.messagesCount,
            matchedSelector: telemetry.matchedSelector,
            containerFound: telemetry.chatContainerFound
          })
        }
      } catch (err: any) {
        sendResponse({
          success: false,
          error: err?.message || "Failed to execute live scrape"
        })
      }
      return true
    }

    // Fallback: Every onMessage path MUST call sendResponse
    sendResponse({ success: false, error: "UNHANDLED_CONTENT_MESSAGE" })
    return false
  })
}

// Auto-run telemetry broadcasts on page load (Directive 6) - on adapted platforms
if (typeof window !== "undefined") {
  broadcastLiveTelemetry("immediate_load")
  setTimeout(() => broadcastLiveTelemetry("load_500ms"), 500)
  setTimeout(() => broadcastLiveTelemetry("load_1500ms"), 1500)
  setTimeout(() => broadcastLiveTelemetry("load_3000ms"), 3000)
  window.addEventListener("load", () => broadcastLiveTelemetry("window_load"))
  window.addEventListener("contextbridge:navigation", () => broadcastLiveTelemetry("navigation"))
}

function ActiveBridgeOverlay() {
  const [adapter, setAdapter] = useState<PlatformAdapter | null>(null)
  const [contexts, setContexts] = useState<StoredContext[]>([])
  const [injectedRecords, setInjectedRecords] = useState<Record<string, InjectedRecord>>({})
  const [selectedContextId, setSelectedContextId] = useState<string>("")
  const [isNewChat, setIsNewChat] = useState<boolean>(false)
  const [isOpenMenu, setIsOpenMenu] = useState<boolean>(false)
  const [injectStatus, setInjectStatus] = useState<"idle" | "success" | "error">("idle")
  const [statusMessage, setStatusMessage] = useState<string>("")
  const [isMinimized, setIsMinimized] = useState<boolean>(false)
  const [densityMode, setDensityModeState] = useState<InjectionDensityMode>("standard")
  const [currentUrl, setCurrentUrl] = useState<string>(
    typeof window !== "undefined" ? window.location.href : ""
  )

  const [isRuntimeInvalidated, setIsRuntimeInvalidated] = useState<boolean>(false)
  const hasAutoSyncedRef = useRef<string>("")
  const runObserverCheckRef = useRef<() => void>(() => {})

  // Ephemeral injection confirmation state (Directive 1 & 2: resets automatically, never leaks across /new)
  const [ephemeralInjected, setEphemeralInjected] = useState<{
    platform: PlatformId
    chatId: string
    contextId: string
    sourcePlatform: PlatformId
    timestamp: number
  } | null>(null)
  const ephemeralTimerRef = useRef<NodeJS.Timeout | null>(null)

  const currentObservedContainerRef = useRef<HTMLElement | null>(null)
  const currentChatIdRef = useRef<string>("")
  const lastObservedUrlRef = useRef<string>(
    typeof window !== "undefined" ? window.location.href : ""
  )
  const lastHashRef = useRef<string>("")
  const debounceRef = useRef<NodeJS.Timeout | null>(null)
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null)
  const retryCountRef = useRef<number>(0)

  useEffect(() => {
    safeSendMessage({ type: "GET_DENSITY_MODE" }, (res: any) => {
      if (res?.mode) setDensityModeState(res.mode)
    })
  }, [])

  const triggerAiSummaryIfEligible = (trigger: SummarizeTrigger) => {
    if (!adapter || isContextInvalidated()) return
    const currentChatId = adapter.getChatId(window.location.href, document)
    const turns = adapter.getMessages(document)
    if (turns.length === 0) return

    safeSendMessage(
      {
        type: "TRIGGER_AI_SUMMARY",
        payload: {
          sourcePlatform: adapter.id,
          chatId: currentChatId,
          trigger,
          turns
        }
      },
      (res: any) => {
        if (res?.success && res.mode === "ai") {
          console.debug(`[ContextBridge ${adapter.displayName}] AI summary synthesized via ${trigger}`)
          refreshContexts()
        }
      }
    )
  }

  // 1. Resolve current platform adapter on mount & URL changes (Design D)
  useEffect(() => {
    const handleUrlChange = (e?: any) => {
      if (isContextInvalidated()) {
        setIsRuntimeInvalidated(true)
        return
      }

      const href = window.location.href
      const matched = getAdapterForUrl(href)
      setAdapter(matched)
      if (matched) {
        setIsNewChat(matched.isNewOrEmptyChat(document))
      }

      const currentChatId = matched?.getChatId(href, document) || ""
      const prevChatId = currentChatIdRef.current
      const isChatChange = currentChatId !== prevChatId || href !== lastObservedUrlRef.current

      if (isChatChange) {
        // Phase 2: On any chat change, cancel debounced saves and discard all in-memory state
        if (debounceRef.current) {
          clearTimeout(debounceRef.current)
          debounceRef.current = null
        }

        if (matched) {
          console.debug(
            `[ContextBridge ${matched.displayName}] In-app SPA navigation: ${href.split("?")[0]} (chatId: ${currentChatId})`
          )
        }
        lastObservedUrlRef.current = href
        currentChatIdRef.current = currentChatId
        lastHashRef.current = "" // Discard all previous in-memory state
        hasAutoSyncedRef.current = "" // Reset history auto-sync for new chat
        retryCountRef.current = 0
        setCurrentUrl(href)

        // Reset ephemeral injection confirmation
        setEphemeralInjected(null)
        if (ephemeralTimerRef.current) clearTimeout(ephemeralTimerRef.current)
        setInjectStatus("idle")
      }
    }

    const onWindowMessage = (e: MessageEvent) => {
      if (e.data?.source === "contextbridge-main" && e.data?.type === "CONTEXTBRIDGE_NAVIGATION") {
        handleUrlChange()
      }
    }

    handleUrlChange()

    window.addEventListener("contextbridge:navigation", handleUrlChange)
    window.addEventListener("message", onWindowMessage)
    window.addEventListener("popstate", handleUrlChange)
    window.addEventListener("hashchange", handleUrlChange)

    // Design D: Poll location.href every ~500 ms
    const navInterval = setInterval(handleUrlChange, 500)

    return () => {
      window.removeEventListener("contextbridge:navigation", handleUrlChange)
      window.removeEventListener("message", onWindowMessage)
      window.removeEventListener("popstate", handleUrlChange)
      window.removeEventListener("hashchange", handleUrlChange)
      clearInterval(navInterval)
    }
  }, [])

  // 2. Fetch available stored contexts and injected chat records
  const refreshContexts = async () => {
    if (isContextInvalidated()) return
    try {
      const all = await getStoredContexts()
      setContexts(all)
      const records = await getInjectedRecords()
      setInjectedRecords(records)
    } catch (err: any) {
      if (isContextInvalidated(err)) return
    }
  }

  useEffect(() => {
    refreshContexts()
    const timer = setInterval(refreshContexts, 5000)

    // Reactive cross-tab storage change listener
    const onStorageChanged = (changes: any, areaName: string) => {
      if (areaName === "local") {
        refreshContexts()
      }
    }
    if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(onStorageChanged)
    }

    return () => {
      clearInterval(timer)
      if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(onStorageChanged)
      }
    }
  }, [])

  // 3. Continuous Auto-Save Engine with telemetry & multiple fallback reporting
  useEffect(() => {
    if (!adapter) return

    console.debug(
      `[ContextBridge ${adapter.displayName}] content script started on: ${window.location.pathname}`
    )
    console.debug(`[ContextBridge ${adapter.displayName}] adapter selected: ${adapter.id}`)

    let chatObserver: MutationObserver | null = null
    let containerWaitObserver: MutationObserver | null = null
    let scrollCleanup: (() => void) | null = null
    let isCleanedUp = false

    const runObserverCheck = () => {
      if (isCleanedUp || !adapter) return
      runObserverCheckRef.current = runObserverCheck
      const currentChatId = adapter.getChatId(window.location.href, document)
      const currentTitle = adapter.getChatTitle(document)

      // Requirement 1: Container replacement check - re-attach observer if container element changed
      const resolvedContainer = adapter.getChatContainer
        ? adapter.getChatContainer(document)
        : document.body
      if (resolvedContainer && resolvedContainer !== currentObservedContainerRef.current) {
        attachToChatContainer(resolvedContainer)
      }

      // Design B: Rebuild snapshot from current DOM on every save without accumulating cache
      const rawTurns = adapter.getMessages(document)
      const emptyCheck = adapter.isNewOrEmptyChat(document)
      setIsNewChat(emptyCheck)

      // Resolve chat ID:
      // 1. From URL if permalink is present
      // 2. From DOM platform attributes if on root / or /new
      // 3. From stable prompt-derived hash if substantive turns exist on root / or /new
      let resolvedChatId = currentChatId
      if (!resolvedChatId || isGenericOrNewChatId(resolvedChatId)) {
        const domConvEl = document.querySelector<HTMLElement>("[data-chatgpt-selection-conversation-id]")
        const domConvId = domConvEl?.getAttribute("data-chatgpt-selection-conversation-id")?.trim()
        if (domConvId && !isGenericOrNewChatId(domConvId)) {
          resolvedChatId = domConvId
        } else if (rawTurns.length > 0) {
          const firstUserTurn = rawTurns.find((t) => t.role === "user")?.text || ""
          if (firstUserTurn.trim().length > 0) {
            const promptHash = hashStringToBase36(firstUserTurn.trim())
            resolvedChatId = `active-${adapter.id}-${promptHash}`
          }
        }
      }

      // On chat ID change, reset in-memory state
      if (resolvedChatId !== currentChatIdRef.current) {
        currentChatIdRef.current = resolvedChatId
        lastHashRef.current = ""
        retryCountRef.current = 0
      }

      // The only allowed merge is for virtualised long chats: add earlier turns already stored for SAME chatKey
      let turns = rawTurns
      const currentChatKey = `${adapter.id}:${resolvedChatId}`
      if (resolvedChatId && !isGenericOrNewChatId(resolvedChatId)) {
        const storedSameChat = contexts.find((c) => c.id === currentChatKey)
        if (storedSameChat?.turns && storedSameChat.turns.length > 0) {
          turns = mergeTurnsForSameChat(storedSameChat.turns, rawTurns)
        }
      }

      // Directive 1: Reset injected state when the input box is empty and the chat has no turns
      const inputBox = adapter.getInputBox(document)
      const isInputEmpty =
        !inputBox ||
        !(inputBox.textContent || (inputBox as HTMLInputElement).value || "").trim()
      if (isInputEmpty && turns.length === 0) {
        setEphemeralInjected(null)
        if (ephemeralTimerRef.current) clearTimeout(ephemeralTimerRef.current)
        lastHashRef.current = ""
      }

      // Requirement 3: Do not save an entry until it has a real chat title or at least one real turn.
      // Ignore placeholder titles ("Claude", "ChatGPT") as goal and title.
      const hasRealTitle = currentTitle && !isGenericFillerText(currentTitle)
      if (turns.length === 0 && !hasRealTitle) {
        return
      }

      const matchedSelector = (adapter as any).lastMatchedSelector || (turns.length > 0 ? "matched" : "none")

      console.debug(
        `[ContextBridge ${adapter.displayName}] getMessages() count: ${turns.length} (cached: ${turns.length}, isNewOrEmpty: ${emptyCheck}, selector: ${matchedSelector})`
      )

      // Broadcast live telemetry for popup Debug Panel (Directive 1)
      const containerFound = Boolean(resolvedContainer && resolvedContainer !== document.body)

      const isTemporaryChat =
        window.location.pathname.includes("/temporary-chat") ||
        window.location.search.includes("temporary-chat")
      const bgResultStatus = !resolvedChatId
        ? (isTemporaryChat ? "unsupported (no id)" : "waiting for chat id")
        : undefined

      const debugTelemetry: PlatformDebugInfo = {
        platform: adapter.id,
        displayName: adapter.displayName,
        url: window.location.href,
        chatId: resolvedChatId || "no id",
        adapterSelected: `${adapter.displayName} (${adapter.id})`,
        chatContainerFound: containerFound,
        containerTag: resolvedContainer ? resolvedContainer.tagName.toLowerCase() : "none",
        messagesCount: turns.length,
        matchedSelector,
        bgResult: bgResultStatus,
        timestamp: Date.now()
      }

      safeSendMessage({
        type: "UPDATE_DEBUG_TELEMETRY",
        payload: debugTelemetry
      })

      // If no valid chat ID or no turns, do not save
      if (!resolvedChatId || isGenericOrNewChatId(resolvedChatId) || turns.length === 0) {
        return
      }

      const hash = computeHash(turns)
      if (hash === lastHashRef.current) return
      lastHashRef.current = hash

      // Collect all verbatim code blocks
      const rawCodeBlocks: VerbatimCodeBlock[] = []
      turns.forEach((turn) => {
        if (turn.codeBlocks && turn.codeBlocks.length > 0) {
          rawCodeBlocks.push(...turn.codeBlocks)
        }
      })

      // Format raw transcript
      const rawTranscript = turns
        .map((t) => `### ${t.role.toUpperCase()}:\n${t.text}`)
        .join("\n\n---\n\n")

      console.debug(
        `[ContextBridge ${adapter.displayName}] message sent to background (turns: ${turns.length}, codeBlocks: ${rawCodeBlocks.length})`
      )

      debugTelemetry.lastMessageSentToBg = `AUTO_SAVE_TRANSCRIPT (turns: ${turns.length}, codeBlocks: ${rawCodeBlocks.length})`
      debugTelemetry.lastMessageSentTime = Date.now()
      safeSendMessage({
        type: "UPDATE_DEBUG_TELEMETRY",
        payload: debugTelemetry
      })

      // Derive title fallback from first user turn if document title is generic
      const firstUserText = turns.find((t) => t.role === "user")?.text?.trim()
      const effectiveTitle = hasRealTitle ? currentTitle : (firstUserText ? firstUserText.slice(0, 50) : "Active Conversation")

      // Dispatch auto-save to background worker
      safeSendMessage(
        {
          type: "AUTO_SAVE_TRANSCRIPT",
          payload: {
            sourcePlatform: adapter.id,
            chatId: resolvedChatId,
            chatTitle: effectiveTitle,
            sourceUrl: window.location.href,
            rawTranscript,
            rawCodeBlocks,
            turns,
            retryCount: retryCountRef.current
          }
        },
        (res: any) => {
          if (res?.success) {
            retryCountRef.current = 0
            console.debug(
              `[ContextBridge ${adapter.displayName}] background received context: ${res.contextId}`
            )
            debugTelemetry.bgResult = `Saved (${res.contextId})`
            debugTelemetry.bgResultTime = Date.now()
            debugTelemetry.lastSaveTime = Date.now()
            refreshContexts()
          } else if (res?.error === "NOT_READY_YET") {
            retryCountRef.current = res.retryCount || (retryCountRef.current + 1)
            console.debug(
              `[ContextBridge ${adapter.displayName}] Background reported NOT_READY_YET (retrying quiet DOM, attempt ${retryCountRef.current}/3)`
            )
            debugTelemetry.bgResult = `Waiting (Attempt ${retryCountRef.current}/3)`
            debugTelemetry.bgResultTime = Date.now()
            lastHashRef.current = ""
            scheduleCheck(500)
          } else {
            console.debug(
              `[ContextBridge ${adapter.displayName}] background save skipped/rejected (reason: ${res?.error || "unknown"})`
            )
            debugTelemetry.bgResult = `Skipped (${res?.error || "unknown"})`
            debugTelemetry.bgResultTime = Date.now()
            retryCountRef.current = 0
          }

          safeSendMessage({
            type: "UPDATE_DEBUG_TELEMETRY",
            payload: debugTelemetry
          })
        }
      )

      // Requirement 2: Trigger 3 - Rate limit detection in page text
      if (isRateLimitEncountered(document.body.innerText || "")) {
        triggerAiSummaryIfEligible("rate_limit")
      }

      // Requirement 2: Trigger 4 - Idle >= 2 min after a completed assistant response
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current)
        idleTimerRef.current = null
      }
      const lastTurn = turns[turns.length - 1]
      if (lastTurn && lastTurn.role === "assistant" && turns.length >= 2) {
        idleTimerRef.current = setTimeout(() => {
          console.debug(
            `[ContextBridge ${adapter.displayName}] 2-minute idle timer reached after assistant response.`
          )
          triggerAiSummaryIfEligible("idle_timeout")
        }, 120000)
      }
    }

    const scheduleCheck = (delayMs: number = 600) => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null
        runObserverCheck()
      }, delayMs)
    }

    const attachToChatContainer = (containerEl: HTMLElement) => {
      if (isCleanedUp) return

      if (chatObserver) {
        chatObserver.disconnect()
        chatObserver = null
      }
      currentObservedContainerRef.current = containerEl

      const tagDesc = `${containerEl.tagName.toLowerCase()}${containerEl.id ? "#" + containerEl.id : ""}`
      console.debug(`[ContextBridge ${adapter.displayName}] observer attached to container (${tagDesc})`)

      chatObserver = new MutationObserver((mutations) => {
        let hasNewNodes = false
        let hasTextChange = false
        for (const m of mutations) {
          if (m.type === "childList" && m.addedNodes.length > 0) {
            hasNewNodes = true
            break
          }
          if (m.type === "characterData") {
            hasTextChange = true
          }
        }
        if (hasNewNodes) {
          // When a new message bubble/container is added to DOM, reset retry count and schedule prompt save
          retryCountRef.current = 0
          scheduleCheck(250)
        } else if (hasTextChange) {
          // Streaming assistant token update
          scheduleCheck(800)
        }
      })

      chatObserver.observe(containerEl, {
        childList: true,
        subtree: true,
        characterData: true
      })

      if (scrollCleanup) {
        scrollCleanup()
        scrollCleanup = null
      }
      const handleScroll = () => {
        scheduleCheck(350)
      }
      containerEl.addEventListener("scroll", handleScroll, { passive: true })
      window.addEventListener("scroll", handleScroll, { passive: true })
      scrollCleanup = () => {
        try {
          containerEl.removeEventListener("scroll", handleScroll)
          window.removeEventListener("scroll", handleScroll)
        } catch {}
      }

      console.debug(
        `[ContextBridge ${adapter.displayName}] observer attached to container (${tagDesc})`
      )

      // Run initial scrape check promptly
      scheduleCheck(300)

      // Automatic silent history capture on chat reload/mount:
      // Ensures the whole chat from the very first prompt to the last prompt is captured automatically
      const currentCid = adapter.getChatId(window.location.href, document)
      if (currentCid && !isGenericOrNewChatId(currentCid)) {
        setTimeout(() => {
          autoSyncHistory(containerEl, currentCid)
        }, 400)
      }
    }

    const autoSyncHistory = async (containerEl: HTMLElement, chatId: string) => {
      if (!containerEl || isCleanedUp || !adapter) return
      if (hasAutoSyncedRef.current === chatId) return
      hasAutoSyncedRef.current = chatId

      const hasScrollAbove =
        containerEl.scrollTop > 40 ||
        window.scrollY > 40 ||
        containerEl.scrollHeight > containerEl.clientHeight + 200

      if (!hasScrollAbove) return

      try {
        const initialScrollTop = containerEl.scrollTop
        const initialWindowY = window.scrollY

        // 1. Silently sweep to top so virtual scroller mounts the very first prompts into DOM
        containerEl.scrollTop = 0
        window.scrollTo(0, 0)
        containerEl.dispatchEvent(new Event("scroll", { bubbles: true }))
        window.dispatchEvent(new Event("scroll", { bubbles: true }))

        await new Promise((resolve) => setTimeout(resolve, 300))
        runObserverCheck()

        // 2. If long chat, step downward halfway to catch any intermediate turns
        if (initialScrollTop > 1200) {
          containerEl.scrollTop = Math.floor(initialScrollTop / 2)
          containerEl.dispatchEvent(new Event("scroll", { bubbles: true }))
          await new Promise((resolve) => setTimeout(resolve, 200))
          runObserverCheck()
        }

        // 3. Restore user's exact scroll position seamlessly
        containerEl.scrollTop = initialScrollTop
        window.scrollTo(0, initialWindowY)
        containerEl.dispatchEvent(new Event("scroll", { bubbles: true }))

        runObserverCheck()
      } catch (err) {
        console.debug("[ContextBridge] Auto history sweep finished:", err)
      }
    }

    const resolvedContainer = adapter.getChatContainer
      ? adapter.getChatContainer(document)
      : document.body

    const hasInputOrMessages = Boolean(
      adapter.getInputBox(document) ||
        document.querySelector("[data-message-author-role]") ||
        document.querySelector('[data-testid^="conversation-turn-"]') ||
        document.querySelector("article") ||
        document.querySelector("main")
    )

    if (resolvedContainer && hasInputOrMessages) {
      attachToChatContainer(resolvedContainer)
    } else {
      console.debug(
        `[ContextBridge ${adapter.displayName}] Waiting for chat container to mount in DOM...`
      )
      containerWaitObserver = new MutationObserver(() => {
        const target = adapter.getChatContainer
          ? adapter.getChatContainer(document)
          : document.body
        const ready = Boolean(
          adapter.getInputBox(document) ||
            document.querySelector("[data-message-author-role]") ||
            document.querySelector('[data-testid^="conversation-turn-"]') ||
            document.querySelector("article") ||
            document.querySelector("main")
        )

        if (target && ready) {
          containerWaitObserver?.disconnect()
          containerWaitObserver = null
          attachToChatContainer(target)
        }
      })

      containerWaitObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
      })
    }

    // Auto-save on visibility change (developer switches tabs/windows) & Trigger 2: visibility_hidden
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        runObserverCheck()
        triggerAiSummaryIfEligible("visibility_hidden")
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange)

    // Continuous polling check every 2s for SPA route updates (e.g. /new -> /c/<id> transitions)
    const periodicCheckTimer = setInterval(() => {
      if (isCleanedUp || !adapter) return
      const cid = adapter.getChatId(window.location.href, document)
      if (cid && !isGenericOrNewChatId(cid)) {
        runObserverCheck()
      }
    }, 2000)

    return () => {
      isCleanedUp = true
      clearInterval(periodicCheckTimer)
      if (chatObserver) {
        chatObserver.disconnect()
        chatObserver = null
      }
      if (containerWaitObserver) {
        containerWaitObserver.disconnect()
        containerWaitObserver = null
      }
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current)
        idleTimerRef.current = null
      }
      if (scrollCleanup) {
        scrollCleanup()
        scrollCleanup = null
      }
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [adapter, currentUrl])

  if (!adapter) {
    return null
  }

  // Filter eligible contexts using pure invariant filter logic
  const currentChatId = adapter.getChatId(currentUrl || window.location.href, document)
  const isCurrentNew = isNewChat || isGenericOrNewChatId(currentChatId)
  const eligibleContexts = filterEligibleContexts(contexts, adapter.id, currentChatId, isCurrentNew)

  // Short ephemeral confirmation pill (Requirement 1 & 2: resets automatically, never leaks across /new)
  const isShowingConfirmationPill = Boolean(ephemeralInjected)

  // Determine primary candidate to highlight
  const primaryContext =
    eligibleContexts.find((c) => c.id === selectedContextId) || eligibleContexts[0]

  const handleInject = async (targetContext: StoredContext) => {
    // Requirement 2: Trigger 1 - User clicks Inject
    triggerAiSummaryIfEligible("inject_click")

    if (!targetContext) {
      setInjectStatus("error")
      setStatusMessage("No context selected to inject.")
      setTimeout(() => setInjectStatus("idle"), 3000)
      return
    }

    const inputBox = adapter.getInputBox(document)
    if (!inputBox) {
      setInjectStatus("error")
      setStatusMessage("Prompt input box not found. Please click into input.")
      setTimeout(() => setInjectStatus("idle"), 4000)
      return
    }

    // Design G: Single formatter used by every adapter's formatFor and by the inject click
    const adjustedMemory = buildLocalStateMemory(
      targetContext.turns || [],
      targetContext.rawCodeBlocks || [],
      targetContext.chatTitle,
      densityMode
    )
    if (!adjustedMemory.objective && targetContext.stateMemory?.objective) {
      adjustedMemory.objective = targetContext.stateMemory.objective
    }
    const injectionFormat = await getInjectionFormat().catch(() => "markdown" as const)
    const promptText = adapter.formatFor(adjustedMemory, targetContext.sourcePlatform, injectionFormat)

    // Also copy to user clipboard so they can press Ctrl+V anytime for the host platform's native expandable box!
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(promptText)
      }
    } catch {
      // Ignore clipboard restrictions
    }

    // Safely insert text into input box (NEVER auto-submits)
    const success = adapter.insertText(inputBox, promptText)

    if (success) {
      setInjectStatus("success")
      setStatusMessage(`Injected context from ${targetContext.sourcePlatform.toUpperCase()}! (Copied to clipboard)`)
      setIsOpenMenu(false) // Collapse menu

      // Short confirmation pill: resets automatically after 5s (Requirement 2)
      setEphemeralInjected({
        platform: adapter.id,
        chatId: currentChatId,
        contextId: targetContext.id,
        sourcePlatform: targetContext.sourcePlatform,
        timestamp: Date.now()
      })

      if (ephemeralTimerRef.current) clearTimeout(ephemeralTimerRef.current)
      ephemeralTimerRef.current = setTimeout(() => {
        setEphemeralInjected(null)
        setInjectStatus("idle")
        setStatusMessage("")
      }, 5000)

      // Invariant 1: Injected state must never apply to or persist on new/empty chats!
      if (!isCurrentNew) {
        await markChatInjected(adapter.id, currentChatId, targetContext.id).catch(() => ({}))
        const fresh = await getInjectedRecords().catch(() => ({}))
        setInjectedRecords(fresh)
      }
    } else {
      setInjectStatus("error")
      setStatusMessage("Failed to insert text into input element.")
      setTimeout(() => setInjectStatus("idle"), 3000)
    }
  }

  if (isRuntimeInvalidated) {
    return (
      <aside className="fixed bottom-6 right-6 z-[999999] select-none font-sans">
        <div className="px-3.5 py-2.5 rounded-xl bg-amber-950/90 border border-amber-500/50 text-amber-200 text-xs font-mono shadow-2xl backdrop-blur-xl flex items-center space-x-2">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          <span>Context Bridge was updated, please refresh this tab</span>
        </div>
      </aside>
    )
  }

  if (isMinimized) {
    return (
      <div className="fixed bottom-6 right-6 z-[999999] select-none font-sans">
        <button
          onClick={() => setIsMinimized(false)}
          className="flex items-center space-x-2 px-3 py-2 rounded-full bg-[#0D1017]/95 border border-indigo-500/40 text-slate-200 shadow-2xl backdrop-blur-xl hover:border-indigo-400 hover:scale-105 transition-all">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-mono font-semibold text-indigo-400 uppercase">
            Bridge
          </span>
          {eligibleContexts.length > 0 && (
            <span className="px-1.5 py-0.2 text-[10px] bg-indigo-500/20 text-indigo-300 rounded font-mono">
              {eligibleContexts.length}
            </span>
          )}
        </button>
      </div>
    )
  }

  return (
    <aside className="fixed bottom-6 right-6 z-[999999] select-none font-sans flex flex-col items-end space-y-2">
      {/* Context Selection Dropdown Menu */}
      {isOpenMenu && (
        <div className="w-[360px] max-h-[380px] rounded-xl bg-[#0D1017]/95 border border-slate-700/80 shadow-2xl backdrop-blur-xl p-3 space-y-2.5 text-slate-200 animate-slide-up">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center space-x-1.5 text-xs font-semibold text-slate-200">
              <span className="w-2 h-2 rounded-full bg-indigo-400" />
              <span>Select Context to Inject</span>
            </div>
            <span className="text-[10px] font-mono text-slate-400">
              {eligibleContexts.length} available
            </span>
          </div>

          {/* Mode Selector Toggle with Live Token Estimate (Stage 2 Requirement 6) */}
          <div className="p-2 rounded-lg bg-[#080A10] border border-slate-800/80 space-y-1.5">
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
              <span className="font-semibold text-slate-300">Density Mode</span>
              <span className="text-indigo-400 font-semibold">
                {densityMode === "compact"
                  ? "~500 tokens"
                  : densityMode === "full"
                  ? "~3000 tokens"
                  : "~1200 tokens"}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1">
              {(["compact", "standard", "full"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDensityModeState(mode)
                    chrome.runtime
                      .sendMessage({ type: "SET_DENSITY_MODE", payload: { mode } })
                      .catch(() => ({}))
                  }}
                  className={`py-1 text-[10px] font-mono rounded capitalize transition-all cursor-pointer ${
                    densityMode === mode
                      ? "bg-indigo-600 text-white font-bold shadow-md shadow-indigo-600/30"
                      : "bg-slate-900 text-slate-400 hover:text-slate-200 hover:bg-slate-800"
                  }`}>
                  {mode}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[220px] overflow-y-auto space-y-1.5 pr-1">
            {eligibleContexts.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-4">
                No active contexts from other chats. Start or continue a conversation on Claude, ChatGPT, etc. to auto-save!
              </p>
            ) : (
              eligibleContexts.map((ctx) => {
                const isCtxInjected =
                  ephemeralInjected?.contextId === ctx.id ||
                  isInjected(injectedRecords, adapter.id, currentChatId, ctx.id)

                return (
                  <div
                    key={ctx.id}
                    onClick={() => {
                      setSelectedContextId(ctx.id)
                      handleInject(ctx)
                    }}
                    className="p-2.5 rounded-lg bg-[#080A10] border border-slate-800 hover:border-indigo-500/50 hover:bg-indigo-950/20 cursor-pointer transition-all space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-1.5">
                        <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold uppercase rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                          {ctx.sourcePlatform}
                        </span>
                        {isCtxInjected && (
                          <span className="px-1.5 py-0.5 text-[9px] font-mono font-semibold uppercase rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                            Injected
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {timeAgo(ctx.updatedAt)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 font-medium truncate">
                      {ctx.chatTitle}
                    </p>
                    <p className="text-[11px] text-slate-400 line-clamp-2">
                      {ctx.stateMemory.objective || ctx.stateMemory.currentWork || "Engineering conversation"}
                    </p>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* Main Floating UI: Short confirmation pill after inject (Requirement 2), resets automatically */}
      {isShowingConfirmationPill && ephemeralInjected ? (
        <div className="flex items-center space-x-1.5 p-1 rounded-2xl bg-[#090B10]/95 border border-emerald-500/40 shadow-xl backdrop-blur-2xl animate-fade-in">
          <button
            onClick={() => setIsMinimized(true)}
            className="p-1.5 text-slate-500 hover:text-slate-300 transition-colors rounded-xl hover:bg-slate-800/60 cursor-pointer"
            title="Minimize">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>

          <button
            onClick={() => setIsOpenMenu(!isOpenMenu)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-950/60 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-900/40 transition-all cursor-pointer"
            title="Context injected! Click to view all contexts or inject again">
            <svg className="w-3.5 h-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>Injected ({ephemeralInjected.sourcePlatform.toUpperCase()})</span>
          </button>

          <button
            onClick={() => setIsOpenMenu(!isOpenMenu)}
            className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800/60 cursor-pointer"
            title="Browse all contexts & inject again">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </div>
      ) : (
        <div className="flex items-center space-x-1.5 p-1 rounded-2xl bg-[#090B10]/95 border border-slate-700/80 shadow-2xl backdrop-blur-2xl transition-all duration-200 hover:border-indigo-500/50">
          <button
            onClick={() => setIsMinimized(true)}
            className="p-2 text-slate-500 hover:text-slate-300 transition-colors rounded-xl hover:bg-slate-800/60 cursor-pointer"
            title="Minimize">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>

          {/* Primary Action Button */}
          <button
            onClick={() => {
              if (primaryContext) {
                handleInject(primaryContext)
              } else {
                setIsOpenMenu(!isOpenMenu)
              }
            }}
            className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 shadow-md cursor-pointer ${
              injectStatus === "success"
                ? "bg-emerald-600 text-white"
                : injectStatus === "error"
                ? "bg-rose-600 text-white"
                : primaryContext && isCurrentNew
                ? "bg-gradient-to-r from-emerald-600 via-indigo-600 to-purple-600 text-white shadow-indigo-500/30 animate-pulse"
                : primaryContext
                ? "bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white shadow-indigo-500/25"
                : "bg-slate-800 text-slate-400"
            }`}>
            <svg className="w-4 h-4 text-indigo-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>

            <span>
              {injectStatus === "success"
                ? "Context Injected!"
                : injectStatus === "error"
                ? "Injection Failed"
                : primaryContext && isCurrentNew
                ? `Context from ${primaryContext.sourcePlatform.toUpperCase()} (${timeAgo(primaryContext.updatedAt)}) - Inject`
                : primaryContext
                ? `Inject from ${primaryContext.sourcePlatform.toUpperCase()}`
                : "Context Bridge Active"}
            </span>
          </button>

          {/* Dropdown Toggle for Multiple Contexts */}
          {eligibleContexts.length > 0 && (
            <button
              onClick={() => setIsOpenMenu(!isOpenMenu)}
              className={`p-2 rounded-xl transition-colors cursor-pointer ${
                isOpenMenu
                  ? "bg-indigo-600/30 text-indigo-300 border border-indigo-500/40"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
              }`}
              title="Browse all available contexts">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Floating Status Toast */}
      {statusMessage && (
        <div
          className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border shadow-lg backdrop-blur-md animate-fade-in ${
            injectStatus === "success"
              ? "bg-emerald-950/90 border-emerald-500/50 text-emerald-200"
              : "bg-rose-950/90 border-rose-500/50 text-rose-200"
          }`}>
          {statusMessage}
        </div>
      )}
    </aside>
  )
}

export default function UniversalContextBridgeOverlay() {
  const isAdapted = typeof window !== "undefined" && Boolean(getAdapterForUrl(window.location.href))

  if (!isAdapted) {
    return null
  }

  return <ActiveBridgeOverlay />
}
