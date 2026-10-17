import type {
  AdapterHealthResult,
  MessageTurn,
  PlatformId,
  StateMemory
} from "../types"

/**
 * Universal PlatformAdapter interface.
 * All platform-specific DOM querying, mutation detection heuristics,
 * input box resolution, and text injection logic reside strictly within adapters.
 */
export interface PlatformAdapter {
  /**
   * Unique platform identifier.
   */
  readonly id: PlatformId

  /**
   * Human-readable platform name.
   */
  readonly displayName: string

  /**
   * Tests whether a given URL belongs to this platform.
   */
  matches(url: string): boolean

  /**
   * Extracts the unique chat or session ID from the URL or DOM.
   */
  getChatId(url: string, doc: Document): string

  /**
   * Extracts the chat title from the page (e.g. document.title or conversation header).
   */
  getChatTitle(doc: Document): string

  /**
   * Determines if the current conversation is brand new or empty (ready for context injection).
   */
  isNewOrEmptyChat(doc: Document): boolean

  /**
   * Scrapes all message turns (including code blocks) from the chat container.
   */
  getMessages(doc: Document): MessageTurn[]

  /**
   * Finds the primary prompt input element (<textarea> or contenteditable).
   */
  getInputBox(doc: Document): HTMLElement | null

  /**
   * Finds the primary scrollable chat container element for scoped mutation observation.
   * If omitted or returns null, defaults to document.body.
   */
  getChatContainer?(doc: Document): HTMLElement | null


  /**
   * Safely inserts plain text into the target input element and dispatches
   * synthetic/native events so the host React/ProseMirror state registers it.
   * MUST NEVER auto-submit.
   */
  insertText(target: HTMLElement, text: string): boolean

  /**
   * Validates whether selectors are currently functional on the live DOM.
   * Returns actionable issue descriptions if broken.
   */
  healthCheck(doc: Document): AdapterHealthResult

  /**
   * Formats a StateMemory object into a customized, high-density prompt
   * optimized for injection into this specific platform.
   */
  formatFor(memory: StateMemory, fromPlatform: PlatformId): string
}
