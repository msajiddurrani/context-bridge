import { describe, expect, it } from "vitest"
import { JSDOM } from "jsdom"
import fs from "fs"
import path from "path"
import { ClaudeAdapter } from "../src/adapters/claude"
import { ChatGPTAdapter } from "../src/adapters/chatgpt"
import { getAdapterForUrl } from "../src/adapters"
import { safeInsertText } from "../src/utils/dom-insert"

describe("Platform Adapters (Claude & ChatGPT)", () => {
  it("resolves adapters correctly from URL registry", () => {
    expect(getAdapterForUrl("https://claude.ai/chat/12345")?.id).toBe("claude")
    expect(getAdapterForUrl("https://chatgpt.com/c/67890")?.id).toBe("chatgpt")
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
      expect(adapter.getChatTitle(dom.window.document)).toBe("Engineering Architecture Discussion")
    })
  })

  describe("ChatGPT Adapter", () => {
    const adapter = new ChatGPTAdapter()
    const fixtureHtml = fs.readFileSync(
      path.resolve(__dirname, "../src/adapters/fixtures/chatgpt.html"),
      "utf-8"
    )

    it("scrapes conversation turns and verbatim SQL code blocks from HTML fixture", () => {
      const dom = new JSDOM(fixtureHtml, { url: "https://chatgpt.com/c/chatgpt-uuid-456" })
      const turns = adapter.getMessages(dom.window.document)

      expect(turns.length).toBe(2)
      expect(turns[0].role).toBe("user")
      expect(turns[0].text).toContain("B-tree indexes")

      expect(turns[1].role).toBe("assistant")
      expect(turns[1].text).toContain("PostgreSQL")
      expect(turns[1].codeBlocks.length).toBe(1)
      expect(turns[1].codeBlocks[0].language).toBe("sql")
      expect(turns[1].codeBlocks[0].code).toContain("CREATE INDEX idx_orders_customer_created")
    })

    it("locates prompt input textarea/contenteditable and passes healthCheck", () => {
      const dom = new JSDOM(fixtureHtml, { url: "https://chatgpt.com/c/chatgpt-uuid-456" })
      const inputBox = adapter.getInputBox(dom.window.document)
      expect(inputBox).not.toBeNull()
      expect(inputBox?.id).toBe("prompt-textarea")

      const health = adapter.healthCheck(dom.window.document)
      expect(health.ok).toBe(true)
      expect(health.inputBoxFound).toBe(true)
      expect(health.messagesFound).toBe(true)
      expect(health.issues.length).toBe(0)
    })

    it("extracts chat ID and title correctly", () => {
      const dom = new JSDOM(fixtureHtml, { url: "https://chatgpt.com/c/chatgpt-uuid-456" })
      expect(adapter.getChatId("https://chatgpt.com/c/chatgpt-uuid-456", dom.window.document)).toBe("chatgpt-uuid-456")
      expect(adapter.getChatTitle(dom.window.document)).toBe("Database Indexing Strategies")
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
  })
})
