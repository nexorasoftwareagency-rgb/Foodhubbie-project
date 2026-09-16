# Pending Work Tracker — Four-Stage Review Process

**Purpose:** Track code changes, audits, and fixes through a structured four-stage lifecycle:
`Reviewing` → `Verified` → `OK` → `Done`

This file ensures no item drifts back into "speculative need" and provides a single source of
truth for what has been addressed, what is in flight, and what requires follow-up.

---

## ⚠️ Mandatory Rule: Update Pending Work After Every Action

**Never proceed without updating this file.** After every command, input, or output that
modifies code, configuration, or infrastructure:

1. **Update** the item's `status` field (advance one stage: `Reviewing` → `Verified` → `OK` → `Done`)
2. **Verify** the change passes `node --check` (for JS) or equivalent for the relevant language
3. **Update** this file with the verification result, commit reference, or deployment target

**Failure to update this file after any code-changing action will be treated as an incomplete task.**
This rule applies to:
- Tool commands (edit, write, bash, etc.)
- Code reviews and diffs
- Bug fixes and feature additions
- Infrastructure changes (Firebase, EC2, package.json, etc.)
- Audit items and cross-project references

---

## Four-Stage Review Lifecycle

| Stage | Meaning | Action |
|-------|---------|--------|
| **Reviewing** | Change has been proposed/diffed; not yet validated | Add to this file with `status: in_progress`; assign reviewer or self-review |
| **Verified** | Change has been tested, lint/typecheck passes, no regressions | Move `status` to `verified`; add test command output or `node --check` result |
| **OK** | Verified + reviewed by second party (or self-review complete); ready for commit | Move `status` to `ok`; reference git commit SHA or deployment target |
| **Done** | OK + deployed/merged; no further action required | Move `status` to `done`; reference deployed URL or PR number |

**To progress an item:** update its `status` field. Do not skip stages.

---

## Current Work Items

### ✅ Build system: esmultiation for SupremeAdmin
- **File:** `tools/build.mjs`, `package.json`, `firebase.json`, `.gitignore`
- **Stage:** `ok`
- **Verified:** `npm run build:supreme` produces `SupremeAdmin/dist/` with 246KB → 170KB (31% reduction) + CSS purged 26%; `firebase.json` supreme target now serves from `SupremeAdmin/dist/`; `SupremeAdmin/dist/` added to `.gitignore`; npm scripts `build:admin`, `build:supreme`, `deploy:admin`, `deploy:supreme` added
- **Review:** Refactored `tools/build.mjs` to support `--admin` / `--supreme` CLI args via `TARGETS` map; `Promise.all` builds targets separately; shared/ directory handling conditional (only for Admin, which imports `../../shared/*`)
- **Commit:** `pending` (ready for `git add` + `git commit`)

---

### 🚧 WORK IN PROGRESS: Build system commit
- **File:** `tools/build.mjs`, `package.json`, `firebase.json`, `.gitignore`
- **Stage:** `reviewing`
- **Verified:** `npm run build:supreme` works correctly; all modified files pass `node --check`; `.gitignore` updated; scripts added
- **OK:** Ready for `git add .` + `git commit -m "build: add SupremeAdmin esbuild minification support"` + `git push`
- **Done:** After push, `npm run deploy:supreme` deploys the new SupremeAdmin hosting target

**To advance:** run `git add .` and `git commit -m "build: add SupremeAdmin esbuild minification support"` then `git push`

---

### ✅ Issue #2: TUNNEL_URL global — `let` + Firebase auto-read
- **File:** `SupremeAdmin/js/firebase-config.js:28-34`
- **Stage:** `ok`
- **Verified:** `const TUNNEL_URL` → `let TUNNEL_URL`; added `once('value')` read from `config/tunnelUrl`; fallback to hardcoded value on failure
- **Review:** Ponytail full enforcement; `let` safe because no feature file reassigns the variable; all 6 call sites read-only
- **Commit:** `4966860` (full project audit commit); `ea50d76` (ACCESS.md push)

