# Context Bridge — Chrome Web Store Listing Package

This document contains the official metadata, copy, permission justifications, and compliance declarations required for publishing **Context Bridge** to the Google Chrome Web Store.

---

## 1. Store Metadata

| Field | Value | Constraints |
| :--- | :--- | :--- |
| **Extension Name** | `Context Bridge` | 14 / 45 characters |
| **Short Description** | `Private, on-device context synchronization across ChatGPT, Claude, and Gemini for multi-model engineering workflows.` | 114 / 132 characters |
| **Version** | `0.0.1` | Must match `manifest.json` |
| **Primary Category** | `Productivity` | Official CWS Category |
| **Secondary Category** | `Developer Tools` | Official CWS Category |
| **Language** | `English (United States)` | Default Store Language |
| **Pricing** | `Free` | No in-app purchases |
| **Website / Repository** | `https://github.com/msajiddurrani/context-bridge` | Public Open Source Repository |
| **Support / Issues URL** | `https://github.com/msajiddurrani/context-bridge/issues` | Public Issue Tracker |
| **Privacy Policy URL** | `https://github.com/msajiddurrani/context-bridge/blob/main/docs/PRIVACY_POLICY.md` | Publicly accessible on GitHub |

---

## 2. Detailed Store Description (Formatted for Chrome Web Store)

```markdown
Context Bridge is an on-device context synchronization bridge built for developers and engineering teams working across ChatGPT, Claude, and Google Gemini.

When working on complex engineering problems, developers frequently work across different AI platforms to leverage complementary model capabilities, specialized reasoning strengths, or different workflow tools. However, switching between platforms manually loses previous conversation context, architectural decisions, and referenced code snippets.

Context Bridge streamlines this transition. It ambiently organizes active conversation turns and verbatim code snippets locally on your device, allowing you to transfer your technical context to another AI model with a single click.

═══════════════════════════════════════════════
IMPORTANT DISCLOSURE & USER CONTROL
═══════════════════════════════════════════════

• Automatic Conversation Capture: While enabled, Context Bridge ambiently records active conversation turns, verbatim code blocks, and shared links on supported AI platforms (claude.ai, chatgpt.com, gemini.google.com) only when a permanent conversation URL exists. Empty chats and temporary navigation paths (/new) are ignored.
• Immediate Master Switch: You can pause or disable capture at any time using the Master ON/OFF power toggle located directly in the extension popup header.
• On-Device Storage: All captured conversation data resides strictly on your local device in chrome.storage.local. No data is sent to external servers or third parties.
• Permanent Data Purge: Clicking "Clear All" in the popup or dashboard permanently wipes all conversation history and code snippets from local storage.

═══════════════════════════════════════════════
KEY CAPABILITIES
═══════════════════════════════════════════════

• Universal Any-to-Any Sync: Bidirectional synchronization across ChatGPT (chatgpt.com), Claude (claude.ai), and Google Gemini (gemini.google.com). Any supported platform can act as a source or destination.
• Verbatim Code Preservation: Code snippets in <pre><code> and CodeMirror blocks are extracted with exact indentation, line breaks, and language tags without summarization or paraphrasing.
• Shared Links & Resources Collector: Automatically indexes and catalogs GitHub repositories, documentation URLs, and external links referenced during your conversation into a clean resource view.
• Chrome Side Panel Integration: Open Context Bridge directly in Chrome's native side panel (Alt+Shift+C / Cmd+Shift+C) to reference past technical notes and copy code while chatting in your active tab.
• Full-Screen Studio Dashboard: Comprehensive dashboard to search past chats, review extracted code snippets, preview formatted handover prompts, and export conversations to GitHub-flavored Markdown (.md) or JSON backups.
• Automatic Permalinks Only: Context Bridge only saves real, permanent chat URLs. Empty chats and temporary navigation URLs (/new) are ignored, keeping your storage clean.
• User Retention & Auto-Pruning: Temporary sessions automatically expire after 24 hours (or 3 days, 7 days, or unlimited). Important conversations can be pinned to preserve them permanently.
• Best-Effort Credential Scrubbing: Built-in client-side regex filters scrub recognized API keys, tokens, JWTs, and passwords locally before text is stored or formatted.
• Immediate User Control: Features an instant Master ON/OFF power switch in the popup header to pause or resume capture at any time, plus a one-click "Clear All" button to permanently delete all stored data.

═══════════════════════════════════════════════
PRIVACY & SECURITY INVARIANTS
═══════════════════════════════════════════════

• On-Device Local Sandbox: All conversation records and code snippets are stored strictly inside your browser's local sandbox (chrome.storage.local).
• Zero Outbound Network Requests: The extension does NOT transmit data to any external servers, third-party databases, cloud telemetry, or external AI APIs.
• Zero Analytics or Tracking: No tracking scripts, no Google Analytics, no crash reporters, and no unique tracking identifiers.
• Safe DOM Manipulation: Plain-text input insertion only. The extension never uses innerHTML, eval(), or remote code execution.
• User-Initiated Submission: Text insertion places formatted context into the chat textarea only—it NEVER submits or triggers prompt sending automatically. You inspect and send the prompt yourself.

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
> **Justification:** Required for `chrome.storage.local` to store conversation turns, verbatim code snippets, user retention preferences (such as 24-hour auto-pruning), and pinned states locally on the user's computer. Data resides entirely on-device and is never synced to cloud servers or transmitted externally.

### Permission: `activeTab`
> **Justification:** Granted only when the user clicks the extension action icon in the toolbar. Used to inspect the active tab's URL and title to verify whether the active tab is a supported AI platform without requiring invasive background access to all websites (`<all_urls>`).

### Permission: `sidePanel`
> **Justification:** Required to power the persistent Chrome Side Panel (`sidepanel.html`), allowing developers to reference past technical notes, search previous conversations, and copy verbatim code side-by-side while interacting with active AI chats.

### Permission: `scripting`
> **Justification:** Utilized by the extension runtime to inject content scripts and isolated Shadow DOM UI elements into supported host platforms (`claude.ai`, `chatgpt.com`, `gemini.google.com`).

### Host Permissions: `https://claude.ai/*`, `https://chatgpt.com/*`, `https://*.chatgpt.com/*`, `https://gemini.google.com/*`
> **Justification:** Strictly limited to the three supported AI platforms. Required for content scripts to observe conversation turns, capture verbatim code blocks, and insert formatted handover prompts into the platform's chat textarea upon user gesture. The extension declares zero external network hosts, remote databases, or API domains.

