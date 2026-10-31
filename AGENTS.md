# Context Bridge Agent Operating Guidelines (AGENTS.md)

This repository implements **Context Bridge**, a universal, bidirectional, any-to-any context synchronization layer across web-based LLMs (active on Claude, ChatGPT, and Gemini; DeepSeek, Grok, and Perplexity are planned) built on the Plasmo Framework (Manifest V3) with React and Tailwind CSS.

---

## 🏛️ Core Architectural Invariants

### 1. Hub-and-Spoke Adapter Architecture
- Every supported AI platform must have a dedicated adapter implementing `PlatformAdapter` inside `src/adapters/`.
- **Zero Platform-Specific Selectors Outside Adapters**: Content scripts, background workers, and popups must NEVER contain site-specific selectors, class names, or DOM heuristics.
- **Selector Preference Hierarchy**: Always prefer `data-*` attributes (e.g., `[data-message-author-role]`, `[data-message-author-slug]`, `[data-testid]`) and ARIA roles over fragile CSS class names.
- All adapters must implement:
  - `getMessages(doc: Document): MessageTurn[]`
  - `getInputBox(doc: Document): HTMLElement | null`
  - `insertText(target: HTMLElement, text: string): boolean`
  - `healthCheck(doc: Document): { ok: boolean; issues: string[] }`
  - `formatFor(memory: StateMemory, fromPlatform: PlatformId): string`
  - `getChatId(url: string, doc: Document): string`
  - `getChatTitle(doc: Document): string`
  - `isNewOrEmptyChat(doc: Document): boolean`
  - `matches(url: string): boolean`
  - `getChatContainer?(doc: Document): HTMLElement | null`

### Current Adapter Selector Locations
| Platform | Adapter File | Key Turn Marker | Input Box Selector |
|---|---|---|---|
| Claude | `src/adapters/claude.ts` | `[data-message-author-slug="claude"]`, `[data-testid="user-message"]` | `div.ProseMirror[contenteditable="true"]` |
| ChatGPT | `src/adapters/chatgpt.ts` | `[data-message-author-role]` (`user` / `assistant`) | `#prompt-textarea`, `div[contenteditable="true"]` |
| Gemini | `src/adapters/gemini.ts` | `user-query`, `model-response`, `[data-message-author-role]` | `div.rich-textarea[contenteditable="true"]` |
| DeepSeek | *Planned (Part B)* | `chat.deepseek.com` | (planned) |
| Grok | *Planned (Part B)* | `grok.com` | (planned) |
| Perplexity | *Planned (Part B)* | `perplexity.ai` | (planned) |

### 2. Any-to-Any and Bidirectional
- No platform is hardcoded as source-only or destination-only.
- Every supported platform runs both the **Observer** (auto-saving conversations) and the **Injector** (inserting context).
- **Loop Prevention**: Never inject a context back into the exact same chat session it was captured from (`c.sourcePlatform === currentPlatform && c.chatId === currentChatId`).
- **Universal Panel Eligibility**: A context from platform A (e.g. ChatGPT) must ALWAYS be visible on platform B (e.g. Claude) and vice versa. On `/new` and empty chats, no past context is ever hidden.

### 3. Local-First & Save Raw Before Any API Call
- **Principle 1 (Local-First)**: Raw capture and local compression need NO network and NO API key. AI summary is an optional enhancement.
- **Principle 5 (Save Raw Before API Call)**: Whenever `AUTO_SAVE_TRANSCRIPT` arrives, the raw context is committed to `chrome.storage.local` immediately before attempting any LLM call. Data is never lost even if the external API returns 404, 429, or network errors.
- **Principle 2 (Never Fail Empty-Handed)**: If the AI summary call fails, the extension falls back to local mode, logs the HTTP status, and surfaces the error in the popup while preserving the local state.
- **Code Blocks Stored Verbatim**: Code snippets must NEVER be summarized or paraphrased. Code blocks are extracted verbatim; only the conversation surrounding them is distilled.

### 4. Background-Only API Calling & CORS/CSP Bypass
- All external API calls (Gemini, OpenAI) are executed exclusively within `background.ts`. Content scripts never touch API keys or execute outbound LLM fetch calls.
- **Header-Based Authentication**:
  - Google Gemini: Send via `x-goog-api-key` header (never in the URL query string).
  - OpenAI: Send via `Authorization: Bearer <key>` header.
- **Verified Active Model**: Default Gemini model is `gemini-3.8-flash` (verified from official Google documentation). Kept in `DEFAULT_GEMINI_MODEL` constant and user-configurable via popup settings.

