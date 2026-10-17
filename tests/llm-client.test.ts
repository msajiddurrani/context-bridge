import { beforeEach, describe, expect, it, vi } from "vitest"
import { resetMockStore } from "./setup"
import { callGemini, testLLMConnection } from "../src/utils/llm-client"
import {
  clearLastError,
  getLastError,
  saveLastError,
  getSettings
} from "../src/utils/storage-manager"
import { DEFAULT_GEMINI_MODEL } from "../src/types"

describe("LLM Client & Error Handling (404 Model-Not-Found)", () => {
  beforeEach(() => {
    resetMockStore()
    vi.restoreAllMocks()
  })

  it("verifies DEFAULT_GEMINI_MODEL is set to verified gemini-3.8-flash", () => {
    expect(DEFAULT_GEMINI_MODEL).toBe("gemini-3.8-flash")
  })

  it("migrates legacy gemini-2.5-flash to gemini-3.8-flash in storage settings", async () => {
    const settings = await getSettings()
    expect(settings.geminiModel).toBe("gemini-3.8-flash")
  })

  it("handles 404 model-not-found error, captures exact message, and persists it for popup UI", async () => {
    const notFoundMessage =
      "models/gemini-2.5-flash is no longer available to new users. Please update to models/gemini-3.8-flash."

    // Mock global fetch returning 404 with Google's exact error JSON body
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (url, init) => {
      // Verify header-based auth invariant (x-goog-api-key)
      const headers = (init?.headers || {}) as Record<string, string>
      expect(headers["x-goog-api-key"]).toBe("mock-key-12345")
      expect(String(url)).not.toContain("key=")

      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({
          error: {
            code: 404,
            message: notFoundMessage,
            status: "NOT_FOUND"
          }
        })
      } as unknown as Response
    })

    // 1. Verify callGemini throws with exact 404 status and message
    await expect(
      callGemini("Generate test content", "mock-key-12345", "gemini-2.5-flash")
    ).rejects.toThrow(`Gemini API Error (404): ${notFoundMessage}`)

    // 2. Persist error to storage as done by background service worker
    await saveLastError({
      message: `Gemini API Error (404): ${notFoundMessage}`,
      timestamp: 1729210000000,
      provider: "gemini",
      model: "gemini-2.5-flash"
    })

    // 3. Verify getLastError retrieves the exact error so the popup surfaces it to the user
    const lastError = await getLastError()
    expect(lastError).not.toBeNull()
    expect(lastError?.message).toBe(`Gemini API Error (404): ${notFoundMessage}`)
    expect(lastError?.provider).toBe("gemini")
    expect(lastError?.model).toBe("gemini-2.5-flash")

    // 4. Verify clearing the error resets state
    await clearLastError()
    expect(await getLastError()).toBeNull()
  })

  it("handles testLLMConnection success on verified model", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (url, init) => {
      const headers = (init?.headers || {}) as Record<string, string>
      expect(headers["x-goog-api-key"]).toBe("valid-key-xyz")
      expect(String(url)).toContain("gemini-3.8-flash")

      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: '{"status": "ok"}' }]
              }
            }
          ]
        })
      } as unknown as Response
    })

    const result = await testLLMConnection("gemini", "valid-key-xyz", "gemini-3.8-flash")
    expect(result.success).toBe(true)
    expect(result.message).toContain("Connected successfully to gemini-3.8-flash")
  })
})
