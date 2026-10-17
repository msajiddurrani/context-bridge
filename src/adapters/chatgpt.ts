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

export class ChatGPTAdapter implements PlatformAdapter {
  readonly id: PlatformId = "chatgpt"
  readonly displayName = "ChatGPT"

  matches(url: string): boolean {
    try {
      const parsed = new URL(url)
      return parsed.hostname === "chatgpt.com" || parsed.hostname.endsWith(".chatgpt.com")
    } catch {
      return url.includes("chatgpt.com")
    }
  }

  getChatId(url: string, _doc: Document): string {
    try {
      const parsed = new URL(url)
      const match = parsed.pathname.match(/\/c\/([a-zA-Z0-9_-]+)/)
      if (match) {
        return match[1]
      }
      return parsed.pathname || "default-chatgpt"
    } catch {
      return "chatgpt-session"
    }
  }

  getChatTitle(doc: Document): string {
    const titleEl = doc.querySelector<HTMLElement>(
      'header h1, [data-testid="conversation-title"], nav a[aria-current="page"]'
    )
    if (titleEl && titleEl.textContent?.trim()) {
      return titleEl.textContent.trim()
    }
    const cleanDocTitle = doc.title.replace(/\s*[-–—|]\s*ChatGPT.*$/i, "").trim()
    return cleanDocTitle || "ChatGPT Conversation"
  }

  isNewOrEmptyChat(doc: Document): boolean {
    const messages = doc.querySelectorAll(
      '[data-message-author-role], [data-testid^="conversation-turn-"], article'
    )
    return messages.length === 0
  }

  getMessages(doc: Document): MessageTurn[] {
    const turns: MessageTurn[] = []

    // 1. Primary selector: [data-message-author-role] is OpenAI's canonical, resilient semantic marker
    let elements = Array.from(doc.querySelectorAll<HTMLElement>("[data-message-author-role]"))

    // 2. Fallback: conversation turns or articles if author-role attributes are missing
    if (elements.length === 0) {
      elements = Array.from(
        doc.querySelectorAll<HTMLElement>('[data-testid^="conversation-turn-"], article')
      )
    }

    elements.forEach((article, index) => {
      // Determine role from semantic attributes
      let role: "user" | "assistant" = "assistant"
      const authorRole = article.getAttribute("data-message-author-role")
      if (authorRole === "user") {
        role = "user"
      } else if (authorRole === "assistant") {
        role = "assistant"
      } else {
        // Fallback checks
        const childAuthor = article.querySelector("[data-message-author-role]")?.getAttribute("data-message-author-role")
        if (childAuthor === "user") {
          role = "user"
        } else if (childAuthor === "assistant") {
          role = "assistant"
        } else {
          const hasUserIndicator =
            article.querySelector('div[class*="user"]') ||
            article.getAttribute("data-testid")?.includes("user")
          const hasAssistantIndicator =
            article.querySelector('div[class*="agent"]') ||
            article.querySelector('div[class*="assistant"]')
          if (hasUserIndicator) role = "user"
          else if (hasAssistantIndicator) role = "assistant"
          else role = index % 2 === 0 ? "user" : "assistant"
        }
      }

      const codeBlocks: VerbatimCodeBlock[] = []
      const clone = article.cloneNode(true) as HTMLElement

      // Remove UI buttons (Copy code, Read aloud, Thumb up/down, action bars)
      clone
        .querySelectorAll(
          'button, svg, [aria-label*="Copy"], [aria-label*="Good response"], [aria-label*="Bad response"], [aria-label*="Read aloud"], [aria-label*="Thumbs"]'
        )
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
            id: `chatgpt-code-${index}-${snippetIdx}`,
            language: lang,
            code: codeText.trim(),
            turnIndex: index
          })

          const mdNode = doc.createTextNode(`\n\`\`\`${lang}\n${codeText.trim()}\n\`\`\`\n`)
          pre.parentNode?.replaceChild(mdNode, pre)
        }
      })

      const rawText = (clone.textContent || "").replace(/\n{3,}/g, "\n\n").trim()
      if (rawText.length > 0) {
        turns.push({
          id: `chatgpt-turn-${index}`,
          role,
          text: rawText,
          codeBlocks,
          timestamp: Date.now()
        })
      }
    })

    return turns
  }


  getInputBox(doc: Document): HTMLElement | null {
    // Check traditional textarea and modern ProseMirror/Lexical contenteditable
    const selectors = [
      '#prompt-textarea',
      'form div[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
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
    const selectors = [
      'main div[role="presentation"]',
      'main',
      'div[class*="react-scroll-to-bottom"]',
      'div.composer-parent',
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
      issues.push("ChatGPT prompt input box not found (#prompt-textarea or form editable).")
    }

    const messages = this.getMessages(doc)
    const isNew = this.isNewOrEmptyChat(doc)

    if (messages.length === 0 && !isNew) {
      issues.push("No ChatGPT messages found on non-empty chat.")
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
