import { Storage } from "@plasmohq/storage"
import { STORAGE_KEYS, type OpenRouterModelOption } from "../types"

const storage = new Storage({ area: "local" })

/**
 * Curated fallback models used when offline or initial load before live fetch completes.
 * Top free models are listed first.
 */
export const DEFAULT_OPENROUTER_FALLBACK_MODELS: OpenRouterModelOption[] = [
  {
    id: "meta-llama/llama-3.3-70b-instruct:free",
    name: "Meta: Llama 3.3 70B Instruct (free)",
    isFree: true,
    contextLength: 131072,
    promptPricePerM: 0,
    completionPricePerM: 0,
    description: "Top recommended free model with state-of-the-art reasoning and coding."
  },
  {
    id: "deepseek/deepseek-r1:free",
    name: "DeepSeek: DeepSeek R1 (free)",
    isFree: true,
    contextLength: 65536,
    promptPricePerM: 0,
    completionPricePerM: 0,
    description: "Flagship open reasoning model with chain-of-thought distillation."
  },
  {
    id: "deepseek/deepseek-chat:free",
    name: "DeepSeek: DeepSeek V3 (free)",
    isFree: true,
    contextLength: 65536,
    promptPricePerM: 0,
    completionPricePerM: 0,
    description: "Ultra-fast general language and coding model."
  },
  {
    id: "google/gemini-2.0-flash-exp:free",
    name: "Google: Gemini 2.0 Flash Experimental (free)",
    isFree: true,
    contextLength: 1048576,
    promptPricePerM: 0,
    completionPricePerM: 0,
    description: "Next-gen experimental multimodal model with massive 1M token context."
  },
  {
    id: "google/gemini-2.0-flash-thinking-exp:free",
    name: "Google: Gemini 2.0 Flash Thinking Experimental (free)",
    isFree: true,
    contextLength: 32768,
    promptPricePerM: 0,
    completionPricePerM: 0,
    description: "Fast thinking reasoning model from Google."
  },
  {
    id: "qwen/qwen-2.5-72b-instruct:free",
    name: "Qwen: Qwen 2.5 72B Instruct (free)",
    isFree: true,
    contextLength: 32768,
    promptPricePerM: 0,
    completionPricePerM: 0,
    description: "Competitive high-intelligence open model."
  },
  {
    id: "mistralai/mistral-small-24b-instruct-2501:free",
    name: "Mistral: Mistral Small 24B (free)",
    isFree: true,
    contextLength: 32768,
    promptPricePerM: 0,
    completionPricePerM: 0,
    description: "Compact, efficient French AI laboratory model."
  },
  {
    id: "meta-llama/llama-3.1-8b-instruct:free",
    name: "Meta: Llama 3.1 8B Instruct (free)",
    isFree: true,
    contextLength: 131072,
    promptPricePerM: 0,
    completionPricePerM: 0,
    description: "Lightweight, ultra-fast free model."
  },
  {
    id: "deepseek/deepseek-chat",
    name: "DeepSeek: DeepSeek V3",
    isFree: false,
    contextLength: 65536,
    promptPricePerM: 0.14,
    completionPricePerM: 0.28,
    description: "Exceptional cost-to-performance ratio ($0.14 / 1M tokens)."
  },
  {
    id: "deepseek/deepseek-r1",
    name: "DeepSeek: DeepSeek R1",
    isFree: false,
    contextLength: 65536,
    promptPricePerM: 0.55,
    completionPricePerM: 2.19,
    description: "Deep reasoning model ($0.55 / 1M tokens)."
  },
  {
    id: "openai/gpt-4o-mini",
    name: "OpenAI: GPT-4o Mini",
    isFree: false,
    contextLength: 128000,
    promptPricePerM: 0.15,
    completionPricePerM: 0.60,
    description: "Fast, lightweight model for everyday tasks ($0.15 / 1M tokens)."
  },
  {
    id: "google/gemini-2.0-flash-001",
    name: "Google: Gemini 2.0 Flash",
    isFree: false,
    contextLength: 1048576,
    promptPricePerM: 0.10,
    completionPricePerM: 0.40,
    description: "Sub-second latency with 1M context ($0.10 / 1M tokens)."
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct",
    name: "Meta: Llama 3.3 70B Instruct",
    isFree: false,
    contextLength: 131072,
    promptPricePerM: 0.12,
    completionPricePerM: 0.30,
    description: "Open-weight powerhouse ($0.12 / 1M tokens)."
  },
  {
    id: "anthropic/claude-3.5-haiku",
    name: "Anthropic: Claude 3.5 Haiku",
    isFree: false,
    contextLength: 200000,
    promptPricePerM: 0.80,
    completionPricePerM: 4.00,
    description: "Fast and intelligent Anthropic model ($0.80 / 1M tokens)."
  }
]

// Maximum price per 1M prompt tokens allowed: $10 (0.000010 USD per token)
// Frontier models costing more are filtered out as requested by the user.
export const MAX_PROMPT_PRICE_PER_M = 10.0
export const MAX_PROMPT_PRICE_PER_TOKEN = MAX_PROMPT_PRICE_PER_M / 1_000_000

// Explicit blacklist for expensive/frontier video/image/avatar models
const BLACKLISTED_MODEL_SUBSTRINGS = [
  "fable",
  "astron",
  "runway",
  "kling",
  "sora",
  "luma",
  "midjourney",
  "flux.1-dev",
  "stable-diffusion"
]

