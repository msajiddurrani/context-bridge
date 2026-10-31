import { describe, expect, it } from "vitest"
import { JSDOM } from "jsdom"
import { extractStructuredMessageText } from "../src/utils/text-extractor"

describe("F7: Structured Text Extraction (Selector-Free DOM Walk)", () => {
  it("converts glued assistant text into separate paragraphs and list items", () => {
    const dom = new JSDOM(
      `<div>
        <p>Here's a simple Python function that adds two numbers:</p>
        <p>How it works:</p>
        <ul>
          <li>def defines a function.</li>
          <li>a and b are the two input numbers.</li>
        </ul>
      </div>`
    )
    const text = extractStructuredMessageText(dom.window.document.body.firstElementChild as HTMLElement)
    expect(text).toContain("Here's a simple Python function that adds two numbers:\n\nHow it works:")
    expect(text).toContain("- def defines a function.")
    expect(text).toContain("- a and b are the two input numbers.")
    expect(text).not.toContain("numbers:How it works:def")
  })

  it("replaces images with [image] and drops alt text completely", () => {
    const dom = new JSDOM(
      `<div>
        <p>Here is a fresh banana:</p>
        <img src="banana.jpg" alt="Ripe banana bunch isolated on white background. File contains clipping..." />
        <p>It contains potassium.</p>
      </div>`
    )
    const text = extractStructuredMessageText(dom.window.document.body.firstElementChild as HTMLElement)
    expect(text).toContain("[image]")
    expect(text).not.toContain("Ripe banana bunch isolated")
    expect(text).not.toContain("File contains clipping")
  })

  it("preserves Urdu, Hindi, and multilingual text completely unchanged", () => {
    const sample = "کیلے کے فوائد: کیلا صحت کے لیے بہت مفید ہے۔ केले के फायदे।"
    const dom = new JSDOM(`<div><p>${sample}</p></div>`)
    const text = extractStructuredMessageText(dom.window.document.body.firstElementChild as HTMLElement)
    expect(text).toContain(sample)
  })

  it("drops UI noise like copy buttons, timestamps, and citations", () => {
    const dom = new JSDOM(
      `<div>
        <button aria-label="Copy code">Copy</button>
        <span class="timestamp">just now</span>
        <p>Actual answer text.</p>
        <span class="citation">1</span>
      </div>`
    )
    const text = extractStructuredMessageText(dom.window.document.body.firstElementChild as HTMLElement)
    expect(text).toBe("Actual answer text.")
  })
})
