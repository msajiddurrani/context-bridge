import { describe, expect, it } from "vitest"
import { JSDOM } from "jsdom"
import { ChatGPTAdapter } from "../src/adapters/chatgpt"
import { buildLocalStateMemory } from "../src/utils/local-mode"
import { formatStateMemoryPrompt } from "../src/utils/prompt-formatter"

describe("ChatGPT Real CodeMirror 6 Fixture Extraction & Verbatim Preservation", () => {
  const adapter = new ChatGPTAdapter()

  // Real ChatGPT DOM representation derived directly from the DOM investigator report
  const realCodemirrorHtml = `
    <!DOCTYPE html>
    <html>
    <body>
      <main id="_r_ji_" class="outline-none MainContentSurface-EnuIYE" data-codex-history-swipe-page="true" data-app-shell-main-surface="browser">
        <div class="thread-scroll-container" role="region" aria-label="Conversation">
          
          <!-- User Turn -->
          <div data-chatgpt-search-unit-key="fallback-turn-0:0:user" data-content-search-unit-key="fallback-turn-0:0:user" data-chatgpt-search-message-ids="msg-user-cm-0001">
            <div class="text-size-chat whitespace-pre-wrap">Write a Python function to add two numbers with docstrings and type hints.</div>
          </div>

          <!-- Assistant Turn matching Investigator Report Match #2 -->
          <div data-chatgpt-search-unit-key="fallback-turn-0:1:assistant" data-content-search-unit-key="fallback-turn-0:1:assistant">
            <div data-chatgpt-selection-conversation-id="local-chatgpt:9bf359b9-1ab5-4921-a8a5-0a01612736e4" data-chatgpt-selection-message-id="cd0178a7-2b82-435a-be23-d22390b5cc5c">
              <div data-markdown-text-style="assistant-message">
                <p>Here is the implementation in Python:</p>
                <div class="relative Root-iW7ipz" data-code-block="true" data-markdown-copy="code-block" data-theme="dark" data-search-result-target="">
                  <div class="code-header flex justify-between">
                    <span>Python</span>
                    <button aria-label="Copy code">Copy</button>
                  </div>
                  <div class="min-h-24 w-full" data-editor-search-surface="true">
                    <div class="cm-editor ͼ1">
                      <div class="cm-scroller chatgpt-code-scrollport">
                        <div class="cm-content" role="textbox" aria-label="Edit code" data-language="python">
                          <div class="cm-line">def add_numbers(a: int, b: int) -&gt; int:</div>
                          <div class="cm-line">    """Adds two numbers and returns the result."""</div>
                          <div class="cm-line">    result = a + b</div>
                          <div class="cm-line">    return result</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <p>You can import and call this function in your Python script.</p>
              </div>
            </div>
          </div>

        </div>
      </main>
    </body>
    </html>
  `

  it("extracts verbatim multi-line indented code preserving newlines and indentation", () => {
    const dom = new JSDOM(realCodemirrorHtml, { url: "https://chatgpt.com/c/test-chat-123" })
    const turns = adapter.getMessages(dom.window.document)

    expect(turns.length).toBe(2)
    const userTurn = turns[0]
    const assistantTurn = turns[1]

    expect(userTurn.role).toBe("user")
    expect(userTurn.text).toContain("Write a Python function to add two numbers")

    expect(assistantTurn.role).toBe("assistant")
    expect(assistantTurn.codeBlocks.length).toBe(1)

    const codeBlock = assistantTurn.codeBlocks[0]
    expect(codeBlock.language).toBe("python")

    // Assert exact multi-line indented string
    const expectedCode = [
      "def add_numbers(a: int, b: int) -> int:",
      '    """Adds two numbers and returns the result."""',
      "    result = a + b",
      "    return result"
    ].join("\n")

    expect(codeBlock.code).toBe(expectedCode)

    // Assert code and headers (Python, Copy) are completely removed from the prose
    expect(assistantTurn.text).not.toContain("Pythondef add_numbers")
    expect(assistantTurn.text).not.toContain("Copy")
    expect(assistantTurn.text).toContain("Here is the implementation in Python:")
    expect(assistantTurn.text).toContain("You can import and call this function in your Python script.")
  })

  it("verifies exact XML round-trip via buildLocalStateMemory and formatStateMemoryPrompt", () => {
    const dom = new JSDOM(realCodemirrorHtml, { url: "https://chatgpt.com/c/test-chat-123" })
    const turns = adapter.getMessages(dom.window.document)
    const assistantTurn = turns[1]

    const memory = buildLocalStateMemory(turns, assistantTurn.codeBlocks, "Python Add Function", "standard")
    const formatted = formatStateMemoryPrompt(memory, "chatgpt", "claude", "2m")

    // Invariant: Tags not labels, exact line format
    expect(formatted).toContain('<ctx from="chatgpt" age="2m">')
    expect(formatted).toContain('Continue this work. Don\'t re-summarize. Reply "Ready" in one word, then wait for my next message.')
    expect(formatted).toContain("<goal>Write a Python function to add two numbers with docstrings and type hints</goal>")
    expect(formatted).toContain("<last>")
    expect(formatted).toContain("User: Write a Python function to add two numbers with docstrings and type hints.")
    expect(formatted).toContain("Assistant: Here is the implementation in Python:")
    expect(formatted).toContain("</last>")

    // Verbatim code block tag
    expect(formatted).toContain('<code lang="python">\ndef add_numbers(a: int, b: int) -> int:\n    """Adds two numbers and returns the result."""\n    result = a + b\n    return result\n</code>')
    expect(formatted).toContain("</ctx>")

    // Invariant: No USER:/ASSISTANT: dumps, no "---", no generic filler line
    expect(formatted).not.toContain("USER:")
    expect(formatted).not.toContain("ASSISTANT:")
    expect(formatted).not.toContain("---")
    expect(formatted).not.toContain("Continue active engineering task")
    expect(formatted).not.toContain("GOAL:")
    expect(formatted).not.toContain("STATE:")
    expect(formatted).not.toContain("CODE:")
  })

  it("saves assistant reply and verbatim code even when reply is pure code with zero prose (preventing Token ~48 bug)", () => {
    // Exact DOM from investigator report where assistant response has ONLY CodeMirror 6 code and no surrounding <p>
    const pureCodeHtml = `
      <!DOCTYPE html>
      <html>
      <body>
        <main id="_r_ji_">
          <div data-content-search-turn-key="fallback-turn-0">
            <!-- User prompt -->
            <div data-content-search-unit-key="fallback-turn-0:0:user" data-chatgpt-search-unit-key="fallback-turn-0:0:user" data-chatgpt-search-message-ids="msg-user-matrix-0001">
              <div class="bg-user-message text-user-message" data-user-message-bubble="true">
                <div class="text-size-chat whitespace-pre-wrap">Write a Python function to multiply matrices.</div>
              </div>
            </div>

            <!-- Assistant response: Pure code block in CodeMirror 6, no <p> prose -->
            <div data-content-search-unit-key="fallback-turn-0:1:assistant" data-chatgpt-search-unit-key="fallback-turn-0:1:assistant" data-chatgpt-search-message-ids="msg-asst-matrix-0001">
              <div data-markdown-text-style="assistant-message">
                <div class="relative Root-iW7ipz" data-code-block="true" data-markdown-copy="code-block" data-theme="dark">
                  <div class="code-header flex justify-between">
                    <span>Python</span>
                    <button aria-label="Copy code">Copy</button>
                  </div>
                  <div class="min-h-24 w-full" data-editor-search-surface="true">
                    <div class="cm-editor">
                      <div class="cm-scroller chatgpt-code-scrollport">
                        <div class="cm-content" role="textbox" aria-label="Edit code" data-language="python">
                          <div class="cm-line">def multiply_matrices(A: list[list[float]], B: list[list[float]]) -&gt; list[list[float]]:</div>
                          <div class="cm-line">    """Multiplies two compatible matrices A and B."""</div>
                          <div class="cm-line">    rows_A = len(A)</div>
                          <div class="cm-line">    cols_A = len(A[0])</div>
                          <div class="cm-line">    cols_B = len(B[0])</div>
                          <div class="cm-line">    result = [[0.0 for _ in range(cols_B)] for _ in range(rows_A)]</div>
                          <div class="cm-line">    for i in range(rows_A):</div>
                          <div class="cm-line">        for j in range(cols_B):</div>
                          <div class="cm-line">            for k in range(cols_A):</div>
                          <div class="cm-line">                result[i][j] += A[i][k] * B[k][j]</div>
                          <div class="cm-line">    return result</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </body>
      </html>
    `

    const dom = new JSDOM(pureCodeHtml, { url: "https://chatgpt.com/c/matrix-mult-123" })
    const turns = adapter.getMessages(dom.window.document)

    // MUST save both user and assistant turn (NOT drop assistant turn)
    expect(turns.length).toBe(2)
    const assistantTurn = turns[1]
    expect(assistantTurn.role).toBe("assistant")

    // Verbatim code block extracted with 100% fidelity
    expect(assistantTurn.codeBlocks.length).toBe(1)
    const cb = assistantTurn.codeBlocks[0]
    expect(cb.language).toBe("python")
    expect(cb.code).toContain("def multiply_matrices")
    expect(cb.code).toContain("    for i in range(rows_A):")
    expect(cb.code).toContain("        for j in range(cols_B):")
    expect(cb.code).toContain("            for k in range(cols_A):")

    // State memory calculates token estimate including the code (NOT dropped to ~48 tokens)
    const memory = buildLocalStateMemory(turns, assistantTurn.codeBlocks, "Matrix Multiplication", "standard")
    expect(memory.criticalSnippets.length).toBe(1)
    expect(memory.rawTokenEstimate).toBeGreaterThan(100) // Code is substantial, not ~48 tokens!
  })
})
