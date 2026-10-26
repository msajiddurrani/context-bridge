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

  return codeBlocks
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
    const titleEl = doc.querySelector<HTMLElement>(
      'h1.conversation-title, [data-test-id="conversation-title"], header h1, .conversation-title'
    )
    if (titleEl && titleEl.textContent?.trim()) {
      let text = titleEl.textContent.trim()
      text = text
        .replace(/^(?:Google\s+)?Gemini\s*[-–—|]?\s*/i, "")
        .replace(/\s*[-–—|]\s*(?:Google\s+)?Gemini.*$/i, "")
        .trim()
      if (!isGenericFillerText(text)) return text
    }

    const cleanDocTitle = doc.title
      .replace(/^(?:Google\s+)?Gemini\s*[-–—|]?\s*/i, "")
      .replace(/\s*[-–—|]\s*(?:Google\s+)?Gemini.*$/i, "")
      .trim()

    if (cleanDocTitle && !isGenericFillerText(cleanDocTitle)) {
      return cleanDocTitle
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
        'user-query, div.user-query-container, div.user-query, [data-message-author-role="user"]'
      )
    )

    const assistantNodes = Array.from(
      doc.querySelectorAll<HTMLElement>(
        'model-response, div.model-response-text, message-content, [data-message-author-role="model"], .response-container-v2, .response-container'
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

      // Strip any lingering screen-reader label elements before reading textContent
      clone.querySelectorAll("*").forEach((child) => {
        const t = child.textContent?.trim() || ""
        if (
          /^You said\s*:?$/i.test(t) ||
          /^Gemini said\s*:?$/i.test(t) ||
          /^(?:User|Model|Gemini) responded\s*:?$/i.test(t)
        ) {
          child.remove()
        }
      })

      // Extract verbatim code blocks from <code-block> or <pre>
      const codeBlocks = extractCodeBlocksFromGeminiContainer(clone, index, "gemini")

      const rawText = (clone.textContent || "").replace(/\n{3,}/g, "\n\n").trim()

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
        let hash = 0
        for (let i = 0; i < cleanedText.length; i++) {
          hash = (hash << 5) - hash + cleanedText.charCodeAt(i)
          hash |= 0
        }
        turnId = `gemini-msg-${Math.abs(hash).toString(36)}-pos${index}`
      }

      if (seenTurnIds.has(turnId)) {
        return
      }
      seenTurnIds.add(turnId)

      const textHash = `${item.role}:${cleanedText.slice(0, 80)}`
      if (seenTextHashes.has(textHash)) {
        return
      }
      seenTextHashes.add(textHash)

      if ((cleanedText.length > 0 && !isGenericFillerText(cleanedText)) || codeBlocks.length > 0) {
        turns.push({
          id: turnId,
          role: item.role,
          text: cleanedText,
          codeBlocks,
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
        'main.chat-history, main, .conversation-container, [role="main"]'
      ) || doc.body
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
}
