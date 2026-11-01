import { describe, expect, it } from "vitest"
import type { MessageTurn, StateMemory, VerbatimCodeBlock } from "../src/types"
import {
  buildLocalStateMemory,
  computeContentHash,
  countExchanges,
  extractGoal,
  extractLastExchanges,
  isRateLimitEncountered,
  prepareAiTranscript
} from "../src/utils/local-mode"
import { formatStateMemoryPrompt } from "../src/utils/prompt-formatter"

describe("Stage 2: Local Mode & Offline Synthesis", () => {
  const sampleCodeBlock: VerbatimCodeBlock = {
    id: "code-1",
    language: "typescript",
    code: "function add(a: number, b: number): number {\n  return a + b;\n}",
    turnIndex: 1
  }

  const sampleTurns: MessageTurn[] = [
    {
      id: "turn-1",
      role: "user",
      text: "We need to design a distributed rate limiter for our API Gateway using Redis token bucket algorithm.",
      codeBlocks: [],
      timestamp: 1000
    },
    {
      id: "turn-2",
      role: "assistant",
      text: "We can implement the token bucket algorithm using Redis EVAL with a Lua script to ensure atomicity.",
      codeBlocks: [sampleCodeBlock],
      timestamp: 2000
    },
    {
      id: "turn-3",
      role: "user",
      text: "How do we handle clock drift between cluster nodes?",
      codeBlocks: [],
      timestamp: 3000
    },
    {
      id: "turn-4",
      role: "assistant",
      text: "Use Redis server time (TIME command) rather than relying on application server local clocks.",
      codeBlocks: [],
      timestamp: 4000
    }
  ]

  describe("1. Local StateMemory Construction (Zero External API)", () => {
    it("synthesizes valid StateMemory completely offline", () => {
      const memory = buildLocalStateMemory(sampleTurns, [sampleCodeBlock])

      expect(memory.version).toBe("1.0")
      expect(memory.objective).toContain("We need to design a distributed rate limiter for our API Gateway")
      expect(memory.techStack).toBeDefined()
      expect(memory.architectureDecisions).toBeDefined()
      expect(memory.currentWork).toBeDefined()
      expect(memory.criticalSnippets.length).toBe(1)
      expect(memory.criticalSnippets[0].code).toBe(sampleCodeBlock.code)
    })

    it("extractGoal isolates the first non-trivial user message", () => {
      const turns: MessageTurn[] = [
        { id: "1", role: "assistant", text: "Hello! How can I help you today?", codeBlocks: [] },
        {
          id: "2",
          role: "user",
          text: "I am building a web scraper in Python using Playwright and need to bypass Cloudflare turnstile.",
          codeBlocks: []
        }
      ]

      const goal = extractGoal(turns)
      expect(goal).toContain("building a web scraper in Python using Playwright")
    })

    it("extractLastExchanges isolates the last dialogue turns compactly", () => {
      const exchanges = extractLastExchanges(sampleTurns, 2)
      expect(exchanges.length).toBe(4)
      expect(exchanges[2].text).toContain("How do we handle clock drift between cluster nodes?")
      expect(exchanges[3].text).toContain("Use Redis server time (TIME command)")
    })

    it("countExchanges computes the number of complete user-assistant dialogue pairs", () => {
      expect(countExchanges(sampleTurns)).toBe(2)
    })

    it("computeContentHash produces deterministic content hashes for change detection", () => {
      const hash1 = computeContentHash(sampleTurns)
      const hash2 = computeContentHash(sampleTurns)
      expect(hash1).toBe(hash2)
      expect(typeof hash1).toBe("string")
      expect(hash1.length).toBeGreaterThan(0)
    })
  })

  describe("2. Rate-Limit Notification Detection", () => {
    it("detects various platform rate-limit and message cap phrases", () => {
      expect(isRateLimitEncountered("You've reached your usage limit. Try again in 2 hours.")).toBe(true)
      expect(isRateLimitEncountered("Rate limit exceeded for GPT-4o. You can send more messages after 4:00 PM.")).toBe(true)
      expect(isRateLimitEncountered("Message limit reached. Please wait.")).toBe(true)
      expect(isRateLimitEncountered("Hourly message cap reached.")).toBe(true)
      expect(isRateLimitEncountered("Too many requests from this IP.")).toBe(true)
    })
  })

  describe("3. Plain ASCII Handover Ingestion", () => {
    it("produces standard ASCII handover prompt without lossy paraphrasing", () => {
      const memory = buildLocalStateMemory(sampleTurns, [sampleCodeBlock])
      const prompt = formatStateMemoryPrompt(memory, "claude", "chatgpt", "just now")

      expect(prompt).toContain("<ctx")
      expect(prompt).toContain("</ctx>")
      expect(prompt).toContain(sampleCodeBlock.code)
    })
  })
})
