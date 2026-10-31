import { describe, expect, it } from "vitest"
import {
  findMarkerPathReport,
  formatSanitizedElement
} from "../src/utils/dom-marker-path"

describe("DOM Marker Path Investigator", () => {
  it("formats element strictly with allowed attributes and no text/inputs/URLs", () => {
    const el = document.createElement("div")
    el.id = "turn-wrapper"
    el.className = "flex col-item extra-ignored-class"
    el.setAttribute("role", "article")
    el.setAttribute("aria-label", "User message")
    el.setAttribute("data-message-author-role", "user")
    el.setAttribute("data-testid", "conversation-turn-4")
    el.setAttribute("data-url", "https://malicious.com/secret")
    el.textContent = "Super private secret text that must not leak"

    const formatted = formatSanitizedElement(el)
    expect(formatted).toContain('id="turn-wrapper"')
    expect(formatted).toContain('class="flex col-item"')
    expect(formatted).not.toContain("extra-ignored-class")
    expect(formatted).toContain('role="article"')
    expect(formatted).toContain('aria-label="User message"')
    expect(formatted).toContain('data-message-author-role="user"')
    expect(formatted).toContain('data-testid="conversation-turn-4"')
    expect(formatted).not.toContain("https://malicious.com")
    expect(formatted).toContain("[URL]")
    expect(formatted).not.toContain("Super private secret")
  })

  it("finds marker path and outputs ancestor chain with sibling information", () => {
    const main = document.createElement("main")
    main.id = "chat-main"

    const shell = document.createElement("div")
    shell.setAttribute("data-app-shell", "true")

    const thread = document.createElement("div")
    thread.setAttribute("data-testid", "conversation-thread")

    const prevTurn = document.createElement("article")
    prevTurn.setAttribute("data-turn", "1")

    const targetTurn = document.createElement("article")
    targetTurn.setAttribute("data-turn", "2")
    targetTurn.id = "target-turn"

    const nextTurn = document.createElement("article")
    nextTurn.setAttribute("data-turn", "3")

    const bubble = document.createElement("div")
    bubble.className = "text-bubble prose"
    const textNode = document.createTextNode("Hello world zzmarker1 here")
    bubble.appendChild(textNode)

    targetTurn.appendChild(bubble)
    thread.appendChild(prevTurn)
    thread.appendChild(targetTurn)
    thread.appendChild(nextTurn)
    shell.appendChild(thread)
    main.appendChild(shell)

    // Add prompt textarea
    const textarea = document.createElement("textarea")
    textarea.id = "prompt-textarea"
    main.appendChild(textarea)

    const report = findMarkerPathReport("zzmarker1", main)

    // Section 1: Marker matches
    expect(report).toContain('Search Marker: "zzmarker1"')
    expect(report).toContain("Found 1 element(s) matching marker")
    expect(report).toContain("<article id=\"target-turn\" data-turn=\"2\">")
    expect(report).toContain("Siblings total: 2")
    expect(report).toContain('Prev sibling: <article data-turn="1">')
    expect(report).toContain('Next sibling: <article data-turn="3">')

    // Section 2: Input box
    expect(report).toContain("PROMPT INPUT BOX ANCESTOR CHAIN")
    expect(report).toContain('<textarea id="prompt-textarea">')

    // Section 3: Attributes
    expect(report).toContain("TURN & MESSAGE ATTRIBUTE CANDIDATES")
    expect(report).toContain('data-turn="1"')
    expect(report).toContain('data-turn="2"')
    expect(report).toContain('data-turn="3"')

    // Zero secret text
    expect(report).not.toContain("Hello world")
  })

  it("handles missing marker with helpful prompt", () => {
    const main = document.createElement("main")
    const report = findMarkerPathReport("nonexistent_marker", main)
    expect(report).toContain('No text nodes found containing marker "nonexistent_marker"')
  })

  it("handles null root gracefully", () => {
    const report = findMarkerPathReport("zzmarker1", null)
    expect(report).toContain("Error: No <main> or container element found")
  })
})
