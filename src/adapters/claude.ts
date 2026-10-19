import type {
  AdapterHealthResult,
  MessageTurn,
  PlatformId,
  StateMemory,
  VerbatimCodeBlock
} from "../types"
import { safeInsertText } from "../utils/dom-insert"
import {
  formatStateMemoryPrompt,
  isGenericFillerText,
  isInjectedTurn,
  stripInjectedContext
} from "../utils/prompt-formatter"
import type { PlatformAdapter } from "./types"

export class ClaudeAdapter implements PlatformAdapter {
  readonly id: PlatformId = "claude"
  readonly displayName = "Claude"

  matches(url: string): boolean {
    try {
      const parsed = new URL(url)
      return parsed.hostname === "claude.ai" || parsed.hostname.endsWith(".claude.ai")
    } catch {
      return url.includes("claude.ai")
    }
  }

  getChatId(url: string, _doc: Document): string {
    try {
      const parsed = new URL(url)
      const chatMatch = parsed.pathname.match(/\/chat\/([a-zA-Z0-9_-]+)/)
      if (chatMatch) {
        return chatMatch[1]
      }
      return ""
    } catch {
      return ""
    }
  }

  getChatTitle(doc: Document): string {
    // Only query conversation title / header elements; NEVER query sidebar nav elements
    const titleEl = doc.querySelector<HTMLElement>(
      '[data-testid="chat-title"], header h1'
    )
    if (titleEl && titleEl.textContent?.trim()) {
      const text = titleEl.textContent.trim()
      if (!isGenericFillerText(text) && !/message collapsed/i.test(text) && !/collapsed message/i.test(text)) {
        return text
      }
    }
    const cleanDocTitle = doc.title
      .replace(/^Claude\s*[-–—|]?\s*/i, "")
      .replace(/\s*[-–—|]\s*Claude.*$/i, "")
      .trim()
    if (
      cleanDocTitle &&
      !isGenericFillerText(cleanDocTitle) &&
      !/message collapsed/i.test(cleanDocTitle) &&
      !/collapsed message/i.test(cleanDocTitle)
    ) {
      return cleanDocTitle
    }
    return ""
  }

  isNewOrEmptyChat(doc: Document): boolean {
    if (typeof window !== "undefined" && window.location.pathname.endsWith("/new")) {
      return true
    }
    const messages = doc.querySelectorAll(
      '[data-message-author-slug="claude"], [data-testid="user-message"], div[class*="font-claude-message"]'
    )
    return messages.length === 0
  }

