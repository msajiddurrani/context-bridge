# Privacy Policy for Context Bridge

**Effective Date:** October 30, 2026  
**Last Updated:** October 30, 2026  
**Version:** 1.0.0 (Release Candidate 1)

Context Bridge ("the Extension", "we", "us", or "our") is a browser extension built to enable software engineers and AI users to synchronize conversation contexts across web-based large language model (LLM) interfaces (including Claude, ChatGPT, and Google Gemini). 

We are committed to unwavering transparency, data sovereignty, and user privacy. Context Bridge is architected from the ground up as a **Local-First, Zero-Telemetry** utility.

---

## 1. Core Architectural Invariant: Local-First Storage

Context Bridge stores all core data locally on your device:

1. **Conversation Transcripts & Memories:** All conversation turns, extracted code blocks, summaries, and metadata parsed from supported web interfaces are stored exclusively within your browser's local sandbox using Chrome's native `chrome.storage.local` API.
2. **API Keys (BYOK):** Any user-supplied API keys (for OpenRouter, Google Gemini, or OpenAI) are stored strictly on your local machine inside `chrome.storage.local`. They are never stored in synced storage (`chrome.storage.sync`), never cached in unencrypted files, and never transmitted to any server operated by Context Bridge.
3. **No Central Database or Cloud Storage:** Context Bridge does not operate, maintain, or communicate with any cloud database, user account service, or backend server.

---

## 2. Zero Telemetry & Tracking Invariant

We respect your privacy unconditionally:

- **No Analytics:** Context Bridge contains zero analytics tracking frameworks (such as Google Analytics, Mixpanel, Segment, or PostHog).
- **No Crash Reporting Services:** We do not include third-party crash reporters (such as Sentry or Bugsnag).
- **No Tracking Identifiers:** We do not assign unique user IDs, fingerprint devices, track browsing history, or monitor activities outside of the supported AI platforms (`claude.ai`, `chatgpt.com`, `gemini.google.com`).
- **No Intermediary Proxies:** The extension never routes your web traffic, transcripts, or queries through any proxy server or middleman.

---

## 3. Optional Bring-Your-Own-Key (BYOK) AI Integration

Context Bridge functions 100% offline in **Local Mode** by default, generating distilled outlines and preserving verbatim code snippets entirely on-device without issuing any network calls or consuming API tokens.

If you choose to enable enhanced AI Executive Summarization by providing your own API key (BYOK):
1. **Direct Point-to-Point Communication:** Outbound network requests are made strictly and directly from your browser's background service worker to the designated provider's official API endpoint:
   - **OpenRouter:** `https://openrouter.ai/api/v1/chat/completions`
   - **Google Gemini:** `https://generativelanguage.googleapis.com/v1beta/models/*`
   - **OpenAI:** `https://api.openai.com/v1/chat/completions`
2. **Client-Side Redaction Engine:** Before any prompt leaves your browser, our client-side credential redaction engine scrubs known high-entropy secrets—including OpenAI, Google, Anthropic, AWS, GitHub tokens, JWTs, private keys, and common password patterns.
3. **Prompt Injection Defense:** Transcripts are encapsulated inside `<chat_log>` isolation blocks with system instructions forbidding arbitrary command execution.
4. **Third-Party Provider Policies:** When using your own API key, transmissions to third-party AI providers are governed by their respective privacy policies and terms of service:
   - [OpenRouter Privacy Policy](https://openrouter.ai/privacy)
   - [Google Privacy Policy](https://policies.google.com/privacy)
   - [OpenAI Privacy Policy](https://openai.com/privacy)

---

## 4. Permissions Requested & Justification

Context Bridge adheres to the principle of least privilege under Chrome Manifest V3:

| Permission | Scope | Technical Justification |
| :--- | :--- | :--- |
| `storage` | Core Extension | Required to persist neutral conversation states (`StateMemory`), user preferences, and encrypted BYOK credentials locally in `chrome.storage.local`. |
| `activeTab` | User Interaction | Grants temporary access to the active tab to execute context formatting and clipboard/paste actions upon direct user gesture. |
| `scripting` | Injection Layer | Required to inject the Universal Bridge CSUI (Shadow DOM) and DOM observers into active tabs on supported platforms. |
| `sidePanel` | UI Accessibility | Enables the Context Bridge side panel for persistent context review, search, and navigation alongside your active chat session. |
| `host_permissions` | `https://claude.ai/*`, `https://chatgpt.com/*`, `https://*.chatgpt.com/*`, `https://gemini.google.com/*` | Required for content scripts to observe conversation turns and insert formatted context into the target platform's input box. |
| `optional_host_permissions` | `https://openrouter.ai/*`, `https://generativelanguage.googleapis.com/*`, `https://api.openai.com/*` | **Runtime Opt-In Only:** Requested strictly on explicit user gesture (button click) when configuring an external AI provider. Never granted by default and can be revoked at any time. |

---

## 5. Data Retention & User Control

You maintain complete control over all data captured by Context Bridge:

- **Configurable Auto-Expiry:** Context Bridge automatically prunes conversation contexts older than 24 hours (or your configured retention window) to minimize local storage usage.
- **Context Pinning:** Important conversations can be explicitly pinned (`pinned: true`) to exempt them from automated pruning.
- **Immediate Data Destruction:**
  - Clicking **"Delete API Keys"** in the popup immediately wipes all saved credentials from local storage and revokes all optional host permissions.
  - Clicking **"Clear All Data"** in the popup or side panel instantly and permanently flushes all conversation transcripts, state records, and cached models from your device.
- **Extension Removal:** Uninstalling Context Bridge immediately causes Chrome to permanently purge all data in `chrome.storage.local`.

---

## 6. Protection of Children's Privacy

Context Bridge is intended for general software engineering and professional use. It does not knowingly collect, process, or solicit information from children under the age of 13.

---

## 7. Changes to This Policy

We may update this Privacy Policy from time to time to reflect changes in our practices or regulatory requirements. Any revisions will be documented in this repository with an updated effective date. Continued use of Context Bridge after an update indicates acceptance of the revised policy.

---

## 8. Open Source & Independent Verification

Context Bridge is open-source software. You are encouraged to audit the source code, verify that no network requests occur in Local Mode, and inspect how data is processed by reviewing the official repository:
- **Repository:** [https://github.com/msajiddurrani/context-bridge](https://github.com/msajiddurrani/context-bridge)

---

## 9. Contact Information

If you have questions, concerns, or feedback regarding this Privacy Policy or data security within Context Bridge, please contact:
- **Developer / Maintainer:** Context Bridge Open Source Team
- **Issues & Inquiries:** [https://github.com/msajiddurrani/context-bridge/issues](https://github.com/msajiddurrani/context-bridge/issues)
