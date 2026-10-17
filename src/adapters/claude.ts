import type {
  AdapterHealthResult,
  MessageTurn,
  PlatformId,
  StateMemory,
  VerbatimCodeBlock
} from "../types"
import { safeInsertText } from "../utils/dom-insert"
import { formatStateMemoryPrompt } from "../utils/prompt-formatter"
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
      return parsed.pathname || "default-claude"
    } catch {
      return "claude-session"
    }
  }

  getChatTitle(doc: Document): string {
    const titleEl = doc.querySelector<HTMLElement>(
      '[data-testid="chat-title"], header h1, nav button[aria-current="page"]'
    )
    if (titleEl && titleEl.textContent?.trim()) {
      return titleEl.textContent.trim()
    }
    const cleanDocTitle = doc.title.replace(/\s*[-–—|]\s*Claude.*$/i, "").trim()
    return cleanDocTitle || "Claude Conversation"
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

    // Semantic attribute-based selectors
    const claudeNodes = Array.from(
      doc.querySelectorAll<HTMLElement>(
        'div[data-message-author-slug="claude"], [data-testid="assistant-message"], div[class*="font-claude-message"]'
      )
    )

    const userNodes = Array.from(
      doc.querySelectorAll<HTMLElement>(
        '[data-testid="user-message"], div[class*="font-user-message"], div[class*="items-end"] div[class*="bg-"]'
      )
    )

    const combined: Array<{ node: HTMLElement; role: "user" | "assistant" }> = []
    userNodes.forEach((node) => combined.push({ node, role: "user" }))
    claudeNodes.forEach((node) => combined.push({ node, role: "assistant" }))

    // Sort in visual document order
    combined.sort((a, b) => {
      const pos = a.node.compareDocumentPosition(b.node)
      const following = typeof Node !== "undefined" ? Node.DOCUMENT_POSITION_FOLLOWING : 4
      const preceding = typeof Node !== "undefined" ? Node.DOCUMENT_POSITION_PRECEDING : 2
      if (pos & following) return -1
      if (pos & preceding) return 1
      return 0
    })

    combined.forEach((item, index) => {
      const codeBlocks: VerbatimCodeBlock[] = []
      const clone = item.node.cloneNode(true) as HTMLElement

      // Remove UI noise elements (Copy, Feedback buttons)
      clone
        .querySelectorAll('button, svg, [aria-label*="Copy"], [aria-label*="Feedback"]')
        .forEach((el) => el.remove())

      // Extract verbatim code blocks
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
            code: codeText.trim(),
            turnIndex: index
          })

          // Replace pre in clone with markdown fence
          const mdNode = doc.createTextNode(`\n\`\`\`${lang}\n${codeText.trim()}\n\`\`\`\n`)
          pre.parentNode?.replaceChild(mdNode, pre)
        }
      })

      const rawText = (clone.textContent || "").replace(/\n{3,}/g, "\n\n").trim()
      if (rawText.length > 0) {
        turns.push({
          id: `claude-turn-${index}-${Date.now()}`,
          role: item.role,
          text: rawText,
          codeBlocks,
          timestamp: Date.now()
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
