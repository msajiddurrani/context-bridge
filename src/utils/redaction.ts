/**
 * Context Bridge - Security Redaction Engine
 * Scrubs API keys, credentials, tokens, private keys, and passwords
 * before ANY conversation text leaves the browser.
 */

export interface RedactionResult {
  redactedText: string
  redactionCount: number
  matchedCategories: string[]
}

const REDACTION_PATTERNS: Array<{
  category: string
  regex: RegExp
  replacement: string
}> = [
  // 1. Private Key Blocks (RSA, EC, DSA, OpenSSH, PGP)
  {
    category: "private_key",
    regex: /-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9_-]+ )?PRIVATE KEY-----/gi,
    replacement: "[REDACTED_PRIVATE_KEY]"
  },
  // 2. JSON Web Tokens (JWT)
  {
    category: "jwt",
    regex: /\beyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.[A-Za-z0-9-_.+/=]+\b/g,
    replacement: "[REDACTED_JWT_TOKEN]"
  },
  // 3. OpenAI API Keys (legacy & project-scoped)
  {
    category: "openai_key",
    regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g,
    replacement: "[REDACTED_OPENAI_KEY]"
  },
  // 4. Google / Gemini API Keys
  {
    category: "google_key",
    regex: /\bAIzaSy[A-Za-z0-9_-]{33}\b/g,
    replacement: "[REDACTED_GOOGLE_KEY]"
  },
  // 5. Anthropic API Keys
  {
    category: "anthropic_key",
    regex: /\bsk-ant-[A-Za-z0-9_-]{32,}\b/g,
    replacement: "[REDACTED_ANTHROPIC_KEY]"
  },
  // 6. AWS Access Keys
  {
    category: "aws_key",
    regex: /\b(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b/g,
    replacement: "[REDACTED_AWS_KEY]"
  },
  // 7. GitHub Tokens (ghp, gho, ghu, ghs, ghr)
  {
    category: "github_token",
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}\b/g,
    replacement: "[REDACTED_GITHUB_TOKEN]"
  },
  // 8. Slack Tokens (xoxb, xoxp, etc.)
  {
    category: "slack_token",
    regex: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
    replacement: "[REDACTED_SLACK_TOKEN]"
  },
  // 9. GitLab Personal Access Tokens
  {
    category: "gitlab_token",
    regex: /\bglpat-[0-9a-zA-Z_-]{20,}\b/g,
    replacement: "[REDACTED_GITLAB_TOKEN]"
  },
  // 10. Authorization Bearer Tokens
  {
    category: "bearer_token",
    regex: /(?:Authorization:\s*)?Bearer\s+([A-Za-z0-9-._~+/]{24,}=*)/gi,
    replacement: "Bearer [REDACTED_BEARER_TOKEN]"
  },
  // 11. Password / Secret / Key assignments in code or config strings
  {
    category: "password_assignment",
    regex: /\b(password|passwd|secret|api_key|apikey|auth_token|client_secret)(\s*[:=]\s*["']?)[^\s"';&,\n]{6,}(["']?)/gi,
    replacement: "$1$2[REDACTED_CREDENTIAL]$3"
  }
]

/**
 * Scrubs all known sensitive strings from input text before external transmission.
 */
export function redactSensitiveData(input: string): RedactionResult {
  if (!input || typeof input !== "string") {
    return { redactedText: "", redactionCount: 0, matchedCategories: [] }
  }

  let text = input
  let count = 0
  const matched = new Set<string>()

  for (const { category, regex, replacement } of REDACTION_PATTERNS) {
    const matches = text.match(regex)
    if (matches && matches.length > 0) {
      count += matches.length
      matched.add(category)
      text = text.replace(regex, replacement)
    }
  }

  return {
    redactedText: text,
    redactionCount: count,
    matchedCategories: Array.from(matched)
  }
}
