import { describe, expect, it } from "vitest"
import { JSDOM } from "jsdom"
import type { MessageTurn, StoredContext } from "../src/types"
import { buildLocalStateMemory, extractSharedLinks, formatCardSubtitle, generateCleanSummary } from "../src/utils/local-mode"
import { formatStateMemoryPrompt } from "../src/utils/prompt-formatter"
import { buildPreviewInjectedText } from "../src/utils/prompt-preview"
import { ClaudeAdapter } from "../src/adapters/claude"

describe("Long Conversation Ingestion, Smart/Full Detail Preservation & Goal Display", () => {
  // Generate a realistic 16-prompt conversation (16 user prompts, 16 assistant replies = 32 turns)
  const generate16PromptChat = (): MessageTurn[] => {
    const turns: MessageTurn[] = []
    for (let i = 1; i <= 16; i++) {
      turns.push({
        id: `msg-u-${i}`,
        role: "user",
        text: `Prompt ${i}: Please solve technical problem number ${i} with complete mathematical rigor.`,
        codeBlocks: []
      })
      turns.push({
        id: `msg-a-${i}`,
        role: "assistant",
        text: `Answer ${i}: Here is the complete derivation and explanation for problem ${i}. All intermediate steps are verified.`,
        codeBlocks: [
          {
            id: `code-${i}`,
            language: "typescript",
            code: `function solveProblem${i}(): number { return ${i} * 42; }`,
            turnIndex: (i - 1) * 2 + 1
          }
        ]
      })
    }
    return turns
  }

  it("retains all 16 user prompts AND all 16 assistant responses in smart mode without truncation down to 5-6 prompts", () => {
    const turns = generate16PromptChat()
    expect(turns).toHaveLength(32)

    const rawCodeBlocks = turns.flatMap((t) => t.codeBlocks || [])
    const storedCtx: StoredContext = {
      id: "claude:chat-long-16",
      chatId: "chat-long-16",
      chatTitle: "Advanced Technical Derivations",
      sourcePlatform: "claude",
      sourceUrl: "https://claude.ai/chat/chat-long-16",
      stateMemory: buildLocalStateMemory(turns, rawCodeBlocks, "Advanced Technical Derivations"),
      turns,
      rawCodeBlocks,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: Date.now() + 86400000
    }

    const smartPrompt = buildPreviewInjectedText(storedCtx, "chatgpt", "smart", "markdown")

    // Must contain Prompt 1 all the way to Prompt 16
    expect(smartPrompt).toContain("Prompt 1: Please solve technical problem number 1")
    expect(smartPrompt).toContain("Prompt 8: Please solve technical problem number 8")
    expect(smartPrompt).toContain("Prompt 16: Please solve technical problem number 16")

    // CRITICAL: Intermediate assistant answers must NOT be dropped!
    expect(smartPrompt).toContain("Answer 1: Here is the complete derivation")
    expect(smartPrompt).toContain("Answer 8: Here is the complete derivation")
    expect(smartPrompt).toContain("Answer 16: Here is the complete derivation")
  })

  it("finds the chat container inside main when elements have overflow-y", () => {
    const dom = new JSDOM(`
      <!DOCTYPE html>
      <html>
        <body>
          <main style="overflow: visible; height: 800px;">
            <div id="real-scroller" class="overflow-y-auto" style="overflow-y: auto; height: 500px;">
              <div data-testid="user-message">User question</div>
              <div data-message-author-slug="claude">Claude answer</div>
            </div>
          </main>
        </body>
      </html>
    `, { url: "https://claude.ai/chat/test-scroll-123" })

    const adapter = new ClaudeAdapter()
    const container = adapter.getChatContainer(dom.window.document)

    expect(container?.id).toBe("real-scroller")
  })

  it("formats clean 1-line subtitle avoiding duplicate titles, avoiding dummy text, and extracting active demand", () => {
    const multiTurnUserChat: MessageTurn[] = [
      {
        id: "msg-1",
        role: "user",
        text: "hey so check that if the PR 18 claims are and everything is working",
        codeBlocks: []
      },
      {
        id: "msg-2",
        role: "assistant",
        text: "PR 18 has been thoroughly inspected and verified.",
        codeBlocks: []
      },
      {
        id: "msg-3",
        role: "user",
        text: "ye jab complete hojaye to isko verify karny ky liye kiya karna hoga",
        codeBlocks: []
      }
    ]

    const ctx = {
      chatTitle: "hey so check that if the PR 18 claims are and everything is working",
      stateMemory: { objective: "hey so check that if the PR 18 claims are and everything is working" },
      turns: multiTurnUserChat,
      rawCodeBlocks: []
    }

    const subtitle = formatCardSubtitle(ctx)

    // Subtitle must NOT repeat the chatTitle verbatim
    expect(subtitle).not.toBe(ctx.chatTitle)
    // Subtitle must NOT contain dummy filler text like 'Conversation transcript'
    expect(subtitle).not.toBe("Conversation transcript")
    expect(subtitle).not.toBe("Chat conversation captured locally.")
    // Subtitle must extract the user's active query at the end
    expect(subtitle).toContain("ye jab complete hojaye to isko verify")
    // Subtitle must be strictly 1 single line
    expect(subtitle).not.toContain("\n")
  })

  it("generates a clear, to-the-point summary with 2-4 concise bullets and zero raw essay or 'User:/Assistant:' dumps", () => {
    const rawEssayTurnText = `Nuclear Physics: A Complete Beginner-Friendly Explanation Nuclear physics is the branch of physics that studies the nucleus of an atom—the tiny, dense center that contains most of an atom's mass. It helps us understand how atoms are held together, how radioactive materials behave, how stars produce energy, and how nuclear power plants generate electricity. 1. First, understand the atom [image] montrealsciencecentre.com Everything around us—air, water, metals, and even our bodies—is made of atoms. An atom has three main subatomic particles: + Proton Has a positive electric charge and is located in the nucleus. 0 Neutron Has no electric charge and is located in the nucleus. - Electron Has a negative electric charge and occupies the region outside the nucleus. 2. Next, the strong nuclear force binds protons and neutrons together despite electrical repulsion. 3. Finally, mass defect explains how nuclear fission and fusion release immense energy.`

    const ctx: StoredContext = {
      id: "chatgpt:nuclear-1",
      chatId: "nuclear-1",
      chatTitle: "Explain Nuclear Physics",
      sourcePlatform: "chatgpt",
      sourceUrl: "https://chatgpt.com/c/nuclear-1",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: Date.now() + 86400000,
      stateMemory: buildLocalStateMemory([], [], "Explain Nuclear Physics"),
      turns: [
        {
          id: "t1",
          role: "user",
          text: "explain nuclear physics",
          codeBlocks: []
        },
        {
          id: "t2",
          role: "assistant",
          text: rawEssayTurnText,
          codeBlocks: []
        }
      ],
      rawCodeBlocks: []
    }

    const summary = generateCleanSummary(ctx)

    // Must have a clean topic
    expect(summary.topic).toBe("Explain Nuclear Physics")
    // Must NOT be an essay: strictly between 1 and 4 points
    expect(summary.highlights.length).toBeGreaterThanOrEqual(1)
    expect(summary.highlights.length).toBeLessThanOrEqual(4)

    for (const point of summary.highlights) {
      // Must NOT contain raw role prefixes
      expect(point).not.toMatch(/^User:/i)
      expect(point).not.toMatch(/^Assistant:/i)
      // Must NOT contain raw web images or URLs
      expect(point).not.toContain("[image]")
      expect(point).not.toContain("montrealsciencecentre.com")
      // Must be concise, not an essay
      expect(point.length).toBeLessThanOrEqual(160)
    }
  })

  it("extracts and deduplicates shared links from conversation turns with clean domains and titles", () => {
    const turns: MessageTurn[] = [
      {
        id: "t1",
        role: "user",
        text: "Please check this documentation https://react.dev/reference/react and also [Montreal Science](https://www.montrealsciencecentre.com/exhibition).",
        codeBlocks: []
      },
      {
        id: "t2",
        role: "assistant",
        text: "You can also check the official repository at https://github.com/facebook/react or revisit https://react.dev/reference/react.",
        codeBlocks: []
      }
    ]

    const links = extractSharedLinks(turns)

    // Must find all 3 unique links (react.dev, montrealsciencecentre.com, github.com)
    expect(links).toHaveLength(3)

    // 1st link: react.dev
    const reactLink = links.find((l) => l.url.includes("react.dev"))
    expect(reactLink).toBeDefined()
    expect(reactLink?.domain).toBe("react.dev")

    // 2nd link: montreal science centre (extracted markdown title)
    const montrealLink = links.find((l) => l.url.includes("montrealsciencecentre.com"))
    expect(montrealLink).toBeDefined()
    expect(montrealLink?.title).toBe("Montreal Science")
    expect(montrealLink?.domain).toBe("montrealsciencecentre.com")

    // 3rd link: github.com
    const githubLink = links.find((l) => l.url.includes("github.com"))
    expect(githubLink).toBeDefined()
    expect(githubLink?.domain).toBe("github.com")

    // Must return empty array if no links are present
    expect(extractSharedLinks([])).toEqual([])
    expect(extractSharedLinks([{ id: "t3", role: "user", text: "No links here", codeBlocks: [] }])).toEqual([])
  })
})
