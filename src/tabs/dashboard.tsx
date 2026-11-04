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
import { validateImportedBackup } from "../utils/import-validator"
import { parseOfficialPlatformExport } from "../utils/official-export-importer"
import {
  computeConversationStatistics,
  extractSharedLinks,
  generateCleanSummary
} from "../utils/local-mode"
import { formatMarkdownHandoverExport } from "../utils/prompt-formatter"
import { buildPreviewInjectedText } from "../utils/prompt-preview"
import {
  clearAllData,
  cleanupGarbageContexts,
  deleteContext,
  getSettings,
  getStoredContexts,
  saveContext,
  togglePinContext
} from "../utils/storage-manager"
import "../style.css"

// ============================================================================
// CLEAN INLINE SVG ICONS (Premium, Sharp, Zero Toy/Robot Graphics)
// ============================================================================

function IconSearch({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  )
}

function IconDownload({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  )
}

function IconUpload({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
    </svg>
  )
}

function IconCopy({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  )
}

function IconCheck({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}

function IconTrash({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  )
}

function IconPin({ className = "w-4 h-4", filled = false }: { className?: string; filled?: boolean }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="17" x2="12" y2="22" />
      <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
    </svg>
  )
}

function IconExternalLink({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  )
}

function IconCode({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
    </svg>
  )
}

