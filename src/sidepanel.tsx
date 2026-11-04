import { useEffect, useState } from "react"
import type {
  InjectionMode,
  PlatformId,
  StoredContext,
  TokenUsageTelemetry,
  ProviderSettings
} from "./types"
import {
  getStoredContexts,
  getTokenTelemetry,
  getSettings
} from "./utils/storage-manager"
import { buildPreviewInjectedText } from "./utils/prompt-preview"
import { formatMarkdownHandoverExport } from "./utils/prompt-formatter"
import "./style.css"

export default function SidePanel() {
  const [contexts, setContexts] = useState<StoredContext[]>([])
  const [selectedContextId, setSelectedContextId] = useState<string>("")
  const [tokenTelemetry, setTokenTelemetry] = useState<TokenUsageTelemetry | null>(null)
  const [settings, setSettings] = useState<ProviderSettings | null>(null)
  const [injectionMode, setInjectionMode] = useState<InjectionMode>("standard")
  const [activeTabInfo, setActiveTabInfo] = useState<{ id?: number; platform: PlatformId | "unknown"; url: string }>({
    platform: "unknown",
    url: ""
  })
  const [statusMessage, setStatusMessage] = useState<string>("")

  const loadData = async () => {
    try {
      const [ctxList, telem, cfg] = await Promise.all([
        getStoredContexts().catch(() => []),
        getTokenTelemetry().catch(() => null),
        getSettings().catch(() => null)
      ])
      setContexts(ctxList)
      if (telem) setTokenTelemetry(telem)
      if (cfg) setSettings(cfg)

      setSelectedContextId((prev) => {
        if (prev && ctxList.some((c) => c.id === prev)) {
          return prev
        }
        return ctxList.length > 0 ? ctxList[0].id : ""
      })

      if (typeof chrome !== "undefined" && chrome.tabs?.query) {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
        const active = tabs[0]
        if (active?.url) {
          let platform: PlatformId | "unknown" = "unknown"
          if (active.url.includes("claude.ai")) platform = "claude"
          else if (active.url.includes("chatgpt.com")) platform = "chatgpt"
          else if (active.url.includes("gemini.google.com")) platform = "gemini"
          setActiveTabInfo({ id: active.id, platform, url: active.url })
        }
      }
    } catch {
      // Ignore in strict contexts
    }
  }

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 3000)
    return () => clearInterval(interval)
  }, [])

  const selectedContext = contexts.find((c) => c.id === selectedContextId) || contexts[0]

  const handleInjectToTab = async (ctx: StoredContext) => {
    if (!activeTabInfo.id || activeTabInfo.platform === "unknown") {
      setStatusMessage("Please focus an active Claude, ChatGPT, or Gemini tab.")
      setTimeout(() => setStatusMessage(""), 3500)
      return
    }

    if (injectionMode === "download") {
      const md = formatMarkdownHandoverExport(ctx, settings?.customResume, settings?.customStyle)
      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `context-bridge-${ctx.sourcePlatform}-${ctx.chatId || "export"}.md`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setStatusMessage("Exported markdown file to downloads!")
      setTimeout(() => setStatusMessage(""), 3500)
      return
    }

    const text = buildPreviewInjectedText(
      ctx,
      activeTabInfo.platform,
      injectionMode,
      "markdown",
      {
        customStyle: settings?.customStyle,
        customResume: settings?.customResume
      }
    )

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      }
      setStatusMessage(`Handover prompt copied! (Target: ${activeTabInfo.platform.toUpperCase()})`)
      setTimeout(() => setStatusMessage(""), 3500)
    } catch {
      setStatusMessage("Failed to copy handover prompt.")
      setTimeout(() => setStatusMessage(""), 3000)
    }
  }

  return (
    <div className="w-full h-screen bg-[#07090E] text-slate-200 font-sans flex flex-col p-3 space-y-3 overflow-y-auto select-none">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center space-x-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-bold text-sm tracking-wide bg-gradient-to-r from-indigo-400 to-emerald-400 bg-clip-text text-transparent">
            Context Bridge
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300">
            Side Panel
          </span>
        </div>
        <div className="text-[10px] font-mono text-slate-400">
          Target: <span className="font-bold uppercase text-emerald-400">{activeTabInfo.platform}</span>
        </div>
      </div>

      {/* Local Sync Status */}
      <div className="p-2.5 rounded-xl bg-[#0D1017] border border-slate-800 flex items-center justify-between text-xs font-mono">
        <span className="text-slate-400 font-semibold">Sync Status</span>
        <span className="text-emerald-400 font-bold flex items-center space-x-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block mr-1" />
          <span>Local (Private)</span>
        </span>
      </div>

      {/* Mode Switcher */}
      <div className="p-2.5 rounded-xl bg-[#0D1017] border border-slate-800 space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
          <span className="font-semibold text-slate-300">Injection Mode</span>
          <span className="text-indigo-400">
            {injectionMode === "compact"
              ? "~500 tok"
              : injectionMode === "smart"
              ? "~1800 tok"
              : injectionMode === "complete"
              ? "Full thread"
              : injectionMode === "download"
              ? ".md file"
              : "~1200 tok"}
          </span>
        </div>
        <div className="grid grid-cols-5 gap-1">
          {(["compact", "standard", "smart", "complete", "download"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setInjectionMode(m)}
              className={`py-1 text-[9px] font-mono rounded capitalize transition-all cursor-pointer ${
                injectionMode === m
                  ? "bg-indigo-600 text-white font-bold shadow-md shadow-indigo-600/30"
                  : "bg-slate-900 text-slate-400 hover:text-slate-200"
              }`}>
              {m === "download" ? "Export" : m}
            </button>
          ))}
        </div>
      </div>

      {/* Status banner if any */}
      {statusMessage && (
        <div className="p-2 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 text-xs font-mono">
          {statusMessage}
        </div>
      )}

      {/* Active Thread Details & Outline */}
      {selectedContext ? (
        <div className="p-3 rounded-xl bg-[#0D1017] border border-slate-800 space-y-2 flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between">
            <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold uppercase rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              {selectedContext.sourcePlatform}
            </span>
            <span className="text-[10px] text-slate-500 font-mono">
              Tokens: ~{selectedContext.stateMemory?.rawTokenEstimate || 100}
            </span>
          </div>

          <p className="text-xs font-semibold text-slate-200 truncate">
            {selectedContext.chatTitle}
          </p>

          {/* Goal & Outline */}
          <div className="space-y-1 bg-[#080A10] p-2 rounded-lg border border-slate-800/80 overflow-y-auto flex-1 text-xs">
            <div className="text-[11px] text-emerald-400 font-mono">
              Objective: {selectedContext.stateMemory?.objective || "Active technical task"}
            </div>
            {selectedContext.stateMemory?.currentWork && (
              <div className="text-[11px] text-slate-300 font-mono whitespace-pre-wrap">
                {selectedContext.stateMemory.currentWork}
              </div>
            )}
            {selectedContext.rawCodeBlocks && selectedContext.rawCodeBlocks.length > 0 && (
              <div className="text-[10px] text-indigo-300 font-mono">
                {selectedContext.rawCodeBlocks.length} code block(s) preserved verbatim
              </div>
            )}
          </div>

          {/* Action button */}
          <button
            onClick={() => handleInjectToTab(selectedContext)}
            className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-lg shadow-md shadow-indigo-600/30 transition-all cursor-pointer">
            {injectionMode === "download" ? "Export .md File" : "Inject into Active Tab"}
          </button>
        </div>
      ) : (
        <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl">
          No saved sessions yet. Start chatting on Claude, ChatGPT, or Gemini to see real-time synchronizations.
        </div>
      )}

      {/* Context List Selector */}
      {contexts.length > 1 && (
        <div className="space-y-1">
          <div className="text-[10px] font-mono text-slate-400 uppercase">Available Contexts</div>
          <div className="max-h-[120px] overflow-y-auto space-y-1 pr-1">
            {contexts.map((c) => (
              <div
                key={c.id}
                onClick={() => setSelectedContextId(c.id)}
                className={`p-2 rounded-lg text-xs font-mono cursor-pointer transition-all flex items-center justify-between border ${
                  selectedContext?.id === c.id
                    ? "bg-indigo-950/40 border-indigo-500/50 text-white"
                    : "bg-[#080A10] border-slate-800/80 text-slate-400 hover:text-slate-200"
                }`}>
                <span className="truncate pr-2">{c.chatTitle}</span>
                <span className="uppercase text-[9px] text-indigo-400">{c.sourcePlatform}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
