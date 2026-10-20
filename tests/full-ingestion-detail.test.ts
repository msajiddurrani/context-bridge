import { describe, expect, it } from "vitest"
import type { MessageTurn, StoredContext, VerbatimCodeBlock } from "../src/types"
import { buildLocalStateMemory, formatCompactLastExchanges } from "../src/utils/local-mode"
import { formatStateMemoryPrompt } from "../src/utils/prompt-formatter"
import { buildPreviewInjectedText } from "../src/utils/prompt-preview"

describe("Full Ingestion Detail & Clean Structure (User Request Verification)", () => {
  const multiParagraphAnswer = `Apples are among the world's most popular fruits, and they are loaded with essential nutrients.

Here are the primary health benefits of apples:

1. Highly Nutritious:
Apples are rich in vitamin C, potassium, and vitamin K. One medium apple provides around 4 grams of dietary fiber, helping you reach your daily requirement.

2. Promotes Heart Health:
Apples have been linked to a lower risk of heart disease. One reason is that they contain soluble fiber, which can help lower blood cholesterol levels.

3. Lowers Risk of Diabetes:
Eating apples is linked to a lower risk of type 2 diabetes. The antioxidant polyphenols in apples prevent tissue damage to beta cells in your pancreas.

4. Supports Healthy Weight Loss:
Apples are high in fiber and water, two qualities that make them filling. An increased feeling of fullness leads to reduced calorie intake throughout the day.`

  const turns: MessageTurn[] = [
    {
      id: "u-1",
      role: "user",
      text: "Explain the health benefits of apples in detail.",
      codeBlocks: [],
      timestamp: 1000
    },
    {
      id: "a-1",
      role: "assistant",
      text: multiParagraphAnswer,
      codeBlocks: [],
      timestamp: 2000
    }
  ]

  it("preserves full multi-paragraph assistant answers without 200-character truncation in standard mode", () => {
    const formatted = formatCompactLastExchanges(turns, "standard")

    // Must NOT contain artificial truncation dots
    expect(formatted).not.toContain("...")
    // Must contain every single section and bullet point
    expect(formatted).toContain("1. Highly Nutritious:")
    expect(formatted).toContain("2. Promotes Heart Health:")
    expect(formatted).toContain("3. Lowers Risk of Diabetes:")
    expect(formatted).toContain("4. Supports Healthy Weight Loss:")
    expect(formatted).toContain("beta cells in your pancreas")
    expect(formatted).toContain("reduced calorie intake throughout the day")
  })

  it("preserves clean paragraph breaks and list structure instead of collapsing to single line", () => {
    const formatted = formatCompactLastExchanges(turns, "standard")

    // Paragraph breaks must be present
    expect(formatted).toContain("\n\n")
    // User and Assistant turns are cleanly separated
    expect(formatted).toMatch(/User: Explain the health benefits of apples in detail\.\s*\n\nAssistant:/)
    // Bullet points are preserved on separate lines
    expect(formatted).toMatch(/1\. Highly Nutritious:\s*\nApples are rich in vitamin C/)
  })

  it("builds pure, neat XML handover block containing complete dialogue and goal", () => {
    const memory = buildLocalStateMemory(turns, [], "Apple Benefits", "standard")
    const handoverXml = formatStateMemoryPrompt(memory, "chatgpt", "claude")

    expect(handoverXml).toMatch(/^<ctx from="chatgpt" age="[^"]+">/)
    expect(handoverXml).toContain("<goal>Explain the health benefits of apples in detail</goal>")
    expect(handoverXml).toContain("<last>")
    expect(handoverXml).toContain("4. Supports Healthy Weight Loss:")
    expect(handoverXml).toContain("</last>")
    expect(handoverXml).toMatch(/<\/ctx>$/)
  })

  it("preview helper generates standard fidelity handover with full content", () => {
    const storedCtx: StoredContext = {
      id: "chatgpt:apple-chat-1",
      chatId: "apple-chat-1",
      chatTitle: "Apple Benefits",
      sourcePlatform: "chatgpt",
      sourceUrl: "https://chatgpt.com/c/apple-chat-1",
      stateMemory: buildLocalStateMemory(turns, [], "Apple Benefits"),
      turns,
      rawCodeBlocks: [],
      updatedAt: Date.now()
    }

    const preview = buildPreviewInjectedText(storedCtx, "claude")
    expect(preview).toContain("<goal>Explain the health benefits of apples in detail</goal>")
    expect(preview).toContain("1. Highly Nutritious:")
    expect(preview).toContain("4. Supports Healthy Weight Loss:")
  })
})
