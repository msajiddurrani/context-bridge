import { beforeEach, describe, expect, it } from "vitest"
import { handleAutoSave } from "../src/background"
import { getStoredContexts } from "../src/utils/storage-manager"
import { resetMockStore } from "./setup"

describe("Security Audit: Complete Credential Redaction Across All Storage Representations", () => {
  beforeEach(() => {
    resetMockStore()
  })

  it("redacts sensitive credentials across rawCodeBlocks, stateMemory.criticalSnippets, turns, and transcripts", async () => {
    const rawApiKey = "sk-proj-1234567890abcdef1234567890abcdef12345678"
    const googleKey = "AIzaSyD9jK2l9m4n8p7q6r5s4t3u2v1w0x9y8z7"
    const jwtSecret = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"

    const saveResult = await handleAutoSave({
      sourcePlatform: "chatgpt",
      chatId: "secure-chat-9999",
      sourceUrl: "https://chatgpt.com/c/secure-chat-9999",
      chatTitle: `API Key Integration Discussion with ${rawApiKey}`,
      rawTranscript: `User: Here is my key ${rawApiKey}\nAssistant: Stored.`,
      rawCodeBlocks: [
        {
          id: "cb-sec-0",
          language: "typescript",
          code: `const clientSecret = "${rawApiKey}";\nconst gKey = "${googleKey}";\nconst token = "${jwtSecret}";`,
          turnIndex: 0
        }
      ],
      turns: [
        {
          id: "turn-sec-1",
          role: "user",
          text: `Please initialize the client using ${rawApiKey} and ${googleKey}`,
          codeBlocks: [
            {
              id: "cb-sec-1",
              language: "typescript",
              code: `const clientSecret = "${rawApiKey}";`,
              turnIndex: 0
            }
          ]
        },
        {
          id: "turn-sec-2",
          role: "assistant",
          text: "Credentials received and configured.",
          codeBlocks: []
        }
      ]
    })

    expect(saveResult.success).toBe(true)

    const storedContexts = await getStoredContexts()
    expect(storedContexts.length).toBe(1)
    const stored = storedContexts[0]

    // 1. Check rawCodeBlocks
    expect(stored.rawCodeBlocks?.length).toBeGreaterThan(0)
    for (const cb of stored.rawCodeBlocks || []) {
      expect(cb.code).not.toContain(rawApiKey)
      expect(cb.code).not.toContain(googleKey)
      expect(cb.code).not.toContain("eyJhbGciOiJIUzI1Ni")
      expect(cb.code).toContain("[REDACTED_OPENAI_KEY]")
      expect(cb.code).toContain("[REDACTED_GOOGLE_KEY]")
      expect(cb.code).toContain("[REDACTED_JWT_TOKEN]")
    }

    // 2. Check stateMemory.criticalSnippets
    expect(stored.stateMemory?.criticalSnippets?.length).toBeGreaterThan(0)
    for (const snippet of stored.stateMemory?.criticalSnippets || []) {
      expect(snippet.code).not.toContain(rawApiKey)
      expect(snippet.code).not.toContain(googleKey)
      expect(snippet.code).not.toContain("eyJhbGciOiJIUzI1Ni")
      expect(snippet.code).toContain("[REDACTED_OPENAI_KEY]")
    }

    // 3. Check chatTitle
    expect(stored.chatTitle).not.toContain(rawApiKey)
    expect(stored.chatTitle).toContain("[REDACTED_OPENAI_KEY]")

    // 4. Check turns text & codeBlocks
    for (const turn of stored.turns || []) {
      expect(turn.text).not.toContain(rawApiKey)
      expect(turn.text).not.toContain(googleKey)
      for (const cb of turn.codeBlocks || []) {
        expect(cb.code).not.toContain(rawApiKey)
        expect(cb.code).toContain("[REDACTED_OPENAI_KEY]")
      }
    }

    // 5. Check rawTranscript
    expect(stored.rawTranscript).not.toContain(rawApiKey)
    expect(stored.rawTranscript).not.toContain(googleKey)
  })

  it("ensures subsequent incremental auto-saves continue to scrub newly arrived code blocks in existing chats", async () => {
    const initialKey = "sk-proj-initial1234567890abcdef1234567890abcdef1234"
    const secondKey = "sk-proj-second1234567890abcdef1234567890abcdef1234"

    // First save
    await handleAutoSave({
      sourcePlatform: "claude",
      chatId: "claude-sec-1",
      sourceUrl: "https://claude.ai/chat/claude-sec-1",
      chatTitle: "Initial Chat",
      rawTranscript: "Initial transcript",
      rawCodeBlocks: [
        { id: "cb-1", language: "python", code: `KEY_1 = "${initialKey}"`, turnIndex: 0 }
      ],
      turns: [
        { id: "msg-1", role: "user", text: "Hello", codeBlocks: [] },
        { id: "msg-2", role: "assistant", text: "Hi", codeBlocks: [] }
      ]
    })

    // Second incremental save with new turns and new code block
    await handleAutoSave({
      sourcePlatform: "claude",
      chatId: "claude-sec-1",
      sourceUrl: "https://claude.ai/chat/claude-sec-1",
      chatTitle: "Initial Chat",
      rawTranscript: "Updated transcript",
      rawCodeBlocks: [
        { id: "cb-1", language: "python", code: `KEY_1 = "${initialKey}"`, turnIndex: 0 },
        { id: "cb-2", language: "python", code: `KEY_2 = "${secondKey}"`, turnIndex: 2 }
      ],
      turns: [
        { id: "msg-1", role: "user", text: "Hello", codeBlocks: [] },
        { id: "msg-2", role: "assistant", text: "Hi", codeBlocks: [] },
        { id: "msg-3", role: "user", text: "Adding new snippet", codeBlocks: [] },
        { id: "msg-4", role: "assistant", text: "Done", codeBlocks: [] }
      ]
    })

    const contexts = await getStoredContexts()
    expect(contexts.length).toBe(1)
    const ctx = contexts[0]

    for (const cb of ctx.rawCodeBlocks || []) {
      expect(cb.code).not.toContain(initialKey)
      expect(cb.code).not.toContain(secondKey)
      expect(cb.code).toContain("[REDACTED_OPENAI_KEY]")
    }

    for (const snippet of ctx.stateMemory?.criticalSnippets || []) {
      expect(snippet.code).not.toContain(initialKey)
      expect(snippet.code).not.toContain(secondKey)
    }
  })
})
