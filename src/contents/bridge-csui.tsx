import type { PlasmoCSConfig, PlasmoGetStyle } from "plasmo"
import { useEffect, useRef, useState } from "react"
import { getAdapterForUrl } from "../adapters"
import type { PlatformAdapter } from "../adapters/types"
import type { StoredContext, VerbatimCodeBlock } from "../types"
import { getStoredContexts } from "../utils/storage-manager"
import cssText from "data-text:../style.css"

export const config: PlasmoCSConfig = {
  matches: [
    "https://claude.ai/*",
    "https://chatgpt.com/*",
    "https://*.chatgpt.com/*",
    "https://gemini.google.com/*",
    "https://perplexity.ai/*",
    "https://*.perplexity.ai/*",
    "https://chat.deepseek.com/*",
    "https://grok.com/*"
  ],
  run_at: "document_idle"
}

export const getStyle: PlasmoGetStyle = () => {
  const style = document.createElement("style")
  style.textContent = cssText.replaceAll(":root", ":host(plasmo-csui)")
  return style
}

function computeHash(turns: any[]): string {
  if (turns.length === 0) return ""
  const last = turns[turns.length - 1]
  return `${turns.length}:${last?.role || ""}:${(last?.text || "").slice(0, 40)}`
}

function timeAgo(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp)
  const mins = Math.floor(elapsed / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

// Monkeypatch history for SPA in-app navigation interception (e.g. ChatGPT / Claude client-side routing)
if (typeof window !== "undefined" && !(window as any).__cb_history_patched) {
  ;(window as any).__cb_history_patched = true
  const origPush = history.pushState
  const origReplace = history.replaceState

  history.pushState = function (...args) {
    const res = origPush.apply(this, args)
    window.dispatchEvent(new Event("contextbridge:navigation"))
    return res
  }

  history.replaceState = function (...args) {
    const res = origReplace.apply(this, args)
    window.dispatchEvent(new Event("contextbridge:navigation"))
    return res
  }
}

export default function UniversalContextBridgeOverlay() {
  const [adapter, setAdapter] = useState<PlatformAdapter | null>(null)
  const [contexts, setContexts] = useState<StoredContext[]>([])
  const [selectedContextId, setSelectedContextId] = useState<string>("")
  const [isNewChat, setIsNewChat] = useState<boolean>(false)
  const [isOpenMenu, setIsOpenMenu] = useState<boolean>(false)
  const [injectStatus, setInjectStatus] = useState<"idle" | "success" | "error">("idle")
  const [statusMessage, setStatusMessage] = useState<string>("")
  const [isMinimized, setIsMinimized] = useState<boolean>(false)
  const [currentUrl, setCurrentUrl] = useState<string>(
    typeof window !== "undefined" ? window.location.href : ""
  )

  const lastObservedUrlRef = useRef<string>(
    typeof window !== "undefined" ? window.location.href : ""
  )
  const lastHashRef = useRef<string>("")
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  // 1. Resolve current platform adapter on mount & URL changes
  useEffect(() => {
    const handleUrlChange = () => {
      const href = window.location.href
      const matched = getAdapterForUrl(href)
      setAdapter(matched)
      if (matched) {
        setIsNewChat(matched.isNewOrEmptyChat(document))
      }

      if (href !== lastObservedUrlRef.current) {
        if (matched) {
          console.debug(
            `[ContextBridge ${matched.displayName}] In-app SPA navigation detected: ${href.split("?")[0]}`
          )
        }
        lastObservedUrlRef.current = href
        lastHashRef.current = "" // Reset turn hash on chat navigation so fresh context is captured
        setCurrentUrl(href)
      }
    }

    handleUrlChange()

    // Listen for SPA history pushState/replaceState and popstate
    window.addEventListener("contextbridge:navigation", handleUrlChange)
    window.addEventListener("popstate", handleUrlChange)
    window.addEventListener("hashchange", handleUrlChange)

    // Polling fallback heartbeat for SPAs that mutate history silently
    const navInterval = setInterval(handleUrlChange, 1000)

    return () => {
      window.removeEventListener("contextbridge:navigation", handleUrlChange)
      window.removeEventListener("popstate", handleUrlChange)
      window.removeEventListener("hashchange", handleUrlChange)
      clearInterval(navInterval)
    }
  }, [])

  // 2. Fetch available stored contexts from storage
  const refreshContexts = async () => {
    try {
      const all = await getStoredContexts()
      setContexts(all)
    } catch {
      // Fallback
    }
  }

  useEffect(() => {
    refreshContexts()
    const timer = setInterval(refreshContexts, 5000)
    return () => clearInterval(timer)
  }, [])

  // 3. Robust Continuous Auto-Save Engine for SPA lifecycles
  useEffect(() => {
    if (!adapter) return

    console.debug(
      `[ContextBridge ${adapter.displayName}] Content script started on: ${window.location.pathname}`
    )
    console.debug(`[ContextBridge ${adapter.displayName}] Adapter selected: ${adapter.id}`)

    let chatObserver: MutationObserver | null = null
    let containerWaitObserver: MutationObserver | null = null
    let isCleanedUp = false

    const runObserverCheck = () => {
      if (isCleanedUp || !adapter) return
      const currentChatId = adapter.getChatId(window.location.href, document)
      const currentTitle = adapter.getChatTitle(document)
      const turns = adapter.getMessages(document)
      const emptyCheck = adapter.isNewOrEmptyChat(document)
      setIsNewChat(emptyCheck)

      console.debug(
        `[ContextBridge ${adapter.displayName}] getMessages() count: ${turns.length} (isNewOrEmpty: ${emptyCheck})`
      )

      if (turns.length === 0) {
        // If chat is supposed to be active (not new) but 0 turns extracted, test adapter health
        if (!emptyCheck) {
          const health = adapter.healthCheck(document)
          if (!health.ok) {
            console.warn(
              `[ContextBridge ${adapter.displayName}] HealthCheck failed on non-empty chat:`,
              health.issues
            )
            chrome.runtime.sendMessage({
              type: "REPORT_ADAPTER_ERROR",
              payload: {
                platform: adapter.id,
                issue: health.issues.join("; ")
              }
            })
          }
        }
        return
      }

      const hash = computeHash(turns)
      if (hash === lastHashRef.current) return
      lastHashRef.current = hash

      // Collect all verbatim code blocks
      const rawCodeBlocks: VerbatimCodeBlock[] = []
      turns.forEach((turn) => {
        if (turn.codeBlocks && turn.codeBlocks.length > 0) {
          rawCodeBlocks.push(...turn.codeBlocks)
        }
      })

      // Format raw transcript
      const rawTranscript = turns
        .map((t) => `### ${t.role.toUpperCase()}:\n${t.text}`)
        .join("\n\n---\n\n")

      console.debug(
        `[ContextBridge ${adapter.displayName}] Dispatching AUTO_SAVE_TRANSCRIPT (turns: ${turns.length}, codeBlocks: ${rawCodeBlocks.length})`
      )

      // Dispatch auto-save to background worker
      try {
        chrome.runtime.sendMessage(
          {
            type: "AUTO_SAVE_TRANSCRIPT",
            payload: {
              sourcePlatform: adapter.id,
              chatId: currentChatId,
              chatTitle: currentTitle,
              sourceUrl: window.location.href,
              rawTranscript,
              rawCodeBlocks
            }
          },
          (res) => {
            if (chrome.runtime.lastError) {
              console.warn(
                `[ContextBridge ${adapter.displayName}] Background message error:`,
                chrome.runtime.lastError.message
              )
              return
            }
            if (res?.success) {
              console.debug(
                `[ContextBridge ${adapter.displayName}] Background received and saved context: ${res.contextId}`
              )
              refreshContexts()
            } else {
              console.warn(
                `[ContextBridge ${adapter.displayName}] Background REJECTED or failed auto-save: ${res?.error}`
              )
            }
          }
        )
      } catch (err: any) {
        console.warn(`[ContextBridge ${adapter.displayName}] Failed to send message:`, err?.message)
      }
    }

    const scheduleCheck = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(runObserverCheck, 1500)
    }

    const attachToChatContainer = (containerEl: HTMLElement) => {
      if (isCleanedUp) return

      const tagDesc = `${containerEl.tagName.toLowerCase()}${containerEl.id ? "#" + containerEl.id : ""}`
      console.debug(`[ContextBridge ${adapter.displayName}] Chat container found: ${tagDesc}`)

      chatObserver = new MutationObserver((mutations) => {
        let isRelevant = false
        for (const m of mutations) {
          if (m.type === "childList" && m.addedNodes.length > 0) {
            isRelevant = true
            break
          }
          if (m.type === "characterData") {
            isRelevant = true
            break
          }
        }
        if (isRelevant) {
          scheduleCheck()
        }
      })

      chatObserver.observe(containerEl, {
        childList: true,
        subtree: true,
        characterData: true
      })

      console.debug(
        `[ContextBridge ${adapter.displayName}] MutationObserver attached to container (${tagDesc})`
      )

      // Run initial scrape check
      scheduleCheck()
    }

    // Wait for chat container to exist in SPA DOM if hydrating
    const resolvedContainer = adapter.getChatContainer
      ? adapter.getChatContainer(document)
      : document.body

    const hasInputOrMessages = Boolean(
      adapter.getInputBox(document) ||
        document.querySelector("[data-message-author-role]") ||
        document.querySelector("article") ||
        document.querySelector("main")
    )

    if (resolvedContainer && hasInputOrMessages) {
      attachToChatContainer(resolvedContainer)
    } else {
      console.debug(
        `[ContextBridge ${adapter.displayName}] Waiting for chat container to mount in DOM...`
      )
      containerWaitObserver = new MutationObserver(() => {
        const target = adapter.getChatContainer
          ? adapter.getChatContainer(document)
          : document.body
        const ready = Boolean(
          adapter.getInputBox(document) ||
            document.querySelector("[data-message-author-role]") ||
            document.querySelector("article") ||
            document.querySelector("main")
        )

        if (target && ready) {
          containerWaitObserver?.disconnect()
          containerWaitObserver = null
          attachToChatContainer(target)
        }
      })

      containerWaitObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
      })
    }

    // Auto-save on visibility change (developer switches tabs/windows)
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        runObserverCheck()
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange)

    return () => {
      isCleanedUp = true
      if (chatObserver) {
        chatObserver.disconnect()
        chatObserver = null
      }
      if (containerWaitObserver) {
        containerWaitObserver.disconnect()
        containerWaitObserver = null
      }
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [adapter, currentUrl])


  if (!adapter) {
    return null
  }

  // Filter out contexts from the CURRENT chat to prevent circular loops
  const currentChatId = adapter.getChatId(currentUrl || window.location.href, document)

  const eligibleContexts = contexts.filter((c) => {
    const isSameChat = c.sourcePlatform === adapter.id && c.chatId === currentChatId
    const isSameUrl = c.sourceUrl && c.sourceUrl === (currentUrl || window.location.href)
    return !isSameChat && !isSameUrl
  })


  // Determine primary candidate to highlight
  const primaryContext =
    eligibleContexts.find((c) => c.id === selectedContextId) || eligibleContexts[0]

  const handleInject = (targetContext: StoredContext) => {
    if (!targetContext) {
      setInjectStatus("error")
      setStatusMessage("No context selected to inject.")
      setTimeout(() => setInjectStatus("idle"), 3000)
      return
    }

    const inputBox = adapter.getInputBox(document)
    if (!inputBox) {
      setInjectStatus("error")
      setStatusMessage("Prompt input box not found. Please click into input.")
      setTimeout(() => setInjectStatus("idle"), 4000)
      return
    }

    // Format StateMemory specifically for current platform
    const promptText = adapter.formatFor(targetContext.stateMemory, targetContext.sourcePlatform)

    // Safely insert text into input box (NEVER auto-submits)
    const success = adapter.insertText(inputBox, promptText)

    if (success) {
      setInjectStatus("success")
      setStatusMessage(`Injected context from ${targetContext.sourcePlatform.toUpperCase()}!`)
      setIsOpenMenu(false)
      setTimeout(() => {
        setInjectStatus("idle")
        setStatusMessage("")
      }, 3000)
    } else {
      setInjectStatus("error")
      setStatusMessage("Failed to insert text into input element.")
      setTimeout(() => setInjectStatus("idle"), 3000)
    }
  }

  if (isMinimized) {
    return (
      <div className="fixed bottom-6 right-6 z-[999999] select-none font-sans">
        <button
          onClick={() => setIsMinimized(false)}
          className="flex items-center space-x-2 px-3 py-2 rounded-full bg-[#0D1017]/95 border border-indigo-500/40 text-slate-200 shadow-2xl backdrop-blur-xl hover:border-indigo-400 hover:scale-105 transition-all">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-mono font-semibold text-indigo-400 uppercase">
            Bridge
          </span>
          {eligibleContexts.length > 0 && (
            <span className="px-1.5 py-0.2 text-[10px] bg-indigo-500/20 text-indigo-300 rounded font-mono">
              {eligibleContexts.length}
            </span>
          )}
        </button>
      </div>
    )
  }

  return (
    <aside className="fixed bottom-6 right-6 z-[999999] select-none font-sans flex flex-col items-end space-y-2">
      {/* Context Selection Dropdown Menu */}
      {isOpenMenu && (
        <div className="w-[360px] max-h-[320px] rounded-xl bg-[#0D1017]/95 border border-slate-700/80 shadow-2xl backdrop-blur-xl p-3 space-y-2 text-slate-200 animate-slide-up">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center space-x-1.5 text-xs font-semibold text-slate-200">
              <span className="w-2 h-2 rounded-full bg-indigo-400" />
              <span>Select Context to Inject</span>
            </div>
            <span className="text-[10px] font-mono text-slate-400">
              {eligibleContexts.length} available
            </span>
          </div>

          <div className="max-h-[220px] overflow-y-auto space-y-1.5 pr-1">
            {eligibleContexts.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-4">
                No active contexts from other chats. Start or continue a conversation on Claude, ChatGPT, etc. to auto-save!
              </p>
            ) : (
              eligibleContexts.map((ctx) => (
                <div
                  key={ctx.id}
                  onClick={() => {
                    setSelectedContextId(ctx.id)
                    handleInject(ctx)
                  }}
                  className="p-2.5 rounded-lg bg-[#080A10] border border-slate-800 hover:border-indigo-500/50 hover:bg-indigo-950/20 cursor-pointer transition-all space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="px-1.5 py-0.5 text-[10px] font-mono font-semibold uppercase rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                      {ctx.sourcePlatform}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {timeAgo(ctx.updatedAt)}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 font-medium truncate">
                    {ctx.chatTitle}
                  </p>
                  <p className="text-[11px] text-slate-400 line-clamp-2">
                    {ctx.stateMemory.objective || ctx.stateMemory.currentWork || "Engineering conversation"}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Main Floating Injection Pill */}
      <div className="flex items-center space-x-1.5 p-1 rounded-2xl bg-[#090B10]/95 border border-slate-700/80 shadow-2xl backdrop-blur-2xl transition-all duration-200 hover:border-indigo-500/50">
        <button
          onClick={() => setIsMinimized(true)}
          className="p-2 text-slate-500 hover:text-slate-300 transition-colors rounded-xl hover:bg-slate-800/60"
          title="Minimize">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>

        {/* Primary Action Button */}
        <button
          onClick={() => {
            if (primaryContext) {
              handleInject(primaryContext)
            } else {
              setIsOpenMenu(!isOpenMenu)
            }
          }}
          className={`flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 shadow-md ${
            injectStatus === "success"
              ? "bg-emerald-600 text-white"
              : injectStatus === "error"
              ? "bg-rose-600 text-white"
              : primaryContext && isNewChat
              ? "bg-gradient-to-r from-emerald-600 via-indigo-600 to-purple-600 text-white shadow-indigo-500/30 animate-pulse"
              : primaryContext
              ? "bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white shadow-indigo-500/25"
              : "bg-slate-800 text-slate-400"
          }`}>
          <svg className="w-4 h-4 text-indigo-200" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>

          <span>
            {injectStatus === "success"
              ? "Context Injected!"
              : injectStatus === "error"
              ? "Injection Failed"
              : primaryContext && isNewChat
              ? `Context from ${primaryContext.sourcePlatform.toUpperCase()} (${timeAgo(primaryContext.updatedAt)}) - Inject`
              : primaryContext
              ? `Inject from ${primaryContext.sourcePlatform.toUpperCase()}`
              : "Context Bridge Active"}
          </span>
        </button>

        {/* Dropdown Toggle for Multiple Contexts */}
        {eligibleContexts.length > 0 && (
          <button
            onClick={() => setIsOpenMenu(!isOpenMenu)}
            className={`p-2 rounded-xl transition-colors ${
              isOpenMenu
                ? "bg-indigo-600/30 text-indigo-300 border border-indigo-500/40"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
            }`}
            title="Browse all available contexts">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}
      </div>

      {/* Floating Status Toast */}
      {statusMessage && (
        <div
          className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border shadow-lg backdrop-blur-md animate-fade-in ${
            injectStatus === "success"
              ? "bg-emerald-950/90 border-emerald-500/50 text-emerald-200"
              : "bg-rose-950/90 border-rose-500/50 text-rose-200"
          }`}>
          {statusMessage}
        </div>
      )}
    </aside>
  )
}