---

## 5. Chrome Web Store Privacy Disclosures

When completing the **Privacy** tab in the Chrome Web Store Developer Dashboard, declare the following responses based on official Chrome Web Store definitions and actual extension behavior:

1. **Single Purpose Certification:**  
   Select: **Yes**, I certify that my extension complies with the Single Purpose Policy.

2. **Permission Justifications:**  
   Fill in the exact justifications provided in Section 4 above.

3. **Data Usage Declarations:**
   - **Website Content:** Select **`Yes`**
     **Justification:** *"Text, code snippets, and hyperlinks displayed within conversation threads on the three supported AI domains (claude.ai, chatgpt.com, gemini.google.com) are parsed directly from the webpage DOM and stored in chrome.storage.local to enable on-device context preservation and transfer. All processing is strictly on-device; zero data is transmitted to external servers or third parties."*
   - **Personal Communications:** Select **`Yes`**
     **Justification:** *"Conversation turns, user queries, and AI assistant responses on supported AI platforms (ChatGPT, Claude, Gemini) are parsed and stored strictly on the user's local device (chrome.storage.local) to facilitate user-directed context handoff across tabs. This data is processed on-device and is never transmitted to any third-party server or external service."*
   - **Personally Identifiable Information (PII):** Select **`Yes`**
     **Justification:** *"User-authored conversation prompts and code headers captured from supported AI platforms may contain personal identifiers (such as user names, author credits, or email addresses). This data is stored strictly in the browser's local sandbox (chrome.storage.local) for on-device context handoffs, is never transmitted off the user's device, and can be permanently deleted at any time using the 'Clear All' button."*
   - **Authentication Information (passwords, credentials, API keys):** Select **`No`**
     **Justification:** *"Context Bridge does not collect, request, or manage user authentication credentials, passwords, or accounts. The extension incorporates best-effort client-side regex pattern matching to scrub recognized API keys and tokens that may incidentally appear in user-authored code or prompts prior to local storage."*
   - **Health Information:** Select **`No`**
   - **Financial and Payment Information:** Select **`No`**
   - **Location:** Select **`No`**
   - **Web History:** Select **`No`** (Host permissions are strictly limited to the three supported AI chat domains).
   - **User Activity:** Select **`No`** (Does not monitor user clicks, keystrokes across sites, or analytics).

4. **Developer Certifications (Required):**
   - Check: *"I do not sell user data to third parties."*
   - Check: *"I do not use or transfer user data for purposes that are unrelated to my item's core functionality."*
   - Check: *"I do not use or transfer user data to determine creditworthiness or for lending purposes."*
