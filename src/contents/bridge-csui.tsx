import type { PlasmoCSConfig, PlasmoGetStyle } from "plasmo"
import { useEffect, useRef, useState } from "react"
import { getAdapterForUrl } from "../adapters"
import type { PlatformAdapter } from "../adapters/types"
import type { InjectedRecord, InjectionDensityMode, PlatformDebugInfo, PlatformId, ProviderSettings, StoredContext, VerbatimCodeBlock } from "../types"
import {
  getInjectedRecords,
  getSettings,
  getStoredContexts,
  isContextInvalidated,
  isInjected,
  markChatInjected
} from "../utils/storage-manager"
import { buildFullSiteReport } from "../utils/dom-investigator"
import { filterEligibleContexts, findRecentSwitchSuggestion, isGenericOrNewChatId } from "../utils/context-filter"
import { generateDomSkeleton } from "../utils/dom-skeleton"
import { findMarkerPathReport } from "../utils/dom-marker-path"
import {
  formatCardSubtitle,
  isRateLimitEncountered,
  mergeTurnsForSameChat
} from "../utils/local-mode"
import {
  isGenericFillerText
} from "../utils/prompt-formatter"
import { createSecureWindowMessageHandler, type InterceptedPayloadEvent } from "../utils/security-listener"
import { parseInterceptedPayload, type InterceptedPayloadParseResult } from "../utils/network-interceptor"
import { buildInjectedPrompt } from "../utils/prompt-preview"
import { captureCompleteConversation } from "../utils/instant-capture"
import {
  registerQuickInjectHandler,
  getRegisteredQuickInjectHandler,
  executeQuickInjectDirect
} from "../utils/quick-inject"
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
function broadcastLiveTelemetry(_source: string = "auto"): PlatformDebugInfo | null {
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
    } else {
      currentChatId = ""
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

    if (msg?.type === "EXECUTE_QUICK_INJECT") {
      const handler = getRegisteredQuickInjectHandler()
      const exec = handler ? handler() : executeQuickInjectDirect()
      exec
        .then((res) => sendResponse(res))
        .catch((err) => {
          sendResponse({ success: false, error: err?.message || "Quick inject failed" })
        })
      return true
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

// Dynamic detection of host page dark theme (ChatGPT, Gemini, Claude)
function useHostTheme(): boolean {
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof document === "undefined") return true
    try {
      const html = document.documentElement
      const body = document.body
      if (html.classList.contains("dark") || body?.classList.contains("dark")) return true
      if (html.classList.contains("dark-theme") || body?.classList.contains("dark-theme")) return true
      if (html.getAttribute("data-theme") === "dark" || body?.getAttribute("data-theme") === "dark") return true
      if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) return true
    } catch {}
    return true
  })

  useEffect(() => {
    function detect() {
      try {
        const html = document.documentElement
        const body = document.body
        const dark =
          html.classList.contains("dark") ||
          Boolean(body?.classList.contains("dark")) ||
          html.classList.contains("dark-theme") ||
          Boolean(body?.classList.contains("dark-theme")) ||
          html.getAttribute("data-theme") === "dark" ||
          body?.getAttribute("data-theme") === "dark" ||
          (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches)
        setIsDark(Boolean(dark))
      } catch {}
    }

    detect()
    const obs = new MutationObserver(detect)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] })
    if (document.body) {
      obs.observe(document.body, { attributes: true, attributeFilter: ["class", "data-theme"] })
    }
    const mql = window.matchMedia("(prefers-color-scheme: dark)")
    mql.addEventListener("change", detect)

    return () => {
      obs.disconnect()
      mql.removeEventListener("change", detect)
    }
  }, [])

  return isDark
}

