# Context Bridge — Chrome Web Store Listing Package

This document contains the official metadata, copy, permission justifications, and compliance declarations required for publishing **Context Bridge** to the Google Chrome Web Store.

---

## 1. Store Metadata

| Field | Value | Constraints |
| :--- | :--- | :--- |
| **Extension Name** | `Context Bridge` | 14 / 45 characters |
| **Short Description** | `Cross-platform conversation and code sync across ChatGPT, Claude, and Gemini. 100% private and on-device.` | 107 / 132 characters |
| **Version** | `1.0.0` (or `0.0.1` matching `package.json`) | Semver |
| **Primary Category** | `Productivity` | Official CWS Category |
| **Secondary Category** | `Developer Tools` | Official CWS Category |
| **Language** | `English (United States)` | Default Store Language |
| **Pricing** | `Free` | No in-app purchases |
| **Website / Repository** | `https://github.com/msajiddurrani/context-bridge` | Public Open Source Repository |
| **Support / Issues URL** | `https://github.com/msajiddurrani/context-bridge/issues` | Public Issue Tracker |
| **Privacy Policy URL** | `https://github.com/msajiddurrani/context-bridge/blob/main/docs/PRIVACY_POLICY.md` | Must be publicly accessible |

---

## 2. Detailed Store Description (Formatted for Chrome Web Store)

```markdown
Context Bridge is a 100% private, on-device context synchronization bridge built for developers and power users working across ChatGPT, Claude, and Google Gemini.

When working on complex engineering problems, switching between AI platforms is often painful: message caps kick in, reasoning models excel at different stages, and copying code manually loses previous context, technical decisions, and referenced resources.

Context Bridge eliminates this friction. It quietly tracks active conversation turns and verbatim code snippets locally on your machine, allowing you to hand off your full technical context to another AI model with a single click.

═══════════════════════════════════════════════
KEY CAPABILITIES
═══════════════════════════════════════════════

• Universal Any-to-Any Sync: Full bidirectional synchronization across ChatGPT (chatgpt.com), Claude (claude.ai), and Google Gemini (gemini.google.com). Any platform can act as a source or destination.
• 100% Verbatim Code Preservation: Code snippets in <pre><code> and CodeMirror blocks are extracted with exact indentation, line breaks, and language tags—never paraphrased or summarized.
• Shared Links & Resources Collector: Automatically indexes and catalogs every GitHub repository, documentation URL, and external link referenced during your chat into a clean resource view.
• Chrome Side Panel Integration: Open Context Bridge directly in Chrome's native side panel (Alt+Shift+C / Cmd+Shift+C) to reference past technical notes and copy code while chatting in your active tab.
• Full-Screen Studio Dashboard: Comprehensive dashboard to search past chats, review extracted code snippets, preview formatted handover prompts, and export conversations to GitHub-flavored Markdown (.md) or JSON backups.
• Automatic Permalinks Only: Context Bridge only saves real, permanent chats. Empty chats and temporary navigation URLs (/new) are ignored, keeping your workspace clean.
• Configurable Auto-Pruning: Temporary sessions automatically expire after 24 hours (or 3 days, 7 days, or unlimited). Important conversations can be pinned to keep them permanently.
• Client-Side Credential Scrubbing: Built-in regex filters automatically redact API keys, tokens, JWTs, and passwords locally before text is stored or formatted.

═══════════════════════════════════════════════
PRIVACY & SECURITY INVARIANTS
═══════════════════════════════════════════════

• 100% Local & On-Device: All data is saved strictly inside your browser's local sandbox (chrome.storage.local).
• Zero Outbound Network Requests: The extension does NOT communicate with any external servers, third-party databases, or cloud AI APIs.
• Zero Analytics or Telemetry: No tracking scripts, no Google Analytics, no crash reporters, and no unique user tracking IDs.
• Safe DOM Manipulation: Plain-text input insertion only. The extension never uses innerHTML, eval(), or remote code.
• Never Auto-Submits: Text injection places formatted context into the chat textarea only—it NEVER triggers message sending automatically.

═══════════════════════════════════════════════
KEYBOARD SHORTCUTS
═══════════════════════════════════════════════

• Alt + Shift + I (Cmd + Shift + I on macOS): Quick Inject latest active context into current chat box.
• Alt + Shift + C (Cmd + Shift + C on macOS): Open native Chrome Side Panel.

Open-source under MIT License: https://github.com/msajiddurrani/context-bridge
```

---

## 3. Single Purpose Declaration (Chrome Web Store Developer Console)

**Single Purpose Description:**
> Context Bridge synchronizes conversation contexts, technical decisions, and verbatim code snippets across web-based AI platforms (ChatGPT, Claude, and Google Gemini).

---

## 4. Permission Justifications (Copy directly into CWS Developer Dashboard)

### Permission: `storage`
> **Justification:** Required for `chrome.storage.local` to store conversation turns, verbatim code snippets, user retention settings (such as 24-hour auto-pruning), and pinned states locally on the user's computer. Data resides 100% on-device and is never synced to the cloud or transmitted to external servers.

### Permission: `activeTab`
> **Justification:** Granted only when the user clicks the extension action icon in the toolbar. Used to inspect the active tab's URL and title to provide real-time connection status (e.g., verifying that the active tab is ChatGPT or Claude) without requiring invasive background access to all websites (`<all_urls>`).

### Permission: `sidePanel`
> **Justification:** Required to power the persistent Chrome Side Panel (`sidepanel.html`), allowing developers to reference past technical notes, search previous conversations, and copy verbatim code side-by-side while interacting with active AI chats.

### Host Permissions: `https://claude.ai/*`, `https://chatgpt.com/*`, `https://*.chatgpt.com/*`, `https://gemini.google.com/*`
> **Justification:** Strictly limited to the three supported AI platforms. Required for content scripts to observe conversation turns, capture verbatim code blocks, and insert formatted handover prompts into the platform's chat textarea upon user gesture. The extension requests zero external network hosts or API domains.

---

## 5. Chrome Web Store Privacy Disclosures

When completing the **Privacy** tab in the Chrome Web Store Developer Dashboard, provide the following responses:

1. **Single Purpose Certification:**  
   Select: **Yes**, I certify that my extension complies with the Single Purpose Policy.

2. **Permission Justifications:**  
   Fill in the exact justifications provided in Section 4 above.

3. **Data Usage Declarations:**
   - **Personally Identifiable Information (PII):** `No`
   - **Health Information:** `No`
   - **Financial and Payment Information:** `No`
   - **Authentication Information (passwords, credentials, API keys):** `No` (The extension does not collect or store credentials; all processing is local).
   - **Personal Communications:** `Yes` — **Declaration:** *"Conversation turns on supported AI platforms (ChatGPT, Claude, Gemini) are parsed and stored strictly on the user's local device (chrome.storage.local) to facilitate user-directed context handoff across tabs. This data is processed 100% on-device, never leaves the user's computer, and is never transmitted to any third-party server."*
   - **Location:** `No`
   - **Web History:** `No` (Host permissions are strictly limited to the three supported AI chat domains).
   - **User Activity:** `No`
   - **Website Content:** `No`

4. **Developer Certifications (Required):**
   - Check: *"I do not sell user data to third parties."*
   - Check: *"I do not use or transfer user data for purposes that are unrelated to my item's core functionality."*
   - Check: *"I do not use or transfer user data to determine creditworthiness or for lending purposes."*