  getMessages(doc: Document): MessageTurn[] {
    const turns: MessageTurn[] = []

    // A2 FIX: Select only the INNERMOST content element for each message.
    //
    // Problem: The old code ran two separate querySelectorAll passes:
    //   - claudeNodes: div[data-message-author-slug="claude"] (OUTER wrapper)
    //   - userNodes:   [data-testid="user-message"]
    // Then combined them. But div[data-message-author-slug="claude"] CONTAINS
    // [data-testid="assistant-message"] as a child. Both matched, producing two
    // assistant entries per message (USER x2, ASSISTANT x2 in live evidence).
    //
    // Fix: Prefer the innermost [data-testid="assistant-message"] elements.
    // Fall back to div[data-message-author-slug="claude"] ONLY when there is
    // no inner [data-testid="assistant-message"] descendant (i.e., it IS the leaf).
    //
    // This matches the selector hierarchy documented in the prompt:
    //   prefer data-* attributes over fragile class names (AGENTS.md rule).

    // Collect all innermost assistant content elements first
    const innerAssistantNodes = Array.from(
      doc.querySelectorAll<HTMLElement>('[data-testid="assistant-message"]')
    )
    // Collect outer wrappers that have NO inner [data-testid="assistant-message"] child
    // (i.e., they are the leaf themselves, needed as fallback for older DOM shapes)
    const outerOnlyAssistantNodes = Array.from(
      doc.querySelectorAll<HTMLElement>(
        'div[data-message-author-slug="claude"], div[class*="font-claude-message"]'
      )
    ).filter(
      (outer) => !outer.querySelector('[data-testid="assistant-message"]')
    )

    const assistantNodes = [...innerAssistantNodes, ...outerOnlyAssistantNodes]

    const userNodes = Array.from(
      doc.querySelectorAll<HTMLElement>('[data-testid="user-message"]')
    )

    const combined: Array<{ node: HTMLElement; role: "user" | "assistant" }> = []
    userNodes.forEach((node) => combined.push({ node, role: "user" }))
    assistantNodes.forEach((node) => combined.push({ node, role: "assistant" }))

    // Sort in visual document order
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

    // A2 FIX: Track seen message ids and seen text hashes to prevent duplicate turns
    // even if the DOM emits two nodes with the same content (shouldn't happen after
    // the innermost-only selection above, but kept as a safety net).
    const seenMsgIds = new Set<string>()
    const seenTextHashes = new Set<string>()

    combined.forEach((item, index) => {
      const codeBlocks: VerbatimCodeBlock[] = []
      const clone = item.node.cloneNode(true) as HTMLElement

      // A2 FIX: Strip visually-hidden / screen-reader-only labels BEFORE reading textContent.
      // These include "Claude responded:" and "You said:" labels, which textContent picks up
      // even though they are hidden from visual users.
      clone
        .querySelectorAll(
          '.sr-only, [class*="sr-only"], [class*="visually-hidden"], ' +
          '[aria-hidden="true"], ' +
          // Also strip relative timestamps like "just now", "2m ago"
          '[data-testid*="timestamp"], [class*="timestamp"], ' +
          // UI noise
          'button, svg, [aria-label*="Copy"], [aria-label*="Feedback"], ctx'
        )
        .forEach((el) => el.remove())

      // Extract verbatim code blocks preserving internal blank lines exactly
      const pres = clone.querySelectorAll<HTMLPreElement>("pre")
      pres.forEach((pre, snippetIdx) => {
        const codeEl = pre.querySelector("code")
        const codeText = (codeEl ? codeEl.textContent : pre.textContent) || ""
        let lang = "text"
        if (codeEl?.className) {
          const match = codeEl.className.match(/language-([a-zA-Z0-9_-]+)/)
          if (match) lang = match[1]
        }

        if (codeText.trim().length > 0) {
          codeBlocks.push({
            id: `claude-code-${index}-${snippetIdx}`,
            language: lang,
            code: codeText.replace(/^\r?\n+|\r?\n+$/g, ""),
            turnIndex: index
          })

          pre.remove()
        }
      })

      const rawText = (clone.textContent || "").replace(/\n{3,}/g, "\n\n").trim()
      if (rawText.length > 0) {
        if (isInjectedTurn(rawText)) {
          console.debug(`[ContextBridge Claude] Skipping previously injected Context Bridge turn at index ${index}`)
          return
        }

        const cleanedText = stripInjectedContext(rawText)
        if (cleanedText.length === 0) {
          return
        }

        // Filter out Claude UI collapsed message placeholders and platform labels
        if (
          /message collapsed/i.test(cleanedText) ||
          /collapsed message/i.test(cleanedText) ||
          (isGenericFillerText(cleanedText) && codeBlocks.length === 0)
        ) {
          return
        }

        // Resolve message id: prefer DOM attribute, else deterministic fallback.
        // Look up the tree to the owner element that may carry the id (since we selected
        // the inner content node, the id may be on a parent wrapper).
        const ownerEl =
          item.node.closest("[data-message-id]") ||
          item.node.closest("[data-message-author-slug]") ||
          item.node

        const domMsgId =
          item.node.getAttribute?.("data-message-id") ||
          ownerEl.getAttribute?.("data-message-id") ||
          item.node.querySelector?.("[data-message-id]")?.getAttribute("data-message-id")

        let turnId = domMsgId
        if (!turnId) {
          // Deterministic fallback: role + normalized-text hash + order index.
          // Marked UNVERIFIED: live Claude DOM may or may not expose data-message-id.
          let hash = 0
          for (let i = 0; i < cleanedText.length; i++) {
            hash = (hash << 5) - hash + cleanedText.charCodeAt(i)
            hash |= 0
          }
          turnId = `claude-msg-${Math.abs(hash).toString(36)}-pos${index}`
        }

        // A2 FIX: Deduplicate by message id and by text hash
        if (seenMsgIds.has(turnId)) {
          console.debug(`[ContextBridge Claude] Collapsing duplicate message id ${turnId} at index ${index}`)
          return
        }
        seenMsgIds.add(turnId)

        const textHash = `${item.role}:${cleanedText.slice(0, 60)}`
        if (seenTextHashes.has(textHash)) {
          console.debug(`[ContextBridge Claude] Collapsing duplicate text at index ${index}`)
          return
        }
        seenTextHashes.add(textHash)

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
    // Claude uses a ProseMirror contenteditable div or fallback textarea
    const selectors = [
      'div[contenteditable="true"].ProseMirror',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
      'fieldset textarea',
      'textarea[placeholder*="Reply"]',
      'textarea'
    ]

    for (const sel of selectors) {
      const el = doc.querySelector<HTMLElement>(sel)
      if (el && (el.offsetWidth > 0 || el.offsetHeight > 0 || el.offsetParent !== null)) {
        return el
      }
    }
    return doc.querySelector<HTMLElement>('div[contenteditable="true"]') || doc.querySelector<HTMLTextAreaElement>("textarea")
  }

  getChatContainer(doc: Document): HTMLElement | null {
    return (
      doc.querySelector<HTMLElement>('main, div[data-testid="chat-history"], div[class*="overflow-y-auto"]') ||
      doc.body
    )
  }

  insertText(target: HTMLElement, text: string): boolean {

    return safeInsertText(target, text)
  }

  healthCheck(doc: Document): AdapterHealthResult {
    const issues: string[] = []
    const inputBox = this.getInputBox(doc)
    if (!inputBox) {
      issues.push("Claude prompt input box not found (tried ProseMirror and textarea selectors).")
    }

    const messages = this.getMessages(doc)
    const isNew = this.isNewOrEmptyChat(doc)

    if (messages.length === 0 && !isNew) {
      issues.push("No Claude chat messages detected on non-empty chat.")
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

  formatFor(memory: StateMemory, fromPlatform: PlatformId): string {
    return formatStateMemoryPrompt(memory, fromPlatform, this.id)
  }
}
