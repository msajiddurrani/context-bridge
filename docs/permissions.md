# Context Bridge Permissions Audit & Host Permissions Plan

## 1. Overview & Principle of Least Privilege

Context Bridge follows strict Manifest V3 security invariants. In **Local Mode**, Context Bridge runs 100% offline with zero outbound network calls and zero API keys. Outbound network requests occur solely when the user explicitly configures an external LLM provider in AI Mode.

---

## 2. Manifest Permissions

| Permission | Category | Purpose & Invariant Justification |
| :--- | :--- | :--- |
| `storage` | Standard | Required for `chrome.storage.local`. Stores sanitized transcripts, `StateMemory` records, encrypted BYOK API keys, user density settings, and diagnostic health logs locally on the device. Transcripts never leave local storage without user action. |
| `activeTab` | Temporary | Granted only when the user explicitly clicks the extension action icon to open the popup. Allows the popup to query the active tab's URL and title to display real-time context eligibility diagnostics and adapter status without requiring invasive, perpetual `<all_urls>` background tab access. |
| `scripting` | Dynamic Injection | Utilized exclusively by the developer diagnostics and DOM Investigator tools (`generateSiteReportDirectlyInTab`, `extractDomSkeletonDirectlyInTab`). Allows ephemeral, read-only DOM analysis scripts to run on demand in the active tab without hardcoded site content script bloat. |

---

## 3. Host Permissions

### AI Platform Host Permissions (Content Script & Observer Targets)
| Host Match Pattern | Purpose & Rationale |
| :--- | :--- |
| `https://claude.ai/*` | Host domain for Anthropic Claude. Runs CSUI injection overlay and conversation observer. |
| `https://chatgpt.com/*` | Primary canonical host domain for OpenAI ChatGPT web application. |
| `https://*.chatgpt.com/*` | Legacy and auxiliary subdomain wildcard. Used to accommodate subdomains and edge assets during ChatGPT navigation transitions. |
| `https://gemini.google.com/*` | Host domain for Google Gemini web application. |

### Outbound LLM Provider API Hosts (Background-Only Calls)
| Host Match Pattern | Purpose & Rationale |
| :--- | :--- |
| `https://generativelanguage.googleapis.com/*` | Official Google Gemini REST API endpoint for `gemini-2.0-flash` summarization. Called strictly within `background.ts` via `x-goog-api-key` header. |
| `https://api.openai.com/*` | Official OpenAI REST API endpoint for `gpt-4o-mini` summarization. Called strictly within `background.ts` via Bearer token authorization header. |
| `https://openrouter.ai/*` | OpenRouter REST API endpoint for multi-model fallback and model catalog discovery (`/api/v1/models`). Handled strictly within `background.ts` with 12-hour local caching. |

---

## 4. Stage 5 Plan: Runtime Optional Provider Permissions

Currently, outbound API host permissions are declared statically in `manifest.json`. In **Stage 5**, Context Bridge will transition all provider API host permissions to **runtime optional permissions** via the `chrome.permissions` API:

1. **Initial Install State**:
   - `manifest.json` will declare ONLY platform host permissions (`claude.ai`, `chatgpt.com`, `gemini.google.com`) and `storage`.
   - `optional_host_permissions` will contain:
     - `https://generativelanguage.googleapis.com/*`
     - `https://api.openai.com/*`
     - `https://openrouter.ai/*`
2. **On-Demand Permission Request**:
   - When a user enters a Gemini API key and selects Google Gemini as their provider, the extension invokes:
     ```typescript
     chrome.permissions.request({
       origins: ["https://generativelanguage.googleapis.com/*"]
     })
     ```
   - If the user declines, the extension cleanly falls back to **Local Mode** with a descriptive diagnostic notification.
3. **Revocation Upon Key Deletion**:
   - When the user clicks "Delete API Keys" in the Settings tab, Context Bridge automatically invokes `chrome.permissions.remove({ origins: [...] })`, releasing network capabilities back to a strictly zero-network local sandbox.
