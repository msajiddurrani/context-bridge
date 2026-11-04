# Privacy Policy for Context Bridge

**Effective Date:** November 4, 2026
**Last Updated:** November 4, 2026
**Version:** 0.0.1 (Release Candidate)
**Publication Status:** Unpublished — Prepared for Chrome Web Store Review

Context Bridge ("the Extension", "we", "us", or "our") is a browser extension built to enable software engineers and AI users to synchronize conversation contexts across web-based large language model interfaces (specifically Claude, ChatGPT, and Google Gemini).

We are committed to data sovereignty, user privacy, and complete transparency. Context Bridge is architected from the ground up as a **Local-First, Zero-Telemetry, Zero-Outbound-Network** utility.

---

## 1. Core Architectural Principle: On-Device Local Storage

Context Bridge processes and stores all data locally on your device:

1. **Automatic Conversation Capture:** While the extension is active and enabled, Context Bridge automatically observes conversation turns, verbatim code blocks, and technical references from supported AI interfaces (`claude.ai`, `chatgpt.com`, `gemini.google.com`). Capture occurs **only** when a valid, permanent conversation URL exists (`/c/<id>`, `chat/<id>`). Empty chats and temporary navigation paths (such as `/new`) are strictly ignored.
2. **Local Storage Sandbox:** All captured turns, verbatim code blocks, extracted references, and distilled outlines are stored exclusively within your browser's local sandbox using Chrome's native `chrome.storage.local` API. Data resides strictly on your local computer disk.
3. **No Remote Servers or APIs:** Context Bridge does not communicate with, transmit data to, or operate any central database, cloud service, telemetry server, or external AI API.
4. **No API Keys or Credentials Collected:** The extension operates entirely offline without external API keys, tokens, or user accounts. No credentials are requested, collected, or stored.
5. **No Cloud Sync:** All data stored via `chrome.storage.local` is never synced to cloud accounts via `chrome.storage.sync` and is never exposed or transferred to third parties by the extension.

---

## 2. Types of Data Handled & Chrome Web Store Categories

In alignment with official Chrome Web Store User Data classifications:

1. **Website Content:** The extension parses text, code blocks (within `<pre><code>` and CodeMirror), and hyperlinks displayed on supported AI chat pages. This content is saved strictly in `chrome.storage.local` for local context preservation and handoff.
2. **Personal Communications:** Conversation turns, user queries, and AI assistant responses are captured and organized locally to enable cross-platform context transfers.
3. **Personally Identifiable Information (PII):** Context Bridge does not systematically collect, harvest, profile, or solicit personal identity information (such as names, email addresses, phone numbers, or government IDs). However, because the extension records full conversation turns, any personal identifiers, author credits, or contact information that you voluntarily enter into your chat prompts will reside in your local browser storage until deleted or expired.
4. **Authentication Information:** The extension does not collect, manage, or authenticate user credentials, passwords, or login tokens.
5. **Web History, Location, Health, and Financial Data:** Strictly **not collected**. The extension never accesses your general browsing history, GPS/IP location, health metrics, or financial data.

---

## 3. Zero Telemetry & Tracking Invariant

We respect your privacy unconditionally:

- **No Analytics:** Context Bridge contains zero analytics tracking frameworks (such as Google Analytics, Mixpanel, Segment, or PostHog).
- **No Crash Reporting Services:** We do not include third-party crash reporters (such as Sentry or Bugsnag).
- **No Tracking Identifiers:** We do not assign unique user IDs, fingerprint devices, track browsing history, or monitor activities outside of the supported AI platforms (`claude.ai`, `chatgpt.com`, `gemini.google.com`).
- **No Intermediary Proxies:** The extension never routes your web traffic, transcripts, or queries through any proxy server, VPN, or middleman.

---

## 4. On-Device Processing & Best-Effort Credential Redaction

Context Bridge functions locally on-device:

1. **Local Distillation & Formatting:** Conversation formatting, thread outlines, and verbatim code preservation are executed entirely within the browser's JavaScript runtime using deterministic parsing algorithms.
2. **Best-Effort Client-Side Redaction Engine:** Before any captured conversation is stored or copied, our client-side credential redaction engine automatically scrubs recognized high-entropy secrets—including OpenAI API keys, Google API keys, AWS credentials, GitHub tokens, JWTs, and private keys—using regular expression pattern matching. While this engine mitigates accidental credential exposure, regex pattern matching is a best-effort safeguard and cannot guarantee detection of every possible custom or non-standard token format. Users are strongly advised not to paste production credentials or sensitive private secrets into public LLM chats.
3. **Prompt Injection Containment:** Formatted context handoffs enclose past transcripts inside strict `<chat_log>` isolation blocks with receiving instructions to treat historical logs as inert reference material.

---

## 5. Manifest Permissions & Justifications

Context Bridge adheres to the principle of least privilege under Chrome Manifest V3:

