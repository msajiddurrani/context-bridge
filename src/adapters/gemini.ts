import type {
  AdapterHealthResult,
  InjectionFormat,
  MessageTurn,
  PlatformId,
  StateMemory,
  VerbatimCodeBlock
} from "../types"
import { safeInsertText } from "../utils/dom-insert"
import { deduplicateCodeBlocks } from "../utils/local-mode"
import { extractStructuredMessageText } from "../utils/text-extractor"
import {
  formatMarkdownPrompt,
  formatStateMemoryPrompt,
  isGenericFillerText,
  isInjectedTurn,
  stripInjectedContext
} from "../utils/prompt-formatter"
import type { PlatformAdapter, RateLimitCheckResult } from "./types"

/**
 * Extracts verbatim code blocks from Gemini's custom <code-block> elements,
 * standard <pre> elements, or fenced markdown blocks, preserving newlines and
 * indentation while removing the code block and language labels completely from cloned prose.
 */
export function extractCodeBlocksFromGeminiContainer(
  container: HTMLElement,
  turnIndex: number,
  platformPrefix: string = "gemini"
): VerbatimCodeBlock[] {
  const codeBlocks: VerbatimCodeBlock[] = []
  let snippetCount = 0

  // 1. Gemini custom <code-block> or .code-block / .code-container wrappers
  const codeBlockEls = Array.from(
    container.querySelectorAll<HTMLElement>(
      'code-block, .code-block, .code-container, [data-code-block="true"]'
    )
  )

  codeBlockEls.forEach((cbEl) => {
    if (!container.contains(cbEl)) return

    let lang =
      cbEl.getAttribute("data-language") ||
      cbEl.getAttribute("language") ||
      ""

    if (!lang) {
      const langHeader = cbEl.querySelector<HTMLElement>(
        '.code-lang-label, .code-header span, [class*="lang-label"], [class*="language-label"]'
      )
      if (langHeader && langHeader.textContent?.trim()) {
        lang = langHeader.textContent.trim().toLowerCase()
      }
    }

    const codeEl = cbEl.querySelector("code")
    const preEl = cbEl.querySelector("pre")

    if (!lang && codeEl?.className) {
      const m = codeEl.className.match(/language-([a-zA-Z0-9_-]+)/)
      if (m) lang = m[1]
    }

    if (!lang) lang = "text"

    const code = (codeEl ? codeEl.textContent : preEl?.textContent || cbEl.textContent) || ""

    if (code.trim().length > 0) {
      codeBlocks.push({
        id: `${platformPrefix}-code-${turnIndex}-${snippetCount++}`,
        language: lang.toLowerCase().trim(),
        code: code.replace(/^\r?\n+|\r?\n+$/g, ""),
        turnIndex
      })
    }

    cbEl.remove()
  })

  // 2. Standard HTML <pre> elements fallback
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
        code: codeText.replace(/^\r?\n+|\r?\n+$/g, ""),
        turnIndex
      })
    }

    pre.remove()
  })

  // 3. Fenced markdown code blocks in text nodes
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

  return deduplicateCodeBlocks(codeBlocks)
}

export class GeminiAdapter implements PlatformAdapter {
  readonly id: PlatformId = "gemini"
  readonly displayName = "Gemini"

  matches(url: string): boolean {
    try {
      const parsed = new URL(url)
      return parsed.hostname === "gemini.google.com" || parsed.hostname.endsWith(".gemini.google.com")
    } catch {
      return url.includes("gemini.google.com")
    }
  }

  getChatId(url: string, _doc?: Document): string {
    try {
      const parsed = new URL(url)
      // Gemini chat URLs have the form: https://gemini.google.com/app/<chatId>
      const match = parsed.pathname.match(/\/app\/([a-zA-Z0-9_-]+)/)
      if (match && match[1] && match[1].toLowerCase() !== "app") {
        return match[1]
      }
      return ""
    } catch {
      return ""
    }
  }

