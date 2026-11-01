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
  resetAllExtensionData,
  deleteContext,
  getInjectedRecords,
  getSaveTimeline,
  getSettings,
  getStoredContexts,
  saveSettings,
  togglePinContext
} from "./utils/storage-manager"
import { diagnoseContexts, isGenericOrNewChatId } from "./utils/context-filter"
import { computeContextMetrics, computeConversationStatistics } from "./utils/local-mode"
import { isGenericFillerText } from "./utils/prompt-formatter"
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

function IconMessageSquare({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  )
}

function IconPin({ className = "w-3 h-3", filled = false }: { className?: string; filled?: boolean }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="17" x2="12" y2="22" />
      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
    </svg>
  )
}

function IconClose({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
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
    const text = buildPreviewInjectedText(ctx, target, "smart", "markdown", {
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

    const handleResetAll = async () => {
    if (confirm("FACTORY RESET: Wipe ALL conversations and reset settings to fresh install defaults?")) {
      await resetAllExtensionData()
      await loadData(false)
      setStatusMessage("Extension reset to factory defaults.")
      setTimeout(() => setStatusMessage(""), 2500)
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
    <div className="w-[410px] max-h-[500px] flex flex-col bg-slate-50 text-slate-800 font-sans select-none overflow-hidden border border-slate-200/90 shadow-2xl">
      {/* ===== Header ===== */}
      <header className="bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-3.5 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-2">
          <img
            src={iconSrc}
            alt="Context Bridge"
            className="w-5 h-5 object-contain shrink-0"
          />
          <h1 className="text-xs font-bold text-slate-900 tracking-tight leading-none">
            Context Bridge
          </h1>
        </div>

        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => {
              chrome.tabs.create({ url: chrome.runtime.getURL("tabs/dashboard.html") })
            }}
            className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-[11px] transition-all cursor-pointer shadow-2xs"
            title="Open full-screen dashboard in a new tab">
            <span>Dashboard</span>
            <span className="text-xs">↗</span>
          </button>
        </div>
      </header>

      {/* ===== Status Toast ===== */}
      {statusMessage && (
        <div className="bg-indigo-600 text-white text-xs px-3.5 py-1.5 font-medium flex items-center justify-between shadow-sm animate-fade-in shrink-0">
          <span>{statusMessage}</span>
          <button
            onClick={() => setStatusMessage("")}
            className="text-white/80 hover:text-white p-0.5 ml-2 cursor-pointer transition-colors"
            title="Dismiss">
            <IconClose className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* ===== Segmented Tab Navigation ===== */}
      <nav className="bg-slate-100 p-0.5 rounded-md flex items-center space-x-1 border border-slate-200 mx-3 mt-2.5 mb-2 shrink-0 text-xs font-medium">
        <button
          onClick={() => setActiveTab("contexts")}
          className={`flex-1 py-1 px-1.5 rounded-sm transition-all flex items-center justify-center space-x-1 cursor-pointer ${
            activeTab === "contexts"
              ? "bg-white text-indigo-700 shadow-2xs border border-slate-200 font-bold"
              : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
          }`}>
          <span className="text-[11px]">Chats</span>
          {contexts.length > 0 && (
            <span
              className={`px-1 py-0.2 rounded-sm text-[9px] font-mono font-bold ${
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
          className={`flex-1 py-1 px-1.5 rounded-sm text-[11px] transition-all cursor-pointer ${
            activeTab === "settings"
              ? "bg-white text-indigo-700 shadow-2xs border border-slate-200 font-bold"
              : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
          }`}>
          Settings
        </button>

        <button
          onClick={() => setActiveTab("diagnostics")}
          className={`flex-1 py-1 px-1.5 rounded-sm text-[11px] transition-all cursor-pointer ${
            activeTab === "diagnostics"
              ? "bg-white text-indigo-700 shadow-2xs border border-slate-200 font-bold"
              : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
          }`}>
          Status
        </button>

        <button
          onClick={() => setActiveTab("health")}
          className={`flex-1 py-1 px-1.5 rounded-sm text-[11px] transition-all cursor-pointer ${
            activeTab === "health"
              ? "bg-white text-indigo-700 shadow-2xs border border-slate-200 font-bold"
              : "text-slate-600 hover:text-slate-900 hover:bg-white/50"
          }`}>
          Connections
        </button>
      </nav>

      {/* ===== Main Content Area ===== */}
      <main className="flex-1 overflow-y-auto px-3 pb-3 space-y-2.5">
        {/* =================================================================== */}
        {/* TAB 1: CONTEXTS */}
        {/* =================================================================== */}
        {activeTab === "contexts" && (
          <div className="space-y-2.5">
            {/* Search & Filter Toolbar */}
            <div className="flex items-center space-x-1.5">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search chats, code..."
                  className="w-full bg-white border border-slate-200/90 rounded-md px-2.5 py-1 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-100 transition-all shadow-2xs"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2 top-1.5 text-slate-400 hover:text-slate-600 transition-colors">
                    <IconClose className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Platform Filter Chips */}
              <div className="flex items-center space-x-0.5 shrink-0 bg-slate-100 p-0.5 rounded-md border border-slate-200">
                {(["all", "claude", "chatgpt", "gemini"] as const).map((plat) => (
                  <button
                    key={plat}
                    onClick={() => setPlatformFilter(plat)}
                    className={`px-1.5 py-0.5 text-[9px] font-mono font-semibold rounded-sm uppercase transition-all cursor-pointer ${
                      platformFilter === plat
                        ? "bg-white text-indigo-700 shadow-2xs font-bold border border-slate-200"
                        : "text-slate-600 hover:text-slate-900"
                    }`}>
                    {plat === "chatgpt" ? "GPT" : plat}
                  </button>
                ))}
              </div>

              {/* Clear All Button */}
              {contexts.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="px-2 py-1 text-[10px] font-semibold text-rose-600 hover:text-white hover:bg-rose-600 bg-rose-50 border border-rose-200 rounded-md transition-all cursor-pointer shrink-0"
                  title="Clear all stored conversation contexts">
                  Clear All
                </button>
              )}
            </div>

            {/* Context Cards List */}
            {filteredContexts.length === 0 ? (
              <div className="bg-white border border-dashed border-slate-200 rounded-lg p-6 text-center space-y-2">
                <div className="w-8 h-8 mx-auto rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500">
                  <IconMessageSquare className="w-4 h-4" />
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
                  const stats =
                    ctx.statistics ||
                    computeConversationStatistics(ctx.turns || [], ctx.rawCodeBlocks || [], ctx.completeness)
                  const exchangeCount = stats.exchangeCount
                  const messageCount = stats.messageCount
                  const codeCount = stats.codeBlockCount
                  const wordCount = stats.wordCount
                  const isPinned = ctx.isPinned

                  const platBadgeColor =
                    ctx.sourcePlatform === "claude"
                      ? "bg-amber-50 text-amber-900 border-amber-300/80"
                      : ctx.sourcePlatform === "chatgpt"
                      ? "bg-slate-100 text-slate-800 border-slate-300"
                      : "bg-blue-50 text-blue-900 border-blue-300/80"

                  return (
                    <article
                      key={ctx.id}
                      className="bg-white rounded-xl border border-slate-200 hover:border-indigo-300 shadow-2xs hover:shadow-xs transition-all p-3 space-y-2">
                      {/* Card Header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-1.5 min-w-0">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase border shrink-0 ${platBadgeColor}`}>
                            {ctx.sourcePlatform === "chatgpt" ? "ChatGPT" : ctx.sourcePlatform}
                          </span>

                          <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold bg-slate-100 text-slate-700 border border-slate-200 shrink-0">
                            {ctx.isImported ? "100% History" : "Local Sync"}
                          </span>

                          <h2
                            className="text-xs font-semibold text-slate-900 truncate max-w-[125px]"
                            title={ctx.chatTitle}>
                            {ctx.chatTitle}
                          </h2>
                        </div>

                        <div className="flex items-center space-x-1 text-[10px] text-slate-500 font-mono shrink-0">
                          {isPinned && (
                            <span className="px-1 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200/70 inline-flex items-center">
                              <IconPin className="w-2.5 h-2.5 text-amber-600" filled={true} />
                            </span>
                          )}
                          <span>{formatAge(ctx.updatedAt)}</span>
                          <button
                            onClick={() => handleTogglePin(ctx.id)}
                            className={`p-1 rounded hover:bg-slate-100 transition-colors cursor-pointer ${
                              isPinned ? "text-amber-500" : "text-slate-400 hover:text-amber-500"
                            }`}
                            title={isPinned ? "Unpin context" : "Pin context (never expires)"}>
                            <IconPin className="w-3 h-3" filled={isPinned} />
                          </button>
                          <button
                            onClick={() => handleDeleteContext(ctx.id)}
                            className="text-slate-400 hover:text-rose-500 p-1 rounded hover:bg-slate-100 cursor-pointer transition-colors"
                            title="Delete context">
                            <IconClose className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      {/* Short 1-line Goal & Details at the start */}
                      {(() => {
                        const goalText = ctx.stateMemory?.objective || ctx.chatTitle
                        if (!goalText || isGenericFillerText(goalText)) return null
                        return (
                          <div className="bg-indigo-50/50 border border-indigo-100/80 rounded-md px-2.5 py-1 text-xs flex items-center space-x-1.5 min-w-0">
                            <span className="text-[10px] font-bold text-indigo-900 uppercase tracking-wide shrink-0">
                              Goal:
                            </span>
                            <p className="text-slate-800 font-medium text-[11px] truncate flex-1" title={goalText}>
                              {goalText}
                            </p>
                          </div>
                        )
                      })()}

                      {/* Clean 1-line prompt & answer details */}
                      {ctx.turns && ctx.turns.length > 0 && (
                        <div className="bg-slate-50 border border-slate-200/80 rounded-md px-2.5 py-1.5 text-xs space-y-1 font-sans">
                          {(() => {
                            const userTurns = ctx.turns.filter((t) => t.role === "user")
                            const lastUser = userTurns[userTurns.length - 1]
                            const assistantTurns = ctx.turns.filter((t) => t.role === "assistant")
                            const lastAssistant = assistantTurns[assistantTurns.length - 1]

                            return (
                              <>
                                {lastUser && (
                                  <div className="flex items-center space-x-1.5 min-w-0">
                                    <span className="font-bold text-slate-700 shrink-0 text-[10px]">Prompt:</span>
                                    <p className="text-slate-800 text-[11px] truncate flex-1" title={lastUser.text}>
                                      {lastUser.text}
                                    </p>
                                  </div>
                                )}
                                {lastAssistant && (
                                  <div className="flex items-center space-x-1.5 min-w-0 pt-0.5 border-t border-slate-200/50">
                                    <span className="font-bold text-indigo-600 shrink-0 text-[10px]">AI:</span>
                                    <p className="text-slate-600 text-[11px] truncate flex-1" title={lastAssistant.text}>
                                      {lastAssistant.text}
                                    </p>
                                  </div>
                                )}
                              </>
                            )
                          })()}
                        </div>
                      )}

                      {/* Card Meta & Action Bar */}
                      <div className="flex flex-wrap items-center justify-between gap-1 pt-1.5 border-t border-slate-100 text-[10px] font-mono text-slate-500">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[9px]">
                            {exchangeCount} {exchangeCount === 1 ? "exchange" : "exchanges"}
                          </span>
                          <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[9px]">
                            {messageCount} {messageCount === 1 ? "message" : "messages"}
                          </span>
                          {codeCount > 0 && (
                            <span className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[9px] font-semibold">
                              {codeCount} code
                            </span>
                          )}
                          <span className="text-[9px]">~{wordCount.toLocaleString()} words</span>
                          {ctx.completeness === "viewport_only" && (
                            <span className="bg-amber-50 text-amber-700 border border-amber-200 px-1 py-0.2 rounded text-[8px] font-semibold">
                              Viewport
                            </span>
                          )}
                        </div>

                        <div className="flex items-center space-x-1 font-sans">
                          <button
                            onClick={() => handleQuickCopyPrompt(ctx)}
                            className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200/70 transition-all cursor-pointer"
                            title="Copy prompt formatted for another AI">
                            {copiedContextId === ctx.id ? "Copied!" : "Copy for AI"}
                          </button>
                          <button
                            onClick={() => handleOpenPreview(ctx)}
                            className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all cursor-pointer">
                            {previewContextId === ctx.id ? "Hide" : "Preview"}
                          </button>
                          <button
                            onClick={() =>
                              setSelectedContext(selectedContext?.id === ctx.id ? null : ctx)
                            }
                            className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all cursor-pointer">
                            {selectedContext?.id === ctx.id ? "Hide Chat" : "View Chat"}
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
                              {copiedPreview ? "Copied!" : "Copy Prompt"}
                            </button>
                          </div>

                          <pre className="text-[10px] font-mono leading-relaxed whitespace-pre-wrap max-h-[220px] overflow-y-auto p-2.5 rounded-lg bg-white border border-slate-200/90 text-slate-800 select-text">
                            {previewText}
                          </pre>
                        </div>
                      )}

                      {/* Detailed Full Chat View Modal */}
                      {selectedContext?.id === ctx.id && (
                        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2 mt-2">
                          <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
                            <span className="font-bold text-slate-800">Full Conversation</span>
                            <span className="text-slate-500 font-mono text-[10px]">
                              {ctx.turns?.length || 0} messages
                            </span>
                          </div>

                          <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                            {ctx.turns && ctx.turns.length > 0 ? (
                              ctx.turns.map((turn, tIdx) => (
                                <div
                                  key={turn.id || tIdx}
                                  className={`p-2.5 rounded-lg border text-xs space-y-1 select-text ${
                                    turn.role === "user"
                                      ? "bg-white border-slate-200 text-slate-800"
                                      : "bg-indigo-50/40 border-indigo-100 text-slate-700"
                                  }`}>
                                  <span
                                    className={`text-[10px] font-bold uppercase tracking-wider block ${
                                      turn.role === "user" ? "text-slate-500" : "text-indigo-600"
                                    }`}>
                                    {turn.role === "user" ? "You" : "AI"}
                                  </span>
                                  <p className="whitespace-pre-wrap leading-relaxed font-sans">
                                    {turn.text}
                                  </p>
                                  {turn.codeBlocks && turn.codeBlocks.length > 0 && (
                                    <div className="space-y-1 pt-1">
                                      {turn.codeBlocks.map((cb, cIdx) => (
                                        <pre
                                          key={cIdx}
                                          className="p-2 rounded bg-slate-900 text-slate-100 font-mono text-[10px] overflow-x-auto whitespace-pre">
                                          <code>{cb.code}</code>
                                        </pre>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))
                            ) : (
                              <p className="text-slate-500 py-2">No messages stored for this chat.</p>
                            )}
                          </div>
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
                <h2 className="text-xs font-bold text-slate-900">
                  Private & Safe on Your Device
                </h2>
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed font-sans">
                All your chats, questions, and code remain stored strictly on your computer. Zero data is sent to external servers.
              </p>

              <div className="flex items-center space-x-2 pt-1">
                <button
                  type="button"
                  onClick={handleExportData}
                  className="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs rounded-lg border border-slate-200 transition-all cursor-pointer">
                  Export Backup (.json)
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
                <h2 className="text-xs font-bold text-slate-900">Current Tab Status</h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-slate-100 text-slate-700 font-bold border border-slate-200">
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

              <div className="p-2.5 rounded bg-slate-50 border border-slate-200 text-[11px] text-slate-800 space-y-1 font-sans">
                <div className="flex items-center justify-between">
                  <span>Available chats to import:</span>
                  <span className="font-bold">{contextDiagnostics.eligibleCount}</span>
                </div>
                <div className="flex items-center justify-between text-slate-500 text-[10px]">
                  <span>Excluded (current chat / expired):</span>
                  <span>{contextDiagnostics.excludedCount}</span>
                </div>
              </div>
            </div>

            {/* Save Decision Timeline */}
            <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs p-4 space-y-2.5">
              <h2 className="text-xs font-bold text-slate-900">Activity Log</h2>
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
                            rec.decision === "saved" ? "bg-slate-700" : "bg-slate-300"
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
                <h2 className="text-xs font-bold text-slate-900">Developer Tools</h2>
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
                <h2 className="text-xs font-bold text-slate-900">Platform Connections</h2>
                <p className="text-[10px] text-slate-500">Connection status with ChatGPT, Claude & Gemini</p>
              </div>
              <button
                type="button"
                onClick={runHealthCheck}
                className="px-2.5 py-1 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 rounded-lg transition-all cursor-pointer">
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
                        <span className="text-xs font-bold text-slate-900 uppercase">
                          {report.platform}
                        </span>
                      </div>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                          report.ok
                            ? "bg-slate-100 text-slate-800 border-slate-200"
                            : "bg-amber-50 text-amber-800 border-amber-200/70"
                        }`}>
                        {report.ok ? "Connected" : "Check Needed"}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[10px] font-mono text-slate-600 pt-1 border-t border-slate-100">
                      <div>Input Box: {report.inputBoxFound ? "Detected" : "Not found"}</div>
                      <div>Message Parser: {report.messagesFound ? "Verified" : "Ready"}</div>
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
      <footer className="bg-white/90 border-t border-slate-200/80 px-4 py-2 flex items-center justify-between text-[10px] text-slate-500 font-sans shrink-0">
        <span>Context Bridge Active</span>
        <span>v1.0.0</span>
      </footer>
    </div>
  )
}
