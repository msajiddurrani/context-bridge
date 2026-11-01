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
    const url = doc.location?.href || ""
    const chatId = this.getChatId(url, doc)

    // 1. Optionally check sidebar link confirmed to belong to THIS chat
    if (chatId) {
      const confirmedLink = doc.querySelector<HTMLElement>(
        `nav a[href*="/chat/${chatId}"], nav a[href*="${chatId}"]`
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
    // and are not already captured in innerAssistantNodes
    const outerOnlyAssistantNodes = Array.from(
      doc.querySelectorAll<HTMLElement>(
        'div[data-message-author-slug="claude"], div[class*="font-claude-message"]'
      )
    ).filter(
      (outer) =>
        !innerAssistantNodes.includes(outer) &&
        !outer.querySelector('[data-testid="assistant-message"]')
    )

    const assistantNodes = [...innerAssistantNodes, ...outerOnlyAssistantNodes]

    const userNodes = Array.from(
      doc.querySelectorAll<HTMLElement>('[data-testid="user-message"]')
    )

    const combined: Array<{ node: HTMLElement; role: "user" | "assistant" }> = []
    const seenElements = new Set<HTMLElement>()

    userNodes.forEach((node) => {
      if (!seenElements.has(node)) {
        seenElements.add(node)
        combined.push({ node, role: "user" })
      }
    })
    assistantNodes.forEach((node) => {
      if (!seenElements.has(node)) {
        seenElements.add(node)
        combined.push({ node, role: "assistant" })
      }
    })

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
    const seenHashCount = new Map<string, number>()

    combined.forEach((item, index) => {
      const codeBlocks: VerbatimCodeBlock[] = []
      const clone = item.node.cloneNode(true) as HTMLElement

      // F6: Detect file/image attachment chips before text extraction
      const turnAttachments: { name: string; kind: "file" | "image" }[] = []
      const attachmentChips = Array.from(
        clone.querySelectorAll<HTMLElement>(
          '.file-attachment-chip, [data-testid*="attachment"], [data-testid*="file"], [class*="attachment"], [class*="file-wrapper"], [aria-label*="attachment"]'
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

      const dedupedCode = deduplicateCodeBlocks(codeBlocks)

      // F7: Use shared structured text extraction DOM walk
      const rawText = extractStructuredMessageText(clone)
      if (rawText.length > 0 || dedupedCode.length > 0 || turnAttachments.length > 0) {
        if (isInjectedTurn(rawText)) {
          console.debug(`[ContextBridge Claude] Skipping previously injected Context Bridge turn at index ${index}`)
          return
        }

        const cleanedText = stripInjectedContext(rawText)

        // Filter out Claude UI collapsed message placeholders and platform labels
        if (
          /message collapsed/i.test(cleanedText) ||
          /collapsed message/i.test(cleanedText) ||
          (isGenericFillerText(cleanedText) && dedupedCode.length === 0 && turnAttachments.length === 0)
        ) {
          return
        }

        // Resolve message id: prefer DOM attribute, else deterministic chat-scoped fallback.
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
          turnId = `${urlChatId || "claude-chat"}:${item.role}:${hashStr}:${occ}`
        }

        // Deduplicate by message id and by text hash
        if (seenMsgIds.has(turnId)) {
          console.debug(`[ContextBridge Claude] Collapsing duplicate message id ${turnId} at index ${index}`)
          return
        }
        seenMsgIds.add(turnId)

        const textHash = `${item.role}:${turnId}:${cleanedText.slice(0, 100)}`
        if (seenTextHashes.has(textHash)) {
          console.debug(`[ContextBridge Claude] Collapsing duplicate text at index ${index}`)
          return
        }
        seenTextHashes.add(textHash)

        turns.push({
          id: turnId,
          role: item.role,
          text: cleanedText,
          codeBlocks: dedupedCode,
          attachments: turnAttachments.length > 0 ? turnAttachments : undefined,
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
      doc.querySelector<HTMLElement>('div[class*="overflow-y-auto"], [data-testid="chat-history"]') ||
      doc.querySelector<HTMLElement>("main") ||
      doc.body
    )
  }

  isLoadingOlderMessages(doc: Document): boolean {
    return Boolean(
      doc.querySelector('.animate-spin, [data-testid*="loading"], [aria-label*="loading" i]')
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

  formatFor(memory: StateMemory, fromPlatform: PlatformId, format: InjectionFormat = "markdown"): string {
    if (format === "xml") {
      return formatStateMemoryPrompt(memory, fromPlatform, this.id)
    }
    return formatMarkdownPrompt(memory, fromPlatform, this.id)
  }

  checkRateLimitExceeded(doc: Document): RateLimitCheckResult {
    const bannerSelectors = [
      '[data-testid="limit-banner"]',
      '.banner-limit',
      '[class*="limit-banner"]',
      '[class*="message-limit"]',
      'div[role="alert"]'
    ]

    for (const sel of bannerSelectors) {
      const el = doc.querySelector(sel)
      if (el) {
        const text = el.textContent || ""
        if (
          /message limit/i.test(text) ||
          /out of free messages/i.test(text) ||
          /free plan limit/i.test(text) ||
          /limit will reset/i.test(text)
        ) {
          const resetMatch = text.match(/(?:resets?|try again|reset at|available at)\s+([^.]+)/i)
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
            /you('?ve| have) reached your message limit/i.test(text) ||
            /you are out of free messages/i.test(text) ||
            /free plan limit reached/i.test(text)
          ) {
            const resetMatch = text.match(/(?:resets?|reset at|available at)\s+([^.]+)/i)
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
