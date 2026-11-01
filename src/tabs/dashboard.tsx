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
  computeContextMetrics,
  computeConversationStatistics,
  countWordsInText,
  extractSharedLinks,
  generateCleanSummary
} from "../utils/local-mode"
import { formatMarkdownHandoverExport, isGenericFillerText } from "../utils/prompt-formatter"
import { buildPreviewInjectedText } from "../utils/prompt-preview"
import {
  cleanupExpiredContexts,
  clearAllData,
  resetAllExtensionData,
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

function IconChip({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M3 9h2m-2 6h2m14-6h2m-2 6h2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
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

function IconClose({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

function IconInfo({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
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
  const [densityMode, setDensityMode] = useState<InjectionDensityMode>("smart")
  const [promptFormat, setPromptFormat] = useState<InjectionFormat>("markdown")

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [copiedSnippetIndex, setCopiedSnippetIndex] = useState<number | null>(null)
  const [copiedPrompt, setCopiedPrompt] = useState(false)

  // Custom persona & endings
  const [customStyle, setCustomStyle] = useState<string>("")
  const [customResume, setCustomResume] = useState<string>("")
  const [isPromptExpanded, setIsPromptExpanded] = useState<boolean>(false)
  const [isSummaryExpanded, setIsSummaryExpanded] = useState<boolean>(false)
  const [isTranscriptExpanded, setIsTranscriptExpanded] = useState<boolean>(false)

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

  // Summary Metrics using Canonical Statistics Engine
  const totalStats = useMemo(() => {
    let totalMessages = 0
    let exchanges = 0
    let codeBlocks = 0
    let words = 0

    for (const ctx of contexts) {
      const stats =
        ctx.statistics ||
        computeConversationStatistics(ctx.turns || [], ctx.rawCodeBlocks || [], ctx.completeness)
      totalMessages += stats.messageCount
      exchanges += stats.exchangeCount
      codeBlocks += stats.codeBlockCount
      words += stats.wordCount
    }

    return {
      chatsCount: contexts.length,
      totalMessages,
      exchanges,
      codeBlocks,
      words
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
    showToast("Chat deleted")
  }

  async function handlePruneExpired() {
    const res = await cleanupExpiredContexts()
    await loadData()
    showToast(`Cleaned up ${res.prunedCount} old chats (pinned chats kept)`)
  }

    async function handleResetAll() {
    if (!window.confirm("FACTORY RESET: This will wipe ALL extension data, saved conversations, and preferences back to fresh install state. Are you sure?")) {
      return
    }
    await resetAllExtensionData()
    setSelectedId(null)
    await loadData()
    showToast("Extension reset to factory default")
  }

  async function handleClearAll() {
    if (!window.confirm("Permanently clear ALL saved conversations from local memory?")) {
      return
    }
    await clearAllData()
    setSelectedId(null)
    await loadData()
    showToast("All saved chats cleared")
  }

  async function handleLoadDemoSession() {
    await saveContext(SAMPLE_DEMO_CONTEXT)
    await loadData()
    setSelectedId(SAMPLE_DEMO_CONTEXT.id)
    showToast("Loaded sample conversation!")
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

        // 1. Try native Context Bridge backup validation
        const validation = validateImportedBackup(parsed)
        if (validation.valid && validation.contexts.length > 0) {
          for (const item of validation.contexts) {
            await saveContext(item)
          }
          await loadData()
          showToast(`Imported ${validation.contexts.length} conversations from backup!`)
          return
        }

        // 2. Try official platform export (ChatGPT or Claude conversations.json)
        const official = parseOfficialPlatformExport(text)
        if (official.success && official.conversations.length > 0) {
          for (const item of official.conversations) {
            await saveContext(item)
          }
          await loadData()
          showToast(
            `Imported ${official.conversations.length} official ${official.platform.toUpperCase()} conversations (${official.totalMessages} messages)!`
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

  function handleCopyPrompt() {
    if (!generatedPrompt) return
    navigator.clipboard.writeText(generatedPrompt)
    setCopiedPrompt(true)
    showToast(`Copied prompt for ${targetPlatform.toUpperCase()}!`)
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
          <div className="w-4 h-4 rounded-full bg-indigo-500/20 text-indigo-300 flex items-center justify-center">
            <IconCheck className="w-3 h-3" />
          </div>
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ===== Top App Navigation Header ===== */}
      <header className="h-14 bg-white border-b border-slate-200/80 px-6 flex items-center justify-between shrink-0 sticky top-0 z-40 shadow-2xs">
        {/* Left: Brand Identity */}
        <div className="flex items-center space-x-2.5">
          <img
            src={iconSrc}
            alt="Context Bridge"
            className="w-7 h-7 object-contain shrink-0"
          />
          <h1 className="text-sm font-bold text-slate-900 tracking-tight leading-none">
            Context Bridge
          </h1>
        </div>

        {/* Center: Real-time Metric Indicators */}
        <div className="hidden xl:flex items-center space-x-3.5 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200/70 text-xs">
          <div className="flex items-center space-x-1.5 text-slate-600">
            <IconMessageSquare className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-500 font-medium">Chats:</span>
            <span className="font-semibold text-slate-800">{totalStats.chatsCount}</span>
          </div>
          <span className="text-slate-300">•</span>
          <div className="flex items-center space-x-1.5 text-slate-600">
            <IconLayers className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-500 font-medium">Messages:</span>
            <span className="font-semibold text-slate-800">{totalStats.totalMessages}</span>
          </div>
          <span className="text-slate-300">•</span>
          <div className="flex items-center space-x-1.5 text-slate-600">
            <IconCode className="w-3.5 h-3.5 text-indigo-500" />
            <span className="text-slate-500 font-medium">Code:</span>
            <span className="font-semibold text-indigo-600">{totalStats.codeBlocks}</span>
          </div>
          <span className="text-slate-300">•</span>
          <div className="flex items-center space-x-1.5 text-slate-600">
            <IconDocumentText className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-500 font-medium">Words:</span>
            <span className="font-semibold text-slate-800 font-mono">~{totalStats.words.toLocaleString()}</span>
          </div>
        </div>

        {/* Right: Studio Action Buttons */}
        <div className="flex items-center space-x-2 text-xs">
          <button
            type="button"
            onClick={loadData}
            className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 border border-slate-200 transition-colors cursor-pointer"
            title="Reload saved chats">
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
            title="Clean up old inactive chats">
            Clean Up Expired
          </button>

          <button
            type="button"
            onClick={handleClearAll}
            className="px-2.5 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-medium border border-rose-200/80 transition-colors cursor-pointer"
            title="Clear all saved chats">
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
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 transition-colors">
                  <IconClose className="w-3.5 h-3.5" />
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
                  <option value="tokens">Most Words</option>
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
                      : "Open ChatGPT, Claude, or Gemini in your browser to automatically save chats here."}
                  </p>
                </div>
                {!searchQuery && (
                  <button
                    type="button"
                    onClick={handleLoadDemoSession}
                    className="mt-2 inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-semibold transition-colors cursor-pointer">
                    <IconDocumentText className="w-3.5 h-3.5" />
                    <span>Load Sample Chat</span>
                  </button>
                )}
              </div>
            ) : (
              filteredContexts.map((ctx) => {
                const isSelected = selectedContext?.id === ctx.id
                const stats =
                  ctx.statistics ||
                  computeConversationStatistics(ctx.turns || [], ctx.rawCodeBlocks || [], ctx.completeness)
                const exchangeCount = stats.exchangeCount
                const messageCount = stats.messageCount
                const codeCount = stats.codeBlockCount
                const wordCount = stats.wordCount
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
                          className={`p-1 rounded-md transition-colors ${
                            isPinned
                              ? "text-amber-500 bg-amber-50"
                              : "text-slate-400 hover:text-amber-500 hover:bg-slate-100"
                          }`}
                          title={isPinned ? "Unpin session" : "Pin session (never expires)"}>
                          <IconPin className="w-3.5 h-3.5" filled={isPinned} />
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
                      {ctx.chatTitle || "Untitled Session"}
                    </h2>

                    {/* Real Chat Preview: Prompt & Answer */}
                    {ctx.turns && ctx.turns.length > 0 ? (
                      <div className="bg-slate-50/90 border border-slate-200/70 rounded-lg p-2.5 text-xs space-y-1.5 font-sans">
                        {(() => {
                          const userTurns = ctx.turns.filter((t) => t.role === "user")
                          const lastUser = userTurns[userTurns.length - 1]
                          const assistantTurns = ctx.turns.filter((t) => t.role === "assistant")
                          const lastAssistant = assistantTurns[assistantTurns.length - 1]

                          return (
                            <>
                              {lastUser && (
                                <div className="flex items-start space-x-1.5">
                                  <span className="font-semibold text-slate-700 shrink-0 text-[11px]">You:</span>
                                  <p className="text-slate-800 line-clamp-2 leading-relaxed text-[11px] select-text">
                                    {lastUser.text}
                                  </p>
                                </div>
                              )}
                              {lastAssistant && (
                                <div className="flex items-start space-x-1.5 pt-1.5 border-t border-slate-200/60">
                                  <span className="font-semibold text-indigo-600 shrink-0 text-[11px]">AI:</span>
                                  <p className="text-slate-600 line-clamp-2 leading-relaxed text-[11px] select-text">
                                    {lastAssistant.text}
                                  </p>
                                </div>
                              )}
                            </>
                          )
                        })()}
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed font-sans">
                        {ctx.stateMemory?.objective ||
                          ctx.stateMemory?.currentWork ||
                          "Chat conversation saved locally."}
                      </p>
                    )}

                    {/* Card Meta Footer */}
                    <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-100 text-[10px] font-medium text-slate-500">
                      <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md font-mono">
                        {exchangeCount} {exchangeCount === 1 ? "exchange" : "exchanges"}
                      </span>
                      <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md font-mono">
                        {messageCount} {messageCount === 1 ? "message" : "messages"}
                      </span>
                      {codeCount > 0 && (
                        <span className="bg-indigo-50 text-indigo-700 border border-indigo-200/80 px-2 py-0.5 rounded-md font-mono font-semibold flex items-center space-x-1">
                          <IconCode className="w-2.5 h-2.5" />
                          <span>{codeCount} snippets</span>
                        </span>
                      )}
                      <span className="text-slate-400 font-mono">~{wordCount.toLocaleString()} words</span>
                      {ctx.completeness === "viewport_only" && (
                        <span
                          className="bg-amber-50 text-amber-700 border border-amber-200/80 px-1.5 py-0.5 rounded text-[9px] font-semibold"
                          title={ctx.missingHistoryInformation?.notice || "Captured from active viewport only"}>
                          Active View
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
                          <IconPin className="w-3 h-3" filled={true} />
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
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl shadow-xs hover:shadow transition-all cursor-pointer flex items-center space-x-2">
                      {copiedPrompt ? (
                        <>
                          <IconCheck className="w-4 h-4 text-indigo-200" />
                          <span>Copied for Another AI!</span>
                        </>
                      ) : (
                        <>
                          <IconDocumentText className="w-4 h-4" />
                          <span>Copy for Another AI</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={handleDownloadMarkdown}
                      className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-medium rounded-xl transition-colors cursor-pointer flex items-center space-x-1.5 shadow-2xs"
                      title="Download clean Markdown export">
                      <IconDownload className="w-4 h-4 text-slate-500" />
                      <span>Download Chat (.md)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleTogglePin(selectedContext.id)}
                      className={`p-2 rounded-xl border transition-colors cursor-pointer ${
                        selectedContext.isPinned
                          ? "bg-amber-50 border-amber-200 text-amber-700"
                          : "bg-white hover:bg-slate-50 border-slate-200 text-slate-600"
                      }`}
                      title={selectedContext.isPinned ? "Unpin chat" : "Pin chat"}>
                      <IconPin className="w-4 h-4" filled={selectedContext.isPinned} />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDelete(selectedContext.id)}
                      className="p-2 rounded-xl bg-white hover:bg-rose-50 border border-slate-200 hover:border-rose-200 text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                      title="Delete chat">
                      <IconTrash className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Studio Workspace Tabs */}
                <div className="flex items-center space-x-1 border-t border-slate-100 pt-3">
                  {[
                    { id: "prompt", label: "Prompt for Another AI", icon: IconDocumentText, badge: null },
                    {
                      id: "code",
                      label: "Code Snippets",
                      icon: IconCode,
                      badge: selectedContext.rawCodeBlocks?.length || 0
                    },
                    {
                      id: "transcript",
                      label: "Full Conversation",
                      icon: IconMessageSquare,
                      badge: selectedContext.turns?.length || 0
                    },
                    { id: "state", label: "Chat Summary", icon: IconLayers, badge: null }
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
              {/* VIEW 1: PROMPT FOR ANOTHER AI */}
              {/* ============================================================= */}
              {activeTab === "prompt" && (
                <div className="bg-white border border-slate-200/90 rounded-2xl p-5 space-y-4 shadow-sm">
                  {/* Prompt Controls Toolbar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
                    {/* Target Platform Selector */}
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                        Send to AI:
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
                        <span className="text-slate-400 font-medium">Detail Level:</span>
                        <select
                          value={densityMode}
                          onChange={(e) => setDensityMode(e.target.value as any)}
                          className="bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-700 font-medium cursor-pointer focus:outline-none focus:border-indigo-400">
                          <option value="smart">Smart</option>
                          <option value="complete">Full Conversation</option>
                          <option value="download">Export (.md)</option>
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
                      <IconInfo className="w-4 h-4 text-slate-500 shrink-0" />
                      <span>
                        Paste this formatted prompt into a new <strong>{targetPlatform.toUpperCase()}</strong> chat.
                        The AI will immediately continue your conversation with full memory and verbatim code.
                      </span>
                    </div>
                    <span className="text-slate-400 font-mono text-[11px] font-semibold shrink-0 ml-3">
                      ~{Math.round((generatedPrompt.length / 4) * 0.75).toLocaleString()} words
                    </span>
                  </div>

                  {/* Code Editor Style Container */}
                  <div
                    className={`relative bg-[#0F172A] border border-slate-800 rounded-xl overflow-hidden flex flex-col shadow-inner transition-all duration-300 ${
                      isPromptExpanded ? "max-h-[640px]" : "max-h-[200px]"
                    }`}>
                    <div className="bg-[#0A0F1D] px-4 py-2 border-b border-slate-800 flex items-center justify-between text-xs font-mono text-slate-400 shrink-0">
                      <div className="flex items-center space-x-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-slate-600" />
                        <span className="w-2.5 h-2.5 rounded-full bg-slate-500" />
                        <span className="w-2.5 h-2.5 rounded-full bg-slate-400" />
                        <span className="ml-2 text-slate-300 font-medium">prompt-for-ai.txt</span>
                      </div>
                      <div className="flex items-center space-x-3">
                        <button
                          type="button"
                          onClick={() => setIsPromptExpanded(!isPromptExpanded)}
                          className="text-slate-400 hover:text-white text-xs font-medium cursor-pointer flex items-center space-x-1 transition-colors">
                          <span>{isPromptExpanded ? "View less" : "View more"}</span>
                          <span className="text-[10px]">{isPromptExpanded ? "▲" : "▼"}</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleCopyPrompt}
                          className="text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer flex items-center space-x-1 transition-colors">
                          <IconCopy className="w-3.5 h-3.5" />
                          <span>{copiedPrompt ? "Copied!" : "Copy to Clipboard"}</span>
                        </button>
                      </div>
                    </div>
                    <pre className="p-4 text-xs font-mono leading-relaxed text-slate-200 overflow-y-auto whitespace-pre-wrap select-text">
                      {generatedPrompt}
                    </pre>

                    {/* Gradient Fade & Corner "View more" / "View less" Action Button */}
                    {!isPromptExpanded && (
                      <div className="absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-[#0F172A] via-[#0F172A]/85 to-transparent pointer-events-none" />
                    )}

                    <div className="absolute bottom-2.5 right-3 z-10">
                      <button
                        type="button"
                        onClick={() => setIsPromptExpanded(!isPromptExpanded)}
                        className="px-3 py-1 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg backdrop-blur-md transition-all cursor-pointer flex items-center space-x-1.5 border border-indigo-400/40">
                        <span>{isPromptExpanded ? "View less" : "View more"}</span>
                        <span className="text-[10px]">{isPromptExpanded ? "▲" : "▼"}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ============================================================= */}
              {/* VIEW 2: CODE SNIPPETS */}
              {/* ============================================================= */}
              {activeTab === "code" && (
                <div className="bg-white border border-slate-200/90 rounded-2xl p-5 space-y-4 shadow-sm">
                  <div className="border-b border-slate-100 pb-3">
                    <h2 className="text-sm font-bold text-slate-900 tracking-tight">
                      Code Snippets ({selectedContext.rawCodeBlocks?.length || 0})
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Code snippets captured directly from the conversation, stored 100% verbatim.
                    </p>
                  </div>

                  {!selectedContext.rawCodeBlocks || selectedContext.rawCodeBlocks.length === 0 ? (
                    <div className="p-12 text-center border border-dashed border-slate-200 rounded-xl text-slate-400 space-y-2">
                      <IconCode className="w-8 h-8 mx-auto text-slate-300" />
                      <p className="text-xs font-bold text-slate-700">No code snippets captured</p>
                      <p className="text-xs text-slate-500 max-w-sm mx-auto">
                        This chat contains conversation exchanges without code blocks.
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
              {/* VIEW 3: FULL CONVERSATION */}
              {/* ============================================================= */}
              {activeTab === "transcript" && (
                <div className="bg-white border border-slate-200/90 rounded-2xl p-5 space-y-4 shadow-sm">
                  <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
                    <div>
                      <h2 className="text-sm font-bold text-slate-900 tracking-tight">
                        Full Conversation ({selectedContext.turns?.length || 0} messages)
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Complete chronological exchange between you and the AI.
                      </p>
                    </div>

                    {selectedContext.turns && selectedContext.turns.length > 3 && (
                      <button
                        type="button"
                        onClick={() => setIsTranscriptExpanded(!isTranscriptExpanded)}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/80 transition-colors cursor-pointer flex items-center space-x-1.5">
                        <span>{isTranscriptExpanded ? "View less" : "View more"}</span>
                        <span className="text-[10px]">{isTranscriptExpanded ? "▲" : "▼"}</span>
                      </button>
                    )}
                  </div>

                  {!selectedContext.turns || selectedContext.turns.length === 0 ? (
                    <div className="p-12 text-center border border-dashed border-slate-200 rounded-xl text-slate-400 space-y-2">
                      <IconMessageSquare className="w-8 h-8 mx-auto text-slate-300" />
                      <p className="text-xs font-bold text-slate-700">No messages recorded</p>
                      <p className="text-xs text-slate-500 max-w-sm mx-auto">
                        This session was saved with distilled summary state memory only.
                      </p>
                    </div>
                  ) : (
                    <div
                      className={`relative transition-all duration-300 ${
                        isTranscriptExpanded || selectedContext.turns.length <= 3
                          ? "max-h-none"
                          : "max-h-[520px] overflow-hidden"
                      }`}>
                      <div className="space-y-4">
                        {selectedContext.turns.map((turn: MessageTurn, idx: number) => {
                          const isUser = turn.role === "user"

                          return (
                            <div
                              key={turn.id || idx}
                              className={`p-4 rounded-xl border select-text space-y-2.5 ${
                                isUser
                                  ? "bg-slate-50/80 border-slate-200/80"
                                  : "bg-white border-slate-200 shadow-2xs"
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
                                    {isUser ? "You" : "AI"}
                                  </span>
                                  <span className="text-[11px] text-slate-400 font-mono">
                                    Message #{idx + 1}
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

                      {/* Gradient Fade & Floating "View more" / "View less" Button */}
                      {!isTranscriptExpanded && selectedContext.turns.length > 3 && (
                        <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-white via-white/85 to-transparent pointer-events-none" />
                      )}

                      {selectedContext.turns.length > 3 && (
                        <div className={`mt-3 flex justify-end ${!isTranscriptExpanded ? "absolute bottom-2.5 right-3 z-10" : ""}`}>
                          <button
                            type="button"
                            onClick={() => setIsTranscriptExpanded(!isTranscriptExpanded)}
                            className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-md transition-all cursor-pointer flex items-center space-x-1.5 border border-indigo-400/40">
                            <span>{isTranscriptExpanded ? "View less" : `View all ${selectedContext.turns.length} messages`}</span>
                            <span className="text-[10px]">{isTranscriptExpanded ? "▲" : "▼"}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ============================================================= */}
              {/* VIEW 4: CHAT SUMMARY */}
              {/* ============================================================= */}
              {activeTab === "state" && (
                <div className="bg-white border border-slate-200/90 rounded-2xl p-6 space-y-4 shadow-sm">
                  <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
                    <div>
                      <h2 className="text-sm font-bold text-slate-900 tracking-tight">
                        Chat Summary
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Clear and to-the-point overview of this conversation.
                      </p>
                    </div>
                  </div>

                  {/* Clean, To-The-Point Summary Card */}
                  {(() => {
                    const summary = generateCleanSummary(selectedContext)
                    return (
                      <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-5 space-y-3.5">
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

                  {/* Shared Links & Resources (Only shown when links exist in this conversation) */}
                  {(() => {
                    const sharedLinks = extractSharedLinks(selectedContext.turns || [])
                    if (sharedLinks.length === 0) return null

                    return (
                      <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-5 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2 text-indigo-700">
                            <IconExternalLink className="w-4 h-4 shrink-0 text-indigo-600" />
                            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                              Shared Links & Resources ({sharedLinks.length})
                            </h3>
                          </div>
                          <span className="text-[11px] text-slate-400">
                            Links visited & shared in this chat
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                          {sharedLinks.map((link, idx) => (
                            <a
                              key={idx}
                              href={link.url}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="group flex items-center justify-between p-2.5 rounded-lg bg-white border border-slate-200/90 hover:border-indigo-400 hover:shadow-xs transition-all cursor-pointer">
                              <div className="flex items-center space-x-2.5 min-w-0 pr-2">
                                <span className="px-1.5 py-0.5 rounded bg-slate-100 group-hover:bg-indigo-50 text-slate-600 group-hover:text-indigo-700 text-[10px] font-mono font-medium shrink-0 transition-colors">
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
            </div>
          ) : (
            /* ===== Empty / Welcoming Studio State ===== */
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="max-w-xl text-center space-y-6">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-indigo-50 border border-indigo-200/80 flex items-center justify-center text-indigo-600 shadow-sm">
                  <IconLayers className="w-7 h-7" />
                </div>

                <div className="space-y-2">
                  <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                    Welcome to Context Bridge
                  </h2>
                  <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                    Continue your conversations across ChatGPT, Claude, and Gemini without losing context or repeating yourself.
                  </p>
                </div>

                {/* 3 Value Pillars */}
                <div className="grid grid-cols-3 gap-3 text-left pt-2">
                  <div className="p-3.5 rounded-xl bg-white border border-slate-200/80 shadow-2xs space-y-1.5">
                    <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                      <IconArrowsRightLeft className="w-4 h-4" />
                    </div>
                    <h3 className="text-xs font-bold text-slate-900">Switch AIs Instantly</h3>
                    <p className="text-[11px] text-slate-500 leading-snug">
                      Move chats from Claude to ChatGPT or Gemini with full context in 1 click.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-white border border-slate-200/80 shadow-2xs space-y-1.5">
                    <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                      <IconCode className="w-4 h-4" />
                    </div>
                    <h3 className="text-xs font-bold text-slate-900">Verbatim Code</h3>
                    <p className="text-[11px] text-slate-500 leading-snug">
                      Code snippets are preserved byte-for-byte, never altered or paraphrased.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-white border border-slate-200/80 shadow-2xs space-y-1.5">
                    <div className="w-7 h-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                      <IconShield className="w-4 h-4" />
                    </div>
                    <h3 className="text-xs font-bold text-slate-900">100% Private</h3>
                    <p className="text-[11px] text-slate-500 leading-snug">
                      Stored exclusively inside your local browser. No servers, zero telemetry.
                    </p>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleLoadDemoSession}
                    className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs hover:shadow transition-all cursor-pointer">
                    <IconDocumentText className="w-4 h-4" />
                    <span>Load Sample Conversation</span>
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
