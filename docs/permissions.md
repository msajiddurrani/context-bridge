# Context Bridge Permissions Audit & Host Permissions Documentation

## 1. Overview & Principle of Least Privilege

Context Bridge adheres strictly to Google Chrome Manifest V3 security requirements and the Principle of Least Privilege.

Context Bridge operates **100% locally and offline** on the user's machine:
- **Zero outbound network calls:** The extension does not issue `fetch()` or `XMLHttpRequest` requests to any external server or API.
- **Zero remote telemetry or analytics:** No tracking scripts or crash reporters are embedded.
- **Zero external API keys:** All parsing, redaction, and formatting are executed locally within the browser sandbox.

---

## 2. Manifest Permissions

| Permission | Category | Purpose & Chrome Web Store Justification |
| :--- | :--- | :--- |
| `storage` | Standard | **Required for `chrome.storage.local`.** Persists sanitized conversation transcripts, `StateMemory` objects, user retention preferences (e.g., 24-hour auto-prune), and pinned states locally on the user's computer. Stored data is never synced to the cloud (`chrome.storage.sync` is never used) and never leaves the local machine. |
| `activeTab` | Temporary / User-Gesture | **Temporary active tab metadata.** Granted only when the user explicitly clicks the extension action icon in the Chrome toolbar. Allows the popup to inspect the active tab's URL and title to display real-time platform eligibility status (e.g., "Active on ChatGPT") without requiring invasive, perpetual `<all_urls>` background access. |
| `sidePanel` | UI Integration | **Chrome Side Panel API.** Enables the extension to provide a persistent, native side-by-side workspace (`sidepanel.html`) next to the active browser tab, allowing users to reference past notes and copy verbatim code without switching tabs. |
| `scripting` | Framework Injection | **Content Script Runtime.** Utilized by the Plasmo framework bundler to inject the isolated content script bundle and Shadow DOM user interface (`bridge-csui.tsx`) into supported host pages. |

---

## 3. Host Permissions

Host permissions are strictly constrained to the three supported AI platforms:

| Host Match Pattern | Purpose & Rationale |
| :--- | :--- |
| `https://claude.ai/*` | Host domain for Anthropic Claude. Required for the content script to observe conversation turns, capture verbatim code blocks, and insert formatted handover context into the Claude ProseMirror input box upon user click. |
| `https://chatgpt.com/*` | Primary canonical host domain for OpenAI ChatGPT web application. Required for the content script to observe conversation turns, capture verbatim code blocks, and insert formatted handover context into the `#prompt-textarea` input box upon user click. |
| `https://*.chatgpt.com/*` | Auxiliary wildcard for ChatGPT subdomains and edge assets encountered during single-page app navigation transitions. |
| `https://gemini.google.com/*` | Host domain for Google Gemini web application. Required for the content script to observe `<user-query>` / `<model-response>` turns, capture verbatim code blocks, and insert formatted handover context into the Gemini `rich-textarea` input box upon user click. |

### Outbound Network Endpoints: NONE
Context Bridge declares **zero** outbound API host permissions. The extension does not communicate with any external LLM endpoints, cloud databases, or third-party servers.

---

## 4. Single-Purpose Declaration

**Single Purpose:** Context Bridge synchronizes conversation contexts, technical decisions, and verbatim code snippets across web-based AI platforms (ChatGPT, Claude, and Google Gemini).

All declared permissions directly serve this single purpose:
- Host permissions grant access exclusively to the three platforms being synchronized.
- `storage` persists the captured conversations locally on disk.
- `activeTab` provides immediate feedback on whether the active tab is a supported chat.
- `sidePanel` gives developers a side-by-side reference panel.
