import { useEffect, useState } from "react"
import { getAllAdapters } from "./adapters"
import {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_OPENAI_MODEL,
  type AdapterHealthResult,
  type LastErrorInfo,
  type ProviderSettings,
  type StoredContext
} from "./types"
import {
  clearAllData,
  clearLastError,
  deleteApiKeys,
  deleteContext,
  getLastError,
  getSettings,
  getStoredContexts,
  saveSettings
} from "./utils/storage-manager"
import "./style.css"

export default function IndexPopup() {
  const [activeTab, setActiveTab] = useState<"contexts" | "settings" | "health">("contexts")
  const [settings, setSettings] = useState<ProviderSettings | null>(null)
  const [contexts, setContexts] = useState<StoredContext[]>([])
  const [healthReports, setHealthReports] = useState<AdapterHealthResult[]>([])
  const [selectedContext, setSelectedContext] = useState<StoredContext | null>(null)

  // Settings form state
  const [provider, setProvider] = useState<"gemini" | "openai">("gemini")
  const [geminiApiKey, setGeminiApiKey] = useState<string>("")
  const [geminiModel, setGeminiModel] = useState<string>(DEFAULT_GEMINI_MODEL)
  const [openaiApiKey, setOpenApiKey] = useState<string>("")
  const [openaiModel, setOpenApiModel] = useState<string>(DEFAULT_OPENAI_MODEL)
  const [autoExpiryHours, setAutoExpiryHours] = useState<number>(24)

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

      const ctxList = await getStoredContexts()
      setContexts(ctxList)

      const err = await getLastError()
      setLastError(err)


      // Query active tab to run live healthCheck on current adapter
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0]
        if (activeTab?.url) {
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
  }, [])

  const handleSaveSettings = async () => {
    try {
      await saveSettings({
        provider,
        geminiApiKey,
        geminiModel,
        openaiApiKey,
        openaiModel,
        autoExpiryHours
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
                        <span className="text-xs font-medium text-slate-200 truncate max-w-[180px]">
                          {ctx.chatTitle}
                        </span>
                      </div>
                      <div className="flex items-center space-x-2 text-[10px] text-slate-500 font-mono">
                        <span>{timeAgo(ctx.updatedAt)}</span>
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
                      <span>Tokens: ~{ctx.stateMemory.rawTokenEstimate || 0}</span>
                      <span>Code Blocks: {ctx.rawCodeBlocks?.length || 0}</span>
                      <button
                        onClick={() =>
                          setSelectedContext(selectedContext?.id === ctx.id ? null : ctx)
                        }
                        className="text-indigo-400 hover:text-indigo-300 underline decoration-indigo-500/40">
                        {selectedContext?.id === ctx.id ? "Hide Details" : "View Details"}
                      </button>
                    </div>

                    {/* Detailed State View Modal */}
                    {selectedContext?.id === ctx.id && (
                      <div className="p-2.5 rounded-lg bg-[#07090E] border border-slate-800 text-[11px] font-mono text-slate-300 space-y-2 mt-2">
                        {ctx.stateMemory.techStack?.length > 0 && (
                          <div>
                            <span className="text-indigo-400 font-semibold">Tech Stack:</span>{" "}
                            {ctx.stateMemory.techStack.join(", ")}
                          </div>
                        )}
                        {ctx.stateMemory.nextSteps?.length > 0 && (
                          <div>
                            <span className="text-emerald-400 font-semibold">Next Step:</span>{" "}
                            {ctx.stateMemory.nextSteps[0]}
                          </div>
                        )}
                        {ctx.rawCodeBlocks?.length > 0 && (
                          <div className="space-y-1">
                            <span className="text-purple-400 font-semibold">Verbatim Snippet:</span>
                            <pre className="p-2 rounded bg-black/60 border border-slate-800 text-[10px] overflow-x-auto text-emerald-400">
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
        <span className="text-indigo-400">6 Platforms Active</span>
      </footer>
    </div>
  )
}
