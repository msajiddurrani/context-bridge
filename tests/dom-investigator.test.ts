import { beforeEach, describe, expect, it } from "vitest"
import {
  buildFullSiteReport,
  detectValueShape,
  formatInvestigatorElement,
  maskPathname,
  searchMarkerInAllRoots
} from "../src/utils/dom-investigator"

describe("Universal DOM Investigator Engine (Stage 3 Part A)", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
    document.title = "AI Chat Assistant"
  })

  it("masks id-like pathnames correctly", () => {
    expect(maskPathname("/c/67123abc-4567-8901-cdef")).toBe("/c/<id>")
    expect(maskPathname("/chat/123456789")).toBe("/chat/<id>")
    expect(maskPathname("/app/session_abcdef1234567890/turn_1234567890")).toBe("/app/<id>/<id>")
    expect(maskPathname("/explore")).toBe("/explore")
    expect(maskPathname("/")).toBe("/")
  })

  it("detects attribute value shapes accurately", () => {
    expect(detectValueShape("67123abc-4567-8901-cdef-1234567890ab")).toBe("<uuid>")
    expect(detectValueShape("12345678")).toBe("<number>")
    expect(detectValueShape("conversation-turn-4")).toBe("<slug>")
    expect(detectValueShape("msg_active_user")).toBe("<slug>")
  })

  it("builds full site report with shadow root, custom elements, contenteditable input, textarea, and code blocks", () => {
    // 1. Sidebar with chat links
    const nav = document.createElement("nav")
    nav.setAttribute("role", "navigation")
    const link1 = document.createElement("a")
    link1.href = "/c/67123abc-4567-8901-cdef"
    link1.textContent = "Chat 1 title that should not be printed"
    const link2 = document.createElement("a")
    link2.href = "/c/88990abc-1122-3344-beef"
    link2.textContent = "Chat 2 title that should not be printed"
    nav.appendChild(link1)
    nav.appendChild(link2)
    document.body.appendChild(nav)

    // 2. Main layout with scroll container
    const main = document.createElement("main")
    main.setAttribute("role", "main")
    main.style.overflowY = "auto"

    // 3. Custom element message list container
    const chatApp = document.createElement("custom-chat-app")
    const turnList = document.createElement("custom-turn-list")
    turnList.setAttribute("data-testid", "turn-list-container")

    // Turn 1: user turn with marker1
    const turn1 = document.createElement("custom-turn")
    turn1.id = "turn-uuid-1111-2222-3333-4444"
    turn1.setAttribute("data-message-id", "11111111-2222-3333-4444-555555555555")
    turn1.setAttribute("data-turn-index", "1")
    turn1.setAttribute("data-role", "user")
    const turn1Bubble = document.createElement("div")
    turn1Bubble.className = "prose user-msg"
    turn1Bubble.appendChild(document.createTextNode("User question with zzmarker1 here"))
    turn1.appendChild(turn1Bubble)

    // Turn 2: assistant turn with separate-line code block and marker2
    const turn2 = document.createElement("custom-turn")
    turn2.id = "turn-uuid-5555-6666-7777-8888"
    turn2.setAttribute("data-message-id", "22222222-3333-4444-5555-666666666666")
    turn2.setAttribute("data-turn-index", "2")
    turn2.setAttribute("data-role", "assistant")

    const codeHeader = document.createElement("div")
    codeHeader.className = "code-header"
    const langSpan = document.createElement("span")
    langSpan.setAttribute("data-language", "python")
    langSpan.className = "language-python"
    const copyBtn = document.createElement("button")
    copyBtn.setAttribute("aria-label", "Copy code")
    codeHeader.appendChild(langSpan)
    codeHeader.appendChild(copyBtn)

    const codeBlock = document.createElement("pre")
    codeBlock.style.whiteSpace = "pre-wrap"
    const line1 = document.createElement("div")
    line1.className = "code-line"
    line1.textContent = "def calculate():"
    const line2 = document.createElement("div")
    line2.className = "code-line"
    line2.textContent = "    secret = 'zzmarker2'"
    codeBlock.appendChild(line1)
    codeBlock.appendChild(line2)

    turn2.appendChild(codeHeader)
    turn2.appendChild(codeBlock)

    turnList.appendChild(turn1)
    turnList.appendChild(turn2)
    chatApp.appendChild(turnList)
    main.appendChild(chatApp)

    // 4. Contenteditable input box and Send button
    const form = document.createElement("form")
    const inputDiv = document.createElement("div")
    inputDiv.setAttribute("contenteditable", "true")
    inputDiv.setAttribute("role", "textbox")
    inputDiv.setAttribute("aria-label", "Prompt box")
    inputDiv.setAttribute("placeholder", "Type your query here...")
    inputDiv.id = "prompt-textarea"

    const sendBtn = document.createElement("button")
    sendBtn.setAttribute("type", "submit")
    sendBtn.setAttribute("aria-label", "Send prompt")
    sendBtn.disabled = true

    form.appendChild(inputDiv)
    form.appendChild(sendBtn)
    main.appendChild(form)

    // 5. Rate limit text
    const limitBanner = document.createElement("div")
    limitBanner.className = "alert-banner warning"
    limitBanner.textContent = "You have reached your usage cap for today. Please try again later."
    main.appendChild(limitBanner)

    // 6. Open Shadow Root custom element
    const shadowHost = document.createElement("custom-shadow-panel")
    const shadowRoot = shadowHost.attachShadow({ mode: "open" })
    const shadowInner = document.createElement("div")
    shadowInner.setAttribute("data-shadow-content", "true")
    shadowInner.textContent = "Shadow text without markers"
    shadowRoot.appendChild(shadowInner)
    main.appendChild(shadowHost)

    document.body.appendChild(main)

    // Run report
    const win = {
      location: {
        hostname: "gemini.google.com",
        pathname: "/app/session_abcdef1234567890",
        href: "https://gemini.google.com/app/session_abcdef1234567890"
      }
    } as any

    const report = buildFullSiteReport(document, win, {
      marker1: "zzmarker1",
      marker2: "zzmarker2",
      navEvents: [
        { timeOffset: "0.0s", path: "/app" },
        { timeOffset: "3.5s", path: "/app/session_abcdef1234567890" }
      ]
    })

    // Assert Section a) SITE
    expect(report).toContain("--- a) SITE ---")
    expect(report).toContain('Page Title: "AI Chat Assistant"')
    expect(report).toContain("Hostname: gemini.google.com")
    expect(report).toContain("Pathname: /app/<id>")
    expect(report).toContain("Sidebar Chat Links Found: 2")
    expect(report).toContain("/c/<id>")
    expect(report).not.toContain("Chat 1 title")

    // Assert Section b) MARKER PATHS
    expect(report).toContain("--- b) MARKER PATHS ---")
    expect(report).toContain('Marker 1 (User Message): "zzmarker1"')
    expect(report).toContain('Marker 2 (Code Block): "zzmarker2"')
    expect(report).toContain("<custom-turn")
    expect(report).toContain("<custom-turn-list")
    expect(report).toContain("<custom-chat-app")

    // Assert Section c) MESSAGE CONTAINERS
    expect(report).toContain("--- c) MESSAGE CONTAINERS ---")
    expect(report).toContain("Nearest Repeating Ancestor: <custom-turn")
    expect(report).toContain("Sibling Count Sharing Tag & Attributes: 2")
    expect(report).toContain("Parent Message List Container: <custom-turn-list")

    // Assert Section d) CODE BLOCK
    expect(report).toContain("--- d) CODE BLOCK ---")
    expect(report).toContain("separate elements (<div> per line, count: 2)")
    expect(report).toContain('Whitespace Preserved (white-space CSS): "pre-wrap"')
    expect(report).toContain("data-language")
    expect(report).toContain('aria-label="Copy code"')

    // Assert Section e) MESSAGE ID CANDIDATES
    expect(report).toContain("--- e) MESSAGE ID CANDIDATES ---")
    expect(report).toContain("data-message-id: shape=<uuid>, unique=true")
    expect(report).toContain("data-turn-index: shape=<number>, unique=true")

    // Assert Section f) INPUT & SEND BUTTON
    expect(report).toContain("--- f) INPUT & SEND BUTTON ---")
    expect(report).toContain("Type: contenteditable")
    expect(report).toContain('Role: "textbox"')
    expect(report).toContain('Placeholder: "Type your query here..."')
    expect(report).toContain("Disabled: true")

    // Assert Section g) SCROLL CONTAINER
    expect(report).toContain("--- g) SCROLL CONTAINER ---")
    expect(report).toContain("Scroll Container: <main")

    // Assert Section h) NEW/EMPTY CHAT
    expect(report).toContain("--- h) NEW/EMPTY CHAT ---")
    expect(report).toContain("Is Empty Chat: NO (Active chat with turns)")

    // Assert Section i) LIMIT TEXT
    expect(report).toContain("--- i) LIMIT TEXT ---")
    expect(report).toContain('Matching phrase: "try again later"')

    // Assert Section j) NAVIGATION
    expect(report).toContain("--- j) NAVIGATION ---")
    expect(report).toContain("[0.0s] /app")
    expect(report).toContain("[3.5s] /app/<id>")
  })

  it("redacts all fake secrets (sk-..., AIza..., JWT, private keys) and chat text (Task 4)", () => {
    const main = document.createElement("main")

    // Turn with fake secrets in DOM
    const turn = document.createElement("article")
    turn.setAttribute("data-message-author-role", "user")
    turn.setAttribute("data-token-key", "sk-proj-9876543210abcdef9876543210abcdef98765432")

    const bubble = document.createElement("div")
    bubble.className = "prose"
    bubble.textContent =
      "Here is my OpenAI key sk-1234567890abcdef1234567890abcdef and Google key AIzaSyD9jK2l9m4n8p7q6r5s4t3u2v1w0x9y8z7 and JWT eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefzzmarker1"

    turn.appendChild(bubble)
    main.appendChild(turn)

    // Code block with <br> and secrets
    const pre = document.createElement("pre")
    const code = document.createElement("code")
    code.appendChild(document.createTextNode("const secret = 'sk-proj-abcde';"))
    code.appendChild(document.createElement("br"))
    code.appendChild(document.createTextNode("const key = 'zzmarker2';"))
    pre.appendChild(code)
    main.appendChild(pre)

    document.body.appendChild(main)

    const win = {
      location: {
        hostname: "chat.deepseek.com",
        pathname: "/c/secret-session-uuid-1234"
      }
    } as any

    const report = buildFullSiteReport(document, win, {
      marker1: "zzmarker1",
      marker2: "zzmarker2"
    })

    // Code structure with <br>
    expect(report).toContain("<br> elements separating lines")

    // REDACTION ASSERTIONS
    expect(report).not.toContain("sk-proj-9876543210abcdef")
    expect(report).not.toContain("sk-1234567890abcdef")
    expect(report).not.toContain("AIzaSyD9jK2l9m4n8p7q6r5s4t3u2v1w0x9y8z7")
    expect(report).not.toContain("eyJhbGciOiJIUzI1Ni")
    expect(report).not.toContain("Here is my OpenAI key")
    expect(report).not.toContain("secret = 'sk-proj-abcde'")
  })
})
