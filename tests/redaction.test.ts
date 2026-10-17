import { describe, expect, it } from "vitest"
import { redactSensitiveData } from "../src/utils/redaction"

describe("Redaction Engine", () => {
  it("scrubs Google / Gemini API keys", () => {
    const input = "Here is my key: AIzaSyD9jK2l9m4n8p7q6r5s4t3u2v1w0x9y8z7"
    const { redactedText, redactionCount, matchedCategories } = redactSensitiveData(input)

    expect(redactedText).toContain("[REDACTED_GOOGLE_KEY]")
    expect(redactedText).not.toContain("AIzaSyD9jK2l9m4n8p7q6r5s4t3u2v1w0x9y8z7")
    expect(redactionCount).toBe(1)
    expect(matchedCategories).toContain("google_key")
  })

  it("scrubs OpenAI API keys (both legacy and sk-proj)", () => {
    const input = "Standard: sk-1234567890abcdef1234567890abcdef and Project: sk-proj-1234567890abcdef1234567890abcdef12345678"
    const { redactedText, redactionCount, matchedCategories } = redactSensitiveData(input)

    expect(redactedText).not.toContain("sk-1234")
    expect(redactedText).not.toContain("sk-proj-")
    expect(redactionCount).toBe(2)
    expect(matchedCategories).toContain("openai_key")
  })

  it("scrubs JWT tokens", () => {
    const input =
      "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
    const { redactedText, matchedCategories } = redactSensitiveData(input)

    expect(redactedText).not.toContain("eyJhbGciOiJIUzI1Ni")
    expect(matchedCategories).toContain("jwt")
  })

  it("scrubs private key blocks", () => {
    const input = `
const fs = require('fs');
const key = \`-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA0Y1+examplePrivateKeystring
-----END RSA PRIVATE KEY-----\`;
    `
    const { redactedText, matchedCategories } = redactSensitiveData(input)

    expect(redactedText).toContain("[REDACTED_PRIVATE_KEY]")
    expect(redactedText).not.toContain("examplePrivateKeystring")
    expect(matchedCategories).toContain("private_key")
  })

  it("scrubs password and secret assignments", () => {
    const input = `password = "MySuperSecret123!"\napi_key: 'my-long-secret-key-value'`
    const { redactedText, matchedCategories } = redactSensitiveData(input)

    expect(redactedText).not.toContain("MySuperSecret123!")
    expect(redactedText).not.toContain("my-long-secret-key-value")
    expect(matchedCategories).toContain("password_assignment")
  })

  it("leaves clean text untouched", () => {
    const input = "This is a clean engineering discussion about React hooks and TypeScript types."
    const { redactedText, redactionCount } = redactSensitiveData(input)

    expect(redactedText).toBe(input)
    expect(redactionCount).toBe(0)
  })
})