function IconMessageSquare({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
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

function IconDocumentText({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  )
}

function IconLayers({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  )
}

function IconUser({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  )
}

function IconArrowsRightLeft({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
    </svg>
  )
}

function IconShield({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  )
}

// ============================================================================
// HELPER UTILITIES
// ============================================================================

function formatAge(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp)
  const mins = Math.floor(elapsed / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
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

function getPlatformBadge(platform: PlatformId | string) {
  const p = platform.toLowerCase()
  if (p === "claude") {
    return {
      name: "Claude",
      color: "bg-amber-50 text-amber-900 border-amber-200/80",
      dot: "bg-amber-600"
    }
  }
  if (p === "chatgpt") {
    return {
      name: "ChatGPT",
      color: "bg-slate-100 text-slate-800 border-slate-300",
      dot: "bg-slate-600"
    }
  }
  if (p === "gemini") {
    return {
      name: "Gemini",
      color: "bg-blue-50 text-blue-900 border-blue-200/80",
      dot: "bg-blue-600"
    }
  }
  return {
    name: platform.toUpperCase(),
    color: "bg-slate-100 text-slate-700 border-slate-200",
    dot: "bg-slate-500"
  }
}

// ============================================================================
// MAIN DASHBOARD COMPONENT
// ============================================================================

export default function DashboardPage() {
  const [contexts, setContexts] = useState<StoredContext[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [platformFilter, setPlatformFilter] = useState<"all" | PlatformId>("all")

  // Workspace View Tabs (Default to "transcript" so users immediately see conversation)
  const [activeTab, setActiveTab] = useState<"transcript" | "code" | "summary" | "handover">("transcript")
  const [targetPlatform, setTargetPlatform] = useState<PlatformId>("chatgpt")
  const [densityMode] = useState<InjectionDensityMode>("complete")
  const [promptFormat] = useState<InjectionFormat>("markdown")

  // Feedback State
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [copiedSnippetIndex, setCopiedSnippetIndex] = useState<number | null>(null)
  const [copiedPrompt, setCopiedPrompt] = useState(false)

  // Custom Preferences
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
    await cleanupGarbageContexts().catch(() => {})
    const list = await getStoredContexts()
    setContexts(list)
    setSelectedId((prev) => {
      if (prev && list.some((c) => c.id === prev)) {
        return prev
      }
      return list.length > 0 ? list[0].id : null
    })

    const settings = await getSettings()
    setCustomStyle(settings.customStyle || "")
    setCustomResume(settings.customResume || "")
  }

  useEffect(() => {
    document.title = "Context Bridge"
    try {
      let link = document.querySelector<HTMLLinkElement>("link[rel*='icon']")
      if (!link) {
        link = document.createElement("link")
        link.type = "image/png"
        link.rel = "shortcut icon"
        document.head.appendChild(link)
      }
      link.href = iconSrc
    } catch {}
    loadData()

    // Real-time reactive storage listener: instantly syncs the moment any turn is captured in background
    const onStorageChange = (_changes: any, areaName: string) => {
      if (areaName === "local") {
        loadData()
      }
    }
    if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(onStorageChange)
    }

    const interval = setInterval(loadData, 1500)

    return () => {
      if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
        chrome.storage.onChanged.removeListener(onStorageChange)
      }
      clearInterval(interval)
    }
  }, [])

  // Filtered and Sorted Contexts (Most recent on top by default)
  const filteredContexts = useMemo(() => {
    return contexts
      .filter((ctx) => {
        if (platformFilter !== "all" && ctx.sourcePlatform !== platformFilter) return false
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
        if (a.isPinned && !b.isPinned) return -1
        if (!a.isPinned && b.isPinned) return 1
        return (b.updatedAt || 0) - (a.updatedAt || 0)
      })
  }, [contexts, platformFilter, searchQuery])

  // Active Selected Context
  const selectedContext = useMemo(() => {
    if (selectedId) {
      const match = filteredContexts.find((c) => c.id === selectedId)
      if (match) return match
    }
    return filteredContexts[0] || null
  }, [filteredContexts, selectedId])

  // Keep selectedId in sync when platform or search filter shifts active context
  useEffect(() => {
    if (selectedContext && selectedContext.id !== selectedId) {
      setSelectedId(selectedContext.id)
    }
  }, [selectedContext?.id])

  // Set default target platform when context changes
  useEffect(() => {
    if (selectedContext) {
      if (selectedContext.sourcePlatform === "claude") {
        setTargetPlatform("chatgpt")
      } else if (selectedContext.sourcePlatform === "chatgpt") {
        setTargetPlatform("claude")
      } else {
        setTargetPlatform("claude")
      }
    }
  }, [selectedContext?.id])

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

  // Handlers
  async function handleTogglePin(id: string) {
    await togglePinContext(id)
    await loadData()
    showToast("Chat pinned status updated")
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this conversation from saved history?")) {
      return
    }
    await deleteContext(id)
    if (selectedId === id) {
      setSelectedId(null)
    }
    await loadData()
    showToast("Conversation deleted")
  }

  async function handleClearAll() {
    if (!window.confirm("Permanently delete ALL saved conversations?")) {
      return
    }
    await clearAllData()
    setSelectedId(null)
    await loadData()
    showToast("All saved conversations cleared")
  }

  function handleExportAll() {
    const exportData = {
      version: "1.0.0",
      exportedAt: new Date().toISOString(),
      contexts
    }
    const filename = `context-bridge-backup-${new Date().toISOString().slice(0, 10)}.json`
    downloadFile(filename, JSON.stringify(exportData, null, 2), "application/json")
    showToast("Exported backup file (.json)")
  }

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = async (evt) => {
      try {
        const text = evt.target?.result as string
        const parsed = JSON.parse(text)

        const validation = validateImportedBackup(parsed)
        if (validation.valid && validation.contexts.length > 0) {
          for (const item of validation.contexts) {
            await saveContext(item)
          }
          await loadData()
          showToast(`Imported ${validation.contexts.length} conversations from backup!`)
          return
        }

        const official = parseOfficialPlatformExport(text)
        if (official.success && official.conversations.length > 0) {
          for (const item of official.conversations) {
            await saveContext(item)
          }
          await loadData()
          showToast(
            `Imported ${official.conversations.length} official ${official.platform.toUpperCase()} conversations!`
          )
          return
        }

        showToast(official.error || validation.error || "Failed to import: unrecognized JSON file")
      } catch (err: any) {
        showToast(`Import error: ${err?.message || "Invalid JSON file"}`)
      }
    }
    reader.readAsText(file)
    e.target.value = ""
  }

  function handleCopyPrompt(targetPlat?: PlatformId) {
    if (!selectedContext) return
    const plat = targetPlat || targetPlatform
    const text = buildPreviewInjectedText(
      selectedContext,
      plat,
      "complete",
      "markdown",
      {
        customStyle: customStyle || undefined,
        customResume: customResume || undefined
      }
    )
    navigator.clipboard.writeText(text)
    setCopiedPrompt(true)
    showToast(`✓ Context copied for ${plat === "chatgpt" ? "ChatGPT" : plat === "claude" ? "Claude" : "Gemini"}!`)
    setTimeout(() => setCopiedPrompt(false), 2500)
  }

  function handleDownloadMarkdown() {
    if (!selectedContext) return
    const md = formatMarkdownHandoverExport(selectedContext, customResume, customStyle)
    const sanitizedTitle = selectedContext.chatTitle
      .replace(/[^a-z0-9_-]/gi, "-")
      .toLowerCase()
      .slice(0, 40)
    const filename = `chat-${selectedContext.sourcePlatform}-${sanitizedTitle || "session"}.md`
    downloadFile(filename, md, "text/markdown;charset=utf-8")
    showToast(`Downloaded ${filename}`)
  }

  function handleCopySnippet(code: string, idx: number) {
    navigator.clipboard.writeText(code)
    setCopiedSnippetIndex(idx)
    showToast(`Copied code snippet #${idx + 1}`)
    setTimeout(() => setCopiedSnippetIndex(null), 2000)
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#F8FAFC] text-slate-800 font-sans flex flex-col antialiased select-none">
      {/* Hidden File Input for Import */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImportFile}
        accept=".json"
        className="hidden"
      />

      {/* ===== Floating Toast Notification ===== */}
      {toastMessage && (
        <div className="fixed top-5 right-6 z-50 bg-slate-900 text-white text-xs font-semibold px-4 py-3 rounded-xl shadow-2xl border border-slate-700/80 flex items-center space-x-2.5 animate-fade-in">
          <div className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
            <IconCheck className="w-3.5 h-3.5" />
          </div>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ===== Fixed Top App Navigation Header (Never Scrolls) ===== */}
      <header className="h-16 bg-white border-b border-slate-200/90 px-6 flex items-center justify-between shrink-0 z-30 shadow-2xs">
        {/* Left: Brand Identity */}
        <div className="flex items-center space-x-3">
          <img
            src={iconSrc}
            alt="Context Bridge"
            className="w-8 h-8 object-contain shrink-0"
          />
          <div>
            <h1 className="text-sm font-extrabold text-slate-900 tracking-tight leading-none">
              Context Bridge
            </h1>
            <span className="text-[11px] text-slate-400 font-medium leading-none block mt-1">
              Cross-Platform Conversation Sync
            </span>
          </div>
        </div>

        {/* Center: Clean Non-Technical Count Pill */}
        <div className="hidden md:flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-slate-100 border border-slate-200/80 text-xs text-slate-700 font-semibold">
          <span className="w-2 h-2 rounded-full bg-indigo-500" />
          <span>{contexts.length} Saved {contexts.length === 1 ? "Conversation" : "Conversations"}</span>
        </div>

        {/* Right: Clean, Bold Studio Actions */}
        <div className="flex items-center space-x-2.5 text-xs">
          <button
            type="button"
            onClick={handleExportAll}
            className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-bold transition-all cursor-pointer shadow-2xs hover:shadow-xs active:scale-95">
            <IconDownload className="w-4 h-4 text-slate-500" />
            <span>Export Backup</span>
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-bold transition-all cursor-pointer shadow-2xs hover:shadow-xs active:scale-95">
            <IconUpload className="w-4 h-4 text-slate-500" />
            <span>Import</span>
          </button>

          {contexts.length > 0 && (
            <button
              type="button"
              onClick={handleClearAll}
              className="flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold border border-rose-200/80 transition-all cursor-pointer active:scale-95">
              <IconTrash className="w-4 h-4" />
              <span>Clear All</span>
            </button>
          )}
        </div>
      </header>

      {/* ===== Main Split Workspace (Fixed Layout) ===== */}
      <div className="flex-1 flex overflow-hidden">
        {/* =================================================================== */}
        {/* LEFT SIDEBAR: Conversation Explorer (Only Card List Scrolls) */}
        {/* =================================================================== */}
        <aside className="w-[360px] lg:w-[400px] bg-white border-r border-slate-200/80 flex flex-col shrink-0 overflow-hidden">
          {/* Search & Filter Toolbar (Fixed at Top of Sidebar) */}
          <div className="p-4 border-b border-slate-200/80 space-y-3 shrink-0">
            {/* Search Bar */}
            <div className="relative">
              <IconSearch className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search conversations..."
                className="w-full bg-slate-50 hover:bg-slate-100/70 focus:bg-white border border-slate-200/80 focus:border-indigo-500 rounded-xl pl-9 pr-8 py-2.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all font-sans"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-3 text-slate-400 hover:text-slate-600 transition-colors">
                  <IconClose className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Platform Segmented Selector */}
            <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-xl border border-slate-200/80">
              {(["all", "claude", "chatgpt", "gemini"] as const).map((plat) => {
                const count =
                  plat === "all"
                    ? contexts.length
                    : contexts.filter((c) => c.sourcePlatform === plat).length

                const isSelected = platformFilter === plat

                return (
                  <button
                    key={plat}
                    type="button"
                    onClick={() => setPlatformFilter(plat)}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center justify-center space-x-1.5 capitalize ${
                      isSelected
                        ? "bg-white text-slate-900 shadow-xs border border-slate-200/80"
                        : "text-slate-600 hover:text-slate-900 hover:bg-white/40"
                    }`}>
                    <span>{plat === "chatgpt" ? "GPT" : plat}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-md font-mono ${
                        isSelected
                          ? "bg-indigo-50 text-indigo-700 font-bold"
                          : "bg-slate-200/80 text-slate-600 font-medium"
                      }`}>
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Conversation Cards List (Scrolls Internally) */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {filteredContexts.length === 0 ? (
              <div className="p-8 text-center space-y-3 text-slate-500">
                <div className="w-12 h-12 mx-auto rounded-2xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400">
                  <IconMessageSquare className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-xs font-bold text-slate-800">No conversations found</h3>
                  <p className="text-[11px] text-slate-500 max-w-xs mx-auto leading-relaxed">
                    {searchQuery
                      ? "No conversations match your search query."
                      : "Open ChatGPT, Claude, or Gemini in your browser to automatically save chats here."}
                  </p>
                </div>
              </div>
            ) : (
              filteredContexts.map((ctx) => {
                const isSelected = selectedContext?.id === ctx.id
                const stats =
                  ctx.statistics ||
                  computeConversationStatistics(ctx.turns || [], ctx.rawCodeBlocks || [], ctx.completeness)
                const messageCount = stats.messageCount
                const isPinned = ctx.isPinned
                const badge = getPlatformBadge(ctx.sourcePlatform)

                return (
                  <article
                    key={ctx.id}
                    onClick={() => setSelectedId(ctx.id)}
                    className={`p-4 rounded-2xl border transition-all cursor-pointer select-none space-y-3 ${
                      isSelected
                        ? "bg-indigo-50/50 border-indigo-400 ring-2 ring-indigo-200/60 shadow-xs"
                        : "bg-white hover:bg-slate-50 border-slate-200/80 hover:border-slate-300 shadow-2xs"
                    }`}>
                    {/* Card Top: Platform + Status + Actions */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span
                          className={`inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-md text-[10px] font-bold border ${badge.color}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                          <span>{badge.name}</span>
                        </span>

                        {isPinned && (
                          <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded-md flex items-center space-x-1">
                            <IconPin className="w-2.5 h-2.5" filled={true} />
                            <span>Pinned</span>
                          </span>
                        )}

                        <span className="text-[11px] text-slate-400 font-medium">
                          {formatAge(ctx.updatedAt || ctx.createdAt)}
                        </span>
                      </div>

                      {/* Quick Pin/Delete Buttons */}
                      <div
                        className="flex items-center space-x-1"
                        onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => handleTogglePin(ctx.id)}
                          className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                            isPinned
                              ? "text-amber-500 bg-amber-50"
                              : "text-slate-400 hover:text-amber-500 hover:bg-slate-100"
                          }`}
                          title={isPinned ? "Unpin chat" : "Pin chat"}>
                          <IconPin className="w-3.5 h-3.5" filled={isPinned} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(ctx.id)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                          title="Delete chat">
                          <IconTrash className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Chat Title */}
                    <h2
                      className={`text-xs font-bold leading-snug line-clamp-1 ${
                        isSelected ? "text-indigo-950 font-extrabold" : "text-slate-900"
                      }`}
                      title={ctx.chatTitle}>
                      {ctx.chatTitle || "Untitled Chat"}
                    </h2>

                    {/* Real Chat Preview: Prompt & Answer */}
                    {ctx.turns && ctx.turns.length > 0 && (
                      <div className="bg-slate-50/80 border border-slate-200/70 rounded-xl p-2.5 text-xs space-y-1.5 font-sans">
                        {(() => {
                          const userTurns = ctx.turns.filter((t) => t.role === "user")
                          const lastUser = userTurns[userTurns.length - 1]
                          const assistantTurns = ctx.turns.filter((t) => t.role === "assistant")
                          const lastAssistant = assistantTurns[assistantTurns.length - 1]

                          return (
                            <>
                              {lastUser && (
                                <div className="flex items-start space-x-1.5">
                                  <span className="font-bold text-slate-700 shrink-0 text-[11px]">You:</span>
                                  <p className="text-slate-800 line-clamp-1 leading-relaxed text-[11px] select-text">
                                    {lastUser.text}
                                  </p>
                                </div>
                              )}
                              {lastAssistant && (
                                <div className="flex items-start space-x-1.5 pt-1 border-t border-slate-200/60">
                                  <span className="font-bold text-indigo-600 shrink-0 text-[11px] capitalize">
                                    {badge.name}:
                                  </span>
                                  <p className="text-slate-600 line-clamp-1 leading-relaxed text-[11px] select-text">
                                    {lastAssistant.text}
                                  </p>
                                </div>
                              )}
                            </>
                          )
                        })()}
                      </div>
                    )}

                    {/* Card Meta Footer */}
                    <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-xs font-semibold text-slate-500">
                      <span>{messageCount} {messageCount === 1 ? "message" : "messages"}</span>
                      {stats.codeBlockCount > 0 && (
                        <span className="text-indigo-600 font-mono text-[11px] flex items-center space-x-1">
                          <IconCode className="w-3 h-3" />
                          <span>{stats.codeBlockCount} code</span>
                        </span>
                      )}
                    </div>
                  </article>
                )
              })
            )}
          </div>
        </aside>

        {/* =================================================================== */}
        {/* RIGHT WORKSPACE: Deep Inspection Canvas (Fixed Layout - Only Box Scrolls) */}
        {/* =================================================================== */}
        <main className="flex-1 bg-[#F8FAFC] flex flex-col overflow-hidden">
          {selectedContext ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* 1. FIXED CONVERSATION HEADER & TOOLBAR (NEVER SCROLLS) */}
              <div className="bg-white border-b border-slate-200/90 px-6 py-4 shrink-0 shadow-2xs z-20">
                <div className="max-w-5xl mx-auto space-y-3.5">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex items-center space-x-2">
                        {(() => {
                          const b = getPlatformBadge(selectedContext.sourcePlatform)
                          return (
                            <span
                              className={`inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-md text-[10px] font-bold border ${b.color}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${b.dot}`} />
                              <span>{b.name}</span>
                            </span>
                          )
                        })()}

                        {selectedContext.isPinned && (
                          <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md flex items-center space-x-1">
                            <IconPin className="w-2.5 h-2.5" filled={true} />
                            <span>Pinned</span>
                          </span>
                        )}

                        <span className="text-slate-300 text-xs">•</span>
                        <span className="text-xs text-slate-500 font-medium">
                          Saved {formatAge(selectedContext.updatedAt || selectedContext.createdAt)}
                        </span>

                        {selectedContext.sourceUrl && (
                          <>
                            <span className="text-slate-300 text-xs">•</span>
                            <a
                              href={selectedContext.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center space-x-1 text-indigo-600 hover:text-indigo-800 text-xs font-bold hover:underline">
                              <span>Open original</span>
                              <IconExternalLink className="w-3 h-3" />
                            </a>
                          </>
                        )}
                      </div>

                      <h1
                        className="text-lg font-extrabold text-slate-900 tracking-tight truncate"
                        title={selectedContext.chatTitle}>
                        {selectedContext.chatTitle || "Untitled Conversation"}
                      </h1>
                    </div>

                    {/* HERO ACTIONS: Premium Bold Buttons (Fixed at Top) */}
                    <div className="flex items-center space-x-2 shrink-0">
                      {/* Primary Transfer Context Button */}
                      <button
                        type="button"
                        onClick={() => handleCopyPrompt()}
                        className={`px-4 py-2.5 rounded-xl font-bold text-xs shadow-sm hover:shadow active:scale-95 transition-all cursor-pointer flex items-center space-x-2 ${
                          copiedPrompt
                            ? "bg-emerald-600 text-white"
                            : "bg-indigo-600 hover:bg-indigo-700 text-white"
                        }`}>
                        {copiedPrompt ? (
                          <>
                            <IconCheck className="w-4 h-4 text-white" />
                            <span>Copied Context!</span>
                          </>
                        ) : (
                          <>
                            <IconArrowsRightLeft className="w-4 h-4 text-indigo-200" />
                            <span>Transfer Context</span>
                          </>
                        )}
                      </button>

                      {/* Quick Platform Switcher */}
                      <div className="flex items-center space-x-0.5 bg-slate-100 p-0.5 rounded-xl border border-slate-200">
                        {(["chatgpt", "claude", "gemini"] as const).map((plat) => (
                          <button
                            key={plat}
                            type="button"
                            onClick={() => {
                              setTargetPlatform(plat)
                              handleCopyPrompt(plat)
                            }}
                            className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all cursor-pointer capitalize ${
                              targetPlatform === plat
                                ? "bg-white text-indigo-700 shadow-2xs border border-slate-200"
                                : "text-slate-600 hover:text-slate-900"
                            }`}
                            title={`Format context for ${plat}`}>
                            {plat === "chatgpt" ? "GPT" : plat}
                          </button>
                        ))}
                      </div>

                      {/* Download */}
                      <button
                        type="button"
                        onClick={handleDownloadMarkdown}
                        className="px-3 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-bold rounded-xl text-xs flex items-center space-x-1.5 shadow-2xs hover:shadow-xs active:scale-95 transition-all cursor-pointer"
                        title="Download Markdown">
                        <IconDownload className="w-3.5 h-3.5 text-slate-500" />
                        <span>Download</span>
                      </button>

                      {/* Pin */}
                      <button
                        type="button"
                        onClick={() => handleTogglePin(selectedContext.id)}
                        className={`p-2 rounded-xl border transition-all cursor-pointer ${
                          selectedContext.isPinned
                            ? "bg-amber-50 border-amber-200 text-amber-700"
                            : "bg-white hover:bg-slate-50 border-slate-200 text-slate-500"
                        }`}
                        title={selectedContext.isPinned ? "Unpin chat" : "Pin chat"}>
                        <IconPin className="w-3.5 h-3.5" filled={selectedContext.isPinned} />
                      </button>

                      {/* Delete */}
                      <button
                        type="button"
                        onClick={() => handleDelete(selectedContext.id)}
                        className="p-2 rounded-xl bg-white hover:bg-rose-50 border border-slate-200 hover:border-rose-200 text-slate-400 hover:text-rose-600 transition-all cursor-pointer"
                        title="Delete chat">
                        <IconTrash className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Navigation Tabs (Fixed at Top) */}
                  <div className="flex items-center space-x-1.5 pt-2 border-t border-slate-100">
                    {[
                      {
                        id: "transcript",
                        label: "Conversation",
                        icon: IconMessageSquare,
                        badge: selectedContext.turns?.length || 0
                      },
                      {
                        id: "code",
                        label: "Code Snippets",
                        icon: IconCode,
                        badge: selectedContext.rawCodeBlocks?.length || 0
                      },
                      { id: "summary", label: "Summary", icon: IconLayers, badge: null },
                      { id: "handover", label: "Exported Prompt", icon: IconDocumentText, badge: null }
                    ].map((tab) => {
                      const Icon = tab.icon
                      const isActive = activeTab === tab.id

                      return (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setActiveTab(tab.id as any)}
                          className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center space-x-2 ${
                            isActive
                              ? "bg-slate-900 text-white shadow-xs"
                              : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/80"
                          }`}>
                          <Icon className={`w-3.5 h-3.5 ${isActive ? "text-indigo-300" : "text-slate-400"}`} />
                          <span>{tab.label}</span>
                          {tab.badge !== null && tab.badge > 0 && (
                            <span
                              className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
                                isActive
                                  ? "bg-slate-800 text-slate-200"
                                  : "bg-slate-200 text-slate-700"
                              }`}>
                              {tab.badge}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* 2. THE DETAILS BOX (ONLY THIS SCROLLS INTERNALLY - PAGE REMAINS FIXED) */}
              <div className="flex-1 overflow-y-auto px-6 py-6">
                <div className="max-w-4xl mx-auto w-full space-y-4">
                  {/* TAB 1: CONVERSATION */}
                  {activeTab === "transcript" && (
                    <div className="space-y-4">
                      {!selectedContext.turns || selectedContext.turns.length === 0 ? (
                        <div className="p-12 text-center bg-white border border-dashed border-slate-200 rounded-2xl text-slate-400 space-y-2">
                          <IconMessageSquare className="w-8 h-8 mx-auto text-slate-300" />
                          <p className="text-xs font-bold text-slate-700">No messages recorded</p>
                          <p className="text-xs text-slate-500 max-w-sm mx-auto">
                            This conversation was saved without messages.
                          </p>
                        </div>
                      ) : (
                        selectedContext.turns.map((turn: MessageTurn, idx: number) => {
                          const isUser = turn.role === "user"
                          const platformBadge = getPlatformBadge(selectedContext.sourcePlatform)

                          return (
                            <div
                              key={turn.id || idx}
                              className={`p-5 rounded-2xl border select-text space-y-3 ${
                                isUser
                                  ? "bg-slate-50/90 border-slate-200/90"
                                  : "bg-white border-slate-200 shadow-2xs"
                              }`}>
                              {/* Message Header */}
                              <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-2.5">
                                  <div
                                    className={`w-7 h-7 rounded-xl flex items-center justify-center text-xs font-bold ${
                                      isUser
                                        ? "bg-slate-200 text-slate-700"
                                        : "bg-indigo-600 text-white shadow-2xs"
                                    }`}>
                                    {isUser ? (
                                      <IconUser className="w-4 h-4" />
                                    ) : (
                                      <span className="text-[11px] font-black uppercase">
                                        {platformBadge.name[0]}
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-xs font-bold text-slate-900">
                                    {isUser ? "You" : platformBadge.name}
                                  </span>
                                </div>

                                <span className="text-[11px] text-slate-400 font-mono">
                                  #{idx + 1}
                                </span>
                              </div>

                              {/* Message Text */}
                              <div className="text-xs text-slate-800 whitespace-pre-wrap leading-relaxed font-sans">
                                {turn.text}
                              </div>

                              {/* Embedded Code Blocks */}
                              {turn.codeBlocks && turn.codeBlocks.length > 0 && (
                                <div className="space-y-3 pt-2">
                                  {turn.codeBlocks.map((cb, cIdx) => (
                                    <div
                                      key={cIdx}
                                      className="rounded-xl bg-[#0F172A] border border-slate-800 overflow-hidden font-mono text-xs text-slate-200 shadow-sm">
                                      <div className="bg-[#0A0F1D] px-4 py-2 border-b border-slate-800 flex items-center justify-between">
                                        <span className="text-indigo-400 text-[10px] uppercase font-bold">
                                          {cb.language || "code"}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => handleCopySnippet(cb.code, cIdx)}
                                          className="text-xs text-slate-300 hover:text-white font-semibold cursor-pointer flex items-center space-x-1.5 transition-colors">
                                          <IconCopy className="w-3.5 h-3.5" />
                                          <span>Copy Code</span>
                                        </button>
                                      </div>
                                      <pre className="p-4 whitespace-pre-wrap overflow-x-auto text-slate-300">
                                        {cb.code}
                                      </pre>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })
                      )}
                    </div>
                  )}

                  {/* TAB 2: CODE SNIPPETS */}
                  {activeTab === "code" && (
                    <div className="space-y-4">
                      {!selectedContext.rawCodeBlocks || selectedContext.rawCodeBlocks.length === 0 ? (
                        <div className="p-12 text-center bg-white border border-dashed border-slate-200 rounded-2xl text-slate-400 space-y-2">
                          <IconCode className="w-8 h-8 mx-auto text-slate-300" />
                          <p className="text-xs font-bold text-slate-700">No code snippets captured</p>
                          <p className="text-xs text-slate-500 max-w-sm mx-auto">
                            This conversation does not contain any code snippets.
                          </p>
                        </div>
                      ) : (
                        selectedContext.rawCodeBlocks.map((block: VerbatimCodeBlock, idx: number) => {
                          const lineCount = block.code.split("\n").length

                          return (
                            <div
                              key={idx}
                              className="border border-slate-800 rounded-xl overflow-hidden bg-[#0F172A] text-slate-100 shadow-md">
                              <div className="bg-[#0A0F1D] px-4 py-2.5 border-b border-slate-800 flex items-center justify-between text-xs font-mono">
                                <div className="flex items-center space-x-2.5">
                                  <span className="px-2 py-0.5 rounded-md bg-indigo-950 text-indigo-300 border border-indigo-700/60 font-bold uppercase text-[10px]">
                                    {block.language || "text"}
                                  </span>
                                  <span className="text-slate-400 font-medium">
                                    Snippet #{idx + 1} • {lineCount} lines
                                  </span>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => handleCopySnippet(block.code, idx)}
                                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition-colors cursor-pointer flex items-center space-x-1.5 shadow-2xs">
                                  <IconCopy className="w-3.5 h-3.5" />
                                  <span>{copiedSnippetIndex === idx ? "Copied!" : "Copy Code"}</span>
                                </button>
                              </div>

                              <pre className="p-4 text-xs font-mono leading-relaxed overflow-x-auto whitespace-pre select-text text-slate-200">
                                <code>{block.code}</code>
                              </pre>
                            </div>
                          )
                        })
                      )}
                    </div>
                  )}

                  {/* TAB 3: SUMMARY & LINKS */}
                  {activeTab === "summary" && (
                    <div className="space-y-4">
                      {(() => {
                        const summary = generateCleanSummary(selectedContext)
                        return (
                          <div className="bg-white border border-slate-200/90 rounded-2xl p-6 space-y-3.5 shadow-xs">
                            <div className="flex items-center space-x-2 text-slate-800">
                              <IconDocumentText className="w-4 h-4 text-indigo-600 shrink-0" />
                              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                                {summary.topic}
                              </h3>
                            </div>

                            <ul className="space-y-2.5 text-xs text-slate-700 leading-relaxed font-medium">
                              {summary.highlights.map((point, idx) => (
                                <li key={idx} className="flex items-start space-x-2.5">
                                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0 mt-1.5" />
                                  <span className="select-text">{point}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )
                      })()}

                      {/* Shared Links */}
                      {(() => {
                        const sharedLinks = extractSharedLinks(selectedContext.turns || [])
                        if (sharedLinks.length === 0) return null

                        return (
                          <div className="bg-white border border-slate-200/90 rounded-2xl p-6 space-y-3 shadow-xs">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-2 text-indigo-700">
                                <IconExternalLink className="w-4 h-4 shrink-0 text-indigo-600" />
                                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                                  Shared Links ({sharedLinks.length})
                                </h3>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                              {sharedLinks.map((link, idx) => (
                                <a
                                  key={idx}
                                  href={link.url}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  className="group flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200 hover:border-indigo-400 hover:shadow-xs transition-all cursor-pointer">
                                  <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                                    <span className="px-2 py-0.5 rounded bg-white group-hover:bg-indigo-50 text-slate-600 group-hover:text-indigo-700 text-[10px] font-mono font-bold shrink-0 transition-colors">
                                      {link.domain}
                                    </span>
                                    <span
                                      className="text-xs font-medium text-slate-800 group-hover:text-indigo-600 truncate transition-colors"
                                      title={link.url}>
                                      {link.title}
                                    </span>
                                  </div>
                                  <IconExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-600 shrink-0 transition-colors" />
                                </a>
                              ))}
                            </div>
                          </div>
                        )
                      })()}
                    </div>
                  )}

                  {/* TAB 4: EXPORTED PROMPT */}
                  {activeTab === "handover" && (
                    <div className="bg-white border border-slate-200/90 rounded-2xl p-6 space-y-4 shadow-xs">
                      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
                        <div>
                          <h2 className="text-sm font-bold text-slate-900 tracking-tight">
                            Formatted Prompt Preview
                          </h2>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Formatted context ready to paste into another conversation.
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleCopyPrompt()}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs transition-all cursor-pointer flex items-center space-x-1.5 active:scale-95">
                          <IconCopy className="w-3.5 h-3.5" />
                          <span>Copy Prompt</span>
                        </button>
                      </div>

                      <pre className="p-4 rounded-xl bg-slate-900 text-slate-200 font-mono text-xs leading-relaxed max-h-[460px] overflow-y-auto whitespace-pre-wrap select-text">
                        {generatedPrompt}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Welcoming Clean State */
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="max-w-md text-center space-y-4">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-indigo-50 border border-indigo-200/80 flex items-center justify-center text-indigo-600 shadow-xs">
                  <IconShield className="w-7 h-7" />
                </div>

                <div className="space-y-1.5">
                  <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                    Select a Conversation
                  </h2>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto leading-relaxed">
                    Pick a conversation from the sidebar to view messages, copy code snippets, or transfer to another platform with full continuity.
                  </p>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
