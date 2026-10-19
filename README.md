# Context Bridge (Chrome Extension — Manifest V3)

> Universal, Any-to-Any, Bidirectional Context Synchronization Layer across Web LLMs (Live on Claude & ChatGPT; Gemini, DeepSeek, Grok, and Perplexity planned). Built with Plasmo, React, and Tailwind CSS.

---

## 🏛️ Architecture & System Design

Context Bridge implements a **Hub-and-Spoke Adapter Architecture** where every supported AI platform runs both an **Observer** (continuous auto-saving of conversation state) and an **Injector** (safe insertion of captured context into input boxes).

```mermaid
graph TD
    subgraph WebLLMs["Active Platforms (Any-to-Any)"]
        CL["Claude (claude.ai) — Active"]
        GPT["ChatGPT (chatgpt.com) — Active"]
        PLANNED["Gemini, DeepSeek, Grok, Perplexity — Planned"]
    end

    subgraph ContentScript["Content Script Layer (bridge-csui.tsx)"]
        MO["Continuous MutationObserver (Debounced & De-duped)"]
        INJ["Universal Floating CSUI (Closed Shadow DOM)"]
        ADAPT["PlatformAdapter (Zero Selectors Outside /adapters)"]
        FLT["Universal Context Filter (Bidirectional Invariant)"]
    end

    subgraph ServiceWorker["Manifest V3 Background Worker (background.ts)"]
        VAL["Origin & Sender ID Validation"]
        LOCAL["Local-First Raw Persist (Never Fails Empty-Handed)"]
        RED["Client-Side Credential Redaction Engine"]
        PROMPT["Prompt Injection Defense (<chat_log> Isolation)"]
        BYOK["Header-Based BYOK LLM Engine (gemini-2.0-flash / gpt-4o-mini)"]
    end

    subgraph Storage["Local Browser Persistence"]
        STORE["chrome.storage.local (Neutral StateMemory + Auto-Expiry Pruning)"]
    end

    CL <--> ADAPT
    GPT <--> ADAPT
    ADAPT --> MO
    MO -->|chrome.runtime.sendMessage| VAL
    VAL --> LOCAL
    LOCAL --> STORE
    LOCAL --> RED
    RED --> PROMPT
    PROMPT --> BYOK
    BYOK --> STORE
    STORE -->|Active Contexts| FLT
    FLT --> INJ
    INJ -->|Safe Text Insert (No Auto-Submit)| ADAPT
```

---

## 🚀 Key Features

1. **Any-to-Any & Bidirectional**:
   - Currently live on **Claude.ai** and **ChatGPT.com**. Every supported platform acts as both a source and destination.
   - Claude contexts are available for injection into ChatGPT, and ChatGPT contexts are available for injection into Claude.
   - Strict loop prevention ensures context is never injected back into the exact same chat session it was captured from.

2. **Local-First & Continuous Auto-Save**:
   - Operates 100% offline in Local Mode by default (0 API tokens used).
   - Raw conversations and verbatim code blocks are saved to local storage before any network call is made.
   - If an optional AI summary fails, the raw local context remains intact and ready to inject.
   - Dynamically tracks conversation turns across single-page app (SPA) navigations.

3. **Verbatim Code Preservation**:
   - Raw code snippets inside `<pre><code>` blocks are preserved verbatim in neutral `StateMemory`.
   - Only surrounding conversation text is summarized.

4. **Zero-Trust Security & Privacy**:
   - **Header-Based Authentication**: Google Gemini uses `x-goog-api-key` header; OpenAI uses `Authorization: Bearer`.
   - **Client-Side Redaction**: Automatically scrubs API keys (Google, OpenAI, Anthropic, AWS, GitHub), JWTs, private keys, and passwords before payload leaves browser.
   - **Prompt Injection Defense**: Wraps user transcripts in `<chat_log>` delimiters with strict instructions to ignore embedded commands.
   - **Safe DOM Injection**: Native property descriptors and synthetic bubbling `InputEvent` dispatch for `<textarea>` and `contenteditable`/ProseMirror. Never uses `innerHTML` or `eval()`. Zero auto-submission.
   - **Configurable Auto-Expiry & Context Pinning**: Contexts expire after 24 hours by default unless explicitly pinned (📌).