function ActiveBridgeOverlay() {
  const [adapter, setAdapter] = useState<PlatformAdapter | null>(() => {
    return typeof window !== "undefined" ? getAdapterForUrl(window.location.href) : null
  })
  const [contexts, setContexts] = useState<StoredContext[]>([])
  const [settings, setSettings] = useState<ProviderSettings | null>(null)
  const [injectedRecords, setInjectedRecords] = useState<Record<string, InjectedRecord>>({})
  const [selectedContextId, setSelectedContextId] = useState<string>("")
  const [isNewChat, setIsNewChat] = useState<boolean>(false)
  const [isOpenMenu, setIsOpenMenu] = useState<boolean>(false)
  const [injectStatus, setInjectStatus] = useState<"idle" | "success" | "error">("idle")
  const [statusMessage, setStatusMessage] = useState<string>("")
  const [isMinimized, setIsMinimized] = useState<boolean>(false)
  const [densityMode, setDensityModeState] = useState<InjectionDensityMode>("smart")
  const isDark = useHostTheme()
  const [currentUrl, setCurrentUrl] = useState<string>(
    typeof window !== "undefined" ? window.location.href : ""
  )

  const [isRuntimeInvalidated, setIsRuntimeInvalidated] = useState<boolean>(false)
  const hasAutoSyncedRef = useRef<string>("")
  const syncedTurnCountsRef = useRef<Record<string, number>>({})
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

  // Part B: History Import states
  const [isImporting, setIsImporting] = useState<boolean>(false)
  const [importCount, setImportCount] = useState<number>(0)
  const cancelCollectorRef = useRef<boolean>(false)
  const hasAutoImportedRef = useRef<string>("")

  // Stage 4: Rate limit & capacity detection state
  const [rateLimitInfo, setRateLimitInfo] = useState<{
    exceeded: boolean
    reason?: string
    resetTime?: string
  } | null>(null)
  const [isRateLimitDismissed, setIsRateLimitDismissed] = useState<boolean>(false)

  // Stage 4: Smart Context Handoff dismissal state
  const [dismissedSuggestionId, setDismissedSuggestionId] = useState<string>("")

  useEffect(() => {
    safeSendMessage({ type: "GET_DENSITY_MODE" }, (res: any) => {
      if (res?.mode) {
        if (res.mode === "compact" || res.mode === "standard") {
          setDensityModeState("smart")
        } else {
          setDensityModeState(res.mode)
        }
      }
    })
  }, [])

  // 1. Resolve current platform adapter on mount & URL changes (Design D)
  useEffect(() => {
    const handleUrlChange = (_e?: any) => {
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
        hasAutoImportedRef.current = "" // Reset history auto-import for new chat
        retryCountRef.current = 0
        setCurrentUrl(href)

        // Reset ephemeral injection confirmation
        setEphemeralInjected(null)
        if (ephemeralTimerRef.current) clearTimeout(ephemeralTimerRef.current)
        setInjectStatus("idle")
      }
    }

        const handleConversationIntercepted = (data: InterceptedPayloadEvent) => {
      if (isContextInvalidated()) return
      if (!data || !data.payload) return

      const href = window.location.href
      const matched = getAdapterForUrl(href)
      const currentChatId = matched?.getChatId(href, document) || ""

      const parseResult = parseInterceptedPayload(data.payload, data.platform, currentChatId)
      if (!parseResult.success || parseResult.turns.length === 0) return

      const targetChatId = parseResult.chatId || currentChatId
      if (!targetChatId || isGenericOrNewChatId(targetChatId)) return
      if (!currentChatId || isGenericOrNewChatId(currentChatId)) return
      if (targetChatId !== currentChatId) {
        console.debug(
          `[ContextBridge] Skipped background chat ${targetChatId} (active: ${currentChatId})`
        )
        return;
      }

      const allCodeBlocks = parseResult.turns.flatMap((t) => t.codeBlocks || [])
      const rawTranscript = parseResult.turns
        .map((t) => `${t.role.toUpperCase()}:\n${t.text}`)
        .join("\n\n---\n\n")

      safeSendMessage(
        {
          type: "CAPTURE_COMPLETE_CONVERSATION",
          payload: {
            sourcePlatform: parseResult.platform,
            chatId: targetChatId,
            chatTitle: parseResult.chatTitle || matched?.getChatTitle(document) || "Technical Session",
            sourceUrl: href,
            rawTranscript,
            rawCodeBlocks: allCodeBlocks,
            turns: parseResult.turns,
            completeness: "complete"
          }
        },
        () => {
          refreshContexts()
        }
      )
    }

    const secureOnWindowMessage = createSecureWindowMessageHandler(
      window,
      handleUrlChange,
      handleConversationIntercepted
    )

    const onCustomConv = (e: any) => {
      if (e?.detail) {
        handleConversationIntercepted(e.detail)
      }
    }

    handleUrlChange()

    window.addEventListener("contextbridge:navigation", handleUrlChange)
    window.addEventListener("contextbridge:conversation", onCustomConv)
    const onDataReady = () => {
      try {
        const cacheEl = document.getElementById("__cb_intercepted_cache")
        if (cacheEl && cacheEl.textContent) {
          const detail = JSON.parse(cacheEl.textContent)
          const pl = detail.payload || detail
          const plat = detail.platform || (cacheEl.getAttribute("data-platform") as any) || "chatgpt"
          handleConversationIntercepted({
            platform: plat,
            url: window.location.href,
            payload: pl,
            timestamp: Date.now()
          })
        }
      } catch {}
    }
    document.addEventListener("contextbridge:data_ready", onDataReady)
    window.addEventListener("message", secureOnWindowMessage)
    window.addEventListener("popstate", handleUrlChange)
    window.addEventListener("hashchange", handleUrlChange)

    try {
      const cacheEl = document.getElementById("__cb_intercepted_cache")
      if (cacheEl && cacheEl.textContent) {
        const detail = JSON.parse(cacheEl.textContent)
        const pl = detail.payload || detail
        const plat = detail.platform || (cacheEl.getAttribute("data-platform") as any) || "chatgpt"
        handleConversationIntercepted({
          platform: plat,
          url: window.location.href,
          payload: pl,
          timestamp: Date.now()
        })
      }
    } catch {}

    try {
      window.postMessage(
        {
          source: "contextbridge-isolated",
          type: "CONTEXTBRIDGE_REQUEST_LATEST_PAYLOAD"
        },
        "*"
      )
    } catch {}

    // Design D: Poll location.href every ~500 ms
    const navInterval = setInterval(handleUrlChange, 500)

    return () => {
      window.removeEventListener("contextbridge:navigation", handleUrlChange)
      window.removeEventListener("contextbridge:conversation", onCustomConv)
      document.removeEventListener("contextbridge:data_ready", onDataReady)
      window.removeEventListener("message", secureOnWindowMessage)
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
      const cfg = await getSettings().catch(() => null)
      if (cfg) setSettings(cfg)
    } catch (err: any) {
      if (isContextInvalidated(err)) return
    }
  }

  useEffect(() => {
    refreshContexts()
    const timer = setInterval(refreshContexts, 5000)

    // Reactive cross-tab storage change listener
    const onStorageChanged = (_changes: any, areaName: string) => {
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
        } else {
          resolvedChatId = ""
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
        try {
          const cacheEl = document.getElementById("__cb_intercepted_cache")
          if (cacheEl && cacheEl.textContent) {
            const detail = JSON.parse(cacheEl.textContent)
            const pl = detail.payload || detail
            const plat = detail.platform || adapter.id
            const parsed = parseInterceptedPayload(pl, plat, resolvedChatId)
            if (
              parsed.success &&
              parsed.turns.length > 0 &&
              (!parsed.chatId || parsed.chatId === resolvedChatId)
            ) {
              turns = mergeTurnsForSameChat(parsed.turns, turns)
            }
          }
        } catch {}

        const storedSameChat = contexts.find((c) => c.id === currentChatKey)
        if (storedSameChat?.turns && storedSameChat.turns.length > 0) {
          turns = mergeTurnsForSameChat(storedSameChat.turns, turns)
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

      // Stage 4: Continuous check for platform capacity / rate limit banners
      if (adapter.checkRateLimitExceeded) {
        try {
          const limit = adapter.checkRateLimitExceeded(document)
          if (limit.exceeded) {
            setRateLimitInfo(limit)
          } else if (rateLimitInfo?.exceeded) {
            setRateLimitInfo(null)
            setIsRateLimitDismissed(false)
          }
        } catch {
          // Non-blocking rate limit inspection
        }
      }

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
        // rate limit handled in UI banner
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
          // idle timeout
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

      console.debug(
        `[ContextBridge ${adapter.displayName}] observer attached to container (${tagDesc})`
      )

      // Run initial scrape check promptly without moving viewport
      scheduleCheck(300)
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
        // visibility check
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange)

    // Retry checks at 600ms, 1500ms, and 2500ms to handle progressive hydration on SPAs (e.g. Gemini Angular app)
    const t1 = setTimeout(() => { if (!isCleanedUp) runObserverCheck() }, 600)
    const t2 = setTimeout(() => { if (!isCleanedUp) runObserverCheck() }, 1500)
    const t3 = setTimeout(() => { if (!isCleanedUp) runObserverCheck() }, 2500)

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
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
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
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [adapter, currentUrl])

  // Filter eligible contexts using pure invariant filter logic
  const currentChatId = adapter?.getChatId(currentUrl || window.location.href, document) || ""
  const isCurrentNew = isNewChat || isGenericOrNewChatId(currentChatId)
  const eligibleContexts = adapter
    ? filterEligibleContexts(contexts, adapter.id, currentChatId, isCurrentNew)
    : []

  // Stage 4: Smart Context Handoff (< 15m from partner platform on new/empty chat)
  const rawSuggestion =
    adapter && isCurrentNew && settings?.showSwitchSuggestions !== false
      ? findRecentSwitchSuggestion(
          contexts,
          adapter.id,
          currentChatId,
          settings || ({ showSwitchSuggestions: true } as any),
          Date.now()
        )
      : null
  const activeSuggestion =
    rawSuggestion && rawSuggestion.id !== dismissedSuggestionId ? rawSuggestion : null

  // Short ephemeral confirmation pill (Requirement 1 & 2: resets automatically, never leaks across /new)
  const isShowingConfirmationPill = Boolean(ephemeralInjected)

  // Determine primary candidate to highlight
  const primaryContext =
    eligibleContexts.find((c) => c.id === selectedContextId) || eligibleContexts[0]
  const canImport = Boolean(adapter && currentChatId && !isGenericOrNewChatId(currentChatId) && !isCurrentNew)

  // Stage 4: Register quick inject handler with UI feedback
  useEffect(() => {
    registerQuickInjectHandler(async () => {
      const target = primaryContext || eligibleContexts[0]
      if (!target) {
        setStatusMessage("No eligible context from another AI to inject.")
        setInjectStatus("error")
        setTimeout(() => setInjectStatus("idle"), 3000)
        return { success: false, error: "NO_ELIGIBLE_CONTEXT" }
      }
      await handleInject(target)
      setStatusMessage(`Quick Injected from ${target.sourcePlatform.toUpperCase()}!`)
      return { success: true, contextId: target.id }
    })

    return () => {
      registerQuickInjectHandler(null)
    }
  }, [primaryContext, eligibleContexts, adapter, densityMode, settings])

  const handleImportFullChat = async () => {
    if (!adapter || isImporting || !canImport) return
    setIsImporting(true)
    setImportCount(0)
    setStatusMessage("Capturing complete conversation...")

    try {
            const existing = contexts.find((c) => c.chatId === currentChatId)
      let storedTurns = existing?.turns || []
      let storedCodeBlocks = existing?.rawCodeBlocks || []

      try {
        const cacheEl = document.getElementById("__cb_intercepted_cache")
        if (cacheEl && cacheEl.textContent) {
          const detail = JSON.parse(cacheEl.textContent)
          const pl = detail.payload || detail
          const plat = detail.platform || adapter.id
          const parsed = parseInterceptedPayload(pl, plat, currentChatId)
          if (parsed.success && parsed.turns.length > storedTurns.length && (!parsed.chatId || parsed.chatId === currentChatId)) {
            storedTurns = parsed.turns
            storedCodeBlocks = parsed.turns.flatMap((t) => t.codeBlocks || [])
          }
        }
      } catch {}

      const result = captureCompleteConversation({
        adapter,
        doc: document,
        chatId: currentChatId,
        chatTitle: adapter.getChatTitle(document),
        sourceUrl: window.location.href,
        storedTurns,
        storedCodeBlocks
      })

      if (!result.success || result.turns.length === 0) {
        setStatusMessage("No conversation messages found to capture.")
        setTimeout(() => setStatusMessage(""), 3000)
        setIsImporting(false)
        return
      }

      setImportCount(result.turns.length)

      safeSendMessage(
        {
          type: "CAPTURE_COMPLETE_CONVERSATION",
          payload: {
            sourcePlatform: adapter.id,
            chatId: currentChatId,
            chatTitle: result.chatTitle,
            sourceUrl: result.sourceUrl,
            rawTranscript: result.rawTranscript,
            rawCodeBlocks: result.codeBlocks,
            turns: result.turns,
            completeness: result.completeness,
            missingHistoryInfo: result.missingHistoryInfo,
            isImported: true
          }
        },
        (res: any) => {
          setIsImporting(false)
          if (res?.success) {
            const completenessLabel =
              result.completeness === "complete"
                ? "complete"
                : "active view"
            setStatusMessage(`Captured ${result.turns.length} messages instantly (${completenessLabel})`)
            refreshContexts()
            setTimeout(() => setStatusMessage(""), 4000)
          } else {
            setStatusMessage(`Capture failed: ${res?.error || "unknown"}`)
            setTimeout(() => setStatusMessage(""), 4000)
          }
        }
      )
    } catch (err: any) {
      setIsImporting(false)
      setStatusMessage(`Capture failed: ${err?.message || String(err)}`)
      setTimeout(() => setStatusMessage(""), 4000)
    }
  }

  // Auto-import trigger when autoImport setting is enabled (Part B)
  useEffect(() => {
    if (
      settings?.autoImport &&
      canImport &&
      currentChatId &&
      hasAutoImportedRef.current !== currentChatId &&
      !isImporting
    ) {
      hasAutoImportedRef.current = currentChatId
      const alreadyImported = contexts.some(
        (c) => c.chatId === currentChatId && (c.isImported || c.stateMemory?.metadata?.imported)
      )
      if (!alreadyImported) {
        console.debug(`[ContextBridge] Auto-importing full history for chat: ${currentChatId}`)
        handleImportFullChat()
      }
    }
  }, [canImport, currentChatId, settings?.autoImport, isImporting, contexts])

  const handleInject = async (targetContext: StoredContext) => {
    // Requirement 2: Trigger 1 - User clicks Inject
    // 100% local injection

    if (!adapter) {
      setInjectStatus("error")
      setStatusMessage("Platform adapter not ready.")
      setTimeout(() => setInjectStatus("idle"), 3000)
      return
    }

    if (!targetContext) {
      setInjectStatus("error")
      setStatusMessage("No context selected to inject.")
      setTimeout(() => setInjectStatus("idle"), 3000)
      return
    }

    // Part C: Download mode handler (exports formatted handover directly as .md file, no page injection)
    if (densityMode === "download") {
      try {
        const mdText = buildInjectedPrompt(targetContext, adapter.id, "download", "markdown", {
          customStyle: settings?.customStyle,
          customResume: settings?.customResume
        })
        const blob = new Blob([mdText], { type: "text/markdown;charset=utf-8" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        const filename = `context-bridge-${targetContext.sourcePlatform}-${targetContext.chatId || "export"}.md`
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)

        setInjectStatus("success")
        setStatusMessage(`Exported handover to ${filename}`)
        setIsOpenMenu(false)
        setTimeout(() => setInjectStatus("idle"), 3500)
        return
      } catch (err: any) {
        setInjectStatus("error")
        setStatusMessage("Failed to export markdown file.")
        setTimeout(() => setInjectStatus("idle"), 3000)
        return
      }
    }

    const inputBox = adapter.getInputBox(document)
    if (!inputBox) {
      setInjectStatus("error")
      setStatusMessage("Prompt input box not found. Please click into input.")
      setTimeout(() => setInjectStatus("idle"), 4000)
      return
    }

    // Working Rule 4 & F3: Single canonical formatter pipeline for both inject click and preview
    const promptText = buildInjectedPrompt(targetContext, adapter.id, densityMode, "markdown", {
      customStyle: settings?.customStyle,
      customResume: settings?.customResume
    })

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

    // F11: Record last insert result for diagnostics
    const charactersInserted = promptText.length
    const currentVal = (inputBox as HTMLInputElement).value || inputBox.textContent || ""
    const inputContainsText = currentVal.includes(promptText.slice(0, 30))
    const sendBtn = document.querySelector<HTMLButtonElement>(
      'button[data-testid="send-button"], button[aria-label*="Send" i], button[aria-label*="send" i], form button[type="submit"], button.send-button'
    )
    let sendButtonEnabled: "yes" | "no" | "unknown" = "unknown"
    if (sendBtn) {
      const isDisabled = sendBtn.disabled || sendBtn.getAttribute("aria-disabled") === "true"
      sendButtonEnabled = isDisabled ? "no" : "yes"
    }

    safeSendMessage({
      type: "UPDATE_LAST_INSERT_RESULT",
      payload: {
        platform: adapter.id,
        charactersInserted,
        inputContainsText,
        sendButtonEnabled,
        timestamp: Date.now()
      }
    })

    if (success) {
      setInjectStatus("success")
      setStatusMessage(`Injected context from ${targetContext.sourcePlatform.toUpperCase()}! (Copied to clipboard)`)
      setIsOpenMenu(false) // Collapse menu

      // After Inject Behavior (Section 3.D: focus, keep, minimize)
      const afterAction = settings?.afterInjectAction || "focus"
      if (afterAction === "focus") {
        inputBox.focus()
      } else if (afterAction === "minimize") {
        setIsMinimized(true)
        inputBox.focus()
      } else if (afterAction === "keep") {
        setIsMinimized(false)
      }

      // Short confirmation pill: resets automatically after 5s unless afterInjectAction is "keep"
      setEphemeralInjected({
        platform: adapter.id,
        chatId: currentChatId,
        contextId: targetContext.id,
        sourcePlatform: targetContext.sourcePlatform,
        timestamp: Date.now()
      })

      if (afterAction !== "keep") {
        if (ephemeralTimerRef.current) clearTimeout(ephemeralTimerRef.current)
        ephemeralTimerRef.current = setTimeout(() => {
          setEphemeralInjected(null)
          setInjectStatus("idle")
          setStatusMessage("")
        }, 5000)
      }

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

  if (!adapter) {
    return null
  }

  if (isRuntimeInvalidated) {
    return (
      <div className={isDark ? "dark" : ""}>
        <aside className="fixed bottom-28 right-6 z-[999999] select-none font-sans">
          <div className="px-3.5 py-2 rounded-full bg-[#18181b] border border-[#3f3f46] text-[#f4f4f5] text-xs shadow-xl backdrop-blur-md flex items-center space-x-2">
            <span>Context Bridge was updated, please refresh this tab</span>
          </div>
        </aside>
      </div>
    )
  }

  if (isMinimized) {
    return (
      <div className={isDark ? "dark" : ""}>
        <div className="fixed bottom-28 right-6 z-[999999] select-none font-sans">
          <button
            onClick={() => setIsMinimized(false)}
            className="flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-[#18181b] hover:bg-[#27272a] border border-[#3f3f46] hover:border-[#52525b] text-[#f4f4f5] shadow-xl backdrop-blur-md transition-all cursor-pointer text-xs font-medium"
            title="Open Context Bridge Import Button">
            <svg className="w-3.5 h-3.5 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            <span>Import</span>
            {eligibleContexts.length > 0 && (
              <span className="px-1.5 py-0.2 text-[10px] bg-[#27272a] text-[#d4d4d8] border border-white/10 rounded-full font-mono font-semibold">
                {eligibleContexts.length}
              </span>
            )}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={isDark ? "dark" : ""}>
      <aside className="fixed bottom-28 right-6 z-[999999] select-none font-sans flex flex-col items-end space-y-2">
        {/* Context Selection Dropdown Menu */}
        {isOpenMenu && (
          <div className="w-[360px] max-h-[460px] flex flex-col rounded-2xl bg-[#18181b] border border-[#3f3f46] shadow-2xl backdrop-blur-xl p-3.5 space-y-3 text-[#f4f4f5] overflow-hidden animate-slide-up">
            <div className="flex items-center justify-between border-b border-[#27272a] pb-2 text-xs font-bold text-white shrink-0">
              <div className="flex items-center space-x-1.5">
                <span>Choose a Chat to Import</span>
                <span className="text-[10px] font-mono text-slate-400 font-normal">
                  ({eligibleContexts.length})
                </span>
              </div>
              {eligibleContexts.length > 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirm("Clear all stored contexts?")) {
                      chrome.runtime.sendMessage({ type: "CLEAR_ALL_DATA" }, () => {
                        refreshContexts()
                      })
                    }
                  }}
                  className="text-[10px] font-semibold text-rose-400 hover:text-white hover:bg-rose-600 px-2 py-0.5 rounded bg-rose-950/40 border border-rose-800/50 transition-colors cursor-pointer">
                  Clear All
                </button>
              )}
            </div>

            {/* Mode Selector Toggle */}
            <div className="p-2 rounded-xl bg-[#27272a] border border-[#3f3f46] space-y-1.5 shrink-0">
              <div className="flex items-center justify-between text-[11px] font-sans text-slate-300">
                <span className="font-semibold">Detail Level</span>
                <span className="text-indigo-400 font-semibold text-[10px] font-mono">
                  {densityMode === "smart"
                    ? "Smart Context"
                    : densityMode === "complete"
                    ? "Full Conversation"
                    : ".md Handover"}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(["smart", "complete", "download"] as const).map((mode) => (
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
                    className={`py-1 text-[10px] font-medium rounded-lg capitalize transition-all cursor-pointer ${
                      densityMode === mode
                        ? "bg-white text-slate-900 font-bold shadow-xs"
                        : "bg-[#18181b] text-slate-300 hover:bg-[#3f3f46] border border-white/5"
                    }`}>
                    {mode === "download" ? "Export" : mode === "complete" ? "Full" : "Smart"}
                  </button>
                ))}
              </div>
            </div>

            {/* Part B: Full Thread Import Action */}
            {canImport && (
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-indigo-950/60 border border-indigo-700/50 shrink-0">
                <div className="text-[11px] text-slate-200">
                  <span className="font-semibold text-indigo-300">Save Complete Conversation</span>
                  <p className="text-[10px] text-slate-400">Collects full chat from start to finish</p>
                </div>
                <button
                  type="button"
                  onClick={handleImportFullChat}
                  disabled={isImporting}
                  className="px-3 py-1 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg shadow-xs transition-all cursor-pointer disabled:opacity-50">
                  Save
                </button>
              </div>
            )}

            <div className="flex-1 min-h-0 max-h-[220px] overflow-y-auto overflow-x-hidden space-y-2 pr-1.5 custom-scrollbar">
              {eligibleContexts.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">
                  No chats from other AI platforms found yet. Chat on Claude or ChatGPT to save automatically!
                </p>
              ) : (
                eligibleContexts.map((ctx) => {
                  const isCtxInjected =
                    ephemeralInjected?.contextId === ctx.id ||
                    isInjected(injectedRecords, adapter.id, currentChatId, ctx.id)

                  const sub = formatCardSubtitle(ctx)

                  return (
                    <div
                      key={ctx.id}
                      onClick={() => {
                        setSelectedContextId(ctx.id)
                        handleInject(ctx)
                      }}
                      className="p-3 rounded-xl bg-[#27272a] hover:bg-[#323238] border border-[#3f3f46] hover:border-indigo-500/70 cursor-pointer transition-all space-y-1.5 text-slate-200">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-1.5">
                          <span className="px-2 py-0.5 text-[9px] font-mono font-bold uppercase rounded-md bg-[#18181b] border border-white/10 text-slate-200">
                            {ctx.sourcePlatform}
                          </span>
                          {isCtxInjected && (
                            <span className="px-1.5 py-0.5 text-[9px] font-medium rounded-md bg-slate-800 text-slate-300 border border-white/5">
                              Imported
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {timeAgo(ctx.updatedAt)}
                        </span>
                      </div>
                      <p className="text-xs text-white font-semibold truncate">
                        {ctx.chatTitle}
                      </p>
                      <p className="text-[11px] text-slate-400 truncate font-sans" title={sub}>
                        {sub}
                      </p>
                    </div>
                  )
                })
              )}
            </div>
          </div>
        )}

        {/* Stage 4: Rate-Limit Handoff Banner */}
        {rateLimitInfo?.exceeded && !isRateLimitDismissed && (
          <div className="w-[360px] p-3 rounded-2xl bg-[#18181b] border border-amber-500/60 text-amber-200 text-xs shadow-2xl backdrop-blur-xl space-y-2 animate-slide-up">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-1.5 font-semibold text-amber-300">
                <svg className="w-4 h-4 text-amber-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <span>Capacity Limit Reached</span>
              </div>
              <button
                type="button"
                onClick={() => setIsRateLimitDismissed(true)}
                className="text-amber-400 hover:text-amber-100 p-0.5 cursor-pointer transition-colors"
                title="Dismiss">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p className="text-[11px] text-amber-200/90 leading-tight">
              {rateLimitInfo.reason || "Platform usage limit reached."}
              {rateLimitInfo.resetTime ? ` Resets at ${rateLimitInfo.resetTime}.` : ""}
            </p>
            <div className="flex items-center justify-between pt-1 border-t border-[#27272a]">
              <span className="text-[10px] text-amber-300/80 font-mono">Handoff context to:</span>
              <div className="flex items-center space-x-1.5">
                {adapter.id !== "claude" && (
                  <a
                    href="https://claude.ai/new"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2 py-0.5 text-[10px] font-semibold bg-[#27272a] hover:bg-[#3f3f46] border border-white/10 text-amber-100 rounded-md transition-colors">
                    Claude
                  </a>
                )}
                {adapter.id !== "chatgpt" && (
                  <a
                    href="https://chatgpt.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2 py-0.5 text-[10px] font-semibold bg-[#27272a] hover:bg-[#3f3f46] border border-white/10 text-amber-100 rounded-md transition-colors">
                    ChatGPT
                  </a>
                )}
                {adapter.id !== "gemini" && (
                  <a
                    href="https://gemini.google.com/app"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2 py-0.5 text-[10px] font-semibold bg-[#27272a] hover:bg-[#3f3f46] border border-white/10 text-amber-100 rounded-md transition-colors">
                    Gemini
                  </a>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Stage 4: Smart Context Handoff Notice */}
        {activeSuggestion && (
          <div className="flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-[#18181b] border border-[#3f3f46] text-white text-xs shadow-xl backdrop-blur-md animate-slide-up">
            <span className="text-slate-300">
              Resume session from <strong className="text-indigo-400 capitalize">{activeSuggestion.sourcePlatform}</strong>?
            </span>
            <button
              type="button"
              onClick={() => handleInject(activeSuggestion)}
              className="px-2.5 py-1 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-full cursor-pointer transition-all shadow-xs">
              Resume
            </button>
            <button
              type="button"
              onClick={() => setDismissedSuggestionId(activeSuggestion.id)}
              className="text-slate-400 hover:text-white p-0.5 cursor-pointer transition-colors"
              title="Dismiss">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Main Floating UI: Native, compact, non-intrusive */}
        {isShowingConfirmationPill && ephemeralInjected ? (
          <div className="flex items-center space-x-1 p-1 rounded-full bg-[#18181b] border border-[#3f3f46] shadow-xl backdrop-blur-md animate-fade-in text-[#f4f4f5]">
            <button
              onClick={() => setIsMinimized(true)}
              className="p-1.5 text-slate-400 hover:text-white rounded-full hover:bg-white/10 transition-colors cursor-pointer"
              title="Minimize">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>

            <button
              onClick={() => setIsOpenMenu(!isOpenMenu)}
              className="flex items-center space-x-2 px-3.5 py-1.5 rounded-full text-xs font-semibold bg-[#27272a] hover:bg-[#323238] text-white transition-all cursor-pointer"
              title="Context injected! Click to view all chats">
              <svg className="w-3.5 h-3.5 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>Imported ({ephemeralInjected.sourcePlatform.toUpperCase()})</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center space-x-1 p-1 rounded-full bg-[#18181b] border border-[#3f3f46] shadow-xl backdrop-blur-md text-[#f4f4f5] transition-all">
            <button
              onClick={() => setIsMinimized(true)}
              className="p-1.5 text-slate-400 hover:text-white rounded-full hover:bg-white/10 cursor-pointer transition-colors"
              title="Minimize">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>

            {/* Primary Action Button - Native Dark Pill */}
            <button
              onClick={() => {
                if (primaryContext) {
                  handleInject(primaryContext)
                } else {
                  setIsOpenMenu(!isOpenMenu)
                }
              }}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                injectStatus === "success"
                  ? "bg-slate-700 text-white"
                  : injectStatus === "error"
                  ? "bg-rose-600 text-white"
                  : primaryContext
                  ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-xs"
                  : "bg-[#27272a] hover:bg-[#3f3f46] text-[#e4e4e7]"
              }`}>
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>

              <span>
                {injectStatus === "success"
                  ? "Context Imported!"
                  : injectStatus === "error"
                  ? "Import Failed"
                  : primaryContext
                  ? `Import from ${
                      primaryContext.sourcePlatform === "claude"
                        ? "Claude"
                        : primaryContext.sourcePlatform === "chatgpt"
                        ? "ChatGPT"
                        : "Gemini"
                    }`
                  : "Import Chat"}
              </span>
            </button>

            {/* Dropdown Toggle for Multiple Contexts */}
            {eligibleContexts.length > 0 && (
              <button
                onClick={() => setIsOpenMenu(!isOpenMenu)}
                className={`p-1.5 rounded-full transition-colors cursor-pointer text-slate-400 hover:text-white hover:bg-white/10 ${
                  isOpenMenu ? "bg-white/10 text-white" : ""
                }`}
                title="View all available chats to import">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            )}
          </div>
        )}
      </aside>
    </div>
  )
}

export default function UniversalContextBridgeOverlay() {
  const isAdapted = typeof window !== "undefined" && Boolean(getAdapterForUrl(window.location.href))

  if (!isAdapted) {
    return null
  }

  return <ActiveBridgeOverlay />
}
