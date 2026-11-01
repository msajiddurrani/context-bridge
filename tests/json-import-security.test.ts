import { describe, expect, it } from "vitest"
import { validateImportedBackup, validateSingleContext } from "../src/utils/import-validator"

describe("Security: JSON Backup Import Validation & Prototype Pollution Defense (Part 5B)", () => {
  it("rejects objects with prototype pollution keys (__proto__, constructor, prototype)", () => {
    const maliciousPayload = JSON.parse(`{
      "__proto__": { "polluted": "yes" },
      "id": "claude:malicious-1",
      "sourcePlatform": "claude",
      "chatId": "malicious-1",
      "chatTitle": "Malicious Payload"
    }`)

    const res = validateSingleContext(maliciousPayload)
    expect(res).toBeNull()

    // Test inside backup container
    const backupPayload = JSON.parse(`{
      "__proto__": { "admin": true },
      "contexts": [
        {
          "id": "claude:valid-1",
          "sourcePlatform": "claude",
          "chatId": "valid-1",
          "chatTitle": "Normal"
        }
      ]
    }`)

    const backupRes = validateImportedBackup(backupPayload)
    expect(backupRes.valid).toBe(false)
    expect(backupRes.error).toContain("prototype pollution")
  })

  it("rejects unauthorized platforms outside [claude, chatgpt, gemini]", () => {
    const badPlatform = {
      id: "attacker:chat-1",
      sourcePlatform: "evil-platform",
      chatId: "chat-1",
      chatTitle: "Bad Platform"
    }

    expect(validateSingleContext(badPlatform)).toBeNull()
  })

  it("rejects empty or whitespace-only IDs and dangerous IDs", () => {
    expect(validateSingleContext({ id: "", sourcePlatform: "claude" })).toBeNull()
    expect(validateSingleContext({ id: "   ", sourcePlatform: "chatgpt" })).toBeNull()
    expect(validateSingleContext({ id: "__proto__", sourcePlatform: "gemini" })).toBeNull()
  })

  it("successfully validates and sanitizes a valid backup array", () => {
    const validArray = [
      {
        id: "claude:chat-valid-100",
        sourcePlatform: "claude",
        chatId: "chat-valid-100",
        chatTitle: "Rust Concurrency",
        createdAt: 1700000000000,
        updatedAt: 1700000001000,
        stateMemory: {
          objective: "Understand Arc and Mutex in Rust",
          techStack: ["Rust"],
          architectureDecisions: ["Use tokio sync primitives"],
          currentWork: "Debugging deadlock",
          blockersAndErrors: [],
          nextSteps: []
        },
        rawCodeBlocks: [
          {
            id: "code-1",
            language: "rust",
            code: "use std::sync::Arc;\nlet val = Arc::new(5);",
            turnIndex: 1
          }
        ],
        turns: [
          {
            id: "turn-1",
            role: "user",
            text: "How does Arc work in Rust?",
            codeBlocks: []
          },
          {
            id: "turn-2",
            role: "assistant",
            text: "Arc stands for Atomically Reference Counted.",
            codeBlocks: [
              {
                id: "code-1",
                language: "rust",
                code: "use std::sync::Arc;\nlet val = Arc::new(5);",
                turnIndex: 1
              }
            ]
          }
        ]
      }
    ]

    const result = validateImportedBackup(validArray)
    expect(result.valid).toBe(true)
    expect(result.contexts.length).toBe(1)

    const ctx = result.contexts[0]
    expect(ctx.id).toBe("claude:chat-valid-100")
    expect(ctx.sourcePlatform).toBe("claude")
    expect(ctx.chatTitle).toBe("Rust Concurrency")
    expect(ctx.rawCodeBlocks.length).toBe(1)
    expect(ctx.turns?.length).toBe(2)
    expect(ctx.isImported).toBe(true)
    expect(ctx.stateMemory.metadata?.imported).toBe(true)
  })

  it("handles empty or non-JSON payloads gracefully without throwing exceptions", () => {
    expect(validateImportedBackup(null).valid).toBe(false)
    expect(validateImportedBackup("string").valid).toBe(false)
    expect(validateImportedBackup(12345).valid).toBe(false)
    expect(validateImportedBackup([]).valid).toBe(false)
    expect(validateImportedBackup({ contexts: [] }).valid).toBe(false)
  })
})

