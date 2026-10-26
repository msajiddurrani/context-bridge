import { describe, expect, it } from "vitest"
import { JSDOM } from "jsdom"
import * as fs from "fs"
import * as path from "path"
import { ClaudeAdapter } from "../src/adapters/claude"
import { ChatGPTAdapter } from "../src/adapters/chatgpt"
import { getAdapterForUrl } from "../src/adapters"
import { safeInsertText } from "../src/utils/dom-insert"

describe("Platform Adapters (Claude & ChatGPT)", () => {
  it("resolves adapters correctly from URL registry", () => {
    expect(getAdapterForUrl("https://claude.ai/chat/12345")?.id).toBe("claude")
    expect(getAdapterForUrl("https://chatgpt.com/c/67890")?.id).toBe("chatgpt")
    expect(getAdapterForUrl("https://gemini.google.com/app/b260917075a6aaec")?.id).toBe("gemini")
    expect(getAdapterForUrl("https://google.com")).toBeNull()
  })

  describe("Claude Adapter", () => {
    const adapter = new ClaudeAdapter()
    const fixtureHtml = fs.readFileSync(
      path.resolve(__dirname, "../src/adapters/fixtures/claude.html"),
      "utf-8"
    )

    it("scrapes conversation turns and verbatim code blocks from HTML fixture", () => {
      const dom = new JSDOM(fixtureHtml, { url: "https://claude.ai/chat/abc-123-uuid" })
      const turns = adapter.getMessages(dom.window.document)

      expect(turns.length).toBe(2)
      expect(turns[0].role).toBe("user")
      expect(turns[0].text).toContain("design an auth middleware")

      expect(turns[1].role).toBe("assistant")
      expect(turns[1].text).toContain("production-ready implementation")
      expect(turns[1].codeBlocks.length).toBe(1)
      expect(turns[1].codeBlocks[0].language).toBe("typescript")
      expect(turns[1].codeBlocks[0].code).toContain("export function authMiddleware")
    })

    it("identifies the ProseMirror input box and runs healthCheck successfully", () => {
      const dom = new JSDOM(fixtureHtml, { url: "https://claude.ai/chat/abc-123-uuid" })
      const inputBox = adapter.getInputBox(dom.window.document)
      expect(inputBox).not.toBeNull()
      expect(inputBox?.classList.contains("ProseMirror")).toBe(true)

      const health = adapter.healthCheck(dom.window.document)
      expect(health.ok).toBe(true)
      expect(health.inputBoxFound).toBe(true)
      expect(health.messagesFound).toBe(true)
      expect(health.issues.length).toBe(0)
    })

    it("detects broken selectors during healthCheck", () => {
      const emptyDom = new JSDOM("<html><body><div>Broken Page</div></body></html>", {
        url: "https://claude.ai/chat/broken"
      })
      const health = adapter.healthCheck(emptyDom.window.document)
      expect(health.ok).toBe(false)
      expect(health.inputBoxFound).toBe(false)
      expect(health.issues.length).toBeGreaterThan(0)
    })

    it("extracts chat ID and title correctly", () => {
      const dom = new JSDOM(fixtureHtml, { url: "https://claude.ai/chat/abc-123-uuid" })
      expect(adapter.getChatId("https://claude.ai/chat/abc-123-uuid", dom.window.document)).toBe("abc-123-uuid")
      // Under Phase 2 redesign, non-permalink URLs return empty string (save nothing)
      expect(adapter.getChatId("https://claude.ai/new", dom.window.document)).toBe("")
      expect(adapter.getChatTitle(dom.window.document)).toBe("Engineering Architecture Discussion")
    })
  })

  describe("ChatGPT Adapter", () => {
    const adapter = new ChatGPTAdapter()
    const fixtureHtml = fs.readFileSync(
      path.resolve(__dirname, "../src/adapters/fixtures/chatgpt.html"),
      "utf-8"
    )

    it("scrapes conversation turns and verbatim Python code blocks from HTML fixture", () => {
      const dom = new JSDOM(fixtureHtml, { url: "https://chatgpt.com/c/chatgpt-uuid-456" })
      const turns = adapter.getMessages(dom.window.document)

      expect(turns.length).toBe(2)
      expect(turns[0].role).toBe("user")
      expect(turns[0].text).toContain("Write a Python function to add two numbers")

      expect(turns[1].role).toBe("assistant")
      expect(turns[1].text).toContain("In Python, you can define the function")
      expect(turns[1].codeBlocks.length).toBe(1)
      expect(turns[1].codeBlocks[0].language).toBe("python")
      expect(turns[1].codeBlocks[0].code).toContain("def add_numbers(a: int, b: int) -> int:")
      expect(turns[1].codeBlocks[0].code).toContain("    result = a + b")
      expect(turns[1].text).not.toContain("Pythondef add_numbers")
      expect(turns[1].text).not.toContain("Copy")
    })

    it("locates prompt input textarea/contenteditable and passes healthCheck", () => {
      const dom = new JSDOM(fixtureHtml, { url: "https://chatgpt.com/c/chatgpt-uuid-456" })
      const inputBox = adapter.getInputBox(dom.window.document)
      expect(inputBox).not.toBeNull()
      expect(inputBox?.classList.contains("ProseMirror")).toBe(true)

      const health = adapter.healthCheck(dom.window.document)
      expect(health.ok).toBe(true)
      expect(health.inputBoxFound).toBe(true)
      expect(health.messagesFound).toBe(true)
      expect(health.issues.length).toBe(0)
    })

    it("extracts chat ID strictly from URL permalink and returns empty string on root / new chat without DOM leakage", () => {
      const dom = new JSDOM(fixtureHtml, { url: "https://chatgpt.com/c/chatgpt-uuid-456" })
      expect(adapter.getChatId("https://chatgpt.com/c/real-id-123", dom.window.document)).toBe("real-id-123")
      // Invariant (Phase 2): On root or /new, getChatId strictly returns "", saving nothing
      expect(adapter.getChatId("https://chatgpt.com/", dom.window.document)).toBe("")
      expect(adapter.getChatId("https://chatgpt.com/c/fallback-id", new JSDOM("<html><body></body></html>").window.document)).toBe("fallback-id")
      expect(adapter.getChatId("https://chatgpt.com/", new JSDOM("<html><body></body></html>").window.document)).toBe("")
      expect(adapter.getChatTitle(dom.window.document)).toBe("Database Indexing Strategies")
    })

    it("reports specific issue in healthCheck if attributes vanish on non-empty chat", () => {
      const brokenDom = new JSDOM("<!DOCTYPE html><html><body><main><form data-chatgpt-composer><div class='ProseMirror' role='textbox'></div></form><div class='random-msg'>Some chat text</div></main></body></html>", { url: "https://chatgpt.com/c/123" })
      const health = adapter.healthCheck(brokenDom.window.document)
      expect(health.ok).toBe(false)
      expect(health.issues[0]).toContain("ChatGPT conversation messages not found")
    })

    it("verifies isNewOrEmptyChat accurately detects messages and empty state", () => {
      const activeDom = new JSDOM(fixtureHtml, { url: "https://chatgpt.com/c/chatgpt-uuid-456" })
      expect(adapter.isNewOrEmptyChat(activeDom.window.document)).toBe(false)

      const emptyDom = new JSDOM("<!DOCTYPE html><html><body><main><form><div class='ProseMirror' role='textbox'></div></form></main></body></html>", { url: "https://chatgpt.com/" })
      expect(adapter.isNewOrEmptyChat(emptyDom.window.document)).toBe(true)
    })

    it("finds chat container, dedupes nested unit keys, and strips UI button noise", () => {
      const dom = new JSDOM(fixtureHtml, { url: "https://chatgpt.com/c/chatgpt-uuid-456" })
      const container = adapter.getChatContainer(dom.window.document)
      expect(container).not.toBeNull()
      expect(container?.tagName.toLowerCase()).toBe("main")

      const turns = adapter.getMessages(dom.window.document)
      expect(turns.length).toBe(2) // Deduplicated: nested 0:user did not create a 3rd turn
      expect(turns[1].text).not.toContain("Thumbs up")
      expect(turns[1].text).not.toContain("Read aloud")
      expect(turns[1].text).not.toContain("Copy")
    })

    it("scrapes live ChatGPT conversation turns using article and prose containers without author-role attributes", () => {
      const liveDomHtml = `
        <!DOCTYPE html>
        <html>
          <body>
            <main>
              <article data-testid="conversation-turn-0">
                <div class="w-full text-token-text-primary">
                  <div data-user-message-bubble="true">
                    <div class="whitespace-pre-wrap">who is aariz</div>
                  </div>
                </div>
              </article>
              <article data-testid="conversation-turn-1">
                <div class="w-full text-token-text-primary">
                  <div class="prose dark:prose-invert break-words">
                    <p>Aariz is an Arabic male name meaning respectable or intelligent leader.</p>
                  </div>
                  <div role="toolbar" aria-label="Message actions">
                    <button aria-label="Copy">Copy</button>
                    <button aria-label="Good response">Thumbs up</button>
                  </div>
                </div>
              </article>
            </main>
          </body>
        </html>
      `
      const dom = new JSDOM(liveDomHtml, { url: "https://chatgpt.com/c/live-aariz-uuid" })
      const turns = adapter.getMessages(dom.window.document)

      expect(turns.length).toBe(2)
      expect(turns[0].role).toBe("user")
      expect(turns[0].text).toBe("who is aariz")

      expect(turns[1].role).toBe("assistant")
      expect(turns[1].text).toBe("Aariz is an Arabic male name meaning respectable or intelligent leader.")
      expect(turns[1].text).not.toContain("Copy")
      expect(turns[1].text).not.toContain("Thumbs up")
    })
  })


  describe("Safe Plain Text Insertion (Zero Auto-Submit & React Sync)", () => {
    it("inserts text into HTMLTextAreaElement with prototype setter & InputEvent", () => {
      const dom = new JSDOM("<!DOCTYPE html><textarea id='input'></textarea>")
      const textarea = dom.window.document.getElementById("input") as HTMLTextAreaElement

      let inputEventFired = false
      textarea.addEventListener("input", (e) => {
        if (e.bubbles) inputEventFired = true
      })

      const success = safeInsertText(textarea, "Hello from Context Bridge")
      expect(success).toBe(true)
      expect(textarea.value).toBe("Hello from Context Bridge")
      expect(inputEventFired).toBe(true)
    })

    it("inserts text into contenteditable div without innerHTML and dispatches InputEvent", () => {
      const dom = new JSDOM("<!DOCTYPE html><div id='editor' contenteditable='true'></div>")
      const editor = dom.window.document.getElementById("editor") as HTMLElement

      let inputEventFired = false
      editor.addEventListener("input", (e) => {
        if (e.bubbles) inputEventFired = true
      })

      const success = safeInsertText(editor, "Inserted Plain Text Content")
      expect(success).toBe(true)
      expect(editor.textContent).toBe("Inserted Plain Text Content")
      expect(inputEventFired).toBe(true)
    })

    it("successfully completes via synthetic paste event when host editor intercepts paste (modern box packaging)", () => {
      const dom = new JSDOM("<!DOCTYPE html><div id='chatgpt-editor' contenteditable='true'></div>")
      const editor = dom.window.document.getElementById("chatgpt-editor") as HTMLElement
      let pasteReceived = false
      let receivedText = ""

      editor.addEventListener("paste", (e: any) => {
        pasteReceived = true
        receivedText = e.clipboardData?.getData("text/plain") || ""
        // Modern AI platform packages into an expandable box and calls preventDefault
        e.preventDefault()
      })

      const success = safeInsertText(editor, "Long handover context to be packaged in expandable card")
      expect(success).toBe(true)
      expect(pasteReceived).toBe(true)
      expect(receivedText).toBe("Long handover context to be packaged in expandable card")
    })
  })
})
