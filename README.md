# Context Bridge (Chrome Extension — Manifest V3)

> Universal, Any-to-Any, Zero-Latency Context Synchronization Layer Across Web LLMs (**ChatGPT**, **Claude**, and **Google Gemini**). Built with Plasmo, React, TypeScript, and Tailwind CSS.

[![Build Status](https://img.shields.io/badge/Build-Passing-brightgreen)]()
[![Tests](https://img.shields.io/badge/Tests-34%20passed%20%7C%20239%20passed-success)]()
[![TypeCheck](https://img.shields.io/badge/TypeScript-0%20Errors-blue)]()
[![Manifest](https://img.shields.io/badge/Manifest-V3-orange)]()
[![Privacy](https://img.shields.io/badge/Privacy-100%25%20Local--First-purple)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 📖 Overview

When working with modern LLMs, switching platforms is painful:
- You hit Claude's 5-hour messaging limit and need to switch to ChatGPT or Gemini.
- You want ChatGPT's reasoning on a code problem Claude wrote, but re-explaining everything wastes time and tokens.
- You copy-paste snippets manually, losing context, conversation decisions, and links.

**Context Bridge** completely eliminates this friction. It acts as an ambient, private synchronization bridge across your AI chats in Chrome. It silently captures active conversation turns and verbatim code snippets locally on your machine, allowing you to hand off an entire conversation to another AI with a single click.

---

## 🚀 What Context Bridge Can Do

* **Universal Any-to-Any Sync:** Full bidirectional support across **ChatGPT**, **Claude**, and **Google Gemini**. Any platform can be a source or a destination.
* **100% Verbatim Code Preservation:** Code snippets in `<pre><code>` and CodeMirror blocks are preserved with exact indentation and language tags—never paraphrased or summarized.
* **Shared Links & Resources Collector:** Automatically extracts, deduplicates, and catalogs every external website, documentation page, and GitHub repository referenced during your chat into a clean link grid.
* **Deep Virtualized History Sweep:** Uses an intelligent container sweep to recover complete conversation transcripts from start to finish—even on massive chats (50 to 100+ turns) that use DOM virtualization.
* **Clean To-The-Point Summaries:** Distills complex, lengthy conversations into clean 2–4 bullet-point key highlights without bloated essays or raw text dumps.
* **Accurate Word Metrics:** Real-time metrics bar tracks your saved chats, messages, code blocks, and human-readable word volume (`~words`).
* **Session Pinning:** Keep important conversations permanently pinned (📌) or let temporary sessions automatically expire after 24 hours.
* **Smart Rate-Limit Handoff:** Instantly alerts you when Claude or ChatGPT hits usage or quota limits, providing a 1-click shortcut to resume on an alternate platform.
* **100% Local & Private:** No third-party servers, no analytics, no telemetry. Everything is stored locally in your browser's encrypted storage (`chrome.storage.local`). Client-side credential redaction scrubs API keys and tokens before text is processed.

---

## 🏛️ System Architecture

Context Bridge implements a **Hub-and-Spoke Adapter Architecture**. Every supported platform has a dedicated adapter that handles DOM scraping and text injection, ensuring zero platform-specific selectors bleed into UI components or content scripts.

```mermaid
graph TD
    subgraph Platforms["Supported AI Platforms (Bidirectional)"]
        CL["Claude (claude.ai)"]
        GPT["ChatGPT (chatgpt.com)"]
        GEM["Gemini (gemini.google.com)"]
    end

    subgraph ContentScript["Content Script Layer (Closed Shadow DOM)"]
        ADAPT["Platform Adapters (Zero DOM Heuristics Outside)"]
        OBS["MutationObserver (Debounced Auto-Save)"]
        SWEEP["Virtualized Scroll Collector (Full History Sweep)"]
        PILL["Floating Import Pill (Context Injection)"]
        RATE["Rate-Limit / Quota Detector"]
    end

    subgraph ServiceWorker["Background Service Worker (MV3)"]
        VAL["Origin & Sender ID Security Guard"]
        SCRUB["Client-Side Credential Redactor (API Keys, JWTs)"]
        MEM["Neutral StateMemory Engine"]
        EXP["Auto-Expiry & Permanent Pinning Manager"]
    end

    subgraph Storage["On-Device Storage"]
        LOCAL["chrome.storage.local (100% Private)"]
    end

    subgraph Interfaces["User Interfaces"]
        DASH["Full-Screen Studio Dashboard (dashboard.html)"]
        POP["Quick Popup (popup.html)"]
        SIDE["Chrome Side Panel (sidepanel.html)"]
    end

    CL <--> ADAPT
    GPT <--> ADAPT
    GEM <--> ADAPT

    ADAPT --> OBS
    ADAPT --> SWEEP
    OBS -->|chrome.runtime.sendMessage| VAL
    SWEEP -->|chrome.runtime.sendMessage| VAL
    VAL --> SCRUB
    SCRUB --> MEM
    MEM --> LOCAL
    EXP --> LOCAL

    LOCAL --> DASH
    LOCAL --> POP
    LOCAL --> SIDE
    LOCAL --> PILL
    PILL -->|Safe Plain-Text Insertion| ADAPT
```

---

## 🛠️ Step-by-Step Guide: How to Use Context Bridge

### 1. Installation

#### Running Locally (Developer Mode)
1. Clone this repository:
   ```bash
   git clone https://github.com/msajiddurrani/context-bridge.git
   cd context-bridge
   ```
2. Install dependencies and compile the production build:
   ```bash
   pnpm install
   pnpm build
   ```
3. Open Google Chrome and go to `chrome://extensions`.
4. Turn on **Developer mode** in the top-right corner.
5. Click **Load unpacked** (top-left) and select the `build/chrome-mv3-prod` directory (or `cb-live-test`).
6. Pin Context Bridge to your Chrome toolbar via the puzzle icon (🧩).

---

### 2. Ambient Conversation Auto-Saving

You do not need to press any button to save your chats.
1. Open [Claude](https://claude.ai), [ChatGPT](https://chatgpt.com), or [Gemini](https://gemini.google.com).
2. Chat as you normally do.
3. Context Bridge automatically recognizes the unique permalink URL of your chat and silently snapshots the conversation turns, verbatim code blocks, and referenced links into local storage.
4. If you start a new conversation (`/new`), Context Bridge waits until a real message is sent before recording, preventing temporary or empty chat clutter.

---

### 3. One-Click Chat Import & Platform Switching

When you want to continue your conversation on a different platform:
1. Open a new chat in **ChatGPT**, **Claude**, or **Gemini**.
2. A sleek, minimal floating button will appear near the input area:
   - Example: **`Import from Claude`** (or whichever platform you last used).
3. Click the button (or press `Alt + Shift + I`):
   - Context Bridge injects the structured handover prompt and verbatim code directly into the chat box without auto-submitting.
4. Press **Enter** to start chatting with your new AI. It will respond with `"Ready"` and possess full memory of your previous conversation.

#### Detail Level Selector:
Click the dropdown arrow (`⌄`) on the floating button to choose how much context to import:
* **Smart (Default):** Complete dialogue turns, thread outline, and all verbatim code blocks.
* **Full:** Comprehensive entire conversation history with turn-by-turn preservation.
* **Export (.md):** Downloads the complete conversation as a pristine GitHub-flavored Markdown document.

---

### 4. Using the Full-Screen Studio Dashboard

Click the **Dashboard ↗** button in the extension popup or open `chrome-extension://<id>/tabs/dashboard.html` to access the full workspace:

1. **Header Metrics Bar:**
   - Real-time live count of your **Chats**, **Messages**, **Code Snippets**, and total preserved **Words** (`~125k words`).
2. **Conversation Manager (Left Sidebar):**
   - Search across chats, code, and topics with instant filtering.
   - Filter by platform (**Claude**, **GPT**, **Gemini**).
   - Sort by **Recently Updated**, **Most Exchanges**, **Most Code Snippets**, or **Most Words**.
   - Pin sessions (📌) to prevent auto-expiry.
3. **Studio Workspace (Main Area):**
   - **Prompt for Another AI:** Preview and copy pre-formatted prompts tailored for ChatGPT, Claude, or Gemini in Markdown or XML format.
   - **Code Snippets:** Review all extracted code artifacts organized with file paths and syntax highlighting.
   - **Full Conversation:** Inspect the entire message transcript with collapsible view controls.
   - **Chat Summary & Resources:** Read a clean, bulleted executive overview of the conversation and view all shared external links in a clean 2-column card grid.
4. **Backup & Privacy Actions:**
   - **Export Backup:** Download all stored chats as a JSON backup.
   - **Import:** Restore chats from a previous backup file.
   - **Clean Up Expired:** Instantly prune sessions older than 24 hours.
   - **Clear All:** Wipe all local storage in one click.

---

### 5. Using the Chrome Side Panel & Quick Popup

* **Quick Popup (`popup.html`):** Click the extension icon in the toolbar for a compact view of active chats, 1-click **"Copy for AI"**, markdown downloads, and quick preview.
* **Side Panel (`sidepanel.html`):** Press `Alt + Shift + C` (or `Cmd + Shift + C` on macOS) to open Context Bridge directly inside Chrome's native side panel. This lets you reference previous chats and copy code while chatting on another tab without leaving your workspace.

---

### 6. Rate-Limit & Capacity Detection

If you hit platform usage caps (e.g., Claude's *"You've reached your message limit until 9 PM"* or ChatGPT's capacity limits):
* Context Bridge detects the platform capacity notification immediately.
* A subtle banner appears offering 1-click links to jump directly to Claude, ChatGPT, or Gemini with your context ready for handoff.

---

## ⌨️ Global Keyboard Shortcuts

| Shortcut (Windows / Linux) | Shortcut (macOS) | Action |
| :--- | :--- | :--- |
| `Alt + Shift + I` | `Command + Shift + I` | **Quick Inject:** Insert latest active context directly into current chat box |
| `Alt + Shift + C` | `Command + Shift + C` | **Side Panel:** Toggle Context Bridge side panel |

*(Shortcuts can be customized anytime in `chrome://extensions/shortcuts`)*

---

## 🔒 Security & Privacy Guarantees

1. **100% Client-Side:** Transcripts, code blocks, and context states never leave your browser. All persistence happens inside `chrome.storage.local`.
2. **Zero Telemetry or Tracking:** Zero analytics scripts, zero tracking pixels, and zero remote logging.
3. **Automatic Credential Scrubbing:** Before text is written or formatted, high-entropy secrets (OpenAI keys, Google API keys, AWS credentials, GitHub tokens, JWTs, private keys, passwords) are redacted locally via regex filters.
4. **Prompt Injection Defense:** Chat transcripts in exported prompts are enclosed within strict `<chat_log>` delimiters with system directives instructing receiving models never to execute untrusted instructions found inside.
5. **No Dangerous DOM APIs:** Text insertion uses standard plain-text setters and synthetic `InputEvent` dispatching. Strictly zero `innerHTML`, `eval()`, or `new Function`.
6. **No Auto-Submit:** Context Bridge places text into the input textarea only—it **never** clicks the submit button or triggers message sending automatically.

---

## 🧪 Development, Verification & Testing

### Prerequisites
* **Node.js**: `>= 20.x`
* **pnpm**: `>= 8.x`

### Core Commands
```bash
# Install dependencies
pnpm install

# Run the complete test suite (34 test suites / 239 unit tests)
pnpm test

# Run TypeScript type check (0 errors)
npx tsc --noEmit

# Compile production Chrome extension bundle
pnpm build

# Package deployment-ready zip file for Chrome Web Store
pnpm package
```

### Verification Standards
* Every release passes `npx tsc --noEmit` with **0 errors**.
* Full unit test suite (`pnpm test`) achieves **100% pass rate** across all 34 test suites.
* All site selectors are verified against live audit reports under `docs/site-reports/`.

---

## 📄 License

Distributed under the MIT License. See [LICENSE](LICENSE) for details.
