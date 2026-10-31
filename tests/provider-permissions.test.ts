import { beforeEach, describe, expect, it, vi } from "vitest"
import * as fs from "fs"
import * as path from "path"
import {
  getProviderOrigin,
  hasProviderPermission,
  requestProviderPermission,
  removeProviderPermission,
  removeAllProviderPermissions,
  getAllExternalLLMOrigins
} from "../src/utils/provider-permissions"
import { resetMockStore, getMockGrantedPermissions } from "./setup"
import { handleTriggerAiSummary } from "../src/background"
import { saveContext, saveSettings } from "../src/utils/storage-manager"
import type { StoredContext } from "../src/types"

describe("Stage 5: Provider Hardening & Runtime Optional Permissions Suite", () => {
  beforeEach(() => {
    resetMockStore()
    vi.restoreAllMocks()
  })

  // --------------------------------------------------------------------------
  // 1. Manifest Audit: Strict Principle of Least Privilege
  // --------------------------------------------------------------------------
  describe("Manifest V3 Permission Verification", () => {
    it("verifies package.json host_permissions contains only core AI platforms", () => {
      const packageJsonPath = path.resolve(__dirname, "../package.json")
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"))
      const hostPerms: string[] = pkg.manifest?.host_permissions || []
      const optionalPerms: string[] = pkg.manifest?.optional_host_permissions || []

      // Core platforms ONLY
      expect(hostPerms).toContain("https://claude.ai/*")
      expect(hostPerms).toContain("https://chatgpt.com/*")
      expect(hostPerms).toContain("https://*.chatgpt.com/*")
      expect(hostPerms).toContain("https://gemini.google.com/*")

      // External LLM APIs MUST NOT be in static host_permissions
      expect(hostPerms).not.toContain("https://openrouter.ai/*")
      expect(hostPerms).not.toContain("https://generativelanguage.googleapis.com/*")
      expect(hostPerms).not.toContain("https://api.openai.com/*")

      // External LLM APIs MUST be in optional_host_permissions
      expect(optionalPerms).toContain("https://openrouter.ai/*")
      expect(optionalPerms).toContain("https://generativelanguage.googleapis.com/*")
      expect(optionalPerms).toContain("https://api.openai.com/*")
    })
  })

  // --------------------------------------------------------------------------
  // 2. Provider Origin Mapping
  // --------------------------------------------------------------------------
  describe("Provider Origin Mapping", () => {
    it("maps providers to accurate origin patterns", () => {
      expect(getProviderOrigin("openrouter")).toBe("https://openrouter.ai/*")
      expect(getProviderOrigin("gemini")).toBe("https://generativelanguage.googleapis.com/*")
      expect(getProviderOrigin("openai")).toBe("https://api.openai.com/*")
      expect(getProviderOrigin("unknown")).toBeUndefined()
    })

    it("returns all external LLM origins for cleanup", () => {
      const allOrigins = getAllExternalLLMOrigins()
      expect(allOrigins).toHaveLength(3)
      expect(allOrigins).toContain("https://openrouter.ai/*")
      expect(allOrigins).toContain("https://generativelanguage.googleapis.com/*")
      expect(allOrigins).toContain("https://api.openai.com/*")
    })
  })

  // --------------------------------------------------------------------------
  // 3. Runtime Permission Management (Request, Check, Remove)
  // --------------------------------------------------------------------------
  describe("Runtime Permission Management", () => {
    it("defaults to permission NOT granted in clean state", async () => {
      const hasPerm = await hasProviderPermission("openrouter")
      expect(hasPerm).toBe(false)
    })

    it("grants permission upon user gesture request", async () => {
      const granted = await requestProviderPermission("openrouter")
      expect(granted).toBe(true)

      const hasPerm = await hasProviderPermission("openrouter")
      expect(hasPerm).toBe(true)
      expect(getMockGrantedPermissions().has("https://openrouter.ai/*")).toBe(true)
    })

    it("revokes provider permission on demand", async () => {
      await requestProviderPermission("gemini")
      expect(await hasProviderPermission("gemini")).toBe(true)

      const removed = await removeProviderPermission("gemini")
      expect(removed).toBe(true)
      expect(await hasProviderPermission("gemini")).toBe(false)
    })

    it("revokes all provider permissions on removeAllProviderPermissions", async () => {
      await requestProviderPermission("openrouter")
      await requestProviderPermission("openai")
      await requestProviderPermission("gemini")

      expect(getMockGrantedPermissions().size).toBe(3)

      await removeAllProviderPermissions()
      expect(getMockGrantedPermissions().size).toBe(0)
      expect(await hasProviderPermission("openrouter")).toBe(false)
      expect(await hasProviderPermission("openai")).toBe(false)
      expect(await hasProviderPermission("gemini")).toBe(false)
    })
  })

  // --------------------------------------------------------------------------
  // 4. Graceful Degradation in Background Service Worker
  // --------------------------------------------------------------------------
  describe("Graceful Degradation to Local Mode", () => {
    const mockContext: StoredContext = {
      id: "claude:chat-perm-test",
      sourcePlatform: "claude",
      chatId: "chat-perm-test",
      chatTitle: "Permission Degradation Test",
      sourceUrl: "https://claude.ai/chat/chat-perm-test",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      expiresAt: Date.now() + 100000,
      rawTranscript: "User: Hello\nAssistant: Hi there\nUser: Step 2\nAssistant: Step 2 done\nUser: Step 3\nAssistant: Step 3 done",
      rawCodeBlocks: [],
      turns: [
        { id: "1", role: "user", text: "Hello", codeBlocks: [] },
        { id: "2", role: "assistant", text: "Hi there", codeBlocks: [] },
        { id: "3", role: "user", text: "Step 2", codeBlocks: [] },
        { id: "4", role: "assistant", text: "Step 2 done", codeBlocks: [] },
        { id: "5", role: "user", text: "Step 3", codeBlocks: [] },
        { id: "6", role: "assistant", text: "Step 3 done", codeBlocks: [] }
      ],
      stateMemory: {
        version: "1.0",
        objective: "Test permission degradation",
        techStack: [],
        architectureDecisions: [],
        currentWork: "Testing",
        blockersAndErrors: [],
        nextSteps: [],
        criticalSnippets: [],
        rawTokenEstimate: 50
      }
    }

    it("falls back gracefully to Local Mode when host permission is not granted", async () => {
      await saveContext(mockContext)
      await saveSettings({
        provider: "openrouter",
        openrouterApiKey: "sk-or-test-key-12345",
        openrouterModel: "meta-llama/llama-3.3-70b-instruct:free"
      })

      // Ensure mock permissions do NOT have openrouter.ai
      expect(await hasProviderPermission("openrouter")).toBe(false)

      const result = await handleTriggerAiSummary({
        sourcePlatform: "claude",
        chatId: "chat-perm-test",
        trigger: "inject_click",
        turns: mockContext.turns
      })

      // Must NOT throw or fail; degrades gracefully to local mode
      expect(result.success).toBe(true)
      expect(result.mode).toBe("local")
    })
  })
})