### ✅ Issue #3: `showToast` missing import in `main.js`
- **File:** `SupremeAdmin/js/main.js:20`
- **Stage:** `ok`
- **Verified:** Added `import { showToast } from '/js/utils.js'`; line 66 `showToast("Your account is view-only — you can't add restaurants.", 'error')` now resolves
- **Review:** Module graph walk confirmed `main.js` is loaded via dynamic import from `auth.js`; no other undefined function calls in this file
- **Commit:** `4966860`

### ✅ Issue #4: `_transportLabelInternal` duplicate removed
- **File:** `SupremeAdmin/js/utils.js:277-284`
- **Stage:** `ok`
- **Verified:** Replaced `_transportLabelInternal(transport)` call in `transportBadgeHtml` with `transportLabel(transport)`; deleted the duplicate function body (lines 277-281); `grep` confirmed zero remaining references to `_transportLabelInternal` in active code
- **Review:** Dead code removal per ponytail philosophy ("deletion over addition"); `transportBadgeHtml` now calls the exported `transportLabel` directly
- **Commit:** `4966860`

### ✅ Issue #5/7: `showToast` missing import in `data-store.js`
- **File:** `SupremeAdmin/js/data-store.js:18,39`
- **Stage:** `ok`
- **Verified:** Added `import { showToast } from '/js/utils.js'` at line 18; error handler at line 39 now shows user-visible toast on connection loss instead of silently `console.error`-only
- **Review:** Error boundary fixed — `.on('value')` error callback now has working `showToast`; subscriber calls at lines 34-36 already wrapped in try/catch (no change needed)
- **Commit:** `4966860`

### ✅ Issue #6: `exportCsv` missing import in `bot-fleet-overview.js`
- **File:** `SupremeAdmin/js/features/bot-fleet-overview.js:3`
- **Stage:** `ok`
- **Verified:** Added `exportCsv` to the import from `/js/utils.js` at line 3; line 193 `exportCsv('bot-fleet', ...)` now resolves
- **Review:** Grep confirmed all functions used in file are now imported; no dead imports
- **Commit:** `4966860`

### ✅ Issue #2 (audit): `.gitignore` fix for session files
- **File:** `SupremeAdmin/js/` — not directly applicable; audit item 1 was for `bot/sessions/` in a different project
- **Stage:** `ok` (as reference)
- **Note:** Audit recommended adding `bot/sessions/` to `.gitignore` to prevent accidental commit of live WhatsApp session credentials. In this project, `SupremeAdmin/js/` session data lives in Firebase RTDB, not local files. For any future bot/whatsApp work, add `bot/sessions/` and `bot/session_data/` to `.gitignore`.

### ✅ Issue #3 (audit): Randomized delay in multi-recipient sends
- **File:** `bot/` — audit item 3 was for `status-monitor.js` `broadcastPickupAvailable()` loop with no delay between `sock.sendMessage` calls to riders
- **Stage:** `ok` (as reference)
- **Note:** Audit recommended staggering with randomized 800ms–2000ms delay between recipients to avoid WhatsApp anti-spam heuristics flagging tight send-velocity bursts. This pattern is applicable to any loop that sends to multiple JIDs. In the current SupremeAdmin work, no equivalent multi-recipient send pattern exists.

### ✅ Build system: esmultiation for SupremeAdmin
- **File:** `tools/build.mjs`, `package.json`, `firebase.json`, `.gitignore`
- **Stage:** `ok`
- **Verified:** `npm run build:supreme` produces `SupremeAdmin/dist/` with 246KB → 170KB (31% reduction) + CSS purged 26%; `firebase.json` supreme target now serves from `SupremeAdmin/dist/`; `SupremeAdmin/dist/` added to `.gitignore`; npm scripts `build:admin`, `build:supreme`, `deploy:admin`, `deploy:supreme` added
- **Review:** Refactored `tools/build.mjs` to support `--admin` / `--supreme` CLI args via `TARGETS` map; `Promise.all` builds targets separately; shared/ directory handling conditional (only for Admin, which imports `../../shared/*`)
- **Commit:** pending (ready for `git add` + `git commit`)

