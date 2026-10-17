# Context Bridge (Chrome Extension — Manifest V3)

> Universal, Any-to-Any, Bidirectional Context Synchronization Layer across Web LLMs (Claude, ChatGPT, Gemini, DeepSeek, Grok, Perplexity) built with Plasmo, React, and Tailwind CSS.

---

## 🏛️ Architecture & System Design

Context Bridge implements a **Hub-and-Spoke Adapter Architecture** where every supported AI chat platform runs both an **Observer** (continuous auto-saving of conversation state) and an **Injector** (safe insertion of captured context into input boxes).

```mermaid
graph TD
    subgraph WebLLMs["Supported Platforms (Any-to-Any)"]
        CL["Claude (claude.ai)"]
        GPT["ChatGPT (chatgpt.com)"]
        GEM["Gemini (gemini.google.com)"]
        DS["DeepSeek (chat.deepseek.com)"]
        GRK["Grok (grok.com)"]
        PX["Perplexity (perplexity.ai)"]
    end

    subgraph ContentScript["Content Script Layer (bridge-csui.tsx)"]
        MO["Continuous MutationObserver (Debounced & De-duped)"]
        INJ["Universal Floating CSUI (Closed Shadow DOM)"]
        ADAPT["PlatformAdapter (Zero Selectors Outside /adapters)"]
    end

    subgraph ServiceWorker["Manifest V3 Background Worker (background.ts)"]
        VAL["Origin & Sender ID Validation"]
        RED["Client-Side Credential Redaction Engine"]
        PROMPT["Prompt Injection Defense (<chat_log> Isolation)"]
        BYOK["Header-Based BYOK LLM Engine (gemini-2.5-flash / gpt-4o-mini)"]
    end

    subgraph Storage["Encrypted Local Persistence"]
        STORE["chrome.storage.local (Neutral StateMemory + Auto-Expiry Pruning)"]
    end

    WebLLMs <--> ADAPT
    ADAPT --> MO
    MO -->|chrome.runtime.sendMessage| VAL
    VAL --> RED
    RED --> PROMPT
    PROMPT --> BYOK
    BYOK --> STORE
    STORE -->|Active Contexts| INJ
    INJ -->|Safe Text Insert (No Auto-Submit)| ADAPT
```

---

## 🚀 Key Features

1. **Any-to-Any & Bidirectional**:
   - Every supported platform can act as either a source or destination.
   - Strict loop prevention ensures context is never injected back into the chat session it was captured from.

2. **Continuous Auto-Save**:
   - `MutationObserver` watches chat turns with debouncing (2.5s) and message length deduplication.
   - Background queuing ensures API limits are respected. Flushes automatically on tab switch (`visibilitychange`).

3. **Verbatim Code Preservation**:
   - Raw code snippets inside `<pre><code>` blocks are preserved verbatim in neutral `StateMemory`.
   - Only the surrounding dialogue and technical decisions are distilled.

4. **Zero-Trust Security & Privacy**:
   - **Header-Based Authentication**: Google Gemini uses `x-goog-api-key` header (never query URLs); OpenAI uses `Authorization: Bearer`.
   - **Client-Side Redaction**: Automatically scrubs API keys (Google, OpenAI, Anthropic, AWS, GitHub), JWTs, private keys, and passwords before payload leaves browser.
   - **Prompt Injection Defense**: Wraps user transcripts in `<chat_log>` delimiters with strict instructions to ignore embedded commands.
   - **Safe DOM Injection**: Native property descriptors and synthetic bubbling `InputEvent` dispatch for `<textarea>` and `contenteditable`/ProseMirror. Never uses `innerHTML` or `eval()`. Zero auto-submission.
   - **Configurable Auto-Expiry**: Contexts expire after 24 hours (configurable in settings) and are pruned automatically.

5. **Universal Floating Injection UI**:
   - Closed Shadow DOM isolation prevents CSS leaks to or from the host platform.
   - Highlights with an amber indicator on new/empty chats: *"Context from `<source>` (`<time ago>`) - Inject"*.
   - Context picker dropdown allowing selection of any active stored memory.

6. **Settings & Memory Management Popup**:
   - BYOK provider toggle (Google Gemini with `gemini-2.5-flash` or OpenAI with `gpt-4o-mini`).
   - Secure local storage, "Delete API key", and "Clear all data" panic buttons.
   - Real-time platform selector health checks.

---

## 🛠️ Getting Started

### Prerequisites
- Node.js >= 20.x
- pnpm >= 9.x

### Installation & Development
```bash
# Clone the repository
git clone https://github.com/msajiddurrani/context-bridge.git
cd context-bridge

# Install dependencies
pnpm install

# Run unit tests
pnpm test

# Build production bundle
pnpm build
```

### Loading the Extension into Chrome
1. Navigate to `chrome://extensions/` in Google Chrome.
2. Toggle on **Developer mode** (top-right).
3. Click **Load unpacked**.
4. Select the build directory:
   ```
   context-bridge/build/chrome-mv3-prod
   ```

---

## 🧪 Testing Suite

- **Vitest Unit Tests**: Includes mocked Chrome extension runtime, storage, prompt builders, redaction engine, and adapter selector fixtures:
  ```bash
  pnpm test
  ```
- **Platform Fixture Testing**: HTML fixtures in `src/adapters/fixtures/` verify DOM extraction, input discovery, text insertion, and health checks across LLM platforms.

---

## 📜 License

MIT License. Designed and built with the Plasmo Framework.
