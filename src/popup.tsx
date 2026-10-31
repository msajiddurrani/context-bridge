import { useEffect, useState } from "react"
import { getAllAdapters } from "./adapters"
import {
  type AdapterHealthResult,
  type AfterInjectBehavior,
  type InjectedRecord,
  type PlatformId,
  type StoredContext,
  type SaveDecisionRecord
} from "./types"
import iconSrc from "data-base64:~assets/icon.png"
import {
  clearAllData,
  deleteContext,
  getInjectedRecords,
  getSaveTimeline,
  getSettings,
  getStoredContexts,
  saveSettings,
  togglePinContext
} from "./utils/storage-manager"
import { diagnoseContexts, isGenericOrNewChatId } from "./utils/context-filter"
import { computeContextMetrics } from "./utils/local-mode"
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
  const [contexts, setContexts] = useState<StoredContext[]>([])
  const [healthReports, setHealthReports] = useState<AdapterHealthResult[]>([])
  const [selectedContext, setSelectedContext] = useState<StoredContext | null>(null)
  const [saveTimeline, setSaveTimeline] = useState<SaveDecisionRecord[]>([])

  // Active Tab Info & Filter State
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

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState("")
  const [platformFilter, setPlatformFilter] = useState<"all" | PlatformId>("all")

  // Preview State
  const [previewContextId, setPreviewContextId] = useState<string | null>(null)
  const [previewTargetPlatform, setPreviewTargetPlatform] = useState<PlatformId>("chatgpt")
  const [previewDensityMode, setPreviewDensityMode] = useState<
    "compact" | "standard" | "smart" | "complete" | "download"
  >("standard")
  const [previewFormat, setPreviewFormat] = useState<"markdown" | "xml">("markdown")
  const [previewText, setPreviewText] = useState<string>("")
  const [copiedPreview, setCopiedPreview] = useState(false)
  const [copiedContextId, setCopiedContextId] = useState<string | null>(null)

  // Status message toast
  const [statusMessage, setStatusMessage] = useState<string>("")

  // Settings State (Clean Local-First)
  const [autoImport, setAutoImport] = useState<boolean>(true)
  const [autoExpiryHours, setAutoExpiryHours] = useState<number>(24)
  const [afterInjectAction, setAfterInjectAction] = useState<AfterInjectBehavior>("focus")
  const [customStyle, setCustomStyle] = useState<string>("Direct, technical, code-centric; omit polite filler.")
  const [customResume, setCustomResume] = useState<string>(
    'Continue this work. Don\'t re-summarize. Reply "Ready" in one word, then wait for my next message.'
  )
  const [showSwitchSuggestions, setShowSwitchSuggestions] = useState<boolean>(true)

  // DOM Investigator State
  const [isInvestigatorOpen, setIsInvestigatorOpen] = useState(false)
  const [marker1, setMarker1] = useState("")
  const [isGeneratingReport, setIsGeneratingReport] = useState(false)
  const [siteReportStatus, setSiteReportStatus] = useState("")
  const [activeTabHost, setActiveTabHost] = useState("")

  const loadData = async (isInitial = false) => {
    try {
      if (isInitial) {
        const cfg = await getSettings()
        setAutoImport(cfg.autoImport !== false)
        setAutoExpiryHours(cfg.autoExpiryHours || 24)
        setAfterInjectAction(cfg.afterInjectAction || "focus")
        setCustomStyle(cfg.customStyle || "Direct, technical, code-centric; omit polite filler.")
        setCustomResume(
          cfg.customResume ||
            'Continue this work. Don\'t re-summarize. Reply "Ready" in one word, then wait for my next message.'
        )
        setShowSwitchSuggestions(cfg.showSwitchSuggestions !== false)
      }

      const ctxList = await getStoredContexts()
      setContexts(ctxList)

      const injectedRecs = await getInjectedRecords().catch(() => ({}))
      setInjectedRecords(injectedRecs)

      const timeline = await getSaveTimeline().catch(() => [])
      setSaveTimeline(timeline)

      // Query active tab for live diagnostics
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0]
        if (activeTab?.url) {
          try {
            const urlObj = new URL(activeTab.url)
            const hostname = urlObj.hostname.toLowerCase()
            setActiveTabHost(hostname)
          } catch {}

          const matched = getAllAdapters().find((ad) => ad.matches(activeTab.url!))
          if (matched) {
            const cId = matched.getChatId(activeTab.url!, document)
            setActiveTabInfo({
              platform: matched.id,
              chatId: cId,
              isNewChat: isGenericOrNewChatId(cId)
            })

            if (activeTab.id) {
              chrome.tabs.sendMessage(activeTab.id, { type: "REQUEST_LIVE_DOM_SCRAPE" }, async (res) => {
                if (!chrome.runtime.lastError && res?.success) {
                  if (res.chatId && !isGenericOrNewChatId(res.chatId)) {
                    setActiveTabInfo((prev) => ({
                      ...prev,
                      chatId: res.chatId,
                      isNewChat: false
                    }))
                  }
                  getStoredContexts().then(setContexts)
                }
              })
            }
          }
        }
      })
    } catch (e) {
      console.error("[ContextBridge Popup] Error loading state:", e)
    }
  }

  const runHealthCheck = async () => {
    const results: AdapterHealthResult[] = []
    const adapters = getAllAdapters()

    for (const adapter of adapters) {
      try {
        const health = adapter.healthCheck(document)
        results.push(health)
      } catch (err: any) {
        results.push({
          platform: adapter.id,
          ok: false,
          inputBoxFound: false,
          messagesFound: false,
          lastChecked: Date.now(),
          issues: [`Health check threw error: ${err.message || String(err)}`]
        })
      }
    }
    setHealthReports(results)
  }

  useEffect(() => {
    loadData(true)
    runHealthCheck()

    const interval = setInterval(() => {
      loadData(false)
    }, 2500)

    return () => clearInterval(interval)
  }, [])

  const handleTogglePin = async (id: string) => {
    await togglePinContext(id)
    await loadData(false)
  }

  const handleDeleteContext = async (id: string) => {
    await deleteContext(id)
    await loadData(false)
  }

  const handleOpenPreview = (ctx: StoredContext) => {
    if (previewContextId === ctx.id) {
      setPreviewContextId(null)
      return
    }
    const defaultTarget: PlatformId = ctx.sourcePlatform === "claude" ? "chatgpt" : "claude"
    setPreviewTargetPlatform(defaultTarget)
    setPreviewContextId(ctx.id)

    const text = buildPreviewInjectedText(ctx, defaultTarget, previewDensityMode, previewFormat, {
      customStyle,
      customResume
    })
    setPreviewText(text)
  }

  const handleUpdatePreview = (
    target: PlatformId,
    mode: "compact" | "standard" | "smart" | "complete" | "download",
    format: "markdown" | "xml"
  ) => {
    const ctx = contexts.find((c) => c.id === previewContextId)
    if (!ctx) return
    setPreviewTargetPlatform(target)
    setPreviewDensityMode(mode)
    setPreviewFormat(format)
    const text = buildPreviewInjectedText(ctx, target, mode, format, {
      customStyle,
      customResume
    })
    setPreviewText(text)
  }

  const handleQuickCopyPrompt = async (ctx: StoredContext) => {
    const target: PlatformId = ctx.sourcePlatform === "claude" ? "chatgpt" : "claude"
    const text = buildPreviewInjectedText(ctx, target, "standard", "markdown", {
      customStyle,
      customResume
    })
    try {
      await navigator.clipboard.writeText(text)
      setCopiedContextId(ctx.id)
      setStatusMessage(`Copied handover prompt for ${ctx.chatTitle}!`)
      setTimeout(() => {
        setCopiedContextId(null)
        setStatusMessage("")
      }, 2500)
    } catch {
      setStatusMessage("Failed to copy prompt.")
      setTimeout(() => setStatusMessage(""), 2000)
    }
  }

  const handleSaveSettings = async () => {
    try {
      await saveSettings({
        autoImport,
        autoExpiryHours,
        afterInjectAction,
        customStyle,
        customResume,
        showSwitchSuggestions
      })
      setStatusMessage("Settings saved successfully!")
      setTimeout(() => setStatusMessage(""), 2500)
    } catch (e: any) {
      setStatusMessage(`Error saving settings: ${e.message}`)
      setTimeout(() => setStatusMessage(""), 3500)
    }
  }

  const handleClearAll = async () => {
    if (confirm("Are you sure you want to clear all stored conversation contexts? This cannot be undone.")) {
      await clearAllData()
      await loadData(false)
      setStatusMessage("All conversation history cleared.")
      setTimeout(() => setStatusMessage(""), 2500)
    }
  }

  const handleExportData = () => {
    const blob = new Blob([JSON.stringify(contexts, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `context-bridge-backup-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setStatusMessage("Exported conversation contexts backup!")
    setTimeout(() => setStatusMessage(""), 2500)
  }

  // Filtered contexts
  const filteredContexts = contexts
    .filter((c) => {
      if (platformFilter === "all") return true
      return c.sourcePlatform === platformFilter
    })
    .filter((c) => {
      if (!searchQuery.trim()) return true
      const q = searchQuery.toLowerCase()
      return (
        c.chatTitle.toLowerCase().includes(q) ||
        (c.stateMemory.objective && c.stateMemory.objective.toLowerCase().includes(q)) ||
        (c.stateMemory.currentWork && c.stateMemory.currentWork.toLowerCase().includes(q)) ||
        c.sourcePlatform.toLowerCase().includes(q)
      )
    })

  return (
    <div className="w-[540px] min-h-[580px] max-h-[640px] flex flex-col bg-slate-50 text-slate-800 font-sans select-none overflow-hidden border border-slate-200/90 shadow-2xl">
      {/* ===== Header ===== */}
      <header className="bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-2.5">
          <img
            src={iconSrc}
            alt="Context Bridge"
            className="w-7 h-7 rounded-md shadow-2xs border border-slate-200/80 object-cover"
          />
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-sm font-bold text-slate-900 tracking-tight leading-none">
                Context Bridge
              </h1>
              <span className="text-[10px] font-mono font-bold text-slate-700 bg-slate-100 border border-slate-300 px-1.5 py-0.5 rounded-sm uppercase tracking-wide">
                Local-First
              </span>
            </div>
            <p className="text-[10px] text-slate-500 font-medium leading-none mt-1">
              Zero-latency universal LLM context layer
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => {
              chrome.tabs.create({ url: chrome.runtime.getURL("tabs/dashboard.html") })
            }}
            className="flex items-center space-x-1 px-2.5 py-1 rounded-sm bg-indigo-600 hover:bg-indigo-700 text-white font-mono font-semibold text-[10px] uppercase tracking-wider transition-all cursor-pointer shadow-2xs"
            title="Open full-screen dashboard in a new tab">
            <span>Dashboard</span>
            <span className="text-xs">↗</span>
          </button>
          <div className="flex items-center space-x-1.5 bg-slate-100 text-slate-700 border border-slate-300 px-2 py-0.5 rounded-sm text-[10px] font-mono font-bold uppercase">
            <span className="w-1.5 h-1.5 bg-emerald-500" />
            <span>Sync Active</span>
          </div>
        </div>
      </header>

      {/* ===== Status Toast ===== */}
      {statusMessage && (
        <div className="bg-indigo-600 text-white text-xs px-4 py-1.5 font-medium flex items-center justify-between shadow-sm animate-fade-in shrink-0">
          <span>{statusMessage}</span>
          <button
            onClick={() => setStatusMessage("")}
            className="text-white/80 hover:text-white text-xs font-bold ml-2">
            ✕
          </button>
        </div>
      )}

      {/* ===== Segmented Tab Navigation ===== */}
      <nav className="bg-slate-100 p-0.5 rounded-md flex items-center space-x-1 border border-slate-200 mx-4 mt-3 mb-2 shrink-0">
        <button
          onClick={() => setActiveTab("contexts")}
          className={`flex-1 py-1.5 px-2 text-xs rounded-sm font-semibold transition-all flex items-center justify-center space-x-1.5 cursor-pointer ${
            activeTab === "contexts"
              ? "bg-white text-indigo-700 shadow-2xs border border-slate-200 font-bold"
              : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
          }`}>
          <span>Contexts</span>
          {contexts.length > 0 && (
            <span
              className={`px-1.5 py-0.2 rounded-sm text-[10px] font-mono font-bold ${
                activeTab === "contexts"
                  ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                  : "bg-slate-200 text-slate-700 border border-slate-300"
              }`}>
              {contexts.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("settings")}
          className={`flex-1 py-1.5 px-2 text-xs rounded-sm font-semibold transition-all cursor-pointer ${
            activeTab === "settings"
              ? "bg-white text-indigo-700 shadow-2xs border border-slate-200 font-bold"
              : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
          }`}>
          Settings
        </button>

        <button
          onClick={() => setActiveTab("diagnostics")}
          className={`flex-1 py-1.5 px-2 text-xs rounded-sm font-semibold transition-all cursor-pointer ${
            activeTab === "diagnostics"
              ? "bg-white text-indigo-700 shadow-2xs border border-slate-200 font-bold"
              : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
          }`}>
          Diagnostics
        </button>

        <button
          onClick={() => setActiveTab("health")}
          className={`flex-1 py-1.5 px-2 text-xs rounded-sm font-semibold transition-all cursor-pointer ${
            activeTab === "health"
              ? "bg-white text-indigo-700 shadow-2xs border border-slate-200 font-bold"
              : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
          }`}>
          Platform Health
        </button>
      </nav>

      {/* ===== Main Content Area ===== */}
      <main className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
        {/* =================================================================== */}
        {/* TAB 1: CONTEXTS */}
        {/* =================================================================== */}
        {activeTab === "contexts" && (
          <div className="space-y-3">
            {/* Search & Filter Toolbar */}
            <div className="flex items-center space-x-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search conversations, code, or topics..."
                  className="w-full bg-white border border-slate-200/90 rounded-md px-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all shadow-2xs"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-1.5 text-slate-400 hover:text-slate-600 text-xs">
                    ✕
                  </button>
                )}
              </div>

              {/* Platform Filter Chips */}
              <div className="flex items-center space-x-1 shrink-0 bg-slate-100 p-0.5 rounded-md border border-slate-200">
                {(["all", "claude", "chatgpt", "gemini"] as const).map((plat) => (
                  <button
                    key={plat}
                    onClick={() => setPlatformFilter(plat)}
                    className={`px-2 py-1 text-[10px] font-mono font-semibold rounded-sm uppercase transition-all cursor-pointer ${
                      platformFilter === plat
                        ? "bg-white text-indigo-700 shadow-2xs font-bold border border-slate-200"
                        : "text-slate-600 hover:text-slate-900"
                    }`}>
                    {plat}
                  </button>
                ))}
              </div>
            </div>

            {/* Context Cards List */}
            {filteredContexts.length === 0 ? (
              <div className="bg-white border border-dashed border-slate-200 rounded-lg p-8 text-center space-y-2">
                <div className="w-10 h-10 mx-auto rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 text-lg">
                  💬
                </div>
                <h3 className="text-xs font-bold text-slate-800">
                  {searchQuery ? "No matching conversations" : "No active conversations captured yet"}
                </h3>
                <p className="text-[11px] text-slate-500 max-w-sm mx-auto leading-relaxed">
                  Open ChatGPT, Claude, or Gemini in your browser. Context Bridge automatically
                  absorbs the complete chat history into local memory!
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {filteredContexts.map((ctx) => {
                  const exchangeCount = getDisplayExchangeCount(ctx)
                  const codeCount = ctx.rawCodeBlocks?.length || 0
                  const tokenEst =
                    ctx.stateMemory.rawTokenEstimate ||
                    computeContextMetrics(ctx.turns || [], ctx.rawCodeBlocks || [], ctx.chatTitle)
                      .tokenEstimate
                  const isPinned = ctx.isPinned

                  const platBadgeColor =
                    ctx.sourcePlatform === "claude"
                      ? "bg-amber-50 text-amber-800 border-amber-200/70"
                      : ctx.sourcePlatform === "chatgpt"
                      ? "bg-emerald-50 text-emerald-800 border-emerald-200/70"
                      : "bg-blue-50 text-blue-800 border-blue-200/70"

                  return (
                    <article
                      key={ctx.id}
                      className="bg-white rounded-xl border border-slate-200/90 hover:border-indigo-300 shadow-2xs hover:shadow-xs transition-all p-3.5 space-y-2.5">
                      {/* Card Header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-1.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border ${platBadgeColor}`}>
                            {ctx.sourcePlatform}
                          </span>

                          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/60">
                            {ctx.isImported ? "Full History (100%)" : "Local Mode"}
                          </span>

                          <h2
                            className="text-xs font-semibold text-slate-900 truncate max-w-[200px]"
                            title={ctx.chatTitle}>
                            {ctx.chatTitle}
                          </h2>
                        </div>

                        <div className="flex items-center space-x-2 text-[10px] text-slate-500 font-mono">
                          {isPinned && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] bg-amber-50 text-amber-800 border border-amber-200/70 font-bold">
                              📌 Pinned
                            </span>
                          )}
                          <span>{formatAge(ctx.updatedAt)}</span>
                          <button
                            onClick={() => handleTogglePin(ctx.id)}
                            className={`p-1 transition-colors cursor-pointer ${
                              isPinned ? "text-amber-500" : "text-slate-400 hover:text-amber-500"
                            }`}
                            title={isPinned ? "Unpin context" : "Pin context (never expires)"}>
                            📌
                          </button>
                          <button
                            onClick={() => handleDeleteContext(ctx.id)}
                            className="text-slate-400 hover:text-rose-500 p-1 cursor-pointer transition-colors"
                            title="Delete context">
                            ✕
                          </button>
                        </div>
                      </div>

                      {/* Summary Objective */}
                      <p className="text-[11px] text-slate-600 line-clamp-2 leading-relaxed">
                        {ctx.stateMemory.objective ||
                          ctx.stateMemory.currentWork ||
                          "Engineering conversation transcript captured locally."}
                      </p>

                      {/* Card Meta & Action Bar */}
                      <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-[10px] font-mono text-slate-500">
                        <div className="flex items-center space-x-2">
                          <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">
                            {exchangeCount} exchanges
                          </span>
                          {codeCount > 0 && (
                            <span className="bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded font-semibold">
                              {codeCount} code blocks
                            </span>
                          )}
                          <span>~{tokenEst} tok</span>
                        </div>

                        <div className="flex items-center space-x-1.5">
                          <button
                            onClick={() => handleQuickCopyPrompt(ctx)}
                            className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200/70 transition-all cursor-pointer">
                            {copiedContextId === ctx.id ? "✓ Copied!" : "Copy Context"}
                          </button>
                          <button
                            onClick={() => handleOpenPreview(ctx)}
                            className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all cursor-pointer">
                            {previewContextId === ctx.id ? "Hide Preview" : "Preview"}
                          </button>
                          <button
                            onClick={() =>
                              setSelectedContext(selectedContext?.id === ctx.id ? null : ctx)
                            }
                            className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all cursor-pointer">
                            {selectedContext?.id === ctx.id ? "Hide Details" : "Details"}
                          </button>
                        </div>
                      </div>

                      {/* Injected Text Preview Modal */}
                      {previewContextId === ctx.id && (
                        <div className="p-3 rounded-xl bg-slate-100/90 border border-slate-200 text-[11px] space-y-2 mt-2">
                          <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
                            <div className="flex items-center space-x-2">
                              <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">
                                Target AI:
                              </span>
                              {(["chatgpt", "claude", "gemini"] as const).map((t) => (
                                <button
                                  key={t}
                                  onClick={() =>
                                    handleUpdatePreview(t, previewDensityMode, previewFormat)
                                  }
                                  className={`px-1.5 py-0.5 rounded text-[9px] font-mono capitalize transition-all cursor-pointer ${
                                    previewTargetPlatform === t
                                      ? "bg-indigo-600 text-white font-bold"
                                      : "bg-white text-slate-600 border border-slate-200"
                                  }`}>
                                  {t}
                                </button>
                              ))}
                            </div>

                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(previewText)
                                setCopiedPreview(true)
                                setTimeout(() => setCopiedPreview(false), 2000)
                              }}
                              className="px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-[10px] transition-all cursor-pointer shadow-2xs">
                              {copiedPreview ? "✓ Copied" : "Copy Prompt"}
                            </button>
                          </div>

                          <pre className="text-[10px] font-mono leading-relaxed whitespace-pre-wrap max-h-[220px] overflow-y-auto p-2.5 rounded-lg bg-white border border-slate-200/90 text-slate-800 select-text">
                            {previewText}
                          </pre>
                        </div>
                      )}

                      {/* Detailed State View Modal */}
                      {selectedContext?.id === ctx.id && (
                        <div className="p-3 rounded-xl bg-slate-100/90 border border-slate-200 text-[11px] space-y-2 mt-2">
                          <div className="flex items-center justify-between border-b border-slate-200 pb-1.5 font-mono text-[10px]">
                            <span className="font-semibold text-slate-700">Chat Key: {ctx.id}</span>
                            <span className="text-slate-500">ID: {ctx.chatId}</span>
                          </div>

                          {ctx.stateMemory.objective && (
                            <div>
                              <span className="text-[10px] font-bold text-slate-700 uppercase">
                                Objective:
                              </span>
                              <p className="text-slate-600 mt-0.5">{ctx.stateMemory.objective}</p>
                            </div>
                          )}

                          {ctx.rawCodeBlocks && ctx.rawCodeBlocks.length > 0 && (
                            <div>
                              <span className="text-[10px] font-bold text-slate-700 uppercase">
                                Extracted Code Artifacts ({ctx.rawCodeBlocks.length}):
                              </span>
                              <div className="space-y-1.5 mt-1 max-h-[160px] overflow-y-auto">
                                {ctx.rawCodeBlocks.map((block, i) => (
                                  <div
                                    key={i}
                                    className="p-2 rounded bg-white border border-slate-200 font-mono text-[9px]">
                                    <div className="text-indigo-600 font-bold mb-0.5">
                                      {block.language || "text"} (Snippet {i + 1})
                                    </div>
                                    <pre className="whitespace-pre-wrap text-slate-700 line-clamp-3">
                                      {block.code}
                                    </pre>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 2: SETTINGS (CLEAN LOCAL-FIRST) */}
        {/* =================================================================== */}
        {activeTab === "settings" && (
          <div className="space-y-3">
            {/* Card 1: Automatic Long-Chat Ingestion */}
            <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center space-x-2">
                    <h2 className="text-xs font-bold text-slate-900">
                      Automatic Long-Chat Ingestion
                    </h2>
                    <span className="px-1.5 py-0.5 rounded-sm text-[9px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-300 uppercase">
                      50–100+ Messages
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                    Automatically sweeps and collects the complete conversation history from prompt 1
                    to the end on page load or reload. Zero manual scrolling or clicks needed!
                  </p>
                </div>

                <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-3">
                  <input
                    type="checkbox"
                    checked={autoImport}
                    onChange={(e) => setAutoImport(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>
            </div>

            {/* Card 2: Memory & Retention Preferences */}
            <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs p-4 space-y-3">
              <h2 className="text-xs font-bold text-slate-900">Context Memory & Auto-Expiry</h2>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Control how long inactive conversations remain stored in local memory before being
                automatically pruned. Pinned contexts are never pruned.
              </p>

              <div className="grid grid-cols-4 gap-2 pt-1">
                {[
                  { label: "24 Hours", hours: 24 },
                  { label: "3 Days", hours: 72 },
                  { label: "7 Days", hours: 168 },
                  { label: "Forever", hours: 0 }
                ].map((opt) => (
                  <button
                    key={opt.hours}
                    type="button"
                    onClick={() => setAutoExpiryHours(opt.hours)}
                    className={`py-1.5 text-xs font-semibold rounded-lg border text-center transition-all cursor-pointer ${
                      autoExpiryHours === opt.hours
                        ? "bg-indigo-50 border-indigo-400 text-indigo-700 shadow-2xs font-bold"
                        : "bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900"
                    }`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Card 3: Injection & Handover Preferences */}
            <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs p-4 space-y-3">
              <h2 className="text-xs font-bold text-slate-900">Injection & Handover Behavior</h2>

              <div className="flex items-center justify-between pt-1">
                <div>
                  <span className="text-xs font-semibold text-slate-800">
                    Auto-Focus Prompt Box
                  </span>
                  <p className="text-[10px] text-slate-500">
                    Automatically place cursor into the prompt box after injecting context.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={afterInjectAction === "focus"}
                  onChange={(e) => setAfterInjectAction(e.target.checked ? "focus" : "keep")}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer w-4 h-4"
                />
              </div>

              <div className="space-y-1 pt-2 border-t border-slate-100">
                <label className="text-[10px] font-semibold text-slate-700 uppercase">
                  Custom Engineering Persona Instruction
                </label>
                <input
                  type="text"
                  value={customStyle}
                  onChange={(e) => setCustomStyle(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div className="space-y-1 pt-1">
                <label className="text-[10px] font-semibold text-slate-700 uppercase">
                  Custom Handover Prompt Ending
                </label>
                <input
                  type="text"
                  value={customResume}
                  onChange={(e) => setCustomResume(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <button
                type="button"
                onClick={handleSaveSettings}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-lg shadow-xs transition-all cursor-pointer">
                Save Preferences
              </button>
            </div>

            {/* Card 4: 100% Local-First Privacy & Data Backup */}
            <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs p-4 space-y-3">
              <div className="flex items-center space-x-2">
                <span className="w-2 h-2 rounded-xs bg-emerald-500" />
                <h2 className="text-xs font-bold text-slate-900">
                  100% Local-First & Zero Telemetry
                </h2>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                All conversation texts, code snippets, and handover states remain strictly inside your
                browser's local storage. Zero network requests, zero external tokens, zero cost.
              </p>

              <div className="flex items-center space-x-2 pt-1">
                <button
                  type="button"
                  onClick={handleExportData}
                  className="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs rounded-lg border border-slate-200 transition-all cursor-pointer">
                  Export Contexts (.json)
                </button>
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="py-1.5 px-3 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold text-xs rounded-lg border border-rose-200 transition-all cursor-pointer">
                  Clear All Data
                </button>
              </div>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 3: DIAGNOSTICS */}
        {/* =================================================================== */}
        {activeTab === "diagnostics" && (
          <div className="space-y-3">
            {/* Active Tab Inspector Card */}
            <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold text-slate-900">Active Tab Inspector</h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-indigo-50 text-indigo-700 font-bold border border-indigo-200/60">
                  {activeTabInfo.platform}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                <div className="p-2 rounded bg-slate-50 border border-slate-200">
                  <span className="text-[10px] text-slate-500 block">Host:</span>
                  <span className="text-slate-800 font-semibold truncate block">
                    {activeTabHost || "No active tab"}
                  </span>
                </div>
                <div className="p-2 rounded bg-slate-50 border border-slate-200">
                  <span className="text-[10px] text-slate-500 block">Chat ID:</span>
                  <span className="text-slate-800 font-semibold truncate block">
                    {activeTabInfo.chatId || "none"}
                  </span>
                </div>
              </div>

              <div className="p-2.5 rounded bg-emerald-50/60 border border-emerald-200/70 text-[11px] text-emerald-900 space-y-1 font-mono">
                <div className="flex items-center justify-between">
                  <span>Eligible contexts for injection:</span>
                  <span className="font-bold">{contextDiagnostics.eligibleCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Excluded contexts (e.g. self/expired):</span>
                  <span>{contextDiagnostics.excludedCount}</span>
                </div>
              </div>
            </div>

            {/* Save Decision Timeline */}
            <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs p-4 space-y-2.5">
              <h2 className="text-xs font-bold text-slate-900">Save Decision Timeline</h2>
              <div className="max-h-[160px] overflow-y-auto space-y-1.5 font-mono text-[10px]">
                {saveTimeline.length === 0 ? (
                  <p className="text-slate-400 py-2 text-center">No save operations recorded yet.</p>
                ) : (
                  saveTimeline.slice(0, 10).map((rec, i) => (
                    <div
                      key={i}
                      className="p-1.5 rounded bg-slate-50 border border-slate-200 flex items-center justify-between">
                      <div className="flex items-center space-x-1.5">
                        <span
                          className={`w-1.5 h-1.5 rounded-xs ${
                            rec.decision === "saved" ? "bg-emerald-500" : "bg-slate-400"
                          }`}
                        />
                        <span className="font-semibold text-slate-800">{rec.chatKey}</span>
                        <span className="text-slate-500">({rec.reason})</span>
                      </div>
                      <span className="text-slate-400">{formatAge(rec.timestamp)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Collapsible DOM Investigator */}
            <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs p-4 space-y-2">
              <div
                onClick={() => setIsInvestigatorOpen(!isInvestigatorOpen)}
                className="flex items-center justify-between cursor-pointer">
                <h2 className="text-xs font-bold text-slate-900">Developer DOM Investigator</h2>
                <span className="text-xs text-indigo-600 font-semibold">
                  {isInvestigatorOpen ? "▲ Hide" : "▼ Show"}
                </span>
              </div>

              {isInvestigatorOpen && (
                <div className="space-y-3 pt-2 border-t border-slate-100">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-500 font-semibold uppercase">
                      Shadow Root Marker 1
                    </label>
                    <input
                      type="text"
                      value={marker1}
                      onChange={(e) => setMarker1(e.target.value)}
                      placeholder="zzmarker1"
                      className="w-full px-2.5 py-1 bg-slate-50 border border-slate-200 rounded text-xs font-mono"
                    />
                  </div>

                  <button
                    onClick={() => {
                      setIsGeneratingReport(true)
                      setSiteReportStatus("Generating site audit report...")
                      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                        const tab = tabs[0]
                        if (!tab?.id) {
                          setIsGeneratingReport(false)
                          setSiteReportStatus("No active tab.")
                          return
                        }
                        chrome.tabs.sendMessage(
                          tab.id,
                          {
                            type: "GENERATE_FULL_SITE_REPORT",
                            payload: { marker1 }
                          },
                          async (res) => {
                            setIsGeneratingReport(false)
                            if (res?.report) {
                              navigator.clipboard.writeText(res.report)
                              setSiteReportStatus("Report copied to clipboard!")
                            } else {
                              setSiteReportStatus("Failed to generate report from tab.")
                            }
                          }
                        )
                      })
                    }}
                    className="w-full py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-800 font-semibold text-xs rounded transition-all cursor-pointer">
                    {isGeneratingReport ? "Auditing Site..." : "Generate Full Site Audit Report"}
                  </button>

                  {siteReportStatus && (
                    <p className="text-[10px] font-mono text-indigo-600">{siteReportStatus}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 4: PLATFORM HEALTH */}
        {/* =================================================================== */}
        {activeTab === "health" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xs font-bold text-slate-900">Platform Adapters Health</h2>
                <p className="text-[10px] text-slate-500">Live DOM selector validation status</p>
              </div>
              <button
                type="button"
                onClick={runHealthCheck}
                className="px-2.5 py-1 text-xs font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/70 rounded-lg transition-all cursor-pointer">
                Re-check All
              </button>
            </div>

            <div className="space-y-2">
              {healthReports.length === 0 ? (
                <p className="text-xs text-slate-400 py-4 text-center">Checking platforms...</p>
              ) : (
                healthReports.map((report) => (
                  <div
                    key={report.platform}
                    className="bg-white rounded-xl border border-slate-200/90 shadow-2xs p-3.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span
                          className={`w-2 h-2 rounded-xs ${
                            report.ok ? "bg-emerald-500" : "bg-amber-500"
                          }`}
                        />
                        <span className="text-xs font-bold text-slate-900 uppercase">
                          {report.platform}
                        </span>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                          report.ok
                            ? "bg-emerald-50 text-emerald-800 border-emerald-200/70"
                            : "bg-amber-50 text-amber-800 border-amber-200/70"
                        }`}>
                        {report.ok ? "Operational" : "Check Needed"}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-slate-600 pt-1 border-t border-slate-100">
                      <div>Input Box: {report.inputBoxFound ? "✓ Detected" : "✕ Not found"}</div>
                      <div>Message Parser: {report.messagesFound ? "✓ Verified" : "○ Idle / Ready"}</div>
                    </div>

                    {report.issues.length > 0 && (
                      <div className="p-2 rounded bg-amber-50/70 border border-amber-200/60 text-[10px] text-amber-900 font-mono space-y-0.5">
                        {report.issues.map((issue, idx) => (
                          <div key={idx}>• {issue}</div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </main>

      {/* ===== Footer ===== */}
      <footer className="bg-white/90 border-t border-slate-200/80 px-4 py-2 flex items-center justify-between text-[10px] text-slate-500 font-mono shrink-0">
        <span className="flex items-center space-x-1">
          <span className="w-1.5 h-1.5 rounded-xs bg-emerald-500" />
          <span>Local Engine Active</span>
        </span>
        <span>v1.0.0 • Context Bridge</span>
      </footer>
    </div>
  )
}
