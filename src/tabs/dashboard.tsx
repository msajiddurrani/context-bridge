import { useEffect, useMemo, useRef, useState } from "react"
import iconSrc from "data-base64:~assets/icon.png"
import type {
  InjectionDensityMode,
  InjectionFormat,
  MessageTurn,
  PlatformId,
  StoredContext,
  VerbatimCodeBlock
} from "../types"
import { computeContextMetrics } from "../utils/local-mode"
import { formatMarkdownHandoverExport } from "../utils/prompt-formatter"
import { buildPreviewInjectedText } from "../utils/prompt-preview"
import {
  cleanupExpiredContexts,
  clearAllData,
  deleteContext,
  getSettings,
  getStoredContexts,
  saveContext,
  togglePinContext
} from "../utils/storage-manager"
import "../style.css"

function formatAge(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp)
  const mins = Math.floor(elapsed / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function formatFullDate(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    })
  } catch {
    return "Unknown date"
  }
}

function downloadFile(filename: string, content: string, mimeType = "text/markdown;charset=utf-8") {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function getPlatformBadgeClasses(platform: PlatformId | string) {
  switch (platform.toLowerCase()) {
    case "claude":
      return "border-amber-300 bg-amber-50 text-amber-900"
    case "chatgpt":
      return "border-emerald-300 bg-emerald-50 text-emerald-900"
    case "gemini":
      return "border-blue-300 bg-blue-50 text-blue-900"
    default:
      return "border-slate-300 bg-slate-100 text-slate-800"
  }
}

export default function DashboardPage() {
  const [contexts, setContexts] = useState<StoredContext[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [platformFilter, setPlatformFilter] = useState<"all" | PlatformId>("all")
  const [pinnedOnly, setPinnedOnly] = useState(false)
  const [sortBy, setSortBy] = useState<"updated" | "exchanges" | "code" | "tokens">("updated")

  // Workspace View
  const [activeTab, setActiveTab] = useState<"prompt" | "code" | "transcript" | "state">("prompt")
  const [targetPlatform, setTargetPlatform] = useState<PlatformId>("chatgpt")
  const [densityMode, setDensityMode] = useState<InjectionDensityMode>("standard")
  const [promptFormat, setPromptFormat] = useState<InjectionFormat>("markdown")

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [copiedSnippetIndex, setCopiedSnippetIndex] = useState<number | null>(null)

  // Custom persona & endings from settings
  const [customStyle, setCustomStyle] = useState<string>("")
  const [customResume, setCustomResume] = useState<string>("")

  const fileInputRef = useRef<HTMLInputElement>(null)

  function showToast(msg: string) {
    setToastMessage(msg)
    setTimeout(() => {
      setToastMessage(null)
    }, 2800)
  }

  async function loadData() {
    const list = await getStoredContexts()
    setContexts(list)
    if (list.length > 0 && !selectedId) {
      setSelectedId(list[0].id)
    }

    const settings = await getSettings()
    setCustomStyle(settings.customStyle || "")
    setCustomResume(settings.customResume || "")
  }

  useEffect(() => {
    loadData()
  }, [])

  // Filtered and Sorted Contexts
  const filteredContexts = useMemo(() => {
    return contexts
      .filter((ctx) => {
        if (platformFilter !== "all" && ctx.sourcePlatform !== platformFilter) return false
        if (pinnedOnly && !ctx.isPinned) return false
        if (!searchQuery.trim()) return true

        const q = searchQuery.toLowerCase()
        const matchTitle = ctx.chatTitle.toLowerCase().includes(q)
        const matchObjective = ctx.stateMemory?.objective?.toLowerCase().includes(q)
        const matchWork = ctx.stateMemory?.currentWork?.toLowerCase().includes(q)
        const matchPlatform = ctx.sourcePlatform.toLowerCase().includes(q)
        const matchCode = ctx.rawCodeBlocks?.some((b) => b.code.toLowerCase().includes(q))
        return matchTitle || matchObjective || matchWork || matchPlatform || matchCode
      })
      .sort((a, b) => {
        if (sortBy === "updated") return (b.updatedAt || 0) - (a.updatedAt || 0)
        if (sortBy === "exchanges") {
          const countA = a.turns?.length || a.exchangeCount || 0
          const countB = b.turns?.length || b.exchangeCount || 0
          return countB - countA
        }
        if (sortBy === "code") {
          const codeA = a.rawCodeBlocks?.length || 0
          const codeB = b.rawCodeBlocks?.length || 0
          return codeB - codeA
        }
        if (sortBy === "tokens") {
          const tokA = a.stateMemory?.rawTokenEstimate || 0
          const tokB = b.stateMemory?.rawTokenEstimate || 0
          return tokB - tokA
        }
        return 0
      })
  }, [contexts, platformFilter, pinnedOnly, searchQuery, sortBy])

  // Active Selected Context
  const selectedContext = useMemo(() => {
    if (!selectedId) return filteredContexts[0] || null
    return contexts.find((c) => c.id === selectedId) || filteredContexts[0] || null
  }, [contexts, selectedId, filteredContexts])

  // Generated Handover Prompt
  const generatedPrompt = useMemo(() => {
    if (!selectedContext) return ""
    return buildPreviewInjectedText(
      selectedContext,
      targetPlatform,
      densityMode,
      promptFormat,
      {
        customStyle: customStyle || undefined,
        customResume: customResume || undefined
      }
    )
  }, [selectedContext, targetPlatform, densityMode, promptFormat, customStyle, customResume])

  // Summary Metrics
  const totalStats = useMemo(() => {
    let exchanges = 0
    let codeBlocks = 0
    let tokens = 0

    for (const ctx of contexts) {
      exchanges += ctx.turns?.length || ctx.exchangeCount || 0
      codeBlocks += ctx.rawCodeBlocks?.length || 0
      tokens +=
        ctx.stateMemory?.rawTokenEstimate ||
        computeContextMetrics(ctx.turns || [], ctx.rawCodeBlocks || [], ctx.chatTitle).tokenEstimate
    }

    return {
      chatsCount: contexts.length,
      exchanges,
      codeBlocks,
      tokens
    }
  }, [contexts])

  // Handlers
  async function handleTogglePin(id: string) {
    await togglePinContext(id)
    await loadData()
    showToast("Pin status updated")
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Are you sure you want to delete this conversation context from local storage?")) {
      return
    }
    await deleteContext(id)
    await loadData()
    showToast("Conversation deleted")
  }

  async function handlePruneExpired() {
    const res = await cleanupExpiredContexts()
    await loadData()
    showToast(`Pruned ${res.prunedCount} expired conversations (pinned kept safe)`)
  }

  async function handleClearAll() {
    if (
      !window.confirm(
        "WARNING: This will permanently delete ALL stored contexts and local history. Proceed?"
      )
    ) {
      return
    }
    await clearAllData()
    await loadData()
    showToast("All local memory contexts cleared")
  }

  function handleExportAll() {
    const exportData = {
      version: "1.0.0",
      exportedAt: new Date().toISOString(),
      contexts
    }
    const filename = `context-bridge-backup-${new Date().toISOString().slice(0, 10)}.json`
    downloadFile(filename, JSON.stringify(exportData, null, 2), "application/json")
    showToast("Exported all contexts backup (.json)")
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = async (evt) => {
      try {
        const text = evt.target?.result as string
        const parsed = JSON.parse(text)
        const items: StoredContext[] = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed.contexts)
          ? parsed.contexts
          : []

        if (items.length === 0) {
          showToast("No valid contexts found in file")
          return
        }

        for (const item of items) {
          if (item.id && item.chatTitle && item.sourcePlatform) {
            await saveContext(item)
          }
        }

        await loadData()
        showToast(`Successfully imported ${items.length} conversations!`)
      } catch {
        showToast("Failed to parse import file. Must be valid JSON.")
      }
    }
    reader.readAsText(file)
    e.target.value = ""
  }

  function handleCopyPrompt() {
    if (!generatedPrompt) return
    navigator.clipboard.writeText(generatedPrompt)
    showToast(`Copied Handover Prompt for ${targetPlatform.toUpperCase()}!`)
  }

  function handleDownloadMarkdown() {
    if (!selectedContext) return
    const md = formatMarkdownHandoverExport(selectedContext, customResume, customStyle)
    const sanitizedTitle = selectedContext.chatTitle
      .replace(/[^a-z0-9_-]/gi, "-")
      .toLowerCase()
      .slice(0, 40)
    const filename = `context-bridge-${selectedContext.sourcePlatform}-${sanitizedTitle || "session"}.md`
    downloadFile(filename, md, "text/markdown;charset=utf-8")
    showToast(`Downloaded ${filename}`)
  }

  function handleCopySnippet(code: string, idx: number) {
    navigator.clipboard.writeText(code)
    setCopiedSnippetIndex(idx)
    showToast(`Copied snippet #${idx + 1}`)
    setTimeout(() => setCopiedSnippetIndex(null), 2000)
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans flex flex-col select-none">
      {/* Hidden File Input for Import */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImportFile}
        accept=".json"
        className="hidden"
      />

      {/* ===== Toast Notification Banner ===== */}
      {toastMessage && (
        <div className="fixed top-4 right-6 z-50 bg-indigo-600 text-white text-xs font-semibold px-4 py-2 rounded-sm shadow-xl border border-indigo-700 flex items-center space-x-2 animate-fade-in font-mono">
          <span>✓</span>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ===== Top Studio Masthead ===== */}
      <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between shrink-0 sticky top-0 z-40 shadow-2xs">
        <div className="flex items-center space-x-3.5">
          <img
            src={iconSrc}
            alt="Context Bridge"
            className="w-8 h-8 rounded-sm border border-slate-200 shadow-2xs object-cover"
          />
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-base font-bold text-slate-900 tracking-tight leading-none">
                Context Bridge Studio
              </h1>
              <span className="px-1.5 py-0.5 rounded-sm text-[9px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-300 uppercase">
                Local-First Memory Hub
              </span>
              <span className="px-1.5 py-0.5 rounded-sm text-[9px] font-mono font-bold bg-emerald-50 text-emerald-800 border border-emerald-300 uppercase flex items-center space-x-1">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-xs" />
                <span>Zero Telemetry</span>
              </span>
            </div>
            <p className="text-[11px] text-slate-500 font-medium leading-none mt-1">
              Cross-platform bidirectional LLM session synchronization & context handover
            </p>
          </div>
        </div>

        {/* Global Key Metrics Badges */}
        <div className="hidden lg:flex items-center space-x-2 font-mono text-[10px]">
          <div className="bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-sm">
            <span className="text-slate-400 uppercase mr-1.5">Conversations:</span>
            <span className="font-bold text-slate-900">{totalStats.chatsCount}</span>
          </div>
          <div className="bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-sm">
            <span className="text-slate-400 uppercase mr-1.5">Exchanges:</span>
            <span className="font-bold text-slate-900">{totalStats.exchanges}</span>
          </div>
          <div className="bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-sm">
            <span className="text-slate-400 uppercase mr-1.5">Code Artifacts:</span>
            <span className="font-bold text-indigo-600">{totalStats.codeBlocks}</span>
          </div>
          <div className="bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-sm">
            <span className="text-slate-400 uppercase mr-1.5">Saved Tokens:</span>
            <span className="font-bold text-slate-900">~{totalStats.tokens.toLocaleString()}</span>
          </div>
        </div>

        {/* Studio Action Toolbar */}
        <div className="flex items-center space-x-2 text-xs font-mono">
          <button
            type="button"
            onClick={loadData}
            className="px-2.5 py-1 rounded-sm bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 font-semibold cursor-pointer transition-all"
            title="Reload storage data">
            🔄 Refresh
          </button>
          <button
            type="button"
            onClick={handleExportAll}
            className="px-2.5 py-1 rounded-sm bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 font-semibold cursor-pointer transition-all"
            title="Export all stored conversations to a JSON backup">
            📥 Export All (.json)
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-2.5 py-1 rounded-sm bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 font-semibold cursor-pointer transition-all"
            title="Import conversations from a JSON backup">
            📤 Import
          </button>
          <button
            type="button"
            onClick={handlePruneExpired}
            className="px-2.5 py-1 rounded-sm bg-slate-100 hover:bg-slate-200 border border-slate-200 text-slate-700 font-semibold cursor-pointer transition-all"
            title="Prune expired conversations based on retention window">
            🧹 Prune Expired
          </button>
          <button
            type="button"
            onClick={handleClearAll}
            className="px-2 py-1 rounded-sm bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 font-semibold cursor-pointer transition-all"
            title="Permanently clear all data">
            Clear All
          </button>
        </div>
      </header>

      {/* ===== Main Split Workspace ===== */}
      <div className="flex-1 flex overflow-hidden">
        {/* =================================================================== */}
        {/* LEFT PANEL: Conversation Navigator & Filters (~380px) */}
        {/* =================================================================== */}
        <aside className="w-[380px] lg:w-[420px] bg-white border-r border-slate-200 flex flex-col shrink-0">
          {/* Search Bar */}
          <div className="p-3 border-b border-slate-200 space-y-2">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search chats, objectives, or code..."
                className="w-full bg-slate-50 border border-slate-200 rounded-sm px-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white transition-all font-mono"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1.5 text-slate-400 hover:text-slate-600 text-xs">
                  ✕
                </button>
              )}
            </div>

            {/* Platform Filter Buttons */}
            <div className="flex items-center space-x-1">
              {(["all", "claude", "chatgpt", "gemini"] as const).map((plat) => {
                const count =
                  plat === "all"
                    ? contexts.length
                    : contexts.filter((c) => c.sourcePlatform === plat).length

                return (
                  <button
                    key={plat}
                    type="button"
                    onClick={() => setPlatformFilter(plat)}
                    className={`flex-1 py-1 text-[10px] font-mono uppercase font-bold rounded-sm border transition-all cursor-pointer ${
                      platformFilter === plat
                        ? "bg-slate-900 border-slate-900 text-white shadow-2xs"
                        : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    }`}>
                    {plat} ({count})
                  </button>
                )
              })}
            </div>

            {/* Sub-Filters: Pinned Only & Sort Dropdown */}
            <div className="flex items-center justify-between text-[10px] font-mono pt-1 text-slate-600">
              <label className="flex items-center space-x-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={pinnedOnly}
                  onChange={(e) => setPinnedOnly(e.target.checked)}
                  className="rounded-xs border-slate-300 text-indigo-600 focus:ring-0 cursor-pointer"
                />
                <span className="font-semibold">📌 Pinned Only</span>
              </label>

              <div className="flex items-center space-x-1">
                <span className="text-slate-400">Sort:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="bg-slate-50 border border-slate-200 rounded-sm px-1.5 py-0.5 text-[10px] text-slate-700 font-mono cursor-pointer focus:outline-none">
                  <option value="updated">Newest First</option>
                  <option value="exchanges">Most Exchanges</option>
                  <option value="code">Most Code Snippets</option>
                  <option value="tokens">Largest Token Size</option>
                </select>
              </div>
            </div>
          </div>

          {/* Conversation List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {filteredContexts.length === 0 ? (
              <div className="p-8 text-center space-y-2 text-slate-400">
                <div className="text-2xl">💬</div>
                <p className="text-xs font-semibold text-slate-700">No conversations found</p>
                <p className="text-[11px] text-slate-500 max-w-xs mx-auto leading-relaxed">
                  {searchQuery
                    ? "Try adjusting your search query or platform filters."
                    : "Open ChatGPT, Claude, or Gemini in your browser to automatically capture context into local memory."}
                </p>
              </div>
            ) : (
              filteredContexts.map((ctx) => {
                const isSelected = selectedContext?.id === ctx.id
                const exchangeCount = ctx.turns?.length || ctx.exchangeCount || 0
                const codeCount = ctx.rawCodeBlocks?.length || 0
                const tokenEst =
                  ctx.stateMemory?.rawTokenEstimate ||
                  computeContextMetrics(ctx.turns || [], ctx.rawCodeBlocks || [], ctx.chatTitle)
                    .tokenEstimate
                const isPinned = ctx.isPinned

                return (
                  <article
                    key={ctx.id}
                    onClick={() => setSelectedId(ctx.id)}
                    className={`p-3.5 cursor-pointer transition-all select-none space-y-2 ${
                      isSelected
                        ? "bg-indigo-50/40 border-l-4 border-l-indigo-600"
                        : "hover:bg-slate-50 border-l-4 border-l-transparent"
                    }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-1.5">
                        <span
                          className={`px-1.5 py-0.5 rounded-sm text-[9px] font-mono font-bold uppercase border ${getPlatformBadgeClasses(
                            ctx.sourcePlatform
                          )}`}>
                          {ctx.sourcePlatform}
                        </span>

                        {isPinned && (
                          <span className="px-1.5 py-0.5 rounded-sm text-[9px] font-mono font-bold bg-amber-50 text-amber-900 border border-amber-300">
                            📌 Pinned
                          </span>
                        )}

                        <span className="text-[10px] font-mono text-slate-400">
                          {formatAge(ctx.updatedAt || ctx.createdAt)}
                        </span>
                      </div>

                      <div className="flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => handleTogglePin(ctx.id)}
                          className={`p-1 text-xs cursor-pointer transition-colors ${
                            isPinned ? "text-amber-500" : "text-slate-300 hover:text-amber-500"
                          }`}
                          title={isPinned ? "Unpin conversation" : "Pin conversation (never expires)"}>
                          📌
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(ctx.id)}
                          className="p-1 text-slate-300 hover:text-rose-500 text-xs cursor-pointer transition-colors"
                          title="Delete conversation">
                          ✕
                        </button>
                      </div>
                    </div>

                    <h2
                      className="text-xs font-bold text-slate-900 line-clamp-1 leading-snug"
                      title={ctx.chatTitle}>
                      {ctx.chatTitle || "Untitled Engineering Session"}
                    </h2>

                    <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">
                      {ctx.stateMemory?.objective ||
                        ctx.stateMemory?.currentWork ||
                        "Conversation transcript captured locally with zero cloud dependencies."}
                    </p>

                    <div className="flex items-center space-x-1.5 pt-1 text-[9px] font-mono text-slate-500">
                      <span className="px-1.5 py-0.5 rounded-sm bg-slate-100 border border-slate-200">
                        {exchangeCount} turns
                      </span>
                      {codeCount > 0 && (
                        <span className="px-1.5 py-0.5 rounded-sm bg-indigo-50 text-indigo-700 border border-indigo-200 font-bold">
                          {codeCount} code blocks
                        </span>
                      )}
                      <span className="text-slate-400">~{tokenEst.toLocaleString()} tok</span>
                    </div>
                  </article>
                )
              })
            )}
          </div>
        </aside>

        {/* =================================================================== */}
        {/* RIGHT PANEL: Studio Deep Inspection Workspace */}
        {/* =================================================================== */}
        <main className="flex-1 bg-slate-50 flex flex-col overflow-y-auto">
          {selectedContext ? (
            <div className="flex-1 flex flex-col p-6 space-y-4 max-w-6xl mx-auto w-full">
              {/* Workspace Header Card */}
              <div className="bg-white border border-slate-200 rounded-sm p-4 space-y-3 shadow-2xs">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span
                        className={`px-2 py-0.5 rounded-sm text-[10px] font-mono font-bold uppercase border ${getPlatformBadgeClasses(
                          selectedContext.sourcePlatform
                        )}`}>
                        {selectedContext.sourcePlatform}
                      </span>
                      <span className="px-1.5 py-0.5 rounded-sm text-[10px] font-mono font-semibold bg-slate-100 text-slate-700 border border-slate-300">
                        Chat ID: {selectedContext.chatId}
                      </span>
                      {selectedContext.isPinned && (
                        <span className="px-1.5 py-0.5 rounded-sm text-[10px] font-mono font-bold bg-amber-50 text-amber-900 border border-amber-300">
                          📌 Pinned
                        </span>
                      )}
                    </div>

                    <h1 className="text-base font-bold text-slate-900 leading-tight">
                      {selectedContext.chatTitle}
                    </h1>

                    <div className="flex items-center space-x-3 text-[11px] font-mono text-slate-400">
                      <span>Updated: {formatFullDate(selectedContext.updatedAt || selectedContext.createdAt)}</span>
                      {selectedContext.sourceUrl && (
                        <>
                          <span>•</span>
                          <a
                            href={selectedContext.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-indigo-600 hover:underline">
                            Open Original Tab ↗
                          </a>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Primary Handover Action Buttons */}
                  <div className="flex items-center space-x-2 shrink-0 font-mono text-xs">
                    <button
                      type="button"
                      onClick={handleCopyPrompt}
                      className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-sm shadow-xs transition-all cursor-pointer flex items-center space-x-1.5">
                      <span>⚡</span>
                      <span>Copy Handover Prompt</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadMarkdown}
                      className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-semibold rounded-sm transition-all cursor-pointer"
                      title="Download clean Markdown export">
                      📥 Download .md
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTogglePin(selectedContext.id)}
                      className="px-2.5 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-semibold rounded-sm transition-all cursor-pointer"
                      title={selectedContext.isPinned ? "Unpin context" : "Pin context"}>
                      {selectedContext.isPinned ? "📌 Pinned" : "📌 Pin"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(selectedContext.id)}
                      className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 font-semibold rounded-sm transition-all cursor-pointer"
                      title="Delete context">
                      ✕ Delete
                    </button>
                  </div>
                </div>

                {/* Workspace Navigation Tabs */}
                <div className="flex items-center space-x-1 border-t border-slate-100 pt-3">
                  {[
                    { id: "prompt", label: "⚡ Handover Prompt", badge: null },
                    {
                      id: "code",
                      label: "💻 Code Artifacts",
                      badge: selectedContext.rawCodeBlocks?.length || 0
                    },
                    {
                      id: "transcript",
                      label: "💬 Chronological Transcript",
                      badge: selectedContext.turns?.length || 0
                    },
                    { id: "state", label: "📊 Technical State", badge: null }
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id as any)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-sm transition-all cursor-pointer flex items-center space-x-1.5 ${
                        activeTab === tab.id
                          ? "bg-slate-900 text-white font-bold shadow-2xs"
                          : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                      }`}>
                      <span>{tab.label}</span>
                      {tab.badge !== null && tab.badge > 0 && (
                        <span
                          className={`px-1.5 py-0.2 rounded-sm text-[10px] font-mono font-bold ${
                            activeTab === tab.id
                              ? "bg-slate-800 text-slate-200"
                              : "bg-slate-200 text-slate-700"
                          }`}>
                          {tab.badge}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* ============================================================= */}
              {/* VIEW 1: LIVE HANDOVER PROMPT GENERATOR */}
              {/* ============================================================= */}
              {activeTab === "prompt" && (
                <div className="bg-white border border-slate-200 rounded-sm p-4 space-y-4 shadow-2xs flex-1 flex flex-col">
                  {/* Prompt Configuration Toolbar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
                    {/* Target Platform Selector */}
                    <div className="flex items-center space-x-2">
                      <span className="text-[10px] font-mono uppercase font-bold text-slate-500">
                        Target AI Platform:
                      </span>
                      {(["chatgpt", "claude", "gemini"] as const).map((plat) => (
                        <button
                          key={plat}
                          type="button"
                          onClick={() => setTargetPlatform(plat)}
                          className={`px-2.5 py-1 text-xs font-mono uppercase font-bold rounded-sm border transition-all cursor-pointer ${
                            targetPlatform === plat
                              ? "bg-indigo-600 border-indigo-600 text-white shadow-2xs"
                              : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                          }`}>
                          {plat}
                        </button>
                      ))}
                    </div>

                    {/* Density & Format Selectors */}
                    <div className="flex items-center space-x-3 text-xs font-mono">
                      <div className="flex items-center space-x-1">
                        <span className="text-[10px] text-slate-400 uppercase">Density:</span>
                        <select
                          value={densityMode}
                          onChange={(e) => setDensityMode(e.target.value as any)}
                          className="bg-slate-50 border border-slate-200 rounded-sm px-2 py-1 text-xs text-slate-700 cursor-pointer focus:outline-none">
                          <option value="standard">Standard (Smart Summary)</option>
                          <option value="compact">Compact (Token Saver)</option>
                          <option value="smart">Smart Outline</option>
                          <option value="complete">Complete History (100% Verbatim)</option>
                        </select>
                      </div>

                      <div className="flex items-center space-x-1">
                        <span className="text-[10px] text-slate-400 uppercase">Format:</span>
                        <select
                          value={promptFormat}
                          onChange={(e) => setPromptFormat(e.target.value as any)}
                          className="bg-slate-50 border border-slate-200 rounded-sm px-2 py-1 text-xs text-slate-700 cursor-pointer focus:outline-none">
                          <option value="markdown">Markdown</option>
                          <option value="xml">XML Tags</option>
                        </select>
                      </div>

                      <button
                        type="button"
                        onClick={handleCopyPrompt}
                        className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-sm shadow-2xs transition-all cursor-pointer">
                        Copy Prompt
                      </button>
                    </div>
                  </div>

                  {/* Informational Guidance */}
                  <div className="p-2.5 rounded-sm bg-slate-50 border border-slate-200 text-[11px] text-slate-600 font-mono leading-relaxed flex items-center justify-between">
                    <div>
                      💡 Paste this prompt into a fresh <strong>{targetPlatform.toUpperCase()}</strong> chat.
                      The model will resume your technical session with zero loss of architecture or code blocks!
                    </div>
                    <span className="text-slate-400 font-semibold shrink-0 ml-2">
                      ~{Math.round(generatedPrompt.length / 4)} tokens
                    </span>
                  </div>

                  {/* Monospace Prompt Preview Container */}
                  <div className="relative flex-1 min-h-[360px] bg-slate-900 border border-slate-800 rounded-sm overflow-hidden flex flex-col">
                    <div className="bg-slate-950 px-3 py-1.5 border-b border-slate-800 flex items-center justify-between text-[10px] font-mono text-slate-400">
                      <span>Injected Handover String Preview</span>
                      <button
                        type="button"
                        onClick={handleCopyPrompt}
                        className="text-indigo-400 hover:text-indigo-300 font-bold cursor-pointer">
                        Copy to Clipboard ↗
                      </button>
                    </div>
                    <pre className="flex-1 p-4 text-[11px] font-mono leading-relaxed text-slate-200 overflow-y-auto whitespace-pre-wrap select-text font-normal">
                      {generatedPrompt}
                    </pre>
                  </div>
                </div>
              )}

              {/* ============================================================= */}
              {/* VIEW 2: CODE ARTIFACTS GALLERY */}
              {/* ============================================================= */}
              {activeTab === "code" && (
                <div className="bg-white border border-slate-200 rounded-sm p-4 space-y-4 shadow-2xs">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <div>
                      <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                        Extracted Code Artifacts ({selectedContext.rawCodeBlocks?.length || 0})
                      </h2>
                      <p className="text-[11px] text-slate-500">
                        Verbatim snippets extracted from conversation turns. Preserved exactly as generated.
                      </p>
                    </div>
                  </div>

                  {!selectedContext.rawCodeBlocks || selectedContext.rawCodeBlocks.length === 0 ? (
                    <div className="p-8 text-center border border-dashed border-slate-200 rounded-sm text-slate-400 space-y-2">
                      <div className="text-xl">💻</div>
                      <p className="text-xs font-semibold text-slate-700">No code artifacts captured</p>
                      <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                        This conversation does not contain markdown code blocks or snippets.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {selectedContext.rawCodeBlocks.map((block: VerbatimCodeBlock, idx: number) => {
                        const lineCount = block.code.split("\n").length

                        return (
                          <div
                            key={idx}
                            className="border border-slate-200 rounded-sm overflow-hidden bg-slate-900 text-slate-100">
                            {/* Code Header Bar */}
                            <div className="bg-slate-950 px-3 py-1.5 border-b border-slate-800 flex items-center justify-between text-[10px] font-mono">
                              <div className="flex items-center space-x-2">
                                <span className="px-1.5 py-0.5 rounded-sm bg-indigo-900/60 text-indigo-300 border border-indigo-700 font-bold uppercase">
                                  {block.language || "text"}
                                </span>
                                <span className="text-slate-400 font-semibold">
                                  Snippet #{idx + 1} • {lineCount} lines
                                </span>
                              </div>

                              <button
                                type="button"
                                onClick={() => handleCopySnippet(block.code, idx)}
                                className="px-2 py-0.5 rounded-sm bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-all cursor-pointer shadow-2xs">
                                {copiedSnippetIndex === idx ? "✓ Copied!" : "Copy Code"}
                              </button>
                            </div>

                            {/* Verbatim Code Body */}
                            <pre className="p-3.5 text-xs font-mono leading-relaxed overflow-x-auto whitespace-pre select-text text-slate-200">
                              <code>{block.code}</code>
                            </pre>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ============================================================= */}
              {/* VIEW 3: CHRONOLOGICAL TRANSCRIPT */}
              {/* ============================================================= */}
              {activeTab === "transcript" && (
                <div className="bg-white border border-slate-200 rounded-sm p-4 space-y-4 shadow-2xs">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                    <div>
                      <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                        Turn History ({selectedContext.turns?.length || 0} messages)
                      </h2>
                      <p className="text-[11px] text-slate-500">
                        Chronological sequence of prompt requests and model responses.
                      </p>
                    </div>
                  </div>

                  {!selectedContext.turns || selectedContext.turns.length === 0 ? (
                    <div className="p-8 text-center border border-dashed border-slate-200 rounded-sm text-slate-400 space-y-2">
                      <div className="text-xl">💬</div>
                      <p className="text-xs font-semibold text-slate-700">No message turns stored</p>
                      <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                        This conversation may have been recorded with distilled state memory only.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {selectedContext.turns.map((turn: MessageTurn, idx: number) => {
                        const isUser = turn.role === "user"

                        return (
                          <div
                            key={turn.id || idx}
                            className={`p-3.5 rounded-sm border space-y-2 select-text ${
                              isUser
                                ? "bg-slate-50 border-slate-200"
                                : "bg-white border-slate-200 shadow-2xs"
                            }`}>
                            <div className="flex items-center justify-between">
                              <span
                                className={`px-1.5 py-0.5 rounded-sm text-[9px] font-mono font-bold uppercase border ${
                                  isUser
                                    ? "bg-slate-200 text-slate-800 border-slate-300"
                                    : "bg-indigo-50 text-indigo-700 border-indigo-200"
                                }`}>
                                Turn {idx + 1} • {isUser ? "User Prompt" : "Assistant"}
                              </span>
                              {turn.id && (
                                <span className="text-[9px] font-mono text-slate-400">
                                  ID: {turn.id}
                                </span>
                              )}
                            </div>

                            <p className="text-xs text-slate-800 whitespace-pre-wrap leading-relaxed font-sans">
                              {turn.text}
                            </p>

                            {turn.codeBlocks && turn.codeBlocks.length > 0 && (
                              <div className="space-y-1.5 pt-1">
                                {turn.codeBlocks.map((cb, cIdx) => (
                                  <div
                                    key={cIdx}
                                    className="p-2 rounded-sm bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-200">
                                    <div className="text-indigo-400 text-[9px] uppercase font-bold mb-1">
                                      {cb.language || "code"}
                                    </div>
                                    <pre className="whitespace-pre-wrap overflow-x-auto text-slate-300">
                                      {cb.code}
                                    </pre>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ============================================================= */}
              {/* VIEW 4: TECHNICAL STATE MATRIX */}
              {/* ============================================================= */}
              {activeTab === "state" && (
                <div className="bg-white border border-slate-200 rounded-sm p-4 space-y-4 shadow-2xs">
                  <div className="border-b border-slate-100 pb-2">
                    <h2 className="text-xs font-bold text-slate-900 uppercase tracking-wide">
                      Technical State Matrix
                    </h2>
                    <p className="text-[11px] text-slate-500">
                      Distilled architectural memory preserved across LLM contexts.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Objective */}
                    <div className="p-3.5 rounded-sm bg-slate-50 border border-slate-200 space-y-1">
                      <span className="text-[10px] font-mono font-bold text-slate-500 uppercase">
                        Core Objective:
                      </span>
                      <p className="text-xs text-slate-800 leading-relaxed font-medium">
                        {selectedContext.stateMemory?.objective || "No explicit objective defined."}
                      </p>
                    </div>

                    {/* Current Work */}
                    <div className="p-3.5 rounded-sm bg-slate-50 border border-slate-200 space-y-1">
                      <span className="text-[10px] font-mono font-bold text-slate-500 uppercase">
                        Current Work / Status:
                      </span>
                      <p className="text-xs text-slate-800 leading-relaxed font-medium">
                        {selectedContext.stateMemory?.currentWork || "In progress technical session."}
                      </p>
                    </div>

                    {/* Decisions Made */}
                    <div className="p-3.5 rounded-sm bg-slate-50 border border-slate-200 space-y-1">
                      <span className="text-[10px] font-mono font-bold text-slate-500 uppercase">
                        Architecture Decisions:
                      </span>
                      {selectedContext.stateMemory?.architectureDecisions &&
                      selectedContext.stateMemory.architectureDecisions.length > 0 ? (
                        <ul className="list-disc list-inside text-xs text-slate-700 space-y-1 pt-1 font-mono">
                          {selectedContext.stateMemory.architectureDecisions.map((dec, i) => (
                            <li key={i}>{dec}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-slate-500 italic">No explicit architectural decisions recorded.</p>
                      )}
                    </div>

                    {/* Next Steps */}
                    <div className="p-3.5 rounded-sm bg-slate-50 border border-slate-200 space-y-1">
                      <span className="text-[10px] font-mono font-bold text-slate-500 uppercase">
                        Next Steps / Blockers:
                      </span>
                      {selectedContext.stateMemory?.nextSteps &&
                      selectedContext.stateMemory.nextSteps.length > 0 ? (
                        <ul className="list-disc list-inside text-xs text-slate-700 space-y-1 pt-1 font-mono">
                          {selectedContext.stateMemory.nextSteps.map((step, i) => (
                            <li key={i}>{step}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-slate-500 italic">Ready to continue next prompt.</p>
                      )}
                    </div>
                  </div>

                  {/* Metadata Audit Box */}
                  <div className="p-3.5 rounded-sm bg-slate-100 border border-slate-200 space-y-2 font-mono text-[10px] text-slate-600">
                    <span className="font-bold text-slate-800 uppercase block">Storage Metadata Audit:</span>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <div>Storage ID: <span className="text-slate-900 font-semibold">{selectedContext.id}</span></div>
                      <div>Chat ID: <span className="text-slate-900 font-semibold">{selectedContext.chatId}</span></div>
                      <div>Source: <span className="text-slate-900 font-semibold uppercase">{selectedContext.sourcePlatform}</span></div>
                      <div>Pinned: <span className="text-slate-900 font-semibold">{selectedContext.isPinned ? "True" : "False"}</span></div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center p-12">
              <div className="max-w-md text-center space-y-3">
                <div className="w-12 h-12 mx-auto rounded-sm bg-slate-100 border border-slate-200 flex items-center justify-center text-xl text-slate-600">
                  🌉
                </div>
                <h2 className="text-sm font-bold text-slate-900">No Conversation Selected</h2>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Select a captured conversation from the left sidebar to inspect code artifacts,
                  view transcripts, and generate instant cross-platform handover prompts.
                </p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