### ✅ Temp file cleanup
- **File:** `SupremeAdmin/js/utils.js.tmp`, `SupremeAdmin/js/features/bot-fleet-overview-temp.js`
- **Stage:** `done`
- **Verified:** Both files deleted via `Remove-Item`; `glob` confirmed zero `.tmp` or `*temp*` files remain in `SupremeAdmin/`
- **Review:** Ponytail "deletion over addition" — removing leftover artifacts from edit sessions

### ✅ Review fixes: `console.warn` + dead comment
- **File:** `SupremeAdmin/js/firebase-config.js`, `SupremeAdmin/js/utils.js`
- **Stage:** `ok`
- **Verified:** Added `console.warn('TUNNEL_URL: failed to read config/tunnelUrl, using fallback')` to `.catch(() => {})` in firebase-config.js; removed duplicate `// ---- CSV export` comment in utils.js (was followed by `// ---- formatting` — two section headers for the same category)
- **Review:** Low-severity polish items from code review; both minimal changes, zero risk

---

## Audit Reference Items (Different Project — nexorasoftwareagency-rgb/Food-Hubbie)

These are recorded for cross-project visibility but are **not action items** for the current SupremeAdmin work unless explicitly requested.

| Priority | Item | File/Context | Stage |
|----------|------|--------------|-------|
| 1 | `.gitignore` fix for `bot/sessions/` | `bot/` project, different repo | `ok` (recorded) |
| 2 | Unthrottled multi-recipient sends | `bot/status-monitor.js` | `ok` (recorded) |
| 3 | Randomized delay in `broadcastPickupAvailable()` | `bot/status-monitor.js` | `ok` (recorded) |
| 4 | Broadcast feature dead code / design before enabling | `SupremeAdmin/app.js` (noted as not live) | `ok` (recorded) |
| 5 | No account warm-up for new numbers | `bot/` project | `ok` (recorded) |
| 6 | Whole-process restarts drop all tenants | `docs/bot-operations.md` + `ecosystem.config.js` | `ok` (recorded) |
| 7 | No backup/persistence for `bot/sessions/` | `bot/` project | `ok` (recorded) |
| 8 | No read receipts/presence indicators | `bot/whatsapp-engine.js` | `ok` (recorded) |
| 9 | Baileys version drift, no update process | `bot/package.json` | `ok` (recorded) |
| 10 | Single IP for all tenants — correlation signal | infra structural, noted | `ok` (recorded) |
| 11 | POS back button redundancy | `Admin/index.html`, `Admin/js/ui.js` | `ok` (recorded) |
| 12 | Invisible text selection near bottom nav | `menu/css/app.css` | `ok` (recorded) |
| 13 | Rider broadcast unthrottled sends + warm-up pacing | `bot/utils.js`, `bot/rider.js`, `bot/index.js` | `ok` (recorded) |

---

## Item Progress Workflow Example

To mark a new item:

```markdown
### ✅ New Fix: Example change
- **File:** `path/to/file.js`
- **Stage:** `reviewing`
- **Verified:** (pending)
- **OK:** (pending)
- **Done:** (pending)
```

**To advance:** update `status` field. Example after review:

```markdown
### ✅ New Fix: Example change
- **File:** `path/to/file.js`
- **Stage:** `ok`
- **Verified:** `node --check path/to/file.js` passes; lint passes
- **OK:** self-review complete
- **Done:** merged to main, deployed
```

---

**File last updated:** `Pending-Work.md` — keep this file at the repo root. All new fixes/audits should add an entry following the format above before work begins.