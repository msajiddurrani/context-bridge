import { beforeEach, describe, expect, it, vi } from "vitest"
import { resetMockStore } from "./setup"
import {
  DEFAULT_OPENROUTER_FALLBACK_MODELS,
  fetchOpenRouterModels,
  filterAndFormatOpenRouterModels,
  MAX_PROMPT_PRICE_PER_TOKEN
} from "../src/utils/openrouter-models"
import { callOpenRouter, testLLMConnection } from "../src/utils/llm-client"
import { deleteApiKeys, getSettings, saveSettings } from "../src/utils/storage-manager"
import { DEFAULT_OPENROUTER_MODEL } from "../src/types"

describe("OpenRouter Provider & Model Management Suite", () => {
  beforeEach(() => {
    resetMockStore()
    vi.restoreAllMocks()
  })

  describe("Model Filtering, Identification & Prioritization", () => {
    it("correctly flags free models and puts them first", () => {
      const rawSample = [
        {
          id: "openai/gpt-4o-mini",
          name: "OpenAI: GPT-4o Mini",
          pricing: { prompt: "0.00000015", completion: "0.00000060" },
          context_length: 128000
        },
        {
          id: "meta-llama/llama-3.3-70b-instruct:free",
          name: "Meta: Llama 3.3 70B Instruct (free)",
          pricing: { prompt: "0", completion: "0" },
          context_length: 131072
        },
        {
          id: "deepseek/deepseek-r1:free",
          name: "DeepSeek: DeepSeek R1 (free)",
          pricing: { prompt: "0", completion: "0" },
          context_length: 65536
        }
      ]

      const formatted = filterAndFormatOpenRouterModels(rawSample)

      expect(formatted).toHaveLength(3)
      // Free models sorted to the top
      expect(formatted[0].isFree).toBe(true)
      expect(formatted[1].isFree).toBe(true)
      expect(formatted[2].isFree).toBe(false)
      expect(formatted[0].id).toBe("meta-llama/llama-3.3-70b-instruct:free")
      expect(formatted[2].id).toBe("openai/gpt-4o-mini")
      expect(formatted[2].promptPricePerM).toBe(0.15)
    })

    it("filters out expensive frontier models (> $10/1M tokens) unless free", () => {
      const rawSample = [
        {
          id: "cheap/model",
          name: "Cheap Model",
          pricing: { prompt: "0.00000050", completion: "0.000001" } // $0.50 / 1M
        },
        {
          id: "expensive/frontier-opus",
          name: "Frontier Expensive Opus",
          pricing: { prompt: "0.000015", completion: "0.000075" } // $15 / 1M (> $10 threshold)
        },
        {
          id: "expensive/super-gpt-4",
          name: "Super Expensive GPT-4",
          pricing: { prompt: "0.000030", completion: "0.000060" } // $30 / 1M
        }
      ]

      const formatted = filterAndFormatOpenRouterModels(rawSample)

      expect(formatted).toHaveLength(1)
      expect(formatted[0].id).toBe("cheap/model")
    })

    it("filters out blacklisted fable, astron, and pure non-text models", () => {
      const rawSample = [
        {
          id: "fable/character-generator",
          name: "Fable Avatar Creator",
          pricing: { prompt: "0.000001", completion: "0.000002" }
        },
        {
          id: "astron/astron-3d-model",
          name: "Astron 3D Studio",
          pricing: { prompt: "0.000001", completion: "0.000002" }
        },
        {
          id: "audio/pure-voice-generator",
          name: "Voice Model",
          architecture: { input_modalities: ["audio"] },
          pricing: { prompt: "0.000001", completion: "0.000002" }
        },
        {
          id: "deepseek/deepseek-chat:free",
          name: "DeepSeek V3",
          architecture: { input_modalities: ["text"] },
          pricing: { prompt: "0", completion: "0" }
        }
      ]

      const formatted = filterAndFormatOpenRouterModels(rawSample)

      expect(formatted).toHaveLength(1)
      expect(formatted[0].id).toBe("deepseek/deepseek-chat:free")
    })

    it("returns default fallback models when raw data is invalid or empty", () => {
      expect(filterAndFormatOpenRouterModels(null as any)).toEqual(DEFAULT_OPENROUTER_FALLBACK_MODELS)
      expect(filterAndFormatOpenRouterModels([] as any)).toEqual(DEFAULT_OPENROUTER_FALLBACK_MODELS)
    })
  })

  describe("Live Fetch and Storage Caching", () => {
    it("fetches live models from openrouter.ai and caches them", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (url) => {
        expect(String(url)).toBe("https://openrouter.ai/api/v1/models")
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              {
                id: "meta-llama/llama-3.3-70b-instruct:free",
                name: "Meta: Llama 3.3 70B Instruct (free)",
                pricing: { prompt: "0", completion: "0" }
              },
              {
                id: "new-vendor/brand-new-2026-model:free",
                name: "Brand New 2026 Model",
                pricing: { prompt: "0", completion: "0" }
              }
            ]
          })
        } as unknown as Response
      })

      const models = await fetchOpenRouterModels(true)
      expect(models.length).toBeGreaterThanOrEqual(2)
      expect(models.some((m) => m.id === "new-vendor/brand-new-2026-model:free")).toBe(true)
    })

    it("falls back to default models if fetch throws network error", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network offline"))

      const models = await fetchOpenRouterModels(true)
      expect(models).toEqual(DEFAULT_OPENROUTER_FALLBACK_MODELS)
      expect(models.some((m) => m.id === DEFAULT_OPENROUTER_MODEL)).toBe(true)
    })
  })

  describe("API Calling & Resilient Fallbacks", () => {
    it("calls OpenRouter with Bearer token, attribution headers, and returns content", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (url, init) => {
        expect(String(url)).toBe("https://openrouter.ai/api/v1/chat/completions")
        const headers = (init?.headers || {}) as Record<string, string>
        expect(headers["Authorization"]).toBe("Bearer test-openrouter-key-123")
        expect(headers["HTTP-Referer"]).toBe("https://github.com/context-bridge")
        expect(headers["X-Title"]).toBe("Context Bridge")

        const body = JSON.parse(String(init?.body))
        expect(body.model).toBe("meta-llama/llama-3.3-70b-instruct:free")
        expect(body.response_format).toEqual({ type: "json_object" })

        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: '{"goal": "OpenRouter test successful"}' } }]
          })
        } as unknown as Response
      })

      const text = await callOpenRouter(
        "Summarize this",
        "test-openrouter-key-123",
        "meta-llama/llama-3.3-70b-instruct:free"
      )
      expect(text).toBe('{"goal": "OpenRouter test successful"}')
    })

    it("retries without response_format if model returns 400 schema error", async () => {
      let callCount = 0
      vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
        callCount++
        const body = JSON.parse(String(init?.body))

        if (callCount === 1) {
          expect(body.response_format).toBeDefined()
          return {
            ok: false,
            status: 400,
            clone: () => ({
              json: async () => ({
                error: { message: "This model does not support response_format json_object" }
              })
            }),
            json: async () => ({
              error: { message: "This model does not support response_format json_object" }
            })
          } as unknown as Response
        }

        // Retry call
        expect(body.response_format).toBeUndefined()
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: '{"goal": "fallback worked"}' } }]
          })
        } as unknown as Response
      })

      const text = await callOpenRouter(
        "Summarize this",
        "test-openrouter-key-123",
        "meta-llama/llama-3.3-70b-instruct:free"
      )
      expect(callCount).toBe(2)
      expect(text).toBe('{"goal": "fallback worked"}')
    })

    it("tests OpenRouter connection successfully through testLLMConnection", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '{"goal": "test"}' } }]
        })
      } as unknown as Response)

      const result = await testLLMConnection(
        "openrouter",
        "mock-key-abc",
        "meta-llama/llama-3.3-70b-instruct:free"
      )
      expect(result.success).toBe(true)
      expect(result.message).toContain("meta-llama/llama-3.3-70b-instruct:free")
    })
  })

  describe("Settings & Storage Integration", () => {
    it("persists openrouterApiKey and openrouterModel, and clears key on deleteApiKeys", async () => {
      await saveSettings({
        provider: "openrouter",
        openrouterApiKey: "sk-or-v1-my-secret-key",
        openrouterModel: "deepseek/deepseek-r1:free"
      })

      let current = await getSettings()
      expect(current.provider).toBe("openrouter")
      expect(current.openrouterApiKey).toBe("sk-or-v1-my-secret-key")
      expect(current.openrouterModel).toBe("deepseek/deepseek-r1:free")

      await deleteApiKeys()
      current = await getSettings()
      expect(current.openrouterApiKey).toBe("")
      // Model choice is preserved even if key is deleted
      expect(current.openrouterModel).toBe("deepseek/deepseek-r1:free")
    })
  })
})
