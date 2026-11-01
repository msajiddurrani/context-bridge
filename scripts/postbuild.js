const fs = require("fs")
const path = require("path")

const buildDir = path.resolve(__dirname, "../build/chrome-mv3-prod")
const liveTestDir = path.resolve(__dirname, "../../cb-live-test")
const manifestPath = path.join(buildDir, "manifest.json")

if (!fs.existsSync(manifestPath)) {
  console.warn("[Postbuild] manifest.json not found at", manifestPath)
  process.exit(0)
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
const buildFiles = fs.readdirSync(buildDir)

const navMonitorFile = buildFiles.find(
  (f) => f.startsWith("navigation-monitor.") && f.endsWith(".js")
)

if (navMonitorFile) {
  if (!Array.isArray(manifest.content_scripts)) {
    manifest.content_scripts = []
  }

  const alreadyAdded = manifest.content_scripts.some(
    (cs) => cs.js && cs.js.includes(navMonitorFile)
  )

  if (!alreadyAdded) {
    manifest.content_scripts.unshift({
      matches: [
        "https://claude.ai/*",
        "https://chatgpt.com/*",
        "https://*.chatgpt.com/*",
        "https://gemini.google.com/*"
      ],
      js: [navMonitorFile],
      world: "MAIN",
      run_at: "document_start"
    })
    console.log(
      `[Postbuild] Added ${navMonitorFile} (world: MAIN) to content_scripts`
    )
  }

  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8")
} else {
  console.warn("[Postbuild] navigation-monitor bundle not found in build dir")
}

// Synchronize to cb-live-test directory
if (fs.existsSync(liveTestDir)) {
  try {
    function copyFolderSync(from, to) {
      if (!fs.existsSync(to)) fs.mkdirSync(to, { recursive: true })
      for (const item of fs.readdirSync(from)) {
        const fromPath = path.join(from, item)
        const toPath = path.join(to, item)
        if (fs.lstatSync(fromPath).isDirectory()) {
          copyFolderSync(fromPath, toPath)
        } else {
          fs.copyFileSync(fromPath, toPath)
        }
      }
    }
    copyFolderSync(buildDir, liveTestDir)
    console.log("[Postbuild] Synchronized build to cb-live-test")
  } catch (err) {
    console.warn("[Postbuild] Failed to sync to cb-live-test:", err.message)
  }
}