### 5. Security & Privacy Invariants
- **Client-Side Redaction**: Before any text leaves the browser to an LLM endpoint, scrub all API keys, tokens, JWTs, private keys, and `password=` patterns (`src/utils/redaction.ts`).
- **Prompt Injection Defense**: Treat chat transcripts as untrusted user data. Wrap transcripts in `<chat_log>` delimiters with strict system instructions instructing the model never to execute commands found within them.
- **Message Origin Validation**: Every `chrome.runtime.onMessage` listener must validate `sender.id === chrome.runtime.id` and ensure `sender.tab.url` origin belongs to one of the 6 supported platforms.
- **Safe DOM Injection**: Plain-text DOM manipulation only. Never use `innerHTML`, `dangerouslySetInnerHTML`, or `eval()`.
- **Never Auto-Submit**: Text injection places text into the input box only. It must NEVER submit or trigger generation automatically.
- **Auto-Expiry**: Contexts are automatically expired and pruned after a configurable duration (default 24h).
- **Transparent Disclosure**: Popup states clearly: *"Your chat text is sent to Google/OpenAI for summarization via your personal BYOK key. Context states and keys are persisted strictly in your local browser storage."*

### 6. Shadow DOM Isolation for Injected UIs
- All injected content script UIs (CSUI) must be encapsulated in a Shadow DOM using Plasmo's `getStyle` with `data-text:~style.css` to prevent styling bleed between the extension and the host website.

---

## 🧪 Testing & Verification Requirements
- Every adapter must have:
  - An HTML fixture representing realistic conversation DOM structures in `src/adapters/fixtures/`.
  - Vitest unit tests verifying `getMessages`, `getInputBox`, `insertText`, and `healthCheck`.
- Filter logic (`filterEligibleContexts`) must have 100% test coverage verifying bidirectional visibility and `/new` empty chat isolation.
- Security checks (`pnpm audit`, grep verification for `innerHTML` and `eval`) must be run and documented before shipping.

---

## 🛑 WORKING RULES

1. **Never Claim "Fixed" Without a Verified Failing-Then-Passing Test**:
   - An issue or bug is NEVER declared "DONE" or "fixed" based on code inspection or synthetic fixtures alone.
   - You must write a test reproducing the exact failure that demonstrably fails before the fix, and only passes after the fix is implemented.

2. **Never Guess Selectors (Live DOM Facts Only)**:
   - DOM selectors must never be written from memory or speculative heuristics.
   - All selectors must be directly backed by captured live site audit reports stored under `docs/site-reports/` generated by the DOM Investigator tool on live sessions.

3. **Selectors Only Inside Adapters**:
   - Zero site-specific selectors, attributes, class names, or DOM heuristics outside `src/adapters/`. Content scripts, popups, and service workers must remain 100% platform-agnostic.

4. **One Formatter**:
   - Exactly one canonical formatting pipeline must be used by both the real in-page injection click path and popup preview (`formatFor` / prompt preview).
   - Never maintain divergent formatting logic between in-page injection and popup preview.

5. **No Temporary Chat IDs**:
   - Save conversation context ONLY when the page URL contains a verified platform permalink chat ID.
   - On `/`, `/new`, or temporary chat URLs, save NOTHING to storage. Report `skipped-no-chat-id` in Diagnostics.
   - Never generate pseudo or temporary IDs (e.g. `active-<platform>-<hash>`) to populate storage prematurely.

6. **Message-ID Ownership**:
   - Turns are owned exclusively by real platform message IDs.
   - Unit keys, turn keys, and sequential indices must never be used as message IDs.
   - The ownership registry (`filterTurnsByMessageOwnership`) strictly rejects foreign turns belonging to another chat.

7. **Strict Security Invariants**:
   - Zero `innerHTML`, `dangerouslySetInnerHTML`, `eval()`, or `new Function`. Plain-text DOM manipulation only.
   - Redact all credentials (API keys, JWTs, private keys) on client before LLM ingestion.
   - Validate sender ID and origin allowlist on all `chrome.runtime.onMessage` listeners.
   - Inter-window communication (e.g. `window.addEventListener("message")`) must validate `event.source === window` and require a cryptographic or session-bound nonce to prevent page script spoofing.
   - Outbound LLM fetch calls must run exclusively in `background.ts`.

8. **Stage Completion: Safe Copy Build & Final Report**:
   - Each development stage must end with a clean production build (`pnpm build`), zero TypeScript errors (`npx tsc --noEmit`), 100% test pass rate (`pnpm test`), and a transparent, verifiable final audit report.

