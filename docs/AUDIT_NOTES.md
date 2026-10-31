# Context Bridge — External Review & Audit Notes

## 1. What the Project Is
**Context Bridge** is a local-first, universal bidirectional context synchronization layer for web-based Large Language Model interfaces (Claude and ChatGPT). Built on the **Plasmo Framework (Manifest V3)** with **React** and **Tailwind CSS**, it operates directly in the browser to continuously extract technical state, code snippets, and active problem-solving contexts from one AI platform and seamlessly insert them into another.

---

## 2. Core Architecture Decisions

### Hub-and-Spoke Adapter Architecture
- All platform-specific DOM heuristics, selectors, and event dispatches are strictly isolated in `src/adapters/` (`chatgpt.ts` and `claude.ts`).
- Content scripts (`bridge-csui.tsx`, `navigation-monitor.ts`), background service workers (`background.ts`), and popup UI (`popup.tsx`) contain **zero site-specific DOM selectors**.
- Every platform adapter implements a standard `PlatformAdapter` contract (`getMessages`, `getInputBox`, `insertText`, `healthCheck`, `formatFor`, `getChatId`, `getChatTitle`, `isNewOrEmptyChat`, `matches`).

### Real Chat ID & Persistent Permalinks Only
- Conversations are tracked exclusively using platform-assigned permalink IDs (e.g., `/c/<uuid>` or chat UUIDs) and container attributes (`data-chatgpt-selection-conversation-id`).
- Real permalink sessions are never overwritten by navigation state from adjacent chats.
- For active chats started on root URLs (e.g. `https://chatgpt.com/` or `/new`), once substantive conversation turns are present, a deterministic active session ID (`active-<platform>-<promptHash>`) captures and saves the context, triggering the green OK badge and populating the extension popup. When a real permalink `/c/<uuid>` is later minted by the platform, `migrateTemporarySessions` seamlessly updates the stored context without losing turns.

### Message-ID Ownership & Foreign Turn Rejection
- `filterTurnsByMessageOwnership` maintains an internal ownership map associating message IDs with their originating conversation.
- Lingering DOM turns from previous chats during single-page app (SPA) transitions are filtered out.
- If all turns currently in the DOM are foreign, the system yields `NOT_READY_YET`, triggering up to 3 quiet-DOM retries before logging `SKIPPED_FOREIGN_TURNS`.

### Unified Formatter & Verbatim Code Preservation
- A single canonical formatter (`formatStateMemoryPrompt` in `src/utils/prompt-formatter.ts`) builds injected prompts for both the in-page injector and popup preview.
- Code blocks are extracted verbatim and wrapped in standard Markdown code fences without alteration or lossy paraphrasing.

### Local-First Mode & Optional BYOK
- By default, Context Bridge operates 100% offline in **Local Mode**, synthesizing structured objectives and turn history with 0 API tokens and no network calls.
- Users can optionally provide Bring-Your-Own-Key (BYOK) credentials (Google Gemini or OpenAI) for cloud-based synthesis.

### Strict Security Invariants
- **Client-Side Redaction**: Regex-based redaction scrubs API keys (`AIza...`, `sk-...`), JWTs, and private keys before any text can be sent to external LLM endpoints.
- **Prompt Injection Containment**: Transcripts are enclosed in strict `<chat_log>` boundary tags accompanied by clear system instructions to ignore instructions inside user logs.
- **Origin Validation**: `validateMessageSender` verifies `sender.id === chrome.runtime.id` and validates that `sender.tab.url` belongs exclusively to authorized hosts (`claude.ai`, `chatgpt.com`).
- **Safe DOM Manipulation**: Injections use native setter properties and input events; `innerHTML`, `dangerouslySetInnerHTML`, and `eval` are strictly prohibited.
- **Background-Only Network Calls**: Content scripts never make external fetch requests or access raw API keys.

---

## 3. Honest Bug Register (A1 - A12)

