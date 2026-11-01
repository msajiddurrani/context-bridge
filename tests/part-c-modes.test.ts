import { describe, expect, it, beforeEach } from "vitest"
import { generateThreadOutline, formatOutlineBlock } from "../src/utils/outline"
import { buildInjectedPrompt, buildPreviewInjectedText } from "../src/utils/prompt-preview"
import {
  formatMarkdownHandoverExport
} from "../src/utils/prompt-formatter"
import { clearAllData, saveSettings, getSettings } from "../src/utils/storage-manager"
import type { MessageTurn, StoredContext, InjectionMode } from "../src/types"

describe("Part C: Outline, Custom Styles & Injection Modes", () => {
  beforeEach(async () => {
    await clearAllData()
  })

  const sampleTurns: MessageTurn[] = [
    {
      id: "chat-1:user:hash1:0",
      role: "user",
      text: "We need to design a microservice architecture for payment processing. What database should we choose?",
      codeBlocks: []
    },
    {
      id: "chat-1:assistant:hash2:1",
      role: "assistant",
      text: "For payments, ACID compliance is paramount.\nKey Decisions:\n- Use PostgreSQL for transactional integrity\n- Implement Stripe API for payment gateway\n- Use Redis for idempotency key storage and distributed locks\n\nHow do we want to handle webhook retry queues?",
      codeBlocks: [
        {
          id: "cb-1",
          language: "sql",
          code: "CREATE TABLE payments (id UUID PRIMARY KEY, amount DECIMAL, status VARCHAR(32));",
          turnIndex: 1
        }
      ]
    },
    {
      id: "chat-1:user:hash3:2",
      role: "user",
      text: "Let's use RabbitMQ for webhook retry queues. Show me the Redis lock implementation in TypeScript.",
      codeBlocks: []
    },
    {
      id: "chat-1:assistant:hash4:3",
      role: "assistant",
      text: "Here is the distributed lock with Redis:\nWe decided to use ioredis with a 5000ms TTL.\n\nOpen Questions:\n- Should we implement redlock for multi-node Redis clusters?\n- What is the max retry count for RabbitMQ DLQ?",
      codeBlocks: [
        {
          id: "cb-2",
          language: "typescript",
          code: "async function acquireLock(key: string, ttlMs: number): Promise<boolean> {\n  const res = await redis.set(key, 'locked', 'PX', ttlMs, 'NX');\n  return res === 'OK';\n}",
          turnIndex: 3
        }
      ]
    },
    {
      id: "chat-1:user:hash5:4",
      role: "user",
      text: "Yes, 5 retries for DLQ. Now let's integrate with the payment service.",
      codeBlocks: []
    },
    {
      id: "chat-1:assistant:hash6:5",
      role: "assistant",
      text: "Payment service integration complete with RabbitMQ listener.\n\nNext step: Implement refund handling endpoints.",
      codeBlocks: [
        {
          id: "cb-3",
          language: "typescript",
          code: "export class PaymentConsumer {\n  async handleMessage(msg: PaymentMsg) {\n    await processPayment(msg);\n  }\n}",
          turnIndex: 5
        }
      ]
    }
  ]

  const mockContext: StoredContext = {
    id: "chatgpt:chat-microservices-1",
    sourcePlatform: "chatgpt",
    chatId: "chat-microservices-1",
    chatTitle: "Payment microservice architecture",
    sourceUrl: "https://chatgpt.com/c/chat-microservices-1",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    expiresAt: 1700000000000 + 24 * 60 * 60 * 1000,
    stateMemory: {
      version: "1.0",
      objective: "We need to design a microservice architecture for payment processing",
      techStack: ["PostgreSQL", "Stripe", "Redis", "TypeScript", "RabbitMQ"],
      architectureDecisions: [
        "Use PostgreSQL for transactional integrity",
        "Implement Stripe API for payment gateway",
        "Use Redis for idempotency key storage"
      ],
      currentWork: "Payment service integration complete with RabbitMQ listener",
      blockersAndErrors: [],
      nextSteps: ["Implement refund handling endpoints"],
      criticalSnippets: [
        {
          id: "cb-2",
          language: "typescript",
          code: "async function acquireLock(key: string, ttlMs: number): Promise<boolean> {\n  const res = await redis.set(key, 'locked', 'PX', ttlMs, 'NX');\n  return res === 'OK';\n}",
          turnIndex: 3
        }
      ],
      rawTokenEstimate: 1200
    },
    rawCodeBlocks: [
      {
        id: "cb-1",
        language: "sql",
        code: "CREATE TABLE payments (id UUID PRIMARY KEY, amount DECIMAL, status VARCHAR(32));",
        turnIndex: 1
      },
      {
        id: "cb-2",
        language: "typescript",
        code: "async function acquireLock(key: string, ttlMs: number): Promise<boolean> {\n  const res = await redis.set(key, 'locked', 'PX', ttlMs, 'NX');\n  return res === 'OK';\n}",
        turnIndex: 3
      },
      {
        id: "cb-3",
        language: "typescript",
        code: "export class PaymentConsumer {\n  async handleMessage(msg: PaymentMsg) {\n    await processPayment(msg);\n  }\n}",
        turnIndex: 5
      }
    ],
    turns: sampleTurns
  }

  // Specification 2: Outline Generator
  it("extracts summary, key decisions, and open questions accurately from turns fixture", () => {
    const outline = generateThreadOutline(sampleTurns, mockContext.stateMemory.objective)

    expect(outline.summary).toBeTruthy()
    expect(outline.summary.length).toBeGreaterThan(10)

    // Key decisions extracted
    expect(outline.decisions.length).toBeGreaterThan(0)
    const decisionsText = outline.decisions.join(" ")
    expect(decisionsText.toLowerCase()).toMatch(/postgresql|stripe|redis|rabbitmq/i)

    // Open questions extracted
    expect(outline.openQuestions.length).toBeGreaterThan(0)
    const questionsText = outline.openQuestions.join(" ")
    expect(questionsText.toLowerCase()).toMatch(/retry|webhook|refund|redlock|\?/i)

    // Formatting block
    const block = formatOutlineBlock(outline)
    expect(block).toContain("<outline>")
    expect(block).toContain("</outline>")
    expect(block).toContain("Summary:")
    expect(block).toContain("Key Decisions:")
  })

  // Specification 1: Formatter produces distinct outputs for Compact, Standard, Smart, and Complete
  it("produces valid, distinct byte outputs across Compact, Standard, Smart, and Complete modes", () => {
    const compactOutput = buildInjectedPrompt(mockContext, "claude", "compact")
    const standardOutput = buildInjectedPrompt(mockContext, "claude", "standard")
    const smartOutput = buildInjectedPrompt(mockContext, "claude", "smart")
    const completeOutput = buildInjectedPrompt(mockContext, "claude", "complete")

    // All must be valid non-empty prompt strings
    expect(compactOutput).toContain("<ctx from=\"chatgpt\"")
    expect(standardOutput).toContain("<ctx from=\"chatgpt\"")
    expect(smartOutput).toContain("<ctx from=\"chatgpt\"")
    expect(completeOutput).toContain("<ctx from=\"chatgpt\"")

    // Must include <goal>, <style>, <outline>, and <resume>
    for (const out of [compactOutput, standardOutput, smartOutput, completeOutput]) {
      expect(out).toContain("<goal>")
      expect(out).toContain("</goal>")
      expect(out).toContain("<outline>")
      expect(out).toContain("</outline>")
      expect(out).toContain("<resume>")
      expect(out).toContain("</resume>")
      expect(out).toContain("</ctx>")
    }

    // Must be distinct from each other
    expect(compactOutput).not.toEqual(standardOutput)
    expect(standardOutput).not.toEqual(smartOutput)
    expect(smartOutput).not.toEqual(completeOutput)
    expect(compactOutput).not.toEqual(completeOutput)

    // Compact is concise (last 2 exchanges)
    expect(compactOutput.length).toBeLessThan(completeOutput.length)

    // Complete mode contains all turns from the thread
    expect(completeOutput).toContain("CREATE TABLE payments")
    expect(completeOutput).toContain("PaymentConsumer")

    // Smart mode prioritizes code blocks across the thread
    expect(smartOutput).toContain("acquireLock")
  })

  // Specification 3: Download Mode Export
  it("formats complete markdown handover file with proper headers and metadata for download", () => {
    const mdExport = formatMarkdownHandoverExport(mockContext, "Payment service integration complete")

    expect(mdExport).toContain("# Context Bridge: Session Handover")
    expect(mdExport).toContain("**Source Platform:** ChatGPT")
    expect(mdExport).toContain("## Conversation Objective")
    expect(mdExport).toContain("## Thread Outline")
    expect(mdExport).toContain("## Code Artifacts")
    expect(mdExport).toContain("CREATE TABLE payments")
    expect(mdExport).toContain("acquireLock")
    expect(mdExport).toContain("## Next Action Directives")
    expect(mdExport).toContain("=== [END OF CONTEXT BRIDGE HANDOVER] ===")
  })

  // Specification 4: Preview matches Actual Injection Byte-for-Byte
  it("guarantees buildPreviewInjectedText matches buildInjectedPrompt byte-for-byte across all modes", () => {
    const modes: InjectionMode[] = ["compact", "standard", "smart", "complete"]

    for (const mode of modes) {
      const actual = buildInjectedPrompt(mockContext, "claude", mode)
      const preview = buildPreviewInjectedText(mockContext, "claude", mode)
      expect(preview).toBe(actual)
    }
  })

  // Custom Style & Resume directives
  it("applies custom style and resume directives into prompt template", () => {
    const customStyle = "Senior Architect Tone: Ultra-concise, benchmark-driven, code only."
    const customResume = "Review the Redis lock above, then implement token revocation API."

    const output = buildInjectedPrompt(
      mockContext,
      "claude",
      "standard",
      "markdown",
      { customStyle, customResume }
    )

    expect(output).toContain(`<style>${customStyle}</style>`)
    expect(output).toContain(`<resume>${customResume}</resume>`)
  })

  // After Inject Behavior Settings
  it("persists afterInjectAction setting correctly (focus, keep, minimize)", async () => {
    await saveSettings({ afterInjectAction: "minimize" })
    let s = await getSettings()
    expect(s.afterInjectAction).toBe("minimize")

    await saveSettings({ afterInjectAction: "keep" })
    s = await getSettings()
    expect(s.afterInjectAction).toBe("keep")

    await saveSettings({ afterInjectAction: "focus" })
    s = await getSettings()
    expect(s.afterInjectAction).toBe("focus")
  })
})
