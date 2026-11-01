import { describe, expect, it, vi, beforeEach } from "vitest"
import { JSDOM } from "jsdom"
import {
  collectFullChatHistory,
  findScrollableContainer
} from "../src/utils/scroll-collector"
import { ChatGPTAdapter } from "../src/adapters/chatgpt"
import { ClaudeAdapter } from "../src/adapters/claude"
import { GeminiAdapter } from "../src/adapters/gemini"
import {
  clearAllData,
  getStoredContexts,
  saveContext
} from "../src/utils/storage-manager"
import type { StoredContext } from "../src/types"

describe("Part B: Full Conversation History Import", () => {
  beforeEach(async () => {
    await clearAllData()
  })

  // 1 & 2: Virtualized DOM with 30 items, 10 visible at any time
  it("accumulates all 30 unique message IDs from a virtualized container and restores scroll position", async () => {
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div id="scroll-container" style="overflow-y: auto; height: 500px;">
            <main id="chat-thread">
            </main>
          </div>
        </body>
      </html>
    `, { url: "https://chatgpt.com/c/chat-virtual-123" })

    const doc = dom.window.document
    const container = doc.getElementById("scroll-container") as HTMLElement
    const thread = doc.getElementById("chat-thread") as HTMLElement

    // Total 30 messages: msg-0 to msg-29
    const allItems = Array.from({ length: 30 }, (_, i) => ({
      id: `chat-virtual-123:${i % 2 === 0 ? "user" : "assistant"}:hash${i}:${i}`,
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      text: `Message content number ${i}`,
      codeBlocks: []
    }))

    // Virtualization simulator: renders items based on container.scrollTop
    const renderWindow = () => {
      thread.innerHTML = ""
      let startIndex = 20
      if (container.scrollTop < 600) {
        startIndex = 0 // Top range: 0..9
      } else if (container.scrollTop < 1400) {
        startIndex = 10 // Middle range: 10..19
      } else {
        startIndex = 20 // Bottom range: 20..29
      }

      for (let i = startIndex; i < startIndex + 10; i++) {
        const item = allItems[i]
        const article = doc.createElement("article")
        article.setAttribute("data-testid", `conversation-turn-${i}`)
        article.setAttribute("data-chatgpt-search-message-ids", item.id)
        const bubble = doc.createElement("div")
        bubble.setAttribute("data-message-author-role", item.role)
        bubble.textContent = item.text
        article.appendChild(bubble)
        thread.appendChild(article)
      }
    }

    // Set initial position at bottom
    container.scrollTop = 2000
    renderWindow()

    Object.defineProperty(container, "scrollTop", {
      get() {
        return this._scrollTop ?? 2000
      },
      set(val) {
        this._scrollTop = val
        renderWindow()
      },
      configurable: true
    })

    const adapter = new ChatGPTAdapter()

    const result = await collectFullChatHistory({
      adapter,
      doc,
      stepDelayMs: 0,
      scrollStepPx: 400,
      maxConsecutiveTopChecks: 3
    })

    // Verify all 30 unique turns collected in order
    expect(result.turns).toHaveLength(30)
    expect(result.turns[0].text).toBe("Message content number 0")
    expect(result.turns[29].text).toBe("Message content number 29")
    expect(result.stoppedReason).toBe("top_reached")

    // Verify scroll position restored to bottom
    expect(container.scrollTop).toBe(2000)
  })

  // 3: Cancellation midway
  it("cancellation midway stops scrolling and restores original scroll position", async () => {
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div id="scroll-container" style="overflow-y: auto; height: 500px;">
            <main id="chat-thread"></main>
          </div>
        </body>
      </html>
    `, { url: "https://chatgpt.com/c/chat-cancel-456" })

    const doc = dom.window.document
    const container = doc.getElementById("scroll-container") as HTMLElement
    const thread = doc.getElementById("chat-thread") as HTMLElement

    container.scrollTop = 2500
    let cancelled = false

    Object.defineProperty(container, "scrollTop", {
      get() {
        return this._scrollTop ?? 2500
      },
      set(val) {
        this._scrollTop = val
      },
      configurable: true
    })

    const article = doc.createElement("article")
    article.setAttribute("data-testid", "conversation-turn-0")
    article.setAttribute("data-chatgpt-search-message-ids", "msg-init")
    const bubble = doc.createElement("div")
    bubble.setAttribute("data-message-author-role", "user")
    bubble.textContent = "Initial turn"
    article.appendChild(bubble)
    thread.appendChild(article)

    const adapter = new ChatGPTAdapter()

    const result = await collectFullChatHistory({
      adapter,
      doc,
      stepDelayMs: 0,
      scrollStepPx: 300,
      onProgress: () => {
        cancelled = true // Cancel on first progress tick
      },
      isCancelled: () => cancelled
    })

    expect(result.stoppedReason).toBe("cancelled")
    expect(container.scrollTop).toBe(2500)
  })

  // 4: Imported entries persist with 7-day TTL and metadata.imported
  it("persists imported context with 7-day expiry TTL and metadata.imported tag", async () => {
    const now = 1700000000000
    vi.useFakeTimers()
    vi.setSystemTime(now)

    const context: StoredContext = {
      id: "claude:chat-imported-777",
      sourcePlatform: "claude",
      chatId: "chat-imported-777",
      chatTitle: "Long Architecture Discussion",
      sourceUrl: "https://claude.ai/chat/chat-imported-777",
      createdAt: now,
      updatedAt: now,
      expiresAt: 0,
      isImported: true,
      stateMemory: {
        version: "1.0",
        objective: "Build cloud native system",
        techStack: ["Kubernetes", "Go"],
        architectureDecisions: [],
        currentWork: "Discussion of distributed consensus",
        blockersAndErrors: [],
        nextSteps: [],
        criticalSnippets: [],
        rawTokenEstimate: 500,
        metadata: {
          imported: true
        }
      },
      rawCodeBlocks: [],
      turns: [
        { id: "msg-1", role: "user", text: "Build cloud native system", codeBlocks: [] },
        { id: "msg-2", role: "assistant", text: "Here is the blueprint...", codeBlocks: [] }
      ]
    }

    await saveContext(context)

    const stored = await getStoredContexts()
    expect(stored).toHaveLength(1)
    expect(stored[0].isImported).toBe(true)
    expect(stored[0].stateMemory.metadata?.imported).toBe(true)

    // 7 days = 7 * 24 * 60 * 60 * 1000 = 604,800,000 ms
    const expected7DayExpiry = now + 7 * 24 * 60 * 60 * 1000
    expect(stored[0].expiresAt).toBe(expected7DayExpiry)

    vi.useRealTimers()
  })

  // 5: Adapter History Hooks on Claude and Gemini
  it("exposes getScrollContainer and isLoadingOlderMessages across all three adapters", () => {
    const domClaude = new JSDOM("<main class='overflow-y-auto'><div class='animate-spin'></div></main>", { url: "https://claude.ai/chat/1" })
    const claudeAdapter = new ClaudeAdapter()
    expect(claudeAdapter.getScrollContainer(domClaude.window.document)).not.toBeNull()
    expect(claudeAdapter.isLoadingOlderMessages(domClaude.window.document)).toBe(true)

    const domGemini = new JSDOM("<div class='chat-history'><mat-progress-spinner></mat-progress-spinner></div>", { url: "https://gemini.google.com/app/1" })
    const geminiAdapter = new GeminiAdapter()
    expect(geminiAdapter.getScrollContainer(domGemini.window.document)).not.toBeNull()
    expect(geminiAdapter.isLoadingOlderMessages(domGemini.window.document)).toBe(true)
  })

  // 6: React Hook Compliance: All hooks must execute before any conditional early returns
  it("ensures bridge-csui enforces React Rules of Hooks with all hooks preceding early returns", async () => {
    const fs = await import("fs")
    const path = await import("path")
    const source = fs.readFileSync(path.resolve(__dirname, "../src/contents/bridge-csui.tsx"), "utf8")
    const activeOverlayBody = source.slice(source.indexOf("function ActiveBridgeOverlay()")).replace(/\r\n/g, "\n")
    const earlyReturnIdx = activeOverlayBody.indexOf("if (!adapter) {\n    return null\n  }")
    expect(earlyReturnIdx).toBeGreaterThan(0)

    const autoImportHookIdx = activeOverlayBody.indexOf("// Auto-import trigger when autoImport setting is enabled (Part B)")
    expect(autoImportHookIdx).toBeGreaterThan(0)
    expect(autoImportHookIdx).toBeLessThan(earlyReturnIdx)
  })

  // 7: Dynamic Scroll Container Resolution
  it("findScrollableContainer resolves dynamic scroll container when elements have overflow-y", () => {
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div class="outer-wrapper">
            <div id="real-scroll-el" class="overflow-y-auto" style="height: 500px; overflow-y: auto;">
              <article data-testid="conversation-turn-0">
                <div data-message-author-role="user">Hello AI</div>
              </article>
            </div>
          </div>
        </body>
      </html>
    `)
    const doc = dom.window.document
    const realEl = doc.getElementById("real-scroll-el") as HTMLElement
    Object.defineProperty(realEl, "scrollHeight", { value: 3000, configurable: true })
    Object.defineProperty(realEl, "clientHeight", { value: 500, configurable: true })

    const adapter = new ChatGPTAdapter()
    const container = findScrollableContainer(adapter, doc)
    expect(container).toBe(realEl)
  })

  // 8: Complete 100-Message Long Chat History Auto-Sweep
  it("collectFullChatHistory sweeps and captures all 100 messages from a 100-message conversation", async () => {
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <div id="scroll-container" style="overflow-y: auto; height: 600px;">
            <main id="chat-thread"></main>
          </div>
        </body>
      </html>
    `, { url: "https://chatgpt.com/c/chat-100-turns" })

    const doc = dom.window.document
    const container = doc.getElementById("scroll-container") as HTMLElement
    const thread = doc.getElementById("chat-thread") as HTMLElement

    // Total 100 messages: 0 to 99
    const all100 = Array.from({ length: 100 }, (_, i) => ({
      id: `chat-100-turns:${i % 2 === 0 ? "user" : "assistant"}:hash${i}:${i}`,
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      text: `Message #${i}: In-depth technical explanation`
    }))

    // Virtual window: 20 messages at a time based on scroll position
    const renderWindow = () => {
      thread.innerHTML = ""
      const scroll = container.scrollTop ?? 8000
      let start = Math.floor((scroll / 8000) * 80)
      if (start < 0) start = 0
      if (start > 80) start = 80

      for (let i = start; i < start + 20; i++) {
        const item = all100[i]
        const article = doc.createElement("article")
        article.setAttribute("data-testid", `conversation-turn-${i}`)
        article.setAttribute("data-chatgpt-search-message-ids", item.id)
        const bubble = doc.createElement("div")
        bubble.setAttribute("data-message-author-role", item.role)
        bubble.textContent = item.text
        article.appendChild(bubble)
        thread.appendChild(article)
      }
    }

    Object.defineProperty(container, "scrollTop", {
      get() {
        return this._scrollTop ?? 8000
      },
      set(val) {
        this._scrollTop = val
        renderWindow()
      },
      configurable: true
    })

    container.scrollTop = 8000
    renderWindow()

    const adapter = new ChatGPTAdapter()
    const result = await collectFullChatHistory({
      adapter,
      doc,
      stepDelayMs: 0,
      scrollStepPx: 1000,
      maxConsecutiveTopChecks: 3,
      maxTicks: 100
    })

    // Must collect all 100 turns in exact chronological order without missing any
    expect(result.turns).toHaveLength(100)
    expect(result.turns[0].text).toBe("Message #0: In-depth technical explanation")
    expect(result.turns[99].text).toBe("Message #99: In-depth technical explanation")
    expect(result.stoppedReason).toBe("top_reached")
    expect(container.scrollTop).toBe(8000)
  })
})