/**
 * Filters and formats raw OpenRouter model objects.
 */
export function filterAndFormatOpenRouterModels(rawModels: any[]): OpenRouterModelOption[] {
  if (!Array.isArray(rawModels)) return DEFAULT_OPENROUTER_FALLBACK_MODELS

  const validModels: OpenRouterModelOption[] = []

  for (const m of rawModels) {
    if (!m || typeof m.id !== "string") continue

    const id = m.id.trim()
    const lowerId = id.toLowerCase()
    const name = (m.name || id).trim()
    const lowerName = name.toLowerCase()

    // 1. Blacklist check (e.g. fable, astron, media generators)
    if (BLACKLISTED_MODEL_SUBSTRINGS.some((sub) => lowerId.includes(sub) || lowerName.includes(sub))) {
      continue
    }

    // 1b. Deprecation check: exclude deprecated or inactive models
    if (
      lowerId.includes(":deprecated") ||
      lowerName.includes("deprecated") ||
      m.status === "deprecated"
    ) {
      continue
    }

    // 2. Modality check: skip pure non-text models
    const inputModalities: string[] = m.architecture?.input_modalities || []
    if (inputModalities.length > 0 && !inputModalities.includes("text")) {
      continue
    }

    // 3. Pricing evaluation
    // OpenRouter returns pricing in USD per token as a string (e.g. "0.00000015")
    const promptPricePerToken = parseFloat(m.pricing?.prompt || "0")
    const completionPricePerToken = parseFloat(m.pricing?.completion || "0")

    const isFree =
      lowerId.endsWith(":free") ||
      (promptPricePerToken === 0 && completionPricePerToken === 0) ||
      lowerName.includes("(free)")

    // 4. Exclude expensive frontier models (> $10 / 1M tokens) unless free
    if (!isFree && promptPricePerToken > MAX_PROMPT_PRICE_PER_TOKEN) {
      continue
    }

    const promptPricePerM = Math.round(promptPricePerToken * 1_000_000 * 100) / 100
    const completionPricePerM = Math.round(completionPricePerToken * 1_000_000 * 100) / 100

    validModels.push({
      id,
      name,
      isFree,
      contextLength: m.context_length || undefined,
      promptPricePerM,
      completionPricePerM,
      description: m.description || undefined
    })
  }

  // 5. Sort: Free models first, then by popularity/name
  validModels.sort((a, b) => {
    if (a.isFree && !b.isFree) return -1
    if (!a.isFree && b.isFree) return 1
    if (a.isFree && b.isFree) {
      // Prioritize flagship free models
      const priorityA = a.id.includes("llama-3.3-70b") ? 1 : a.id.includes("deepseek-r1") ? 2 : a.id.includes("deepseek") ? 3 : a.id.includes("gemini") ? 4 : 5
      const priorityB = b.id.includes("llama-3.3-70b") ? 1 : b.id.includes("deepseek-r1") ? 2 : b.id.includes("deepseek") ? 3 : b.id.includes("gemini") ? 4 : 5
      if (priorityA !== priorityB) return priorityA - priorityB
      return a.name.localeCompare(b.name)
    }
    // For paid models, sort by prompt price ascending
    return (a.promptPricePerM || 0) - (b.promptPricePerM || 0)
  })

  return validModels.length > 0 ? validModels : DEFAULT_OPENROUTER_FALLBACK_MODELS
}

interface OpenRouterCache {
  timestamp: number
  models: OpenRouterModelOption[]
}

const CACHE_TTL_MS = 30 * 60 * 1000 // 30 minutes

/**
 * Fetches the up-to-date list of OpenRouter models directly from OpenRouter API.
 * Uses local storage caching and automatic fallback to guarantee offline reliability.
 */
export async function fetchOpenRouterModels(forceRefresh = false): Promise<OpenRouterModelOption[]> {
  try {
    // 1. Check cache if not forcing refresh
    if (!forceRefresh) {
      const cached = await storage.get<OpenRouterCache>(STORAGE_KEYS.OPENROUTER_MODELS_CACHE)
      if (cached && Array.isArray(cached.models) && cached.models.length > 0) {
        if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
          return cached.models
        }
      }
    }

    // 2. Fetch live models from OpenRouter API
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)

    const response = await fetch("https://openrouter.ai/api/v1/models", {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json"
      }
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      console.warn(`[ContextBridge OpenRouter] Failed to fetch models HTTP ${response.status}. Using fallback.`)
      return getCachedOrFallback()
    }

    const data = await response.json()
    const rawList = Array.isArray(data?.data) ? data.data : []
    const filtered = filterAndFormatOpenRouterModels(rawList)

    // 3. Save to local storage cache
    await storage.set(STORAGE_KEYS.OPENROUTER_MODELS_CACHE, {
      timestamp: Date.now(),
      models: filtered
    })

    return filtered
  } catch (err: any) {
    console.warn("[ContextBridge OpenRouter] Error fetching models:", err?.message || err)
    return getCachedOrFallback()
  }
}

async function getCachedOrFallback(): Promise<OpenRouterModelOption[]> {
  try {
    const cached = await storage.get<OpenRouterCache>(STORAGE_KEYS.OPENROUTER_MODELS_CACHE)
    if (cached && Array.isArray(cached.models) && cached.models.length > 0) {
      return cached.models
    }
  } catch {
    // ignore
  }
  return DEFAULT_OPENROUTER_FALLBACK_MODELS
}
