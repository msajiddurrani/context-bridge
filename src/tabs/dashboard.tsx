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

// ============================================================================
// CLEAN INLINE SVG ICONS (Feather-light, sharp vector graphics, zero emojis)
// ============================================================================

function IconSearch({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  )
}

function IconRefresh({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
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

function IconPin({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v2a2 2 0 01-.586 1.414L16 11v5l2 2v1H6v-1l2-2v-5L5.586 8.414A2 2 0 015 7V5z" />
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

function IconZap({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  )
}

function IconSparkles({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
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

function IconShield({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
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

function IconBot({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
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

function getPlatformBadge(platform: PlatformId | string) {
  const p = platform.toLowerCase()
  if (p === "claude") {
    return {
      name: "Claude",
      color: "bg-amber-50 text-amber-800 border-amber-200/80",
      dot: "bg-amber-500"
    }
  }
  if (p === "chatgpt") {
    return {
      name: "ChatGPT",
      color: "bg-emerald-50 text-emerald-800 border-emerald-200/80",
      dot: "bg-emerald-500"
    }
  }
  if (p === "gemini") {
    return {
      name: "Gemini",
      color: "bg-blue-50 text-blue-800 border-blue-200/80",
      dot: "bg-blue-500"
    }
  }
  return {
    name: platform.toUpperCase(),
    color: "bg-slate-50 text-slate-700 border-slate-200",
    dot: "bg-slate-400"
  }
}

// Sample rich demo session for empty-state preview
const SAMPLE_DEMO_CONTEXT: StoredContext = {
  id: "demo-jwt-auth-architecture",
  chatId: "demo-auth-9921",
  chatTitle: "Distributed JWT Authentication & Redis Session Architecture",
  sourcePlatform: "claude",
  sourceUrl: "https://claude.ai/chat/demo-auth-9921",
  createdAt: Date.now() - 3600000 * 2,
  updatedAt: Date.now() - 3600000 * 2,
  expiresAt: Date.now() + 86400000 * 30,
  isPinned: true,
  isImported: true,
  exchangeCount: 2,
  stateMemory: {
    version: "1.0",
    objective: "Design a high-throughput stateless JWT auth pipeline with stateful Redis refresh token revocation.",
    techStack: ["TypeScript", "Node.js", "Redis", "JWT"],
    architectureDecisions: [
      "Use 15-minute RS256 JWT access tokens for stateless API verification",
      "Store 7-day refresh tokens hashed with Argon2 in Redis cluster",
      "Implement immediate revocation list using Redis bloom filters for O(1) checks"
    ],
    currentWork: "Implemented the dual-token architecture with automatic token rotation and blacklist cache.",
    blockersAndErrors: [],
    nextSteps: [
      "Add rate limiting middleware per IP/user",
      "Write integration tests for token rotation race conditions"
    ],
    criticalSnippets: [],
    rawTokenEstimate: 3420
  },
  turns: [
    {
      id: "turn-1",
      role: "user",
      text: "How should we design a zero-latency distributed authentication system supporting both web and mobile clients?",
      codeBlocks: []
    },
    {
      id: "turn-2",
      role: "assistant",
      text: "Here is the recommended dual-token architecture using short-lived RS256 access tokens and Redis-backed refresh tokens:",
      codeBlocks: [
        {
          id: "snippet-1",
          turnIndex: 1,
          language: "typescript",
          code: `import jwt from "jsonwebtoken"\n\nexport interface AuthPayload {\n  userId: string\n  role: "admin" | "engineer"\n  sessionId: string\n}\n\nexport function verifyAccessToken(token: string, publicKey: string): AuthPayload {\n  return jwt.verify(token, publicKey, { algorithms: ["RS256"] }) as AuthPayload\n}`
        }
      ]
    },
    {
      id: "turn-3",
      role: "user",
      text: "How do we handle instant token revocation if an account is compromised before the 15-minute JWT expires?",
      codeBlocks: []
    },
    {
      id: "turn-4",
      role: "assistant",
      text: "Use a lightweight Redis Blacklist check on the API gateway layer with automatic TTL matching the JWT expiry:",
      codeBlocks: [
        {
          id: "snippet-2",
          turnIndex: 3,
          language: "typescript",
          code: `import type { Redis } from "ioredis"\n\nexport async function revokeToken(redis: Redis, jti: string, ttlSeconds: number): Promise<void> {\n  await redis.set(\`blacklist:\${jti}\`, "1", "EX", ttlSeconds)\n}\n\nexport async function isTokenRevoked(redis: Redis, jti: string): Promise<boolean> {\n  const res = await redis.exists(\`blacklist:\${jti}\`)\n  return res === 1\n}`
        }
      ]
    }
  ],
  rawCodeBlocks: [
    {
      id: "snippet-1",
      turnIndex: 1,
      language: "typescript",
      code: `import jwt from "jsonwebtoken"\n\nexport interface AuthPayload {\n  userId: string\n  role: "admin" | "engineer"\n  sessionId: string\n}\n\nexport function verifyAccessToken(token: string, publicKey: string): AuthPayload {\n  return jwt.verify(token, publicKey, { algorithms: ["RS256"] }) as AuthPayload\n}`
    },
    {
      id: "snippet-2",
      turnIndex: 3,
      language: "typescript",
      code: `import type { Redis } from "ioredis"\n\nexport async function revokeToken(redis: Redis, jti: string, ttlSeconds: number): Promise<void> {\n  await redis.set(\`blacklist:\${jti}\`, "1", "EX", ttlSeconds)\n}\n\nexport async function isTokenRevoked(redis: Redis, jti: string): Promise<boolean> {\n  const res = await redis.exists(\`blacklist:\${jti}\`)\n  return res === 1\n}`
    }
  ]
}

// ============================================================================
// MAIN DASHBOARD COMPONENT
// ============================================================================

export default function DashboardPage() {
  const [contexts, setContexts] = useState<StoredContext[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [platformFilter, setPlatformFilter] = useState<"all" | PlatformId>("all")
  const [pinnedOnly, setPinnedOnly] = useState(false)
  const [sortBy, setSortBy] = useState<"updated" | "exchanges" | "code" | "tokens">("updated")

  // Workspace View Tabs
  const [activeTab, setActiveTab] = useState<"prompt" | "code" | "transcript" | "state">("prompt")
  const [targetPlatform, setTargetPlatform] = useState<PlatformId>("chatgpt")
  const [densityMode, setDensityMode] = useState<InjectionDensityMode>("standard")
  const [promptFormat, setPromptFormat] = useState<InjectionFormat>("markdown")

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [copiedSnippetIndex, setCopiedSnippetIndex] = useState<number | null>(null)
  const [copiedPrompt, setCopiedPrompt] = useState(false)

  // Custom persona & endings
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
    if (!window.confirm("Delete this conversation context from local memory?")) {
      return
    }
    await deleteContext(id)
    if (selectedId === id) {
      setSelectedId(null)
    }
    await loadData()
    showToast("Conversation deleted")
  }

  async function handlePruneExpired() {
    const res = await cleanupExpiredContexts()
    await loadData()
    showToast(`Pruned ${res.prunedCount} expired conversations (pinned are safe)`)
  }

  async function handleClearAll() {
    if (!window.confirm("Permanently clear ALL saved conversations and local history?")) {
      return
    }
    await clearAllData()
    setSelectedId(null)
    await loadData()
    showToast("All local memory contexts cleared")
  }

  async function handleLoadDemoSession() {
    await saveContext(SAMPLE_DEMO_CONTEXT)
    await loadData()
    setSelectedId(SAMPLE_DEMO_CONTEXT.id)
    showToast("Loaded sample engineering session!")
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
        showToast("Failed to parse file. Must be valid JSON.")
      }
    }
    reader.readAsText(file)
    e.target.value = ""
  }

  function handleCopyPrompt() {
    if (!generatedPrompt) return
    navigator.clipboard.writeText(generatedPrompt)
    setCopiedPrompt(true)
    showToast(`Copied Handover Prompt for ${targetPlatform.toUpperCase()}!`)
    setTimeout(() => setCopiedPrompt(false), 2000)
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
    showToast(`Copied code snippet #${idx + 1}`)
    setTimeout(() => setCopiedSnippetIndex(null), 2000)
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-800 font-sans flex flex-col antialiased">
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
        <div className="fixed top-5 right-6 z-50 bg-slate-900 text-white text-xs font-medium px-4 py-2.5 rounded-lg shadow-xl border border-slate-700/80 flex items-center space-x-2 animate-fade-in">
          <div className="w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
            <IconCheck className="w-3 h-3" />
          </div>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ===== Top App Navigation Header ===== */}
      <header className="h-16 bg-white border-b border-slate-200/80 px-6 flex items-center justify-between shrink-0 sticky top-0 z-40 shadow-xs">
        {/* Left: Brand Identity */}
        <div className="flex items-center space-x-3.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-500 flex items-center justify-center shadow-sm p-1.5">
            <img
              src={iconSrc}
              alt="Context Bridge"
              className="w-full h-full object-contain filter drop-shadow-xs"
            />
          </div>
          <div>
            <div className="flex items-center space-x-2.5">
              <span className="text-base font-bold text-slate-900 tracking-tight leading-none">
                Context Bridge
              </span>
              <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 border border-indigo-200/70 px-2 py-0.5 rounded-md">
                Studio
              </span>
              <span className="hidden sm:inline-flex items-center space-x-1.5 text-[11px] font-medium text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span>Local Memory Ready</span>
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium leading-none mt-1">
              Universal bidirectional LLM context handover across Claude, ChatGPT & Gemini
            </p>
          </div>
        </div>

        {/* Center: Real-time Metric Indicators */}
        <div className="hidden xl:flex items-center space-x-2 bg-slate-100/80 p-1 rounded-xl border border-slate-200/60">
          <div className="px-3 py-1 flex items-center space-x-1.5 text-xs">
            <IconMessageSquare className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-500 font-medium">Chats:</span>
            <span className="font-bold text-slate-800">{totalStats.chatsCount}</span>
          </div>
          <div className="w-px h-3.5 bg-slate-300" />
          <div className="px-3 py-1 flex items-center space-x-1.5 text-xs">
            <IconLayers className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-500 font-medium">Exchanges:</span>
            <span className="font-bold text-slate-800">{totalStats.exchanges}</span>
          </div>
          <div className="w-px h-3.5 bg-slate-300" />
          <div className="px-3 py-1 flex items-center space-x-1.5 text-xs">
            <IconCode className="w-3.5 h-3.5 text-indigo-500" />
            <span className="text-slate-500 font-medium">Code Blocks:</span>
            <span className="font-bold text-indigo-600">{totalStats.codeBlocks}</span>
          </div>
          <div className="w-px h-3.5 bg-slate-300" />
          <div className="px-3 py-1 flex items-center space-x-1.5 text-xs">
            <IconZap className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-slate-500 font-medium">Saved Tokens:</span>
            <span className="font-bold text-slate-800">~{totalStats.tokens.toLocaleString()}</span>
          </div>
        </div>

        {/* Right: Studio Action Buttons */}
        <div className="flex items-center space-x-2 text-xs">
          <button
            type="button"
            onClick={loadData}
            className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 border border-slate-200 transition-colors cursor-pointer"
            title="Reload local storage data">
            <IconRefresh className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={handleExportAll}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-medium transition-colors cursor-pointer shadow-2xs">
            <IconDownload className="w-3.5 h-3.5 text-slate-500" />
            <span>Export Backup</span>
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-medium transition-colors cursor-pointer shadow-2xs">
            <IconUpload className="w-3.5 h-3.5 text-slate-500" />
            <span>Import</span>
          </button>

          <button
            type="button"
            onClick={handlePruneExpired}
            className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-medium transition-colors cursor-pointer"
            title="Prune inactive sessions past retention window">
            Prune Expired
          </button>

          <button
            type="button"
            onClick={handleClearAll}
            className="px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-medium border border-rose-200/80 transition-colors cursor-pointer"
            title="Clear all stored data">
            Clear All
          </button>
        </div>
      </header>

      {/* ===== Main Split Workspace ===== */}
      <div className="flex-1 flex overflow-hidden">
        {/* =================================================================== */}
        {/* LEFT SIDEBAR: Conversation Explorer (~380px) */}
        {/* =================================================================== */}
        <aside className="w-[360px] lg:w-[400px] bg-white border-r border-slate-200/80 flex flex-col shrink-0">
          {/* Search & Filter Toolbar */}
          <div className="p-4 border-b border-slate-200/80 space-y-3">
            {/* Search Bar */}
            <div className="relative">
              <IconSearch className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search conversations, code, or topics..."
                className="w-full bg-slate-50 hover:bg-slate-100/70 focus:bg-white border border-slate-200/80 focus:border-indigo-500 rounded-lg pl-9 pr-8 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 transition-all font-sans"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 text-xs p-0.5">
                  ✕
                </button>
              )}
            </div>

            {/* Platform Segmented Selector */}
            <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-lg border border-slate-200/80">
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
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer flex items-center justify-center space-x-1 capitalize ${
                      isSelected
                        ? "bg-white text-slate-900 shadow-xs border border-slate-200/80 font-bold"
                        : "text-slate-600 hover:text-slate-900 hover:bg-white/40"
                    }`}>
                    <span>{plat}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-md font-mono ${
                        isSelected
                          ? "bg-indigo-50 text-indigo-700 font-bold"
                          : "bg-slate-200/70 text-slate-600"
                      }`}>
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* Sub-Filters: Pinned Only & Sort */}
            <div className="flex items-center justify-between text-xs text-slate-600 pt-0.5 px-0.5">
              <label className="flex items-center space-x-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={pinnedOnly}
                  onChange={(e) => setPinnedOnly(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-0 cursor-pointer w-3.5 h-3.5"
                />
                <span className="font-medium text-slate-700">Pinned Only</span>
              </label>

              <div className="flex items-center space-x-1.5">
                <span className="text-slate-400 text-[11px]">Sort:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="bg-transparent border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-700 font-medium cursor-pointer focus:outline-none focus:border-indigo-400">
                  <option value="updated">Recently Updated</option>
                  <option value="exchanges">Most Exchanges</option>
                  <option value="code">Most Code Snippets</option>
                  <option value="tokens">Largest Token Size</option>
                </select>
              </div>
            </div>
          </div>

          {/* Conversation Cards List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 p-3 space-y-2">
            {filteredContexts.length === 0 ? (
              <div className="p-8 text-center space-y-3 text-slate-500">
                <div className="w-12 h-12 mx-auto rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400">
                  <IconMessageSquare className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-xs font-bold text-slate-800">No conversations found</h3>
                  <p className="text-[11px] text-slate-500 max-w-xs mx-auto leading-relaxed">
                    {searchQuery
                      ? "No conversations match your search query."
                      : "Open ChatGPT, Claude, or Gemini in your browser to automatically capture context into local memory."}
                  </p>
                </div>
                {!searchQuery && (
                  <button
                    type="button"
                    onClick={handleLoadDemoSession}
                    className="mt-2 inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-semibold transition-colors cursor-pointer">
                    <IconSparkles className="w-3.5 h-3.5" />
                    <span>Load Demo Session</span>
                  </button>
                )}
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
                const badge = getPlatformBadge(ctx.sourcePlatform)

                return (
                  <article
                    key={ctx.id}
                    onClick={() => setSelectedId(ctx.id)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer select-none space-y-2.5 ${
                      isSelected
                        ? "bg-indigo-50/40 border-indigo-300 ring-1 ring-indigo-200 shadow-xs"
                        : "bg-white hover:bg-slate-50/90 border-slate-200/80 hover:border-slate-300 shadow-2xs"
                    }`}>
                    {/* Card Top: Platform + Status + Actions */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <span
                          className={`inline-flex items-center space-x-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${badge.color}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                          <span>{badge.name}</span>
                        </span>

                        {isPinned && (
                          <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded-md flex items-center space-x-1">
                            <IconPin className="w-2.5 h-2.5" />
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
                          className={`p-1 rounded-md transition-colors ${
                            isPinned
                              ? "text-amber-500 bg-amber-50"
                              : "text-slate-400 hover:text-amber-500 hover:bg-slate-100"
                          }`}
                          title={isPinned ? "Unpin session" : "Pin session (never expires)"}>
                          <IconPin className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(ctx.id)}
                          className="p-1 rounded-md text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                          title="Delete session">
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
                      {ctx.chatTitle || "Untitled Engineering Session"}
                    </h2>

                    {/* Objective / Preview Text */}
                    <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed font-sans">
                      {ctx.stateMemory?.objective ||
                        ctx.stateMemory?.currentWork ||
                        "Conversation transcript captured locally with zero cloud dependencies."}
                    </p>

                    {/* Card Meta Footer */}
                    <div className="flex items-center space-x-2 pt-1 border-t border-slate-100 text-[10px] font-medium text-slate-500">
                      <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md font-mono">
                        {exchangeCount} turns
                      </span>
                      {codeCount > 0 && (
                        <span className="bg-indigo-50 text-indigo-700 border border-indigo-200/80 px-2 py-0.5 rounded-md font-mono font-semibold flex items-center space-x-1">
                          <IconCode className="w-2.5 h-2.5" />
                          <span>{codeCount} snippets</span>
                        </span>
                      )}
                      <span className="text-slate-400 font-mono">~{tokenEst.toLocaleString()} tok</span>
                    </div>
                  </article>
                )
              })
            )}
          </div>
        </aside>

        {/* =================================================================== */}
        {/* RIGHT WORKSPACE: Deep Inspection Canvas */}
        {/* =================================================================== */}
        <main className="flex-1 bg-[#F8FAFC] flex flex-col overflow-y-auto">
          {selectedContext ? (
            <div className="flex-1 flex flex-col p-6 space-y-5 max-w-6xl mx-auto w-full">
              {/* Active Conversation Hero Card */}
              <div className="bg-white border border-slate-200/90 rounded-2xl p-5 space-y-4 shadow-sm">
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex items-center space-x-2.5">
                      {(() => {
                        const b = getPlatformBadge(selectedContext.sourcePlatform)
                        return (
                          <span
                            className={`inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-md text-xs font-semibold border ${b.color}`}>
                            <span className={`w-2 h-2 rounded-full ${b.dot}`} />
                            <span>{b.name}</span>
                          </span>
                        )
                      })()}

                      <span className="text-xs text-slate-500 font-mono bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md">
                        ID: {selectedContext.chatId}
                      </span>

                      {selectedContext.isPinned && (
                        <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md flex items-center space-x-1">
                          <IconPin className="w-3 h-3" />
                          <span>Pinned</span>
                        </span>
                      )}
                    </div>

                    <h1 className="text-lg font-bold text-slate-900 tracking-tight leading-snug truncate">
                      {selectedContext.chatTitle}
                    </h1>

                    <div className="flex items-center space-x-3 text-xs text-slate-500">
                      <span>Updated {formatFullDate(selectedContext.updatedAt || selectedContext.createdAt)}</span>
                      {selectedContext.sourceUrl && (
                        <>
                          <span>•</span>
                          <a
                            href={selectedContext.sourceUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center space-x-1 text-indigo-600 hover:text-indigo-800 font-medium hover:underline">
                            <span>Open Original Tab</span>
                            <IconExternalLink className="w-3 h-3" />
                          </a>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Primary Handover Action Toolbar */}
                  <div className="flex items-center space-x-2.5 shrink-0 text-xs">
                    <button
                      type="button"
                      onClick={handleCopyPrompt}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl shadow-sm hover:shadow transition-all cursor-pointer flex items-center space-x-2">
                      {copiedPrompt ? (
                        <>
                          <IconCheck className="w-4 h-4 text-emerald-300" />
                          <span>Copied Handover Prompt!</span>
                        </>
                      ) : (
                        <>
                          <IconZap className="w-4 h-4" />
                          <span>Copy Handover Prompt</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleDownloadMarkdown}
                      className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-medium rounded-xl transition-colors cursor-pointer flex items-center space-x-1.5 shadow-2xs"
                      title="Download clean Markdown session export">
                      <IconDownload className="w-4 h-4 text-slate-500" />
                      <span>Download .md</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleTogglePin(selectedContext.id)}
                      className={`p-2 rounded-xl border transition-colors cursor-pointer ${
                        selectedContext.isPinned
                          ? "bg-amber-50 border-amber-200 text-amber-700"
                          : "bg-white hover:bg-slate-50 border-slate-200 text-slate-600"
                      }`}
                      title={selectedContext.isPinned ? "Unpin session" : "Pin session"}>
                      <IconPin className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDelete(selectedContext.id)}
                      className="p-2 rounded-xl bg-white hover:bg-rose-50 border border-slate-200 hover:border-rose-200 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                      title="Delete session">
                      <IconTrash className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Studio Workspace Tabs */}
                <div className="flex items-center space-x-1 border-t border-slate-100 pt-3">
                  {[
                    { id: "prompt", label: "Handover Prompt", icon: IconZap, badge: null },
                    {
                      id: "code",
                      label: "Code Artifacts",
                      icon: IconCode,
                      badge: selectedContext.rawCodeBlocks?.length || 0
                    },
                    {
                      id: "transcript",
                      label: "Full Transcript",
                      icon: IconMessageSquare,
                      badge: selectedContext.turns?.length || 0
                    },
                    { id: "state", label: "Technical State", icon: IconLayers, badge: null }
                  ].map((tab) => {
                    const Icon = tab.icon
                    const isActive = activeTab === tab.id

                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center space-x-2 ${
                          isActive
                            ? "bg-slate-900 text-white shadow-xs"
                            : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/70"
                        }`}>
                        <Icon className={`w-3.5 h-3.5 ${isActive ? "text-indigo-400" : "text-slate-400"}`} />
                        <span>{tab.label}</span>
                        {tab.badge !== null && tab.badge > 0 && (
                          <span
                            className={`px-1.5 py-0.2 rounded-md text-[10px] font-mono font-bold ${
                              isActive
                                ? "bg-slate-800 text-slate-200"
                                : "bg-slate-200/80 text-slate-700"
                            }`}>
                            {tab.badge}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* ============================================================= */}
              {/* VIEW 1: LIVE HANDOVER PROMPT GENERATOR */}
              {/* ============================================================= */}
              {activeTab === "prompt" && (
                <div className="bg-white border border-slate-200/90 rounded-2xl p-5 space-y-4 shadow-sm flex-1 flex flex-col">
                  {/* Prompt Controls Toolbar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
                    {/* Target Platform Selector */}
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Target AI Platform:
                      </span>
                      {(["chatgpt", "claude", "gemini"] as const).map((plat) => {
                        const isTarget = targetPlatform === plat
                        const b = getPlatformBadge(plat)

                        return (
                          <button
                            key={plat}
                            type="button"
                            onClick={() => setTargetPlatform(plat)}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all cursor-pointer flex items-center space-x-1.5 ${
                              isTarget
                                ? "bg-indigo-600 border-indigo-600 text-white shadow-xs"
                                : "bg-white hover:bg-slate-50 border-slate-200 text-slate-700"
                            }`}>
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                isTarget ? "bg-white" : b.dot
                              }`}
                            />
                            <span>{b.name}</span>
                          </button>
                        )
                      })}
                    </div>

                    {/* Density & Format Selectors */}
                    <div className="flex items-center space-x-3 text-xs">
                      <div className="flex items-center space-x-1.5">
                        <span className="text-slate-400 font-medium">Density:</span>
                        <select
                          value={densityMode}
                          onChange={(e) => setDensityMode(e.target.value as any)}
                          className="bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-700 font-medium cursor-pointer focus:outline-none focus:border-indigo-400">
                          <option value="standard">Standard (Smart Summary)</option>
                          <option value="compact">Compact (Token Saver)</option>
                          <option value="smart">Smart Outline</option>
                          <option value="complete">Complete History (100% Verbatim)</option>
                        </select>
                      </div>

                      <div className="flex items-center space-x-1.5">
                        <span className="text-slate-400 font-medium">Format:</span>
                        <select
                          value={promptFormat}
                          onChange={(e) => setPromptFormat(e.target.value as any)}
                          className="bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-700 font-medium cursor-pointer focus:outline-none focus:border-indigo-400">
                          <option value="markdown">Markdown</option>
                          <option value="xml">XML Tags</option>
                        </select>
                      </div>

                      <button
                        type="button"
                        onClick={handleCopyPrompt}
                        className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg shadow-2xs transition-colors cursor-pointer flex items-center space-x-1.5">
                        <IconCopy className="w-3.5 h-3.5" />
                        <span>Copy Prompt</span>
                      </button>
                    </div>
                  </div>

                  {/* Informational Guidance Banner */}
                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 leading-relaxed flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <IconSparkles className="w-4 h-4 text-indigo-500 shrink-0" />
                      <span>
                        Paste this formatted prompt into a new <strong>{targetPlatform.toUpperCase()}</strong> chat.
                        The model will pick up your technical session with full architectural memory and verbatim code.
                      </span>
                    </div>
                    <span className="text-slate-400 font-mono text-[11px] font-semibold shrink-0 ml-3">
                      ~{Math.round(generatedPrompt.length / 4).toLocaleString()} tokens
                    </span>
                  </div>

                  {/* Code Editor Style Container */}
                  <div className="relative flex-1 min-h-[380px] bg-[#0F172A] border border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-inner">
                    <div className="bg-[#0A0F1D] px-4 py-2 border-b border-slate-800 flex items-center justify-between text-xs font-mono text-slate-400">
                      <div className="flex items-center space-x-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
                        <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
                        <span className="ml-2 text-slate-300 font-semibold">injected-handover.prompt</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleCopyPrompt}
                        className="text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer flex items-center space-x-1 transition-colors">
                        <IconCopy className="w-3.5 h-3.5" />
                        <span>{copiedPrompt ? "Copied!" : "Copy to Clipboard"}</span>
                      </button>
                    </div>
                    <pre className="flex-1 p-5 text-xs font-mono leading-relaxed text-slate-200 overflow-y-auto whitespace-pre-wrap select-text">
                      {generatedPrompt}
                    </pre>
                  </div>
                </div>
              )}

              {/* ============================================================= */}
              {/* VIEW 2: CODE ARTIFACTS GALLERY */}
              {/* ============================================================= */}
              {activeTab === "code" && (
                <div className="bg-white border border-slate-200/90 rounded-2xl p-5 space-y-4 shadow-sm">
                  <div className="border-b border-slate-100 pb-3">
                    <h2 className="text-sm font-bold text-slate-900 tracking-tight">
                      Verbatim Code Blocks ({selectedContext.rawCodeBlocks?.length || 0})
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Code snippets captured directly from the conversation. Stored 100% verbatim without AI summarization.
                    </p>
                  </div>

                  {!selectedContext.rawCodeBlocks || selectedContext.rawCodeBlocks.length === 0 ? (
                    <div className="p-12 text-center border border-dashed border-slate-200 rounded-xl text-slate-400 space-y-2">
                      <IconCode className="w-8 h-8 mx-auto text-slate-300" />
                      <p className="text-xs font-bold text-slate-700">No code artifacts captured</p>
                      <p className="text-xs text-slate-500 max-w-sm mx-auto">
                        This session contains text exchanges without formatted markdown code blocks.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {selectedContext.rawCodeBlocks.map((block: VerbatimCodeBlock, idx: number) => {
                        const lineCount = block.code.split("\n").length

                        return (
                          <div
                            key={idx}
                            className="border border-slate-800 rounded-xl overflow-hidden bg-[#0F172A] text-slate-100 shadow-md">
                            {/* Code Header Bar */}
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
                                className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs transition-colors cursor-pointer flex items-center space-x-1.5 shadow-2xs">
                                <IconCopy className="w-3.5 h-3.5" />
                                <span>{copiedSnippetIndex === idx ? "Copied!" : "Copy Code"}</span>
                              </button>
                            </div>

                            {/* Verbatim Code Body */}
                            <pre className="p-4 text-xs font-mono leading-relaxed overflow-x-auto whitespace-pre select-text text-slate-200">
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
                <div className="bg-white border border-slate-200/90 rounded-2xl p-5 space-y-4 shadow-sm">
                  <div className="border-b border-slate-100 pb-3">
                    <h2 className="text-sm font-bold text-slate-900 tracking-tight">
                      Turn-by-Turn Transcript ({selectedContext.turns?.length || 0} messages)
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Complete chronological exchange between user prompts and model responses.
                    </p>
                  </div>

                  {!selectedContext.turns || selectedContext.turns.length === 0 ? (
                    <div className="p-12 text-center border border-dashed border-slate-200 rounded-xl text-slate-400 space-y-2">
                      <IconMessageSquare className="w-8 h-8 mx-auto text-slate-300" />
                      <p className="text-xs font-bold text-slate-700">No message turns recorded</p>
                      <p className="text-xs text-slate-500 max-w-sm mx-auto">
                        This session was saved with distilled summary state memory only.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {selectedContext.turns.map((turn: MessageTurn, idx: number) => {
                        const isUser = turn.role === "user"

                        return (
                          <div
                            key={turn.id || idx}
                            className={`p-4 rounded-xl border select-text space-y-2.5 ${
                              isUser
                                ? "bg-slate-50/80 border-slate-200/80"
                                : "bg-white border-slate-200 shadow-xs"
                            }`}>
                            {/* Turn Header */}
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-2">
                                <div
                                  className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs ${
                                    isUser
                                      ? "bg-slate-200 text-slate-700"
                                      : "bg-indigo-100 text-indigo-700"
                                  }`}>
                                  {isUser ? <IconUser className="w-3.5 h-3.5" /> : <IconBot className="w-3.5 h-3.5" />}
                                </div>
                                <span className="text-xs font-bold text-slate-800">
                                  {isUser ? "User Prompt" : "Assistant Response"}
                                </span>
                                <span className="text-[11px] text-slate-400 font-mono">
                                  Turn #{idx + 1}
                                </span>
                              </div>

                              {turn.id && (
                                <span className="text-[10px] font-mono text-slate-400">
                                  {turn.id}
                                </span>
                              )}
                            </div>

                            {/* Message Text */}
                            <p className="text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">
                              {turn.text}
                            </p>

                            {/* Embedded Code Blocks in this Turn */}
                            {turn.codeBlocks && turn.codeBlocks.length > 0 && (
                              <div className="space-y-2 pt-2">
                                {turn.codeBlocks.map((cb, cIdx) => (
                                  <div
                                    key={cIdx}
                                    className="p-3.5 rounded-lg bg-[#0F172A] border border-slate-800 font-mono text-xs text-slate-200">
                                    <div className="text-indigo-400 text-[10px] uppercase font-bold mb-1.5 flex items-center justify-between">
                                      <span>{cb.language || "code"}</span>
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
                <div className="bg-white border border-slate-200/90 rounded-2xl p-5 space-y-5 shadow-sm">
                  <div className="border-b border-slate-100 pb-3">
                    <h2 className="text-sm font-bold text-slate-900 tracking-tight">
                      Technical State Matrix
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Distilled technical memory preserved across LLM contexts.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Core Objective Card */}
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
                      <div className="flex items-center space-x-2 text-indigo-700">
                        <IconSparkles className="w-4 h-4" />
                        <span className="text-xs font-bold uppercase tracking-wider">
                          Core Objective
                        </span>
                      </div>
                      <p className="text-xs text-slate-800 leading-relaxed font-medium">
                        {selectedContext.stateMemory?.objective || "No explicit objective defined."}
                      </p>
                    </div>

                    {/* Current Work Card */}
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
                      <div className="flex items-center space-x-2 text-indigo-700">
                        <IconLayers className="w-4 h-4" />
                        <span className="text-xs font-bold uppercase tracking-wider">
                          Current Status / Work
                        </span>
                      </div>
                      <p className="text-xs text-slate-800 leading-relaxed font-medium">
                        {selectedContext.stateMemory?.currentWork || "Engineering session in progress."}
                      </p>
                    </div>

                    {/* Architecture Decisions */}
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
                      <div className="flex items-center space-x-2 text-indigo-700">
                        <IconShield className="w-4 h-4" />
                        <span className="text-xs font-bold uppercase tracking-wider">
                          Architecture Decisions
                        </span>
                      </div>
                      {selectedContext.stateMemory?.architectureDecisions &&
                      selectedContext.stateMemory.architectureDecisions.length > 0 ? (
                        <ul className="space-y-1.5 pt-1 text-xs text-slate-700">
                          {selectedContext.stateMemory.architectureDecisions.map((dec, i) => (
                            <li key={i} className="flex items-start space-x-2">
                              <span className="text-indigo-600 font-bold shrink-0 mt-0.5">•</span>
                              <span>{dec}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-slate-500 italic">No explicit architectural decisions recorded.</p>
                      )}
                    </div>

                    {/* Next Steps */}
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
                      <div className="flex items-center space-x-2 text-indigo-700">
                        <IconZap className="w-4 h-4" />
                        <span className="text-xs font-bold uppercase tracking-wider">
                          Next Steps / Action Items
                        </span>
                      </div>
                      {selectedContext.stateMemory?.nextSteps &&
                      selectedContext.stateMemory.nextSteps.length > 0 ? (
                        <ul className="space-y-1.5 pt-1 text-xs text-slate-700">
                          {selectedContext.stateMemory.nextSteps.map((step, i) => (
                            <li key={i} className="flex items-start space-x-2">
                              <span className="text-indigo-600 font-bold shrink-0 mt-0.5">→</span>
                              <span>{step}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-slate-500 italic">Ready to continue with next prompt.</p>
                      )}
                    </div>
                  </div>

                  {/* Metadata Audit Box */}
                  <div className="p-4 rounded-xl bg-slate-100/70 border border-slate-200 space-y-2 font-mono text-[11px] text-slate-600">
                    <span className="font-bold text-slate-800 uppercase tracking-wider block">
                      Storage Record Audit:
                    </span>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
                      <div>
                        <span className="text-slate-400 block text-[10px]">Context Key:</span>
                        <span className="text-slate-900 font-semibold">{selectedContext.id}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">Chat ID:</span>
                        <span className="text-slate-900 font-semibold">{selectedContext.chatId}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">Platform:</span>
                        <span className="text-slate-900 font-semibold uppercase">{selectedContext.sourcePlatform}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">Retention:</span>
                        <span className="text-slate-900 font-semibold">{selectedContext.isPinned ? "Pinned (Permanent)" : "Auto-Expiring"}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* ===== Empty / Welcoming Studio State ===== */
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="max-w-xl text-center space-y-6">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-indigo-50 border border-indigo-200/80 flex items-center justify-center text-indigo-600 shadow-sm">
                  <IconSparkles className="w-8 h-8" />
                </div>

                <div className="space-y-2">
                  <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                    Welcome to Context Bridge Studio
                  </h2>
                  <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                    Universal, bidirectional session synchronization across web-based LLMs.
                    Never lose context or repeat prompts when switching models.
                  </p>
                </div>

                {/* 3 Value Pillars */}
                <div className="grid grid-cols-3 gap-3 text-left pt-2">
                  <div className="p-3.5 rounded-xl bg-white border border-slate-200/80 shadow-2xs space-y-1.5">
                    <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                      <IconZap className="w-4 h-4" />
                    </div>
                    <h3 className="text-xs font-bold text-slate-900">Any-to-Any Sync</h3>
                    <p className="text-[11px] text-slate-500 leading-snug">
                      Seamlessly transfer state between Claude, ChatGPT, and Gemini in 1 click.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-white border border-slate-200/80 shadow-2xs space-y-1.5">
                    <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                      <IconCode className="w-4 h-4" />
                    </div>
                    <h3 className="text-xs font-bold text-slate-900">Verbatim Code</h3>
                    <p className="text-[11px] text-slate-500 leading-snug">
                      Code snippets and blocks are preserved byte-for-byte without AI hallucinations.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-white border border-slate-200/80 shadow-2xs space-y-1.5">
                    <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                      <IconShield className="w-4 h-4" />
                    </div>
                    <h3 className="text-xs font-bold text-slate-900">100% Local-First</h3>
                    <p className="text-[11px] text-slate-500 leading-snug">
                      Stored strictly inside your browser. Zero telemetry and zero cloud dependencies.
                    </p>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleLoadDemoSession}
                    className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-sm hover:shadow transition-all cursor-pointer">
                    <IconSparkles className="w-4 h-4" />
                    <span>Load Demo Session to Test Dashboard</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