  getChatTitle(doc: Document): string {
    const url = doc.location?.href || ""
    const chatId = this.getChatId(url, doc)

    // 1. Optionally check confirmed sidebar link containing chatId
    if (chatId) {
      const confirmedLink = doc.querySelector<HTMLElement>(
        `nav a[href*="/app/${chatId}"], nav a[href*="${chatId}"]`
      )
      if (confirmedLink && confirmedLink.textContent?.trim()) {
        const text = confirmedLink.textContent.trim().replace(/\s+/g, " ")
        if (text && !isGenericFillerText(text)) {
          return text.slice(0, 60)
        }
      }
    }

    // 2. F5 Rule: Title = first real user request of THIS chat (trimmed, <= 60 characters)
    const messages = this.getMessages(doc)
    const firstUserMsg = messages.find((m) => m.role === "user" && m.text && m.text.trim().length > 0)
    if (firstUserMsg && firstUserMsg.text) {
      const line = firstUserMsg.text.split("\n")[0].trim().replace(/\s+/g, " ")
      if (line && !isGenericFillerText(line)) {
        return line.slice(0, 60)
      }
    }

    return ""
  }

  isNewOrEmptyChat(doc: Document): boolean {
    const url = doc.defaultView?.location?.href || (doc as any).location?.href || ""
    const chatId = this.getChatId(url, doc)
    const messages = doc.querySelectorAll(
      'user-query, model-response, .user-query-container, .response-container, [data-message-author-role], message-content, .query-text'
    )
    return messages.length === 0 && !chatId
  }

