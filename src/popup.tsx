import { useEffect, useRef, useState } from "react"
import { getAllAdapters } from "./adapters"
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_OPENAI_MODEL,
  type AdapterHealthResult,
  type InjectedRecord,
  type LastErrorInfo,
  type PlatformDebugInfo,
  type PlatformId,
  type ProviderSettings,
  type StoredContext,
  type TokenUsageTelemetry,
  type SaveDecisionRecord
} from "./types"
import { extractDomSkeletonDirectlyInTab } from "./utils/dom-skeleton"
import { findMarkerPathDirectlyInTab } from "./utils/dom-marker-path"
import {
  clearAllData,
  clearLastError,
  deleteApiKeys,
  deleteContext,
  getAllDebugInfo,
  getInjectedRecords,
  getLastError,
  getSaveTimeline,
  getSettings,
  getStoredContexts,
  getTokenTelemetry,
  saveSettings,
  togglePinContext
} from "./utils/storage-manager"
import { diagnoseContexts, isGenericOrNewChatId } from "./utils/context-filter"
import { computeContextMetrics, countExchanges } from "./utils/local-mode"
import { buildPreviewInjectedText } from "./utils/prompt-preview"
import "./style.css"

function formatAge(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp)
  const mins = Math.floor(elapsed / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function getDisplayExchangeCount(ctx: StoredContext): number {
  if (ctx.turns && ctx.turns.length > 0) {
    return computeContextMetrics(ctx.turns, ctx.rawCodeBlocks || [], ctx.chatTitle).exchangeCount
  }
  return ctx.exchangeCount ?? 0
}

export default function IndexPopup() {
  const [activeTab, setActiveTab] = useState<"contexts" | "settings" | "diagnostics" | "health">("contexts")
  const [settings, setSettings] = useState<ProviderSettings | null>(null)
  const [contexts, setContexts] = useState<StoredContext[]>([])
  const [healthReports, setHealthReports] = useState<AdapterHealthResult[]>([])
  const [selectedContext, setSelectedContext] = useState<StoredContext | null>(null)
  const [dailyCapTokens, setDailyCapTokens] = useState<number>(50000)
  const [tokenTelemetry, setTokenTelemetry] = useState<TokenUsageTelemetry>({
    tokensToday: 0,
    lastCallTokens: 0,
    lastCallTimestamp: 0,
    dailyCapTokens: 50000,
    dateString: ""
  })
  const [saveTimeline, setSaveTimeline] = useState<SaveDecisionRecord[]>([])

  // Context Storage & Filtering Diagnostics state (Requirement 6)
  const [activeTabInfo, setActiveTabInfo] = useState<{
    platform: PlatformId | "unknown"
    chatId: string
    isNewChat: boolean
  }>({ platform: "unknown", chatId: "new", isNewChat: true })
  const [injectedRecords, setInjectedRecords] = useState<Record<string, InjectedRecord>>({})

  const contextDiagnostics = diagnoseContexts(
    contexts,
    activeTabInfo.platform,
    activeTabInfo.chatId,
    activeTabInfo.isNewChat,
    injectedRecords
  )

  // Live Debug Diagnostics state (Directive 1)
  const [debugTelemetry, setDebugTelemetry] = useState<Record<string, PlatformDebugInfo>>({})
  const [selectedDebugPlatform, setSelectedDebugPlatform] = useState<PlatformId>("chatgpt")
  const [isScrapingNow, setIsScrapingNow] = useState<boolean>(false)
  const [scrapeResult, setScrapeResult] = useState<string>("")
  const [isCopyingSkeleton, setIsCopyingSkeleton] = useState<boolean>(false)
  const [skeletonStatus, setSkeletonStatus] = useState<string>("")
  const [skeletonText, setSkeletonText] = useState<string>("")
  const [isCopiedManual, setIsCopiedManual] = useState<boolean>(false)
  const skeletonTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  // Find Marker Path tool state
  const [markerWord, setMarkerWord] = useState<string>("zzmarker1")
  const [isFindingMarker, setIsFindingMarker] = useState<boolean>(false)
  const [markerReport, setMarkerReport] = useState<string>("")
  const [markerStatus, setMarkerStatus] = useState<string>("")
  const [isCopiedMarkerReport, setIsCopiedMarkerReport] = useState<boolean>(false)
  const markerTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  // Preview Injected Text state (Requirement A3)
  const [previewContextId, setPreviewContextId] = useState<string | null>(null)
  const [previewText, setPreviewText] = useState<string>("")
  const [previewTargetPlatform, setPreviewTargetPlatform] = useState<PlatformId>("chatgpt")
  const [copiedPreview, setCopiedPreview] = useState<boolean>(false)

  // Settings form state
  const [provider, setProvider] = useState<"gemini" | "openai">("gemini")
  const [geminiApiKey, setGeminiApiKey] = useState<string>("")
  const [geminiModel, setGeminiModel] = useState<string>(DEFAULT_GEMINI_MODEL)
  const [openaiApiKey, setOpenApiKey] = useState<string>("")
  const [openaiModel, setOpenApiModel] = useState<string>(DEFAULT_OPENAI_MODEL)
  const [autoExpiryHours, setAutoExpiryHours] = useState<number>(24)
  const [maxOutputTokens, setMaxOutputTokens] = useState<number>(500)

  const [showGeminiKey, setShowGeminiKey] = useState<boolean>(false)
  const [showOpenAIKey, setShowOpenAIKey] = useState<boolean>(false)
  const [statusMessage, setStatusMessage] = useState<{
    type: "idle" | "success" | "error"
    text: string
  }>({ type: "idle", text: "" })

  // Error surfacing & Live test connection state
  const [lastError, setLastError] = useState<LastErrorInfo | null>(null)
  const [isTesting, setIsTesting] = useState<boolean>(false)
  const [testResult, setTestResult] = useState<{
    type: "success" | "error"
    message: string
  } | null>(null)

  const loadData = async () => {
    try {
      const cfg = await getSettings()
      setSettings(cfg)
      setProvider(cfg.provider)
      setGeminiApiKey(cfg.geminiApiKey || "")
      setGeminiModel(cfg.geminiModel || DEFAULT_GEMINI_MODEL)
      setOpenApiKey(cfg.openaiApiKey || "")
      setOpenApiModel(cfg.openaiModel || DEFAULT_OPENAI_MODEL)
      setAutoExpiryHours(cfg.autoExpiryHours || 24)
      setMaxOutputTokens(cfg.maxOutputTokens || 500)
      setDailyCapTokens(cfg.dailyCapTokens || 50000)

      const telem = await getTokenTelemetry().catch(() => null)
      if (telem) setTokenTelemetry(telem)

      const ctxList = await getStoredContexts()
      setContexts(ctxList)

      const err = await getLastError()
      setLastError(err)

      const telemetry = await getAllDebugInfo()
      setDebugTelemetry(telemetry)

      const injectedRecs = await getInjectedRecords().catch(() => ({}))
      setInjectedRecords(injectedRecs)

      const timeline = await getSaveTimeline().catch(() => [])
      setSaveTimeline(timeline)

      // Query active tab to run live healthCheck on current adapter and auto-refresh telemetry (Directive 6)
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0]
        if (activeTab?.url) {
          const matched = getAllAdapters().find((ad) => ad.matches(activeTab.url!))
          if (matched) {
            setSelectedDebugPlatform(matched.id)
            const cId = matched.getChatId(activeTab.url!, document)
            setActiveTabInfo({
              platform: matched.id,
              chatId: cId,
              isNewChat: isGenericOrNewChatId(cId)
            })

            // Auto-ping active tab content script on load to refresh turns count
            if (activeTab.id) {
              chrome.tabs.sendMessage(activeTab.id, { type: "REQUEST_LIVE_DOM_SCRAPE" }, async (res) => {
                if (!chrome.runtime.lastError && res?.success) {
                  getAllDebugInfo().then(setDebugTelemetry)
                } else if (activeTab.id) {
                  // Direct tab inspection fallback (Directive 3 & 6)
                  try {
                    const checkResults = await chrome.scripting.executeScript({
                      target: { tabId: activeTab.id },
                      func: () => {
                        const mainEl = document.querySelector("main") || document.body
                        const turnEls =
                          document.querySelectorAll("[data-message-author-role]").length ||
                          document.querySelectorAll('[data-testid^="conversation-turn-"]').length ||
                          document.querySelectorAll("article").length
                        return {
                          hasContainer: Boolean(mainEl && mainEl !== document.body),
                          containerTag: mainEl ? mainEl.tagName.toLowerCase() : "none",
                          count: turnEls
                        }
                      }
                    })
                    const r = checkResults?.[0]?.result
                    if (r) {
                      setDebugTelemetry((prev) => ({
                        ...prev,
                        [matched.id]: {
                          platform: matched.id,
                          displayName: matched.displayName,
                          url: activeTab.url!,
                          chatId: activeTab.url!.split("/").pop() || "active",
                          adapterSelected: `${matched.displayName} (${matched.id})`,
                          chatContainerFound: r.hasContainer,
                          containerTag: r.containerTag,
                          messagesCount: r.count,
                          matchedSelector: r.count > 0 ? "live fallback" : "none",
                          timestamp: Date.now()
                        }
                      }))
                    }
                  } catch {
                    // Ignored
                  }
                }
              })
            }
          }

          const reports = getAllAdapters().map((ad) => {
            const isMatch = ad.matches(activeTab.url!)
            return {
              platform: ad.id,
              ok: isMatch,
              inputBoxFound: isMatch,
              messagesFound: isMatch,
              lastChecked: Date.now(),
              issues: isMatch ? [] : ["Not active on current tab"]
            }
          })
          setHealthReports(reports)
        }
      })
    } catch {
      // Ignored
    }
  }

  useEffect(() => {
    loadData()

    // Reactive cross-tab storage change listener so new saved contexts update in real time
    const onStorageChanged = (changes: any, areaName: string) => {
      if (areaName === "local") {
        loadData()
      }
    }
    if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(onStorageChanged)
    }

    // Also poll every 2.5s while popup is open so context counts reflect background activity
    const pollInterval = setInterval(() => {
      loadData()
    }, 2500)

    return () => {
      clearInterval(pollInterval)
      if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(onStorageChanged)
      }
    }
  }, [])

  // Auto-refresh telemetry and save timeline when viewing Diagnostics tab
  useEffect(() => {
    if (activeTab === "diagnostics") {
      const timer = setInterval(async () => {
        const telemetry = await getAllDebugInfo()
        setDebugTelemetry(telemetry)
        const timeline = await getSaveTimeline().catch(() => [])
        setSaveTimeline(timeline)
      }, 2000)
      return () => clearInterval(timer)
    }
    return undefined
  }, [activeTab])

  const handleTriggerLiveScrape = () => {
    setIsScrapingNow(true)
    setScrapeResult("")
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      if (!tab?.id) {
        setIsScrapingNow(false)
        setScrapeResult("No active tab found in current window.")
        return
      }

      chrome.tabs.sendMessage(tab.id, { type: "REQUEST_LIVE_DOM_SCRAPE" }, async (res) => {
        setIsScrapingNow(false)
        if (chrome.runtime.lastError || !res?.success) {
          // Fallback via chrome.scripting.executeScript
          try {
            const checkResults = await chrome.scripting.executeScript({
              target: { tabId: tab.id! },
              func: () => {
                const mainEl = document.querySelector("main") || document.body
                const authorRoleCount = document.querySelectorAll("[data-message-author-role]").length
                const turnTestIdCount = document.querySelectorAll('[data-testid^="conversation-turn-"]').length
                const articleCount = document.querySelectorAll("article").length
                return {
                  hasContainer: Boolean(mainEl && mainEl !== document.body),
                  containerTag: mainEl ? mainEl.tagName.toLowerCase() : "none",
                  authorRoleCount,
                  turnTestIdCount,
                  articleCount,
                  total: authorRoleCount || turnTestIdCount || articleCount
                }
              }
            })
            const direct = checkResults?.[0]?.result
            if (direct) {
              setScrapeResult(
                `Direct tab scrape executed! Found ${direct.total} turns ([data-message-author-role]: ${direct.authorRoleCount}, [data-testid*="turn"]: ${direct.turnTestIdCount}, article: ${direct.articleCount}). Container <${direct.containerTag}> found: ${direct.hasContainer ? "YES" : "NO"}.`
              )
              return
            }
          } catch (scriptErr: any) {
            console.error("Direct scrape failed:", scriptErr)
          }

          setScrapeResult(
            `Content script not reachable on current tab (${chrome.runtime.lastError?.message}). Please ensure you are on a supported platform page and have reloaded the tab.`
          )
          return
        }
        if (res?.success) {
          setScrapeResult(
            `Live scrape executed! Found ${res.turnsCount} turns on ${res.platform.toUpperCase()} using strategy '${res.matchedSelector}'. Container found: ${res.containerFound ? "YES" : "NO"}.`
          )
          loadData()
        } else {
          setScrapeResult("Live scrape returned no response.")
        }
      })
    })
  }

  const handleCopyDomSkeleton = () => {
    setIsCopyingSkeleton(true)
    setSkeletonStatus("")
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      if (!tab?.id) {
        setIsCopyingSkeleton(false)
        setSkeletonStatus("No active tab found.")
        return
      }

      chrome.tabs.sendMessage(tab.id, { type: "REQUEST_DOM_SKELETON" }, async (res) => {
        setIsCopyingSkeleton(false)
        if (chrome.runtime.lastError || !res?.success || !res.skeleton) {
          // Fall back to chrome.scripting.executeScript directly in active tab (Directive 3)
          try {
            const results = await chrome.scripting.executeScript({
              target: { tabId: tab.id! },
              func: extractDomSkeletonDirectlyInTab
            })
            const directRes = results?.[0]?.result
            if (directRes?.skeleton) {
              setSkeletonText(directRes.skeleton)
              try {
                await navigator.clipboard.writeText(directRes.skeleton)
              } catch {
                // Clipboard fallback
                const textarea = document.createElement("textarea")
                textarea.value = directRes.skeleton
                textarea.style.position = "fixed"
                textarea.style.opacity = "0"
                document.body.appendChild(textarea)
                textarea.focus()
                textarea.select()
                document.execCommand("copy")
                document.body.removeChild(textarea)
              }
              setSkeletonStatus(
                `Extracted via direct injection! <${directRes.tag || "main"}> (${directRes.elementCount} elements). Copied to clipboard.`
              )
              return
            }
          } catch (scriptErr: any) {
            console.error("Direct script execution fallback failed:", scriptErr)
          }

          setSkeletonStatus(
            `Active tab unreachable (${chrome.runtime.lastError?.message || "Content script returned no data"}). Please refresh the target tab.`
          )
          return
        }

        if (res?.success && res.skeleton) {
          setSkeletonText(res.skeleton)
          try {
            await navigator.clipboard.writeText(res.skeleton)
          } catch {
            const textarea = document.createElement("textarea")
            textarea.value = res.skeleton
            textarea.style.position = "fixed"
            textarea.style.opacity = "0"
            document.body.appendChild(textarea)
            textarea.focus()
            textarea.select()
            document.execCommand("copy")
            document.body.removeChild(textarea)
          }
          setSkeletonStatus(`Copied! DOM Skeleton of <${res.tag || "main"}> copied to clipboard.`)
          setTimeout(() => setSkeletonStatus(""), 4000)
        } else {
          setSkeletonStatus("Failed to extract DOM skeleton from active tab.")
        }
      })
    })
  }

  const handleFindMarkerPath = () => {
    setIsFindingMarker(true)
    setMarkerStatus("")
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      if (!tab?.id) {
        setIsFindingMarker(false)
        setMarkerStatus("No active tab found in current window.")
        return
      }

      const activeMarker = (markerWord || "zzmarker1").trim()

      chrome.tabs.sendMessage(
        tab.id,
        { type: "FIND_MARKER_PATH", payload: { marker: activeMarker } },
        async (res) => {
          setIsFindingMarker(false)
          if (chrome.runtime.lastError || !res?.success || !res.report) {
            // Direct tab execution fallback via chrome.scripting.executeScript
            try {
              const results = await chrome.scripting.executeScript({
                target: { tabId: tab.id! },
                func: findMarkerPathDirectlyInTab,
                args: [activeMarker]
              })
              const directReport = results?.[0]?.result
              if (directReport) {
                setMarkerReport(directReport)
                setMarkerStatus("Marker path generated via direct tab injection!")
                return
              }
            } catch (scriptErr: any) {
              console.error("Direct marker search fallback failed:", scriptErr)
            }

            setMarkerStatus(
              `Marker search failed: ${chrome.runtime.lastError?.message || "Content script returned no data"}`
            )
            return
          }

          setMarkerReport(res.report)
          setMarkerStatus("Marker path investigation complete!")
        }
      )
    })
  }

  const handleSaveSettings = async () => {
    try {
      await saveSettings({
        provider,
        geminiApiKey,
        geminiModel,
        openaiApiKey,
        openaiModel,
        autoExpiryHours,
        maxOutputTokens,
        dailyCapTokens: Number(dailyCapTokens) || 50000
      })
      setStatusMessage({ type: "success", text: "Settings securely saved!" })
      setTimeout(() => setStatusMessage({ type: "idle", text: "" }), 3000)
    } catch (err: any) {
      setStatusMessage({ type: "error", text: err?.message || "Failed to save settings." })
    }
  }

  const handleDeleteKeys = async () => {
    await deleteApiKeys()
    setGeminiApiKey("")
    setOpenApiKey("")
    setStatusMessage({ type: "success", text: "API keys removed from local storage." })
    setTimeout(() => setStatusMessage({ type: "idle", text: "" }), 3000)
  }

  const handleClearAllData = async () => {
    if (confirm("Are you sure you want to delete all saved contexts?")) {
      await clearAllData()
      setContexts([])
      setSelectedContext(null)
      setStatusMessage({ type: "success", text: "All stored context memory wiped." })
      setTimeout(() => setStatusMessage({ type: "idle", text: "" }), 3000)
    }
  }

  const handleDeleteContext = async (id: string) => {
    await deleteContext(id)
    setContexts(contexts.filter((c) => c.id !== id))
    if (selectedContext?.id === id) {
      setSelectedContext(null)
    }
  }

  const handleTogglePin = async (id: string) => {
    try {
      const updatedIsPinned = await togglePinContext(id)
      setContexts((prev) =>
        prev.map((c) => (c.id === id ? { ...c, isPinned: updatedIsPinned } : c))
      )
    } catch (e) {
      console.error("Failed to toggle pin:", e)
    }
  }

  const handleOpenPreview = (ctx: StoredContext) => {
    if (previewContextId === ctx.id) {
      setPreviewContextId(null)
      return
    }
    const targetPlatform: PlatformId =
      activeTabInfo.platform !== "unknown"
        ? activeTabInfo.platform
        : ctx.sourcePlatform === "claude"
        ? "chatgpt"
        : "claude"
    setPreviewTargetPlatform(targetPlatform)
    const text = buildPreviewInjectedText(ctx, targetPlatform, "compact")
    setPreviewText(text)
    setPreviewContextId(ctx.id)
  }

  const handleDismissError = async () => {
    await clearLastError()
    setLastError(null)
  }

  const handleTestConnection = async () => {
    setIsTesting(true)
    setTestResult(null)
    const activeKey = provider === "gemini" ? geminiApiKey : openaiApiKey
    const activeModel =
      (provider === "gemini" ? geminiModel : openaiModel)?.trim() ||
      (provider === "gemini" ? DEFAULT_GEMINI_MODEL : DEFAULT_OPENAI_MODEL)

    if (!activeKey || !activeKey.trim()) {
      setTestResult({
        type: "error",
        message: `Please enter your ${provider === "gemini" ? "Google Gemini" : "OpenAI"} API key first.`
      })
      setIsTesting(false)
      return
    }

    try {
      const res: any = await chrome.runtime.sendMessage({
        type: "TEST_LLM_CONFIG",
        payload: {
          provider,
          apiKey: activeKey,
          model: activeModel
        }
      })

      if (res?.success) {
        setTestResult({
          type: "success",
          message: res.message || `✓ Success! Responded in ${res.latencyMs || 0}ms.`
        })
        setLastError(null)
      } else {
        const errText = res?.error || "Unknown connection failure."
        setTestResult({
          type: "error",
          message: errText
        })
        setLastError({
          message: errText,
          timestamp: Date.now(),
          provider,
          model: activeModel
        })
      }
    } catch (err: any) {
      const errText = err?.message || "Failed to reach background service worker."
      setTestResult({
        type: "error",
        message: errText
      })
    } finally {
      setIsTesting(false)
    }
  }


  const timeAgo = (timestamp: number): string => {
    const elapsed = Math.max(0, Date.now() - timestamp)
    const mins = Math.floor(elapsed / 60000)
    if (mins < 1) return "just now"
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
  }

  const hasConfiguredKey = Boolean(
    (provider === "gemini" && geminiApiKey) || (provider === "openai" && openaiApiKey)
  )

  return (
    <div className="w-[430px] min-h-[580px] bg-[#090B10] text-slate-100 flex flex-col font-sans select-none antialiased border border-slate-800 shadow-2xl">
      {/* Top Ambient Glow */}
      <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400" />

      {/* Header Bar */}
      <header className="px-5 py-3.5 border-b border-slate-800/80 bg-[#0D1017] flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <div className="w-7 h-7 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </div>
          <div>
            <div className="flex items-center space-x-1.5">
              <span className="font-bold tracking-wider text-xs uppercase text-slate-100">
                Context Bridge
              </span>
              <span className="px-1.5 py-0.2 text-[10px] font-mono bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded">
                v2.0
              </span>
            </div>
            <p className="text-[10px] text-slate-400">Universal Bidirectional Sync</p>
          </div>
        </div>

        {/* Global Key Status */}
        <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-[10px] font-mono">
          <span
            className={`w-2 h-2 rounded-full ${
              hasConfiguredKey ? "bg-emerald-400 shadow-sm shadow-emerald-400/50" : "bg-amber-400"
            }`}
          />
          <span className="uppercase text-slate-300">
            {hasConfiguredKey ? `${provider}` : "NO KEY"}
          </span>
        </div>
      </header>

      {/* Tab Bar */}
      <nav className="flex px-4 pt-2 border-b border-slate-800 bg-[#090B10]">
        <button
          onClick={() => setActiveTab("contexts")}
          className={`flex items-center space-x-1.5 py-2 px-3 text-xs font-medium border-b-2 transition-all ${
            activeTab === "contexts"
              ? "border-indigo-500 text-indigo-400 bg-indigo-500/5"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}>
          <span>Contexts ({contexts.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("settings")}
          className={`flex items-center space-x-1.5 py-2 px-3 text-xs font-medium border-b-2 transition-all ${
            activeTab === "settings"
              ? "border-indigo-500 text-indigo-400 bg-indigo-500/5"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}>
          <span>Settings & BYOK</span>
        </button>

        <button
          onClick={() => setActiveTab("diagnostics")}
          className={`flex items-center space-x-1.5 py-2 px-3 text-xs font-medium border-b-2 transition-all ${
            activeTab === "diagnostics"
              ? "border-indigo-500 text-indigo-400 bg-indigo-500/5 font-semibold"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}>
          <span>Diagnostics</span>
        </button>

        <button
          onClick={() => setActiveTab("health")}
          className={`flex items-center space-x-1.5 py-2 px-3 text-xs font-medium border-b-2 transition-all ${
            activeTab === "health"
              ? "border-indigo-500 text-indigo-400 bg-indigo-500/5"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}>
          <span>Platform Health</span>
        </button>
      </nav>

      {/* Body Area */}
      <main className="flex-1 p-4 overflow-y-auto space-y-3.5">
        {/* Surface Active API Error */}
        {lastError && (
          <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/50 text-rose-200 text-xs space-y-2 shadow-lg shadow-rose-950/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-1.5">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                <span className="font-bold text-rose-300 font-mono text-[11px] uppercase">
                  API Error ({lastError.provider} - {lastError.model})
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-[10px] text-rose-400 font-mono">
                  {timeAgo(lastError.timestamp)}
                </span>
                <button
                  type="button"
                  onClick={handleDismissError}
                  className="text-rose-400 hover:text-rose-100 p-0.5 text-xs"
                  title="Dismiss error">
                  ✕
                </button>
              </div>
            </div>
            <p className="text-[11px] leading-relaxed break-words font-mono bg-black/50 p-2 rounded border border-rose-900/60 text-rose-200">
              {lastError.message}
            </p>
            {activeTab !== "settings" && (
              <button
                type="button"
                onClick={() => setActiveTab("settings")}
                className="text-[11px] text-indigo-400 hover:underline flex items-center space-x-1 pt-0.5">
                <span>Configure model & key in Settings &rarr;</span>
              </button>
            )}
          </div>
        )}

        {/* ================= TAB 1: SAVED CONTEXTS ================= */}
        {activeTab === "contexts" && (
          <div className="space-y-3">
            {/* Token Efficiency Telemetry Card (Stage 2 Requirement 6) */}
            <div className="p-3.5 rounded-xl bg-[#0D1017] border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                <div className="flex items-center space-x-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-xs font-semibold text-slate-200">Token Efficiency</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 uppercase font-semibold">
                  {settings?.geminiApiKey || settings?.openaiApiKey ? "AI Mode" : "Local Mode"}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center text-slate-300 font-mono text-[10px]">
                <div className="bg-[#07090E] p-2 rounded-lg border border-slate-800/80">
                  <span className="text-slate-500 block text-[9px] uppercase tracking-wider">API Tokens Today</span>
                  <span className="font-bold text-emerald-400 text-xs">
                    {settings?.geminiApiKey || settings?.openaiApiKey ? tokenTelemetry.tokensToday.toLocaleString() : "0"}
                  </span>
                </div>
                <div className="bg-[#07090E] p-2 rounded-lg border border-slate-800/80">
                  <span className="text-slate-500 block text-[9px] uppercase tracking-wider">Last API Call</span>
                  <span className="font-bold text-indigo-300 text-xs">
                    {(settings?.geminiApiKey || settings?.openaiApiKey) && tokenTelemetry.lastCallTokens
                      ? `${tokenTelemetry.lastCallTokens} t`
                      : "0 (Local)"}
                  </span>
                </div>
                <div className="bg-[#07090E] p-2 rounded-lg border border-slate-800/80">
                  <span className="text-slate-500 block text-[9px] uppercase tracking-wider">Daily API Cap</span>
                  <span className="font-bold text-slate-200 text-xs">
                    {(settings?.dailyCapTokens || 50000).toLocaleString()}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5 font-mono">
                <span className="truncate max-w-[240px]">
                  Active: <strong className="text-slate-200 font-semibold">{settings?.geminiApiKey || settings?.openaiApiKey ? `${settings?.provider.toUpperCase()} (${settings?.provider === "gemini" ? settings?.geminiModel : settings?.openaiModel})` : "Local Mode (Offline: 0 API tokens used)"}</strong>
                </span>
                <span className="text-slate-400">
                  Cap: {Math.min(100, Math.round((tokenTelemetry.tokensToday / (settings?.dailyCapTokens || 50000)) * 100))}%
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300">
                Active Memory Store
              </span>
              {contexts.length > 0 && (
                <button
                  onClick={handleClearAllData}
                  className="text-[11px] text-rose-400 hover:text-rose-300 transition-colors">
                  Clear All
                </button>
              )}
            </div>

            {contexts.length === 0 ? (
              <div className="p-8 text-center rounded-xl bg-[#0F131C] border border-slate-800 space-y-2">
                <div className="w-9 h-9 mx-auto rounded-full bg-slate-900 flex items-center justify-center text-slate-500 border border-slate-800">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <p className="text-xs font-medium text-slate-300">No Contexts Stored</p>
                <p className="text-[11px] text-slate-500 max-w-[260px] mx-auto leading-relaxed">
                  Open Claude.ai or ChatGPT to chat. Context Bridge will continuously auto-save and synthesize technical memory here.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {contexts.map((ctx) => (
                  <div
                    key={ctx.id}
                    className="p-3 rounded-xl bg-[#0D1017] border border-slate-800/80 hover:border-indigo-500/40 transition-all space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-1.5">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                          {ctx.sourcePlatform}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold uppercase ${
                            ctx.summaryMode === "ai" || ctx.stateMemory.isAiSynthesized
                              ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                              : "bg-slate-800 text-slate-300 border border-slate-700"
                          }`}>
                          {ctx.summaryMode === "ai" || ctx.stateMemory.isAiSynthesized ? "AI Mode" : "Local Mode"}
                        </span>
                        <span className="text-xs font-medium text-slate-200 truncate max-w-[150px]">
                          {ctx.chatTitle}
                        </span>
                      </div>
                      <div className="flex items-center space-x-2 text-[10px] text-slate-500 font-mono">
                        {ctx.isPinned && (
                          <span
                            className="px-1.5 py-0.2 rounded text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold"
                            title="Pinned context never expires">
                            📌 PINNED
                          </span>
                        )}
                        <span>{timeAgo(ctx.updatedAt)}</span>
                        <button
                          onClick={() => handleTogglePin(ctx.id)}
                          className={`p-1 transition-colors ${
                            ctx.isPinned
                              ? "text-amber-400 hover:text-amber-300"
                              : "text-slate-500 hover:text-amber-400"
                          }`}
                          title={ctx.isPinned ? "Unpin context" : "Pin context (never expires)"}>
                          📌
                        </button>
                        <button
                          onClick={() => handleDeleteContext(ctx.id)}
                          className="text-slate-500 hover:text-rose-400 p-1"
                          title="Delete context">
                          ✕
                        </button>
                      </div>
                    </div>

                    <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                      {ctx.stateMemory.objective || ctx.stateMemory.currentWork}
                    </p>

                    <div className="flex items-center justify-between pt-1 border-t border-slate-800/60 text-[10px] font-mono text-slate-500">
                      <span>
                        Tokens: ~
                        {ctx.stateMemory.rawTokenEstimate ||
                          computeContextMetrics(ctx.turns || [], ctx.rawCodeBlocks || [], ctx.chatTitle)
                            .tokenEstimate}
                      </span>
                      <span>Exchanges: {getDisplayExchangeCount(ctx)}</span>
                      <span>Code: {ctx.rawCodeBlocks?.length || 0}</span>
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleOpenPreview(ctx)}
                          className="text-emerald-400 hover:text-emerald-300 underline decoration-emerald-500/40">
                          {previewContextId === ctx.id ? "Hide Preview" : "Preview Injected Text"}
                        </button>
                        <button
                          onClick={() =>
                            setSelectedContext(selectedContext?.id === ctx.id ? null : ctx)
                          }
                          className="text-indigo-400 hover:text-indigo-300 underline decoration-indigo-500/40">
                          {selectedContext?.id === ctx.id ? "Hide Details" : "View Details"}
                        </button>
                      </div>
                    </div>

                    {/* Injected Text Preview (Requirement A3) */}
                    {previewContextId === ctx.id && (
                      <div className="p-3 rounded-lg bg-[#07090E] border border-emerald-500/30 text-[11px] font-mono text-slate-300 space-y-2 mt-2">
                        <div className="flex items-center justify-between border-b border-slate-800/80 pb-1.5">
                          <div className="flex items-center space-x-1.5">
                            <span className="w-2 h-2 rounded-full bg-emerald-400" />
                            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                              Injected Text Preview (Target: {previewTargetPlatform})
                            </span>
                          </div>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(previewText)
                              setCopiedPreview(true)
                              setTimeout(() => setCopiedPreview(false), 2000)
                            }}
                            className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] hover:bg-emerald-500/30">
                            {copiedPreview ? "Copied!" : "Copy"}
                          </button>
                        </div>
                        <pre className="text-[10px] leading-relaxed whitespace-pre-wrap max-h-[180px] overflow-y-auto p-2 rounded bg-black/60 border border-slate-800/80 text-slate-200">
                          {previewText}
                        </pre>
                      </div>
                    )}

                    {/* Detailed State View Modal (Design K) */}
                    {selectedContext?.id === ctx.id && (
                      <div className="p-3 rounded-lg bg-[#07090E] border border-slate-800 text-[11px] font-mono text-slate-300 space-y-2 mt-2">
                        <div className="space-y-1 border-b border-slate-800/80 pb-2">
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-slate-500">Chat Key:</span>
                            <span className="text-indigo-400 font-semibold">{ctx.id}</span>
                          </div>
                          <div className="text-[10px]">
                            <span className="text-slate-500">Title:</span>{" "}
                            <span className="text-slate-200">{ctx.chatTitle}</span>
                          </div>
                          <div className="text-[10px]">
                            <span className="text-slate-500">Goal:</span>{" "}
                            <span className="text-emerald-300">{ctx.stateMemory.objective || "No goal specified"}</span>
                          </div>
                        </div>

                        {/* Stored Turns Breakdown (Design K) */}
                        <div className="space-y-1.5 pt-1">
                          <div className="flex items-center justify-between text-[10px] text-slate-400">
                            <span className="font-semibold text-slate-300">
                              Stored Turns ({ctx.turns?.length || 0})
                            </span>
                            <span>Exchanges: {getDisplayExchangeCount(ctx)}</span>
                          </div>
                          {ctx.turns && ctx.turns.length > 0 ? (
                            <div className="space-y-1 max-h-[160px] overflow-y-auto pr-1">
                              {ctx.turns.map((turn, tIdx) => (
                                <div
                                  key={tIdx}
                                  className="p-1.5 rounded bg-black/60 border border-slate-800/60 text-[10px] space-y-0.5">
                                  <div className="flex items-center justify-between">
                                    <span
                                      className={`px-1 py-0.2 rounded text-[9px] uppercase font-bold ${
                                        turn.role === "user"
                                          ? "bg-indigo-500/20 text-indigo-300"
                                          : "bg-emerald-500/20 text-emerald-300"
                                      }`}>
                                      {turn.role}
                                    </span>
                                    <span className="text-[9px] text-slate-500 truncate max-w-[120px]">
                                      {turn.chatId || ctx.chatId || "unknown"}
                                    </span>
                                  </div>
                                  <div className="text-slate-300 truncate">
                                    {turn.text.replace(/\s+/g, " ").trim().slice(0, 80)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-[10px] text-slate-500 italic">No turns stored.</div>
                          )}
                        </div>

                        {ctx.stateMemory.techStack && ctx.stateMemory.techStack.length > 0 && (
                          <div className="pt-1">
                            <span className="text-indigo-400 font-semibold text-[10px]">Tech Stack:</span>{" "}
                            <span className="text-[10px]">{ctx.stateMemory.techStack.join(", ")}</span>
                          </div>
                        )}
                        {ctx.stateMemory.nextSteps && ctx.stateMemory.nextSteps.length > 0 && (
                          <div>
                            <span className="text-emerald-400 font-semibold text-[10px]">Next Step:</span>{" "}
                            <span className="text-[10px]">{ctx.stateMemory.nextSteps[0]}</span>
                          </div>
                        )}
                        {ctx.rawCodeBlocks && ctx.rawCodeBlocks.length > 0 && (
                          <div className="space-y-1 pt-1">
                            <span className="text-purple-400 font-semibold text-[10px]">Verbatim Snippet:</span>
                            <pre className="p-2 rounded bg-black/60 border border-slate-800 text-[10px] overflow-x-auto text-emerald-400 whitespace-pre">
                              {ctx.rawCodeBlocks[0].code.slice(0, 300)}...
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ================= TAB 2: SETTINGS & BYOK ================= */}
        {activeTab === "settings" && (
          <div className="space-y-4">
            {/* Required Security Disclosure */}
            <div className="p-3 rounded-xl bg-amber-950/20 border border-amber-500/30 text-amber-300 text-[11px] leading-relaxed flex items-start space-x-2">
              <svg className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <span>
                <strong>Privacy Disclosure:</strong> Your chat text is sent to Google/OpenAI for summarization via your personal BYOK key. Context states and keys are persisted strictly in your local browser storage.
              </span>
            </div>

            {/* Provider Selector */}
            <div className="p-3.5 rounded-xl bg-[#0D1017] border border-slate-800 space-y-3">
              <label className="text-xs font-semibold text-slate-200">
                Summarization Provider (BYOK)
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setProvider("gemini")}
                  className={`py-2 px-3 rounded-lg text-xs font-medium border text-center transition-all ${
                    provider === "gemini"
                      ? "bg-indigo-600/20 border-indigo-500 text-indigo-300 font-bold"
                      : "bg-[#090B10] border-slate-800 text-slate-400 hover:text-slate-200"
                  }`}>
                  Google Gemini
                </button>
                <button
                  type="button"
                  onClick={() => setProvider("openai")}
                  className={`py-2 px-3 rounded-lg text-xs font-medium border text-center transition-all ${
                    provider === "openai"
                      ? "bg-indigo-600/20 border-indigo-500 text-indigo-300 font-bold"
                      : "bg-[#090B10] border-slate-800 text-slate-400 hover:text-slate-200"
                  }`}>
                  OpenAI
                </button>
              </div>

              {/* Gemini Configuration */}
              {provider === "gemini" ? (
                <div className="space-y-2.5 pt-2 border-t border-slate-800">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300 font-medium">Gemini API Key</span>
                    <a
                      href="https://aistudio.google.com/app/apikey"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] text-indigo-400 hover:underline">
                      Get Google Key ↗
                    </a>
                  </div>
                  <div className="relative">
                    <input
                      type={showGeminiKey ? "text" : "password"}
                      value={geminiApiKey}
                      onChange={(e) => setGeminiApiKey(e.target.value)}
                      placeholder="AIzaSy..."
                      className="w-full px-3 py-2 bg-[#090B10] border border-slate-700 rounded-lg text-xs font-mono text-slate-100 pr-10 focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowGeminiKey(!showGeminiKey)}
                      className="absolute right-2.5 top-2 text-slate-500 hover:text-slate-300 text-xs">
                      {showGeminiKey ? "Hide" : "Show"}
                    </button>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400">
                      Model Identifier (e.g. {DEFAULT_GEMINI_MODEL}, gemini-3.1-flash-lite)
                    </label>
                    <input
                      type="text"
                      value={geminiModel}
                      onChange={(e) => setGeminiModel(e.target.value)}
                      placeholder={DEFAULT_GEMINI_MODEL}
                      className="w-full px-3 py-1.5 bg-[#090B10] border border-slate-800 rounded-lg text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              ) : (
                /* OpenAI Configuration */
                <div className="space-y-2.5 pt-2 border-t border-slate-800">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300 font-medium">OpenAI API Key</span>
                    <a
                      href="https://platform.openai.com/api-keys"
                      target="_blank"
                      rel="noreferrer"
                      className="text-[10px] text-indigo-400 hover:underline">
                      Get OpenAI Key ↗
                    </a>
                  </div>
                  <div className="relative">
                    <input
                      type={showOpenAIKey ? "text" : "password"}
                      value={openaiApiKey}
                      onChange={(e) => setOpenApiKey(e.target.value)}
                      placeholder="sk-..."
                      className="w-full px-3 py-2 bg-[#090B10] border border-slate-700 rounded-lg text-xs font-mono text-slate-100 pr-10 focus:outline-none focus:border-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowOpenAIKey(!showOpenAIKey)}
                      className="absolute right-2.5 top-2 text-slate-500 hover:text-slate-300 text-xs">
                      {showOpenAIKey ? "Hide" : "Show"}
                    </button>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400">
                      Model Identifier (e.g. {DEFAULT_OPENAI_MODEL}, gpt-4o)
                    </label>
                    <input
                      type="text"
                      value={openaiModel}
                      onChange={(e) => setOpenApiModel(e.target.value)}
                      placeholder={DEFAULT_OPENAI_MODEL}
                      className="w-full px-3 py-1.5 bg-[#090B10] border border-slate-800 rounded-lg text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              )}

              {/* Live Test Connection Button */}
              <div className="pt-2 border-t border-slate-800 space-y-2">
                <button
                  type="button"
                  disabled={isTesting || (provider === "gemini" ? !geminiApiKey.trim() : !openaiApiKey.trim())}
                  onClick={handleTestConnection}
                  className="w-full py-2 px-3 rounded-lg text-xs font-semibold border border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center space-x-1.5">
                  {isTesting ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-3.5 w-3.5 text-indigo-400" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      <span>Testing Connection...</span>
                    </>
                  ) : (
                    <span>Test API Key & Model</span>
                  )}
                </button>

                {/* Connection Test Result */}
                {testResult && (
                  <div
                    className={`p-2.5 rounded-lg text-[11px] font-mono border break-words ${
                      testResult.type === "success"
                        ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-300"
                        : "bg-rose-950/40 border-rose-500/40 text-rose-300"
                    }`}>
                    {testResult.message}
                  </div>
                )}
              </div>
            </div>


            {/* Auto-Expiry Configuration */}
            <div className="p-3.5 rounded-xl bg-[#0D1017] border border-slate-800 space-y-2">
              <label className="text-xs font-semibold text-slate-200">
                Context Auto-Expiry Duration
              </label>
              <select
                value={autoExpiryHours}
                onChange={(e) => setAutoExpiryHours(Number(e.target.value))}
                className="w-full px-3 py-2 bg-[#090B10] border border-slate-700 rounded-lg text-xs font-mono text-slate-100 focus:outline-none focus:border-indigo-500">
                <option value={6}>6 Hours</option>
                <option value={12}>12 Hours</option>
                <option value={24}>24 Hours (Default)</option>
                <option value={48}>48 Hours</option>
                <option value={168}>7 Days</option>
              </select>
              <p className="text-[10px] text-slate-500">
                Contexts older than this duration are automatically pruned from local storage.
              </p>
            </div>

            {/* Max Output Tokens Configuration (Requirement 5) */}
            <div className="p-3.5 rounded-xl bg-[#0D1017] border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-200">
                  AI Summary Max Output Tokens
                </label>
                <span className="text-[10px] font-mono text-indigo-400">
                  {maxOutputTokens} tokens
                </span>
              </div>
              <input
                type="number"
                min={200}
                max={2000}
                step={50}
                value={maxOutputTokens}
                onChange={(e) => setMaxOutputTokens(Number(e.target.value))}
                className="w-full px-3 py-1.5 bg-[#090B10] border border-slate-700 rounded-lg text-xs font-mono text-slate-100 focus:outline-none focus:border-indigo-500"
              />
              <p className="text-[10px] text-slate-500">
                Caps the LLM compact response size (~500 tokens default). Ensures terse, high-density outputs.
              </p>
            </div>

            {/* Daily Token Cap Configuration (Stage 2 Requirement 6) */}
            <div className="p-3.5 rounded-xl bg-[#0D1017] border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-200">
                  Daily Token Cap
                </label>
                <span className="text-[10px] font-mono text-indigo-400">
                  {dailyCapTokens.toLocaleString()} tokens/day
                </span>
              </div>
              <input
                type="number"
                min={1000}
                max={500000}
                step={5000}
                value={dailyCapTokens}
                onChange={(e) => setDailyCapTokens(Number(e.target.value))}
                className="w-full px-3 py-1.5 bg-[#090B10] border border-slate-700 rounded-lg text-xs font-mono text-slate-100 focus:outline-none focus:border-indigo-500"
              />
              <p className="text-[10px] text-slate-500">
                Guards against API spend. Automatically falls back to Local Mode if daily token limit is reached.
              </p>
            </div>

            {/* Status Feedback */}
            {statusMessage.text && (
              <div
                className={`p-2.5 rounded-lg text-xs font-medium border ${
                  statusMessage.type === "success"
                    ? "bg-emerald-950/40 border-emerald-500/40 text-emerald-300"
                    : "bg-rose-950/40 border-rose-500/40 text-rose-300"
                }`}>
                {statusMessage.text}
              </div>
            )}

            {/* Action Buttons */}
            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={handleSaveSettings}
                className="w-full py-2.5 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/25 transition-all">
                Save Settings
              </button>

              <button
                type="button"
                onClick={handleDeleteKeys}
                className="w-full py-2 rounded-lg text-xs font-medium border border-slate-700 hover:border-rose-500/40 text-slate-400 hover:text-rose-400 transition-all">
                Delete API Keys
              </button>
            </div>
          </div>
        )}

        {/* ================= TAB: LIVE DIAGNOSTICS (Directive 1) ================= */}
        {activeTab === "diagnostics" && (
          <div className="space-y-3">
            {/* ================= Context Storage & Filtering Diagnostics (Requirement 6) ================= */}
            <div className="p-3.5 rounded-xl bg-[#0D1017] border border-slate-800 space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div>
                  <span className="text-xs font-semibold text-slate-200">
                    Storage & Filtering Audit
                  </span>
                  <p className="text-[10px] text-slate-500 font-mono">
                    Active tab: {activeTabInfo.platform.toUpperCase()} ({activeTabInfo.chatId || "new"})
                  </p>
                </div>
                <div className="flex items-center space-x-1.5 text-[10px] font-mono">
                  <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    Total: {contextDiagnostics.totalStored}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    Eligible: {contextDiagnostics.eligibleCount}
                  </span>
                  {contextDiagnostics.excludedCount > 0 && (
                    <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      Excluded: {contextDiagnostics.excludedCount}
                    </span>
                  )}
                </div>
              </div>

              {contextDiagnostics.items.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-2">
                  No contexts in storage. Start a chat on any platform to test auto-save.
                </p>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {contextDiagnostics.items.map((item) => (
                    <div
                      key={item.contextId}
                      className={`p-2.5 rounded-lg border text-xs font-mono space-y-1.5 ${
                        item.eligible
                          ? "bg-[#090B10] border-emerald-500/30"
                          : "bg-rose-950/10 border-rose-500/30"
                      }`}>
                      {/* Line 1: Header / Platform / ID / Status */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-1.5">
                          <span className="px-1.5 py-0.2 text-[9px] font-semibold uppercase rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                            {item.sourcePlatform}
                          </span>
                          <span className="text-slate-200 font-semibold truncate max-w-[170px]" title={item.contextId}>
                            {item.contextId}
                          </span>
                        </div>
                        <span
                          className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${
                            item.eligible
                              ? "bg-emerald-950/80 text-emerald-300 border border-emerald-500/40"
                              : "bg-rose-950/80 text-rose-300 border border-rose-500/40"
                          }`}>
                          {item.statusLabel}
                        </span>
                      </div>

                      {/* Line 2: Chat ID & Type */}
                      <div className="flex items-center justify-between text-[10px] text-slate-300">
                        <span className="truncate max-w-[190px]">Chat ID: {item.chatId}</span>
                        <span className={`text-[9px] px-1 rounded font-semibold ${item.isTemporary ? "bg-amber-950/70 text-amber-300 border border-amber-500/30" : "bg-cyan-950/70 text-cyan-300 border border-cyan-500/30"}`}>
                          {item.isTemporary ? "Temporary" : "Real Permalink"}
                        </span>
                      </div>

                      {/* Line 3: Session ID */}
                      <div className="text-[10px] text-slate-400 truncate">
                        <span className="text-slate-500">Session: </span>{item.clientSessionId || "none"}
                      </div>

                      {/* Line 4: Timestamps & Turns */}
                      <div className="flex items-center justify-between text-[10px] text-slate-400">
                        <span>Created: {formatAge(item.createdAt)}</span>
                        <span>Updated: {formatAge(item.updatedAt)}</span>
                      </div>

                      {/* Line 5: Turns Breakdown & Source */}
                      <div className="text-[10px] text-slate-300 font-semibold">
                        <span className="text-slate-500 font-normal">Turns: </span>{item.turnsSummary}
                      </div>

                      {/* Source of each turn (Requirement 7) */}
                      {item.turnsBreakdown && item.turnsBreakdown.length > 0 && (
                        <div className="bg-black/30 p-1.5 rounded border border-slate-800/80 space-y-1 text-[9px] font-mono">
                          <span className="text-slate-500 block uppercase font-semibold text-[8px] tracking-wider">
                            Turn Source Breakdown ({item.turnsBreakdown.length}):
                          </span>
                          {item.turnsBreakdown.slice(0, 5).map((tb) => (
                            <div key={tb.index} className="flex items-start justify-between text-slate-400">
                              <span className="truncate max-w-[200px]" title={tb.preview}>
                                #{tb.index} [{tb.role}]: {tb.preview || "(empty)"}
                              </span>
                              <span className="text-slate-500 text-[8px] shrink-0 ml-1">
                                chat:{tb.sourceChatId.slice(0, 8)}
                              </span>
                            </div>
                          ))}
                          {item.turnsBreakdown.length > 5 && (
                            <div className="text-slate-500 text-[8px] italic">
                              +{item.turnsBreakdown.length - 5} earlier turns from chat:{item.chatId.slice(0, 8)}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Line 6: Goal */}
                      <div className="text-[10px] text-indigo-200 bg-black/40 p-1.5 rounded border border-slate-800 break-words">
                        <span className="text-slate-500 font-mono block text-[9px] uppercase">Goal:</span>
                        {item.goal || "(None)"}
                      </div>

                      {/* Save Diagnostic Breakdown (Requirement 5) */}
                      {item.lastSaveDiagnostic && (
                        <div className="bg-black/50 p-2 rounded border border-indigo-500/20 text-[9px] font-mono space-y-1">
                          <span className="text-indigo-300 font-semibold uppercase tracking-wider block">
                            Save Diagnostic:
                          </span>
                          <div className="flex items-center justify-between text-slate-400">
                            <span>Temp ID: <span className="text-slate-200">{item.lastSaveDiagnostic.tempId}</span></span>
                            <span>Real Chat ID: <span className="text-slate-200">{item.lastSaveDiagnostic.realChatId}</span></span>
                          </div>
                          <div className="text-slate-400">
                            <span>Matched Entry: <span className="text-slate-200">{item.lastSaveDiagnostic.matchedEntryId}</span></span>
                          </div>
                          <div className="text-slate-400">
                            <span>Why: <span className="text-indigo-200">{item.lastSaveDiagnostic.why}</span></span>
                          </div>
                        </div>
                      )}

                      {/* Line 7: Filter Reason */}
                      <div className="text-[10px] pt-0.5 border-t border-slate-800/80 flex items-center justify-between">
                        <span className="text-slate-500">Status reason:</span>
                        <span className={item.eligible ? "text-emerald-400" : "text-rose-400"}>
                          {item.reason}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Save Timeline (Design K) */}
            <div className="p-3.5 rounded-xl bg-[#0D1017] border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="text-xs font-semibold text-slate-200">
                  Save Timeline (Last 20 Decisions)
                </span>
                <span className="text-[10px] font-mono text-indigo-400">
                  {saveTimeline.length} events
                </span>
              </div>
              {saveTimeline.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-2">
                  No save decisions recorded yet.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
                  {saveTimeline.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-2 rounded bg-[#090B10] border border-slate-800/80 text-[10px] font-mono space-y-1">
                      <div className="flex items-center justify-between">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase ${
                            item.decision === "saved" || item.decision === "updated"
                              ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                              : item.decision === "migrated" || item.decision === "merged"
                              ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                              : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                          }`}>
                          {item.decision}
                        </span>
                        <span className="text-slate-500">{formatAge(item.timestamp)}</span>
                      </div>
                      <div className="flex items-center justify-between text-slate-300">
                        <span className="text-indigo-300 truncate max-w-[200px]" title={item.chatKey}>
                          {item.chatKey}
                        </span>
                        <span className="text-slate-500">
                          {item.navMechanism || "unknown"}
                        </span>
                      </div>
                      {item.reason && (
                        <div className="text-slate-400 text-[9px] truncate" title={item.reason}>
                          {item.reason}
                        </div>
                      )}
                      {(Boolean(item.droppedTurns?.length) || Boolean(item.idSourceAttrCounts) || item.receivedTurnsCount !== undefined) && (
                        <details className="text-[9px] text-slate-400 select-all cursor-pointer pt-0.5">
                          <summary className="text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer">
                            Details
                          </summary>
                          <div className="mt-1 p-1.5 rounded bg-black/60 border border-slate-800 text-[9px] font-mono space-y-1">
                            <div>
                              Received: {item.receivedTurnsCount ?? item.turnsCount} | Kept: {item.keptTurnsCount ?? item.turnsCount}
                            </div>
                            {item.idSourceAttrCounts && (
                              <div>
                                Id Source Attrs:{" "}
                                {Object.entries(item.idSourceAttrCounts)
                                  .map(([k, v]) => `${k}: ${v}`)
                                  .join(", ")}
                              </div>
                            )}
                            {item.droppedTurns && item.droppedTurns.length > 0 && (
                              <div className="space-y-1 pt-0.5 border-t border-slate-800/80">
                                <div className="text-amber-400 font-semibold">Dropped Turns ({item.droppedTurns.length}):</div>
                                {item.droppedTurns.map((dt, dIdx) => (
                                  <div key={dIdx} className="text-slate-300 pl-1 border-l border-amber-500/40">
                                    <div>id: {dt.turnId} ({dt.role})</div>
                                    <div>attr: {dt.idSourceAttr || "unknown"} | textLen: {dt.textLength}</div>
                                    <div>storedOwner: {dt.storedOwnerChatId || "none"}</div>
                                    <div>currentChat: {dt.currentChatId}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300">
                Live Platform Diagnostics
              </span>
              <div className="flex items-center space-x-1.5">
                <button
                  type="button"
                  onClick={handleCopyDomSkeleton}
                  disabled={isCopyingSkeleton}
                  className="px-2.5 py-1 text-[11px] font-semibold bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 rounded-lg hover:bg-emerald-600/50 transition-all flex items-center space-x-1">
                  {isCopyingSkeleton ? (
                    <span>Extracting...</span>
                  ) : skeletonStatus.startsWith("Copied") ? (
                    <span>Copied!</span>
                  ) : (
                    <span>Copy DOM Skeleton</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleTriggerLiveScrape}
                  disabled={isScrapingNow}
                  className="px-2.5 py-1 text-[11px] font-semibold bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 rounded-lg hover:bg-indigo-600/50 transition-all flex items-center space-x-1">
                  {isScrapingNow ? <span>Checking...</span> : <span>Scrape Active Tab</span>}
                </button>
              </div>
            </div>

            {skeletonStatus && (
              <div
                className={`p-2 rounded-lg text-[11px] font-mono leading-relaxed ${
                  skeletonStatus.startsWith("Copied") || skeletonStatus.startsWith("Extracted")
                    ? "bg-emerald-950/40 border border-emerald-500/40 text-emerald-300"
                    : "bg-rose-950/40 border border-rose-500/40 text-rose-300"
                }`}>
                {skeletonStatus}
              </div>
            )}

            {/* Read-only DOM Skeleton Output with Select All & Copy (Directive 4) */}
            {skeletonText && (
              <div className="space-y-2 p-3 rounded-xl bg-[#07090E] border border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono text-emerald-400 font-semibold">
                    DOM Skeleton Output ({skeletonText.split("\n").length} lines)
                  </span>
                  <div className="flex items-center space-x-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        skeletonTextareaRef.current?.focus()
                        skeletonTextareaRef.current?.select()
                      }}
                      className="px-2 py-0.5 text-[10px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition-all">
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(skeletonText)
                        } catch {
                          skeletonTextareaRef.current?.focus()
                          skeletonTextareaRef.current?.select()
                          document.execCommand("copy")
                        }
                        setIsCopiedManual(true)
                        setTimeout(() => setIsCopiedManual(false), 2000)
                      }}
                      className="px-2 py-0.5 text-[10px] font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded shadow transition-all">
                      {isCopiedManual ? "Copied!" : "Copy"}
                    </button>
                  </div>
                </div>
                <textarea
                  ref={skeletonTextareaRef}
                  readOnly
                  value={skeletonText}
                  rows={10}
                  className="w-full p-2 rounded-lg bg-black/70 border border-slate-800 text-[10px] font-mono text-slate-300 select-all focus:outline-none focus:border-indigo-500/50 resize-y leading-tight"
                />
              </div>
            )}

            {/* ================= Find Marker Path Tool ================= */}
            <div className="p-3.5 rounded-xl bg-[#0D1017] border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">
                  Find Marker Path
                </span>
                <span className="text-[10px] text-indigo-400 font-mono">
                  DOM Investigator
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-normal">
                Type a unique marker word into your prompt in ChatGPT (e.g. <code className="text-indigo-300 font-mono">zzmarker1</code>), send or type it, then click below to output its exact ancestor chain and attribute candidates.
              </p>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={markerWord}
                  onChange={(e) => setMarkerWord(e.target.value)}
                  placeholder="zzmarker1"
                  className="flex-1 px-3 py-1.5 bg-[#07090E] border border-slate-700 rounded-lg text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="button"
                  onClick={handleFindMarkerPath}
                  disabled={isFindingMarker}
                  className="px-3 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg shadow transition-all whitespace-nowrap disabled:opacity-50">
                  {isFindingMarker ? "Searching..." : "Find Marker Path"}
                </button>
              </div>

              {markerStatus && (
                <div
                  className={`p-2 rounded-lg text-[11px] font-mono leading-relaxed ${
                    markerStatus.includes("complete") || markerStatus.includes("generated")
                      ? "bg-emerald-950/40 border border-emerald-500/40 text-emerald-300"
                      : "bg-rose-950/40 border border-rose-500/40 text-rose-300"
                  }`}>
                  {markerStatus}
                </div>
              )}

              {markerReport && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono text-indigo-300 font-semibold">
                      Marker Path & Layout Report ({markerReport.split("\n").length} lines)
                    </span>
                    <div className="flex items-center space-x-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          markerTextareaRef.current?.focus()
                          markerTextareaRef.current?.select()
                        }}
                        className="px-2 py-0.5 text-[10px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition-all">
                        Select all
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(markerReport)
                          } catch {
                            markerTextareaRef.current?.focus()
                            markerTextareaRef.current?.select()
                            document.execCommand("copy")
                          }
                          setIsCopiedMarkerReport(true)
                          setTimeout(() => setIsCopiedMarkerReport(false), 2000)
                        }}
                        className="px-2 py-0.5 text-[10px] font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded shadow transition-all">
                        {isCopiedMarkerReport ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  </div>
                  <textarea
                    ref={markerTextareaRef}
                    readOnly
                    value={markerReport}
                    rows={12}
                    className="w-full p-2.5 rounded-lg bg-black/70 border border-slate-800 text-[10px] font-mono text-slate-300 select-all focus:outline-none focus:border-indigo-500/50 resize-y leading-tight"
                  />
                </div>
              )}
            </div>

            {/* Platform Selector Buttons */}
            <div className="flex space-x-1.5 overflow-x-auto pb-1">
              {(["chatgpt", "claude", "gemini", "perplexity", "deepseek", "grok"] as PlatformId[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setSelectedDebugPlatform(p)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-mono uppercase border transition-all ${
                    selectedDebugPlatform === p
                      ? "bg-indigo-600 border-indigo-400 text-white font-bold"
                      : "bg-[#0D1017] border-slate-800 text-slate-400 hover:text-slate-200"
                  }`}>
                  {p}
                </button>
              ))}
            </div>

            {scrapeResult && (
              <div className="p-2 rounded-lg bg-indigo-950/40 border border-indigo-500/40 text-[11px] font-mono text-indigo-300 leading-relaxed">
                {scrapeResult}
              </div>
            )}

            {/* Diagnostics Metrics Card */}
            {(() => {
              const info = debugTelemetry[selectedDebugPlatform]
              return (
                <div className="p-3.5 rounded-xl bg-[#0D1017] border border-slate-800 space-y-2.5 font-mono text-xs">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <span className="text-slate-400 text-[11px]">Platform:</span>
                    <span className="text-indigo-400 font-bold uppercase">{selectedDebugPlatform}</span>
                  </div>

                  <div className="flex items-center justify-between border-b border-slate-800/60 pb-1.5">
                    <span className="text-slate-400 text-[11px]">Adapter Selected:</span>
                    <span className="text-slate-200 font-semibold">{info?.adapterSelected || `${selectedDebugPlatform} adapter`}</span>
                  </div>

                  <div className="flex items-center justify-between border-b border-slate-800/60 pb-1.5">
                    <span className="text-slate-400 text-[11px]">Current Chat ID:</span>
                    <span className="text-slate-300 truncate max-w-[200px]">{info?.chatId || "No active session"}</span>
                  </div>

                  <div className="flex items-center justify-between border-b border-slate-800/60 pb-1.5">
                    <span className="text-slate-400 text-[11px]">Chat Container Found:</span>
                    <span className={info?.chatContainerFound ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>
                      {info?.chatContainerFound ? `YES (${info.containerTag || "main"})` : "NO (waiting for DOM)"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between border-b border-slate-800/60 pb-1.5">
                    <span className="text-slate-400 text-[11px]">getMessages() Count:</span>
                    <span className={info && info.messagesCount > 0 ? "text-emerald-300 font-bold" : "text-slate-400"}>
                      {info ? `${info.messagesCount} turns` : "0 turns (open chat to scrape)"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between border-b border-slate-800/60 pb-1.5">
                    <span className="text-slate-400 text-[11px]">Selector Matched:</span>
                    <span className="text-indigo-300 font-semibold truncate max-w-[200px]">
                      {info?.matchedSelector || "none"}
                    </span>
                  </div>

                  <div className="space-y-1 border-b border-slate-800/60 pb-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 text-[11px]">Last Message Sent to BG:</span>
                      <span className="text-[10px] text-slate-500">{info?.lastMessageSentTime ? timeAgo(info.lastMessageSentTime) : ""}</span>
                    </div>
                    <p className="text-[11px] text-slate-300 bg-black/40 p-1.5 rounded truncate">
                      {info?.lastMessageSentToBg || "None sent yet"}
                    </p>
                  </div>

                  <div className="space-y-1 border-b border-slate-800/60 pb-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 text-[11px]">Background Result:</span>
                      <span className="text-[10px] text-slate-500">{info?.bgResultTime ? timeAgo(info.bgResultTime) : ""}</span>
                    </div>
                    <p className={`text-[11px] p-1.5 rounded truncate ${
                      info?.bgResult?.startsWith("Saved")
                        ? "bg-emerald-950/40 text-emerald-300 border border-emerald-500/30"
                        : info?.bgResult?.includes("REJECTED")
                        ? "bg-rose-950/40 text-rose-300 border border-rose-500/30"
                        : "bg-black/40 text-slate-300"
                    }`}>
                      {info?.bgResult || "Awaiting message from content script"}
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-slate-400 text-[11px]">Last Saved Time:</span>
                    <span className="text-slate-300">
                      {info?.lastSaveTime ? timeAgo(info.lastSaveTime) : "Not saved yet"}
                    </span>
                  </div>

                  {/* Save Diagnostic Info (Requirement 5) */}
                  {info?.lastSaveDiagnostic && (
                    <div className="space-y-1.5 border-t border-slate-800/80 pt-2 text-[10px]">
                      <span className="text-indigo-300 font-semibold uppercase text-[9px] tracking-wider block">
                        Last Save Event Diagnostic:
                      </span>
                      <div className="bg-black/50 p-2 rounded border border-indigo-500/30 space-y-1">
                        <div className="flex items-center justify-between text-slate-400">
                          <span>Temp ID: <span className="text-slate-200">{info.lastSaveDiagnostic.tempId}</span></span>
                          <span>Real Chat ID: <span className="text-slate-200">{info.lastSaveDiagnostic.realChatId}</span></span>
                        </div>
                        <div className="text-slate-400">
                          <span>Matched Entry: <span className="text-slate-200">{info.lastSaveDiagnostic.matchedEntryId}</span></span>
                        </div>
                        <div className="text-slate-400">
                          <span>Why: <span className="text-indigo-200">{info.lastSaveDiagnostic.why}</span></span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })()}
          </div>
        )}

        {/* ================= TAB 3: PLATFORM HEALTH ================= */}
        {activeTab === "health" && (
          <div className="space-y-3">
            <span className="text-xs font-semibold text-slate-300">
              Adapter Selector Health
            </span>
            <div className="space-y-2">
              {healthReports.map((report) => (
                <div
                  key={report.platform}
                  className="p-3 rounded-xl bg-[#0D1017] border border-slate-800 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-200 font-mono">
                      {report.platform}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                        report.ok
                          ? "bg-emerald-950/60 text-emerald-400 border border-emerald-500/30"
                          : "bg-slate-900 text-slate-400 border border-slate-800"
                      }`}>
                      {report.ok ? "ACTIVE / MATCHED" : "STANDBY"}
                    </span>
                  </div>
                  {report.issues.length > 0 && (
                    <div className="text-[10px] text-slate-400 space-y-0.5">
                      {report.issues.map((iss, i) => (
                        <p key={i}>• {iss}</p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="px-5 py-2.5 border-t border-slate-800 bg-[#0D1017] flex items-center justify-between text-[10px] font-mono text-slate-500">
        <span>Continuous Auto-Save</span>
        <span className="text-indigo-400">{getAllAdapters().length} Platforms Active</span>
      </footer>
    </div>
  )
}
