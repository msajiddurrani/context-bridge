import { describe, it, expect } from "vitest"
import { generateDomSkeleton, sanitizeAttrValue } from "../src/utils/dom-skeleton"

describe("Sanitized DOM Skeleton Generator", () => {
  it("sanitizes URLs and limits string length", () => {
    const raw = "Visit https://malicious.example.com/secret?key=123 now"
    const sanitized = sanitizeAttrValue(raw)
    expect(sanitized).not.toContain("https://")
    expect(sanitized).toContain("[URL]")
  })

  it("extracts allowed attributes and excludes text content, inputs, and unallowed attributes", () => {
    const container = document.createElement("main")
    container.id = "main-chat"
    container.className = "flex flex-col bg-slate-900 border-none extra-class"
    container.setAttribute("role", "main")
    container.setAttribute("aria-label", "Chat Area")
    container.setAttribute("data-testid", "conversation-container")
    container.setAttribute("data-turn-count", "5")
    container.setAttribute("style", "color: red; display: flex;")
    container.setAttribute("title", "Secret Tooltip")

    const userTurn = document.createElement("div")
    userTurn.setAttribute("data-message-author-role", "user")
    userTurn.className = "user-turn active"
    userTurn.textContent = "This is private user question text that MUST NOT be exposed!"

    const input = document.createElement("input")
    input.setAttribute("value", "private-api-key-12345")
    input.setAttribute("data-testid", "prompt-input")

    userTurn.appendChild(input)
    container.appendChild(userTurn)

    const skeleton = generateDomSkeleton(container)

    // Should include allowed attributes
    expect(skeleton).toContain('id="main-chat"')
    expect(skeleton).toContain('role="main"')
    expect(skeleton).toContain('aria-label="Chat Area"')
    expect(skeleton).toContain('data-testid="conversation-container"')
    expect(skeleton).toContain('data-turn-count="5"')
    expect(skeleton).toContain('data-message-author-role="user"')

    // First 2 class names only
    expect(skeleton).toContain('class="flex flex-col"')
    expect(skeleton).not.toContain("extra-class")

    // Must NOT contain sensitive text or unallowed attributes
    expect(skeleton).not.toContain("private user question text")
    expect(skeleton).not.toContain("private-api-key")
    expect(skeleton).not.toContain("color: red")
    expect(skeleton).not.toContain("Secret Tooltip")
    expect(skeleton).not.toContain("value=")
    expect(skeleton).not.toContain("style=")
    expect(skeleton).not.toContain("title=")
  })

  it("indents children by 2 spaces per depth level", () => {
    const root = document.createElement("div")
    root.id = "root"
    const child = document.createElement("div")
    child.id = "child"
    const grandchild = document.createElement("span")
    grandchild.id = "grandchild"

    child.appendChild(grandchild)
    root.appendChild(child)

    const skeleton = generateDomSkeleton(root)
    const lines = skeleton.split("\n")

    expect(lines[0]).toBe('<div id="root">')
    expect(lines[1]).toBe('  <div id="child">')
    expect(lines[2]).toBe('    <span id="grandchild" />')
    expect(lines[3]).toBe("  </div>")
    expect(lines[4]).toBe("</div>")
  })

  it("respects maxElements limit and truncates safely", () => {
    const root = document.createElement("div")
    for (let i = 0; i < 50; i++) {
      const el = document.createElement("p")
      el.setAttribute("data-idx", String(i))
      root.appendChild(el)
    }

    const skeleton = generateDomSkeleton(root, { maxElements: 10 })
    expect(skeleton).toContain("<!-- [Truncated: reached 10 element limit] -->")
  })

  it("handles null root gracefully", () => {
    const skeleton = generateDomSkeleton(null)
    expect(skeleton).toBe("<!-- No element found -->")
  })
})