  getMessages(doc: Document): MessageTurn[] {
    const turns: MessageTurn[] = []

    // Gemini organizes conversation turns into <user-query> and <model-response> custom elements
    const userNodes = Array.from(
      doc.querySelectorAll<HTMLElement>(
        'user-query, div.user-query-container, div.user-query, [data-message-author-role="user"], div[class*="user-query"], div[class*="query-container"]'
      )
    )

    const assistantNodes = Array.from(
      doc.querySelectorAll<HTMLElement>(
        'model-response, div.model-response-text, message-content, [data-message-author-role="model"], .response-container-v2, .response-container, div[class*="model-response"], div[class*="response-container"]'
      )
    )

    // Deduplicate nested elements: only retain outermost elements of each role
    const filterOutermost = (elements: HTMLElement[]): HTMLElement[] => {
      const result: HTMLElement[] = []
      for (const el of elements) {
        const isNested = elements.some((other) => other !== el && other.contains(el))
        if (!isNested) {
          result.push(el)
        }
      }
      return result
    }

    const topUserNodes = filterOutermost(userNodes)
    const topAssistantNodes = filterOutermost(assistantNodes)

    const combined: Array<{ node: HTMLElement; role: "user" | "assistant" }> = []
    topUserNodes.forEach((node) => combined.push({ node, role: "user" }))
    topAssistantNodes.forEach((node) => combined.push({ node, role: "assistant" }))

    // Sort nodes in visual document order
    combined.sort((a, b) => {
      const pos = a.node.compareDocumentPosition(b.node)
      const following = typeof Node !== "undefined" ? Node.DOCUMENT_POSITION_FOLLOWING : 4
      const preceding = typeof Node !== "undefined" ? Node.DOCUMENT_POSITION_PRECEDING : 2
      if (pos & following) return -1
      if (pos & preceding) return 1
      return 0
    })

    const url = doc.defaultView?.location?.href || (doc as any).location?.href || ""
    const urlChatId = this.getChatId(url, doc)

    const seenTurnIds = new Set<string>()
    const seenTextHashes = new Set<string>()
    const seenHashCount = new Map<string, number>()

    combined.forEach((item, index) => {
      // Isolate the core message content container when present to exclude screen-reader headings and edit UI
      let targetEl: HTMLElement = item.node
      if (item.role === "user") {
        const queryTextEl = item.node.querySelector<HTMLElement>(
          '.query-text, .user-query-text, .query-content'
        )
        if (queryTextEl) targetEl = queryTextEl
      } else {
        const responseTextEl = item.node.querySelector<HTMLElement>(
          'message-content, .message-content, .model-response-text, .response-container-content, .markdown'
        )
        if (responseTextEl) targetEl = responseTextEl
      }

      const clone = targetEl.cloneNode(true) as HTMLElement

      // Extract alt text or aria-labels from images
      clone.querySelectorAll<HTMLImageElement>("img[alt], [role='img'][aria-label]").forEach((img) => {
        const alt = img.getAttribute("alt") || img.getAttribute("aria-label") || ""
        if (alt.trim()) {
          const textNode = (clone.ownerDocument || doc).createTextNode(` [Image: ${alt.trim()}] `)
          img.parentNode?.replaceChild(textNode, img)
        }
      })

      // Strip screen-reader / accessibility hidden elements ("You said", "Gemini said", etc.)
      clone
        .querySelectorAll(
          '.cdk-visually-hidden, [class*="cdk-visually-hidden"], ' +
          '.visually-hidden, [class*="visually-hidden"], ' +
          '.sr-only, [class*="sr-only"], ' +
          '[aria-hidden="true"], ' +
          'h1, h2, h3, h4, h5, h6, [role="heading"], ' +
          // Edit query controls & duplicate query mirrors
          'edit-query, .edit-query-container, .edit-container, [class*="edit-query"], ' +
          'button, svg, [role="toolbar"], ' +
          // UI noise & action bars
          '[aria-label*="Copy"], [aria-label*="Good response"], [aria-label*="Bad response"], ' +
          '[aria-label*="Modify"], [aria-label*="Share"], [aria-label*="Listen"], [aria-label*="Edit"], ' +
          '.response-footer, .action-buttons, mat-icon, [class*="mat-icon"], ctx'
        )
        .forEach((el) => el.remove())

      // F6: Detect file/image attachment chips before text extraction
      const turnAttachments: { name: string; kind: "file" | "image" }[] = []
      const attachmentChips = Array.from(
        clone.querySelectorAll<HTMLElement>(
          '.file-attachment-chip, [data-test-id*="attachment"], [class*="attachment"], [class*="file-chip"], [aria-label*="attachment"]'
        )
      )
      attachmentChips.forEach((chip) => {
        let name = chip.getAttribute("title") || chip.getAttribute("aria-label") || chip.textContent?.trim() || ""
        name = name.replace(/(?:Document|Spreadsheet|PDF|Image|Text)$/i, "").trim()
        if (name) {
          const isImg = /\.(png|jpe?g|webp|gif|svg)$/i.test(name) || /image/i.test(chip.className)
          turnAttachments.push({ name, kind: isImg ? "image" : "file" })
        }
        chip.remove()
      })

      // Extract verbatim code blocks from <code-block> or <pre>
      const codeBlocks = extractCodeBlocksFromGeminiContainer(clone, index, "gemini")

      // F7: Use shared structured text extraction DOM walk
      const rawText = extractStructuredMessageText(clone)

      if (rawText.length > 0 && isInjectedTurn(rawText)) {
        console.debug(`[ContextBridge Gemini] Skipping previously injected Context Bridge turn at index ${index}`)
        return
      }

      let cleanedText = stripInjectedContext(rawText)
      cleanedText = cleanedText
        .replace(/^You said\s*:?\s*/i, "")
        .replace(/^Gemini said\s*:?\s*/i, "")
        .replace(/^(?:User|Assistant|Model)\s*:\s*/i, "")
        .trim()

      // Resolve turn ID
      const domId =
        item.node.getAttribute("data-response-id") ||
        item.node.getAttribute("data-query-id") ||
        item.node.getAttribute("data-message-id") ||
        item.node.getAttribute("data-turn-id") ||
        item.node.getAttribute("id") ||
        item.node.querySelector("[data-response-id]")?.getAttribute("data-response-id") ||
        item.node.querySelector("[data-query-id]")?.getAttribute("data-query-id")

      let turnId = domId
      if (!turnId) {
        // F4: Deterministic chat-scoped fallback: <chatId>:<role>:<textHash>:<occurrence>
        let hash = 0
        for (let i = 0; i < cleanedText.length; i++) {
          hash = (hash << 5) - hash + cleanedText.charCodeAt(i)
          hash |= 0
        }
        const hashStr = Math.abs(hash).toString(36)
        const occKey = `${item.role}:${hashStr}`
        const occ = seenHashCount.get(occKey) || 0
        seenHashCount.set(occKey, occ + 1)
        turnId = `${urlChatId || "gemini-chat"}:${item.role}:${hashStr}:${occ}`
      }

      if (seenTurnIds.has(turnId)) {
        return
      }
      seenTurnIds.add(turnId)

      const textHash = `${item.role}:${turnId}:${cleanedText.slice(0, 100)}`
      if (seenTextHashes.has(textHash)) {
        return
      }
      seenTextHashes.add(textHash)

      if (
        (cleanedText.length > 0 && !isGenericFillerText(cleanedText)) ||
        codeBlocks.length > 0 ||
        turnAttachments.length > 0
      ) {
        turns.push({
          id: turnId,
          role: item.role,
          text: cleanedText,
          codeBlocks,
          attachments: turnAttachments.length > 0 ? turnAttachments : undefined,
          timestamp: Date.now(),
          chatId: urlChatId || ""
        })
      }
    })

    return turns
  }