5. **Universal Floating Injection UI**:
   - Closed Shadow DOM isolation prevents CSS leaks to or from the host platform.
   - Automatically highlights when on a new or empty chat.
   - Context picker dropdown allowing selection of any active stored memory.

6. **Settings & Diagnostics Popup**:
   - Injected prompt preview ("Preview Injected Text") before inserting into the host LLM.
   - Configurable BYOK provider and verified model identifier.
   - "Test API Key & Model" button for instant connectivity and latency verification.
   - Save Decision Timeline with explicit decision codes for transparent debugging.
   - Local storage panic buttons: "Delete API Keys" and "Clear All Data".

---

## ⚠️ Known Issues & Unverified Live Behaviors

The following items are covered by comprehensive automated unit test suites, but have live browser constraints pending external testing:
- **ChatGPT Live Selectors**: Selectors rely on attributes observed in recent web client deployments (`data-chatgpt-search-message-ids`, `data-chatgpt-selection-message-id`, `data-dil-message-id`, `data-chatgpt-selection-conversation-id`). OpenAI UI redesigns may require adapter adjustments.
- **SPA Navigation Timing**: During rapid consecutive chat switching via "New chat", lingering DOM turns from the previous chat may temporarily cause a `NOT_READY_YET` retry cycle before capturing the new conversation.
- **Platform Expansion**: Adapters for Gemini (`gemini.google.com`), DeepSeek (`chat.deepseek.com`), Grok (`grok.com`), and Perplexity (`perplexity.ai`) are planned and pending real DOM structural reports.
- **Claude Reload Invalidation**: Reloading the extension while on an active Claude tab invalidates the extension context until the tab is refreshed.

---

## 🔒 Honest Privacy & Data Handling Disclosure

Context Bridge is engineered with a strict **Local-First** privacy philosophy:

1. **Local Mode (Default, No API Key Required)**:
   - All conversation transcripts and code blocks are stored strictly on your local device inside `chrome.storage.local`.
   - **Zero network requests** are sent to external servers. No data ever leaves your computer.

2. **AI Synthesis Mode (Optional BYOK Enhancement)**:
   - Only when you explicitly provide your personal Google Gemini or OpenAI API key in the extension settings does Context Bridge contact an external LLM endpoint for summarization.
   - **Automatic Client-Side Redaction**: Before any text is transmitted, our regex redaction engine scrubs known API keys, tokens, private keys, and password patterns directly on your machine.
   - **No Intermediary Backend**: Outbound requests are made directly from your browser to Google (`generativelanguage.googleapis.com`) or OpenAI (`api.openai.com`) using your own key. There are no tracking servers, no telemetry proxies, and no intermediate servers.
   - **Data Retention**: Your API keys and saved contexts reside exclusively on your machine and can be permanently wiped at any moment via the popup's "Delete API Keys" and "Clear All Data" buttons.

---

## 🛠️ Installation & Development

### Prerequisites
- **Node.js**: >= 20.x
- **pnpm**: >= 8.x

### Build & Test Commands
```bash
# Clone the repository
git clone https://github.com/msajiddurrani/context-bridge.git
cd context-bridge

# Install dependencies
pnpm install

# Run all unit tests (Vitest)
pnpm test

# Type checking
npx tsc --noEmit

# Build production Chrome extension (Manifest V3)
pnpm build
```

### Loading the Extension in Google Chrome
1. Run `pnpm build`.
2. Open Google Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** via the toggle in the top-right corner.
4. Click **Load unpacked**.
5. Select the `build/chrome-mv3-prod` folder inside the `context-bridge` directory.
6. Open [Claude](https://claude.ai) or [ChatGPT](https://chatgpt.com) to start bridging contexts!