| ID | Description | Status | Verification Detail |
|---|---|---|---|
| **A1** | Conversation ID collision & title overwrite | **DONE** | Unit-tested only, live test pending. Tested in `tests/context-separation.test.ts`. |
| **A2** | Foreign turn pollution across SPA navigations | **DONE** | Unit-tested only, live test pending. Tested in `tests/chatgpt-spa-second-chat.test.ts`. |
| **A3** | Injection preview in Popup UI | **DONE** | Unit-tested only, live test pending. Tested in `tests/task2-register-items.test.ts`. |
| **A4** | Quiet DOM debounce (1.5s idle before auto-save) | **DONE** | Unit-tested only, live test pending. Implemented in `bridge-csui.tsx`. |
| **A5** | Rate limit detection & auto-pause | **DONE** | Unit-tested only, live test pending. Tested in `tests/task2-register-items.test.ts`. |
| **A6** | Context Pinning (pinned contexts immune to 24h expiry) | **DONE** | Unit-tested only, live test pending. Tested in `tests/task2-register-items.test.ts`. |
| **A7** | Async `sendResponse` leak prevention across all message paths | **DONE** | Unit-tested only, live test pending. Verified with catch-all fallbacks in `background.ts` and `bridge-csui.tsx`. |
| **A8** | Extension context invalidated guard (`isContextInvalidated`) | **DONE** | ChatGPT only, Claude UNVERIFIED. Implemented in `storage-manager.ts` and `bridge-csui.tsx`. |
| **A9** | Token usage telemetry & daily API budget cap | **DONE** | Unit-tested only, live test pending. Tested in `tests/token-efficiency.test.ts`. |
| **A10** | Non-blocking handling of unreadable/widget assistant turns | **DONE** | Unit-tested only, live test pending. Tested in `tests/chatgpt-spa-second-chat.test.ts`. |
| **A11** | Shared exchange count and token estimate (`computeContextMetrics`) | **DONE** | Unit-tested only, live test pending. Tested in `tests/task2-register-items.test.ts`. |
| **A12** | Save Decision Timeline reason codes | **DONE** | Unit-tested only, live test pending. Tested across all 9 codes in `tests/task2-register-items.test.ts`. |

---

## 4. UNVERIFIED List (Live Browser Testing Required)

The following items are verified in unit tests with synthetic and DOM fixtures, but must be validated on the live websites:
1. **ChatGPT Live Selectors**: Presence and stability of `data-chatgpt-search-message-ids`, `data-chatgpt-selection-message-id`, `data-dil-message-id`, and `data-chatgpt-selection-conversation-id` during real user interaction.
2. **ChatGPT UUID Format**: Verified that real `data-turn-key` attributes are UUIDs rather than sequential indices.
3. **Claude DOM Selectors**: Stability of `.font-claude-message` and `[data-test-render-count]` across web client deployments.
4. **SPA Transition Timing**: Lingering DOM turn clearing latency when clicking "New chat" in ChatGPT and Claude.
5. **Claude Extension Context Invalidation**: Handling when extension is reloaded while a Claude conversation tab is open.

---

## 5. What Is NOT Built Yet (Out of Scope for Stage 2)

1. **Part B: Full History Import**: Backfilling, scraping, and importing historical conversations from past dates.
2. **Part C: Advanced Injection Modes**: Custom outline modes, bulleted distillations, diff-only mode, and code-only extraction modes.
3. **Four Additional Platform Adapters**:
   - Google Gemini (`gemini.google.com`)
   - DeepSeek (`chat.deepseek.com`)
   - Grok (`grok.com`)
   - Perplexity (`perplexity.ai`)
   *Note: These adapters are intentionally deferred until live DOM structural audit reports are captured from each platform.*

---

## 6. Supported Platforms (Stage 3 Part B)

1. **Claude** (`claude.ai`) - Full bidirectional adapter (Observer & Injector)
2. **ChatGPT** (`chatgpt.com`) - Full bidirectional adapter (Observer & Injector)
3. **Gemini** (`gemini.google.com`) - Full bidirectional adapter (Observer & Injector)
   - Chat ID regex: `https://gemini.google.com/app/<chatId>`
   - Input Box: `rich-textarea div[contenteditable="true"]` (zero auto-submit)
   - Message Turns: `<user-query>` and `<model-response>`
   - Code Blocks: `<code-block>` and `<pre><code>` verbatim preservation
   - Title: Extracted from `h1.conversation-title` and clean document title
   - Handover format: Enhanced `.md` with directives, link extraction (`## 🔗 Referenced Links & GitHub Repositories`), and verbatim code blocks.

*Note: Per instruction, DeepSeek, Grok, and Perplexity were permanently removed from the extension.*

---

## 7. How to Build and Test

### Prerequisites
- Node.js >= 20.0.0
- pnpm >= 8.0.0

### Build Production Bundle
```bash
pnpm build
```
The output directory is created at: `build/chrome-mv3-prod`.
A ready-to-load copy is automatically synced to: `../cb-live-test`.

### Run Unit Test Suite
```bash
pnpm test
```
Result: 24 test files passed (170/170 tests passing).

### TypeScript Validation
```bash
npx tsc --noEmit
```
Result: 0 errors.

### Load in Google Chrome
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Toggle on **Developer mode** in the top right.
3. Click **Load unpacked**.
4. Select `cb-live-test` or `context-bridge/build/chrome-mv3-prod`.

