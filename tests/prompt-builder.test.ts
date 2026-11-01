import { describe, expect, it } from "vitest"
import {
  extractReferencedLinks,
  formatStateMemoryPrompt,
  isInjectedTurn,
  stripInjectedContext
} from "../src/utils/prompt-formatter"
import type { StateMemory } from "../src/types"

describe("Prompt Builder & Plain ASCII Handover Encoding (100% Local-First Canonical Formatter)", () => {
  it("formats neutral StateMemory in <ctx> ASCII block with zero emojis", () => {
    const mockMemory: StateMemory = {
      version: "1.0",
      objective: "Build a caching middleware",
      techStack: ["Node.js", "Redis"],
      architectureDecisions: ["Use Redis string keys with 300s TTL"],
      currentWork: "Refactoring the cache invalidation layer",
      blockersAndErrors: ["Redis connection reset by peer (ECONNRESET)"],
      nextSteps: ["Implement exponential backoff retry handler"],
      criticalSnippets: [
        {
          id: "snippet-1",
          language: "typescript",
          code: "const cacheKey = `user:${userId}`;\nawait redis.set(cacheKey, val, 'EX', 300);",
          turnIndex: 1
        }
      ],
      rawTokenEstimate: 350
    }

    const formatted = formatStateMemoryPrompt(mockMemory, "claude", "chatgpt", "just now")

    expect(formatted).toContain("<ctx")
    expect(formatted).toContain("</ctx>")
    expect(formatted).toContain("<goal>Build a caching middleware</goal>")
    expect(formatted).toContain("<outline>")
    expect(formatted).toContain("Use Redis string keys with 300s TTL")
    expect(formatted).toContain("<last>Refactoring the cache invalidation layer</last>")
    expect(formatted).toContain('<code lang="typescript">')
    expect(formatted).toContain("const cacheKey = `user:${userId}`;")
    expect(formatted).toContain("</code>")
    expect(formatted).toContain("Continue this work. Don't re-summarize. Reply \"Ready\" in one word, then wait for my next message.")

    // Plain ASCII requirement: absolutely no emojis
    const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u
    expect(emojiRegex.test(formatted)).toBe(false)
  })

  it("isInjectedTurn correctly detects <ctx> tags and prefixes", () => {
    expect(isInjectedTurn("<ctx>\nContext Bridge Handover\n</ctx>")).toBe(true)
    expect(isInjectedTurn("<ctx from=\"claude\">\nState\n</ctx>")).toBe(true)
    expect(isInjectedTurn("=== [CONTEXT BRIDGE: HANDOVER FROM CLAUDE TO CHATGPT] ===\nState\n=== [END OF CONTEXT BRIDGE HANDOVER] ===")).toBe(true)
    expect(isInjectedTurn("Just a normal conversation message about React that is quite long and detailed")).toBe(false)
  })

  it("stripInjectedContext strips <ctx> blocks from turns", () => {
    const injected = "<ctx>\nObjective: Work\n</ctx>\nPlease help me continue."
    const stripped = stripInjectedContext(injected)
    expect(stripped).toBe("Please help me continue.")
  })

  it("extractReferencedLinks extracts URLs from text into githubRepos and otherLinks", () => {
    const text = "Check out https://github.com/plasmohq/plasmo and https://developer.chrome.com/docs"
    const links = extractReferencedLinks(text)
    expect(links.githubRepos).toContain("https://github.com/plasmohq/plasmo")
    expect(links.otherLinks).toContain("https://developer.chrome.com/docs")
  })
})
