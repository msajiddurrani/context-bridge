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
import { computeConversationStatistics } from "./utils/local-mode"
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

function IconCheck({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}

function IconCopy({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  )
}

function IconExternal({ className = "w-3 h-3" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  )
}

export default function IndexPopup() {
  const [activeTab, setActiveTab] = useState<"contexts" | "settings">("contexts")
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

  // Copy Feedback State
  const [copiedContextId, setCopiedContextId] = useState<string | null>(null)
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

  // Advanced Developer Section inside Settings (collapsed by default)
  const [showDevDiagnostics, setShowDevDiagnostics] = useState(false)
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

  const handleQuickCopyPrompt = async (ctx: StoredContext) => {
    const target: PlatformId = ctx.sourcePlatform === "claude" ? "chatgpt" : "claude"
    const text = buildPreviewInjectedText(ctx, target, "smart", "markdown", {
      customStyle,
      customResume
    })
    try {
      await navigator.clipboard.writeText(text)
      setCopiedContextId(ctx.id)
      setStatusMessage("✓ Copied! Paste into another AI chat (Ctrl+V)")
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
    if (confirm("Reset extension to factory default? All saved conversations will be cleared.")) {
      await resetAllExtensionData()
      await loadData(false)
      setStatusMessage("Extension reset to factory defaults.")
      setTimeout(() => setStatusMessage(""), 2500)
    }
  }

  const handleClearAll = async () => {
    if (confirm("Are you sure you want to clear all saved conversations?")) {
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
    setStatusMessage("Exported conversation backup (.json)!")
    setTimeout(() => setStatusMessage(""), 2500)
  }

  const openDashboardTab = (chatId?: string) => {
    chrome.tabs.create({ url: chrome.runtime.getURL("tabs/dashboard.html") })
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
    <div className="w-[410px] max-h-[540px] flex flex-col bg-slate-50 text-slate-800 font-sans select-none overflow-hidden border border-slate-200/90 shadow-2xl">
      {/* ===== Header ===== */}
      <header className="bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-4 py-3 flex items-center justify-between shrink-0 shadow-2xs">
        <div className="flex items-center space-x-2.5">
          <img
            src={iconSrc}
            alt="Context Bridge"
            className="w-6 h-6 object-contain shrink-0"
          />
          <div>
            <h1 className="text-xs font-extrabold text-slate-900 tracking-tight leading-none">
              Context Bridge
            </h1>
            <span className="text-[10px] text-slate-400 font-medium leading-none block mt-0.5">
              Sync chats across AIs
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => openDashboardTab()}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 active:scale-95 text-white font-bold text-xs transition-all cursor-pointer shadow-xs hover:shadow"
          title="Open full-screen dashboard in a new tab">
          <span>Dashboard</span>
          <IconExternal className="w-3.5 h-3.5 text-slate-300" />
        </button>
      </header>

      {/* ===== Status Toast ===== */}
      {statusMessage && (
        <div className="bg-indigo-600 text-white text-xs px-3.5 py-2 font-semibold flex items-center justify-between shadow-sm animate-fade-in shrink-0">
          <div className="flex items-center space-x-2">
            <IconCheck className="w-4 h-4 text-white" />
            <span>{statusMessage}</span>
          </div>
          <button
            onClick={() => setStatusMessage("")}
            className="text-white/80 hover:text-white p-0.5 ml-2 cursor-pointer transition-colors"
            title="Dismiss">
            <IconClose className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ===== Segmented Navigation (Simple & Focused) ===== */}
      <nav className="bg-slate-200/70 p-1 rounded-xl flex items-center space-x-1 mx-3.5 mt-3 mb-2 shrink-0 text-xs font-semibold">
        <button
          onClick={() => setActiveTab("contexts")}
          className={`flex-1 py-1.5 px-3 rounded-lg transition-all flex items-center justify-center space-x-1.5 cursor-pointer ${
            activeTab === "contexts"
              ? "bg-white text-slate-900 shadow-xs font-bold"
              : "text-slate-600 hover:text-slate-900 hover:bg-white/40"
          }`}>
          <span>Saved Chats</span>
          {contexts.length > 0 && (
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                activeTab === "contexts"
                  ? "bg-indigo-50 text-indigo-700"
                  : "bg-slate-300/80 text-slate-700"
              }`}>
              {contexts.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("settings")}
          className={`flex-1 py-1.5 px-3 rounded-lg transition-all cursor-pointer text-center ${
            activeTab === "settings"
              ? "bg-white text-slate-900 shadow-xs font-bold"
              : "text-slate-600 hover:text-slate-900 hover:bg-white/40"
          }`}>
          Settings
        </button>
      </nav>

      {/* ===== Main Content Area ===== */}
      <main className="flex-1 overflow-y-auto px-3.5 pb-3 space-y-2.5">
        {/* =================================================================== */}
        {/* TAB 1: SAVED CHATS */}
        {/* =================================================================== */}
        {activeTab === "contexts" && (
          <div className="space-y-2.5">
            {/* Search & Platform Filter Toolbar */}
            <div className="flex items-center space-x-1.5">
              <div className="relative flex-1">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search chats..."
                  className="w-full bg-white border border-slate-200/90 rounded-xl px-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-all shadow-2xs font-sans"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 transition-colors">
                    <IconClose className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Platform Selector */}
              <div className="flex items-center space-x-0.5 shrink-0 bg-slate-100 p-0.5 rounded-xl border border-slate-200">
                {(["all", "claude", "chatgpt", "gemini"] as const).map((plat) => (
                  <button
                    key={plat}
                    onClick={() => setPlatformFilter(plat)}
                    className={`px-2 py-1 text-[10px] font-bold rounded-lg uppercase transition-all cursor-pointer ${
                      platformFilter === plat
                        ? "bg-white text-indigo-700 shadow-2xs border border-slate-200/80"
                        : "text-slate-600 hover:text-slate-900"
                    }`}>
                    {plat === "chatgpt" ? "GPT" : plat}
                  </button>
                ))}
              </div>
            </div>

            {/* Context Cards List */}
            {filteredContexts.length === 0 ? (
              <div className="bg-white border border-dashed border-slate-200 rounded-2xl p-6 text-center space-y-2.5">
                <div className="w-10 h-10 mx-auto rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400">
                  <IconMessageSquare className="w-5 h-5" />
                </div>
                <h3 className="text-xs font-bold text-slate-800">
                  {searchQuery ? "No matching chats found" : "No chats saved yet"}
                </h3>
                <p className="text-[11px] text-slate-500 max-w-xs mx-auto leading-relaxed">
                  Open ChatGPT, Claude, or Gemini in your browser. Context Bridge automatically
                  saves your conversations here!
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {filteredContexts.map((ctx) => {
                  const stats =
                    ctx.statistics ||
                    computeConversationStatistics(ctx.turns || [], ctx.rawCodeBlocks || [], ctx.completeness)
                  const messageCount = stats.messageCount
                  const isPinned = ctx.isPinned
                  const isCopied = copiedContextId === ctx.id

                  const platBadge =
                    ctx.sourcePlatform === "claude"
                      ? { label: "Claude", color: "bg-amber-50 text-amber-900 border-amber-200" }
                      : ctx.sourcePlatform === "chatgpt"
                      ? { label: "ChatGPT", color: "bg-slate-100 text-slate-800 border-slate-300" }
                      : { label: "Gemini", color: "bg-blue-50 text-blue-900 border-blue-200" }

                  return (
                    <article
                      key={ctx.id}
                      className="bg-white rounded-2xl border border-slate-200/80 hover:border-slate-300 shadow-2xs hover:shadow-xs transition-all p-3.5 space-y-2.5">
                      {/* Card Header: Platform + Title + Age + Quick Actions */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2 min-w-0">
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-bold border shrink-0 ${platBadge.color}`}>
                            {platBadge.label}
                          </span>

                          <h2
                            className="text-xs font-bold text-slate-900 truncate max-w-[170px]"
                            title={ctx.chatTitle}>
                            {ctx.chatTitle}
                          </h2>
                        </div>

                        <div className="flex items-center space-x-1.5 text-[11px] text-slate-400 font-medium shrink-0">
                          {isPinned && (
                            <span className="px-1.5 py-0.2 rounded bg-amber-50 text-amber-800 border border-amber-200 inline-flex items-center">
                              <IconPin className="w-2.5 h-2.5 text-amber-600" filled={true} />
                            </span>
                          )}
                          <span>{formatAge(ctx.updatedAt)}</span>
                          <button
                            type="button"
                            onClick={() => handleTogglePin(ctx.id)}
                            className={`p-1 rounded-md hover:bg-slate-100 transition-colors cursor-pointer ${
                              isPinned ? "text-amber-500" : "text-slate-400 hover:text-amber-500"
                            }`}
                            title={isPinned ? "Unpin chat" : "Pin chat"}>
                            <IconPin className="w-3.5 h-3.5" filled={isPinned} />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteContext(ctx.id)}
                            className="text-slate-400 hover:text-rose-600 p-1 rounded-md hover:bg-rose-50 cursor-pointer transition-colors"
                            title="Delete chat">
                            <IconClose className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Conversation Snippet: Clean User & AI previews */}
                      {ctx.turns && ctx.turns.length > 0 && (
                        <div className="bg-slate-50/80 border border-slate-200/60 rounded-xl p-2.5 text-xs space-y-1.5 font-sans">
                          {(() => {
                            const userTurns = ctx.turns.filter((t) => t.role === "user")
                            const lastUser = userTurns[userTurns.length - 1]
                            const assistantTurns = ctx.turns.filter((t) => t.role === "assistant")
                            const lastAssistant = assistantTurns[assistantTurns.length - 1]

                            return (
                              <>
                                {lastUser && (
                                  <div className="flex items-start space-x-1.5 min-w-0">
                                    <span className="font-bold text-slate-700 shrink-0 text-[11px]">You:</span>
                                    <p className="text-slate-800 text-[11px] line-clamp-1 leading-snug flex-1" title={lastUser.text}>
                                      {lastUser.text}
                                    </p>
                                  </div>
                                )}
                                {lastAssistant && (
                                  <div className="flex items-start space-x-1.5 min-w-0 pt-1 border-t border-slate-200/50">
                                    <span className="font-bold text-indigo-600 shrink-0 text-[11px]">AI:</span>
                                    <p className="text-slate-600 text-[11px] line-clamp-1 leading-snug flex-1" title={lastAssistant.text}>
                                      {lastAssistant.text}
                                    </p>
                                  </div>
                                )}
                              </>
                            )
                          })()}
                        </div>
                      )}

                      {/* Card Action Bar (Bold, Premium & Tactile) */}
                      <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-xs">
                        <span className="text-slate-500 font-semibold text-[11px]">
                          {messageCount} {messageCount === 1 ? "message" : "messages"}
                        </span>

                        <div className="flex items-center space-x-2">
                          {/* Hero Action: Bold Premium Copy Button */}
                          <button
                            type="button"
                            onClick={() => handleQuickCopyPrompt(ctx)}
                            className={`px-3.5 py-1.5 rounded-xl font-bold text-xs transition-all cursor-pointer flex items-center space-x-1.5 active:scale-95 shadow-xs hover:shadow ${
                              isCopied
                                ? "bg-emerald-600 text-white"
                                : "bg-indigo-600 hover:bg-indigo-700 text-white"
                            }`}
                            title="Copy prompt formatted to paste into another AI">
                            {isCopied ? (
                              <>
                                <IconCheck className="w-3.5 h-3.5" />
                                <span>Copied!</span>
                              </>
                            ) : (
                              <>
                                <IconCopy className="w-3.5 h-3.5" />
                                <span>Copy for AI</span>
                              </>
                            )}
                          </button>

                          {/* Secondary: Open in Dashboard */}
                          <button
                            type="button"
                            onClick={() => openDashboardTab(ctx.id)}
                            className="px-2.5 py-1.5 rounded-xl font-semibold text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer flex items-center space-x-1"
                            title="View full conversation in Dashboard">
                            <span>Open</span>
                            <IconExternal className="w-3 h-3 text-slate-500" />
                          </button>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* =================================================================== */}
        {/* TAB 2: SETTINGS (SIMPLE, CLEAN & ACCESSIBLE) */}
        {/* =================================================================== */}
        {activeTab === "settings" && (
          <div className="space-y-3">
            {/* Auto-Save Toggle */}
            <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-4 flex items-center justify-between">
              <div>
                <h2 className="text-xs font-bold text-slate-900">
                  Automatically Save Chats
                </h2>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                  Saves your conversations from ChatGPT, Claude, and Gemini in local memory.
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

            {/* Retention Selector */}
            <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-4 space-y-2.5">
              <h2 className="text-xs font-bold text-slate-900">Keep Inactive Chats For</h2>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: "24h", hours: 24 },
                  { label: "3 Days", hours: 72 },
                  { label: "7 Days", hours: 168 },
                  { label: "Forever", hours: 0 }
                ].map((opt) => (
                  <button
                    key={opt.hours}
                    type="button"
                    onClick={() => setAutoExpiryHours(opt.hours)}
                    className={`py-1.5 text-xs font-semibold rounded-xl border text-center transition-all cursor-pointer ${
                      autoExpiryHours === opt.hours
                        ? "bg-indigo-50 border-indigo-400 text-indigo-700 shadow-2xs font-bold"
                        : "bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900"
                    }`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Data Management Actions */}
            <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-4 space-y-3">
              <h2 className="text-xs font-bold text-slate-900">Data & Backup</h2>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                All data is stored 100% locally on your computer. You can export a backup or clear history anytime.
              </p>

              <div className="flex items-center space-x-2 pt-1">
                <button
                  type="button"
                  onClick={handleExportData}
                  className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-xl border border-slate-200 transition-all cursor-pointer">
                  Export Backup (.json)
                </button>
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="py-2 px-3.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs rounded-xl border border-rose-200 transition-all cursor-pointer">
                  Clear All
                </button>
              </div>
            </div>

            {/* Collapsible Diagnostics & Developer Tools */}
            <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-4 space-y-2.5">
              <div
                onClick={() => setShowDevDiagnostics(!showDevDiagnostics)}
                className="flex items-center justify-between cursor-pointer select-none">
                <h2 className="text-xs font-bold text-slate-700">Developer Diagnostics</h2>
                <span className="text-xs font-bold text-indigo-600">
                  {showDevDiagnostics ? "▲ Hide" : "▼ Show"}
                </span>
              </div>

              {showDevDiagnostics && (
                <div className="space-y-3 pt-2 border-t border-slate-100 text-xs">
                  <div className="flex items-center justify-between text-slate-600">
                    <span>Active Platform:</span>
                    <span className="font-bold font-mono text-slate-800 uppercase">
                      {activeTabInfo.platform}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-600">
                    <span>Chat ID:</span>
                    <span className="font-mono text-slate-800 truncate max-w-[180px]">
                      {activeTabInfo.chatId || "none"}
                    </span>
                  </div>

                  <div className="pt-2 flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={runHealthCheck}
                      className="flex-1 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-[11px] rounded-lg border border-slate-200 transition-all">
                      Check Adapters
                    </button>
                    <button
                      type="button"
                      onClick={handleResetAll}
                      className="py-1.5 px-3 bg-rose-50 hover:bg-rose-100 text-rose-700 font-semibold text-[11px] rounded-lg border border-rose-200 transition-all">
                      Factory Reset
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* ===== Footer ===== */}
      <footer className="bg-white/90 border-t border-slate-200/80 px-4 py-2.5 flex items-center justify-between text-[11px] text-slate-500 font-sans shrink-0">
        <span>Context Bridge Active</span>
        <button
          type="button"
          onClick={() => openDashboardTab()}
          className="text-indigo-600 hover:text-indigo-800 font-bold hover:underline cursor-pointer">
          Open Full Studio ↗
        </button>
      </footer>
    </div>
  )
}
