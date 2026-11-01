import { describe, expect, it } from "vitest"
import fs from "fs"
import path from "path"

describe("Security & Privacy: Zero Outbound Network Requests Audit (Part 6 & Part 7)", () => {
  function getSourceFiles(dir: string): string[] {
    let files: string[] = []
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        files = files.concat(getSourceFiles(fullPath))
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        files.push(fullPath)
      }
    }
    return files
  }

  const srcDir = path.resolve(__dirname, "../src")
  const sourceFiles = getSourceFiles(srcDir)

  it("verifies zero fetch() calls in all extension source files", () => {
    const filesWithFetch: string[] = []

    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, "utf8")
      // Check for fetch( but exclude comments or type declarations
      const lines = content.split("\n")
      lines.forEach((line, lineNum) => {
        const trimmed = line.trim()
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) return
        if (/\bfetch\s*\(/.test(trimmed)) {
          filesWithFetch.push(`${path.basename(file)}:${lineNum + 1}: ${trimmed}`)
        }
      })
    }

    expect(filesWithFetch).toEqual([])
  })

  it("verifies zero XMLHttpRequest, WebSocket, or sendBeacon instances in source files", () => {
    const filesWithNetwork: string[] = []

    for (const file of sourceFiles) {
      const content = fs.readFileSync(file, "utf8")
      const lines = content.split("\n")
      lines.forEach((line, lineNum) => {
        const trimmed = line.trim()
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) return
        if (
          /\bXMLHttpRequest\b/.test(trimmed) ||
          /\bWebSocket\b/.test(trimmed) ||
          /\bsendBeacon\b/.test(trimmed)
        ) {
          filesWithNetwork.push(`${path.basename(file)}:${lineNum + 1}: ${trimmed}`)
        }
      })
    }

    expect(filesWithNetwork).toEqual([])
  })

  it("verifies package.json manifest declares zero optional_host_permissions and no scripting permission", () => {
    const pkgPath = path.resolve(__dirname, "../package.json")
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))

    expect(pkg.manifest.optional_host_permissions).toBeUndefined()
    expect(pkg.manifest.permissions).not.toContain("scripting")
    expect(pkg.manifest.permissions).toEqual(["storage", "activeTab", "sidePanel"])
  })
})

