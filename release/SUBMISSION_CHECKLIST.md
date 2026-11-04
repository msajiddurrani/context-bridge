# Context Bridge — Chrome Web Store Submission Checklist & Guide

This step-by-step checklist guides you through submitting **Context Bridge** to the Google Chrome Web Store Developer Dashboard.

---

## 1. Pre-Submission Verification Checklist

Before uploading the extension bundle, verify that all release invariants are satisfied:

- [x] **Zero TypeScript Errors:** Verified via `npx tsc --noEmit` (0 errors).
- [x] **100% Test Pass Rate:** Verified via `pnpm test` (38 test files / 241 unit tests passing).
- [x] **Production Bundle Compiled:** Generated via `pnpm build` in `build/chrome-mv3-prod/`.
- [x] **Postbuild Script Executed:** `navigation-monitor` with `world: MAIN` verified in `manifest.json`.
- [x] **Deployment ZIP Created:** Verified at `build/chrome-mv3-prod.zip` (0.45 MB).
- [x] **Icons Verified:** All required icons (16, 32, 48, 64, 128) present and valid.
- [x] **Zero Remote Code:** No `eval()`, `new Function()`, or external `<script src="...">` calls.
- [x] **Zero Outbound Telemetry:** No analytics, tracking pixels, or remote logging.
- [x] **Privacy Policy Up-To-Date:** Accessible at `docs/PRIVACY_POLICY.md`.

---

## 2. Chrome Web Store Developer Console Walkthrough

### Step 1: Open Developer Dashboard
1. Go to the [Chrome Web Store Developer Console](https://chrome.google.com/webstore/devconsole).
2. Sign in with your registered Google Developer account (a one-time $5 registration fee is required by Google if this is a new account).

### Step 2: Upload the Production Package
1. Click **+ New Item** in the top right.
2. Drag and drop or browse to select the production zip file:
   ```
   context-bridge/build/chrome-mv3-prod.zip
   ```
3. Wait for Chrome Web Store to validate the manifest. Once validated, you will be directed to the item configuration tabs.

### Step 3: Fill Out Store Listing
Refer to `release/CHROME_WEB_STORE_LISTING.md` for the exact copy:
- **Title:** `Context Bridge`
- **Short description:** `Cross-platform conversation and code sync across ChatGPT, Claude, and Gemini. 100% private and on-device.`
- **Detailed description:** Copy and paste the formatted text block from Section 2 of `release/CHROME_WEB_STORE_LISTING.md`.
- **Category:** Select **Productivity** (Secondary: **Developer Tools**).
- **Language:** Select **English (United States)**.

### Step 4: Upload Graphic Assets
- **Store Icon:** Upload `context-bridge/assets/icon128.png` (128x128 PNG).
- **Screenshots:** Upload at least 1 (recommended 3–5) genuine screenshots of the extension in action:
  - Resolution: **1280x800** or **640x400** (PNG or 24-bit JPEG, no transparency).
  - *Recommended Screenshots:*
    1. **Full Studio Dashboard:** Overview of saved conversations, code snippets, word counts, and search filter.
    2. **Toolbar Popup:** Clean popup interface showing active chat status, power toggle, and 1-click copy action.
    3. **Floating In-Page Overlay:** Floating "Import from..." button appearing above the ChatGPT / Claude input box.
    4. **Chrome Side Panel:** Side-by-side view with past conversation context while chatting in the main window.
- **Small Promo Tile (Optional):** 440x280 PNG.
- **Marquee Promo Tile (Optional):** 1400x560 PNG.

### Step 5: Complete the Privacy Practices Tab
Google enforces strict privacy disclosures under its Developer Program Policies:
1. **Single Purpose:** Enter the exact statement from `release/CHROME_WEB_STORE_LISTING.md`:
   > *"Context Bridge synchronizes conversation contexts, technical decisions, and verbatim code snippets across web-based AI platforms (ChatGPT, Claude, and Google Gemini)."*
2. **Permission Justifications:**
   - Copy the exact justification text for `storage`, `activeTab`, `sidePanel`, and `host_permissions` provided in Section 4 of `release/CHROME_WEB_STORE_LISTING.md`.
3. **Data Usage:**
   - Personally Identifiable Information (PII): `No`
   - Authentication info: `No`
   - Personal communications: `Yes` (Select *User Data Processed Locally* and paste the declaration from Section 5 of `release/CHROME_WEB_STORE_LISTING.md`).
   - Web history: `No`
4. **Developer Certifications:**
   - Check all three required compliance checkboxes (do not sell data, do not use unrelated data, do not determine creditworthiness).
5. **Privacy Policy Link:**
   - Provide the URL: `https://github.com/msajiddurrani/context-bridge/blob/main/docs/PRIVACY_POLICY.md`

### Step 6: Distribution & Visibility
1. Select **Public** (or **Unlisted** if conducting an initial internal pilot test).
2. Select target regions (default: **All regions**).

### Step 7: Submit for Review
1. Click **Submit for Review**.
2. Review the final summary dialog and confirm submission.
3. Review typically takes between **24 to 72 hours**. You will receive an automated email from the Chrome Web Store team when the review is completed or if questions arise.

---

## 3. Production Artifact Location

The deployable package is generated at:
```
c:\Users\MD PCT\OneDrive\Desktop\extension\context-bridge\build\chrome-mv3-prod.zip
```
Size: ~**0.45 MB** (470 KB)  
Target: **Chrome Manifest V3**  
MD5/Integrity: Verifiable via `pnpm package`

