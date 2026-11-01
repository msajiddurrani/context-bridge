/**
 * Context Bridge - Safe Plain Text DOM Insertion Engine
 *
 * Handles:
 * 1. Standard HTMLTextAreaElement & HTMLInputElement (React 16-19 prototype setter bypass + native Event('input'))
 * 2. ProseMirror, Lexical, and standard contenteditable divs (document.execCommand / textNode insertion + InputEvent)
 *
 * INVARIANTS:
 * - Plain text only. Zero innerHTML, dangerouslySetInnerHTML, or eval.
 * - MUST NEVER auto-submit or dispatch Enter keydowns.
 * - Cross-realm and iframe-safe (does not rely solely on same-window instanceof).
 */

export function safeInsertText(target: HTMLElement, text: string): boolean {
  if (!target || typeof text !== "string") {
    return false
  }

  target.focus()

  const doc = target.ownerDocument || document
  const win = doc.defaultView || window

  const isTextAreaOrInput =
    target.tagName === "TEXTAREA" ||
    target.tagName === "INPUT" ||
    (typeof win.HTMLTextAreaElement !== "undefined" && target instanceof win.HTMLTextAreaElement) ||
    (typeof win.HTMLInputElement !== "undefined" && target instanceof win.HTMLInputElement)

  // 0. Modern Rich Paste Attempt:
  // When long text (> 500 chars) is pasted into modern AI platforms (ChatGPT, Claude),
  // their editor automatically packages the text into an expandable snippet box / attachment card
  // with an expand modal button rather than filling the prompt textarea with raw text.
  try {
    let pasteEvent: any = null
    if (typeof win.ClipboardEvent !== "undefined" && typeof win.DataTransfer !== "undefined") {
      const dt = new win.DataTransfer()
      dt.setData("text/plain", text)
      try {
        const file = new win.File([text], "context-bridge-handover.md", { type: "text/markdown" })
        dt.items.add(file)
      } catch {
        // Ignored if File constructor is unsupported in realm
      }

      pasteEvent = new win.ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: dt
      })
    } else if (typeof win.Event !== "undefined") {
      // Cross-realm / JSDOM fallback: synthetic paste event with mock clipboardData
      pasteEvent = new win.Event("paste", { bubbles: true, cancelable: true })
      pasteEvent.clipboardData = {
        getData: (format: string) => (format === "text/plain" ? text : ""),
        types: ["text/plain"]
      }
    }

    if (pasteEvent) {
      const wasNotCancelled = target.dispatchEvent(pasteEvent)
      if (pasteEvent.defaultPrevented || !wasNotCancelled) {
        target.dispatchEvent(new Event("change", { bubbles: true }))
        return true
      }
    }
  } catch {
    // Fall back to standard direct DOM insertion
  }

  // 1. Standard Textarea or Input Element
  if (isTextAreaOrInput) {
    const proto =
      target.tagName === "TEXTAREA"
        ? win.HTMLTextAreaElement?.prototype
        : win.HTMLInputElement?.prototype

    const nativeSetter = proto ? Object.getOwnPropertyDescriptor(proto, "value")?.set : null

    if (nativeSetter) {
      nativeSetter.call(target, text)
    } else {
      ;(target as HTMLTextAreaElement).value = text
    }

    // Dispatch native bubbling InputEvent for React/Vue/Svelte state managers
    const inputEvent = new Event("input", { bubbles: true, cancelable: true })
    target.dispatchEvent(inputEvent)

    try {
      const advancedEvent = new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: text
      })
      target.dispatchEvent(advancedEvent)
    } catch {
      // Fallback already dispatched
    }

    target.dispatchEvent(new Event("change", { bubbles: true }))
    return true
  }

  // 2. ProseMirror / Lexical / Rich Contenteditable Divs
  const isRichEditor =
    target.isContentEditable ||
    target.getAttribute("contenteditable") === "true" ||
    target.classList.contains("ProseMirror") ||
    target.getAttribute("role") === "textbox" ||
    Boolean(target.closest(".ProseMirror, [contenteditable='true']"))

  if (isRichEditor) {
    target.focus()

    const selection = win.getSelection()
    if (selection) {
      const range = doc.createRange()
      range.selectNodeContents(target)
      selection.removeAllRanges()
      selection.addRange(range)
    }

    let commandSucceeded = false
    try {
      commandSucceeded = doc.execCommand("insertText", false, text)
    } catch {
      commandSucceeded = false
    }

    if (!commandSucceeded) {
      // Fallback: Safe text-node replacement in paragraph structure (NO innerHTML)
      while (target.firstChild) {
        target.removeChild(target.firstChild)
      }
      const p = doc.createElement("p")
      const textNode = doc.createTextNode(text)
      p.appendChild(textNode)
      target.appendChild(p)
    }

    const inputEvent = new Event("input", { bubbles: true, cancelable: true })
    target.dispatchEvent(inputEvent)

    try {
      const advancedEvent = new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: text
      })
      target.dispatchEvent(advancedEvent)
    } catch {
      // Fallback already dispatched
    }

    target.dispatchEvent(new Event("change", { bubbles: true }))
    return true
  }

  return false
}