  getInputBox(doc: Document): HTMLElement | null {
    const selectors = [
      'rich-textarea div[contenteditable="true"]',
      'div.ql-editor[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][aria-label*="Ask" i]',
      'div[contenteditable="true"][aria-label*="prompt" i]',
      'rich-textarea [contenteditable="true"]',
      'div[contenteditable="true"]',
      'textarea[aria-label*="prompt" i]',
      'textarea'
    ]

    for (const sel of selectors) {
      const el = doc.querySelector<HTMLElement>(sel)
      if (el) return el
    }
    return null
  }

  getChatContainer(doc: Document): HTMLElement | null {
    return (
      doc.querySelector<HTMLElement>(
        'infinite-scroller, chat-window, main.chat-history, .chat-history, .conversation-container, [role="main"], main'
      ) || doc.body
    )
  }

  getScrollContainer(doc: Document): HTMLElement | null {
    return (
      doc.querySelector<HTMLElement>(
        'infinite-scroller, .chat-history, chat-window, [class*="scroll"], main'
      ) || doc.documentElement
    )
  }

  isLoadingOlderMessages(doc: Document): boolean {
    return Boolean(
      doc.querySelector('mat-progress-spinner, .loading-spinner, [aria-label*="loading" i]')
    )
  }

  insertText(target: HTMLElement, text: string): boolean {
    return safeInsertText(target, text)
  }

  healthCheck(doc: Document): AdapterHealthResult {
    const issues: string[] = []
    const inputBox = this.getInputBox(doc)
    if (!inputBox) {
      issues.push(
        "Gemini prompt input box not found. Expected: rich-textarea div[contenteditable='true'] or div[role='textbox']."
      )
    }

    const messages = this.getMessages(doc)
    const isNew = this.isNewOrEmptyChat(doc)

    if (messages.length === 0 && !isNew) {
      issues.push("No Gemini conversation messages detected on non-empty chat.")
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

  checkRateLimitExceeded(doc: Document): RateLimitCheckResult {
    const bannerSelectors = [
      '[class*="quota"]',
      '.quota-warning-banner',
      '[class*="capacity"]',
      'div[role="alert"]',
      '.banner-content'
    ]

    for (const sel of bannerSelectors) {
      const el = doc.querySelector(sel)
      if (el) {
        const text = el.textContent || ""
        if (
          /quota limit/i.test(text) ||
          /currently at capacity/i.test(text) ||
          /usage limit exceeded/i.test(text) ||
          /maximum number of requests/i.test(text)
        ) {
          const resetMatch = text.match(/(?:please wait until|resets? (?:at|in)|available at)\s+([^.]+)/i)
          return {
            exceeded: true,
            reason: text.trim().slice(0, 150),
            resetTime: resetMatch ? resetMatch[1].trim() : undefined
          }
        }
      }
    }

    const main = doc.querySelector("main") || doc.body
    if (main) {
      const allAlerts = main.querySelectorAll("div, p, span")
      for (const el of allAlerts) {
        if (el.children.length === 0 && el.textContent) {
          const text = el.textContent.trim()
          if (
            /you('?ve| have) reached your quota limit/i.test(text) ||
            /gemini is currently at capacity/i.test(text) ||
            /usage limit exceeded/i.test(text)
          ) {
            const resetMatch = text.match(/(?:please wait until|resets? (?:at|in)|available at)\s+([^.]+)/i)
            return {
              exceeded: true,
              reason: text.slice(0, 150),
              resetTime: resetMatch ? resetMatch[1].trim() : undefined
            }
          }
        }
      }
    }

    return { exceeded: false }
  }
}
