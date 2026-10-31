# Context Bridge (Chrome Extension — Manifest V3)

> Universal, Any-to-Any, Bidirectional Context Synchronization Layer across Web LLMs (Claude, ChatGPT, and Google Gemini). Built with Plasmo, React, and Tailwind CSS.

[![Build Status](https://img.shields.io/badge/Build-Passing-brightgreen)]()
[![Tests](https://img.shields.io/badge/Tests-33%20passed%20%7C%20230%20passed-success)]()
[![TypeCheck](https://img.shields.io/badge/TypeScript-0%20Errors-blue)]()
[![Manifest](https://img.shields.io/badge/Manifest-V3-orange)]()
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 🏛️ System Architecture

Context Bridge implements a **Hub-and-Spoke Adapter Architecture** where every supported AI platform runs both an **Observer** (continuous auto-saving of conversation state and verbatim code) and an **Injector** (safe plain-text insertion of captured context into input boxes).

```mermaid
graph TD
    subgraph WebLLMs["Tri-Platform Engine (Any-to-Any)"]
        CL["Claude (claude.ai) — Active"]
        GPT["ChatGPT (chatgpt.com) — Active"]
        GEM["Gemini (gemini.google.com) — Active"]
    end

    subgraph ContentScript["Content Script Layer (bridge-csui.tsx)"]
        EXTRACT["Direct Text Extractor & DOM Investigator"]
        SCROLL["Virtualized Scroll Collector (Full History Import)"]
        MO["Continuous MutationObserver (Debounced & De-duped)"]
        HANDOFF["Smart Context Handoff Pill (15-min Temporal Recency)"]
        QUOTA["Rate-Limit / Quota Exceeded Detector"]
        INJ["Universal Floating CSUI (Closed Shadow DOM)"]
        ADAPT["PlatformAdapter (Zero Selectors Outside /adapters)"]
        FLT["Universal Context Filter (Loop Prevention & Ownership)"]
    end

    subgraph ServiceWorker["Manifest V3 Background Worker (background.ts)"]
        VAL["Origin & Sender ID Validation"]
        LOCAL["Local-First Persist (Neutral StateMemory)"]
        RED["Client-Side Credential Redaction Engine"]
        PROMPT["Prompt Injection Defense (<chat_log> Isolation)"]
        PERM["Runtime Optional Permissions Guard"]
        BYOK["BYOK LLM Summarizer (OpenRouter, Gemini, OpenAI)"]
    end

    subgraph StorageLayer["Local Browser Persistence"]
        STORE["chrome.storage.local (Auto-Expiry 24h & Pinned Records)"]
    end

    CL <--> ADAPT
    GPT <--> ADAPT
    GEM <--> ADAPT
    ADAPT --> MO
    ADAPT --> EXTRACT
    ADAPT --> SCROLL
    MO -->|chrome.runtime.sendMessage| VAL
    VAL --> LOCAL
    LOCAL --> STORE
    LOCAL --> RED
    RED --> PROMPT
    PROMPT --> PERM
    PERM -->|Permission Granted| BYOK
    PERM -->|Denied / Local Mode| STORE
    BYOK --> STORE
    STORE -->|Active Contexts| FLT
    FLT --> INJ
    INJ -->|Safe Text Insert (No Auto-Submit)| ADAPT
```

---

## 🚀 Core Capabilities & Production Features

### 1. Tri-Platform Live Integration (Claude, ChatGPT, Gemini)
- **True Bidirectional Synchronization:** Every platform serves simultaneously as both a source and destination. Any captured context can be injected into any other platform.
- **Strict Loop Prevention:** A context is never injected back into the exact same chat session from which it originated (`chatId` / `sourceUrl` invariant).
- **Dedicated Adapters:** Zero platform-specific selectors exist outside `src/adapters/`. Content scripts and UI elements remain 100% platform-agnostic.

### 2. Full History Extraction & Virtualized Scroll Collection (Part A)
- **Direct Text Extractor:** Extracts pristine conversation text directly from DOM elements without markdown conversion corruption.
- **Virtualized History Import:** Automatically backfills full conversation transcripts even across heavily virtualized chats by programmatically scrolling and collecting historical DOM turns.
- **Verbatim Code Preservation:** Code snippets in `<pre><code>` blocks are stored verbatim without paraphrasing or data loss.

### 3. Context Separation & Message Ownership (Part B)
- **URL Permalink Enforcement:** Contexts are only recorded when a verified platform chat permalink ID is present. Temporary URLs (`/`, `/new`) produce zero storage pollution.
- **Independent Session Registry:** Chat A and Chat B never overwrite one another. Turns are strictly bound to their parent message IDs via `filterTurnsByMessageOwnership`.

### 4. Canonical Tri-Mode Formatting Pipeline (Part C)
- **Unified Formatter:** Exactly one formatting pipeline powers both the in-page injection click path and popup/side-panel preview:
  - **Local Mode (Default, Offline):** Purely on-device distillation with zero API dependencies, zero network requests, and zero token costs.
  - **Outline Mode:** Structured chronologically with user/assistant turn headers and verbatim code blocks.
  - **AI Executive Summary (BYOK):** Synthesizes lengthy exchanges into high-density briefings using your configured LLM.

### 5. Automation & Workflow Enhancements (Stage 4)
- **Smart Context Handoff:** Floating notification pill appears automatically on fresh chat sessions (`/`, `/new`) if a partner conversation occurred within the last 15 minutes.
- **Rate-Limit & Quota Detection:** Automatically monitors for platform capacity banners (e.g., Claude usage limits, ChatGPT model caps) and provides an immediate one-click handoff link to another provider.
- **Global Keyboard Shortcuts:**
  - `Alt+Shift+I` (Mac: `Cmd+Shift+I`): Quick Inject latest active context directly into the current chat.
  - `Alt+Shift+C` (Mac: `Cmd+Shift+C`): Toggle Context Bridge Side Panel.

### 6. Provider Hardening & OpenRouter BYOK (Stage 5)
- **Dynamic Model Discovery:** Seamless integration with OpenRouter's live catalog with local fallback caching.
- **Manifest V3 Least Privilege:** External AI endpoints (`openrouter.ai`, `googleapis.com`, `api.openai.com`) are configured as `optional_host_permissions`.
- **Runtime User Consent:** Host permissions are requested strictly on explicit user gesture (button clicks) in the Settings UI and can be revoked anytime.
- **Graceful Offline Fallback:** If network permissions are denied, the background service worker automatically falls back to Local Mode.

### 7. Side Panel & Shadow DOM Isolation
- **Persistent Side Panel (`sidepanel.tsx`):** Manage saved contexts, search history, review verbatim code blocks, and toggle pinning without obscuring your chat window.
- **CSS Isolation:** Floating UI is encapsulated inside a Shadow DOM to prevent CSS leaks between the extension and the host web app.
- **Safe DOM Injection:** Plain-text native value setter with bubbling `InputEvent` dispatch. Zero `innerHTML`, `dangerouslySetInnerHTML`, or `eval()`. Zero automatic form submission.

---

## 🔒 Security & Privacy Invariants

1. **Local-First Architecture:** All transcripts, code blocks, and API keys are stored exclusively in `chrome.storage.local`.
2. **Zero Telemetry:** No analytics, no tracking pixels, no telemetry servers, and no intermediary proxies.
3. **Client-Side Redaction:** High-entropy patterns (OpenAI, Google, AWS, GitHub tokens, JWTs, private keys, passwords) are scrubbed client-side before any outbound API call.
4. **Prompt Injection Defense:** Chat transcripts are enclosed within `<chat_log>` isolation blocks with strict instructions to ignore embedded instructions.
5. **Auto-Expiry Pruning:** Stale contexts are automatically purged after 24 hours unless marked as pinned (📌).
6. **Detailed Privacy Policy:** Read our full [Privacy Policy](docs/PRIVACY_POLICY.md).

---

## ⌨️ Keyboard Shortcuts

| Shortcut (Windows / Linux) | Shortcut (macOS) | Action |
| :--- | :--- | :--- |
| `Alt + Shift + I` | `Command + Shift + I` | Quick Inject latest active context into current tab |
| `Alt + Shift + C` | `Command + Shift + C` | Open / Toggle Context Bridge Side Panel |

---

## 🛠️ Development & Testing

### Prerequisites
- **Node.js**: `>= 20.x`
- **pnpm**: `>= 8.x`

### Commands
```bash
# Install dependencies
pnpm install

# Run the complete test suite (33 test suites / 230 unit tests)
pnpm test

# Run TypeScript type check (0 errors)
npx tsc --noEmit

# Build production Chrome extension
pnpm build

# Package deployment-ready zip file for Chrome Web Store
pnpm package
```

### Loading Unpacked in Chrome
1. Run `pnpm build`.
2. Navigate to `chrome://extensions` in Google Chrome.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select `build/chrome-mv3-prod`.
5. Open [Claude](https://claude.ai), [ChatGPT](https://chatgpt.com), or [Gemini](https://gemini.google.com).

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for details.
