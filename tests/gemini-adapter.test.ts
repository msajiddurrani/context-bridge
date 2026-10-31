import { describe, expect, it } from "vitest"
import { JSDOM } from "jsdom"
import * as fs from "fs"
import * as path from "path"
import { GeminiAdapter } from "../src/adapters/gemini"
import { getAdapterForUrl } from "../src/adapters"
import type { StateMemory } from "../src/types"

describe("Platform Adapter: Gemini", () => {
  const adapter = new GeminiAdapter()
  const fixtureHtml = fs.readFileSync(
    path.resolve(__dirname, "../src/adapters/fixtures/gemini.html"),
    "utf-8"
  )

  it("resolves Gemini adapter from URL registry", () => {
    const resolved = getAdapterForUrl("https://gemini.google.com/app/b260917075a6aaec")
    expect(resolved).not.toBeNull()
    expect(resolved?.id).toBe("gemini")
    expect(resolved?.displayName).toBe("Gemini")
  })

  it("matches valid gemini.google.com URLs and rejects others", () => {
    expect(adapter.matches("https://gemini.google.com/app")).toBe(true)
    expect(adapter.matches("https://gemini.google.com/app/b260917075a6aaec")).toBe(true)
    expect(adapter.matches("https://google.com/search")).toBe(false)
    expect(adapter.matches("https://bard.google.com/")).toBe(false)
  })

  it("extracts chatId correctly from permalink URLs and returns empty string for /app root", () => {
    expect(adapter.getChatId("https://gemini.google.com/app/b260917075a6aaec")).toBe("b260917075a6aaec")
    expect(adapter.getChatId("https://gemini.google.com/app/test_chat-123")).toBe("test_chat-123")
    expect(adapter.getChatId("https://gemini.google.com/app")).toBe("")
    expect(adapter.getChatId("https://gemini.google.com/")).toBe("")
  })

  it("extracts chat title from first user request without relying on document.title", () => {
    const dom = new JSDOM(fixtureHtml, { url: "https://gemini.google.com/app/b260917075a6aaec" })
    const title = adapter.getChatTitle(dom.window.document)
    expect(title).toBe("Can you show me a minimal Python WebSocket server using webs")

    // Test fallback when no user messages: empty string, never document.title
    const fallbackDom = new JSDOM("<html><head><title>FastAPI Tutorial - Gemini</title></head><body></body></html>", {
      url: "https://gemini.google.com/app/123"
    })
    expect(adapter.getChatTitle(fallbackDom.window.document)).toBe("")
  })

  it("identifies new/empty chat correctly", () => {
    const emptyDom = new JSDOM("<html><body></body></html>", {
      url: "https://gemini.google.com/app"
    })
    expect(adapter.isNewOrEmptyChat(emptyDom.window.document)).toBe(true)

    const fullDom = new JSDOM(fixtureHtml, { url: "https://gemini.google.com/app/b260917075a6aaec" })
    expect(adapter.isNewOrEmptyChat(fullDom.window.document)).toBe(false)
  })

  it("finds the contenteditable input box inside rich-textarea", () => {
    const dom = new JSDOM(fixtureHtml, { url: "https://gemini.google.com/app/b260917075a6aaec" })
    const inputBox = adapter.getInputBox(dom.window.document)
    expect(inputBox).not.toBeNull()
    expect(inputBox?.getAttribute("contenteditable")).toBe("true")
    expect(inputBox?.getAttribute("role")).toBe("textbox")
  })

  it("extracts conversation turns and verbatim code blocks from Gemini fixture", () => {
    const dom = new JSDOM(fixtureHtml, { url: "https://gemini.google.com/app/b260917075a6aaec" })
    const turns = adapter.getMessages(dom.window.document)

    expect(turns.length).toBe(2)

    // User turn
    expect(turns[0].role).toBe("user")
    expect(turns[0].text).toContain("minimal Python WebSocket server")
    expect(turns[0].codeBlocks.length).toBe(0)

    // Model response turn
    expect(turns[1].role).toBe("assistant")
    expect(turns[1].text).toContain("complete asynchronous WebSocket server implementation")
    expect(turns[1].text).not.toContain("Copy code") // UI action button stripped
    expect(turns[1].text).not.toContain("Good response") // Footer button stripped
    expect(turns[1].codeBlocks.length).toBe(1)
    expect(turns[1].codeBlocks[0].language).toBe("python")
    expect(turns[1].codeBlocks[0].code).toContain("import asyncio")
    expect(turns[1].codeBlocks[0].code).toContain("async with websockets.serve")
  })

  it("runs healthCheck successfully on valid Gemini fixture", () => {
    const dom = new JSDOM(fixtureHtml, { url: "https://gemini.google.com/app/b260917075a6aaec" })
    const health = adapter.healthCheck(dom.window.document)
    expect(health.ok).toBe(true)
    expect(health.inputBoxFound).toBe(true)
    expect(health.messagesFound).toBe(true)
    expect(health.issues.length).toBe(0)
  })

  it("reports issues in healthCheck if input box is missing on non-empty chat", () => {
    const brokenDom = new JSDOM("<html><body><main><user-query><div class='query-text'>Hello</div></user-query></main></body></html>", {
      url: "https://gemini.google.com/app/b260917075a6aaec"
    })
    const health = adapter.healthCheck(brokenDom.window.document)
    expect(health.ok).toBe(false)
    expect(health.inputBoxFound).toBe(false)
    expect(health.messagesFound).toBe(true)
    expect(health.issues.some((i) => i.includes("input box not found"))).toBe(true)
  })

  it("safely inserts text into contenteditable input without submitting", () => {
    const dom = new JSDOM(fixtureHtml, { url: "https://gemini.google.com/app/b260917075a6aaec" })
    const inputBox = adapter.getInputBox(dom.window.document)
    expect(inputBox).not.toBeNull()

    let inputFired = false
    inputBox!.addEventListener("input", () => {
      inputFired = true
    })

    const success = adapter.insertText(inputBox!, "Hello Gemini Context")
    expect(success).toBe(true)
    expect(inputBox!.textContent).toContain("Hello Gemini Context")
    expect(inputFired).toBe(true)
  })

  it("formats handover markdown with directives, referenced links, and code blocks", () => {
    const sampleMemory: StateMemory = {
      version: "1.0",
      objective: "Build a high throughput WebSocket server with redis pubsub",
      techStack: ["Python 3.12", "WebSockets", "Redis"],
      architectureDecisions: ["Use asyncio event loop", "Separate ingress from worker pool"],
      currentWork: "User: How do we integrate https://github.com/redis/redis-py into the loop?\n\nAssistant: Refer to documentation at https://redis.io/docs/latest/develop/connect/clients/python/",
      blockersAndErrors: [],
      nextSteps: ["Implement connection heartbeat"],
      criticalSnippets: [
        {
          id: "snippet-1",
          language: "python",
          code: "async def ping(): pass",
          turnIndex: 1,
          filePath: "server.py"
        }
      ],
      rawTokenEstimate: 120
    }

    const output = adapter.formatFor(sampleMemory, "chatgpt", "markdown")
    expect(output).toContain('<ctx from="chatgpt"')
    expect(output).toContain('<goal>Build a high throughput WebSocket server with redis pubsub</goal>')
    expect(output).toContain('Reply "Ready" in one word')
    expect(output).toContain("https://github.com/redis/redis-py")
    expect(output).toContain("https://redis.io/docs/latest/develop/connect/clients/python/")
    expect(output).toContain('<code file="server.py" lang="python">')
    expect(output).toContain("async def ping(): pass")
    expect(output).toContain("</code>")
  })

  it("reproduces and fixes user 'hi' scenario: strips 'You said', duplicate 'hi', 'Gemini said', and '- Google Gemini'", () => {
    const liveMarkup = `
<!DOCTYPE html>
<html>
<head>
  <title>Initial Greeting - Google Gemini</title>
</head>
<body>
  <div class="chat-app-root">
    <header>
      <h1 class="conversation-title">Initial Greeting - Google Gemini</h1>
    </header>
    <main>
      <user-query data-query-id="query-1">
        <h2 class="cdk-visually-hidden">You said</h2>
        <div class="user-query-container">
          <div class="query-content">
            <div class="query-text">
              <p>hi</p>
            </div>
          </div>
          <div class="edit-query-container">
            <button class="edit-button">
              <span class="cdk-visually-hidden">Edit query</span>
              <div class="query-mirror">hi</div>
            </button>
          </div>
        </div>
      </user-query>

      <model-response data-response-id="response-1">
        <h2 class="cdk-visually-hidden">Gemini said</h2>
        <div class="response-container-content message-content">
          <p>Hello. How can I help you today?</p>
        </div>
        <div class="response-footer">
          <button aria-label="Copy">Copy</button>
        </div>
      </model-response>
    </main>
  </div>
</body>
</html>
    `
    const dom = new JSDOM(liveMarkup, { url: "https://gemini.google.com/app/03994d5bdd3b7ced" })
    
    // 1. Verify title comes from first user request ("hi"), not document.title
    const title = adapter.getChatTitle(dom.window.document)
    expect(title).toBe("hi")

    // 2. Verify messages extract clean text without 'You said', duplicate 'hi', or 'Gemini said'
    const turns = adapter.getMessages(dom.window.document)
    expect(turns).toHaveLength(2)

    // User turn: strictly 'hi'
    expect(turns[0].role).toBe("user")
    expect(turns[0].text).toBe("hi")
    expect(turns[0].text).not.toContain("You said")
    expect(turns[0].text).not.toContain("hi  hi")

    // Assistant turn: strictly 'Hello. How can I help you today?'
    expect(turns[1].role).toBe("assistant")
    expect(turns[1].text).toBe("Hello. How can I help you today?")
    expect(turns[1].text).not.toContain("Gemini said")
  })
})