| Permission | Scope | Technical Justification |
| :--- | :--- | :--- |
| `storage` | Core Extension | Required to persist conversation contexts (`StateMemory`), user retention settings, and pinned states locally in `chrome.storage.local`. |
| `activeTab` | User Interaction | Grants temporary, read-only access to the active tab's URL and title when you click the extension toolbar icon to verify adapter compatibility without requiring invasive `<all_urls>` background access. |
| `scripting` | Content Script Injection | Utilized by the extension runtime to inject content script helpers and isolated Shadow DOM UI elements into active tabs. |
| `sidePanel` | UI Accessibility | Enables the Context Bridge side panel (`sidepanel.html`) for persistent context review, search, and navigation alongside your active chat session. |
| `host_permissions` | `https://claude.ai/*`<br>`https://chatgpt.com/*`<br>`https://*.chatgpt.com/*`<br>`https://gemini.google.com/*` | Strictly restricted to the three supported AI platforms. Required for content scripts to observe conversation turns, extract code blocks, and insert formatted context into the target platform's input textarea upon user action. |

Context Bridge requests **no other permissions**, no external network endpoints, and no `<all_urls>` access.

---

## 6. Data Retention & User Controls

You maintain complete control over all data captured by Context Bridge:

- **Master ON/OFF Switch:** You can pause or completely disable all conversation observation and capture at any time using the master power switch located in the extension popup header. When toggled OFF, no DOM observation, context tracking, or storage writes occur.
- **Configurable Auto-Expiry:** Context Bridge automatically prunes conversation contexts older than 24 hours (or your configured retention window: 24h, 3 days, 7 days, or unlimited) to keep local storage clean.
- **Context Pinning:** Important conversations can be explicitly pinned (📌) to exempt them from automated pruning.
- **Single-Session Deletion:** Individual conversations can be deleted at any time from the popup or dashboard via the trash icon.
- **Immediate Data Destruction ("Clear All"):** Clicking **"Clear All"** in the popup or dashboard immediately and permanently flushes all conversation transcripts, code snippets, and state records from `chrome.storage.local`.
- **Extension Removal:** Uninstalling Context Bridge from Chrome immediately causes the browser to permanently purge all associated local storage data.

---

## 7. Destination AI Data Handling & User-Initiated Transfer

Context Bridge is an on-device clipboard and bridge; it does not process your conversations through any proprietary intermediary servers:

1. **User-Initiated Only:** Context is inserted into a target AI interface only when you explicitly select a saved conversation and click "Import" / "Transfer Context".
2. **Input Textarea Insertion Only (No Auto-Submission):** Context Bridge places the formatted handover prompt directly into the destination web page's input textarea (such as Claude's ProseMirror editor, ChatGPT's `#prompt-textarea`, or Gemini's `rich-textarea`). It **never** clicks the "Send" button or automatically submits the prompt on your behalf.
3. **Third-Party Provider Policies:** Once you review and manually submit the injected prompt to a destination platform (e.g., Anthropic Claude, OpenAI ChatGPT, or Google Gemini), that transmission occurs directly between your browser and that AI provider under your existing account session. That data handling is governed strictly by the respective provider's Privacy Policy and Terms of Service:
   - [Anthropic Privacy Policy](https://www.anthropic.com/legal/privacy)
   - [OpenAI Privacy Policy](https://openai.com/policies/privacy-policy)
   - [Google Privacy Policy](https://policies.google.com/privacy)
4. Context Bridge is completely independent and is not affiliated with, endorsed by, or sponsored by Anthropic, OpenAI, or Google.

---

## 8. Protection of Children's Privacy

Context Bridge is intended for general software engineering, development, and professional use. It does not knowingly collect, process, or solicit information from children under the age of 13.

---

## 9. Changes to This Policy

We may update this Privacy Policy from time to time to reflect changes in practices or regulatory requirements. Any revisions will be documented in this repository with an updated effective date.

---

## 10. Open Source & Independent Verification

Context Bridge is open-source software. You are encouraged to inspect the source code, verify that zero outbound network requests occur, and audit how data is handled:
- **Repository:** [https://github.com/msajiddurrani/context-bridge](https://github.com/msajiddurrani/context-bridge)

---

## 11. Contact Information

If you have questions, concerns, or feedback regarding this Privacy Policy or data security within Context Bridge, please contact:
- **Developer / Maintainer:** Muhammad Sajid Durrani
- **Repository:** [https://github.com/msajiddurrani/context-bridge](https://github.com/msajiddurrani/context-bridge)
- **Issues & Inquiries:** [https://github.com/msajiddurrani/context-bridge/issues](https://github.com/msajiddurrani/context-bridge/issues)


If you have questions, concerns, or feedback regarding this Privacy Policy or data security within Context Bridge, please contact:
- **Developer / Maintainer:** Muhammad Sajid Durrani
- **Repository:** [https://github.com/msajiddurrani/context-bridge](https://github.com/msajiddurrani/context-bridge)
- **Issues & Inquiries:** [https://github.com/msajiddurrani/context-bridge/issues](https://github.com/msajiddurrani/context-bridge/issues)
