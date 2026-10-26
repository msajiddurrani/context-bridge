import type {
  AdapterHealthResult,
  InjectionFormat,
  MessageTurn,
  PlatformId,
  StateMemory,
  VerbatimCodeBlock
} from "../types"
import { safeInsertText } from "../utils/dom-insert"
import {
  formatMarkdownPrompt,
  formatStateMemoryPrompt,
  isGenericFillerText,
  isInjectedTurn,
  stripInjectedContext
} from "../utils/prompt-formatter"
import type { PlatformAdapter } from "./types"

/**
 * Extracts verbatim code blocks from modern CodeMirror 6 code viewers
 * ([data-code-block="true"], [data-markdown-copy="code-block"], .cm-editor, .cm-line)
 * standard <pre> elements, or fenced markdown blocks, preserving newlines and
 * indentation while removing the code block and language labels completely from the cloned prose.
 */
export function extractCodeBlocksFromContainer(
  container: HTMLElement,
  turnIndex: number,
  platformPrefix: string = "chatgpt"
): VerbatimCodeBlock[] {
  const codeBlocks: VerbatimCodeBlock[] = []
  let snippetCount = 0

  // 1. Modern CodeMirror 6 code viewers (ChatGPT current layout from DOM investigator report)
  const cmBlocks = Array.from(
    container.querySelectorAll<HTMLElement>(
      '[data-code-block="true"], [data-markdown-copy="code-block"], .cm-editor, [data-editor-search-surface="true"]'
    )
  )

  cmBlocks.forEach((cmBlock) => {
    // Find outermost code block wrapper so header labels (language, Copy button) are dropped together
    const rootBlock =
      cmBlock.closest<HTMLElement>(
        '[data-code-block="true"], [data-markdown-copy="code-block"], [data-editor-search-surface="true"]'
      ) || cmBlock

    // Guard: if rootBlock was already removed in a prior iteration, skip
    if (!container.contains(rootBlock)) {
      return
    }

    // Find language attribute: e.g. <div class="cm-content" data-language="python">
    const cmContent = rootBlock.querySelector<HTMLElement>(".cm-content, [data-language]") || rootBlock
    let lang =
      cmContent.getAttribute("data-language") ||
      rootBlock.getAttribute("data-language") ||
      rootBlock.querySelector("[data-language]")?.getAttribute("data-language") ||
      ""

    if (!lang) {
      const headerSpan = rootBlock.querySelector<HTMLElement>(".code-header span, [class*='code-header'] span")
      if (headerSpan && headerSpan.textContent?.trim()) {
        lang = headerSpan.textContent.trim().toLowerCase()
      }
    }

    if (!lang) {
      const langClassEl = rootBlock.querySelector('[class*="language-"], [class*="lang-"]')
      if (langClassEl && typeof langClassEl.className === "string") {
        const m = langClassEl.className.match(/(?:language|lang)-([a-zA-Z0-9_-]+)/)
        if (m) lang = m[1]
      }
    }

    if (!lang) {
      lang = "text"
    }

    // Extract lines of code from .cm-line elements. Each .cm-line represents a distinct line of code.
    const lineElements = Array.from(rootBlock.querySelectorAll<HTMLElement>(".cm-line"))
    let code = ""
    if (lineElements.length > 0) {
      code = lineElements
        .map((el) => (el.textContent ?? "").replace(/\r?\n$/, ""))
        .join("\n")
    } else {
      code = cmContent.textContent || rootBlock.textContent || ""
    }

    if (code.trim().length > 0) {
      codeBlocks.push({
        id: `${platformPrefix}-code-${turnIndex}-${snippetCount++}`,
        language: lang.toLowerCase().trim(),
        code: code,
        turnIndex
      })
    }

    // Drop the entire code block container so code and headers ("Python", Copy button)
    // are NOT glued into the prose text
    rootBlock.remove()
  })

  // 2. Standard HTML <pre> elements (classic markdown rendering fallback)
  const pres = Array.from(container.querySelectorAll<HTMLPreElement>("pre"))
  pres.forEach((pre) => {
    if (!container.contains(pre)) return
    const codeEl = pre.querySelector("code")
    const codeText = (codeEl ? codeEl.textContent : pre.textContent) || ""
    let lang = pre.getAttribute("data-language") || "text"
    if (codeEl?.className && typeof codeEl.className === "string") {
      const match = codeEl.className.match(/language-([a-zA-Z0-9_-]+)/)
      if (match) lang = match[1]
    }

    if (codeText.trim().length > 0) {
      codeBlocks.push({
        id: `${platformPrefix}-code-${turnIndex}-${snippetCount++}`,
        language: lang.toLowerCase().trim(),
        code: codeText,
        turnIndex
      })
    }

    pre.remove()
  })

  // 3. Fenced markdown code blocks in text nodes (e.g. within .whitespace-pre-wrap in user turns)
  const doc = container.ownerDocument || document
  const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT, null)
  const textNodesWithFences: Text[] = []
  let textNode: Node | null
  while ((textNode = walker.nextNode())) {
    if (textNode.nodeValue && textNode.nodeValue.includes("```")) {
      textNodesWithFences.push(textNode as Text)
    }
  }

  for (const node of textNodesWithFences) {
    const val = node.nodeValue || ""
    const fenceRegex = /```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g
    let match: RegExpExecArray | null
    let hasMatch = false
    while ((match = fenceRegex.exec(val)) !== null) {
      hasMatch = true
      const lang = (match[1] || "text").toLowerCase().trim()
      const code = match[2]
      if (code.trim().length > 0) {
        codeBlocks.push({
          id: `${platformPrefix}-code-${turnIndex}-${snippetCount++}`,
          language: lang,
          code: code.replace(/\r\n/g, "\n"),
          turnIndex
        })
      }
    }
    if (hasMatch) {
      node.nodeValue = val.replace(/```[a-zA-Z0-9_-]*\n?[\s\S]*?```/g, "").trim()
    }
  }

  return codeBlocks
}

export interface ChatGptContainerDebug {
  index: number
  role: "user" | "assistant"
  finalMessageId: string | null
  idSourceAttr: string | null
  skipReason: string | null
}

export interface ChatGptGetMessagesDebugSummary {
  containersFound: number
  turnsReturned: number
  containers: ChatGptContainerDebug[]
  timestamp: number
}

export class ChatGPTAdapter implements PlatformAdapter {
  readonly id: PlatformId = "chatgpt"
  readonly displayName = "ChatGPT"

  lastDebugSummary: ChatGptGetMessagesDebugSummary | null = null

  getLastDebugSummary(): ChatGptGetMessagesDebugSummary | null {
    return this.lastDebugSummary
  }

  matches(url: string): boolean {
    try {
      const parsed = new URL(url)
      return parsed.hostname === "chatgpt.com" || parsed.hostname.endsWith(".chatgpt.com")
    } catch {
      return url.includes("chatgpt.com")
    }
  }

  getChatId(url: string, _doc?: Document): string {
    // Primary & ONLY source of real chatId: Server-minted permalink in URL (/c/<id>)
    // Invariant: Never derive real chatId from the DOM or sidebar links to prevent cross-chat leakage
    try {
      const parsed = new URL(url)
      const match = parsed.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/)
      if (match) {
        return match[1]
      }
    } catch {
      // Ignore URL parse error
    }

    return ""
  }

  getChatTitle(doc: Document): string {
    // Only query explicit conversation header elements; NEVER query sidebar nav links (nav a[aria-current="page"])
    const titleEl = doc.querySelector<HTMLElement>(
      'header h1, [data-testid="conversation-title"]'
    )
    if (titleEl && titleEl.textContent?.trim()) {
      const text = titleEl.textContent.trim()
      if (!isGenericFillerText(text)) return text
    }
    const cleanDocTitle = doc.title
      .replace(/^ChatGPT\s*[-–—|]?\s*/i, "")
      .replace(/\s*[-–—|]\s*ChatGPT.*$/i, "")
      .trim()
    if (cleanDocTitle && !isGenericFillerText(cleanDocTitle)) {
      return cleanDocTitle
    }
    return ""
  }

  lastMatchedSelector = "none"

  isNewOrEmptyChat(doc: Document): boolean {
    const container = this.getChatContainer(doc) || doc
    const messages = container.querySelectorAll(
      '[data-chatgpt-search-unit-key$=":user"], [data-chatgpt-search-unit-key$=":assistant"], ' +
      '[data-content-search-unit-key$=":user"], [data-content-search-unit-key$=":assistant"], ' +
      '[data-user-message-bubble="true"], [data-markdown-text-style="assistant-message"], ' +
      '[data-message-author-role], [data-testid^="conversation-turn-"], article'
    )
    return messages.length === 0
  }

  getMessages(doc: Document): MessageTurn[] {
    const turns: MessageTurn[] = []
    const container = this.getChatContainer(doc) || doc.body

    // 1. Modern ChatGPT organizes every conversation turn into an article or conversation-turn container.
    // Query turn containers first so both user prompt and assistant response bubbles are captured together.
    const turnContainers = Array.from(
      container.querySelectorAll<HTMLElement>(
        '[data-testid^="conversation-turn-"], [data-testid="conversation-turn"], article'
      )
    )

    let rawElements: HTMLElement[] = []
    let matchedStrategy = ""

    if (turnContainers.length > 0) {
      rawElements = turnContainers
      matchedStrategy = '[data-testid^="conversation-turn"], article'
    } else {
      // 2. Fallback for search views or legacy markup lacking article containers
      const candidateSelector = [
        '[data-chatgpt-search-unit-key$=":user"]',
        '[data-chatgpt-search-unit-key$=":assistant"]',
        '[data-content-search-unit-key$=":user"]',
        '[data-content-search-unit-key$=":assistant"]',
        '[data-user-message-bubble="true"]',
        '[data-markdown-text-style="assistant-message"]',
        '[data-message-author-role="user"]',
        '[data-message-author-role="assistant"]'
      ].join(", ")
      rawElements = Array.from(container.querySelectorAll<HTMLElement>(candidateSelector))
      matchedStrategy = candidateSelector
    }

    if (rawElements.length === 0) {
      this.lastMatchedSelector = "none"
      this.lastDebugSummary = {
        containersFound: 0,
        turnsReturned: 0,
        containers: [],
        timestamp: Date.now()
      }
      return []
    }

    this.lastMatchedSelector = matchedStrategy

    // Deduplicate: If an element is a descendant of another matched element in the list,
    // only keep the outermost container to avoid duplicate turns
    const topLevelElements: HTMLElement[] = []
    for (const el of rawElements) {
      const isNestedInExisting = topLevelElements.some((existing) => existing !== el && existing.contains(el))
      if (!isNestedInExisting) {
        topLevelElements.push(el)
      }
    }

    const seenTurnIds = new Set<string>()
    // A1 FIX: also track real message ids to collapse nested elements sharing the same id
    const seenMessageIds = new Set<string>()
    const containerLogs: ChatGptContainerDebug[] = []

    topLevelElements.forEach((el, index) => {
      // Determine unit key or identifier
      const unitKey =
        el.getAttribute("data-chatgpt-search-unit-key") ||
        el.getAttribute("data-content-search-unit-key") ||
        el.getAttribute("data-turn-key") ||
        el.getAttribute("data-testid") ||
        `turn-${index}`

      if (seenTurnIds.has(unitKey)) {
        containerLogs.push({
          index,
          role: "assistant",
          finalMessageId: null,
          idSourceAttr: null,
          skipReason: "duplicate"
        })
        return
      }
      seenTurnIds.add(unitKey)

      // Snapshot validation: Drop foreign turns belonging to another chat ID,
      // but ONLY check attributes on the turn itself or its inner content, NEVER climbing up to <main>
      // or document root which may retain the previous chat's ID in Next.js SPA navigation.
      const turnContainer = el.closest("article, [data-testid^='conversation-turn-']") || el
      const turnConvId =
        el.getAttribute("data-chatgpt-selection-conversation-id") ||
        el.querySelector("[data-chatgpt-selection-conversation-id]")?.getAttribute("data-chatgpt-selection-conversation-id") ||
        (turnContainer !== el && !turnContainer.matches("main, body")
          ? turnContainer.getAttribute("data-chatgpt-selection-conversation-id")
          : null)

      const url = doc.defaultView?.location?.href || (doc as any).location?.href || ""
      const urlChatId = this.getChatId(url, doc)

      if (turnConvId && !turnConvId.startsWith("local-")) {
        if (urlChatId && turnConvId !== urlChatId) {
          containerLogs.push({
            index,
            role: "assistant",
            finalMessageId: null,
            idSourceAttr: null,
            skipReason: "conversation-id mismatch"
          })
          // Drop foreign turn belonging to another conversation
          return
        }
      }

      // Determine role strictly and reliably
      let role: "user" | "assistant" = "assistant"
      const hasUserBubble =
        unitKey.endsWith(":user") ||
        el.hasAttribute("data-user-message-bubble") ||
        el.querySelector('[data-user-message-bubble="true"]') !== null ||
        el.getAttribute("data-message-author-role") === "user" ||
        el.querySelector('[data-message-author-role="user"]') !== null ||
        el.classList.contains("group/user-message") ||
        el.querySelector('.group\\/user-message') !== null

      const hasAssistantBubble =
        unitKey.endsWith(":assistant") ||
        el.hasAttribute("data-markdown-text-style") ||
        el.querySelector('[data-markdown-text-style="assistant-message"]') !== null ||
        el.getAttribute("data-message-author-role") === "assistant" ||
        el.querySelector('[data-message-author-role="assistant"]') !== null ||
        el.hasAttribute("data-dil-message-id") ||
        el.querySelector('[data-dil-message-id]') !== null ||
        el.querySelector('.markdown, div[class*="markdown"], .prose, div[class*="prose"]') !== null ||
        el.querySelector('[data-testid="message-actions"], [role="toolbar"]') !== null

      if (hasUserBubble && !hasAssistantBubble) {
        role = "user"
      } else if (hasAssistantBubble) {
        role = "assistant"
      } else {
        const childAuthor = el.querySelector("[data-message-author-role]")?.getAttribute("data-message-author-role")
        if (childAuthor === "user") role = "user"
        else if (childAuthor === "assistant") role = "assistant"
        else role = index % 2 === 0 ? "user" : "assistant"
      }

      // Assistant messages format text in .markdown, div.prose, [data-markdown-text-style="assistant-message"], etc.
      // User messages format text in [data-user-message-bubble], .whitespace-pre-wrap, or .text-size-chat
      const targetContainer =
        (role === "assistant"
          ? el.querySelector<HTMLElement>(
              '.markdown, div[class*="markdown"], .prose, div[class*="prose"], [data-markdown-text-style="assistant-message"], [data-message-author-role="assistant"]'
            )
          : el.querySelector<HTMLElement>(
              '[data-user-message-bubble="true"], .whitespace-pre-wrap, .text-size-chat, [data-message-author-role="user"]'
            )) || el

      const clone = targetContainer.cloneNode(true) as HTMLElement

      // Extract alt text or aria labels from images/diagrams before text extraction (Requirement d)
      clone.querySelectorAll<HTMLImageElement>("img[alt], [role='img'][aria-label]").forEach((img) => {
        const alt = img.getAttribute("alt") || img.getAttribute("aria-label") || ""
        if (alt.trim()) {
          const textNode = (clone.ownerDocument || doc).createTextNode(` [Image: ${alt.trim()}] `)
          img.parentNode?.replaceChild(textNode, img)
        }
      })

      // Remove UI action buttons (Copy, Read aloud, Thumb up/down, action toolbars, and injected ctx tags)
      // Do not strip content widget buttons or option lists
      clone
        .querySelectorAll(
          'svg, [role="toolbar"], [aria-label*="Copy"], [aria-label*="Good response"], [aria-label*="Bad response"], [aria-label*="Read aloud"], [data-testid="message-actions"], ctx'
        )
        .forEach((btn) => btn.remove())

      // Extract verbatim code blocks from CodeMirror 6, <pre>, or markdown text, removing them from prose
      const codeBlocks = extractCodeBlocksFromContainer(clone, index, "chatgpt")

      const rawText = (clone.textContent || "").replace(/\n{3,}/g, "\n\n").trim()

      // Exclude previously injected Context Bridge handover prompt (Directive 4 & Design H)
      if (rawText.length > 0 && isInjectedTurn(rawText)) {
        console.debug(`[ContextBridge ChatGPT] Skipping previously injected Context Bridge turn: ${unitKey}`)
        containerLogs.push({
          index,
          role,
          finalMessageId: null,
          idSourceAttr: null,
          skipReason: "injected-handshake"
        })
        return
      }

      const cleanedText = stripInjectedContext(rawText)

      // A1 FIX: Identity uses ONLY real message-id attributes — NEVER the unit key alone.
      // The unit key (e.g. "fallback-turn-1:0:user") restarts at 1 for every chat.
      // Real DOM facts: data-chatgpt-search-message-ids can contain the UUID twice separated by space.
      // We parse by splitting on whitespace, de-duplicating, and taking the first id.
      const rawSearchId =
        el.getAttribute("data-chatgpt-search-message-ids") ||
        el.querySelector("[data-chatgpt-search-message-ids]")?.getAttribute("data-chatgpt-search-message-ids") ||
        el.closest("[data-chatgpt-search-message-ids]")?.getAttribute("data-chatgpt-search-message-ids")

      const rawSelectionId =
        el.getAttribute("data-chatgpt-selection-message-id") ||
        el.querySelector("[data-chatgpt-selection-message-id]")?.getAttribute("data-chatgpt-selection-message-id") ||
        el.closest("[data-chatgpt-selection-message-id]")?.getAttribute("data-chatgpt-selection-message-id")

      const rawMsgId =
        el.getAttribute("data-message-id") ||
        el.querySelector("[data-message-id]")?.getAttribute("data-message-id") ||
        el.closest("[data-message-id]")?.getAttribute("data-message-id")

      const rawDilId =
        el.getAttribute("data-dil-message-id") ||
        el.querySelector("[data-dil-message-id]")?.getAttribute("data-dil-message-id") ||
        el.closest("[data-dil-message-id]")?.getAttribute("data-dil-message-id")

      const rawTurnKey =
        el.getAttribute("data-turn-key") ||
        el.closest("[data-turn-key]")?.getAttribute("data-turn-key") ||
        el.querySelector("[data-turn-key]")?.getAttribute("data-turn-key")

      const parseFirstId = (raw: string | null | undefined): string | null => {
        if (!raw || !raw.trim()) return null
        const parts = raw.trim().split(/\s+/).filter(Boolean)
        return parts.length > 0 ? parts[0] : null
      }

      let turnMsgId: string | null = null
      let idSourceAttr: string | null = null

      if (rawSearchId) {
        const parsed = parseFirstId(rawSearchId)
        if (parsed) {
          turnMsgId = parsed
          idSourceAttr = "data-chatgpt-search-message-ids"
        }
      }
      if (!turnMsgId && rawSelectionId) {
        const parsed = parseFirstId(rawSelectionId)
        if (parsed) {
          turnMsgId = parsed
          idSourceAttr = "data-chatgpt-selection-message-id"
        }
      }
      if (!turnMsgId && rawMsgId) {
        const parsed = parseFirstId(rawMsgId)
        if (parsed) {
          turnMsgId = parsed
          idSourceAttr = "data-message-id"
        }
      }
      if (!turnMsgId && rawDilId) {
        const parsed = parseFirstId(rawDilId)
        if (parsed) {
          turnMsgId = parsed
          idSourceAttr = "data-dil-message-id"
        }
      }
      if (!turnMsgId && rawTurnKey) {
        const parsed = parseFirstId(rawTurnKey)
        if (parsed) {
          turnMsgId = `${parsed}:${role}`
          idSourceAttr = "data-turn-key"
        }
      }

      // If server message id attributes are absent (common on user prompt bubbles and live assistant turns in Chrome),
      // assign a deterministic chat-scoped id so the turn is never dropped,
      // and cannot collide with turns from any other conversation in the ownership registry.
      if (!turnMsgId) {
        const effectiveChatId = urlChatId || turnConvId || "active-chat"
        turnMsgId = `${effectiveChatId}:${unitKey || `turn-${index}`}:${role}`
        idSourceAttr = "chat-scoped-fallback"
      }

      // Within one chat, collapse duplicate message ids (nested elements sharing the same real id).
      if (seenMessageIds.has(turnMsgId)) {
        console.debug(`[ContextBridge ChatGPT] Collapsing duplicate message id ${turnMsgId} at index ${index}`)
        containerLogs.push({
          index,
          role,
          finalMessageId: turnMsgId,
          idSourceAttr,
          skipReason: "duplicate"
        })
        return
      }
      seenMessageIds.add(turnMsgId)

      // CRITICAL INVARIANT: Save turn if it contains prose text OR verbatim code blocks.
      // Filter out turns that are merely generic placeholder / filler text (Directive 3)
      if ((cleanedText.length > 0 && !isGenericFillerText(cleanedText)) || codeBlocks.length > 0) {
        turns.push({
          id: turnMsgId,
          role,
          text: cleanedText,
          codeBlocks,
          timestamp: Date.now(),
          // chatId is ALWAYS the current chat's URL id; ownership validation in storage-manager
          // will drop this turn if the message id was previously claimed by another chat.
          chatId: urlChatId || "",
          idSourceAttr: idSourceAttr || undefined,
          conversationId: turnConvId || undefined
        })
        containerLogs.push({
          index,
          role,
          finalMessageId: turnMsgId,
          idSourceAttr,
          skipReason: null
        })
      } else {
        containerLogs.push({
          index,
          role,
          finalMessageId: turnMsgId,
          idSourceAttr,
          skipReason: role === "assistant" ? "skipped-unreadable" : "filler-or-empty"
        })
      }
    })

    this.lastDebugSummary = {
      containersFound: topLevelElements.length,
      turnsReturned: turns.length,
      containers: containerLogs,
      timestamp: Date.now()
    }

    return turns
  }

  getInputBox(doc: Document): HTMLElement | null {
    // Primary: form[data-chatgpt-composer] div.ProseMirror[role="textbox"]
    const selectors = [
      'form[data-chatgpt-composer] div.ProseMirror[role="textbox"]',
      'form[data-chatgpt-composer] div[contenteditable="true"]',
      'div.tiptap.ProseMirror[role="textbox"]',
      'div.ProseMirror[role="textbox"]',
      '#prompt-textarea',
      'form div[contenteditable="true"]',
      'form textarea',
      'textarea'
    ]

    for (const sel of selectors) {
      const el = doc.querySelector<HTMLElement>(sel)
      if (el) return el
    }
    return null
  }

  getChatContainer(doc: Document): HTMLElement | null {
    const inputBox = this.getInputBox(doc)
    if (inputBox) {
      const threadContainer = inputBox.closest<HTMLElement>(
        '.thread-scroll-container, [data-app-action-timeline-scroll], [data-request-input-activity-root="true"], main'
      )
      if (threadContainer) return threadContainer
    }

    const selectors = [
      'main.dframe-content',
      'main[data-perf-region="main"]',
      '.thread-scroll-container',
      'main',
      '#prompt-textarea'
    ]

    for (const sel of selectors) {
      const el = doc.querySelector<HTMLElement>(sel)
      if (el) {
        return el.closest("main") || el
      }
    }
    return doc.body
  }

  insertText(target: HTMLElement, text: string): boolean {
    return safeInsertText(target, text)
  }

  healthCheck(doc: Document): AdapterHealthResult {
    const issues: string[] = []
    const inputBox = this.getInputBox(doc)
    if (!inputBox) {
      issues.push(
        "ChatGPT prompt input box not found. Expected: form[data-chatgpt-composer] div.ProseMirror[role='textbox'] or #prompt-textarea."
      )
    }

    const messages = this.getMessages(doc)
    const href = doc.defaultView?.location?.href || (doc as any).location?.href || ""
    const isPermalink = href.includes("/c/")
    const isNew = !isPermalink && this.isNewOrEmptyChat(doc)

    if (messages.length === 0 && (!isNew || isPermalink)) {
      issues.push(
        `ChatGPT conversation messages not found. Primary attributes [data-chatgpt-search-unit-key$=':user'] and [data-chatgpt-search-unit-key$=':assistant'] not detected in DOM.`
      )
    }

    return {
      platform: this.id,
      ok: issues.length === 0,
      inputBoxFound: Boolean(inputBox),
      messagesFound: messages.length > 0,
      lastChecked: Date.now(),
      issues
    }
  }

  formatFor(memory: StateMemory, fromPlatform: PlatformId, format: InjectionFormat = "markdown"): string {
    if (format === "xml") {
      return formatStateMemoryPrompt(memory, fromPlatform, this.id)
    }
    return formatMarkdownPrompt(memory, fromPlatform, this.id)
  }
}
