# Master Project Deployment Guide — Food-Hubbie (v3, Agent-Executable)
> Every step includes: exact command → expected output → verification → failure handling
> Written so an autonomous coding agent (e.g. OpenCode) can execute this with minimal human interference
> Official WhatsApp Cloud API from Day 1. No Baileys. No required domain purchase. Server = bots + orchestrator + webhook only.

---

## How to use this guide (read this first, agent and human both)

Every action in this guide follows this exact pattern:
```
STEP: what to do
COMMAND: exact command to run
EXPECTED OUTPUT: what success looks like
VERIFY: a separate command that confirms it worked
IF FAILS: specific troubleshooting for the most likely failure
```
An agent should treat **VERIFY** as a hard gate — do not proceed to the next step until VERIFY passes. If VERIFY fails and IF FAILS doesn't resolve it, stop and surface the exact error to the human rather than guessing further.

---

## Agent Operating Protocol (read before starting ANY step)

### A. Required tool stack

| Tool | Role in this guide |
|---|---|
| **Bash/shell execution** | SSH into server, run every install/config command, npm, systemctl, cron |
| **Playwright MCP (browser automation)** | Post-login navigation on Meta/Cloudflare dashboards — form filling, DOM scraping of IDs/tokens, clicking through wizards. Requires a human to complete the FIRST login on each site (see table B) — reuse that authenticated browser session/profile afterward |
| **Git tool / bash git** | Clone, status, commit, `.gitignore` management |
| **Filesystem read/write tool** | Writing config files, `.env`, heredocs, editing `firebase.json` |
| **AWS CLI** (installed via bash, Section 1.5) | Instance creation, security groups, billing checks — no separate plugin needed, it's a CLI |
| **Firebase CLI** (`npm install -g firebase-tools`) | `firebase deploy`, `firebase target:apply` |
| **curl** (via bash) | Testing Graph API, webhook health — no separate HTTP plugin needed |

If any of these tools is unavailable to the agent, **stop and tell the human which is missing** rather than attempting a workaround (e.g. do not try to fake browser automation via raw curl against Meta's login form — it will fail and may trigger security flags on the account).

### B. Human-only steps — no agent, no Playwright, no exceptions

These are identity-verification checkpoints that Meta/AWS/Cloudflare deliberately restrict to a real human. An agent (with or without Playwright) must **never attempt these** — not even "just to try":

| Section | Step | Why it's blocked to automation |
|---|---|---|
| 1.1 | AWS account creation | CAPTCHA, phone OTP, payment card entry |
| 1.3 | IAM MFA setup | Physical phone authenticator QR scan |
| 4.1 | Cloudflare account signup | Email verification link click |
| 4.3 | `cloudflared tunnel login` browser auth | OAuth consent screen requires human click |
| 5.1-5.2 | Meta Developer account + App creation | Facebook login is actively hardened against automated sessions — attempting this via Playwright risks the account being flagged/locked |
| 5.5 | Permanent token generation | Requires re-entering Facebook password to reveal |
| 5.6 | App Secret reveal | Same — password re-auth checkpoint |
| 5.8 | Business Verification document submission | External human review process, no UI to automate around |
| 7.2 | Firebase service account key generation | Requires human's own Firebase Console login |

**Agent instruction**: when the guide reaches any of these steps, output a clear message to the human specifying exactly what's needed (e.g. "Please complete Section 5.5 now — generate the permanent token and provide it to me"), then **pause and wait** for the human's response before continuing. Do not skip ahead to later steps that depend on values from a skipped human step.

### C. Everything else — agent-executable (with Playwright for browser portions)

Once a human has completed the FIRST login to Meta Business Manager / Cloudflare Dashboard / Firebase Console in a browser session the agent's Playwright instance can reuse, the agent can then:
- Navigate to specific dashboard screens and read values off the page (Section 5.3's `PHONE_NUMBER_ID`/`WABA_ID`, for example)
- Fill in webhook URL + verify token fields and click Save (Section 5.7)
- Click through the Embedded Signup test flow (Section 11.4)

All server-side work (Sections 1.5 through 14, minus the human-only rows above) is fully agent-executable via bash/SSH/CLI tools with no browser involved at all.

### D. Session resilience — progress tracking (critical for long-running or interrupted sessions)

Agent context can compact or reset mid-guide. To survive this without re-doing completed work or skipping ahead incorrectly, the agent must maintain a **progress state file** on the server itself — not rely on conversation memory alone.

**IMPORTANT — path note before you create this**: Section P runs on your LOCAL machine, before AWS or the EC2 server exist at all. Section 6 later clones this same project onto the server at `/var/www/foodhubbie`. So the tracker must be created at the CURRENT project root (wherever `PROJECT_ROOT` is at the time), not hardcoded to a server path that doesn't exist yet:

```bash
# Run this as PROJECT_ROOT wherever you currently are:
# - During Section P (local machine): PROJECT_ROOT=~/food-hubbie-platform
# - From Section 6 onward (server, after clone): PROJECT_ROOT=/var/www/foodhubbie
# The file travels with the repo via git, so it's the SAME file throughout, not two separate trackers.

PROJECT_ROOT=~/food-hubbie-platform   # <- adjust this line once you're on the server, per above
cat > "$PROJECT_ROOT/DEPLOYMENT-PROGRESS.md" << 'EOF'
# Deployment Progress Tracker
# Format: [STATUS] Section.Step - description
# STATUS values: PENDING, IN_PROGRESS, VERIFIED, BLOCKED_ON_HUMAN, FAILED
# This list is sequential and matches the guide's numbering exactly - do not renumber or skip.

[PENDING] P.2 - Create blank project folder
[PENDING] P.3 - Fetch Roshani repo (code source)
[PENDING] P.4 - Fetch Food-Hubbie repo (reference only, /tmp)
[PENDING] P.5 - Add new infrastructure folders (SupremeAdmin, orchestrator, webhook-server, bot-control-api)
[PENDING] P.6 - Initialize new git repo (HUMAN REQUIRED - provide new GitHub repo URL)
[PENDING] P.7 - Final structure verification
[PENDING] P.7a - Contamination scan (confirms no Food-Hubbie code was copied)
[PENDING] 1.1 - AWS account creation (HUMAN REQUIRED)
[PENDING] 1.2 - Confirm credit + budget alert (HUMAN REQUIRED)
[PENDING] 1.3 - Secure root account MFA (HUMAN REQUIRED)
[PENDING] 1.4 - Create IAM user + access key
[PENDING] 1.5 - Install AWS CLI + configure
[PENDING] 2.1 - Create key pair, security group, launch EC2
[PENDING] 3.1 - SSH connect
[PENDING] 3.2 - System update
[PENDING] 3.3 - Node.js install
[PENDING] 3.4 - PM2 install
[PENDING] 3.5 - Redis install
[PENDING] 3.6 - Git install
[PENDING] 3.7 - Full section verification (all 6 tools confirmed together)
[PENDING] 4.1 - Cloudflare signup (HUMAN REQUIRED)
[PENDING] 4.2 - Install cloudflared
[PENDING] 4.3 - Authenticate cloudflared (HUMAN REQUIRED - browser auth)
[PENDING] 4.4 - Quick Tunnel systemd service
[PENDING] 4.5 - Auto-update webhook script (placeholders filled after Section 5)
[PENDING] 5.1 - Meta Developer account (HUMAN REQUIRED)
[PENDING] 5.2 - Create Meta App (HUMAN REQUIRED)
[PENDING] 5.3 - Add WhatsApp product, record IDs (HUMAN REQUIRED)
[PENDING] 5.4 - Test message send
[PENDING] 5.5 - Permanent token (HUMAN REQUIRED)
[PENDING] 5.6 - App Secret (HUMAN REQUIRED)
[PENDING] 5.7 - Configure webhook (BLOCKED until Section 8 is done - return here after)
[PENDING] 5.8 - Business Verification submitted (HUMAN REQUIRED, async, does not block later steps)
[PENDING] 6.1 - Project folder created on server
[PENDING] 6.2 - GitHub SSH access
[PENDING] 6.3 - Clone the NEW repo onto server (from Section P.6 - this is when the tracker itself arrives on the server, already containing P.2-P.7a's status)
[PENDING] 6.4 - Verify folder structure landed correctly
[PENDING] 7.1 - Bot dependencies installed
[PENDING] 7.2 - Firebase service account (HUMAN REQUIRED)
[PENDING] 7.3 - .env file created
[PENDING] 7.4 - .gitignore updated
[PENDING] 17-GATE - Firebase refactor complete and verified via Section 17.5's script (HUMAN REQUIRED - do not proceed to Section 8 until this passes)
[PENDING] 8.1 - Webhook server files created
[PENDING] 8.2 - Webhook server code written
[PENDING] 8.3 - Webhook server started via PM2
[PENDING] 8.4 - Test health endpoint locally
[PENDING] 8.5 - Test health endpoint through the tunnel
[PENDING] 8.6 - Meta webhook verified (return to 5.7, mark it VERIFIED too once this passes)
[PENDING] 9.1 - whatsapp-send.js helper created
[PENDING] 9.2 - bot/index.js Baileys migration (grep-checklist method, see Section 9.2)
[PENDING] 9.3 - Baileys package removed
[PENDING] 9.4 - End-to-end message test
[PENDING] 10.1 - Orchestrator dependencies
[PENDING] 10.2 - Orchestrator code written
[PENDING] 10.3 - Orchestrator started
[PENDING] 10.4 - Orchestrator end-to-end test
[PENDING] 10.5 - PM2 startup on reboot enabled
[PENDING] 11.1 - SupremeAdmin folder structure (local/CI, not server)
[PENDING] 11.2 - Firebase Hosting target added
[PENDING] 11.3 - Minimal index.html deploy test
[PENDING] 11.4 - Real dashboard pages built (one file at a time, per Section 11.4's instruction)
[PENDING] 11.4a - Restaurant Profile page + Bot Control API deployed
[PENDING] 13 - Full verify-all.sh script passes clean (all 12 automated checks OK)
EOF
```

**Why this file must NOT be gitignored**: unlike `.env` or `service-account.json` (secrets, correctly excluded in Section 7.4), `DEPLOYMENT-PROGRESS.md` contains no sensitive data — it's meant to be committed. This is what makes it travel automatically: when Section P.6 runs `git add . && git commit`, this file (already showing P.2-P.7a's real status at that point) gets committed too. When Section 6.3 later clones that repo onto the server at `/var/www/foodhubbie`, the tracker arrives already populated with Section P's history — the agent isn't starting a second, disconnected tracker on the server, it's continuing the same one.

**Note on ordering**: the `17-GATE` entry is deliberately placed between Section 7 and Section 8, not at the end where Section 17 appears in the guide's table of contents. This is intentional — Section 17.5 explicitly states Sections 8 onward should not be trusted until the Firebase refactor is verified, so the tracker reflects the true *dependency* order, not just the guide's *reading* order. Sections 12, 14, 15, 16, and 17 itself (aside from this one gate check) are reference/checklist material, not one-time setup actions, so they intentionally have no tracker entries of their own.

**After completing and VERIFYING each step**, update the corresponding line (adjust `$PROJECT_ROOT` per the same local-vs-server rule above):
```bash
sed -i 's/\[PENDING\] 3.3 -/[VERIFIED] 3.3 -/' "$PROJECT_ROOT/DEPLOYMENT-PROGRESS.md"
```
Periodically commit the updated tracker so progress survives even a full local/session loss, not just a context compact:
```bash
cd "$PROJECT_ROOT" && git add DEPLOYMENT-PROGRESS.md && git commit -m "progress: update deployment tracker" --quiet
```

**At the start of every new agent session** (including after a context compact/reset), the FIRST action must be:
```bash
# Check the server location first (most work happens there from Section 6 onward);
# fall back to the local project root if the server doesn't exist yet (still in Section P/1/2).
cat /var/www/foodhubbie/DEPLOYMENT-PROGRESS.md 2>/dev/null \
  || cat ~/food-hubbie-platform/DEPLOYMENT-PROGRESS.md 2>/dev/null \
  || echo "No progress file found anywhere - this is a genuinely fresh start, begin at Section P.2"
```
Read the file, find the first line that is NOT `[VERIFIED]`, and resume exactly there. Never skip a step marked `[PENDING]` to work on a later one, even if later steps seem more urgent — dependencies in this guide are sequential (e.g. Section 8 must complete before Section 5.7 can be verified; Section 5 must complete before Section 4.5's script can be filled in; Section 6 cannot start until Section 2 has produced a running EC2 instance).

If a line is marked `[BLOCKED_ON_HUMAN]`, the agent should re-check whether the human has since provided the needed value (ask, or check for it in the most recent conversation context) before doing anything else — do not silently skip past a blocked step to make progress elsewhere unless the guide's own dependency order genuinely allows it.

### E. The one absolute rule
**Never mark a step `[VERIFIED]` in the progress file unless its exact VERIFY command from the guide actually produced the EXPECTED OUTPUT.** A step that "looks like it probably worked" is not verified. This progress file is only trustworthy if the agent is strict about this — a false `[VERIFIED]` entry will cause every dependent later step to fail confusingly, far from the actual root cause.

### F. Reminder — codebase source discipline
Section P.0 (below) contains a strict, non-negotiable list of what may and may not be used from Food-Hubbie's repo. Re-read Section P.0 before touching any file that originated from `/tmp/foodhubbie-reference/`. When in doubt, treat it as forbidden and ask.

---

## Index

- [Section P — Project Bootstrap: Merging Roshani + Food-Hubbie into One New Project](#section-p)
  - P.1 Priorities & decisions · P.2 Create blank project · P.3 Fetch Roshani (code source)
  - P.4 Fetch Food-Hubbie (reference only) · P.5 Assemble the merged project
  - P.6 Initialize as new git repo · P.7 Final structure verification

- [Section 0 — Architecture Decisions](#section-0)
- [Section 1 — AWS Account Setup](#section-1)
- [Section 2 — EC2 Instance Creation](#section-2)
- [Section 3 — Server Preparation](#section-3)
- [Section 4 — Cloudflare Tunnel Setup](#section-4)
- [Section 5 — Meta / WhatsApp Cloud API Setup](#section-5)
- [Section 6 — Project Folder & GitHub Pull](#section-6)
- [Section 7 — Dependencies & Credentials](#section-7)
- [Section 8 — Webhook Server](#section-8)
- [Section 9 — Sending/Receiving Messages](#section-9)
- [Section 10 — Orchestrator Service](#section-10)
- [Section 11 — Supreme Admin Dual-Dashboard](#section-11)
  - 11.5 Ops & Fleet Expansion Plan (11 features) — real-time status · CSV · sparkline · filters · roles · onboarding stepper · alerting · bulk actions · ⌘K · quota · per-restaurant analytics
- [Section 12 — New Restaurant Onboarding Flow](#section-12)
- [Section 13 — Final Cross-Verification Checklist](#section-13)
- [Section 14 — Quick Command Reference](#section-14)
- [Section 15 — Pricing Decisions & Complete Costing](#section-15)
- [Section 16 — Agent Failure Recovery Matrix](#section-16)
- [Section 17 — Firebase Refactor Scope Checklist](#section-17)

---

<a name="section-p"></a>
## Section P — Project Bootstrap: Merging Roshani + Food-Hubbie into One New Project

> **Do this FIRST, before Section 1 (AWS setup).** This creates the actual codebase that everything else in this guide deploys. Starting from a blank folder means fetching TWO existing repos and combining them deliberately — not merging them wholesale, since only specific pieces of each are wanted (per the decisions below).

### P.0 — STRICT RULE: What the agent MUST and MUST NOT use (read this before P.1)

This is a hard boundary, not a preference. Follow it literally, even if Food-Hubbie's repo *looks* like it has a more polished or complete version of something Roshani has too (e.g. its own `Admin/`, `menu/`, `rider-app/`, or `bot/` folder). **Looking more complete is not a reason to use it.** The decision to use Roshani's code as the foundation has already been made by the human — the agent's job is to execute that decision, not re-evaluate it.

**✅ ALLOWED — the only things ever taken from Food-Hubbie's repo:**
- Reading `.md` files (README, architecture/design docs) for understanding the `businesses/{bid}/outlets/{oid}` schema reasoning
- Reading (never copying) any comments or docs that explain multi-tenancy design decisions
- That's the complete list. Nothing else.

**❌ FORBIDDEN — never do any of these, under any circumstance, even if it seems like it would save time:**
- `cp -r /tmp/foodhubbie-reference/Admin ...` or any variant copying Food-Hubbie's Admin dashboard into the project
- `cp -r /tmp/foodhubbie-reference/menu ...` or any variant copying Food-Hubbie's menu/webview code
- `cp -r /tmp/foodhubbie-reference/rider* ...` or any variant copying Food-Hubbie's rider app
- `cp -r /tmp/foodhubbie-reference/bot ...` or any variant copying Food-Hubbie's bot logic
- `cp -r /tmp/foodhubbie-reference/SupremeAdmin ...` or any similarly-named dashboard folder from Food-Hubbie, even though this guide also uses the name "SupremeAdmin" — **the SupremeAdmin in this project is built fresh per Section 11 of this guide, never copied from Food-Hubbie's repo even if a folder with that name exists there**
- Merging `package.json` dependencies from Food-Hubbie's repo into this project's `package.json` files
- Copying `database.rules.json` from Food-Hubbie wholesale — Section 17's refactor modifies ROSHANI's rules file, it does not replace it with Food-Hubbie's
- Adding Food-Hubbie as a git remote, submodule, or subtree of this project
- Running `git merge` or `git cherry-pick` against anything from the Food-Hubbie repo
- Copying any `.env.example`, config files, or Firebase config from Food-Hubbie

**If the agent finds itself about to run any command that copies, merges, or references a file path under `/tmp/foodhubbie-reference/` (other than reading a `.md` file for context) — STOP. Do not execute it. This is a Section 16-style STOP condition, not a judgment call.**

**If genuinely uncertain whether something is "just documentation" or "actual code being reused"**: treat it as forbidden and ask the human first. The cost of asking is low; the cost of silently mixing in Food-Hubbie's own dashboard/bot/rider code is a confused, partially-duplicated project that's hard to untangle later.



| Source repo | What we take from it | What we explicitly do NOT take |
|---|---|---|
| **Roshani** (`nexorasoftwareagency-rgb/roshani-pizza-bot`) | `bot/` (order logic, state machine — becomes the foundation, migrated per Section 9), `Admin/` (restaurant-level dashboard, unchanged), `menu/` (webview ordering, unchanged except Section 17 item 7's outlet-resolution decision), `rider-app/` (unchanged except Section 17 item 16's path updates), `database.rules.json` (base rules, restructured per Section 17), `PROJECT_LEDGER.md` + `AGENTS.md` (carry forward as living docs) | Nothing excluded — Roshani is the primary code source per your explicit decision |
| **Food-Hubbie** (`nexorasoftwareagency-rgb/Food-Hubbie`) | Only the **multi-tenancy Firebase schema concept** (`businesses/{bid}/outlets/{oid}` hierarchy) as a design reference for Section 17's refactor — read its docs/architecture notes if present, do not copy code wholesale | Its own Admin dashboard, Rider app, Menu webview, or any bot implementation — **explicitly excluded per your earlier decision**. Do not clone these folders into the merged project even if present in that repo. |
| **New, built fresh in this guide** | `SupremeAdmin/` (Section 11), `orchestrator/` (Section 10), `webhook-server/` (Section 8), `bot-control-api/` (Section 11.4a) | — |

**Priority order for this bootstrap**:
1. Roshani's code is the trunk — it works, it's tested, it's the foundation. Never treat Food-Hubbie's code as equal-priority to merge against.
2. Food-Hubbie is consulted, not merged. If its repo structure conflicts with Roshani's in any folder name, **Roshani's naming wins** — rename anything from Food-Hubbie you do bring in.
3. New infrastructure (SupremeAdmin, orchestrator, webhook-server, bot-control-api) sits alongside Roshani's existing folders as siblings, never overwriting them.

### P.2 Create the blank project folder
```bash
mkdir -p ~/food-hubbie-platform
cd ~/food-hubbie-platform
```
**VERIFY**:
```bash
pwd && ls -la
```
**EXPECTED OUTPUT**: Current directory is `~/food-hubbie-platform`, listing shows only `.` and `..` (genuinely empty).

### P.3 Fetch Roshani (the code source — clone directly INTO the new project, not to a temp folder)
```bash
cd ~/food-hubbie-platform
git clone git@github.com:nexorasoftwareagency-rgb/roshani-pizza-bot.git .
```
**VERIFY**:
```bash
ls -la
test -d bot && test -d Admin && test -d menu && test -d rider-app && echo "All 4 core folders present: OK"
test -f database.rules.json && test -f firebase.json && echo "Config files present: OK"
```
**EXPECTED OUTPUT**: Both `OK` lines print. This confirms Roshani's full codebase landed correctly as the project's foundation.

**IF FAILS**: If `test -d` fails for any folder, the clone was incomplete or the repo structure has changed — run `git log -1 --oneline` to confirm the clone actually completed, and `ls -la` to see what did land.

### P.4 Fetch Food-Hubbie (reference only — clone to a SEPARATE temp location, never directly into the project)
```bash
cd ~
git clone git@github.com:nexorasoftwareagency-rgb/Food-Hubbie.git /tmp/foodhubbie-reference
```
**VERIFY**:
```bash
ls -la /tmp/foodhubbie-reference
```
**EXPECTED OUTPUT**: Repo contents listed. This is a read-only reference, not a merge source.

**Inspect for anything genuinely worth referencing** (architecture docs, schema notes — NOT code to copy):
```bash
find /tmp/foodhubbie-reference -iname "*.md" -maxdepth 2
```
**EXPECTED OUTPUT**: A list of markdown files (README, architecture docs if present). Read these for the `businesses/{bid}/outlets/{oid}` schema reasoning to inform Section 17's refactor — do not run any command that copies files from this folder into `~/food-hubbie-platform` unless a specific file is explicitly identified as worth reusing (e.g. a well-written architecture doc you want to adapt, not copy verbatim).

**Agent instruction**: after this inspection, `/tmp/foodhubbie-reference` has served its purpose. It can be deleted (`rm -rf /tmp/foodhubbie-reference`) once P.5 is complete, or kept around for occasional reference — it should never become a git remote, submodule, or dependency of the new project.

### P.5 Assemble the merged project — add the new infrastructure folders
These don't exist yet in Roshani's repo — they're built fresh per this guide's later sections, but the folders should exist now as placeholders so the project structure is complete and self-documenting from the start:
```bash
cd ~/food-hubbie-platform
mkdir -p SupremeAdmin/js/features SupremeAdmin/css
mkdir -p orchestrator
mkdir -p webhook-server
mkdir -p bot-control-api
```
**VERIFY**:
```bash
ls -la ~/food-hubbie-platform
```
**EXPECTED OUTPUT**: Listing now shows Roshani's original folders (`bot`, `Admin`, `menu`, `rider-app`, etc.) PLUS the four new ones (`SupremeAdmin`, `orchestrator`, `webhook-server`, `bot-control-api`) as siblings.

### P.6 Initialize as a new, independent git repo (do NOT keep pushing to Roshani's original remote)
```bash
cd ~/food-hubbie-platform
rm -rf .git
git init
git add .
git commit -m "Initial commit: Roshani codebase as foundation for Food-Hubbie multi-tenant platform"
```
**VERIFY**:
```bash
git log --oneline
git remote -v
```
**EXPECTED OUTPUT**: One commit listed, `git remote -v` shows **nothing** (no remote configured yet — intentional, this is a fresh project not yet pushed anywhere).

**Human decision needed here**: create a new GitHub repo (e.g. `nexorasoftwareagency-rgb/food-hubbie-platform`) and provide its URL, then:
```bash
git remote add origin git@github.com:nexorasoftwareagency-rgb/food-hubbie-platform.git
git push -u origin main
```
**VERIFY**:
```bash
git remote -v
```
**EXPECTED OUTPUT**: `origin` listed with the new repo's URL for both fetch and push.

### P.7 Final structure verification before proceeding to Section 1
```bash
cd ~/food-hubbie-platform
echo "=== Core Roshani code (foundation) ==="
for d in bot Admin menu rider-app; do test -d "$d" && echo "[OK] $d" || echo "[MISSING] $d"; done
echo "=== New infrastructure (placeholders) ==="
for d in SupremeAdmin orchestrator webhook-server bot-control-api; do test -d "$d" && echo "[OK] $d" || echo "[MISSING] $d"; done
echo "=== Config files ==="
for f in database.rules.json firebase.json PROJECT_LEDGER.md; do test -f "$f" && echo "[OK] $f" || echo "[MISSING] $f"; done
echo "=== Confirm NOT connected to Roshani's original remote ==="
git remote -v
```
**EXPECTED OUTPUT**: All `[OK]` lines, zero `[MISSING]`. The remote (if configured per P.6) points to the NEW `food-hubbie-platform` repo, never back to `roshani-pizza-bot`.

### P.7a — Contamination scan (confirms P.0's rules were actually followed, not just stated)
```bash
cd ~/food-hubbie-platform
echo "=== Scanning for any accidental Food-Hubbie code mixing ==="

# Check 1: no file in the project should reference /tmp/foodhubbie-reference in its content or history
grep -rl "foodhubbie-reference" . --exclude-dir=.git --exclude-dir=node_modules 2>/dev/null
FOUND_REF=$?

# Check 2: git log should show no commit message mentioning copying from Food-Hubbie
git log --all --grep="Food-Hubbie" --grep="foodhubbie-reference" -i --oneline

# Check 3: confirm Food-Hubbie was never added as a remote
git remote -v | grep -i "food-hubbie\|foodhubbie" && echo "FAIL: Food-Hubbie found as a remote" || echo "OK: no Food-Hubbie remote"

# Check 4: confirm no git history shows a merge/cherry-pick from another unrelated history
git log --all --merges --oneline
```
**EXPECTED OUTPUT**:
- Check 1: no output (grep finds nothing referencing the temp path — if it DOES find something, inspect that file immediately, it likely means a doc or comment was copy-pasted verbatim rather than written fresh, which is a minor violation worth fixing even if not code)
- Check 2: no output (no commit ever needed to explain "copying from Food-Hubbie" because it never happened)
- Check 3: `OK: no Food-Hubbie remote`
- Check 4: no output (a genuinely fresh `git init` history has no merge commits at all at this stage)

**IF ANY CHECK FAILS**: Stop. Do not proceed to Section 1. Report the specific finding to the human — do not attempt to silently "clean up" a contamination issue by deleting files, since the human needs to know what happened and verify nothing important was lost or duplicated incorrectly.

**This is the gate**: only proceed to Section 1 (AWS account setup) once BOTH P.7 and P.7a are fully clean. Everything from here forward in this guide — the EC2 server, the orchestrator, the dashboards — operates on this merged project, cloned onto the server in Section 6 from this NEW repo, not from Roshani's original one, and confirmed free of any Food-Hubbie code mixing.

---


<a name="section-0"></a>
## Section 0 — Architecture Decisions

### 0.1 Fixed facts an agent must not deviate from
- WhatsApp transport: **Meta Cloud API only**. Never install or reference Baileys, `@whiskeysockets/baileys`, or QR-code login flows.
- Server hosts: **bot workers + orchestrator + webhook server ONLY**. Never serve HTML/dashboard files from this server. Never run Nginx as a web server for pages (only ever used, if at all, as a reverse proxy for the webhook — and this guide uses Cloudflare Tunnel instead, so Nginx is not installed at all in this version).
- Dashboards (Admin + SupremeAdmin): deploy **only** to Firebase Hosting, from the agent's local/CI environment, never from the EC2 server.
- Domain: **not required**. Default path is Cloudflare Quick Tunnel (Section 4, Option A). Do not purchase a domain unless explicitly instructed.
- Data structure: assumes `businesses/{bid}/outlets/{oid}/...` Firebase hierarchy already exists or is being built in parallel by the human. If it doesn't exist yet, an agent should ask before assuming field names.

### 0.2 Environment variables this entire guide depends on (canonical list)
An agent should treat this as the single source of truth for env var names — every later section references these exact names, no variations:

| Variable | Where set | Example value |
|---|---|---|
| `FIREBASE_DATABASE_URL` | `/var/www/foodhubbie/.env` | `https://your-project-default-rtdb.firebaseio.com` |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | `/var/www/foodhubbie/.env` | `/var/www/foodhubbie/bot/service-account.json` |
| `REDIS_URL` | `/var/www/foodhubbie/.env` | `redis://127.0.0.1:6379` |
| `WA_PERMANENT_TOKEN` | `/var/www/foodhubbie/.env` | System User token from Section 5.5 |
| `WA_VERIFY_TOKEN` | `/var/www/foodhubbie/.env` | Any random string, must match Meta dashboard exactly |
| `WEBHOOK_PORT` | `/var/www/foodhubbie/.env` | `5000` |
| `BUSINESS_ID` | injected per-worker by orchestrator | e.g. `biz_001` |
| `OUTLET_ID` | injected per-worker by orchestrator | e.g. `outlet_001` |
| `PHONE_NUMBER_ID` | injected per-worker by orchestrator, read from Firebase | e.g. `109876543210` |

---
<a name="section-1"></a>
## Section 1 — AWS Account Setup

> Note: account creation (1.1) requires human action — an agent cannot complete Google/AWS OTP/CAPTCHA/payment steps. Everything from 1.3 onward (IAM, MFA setup confirmation, region) can be agent-assisted via AWS CLI once initial login exists.

### 1.1 Create the AWS account (human step)
1. Browser → `https://aws.amazon.com` → **Create an AWS Account**
2. Email: the designated Gmail. Password: strong, saved in a password manager.
3. Account name: `foodhubbie-dev`
4. Account type: **Personal**
5. Contact address: fill accurately (used for billing)
6. Payment card: enter valid card
7. Phone verification: complete SMS/call OTP
8. Support plan: **Basic (Free)**
9. Wait for "Your account is now active" email

**VERIFY**: Log into `https://console.aws.amazon.com` successfully with the new credentials. You should see the AWS Console home page with no error banners.

**IF FAILS**: If login fails with "account not yet active," wait up to 24 hours — this is normal AWS provisioning delay, not an error to troubleshoot further.

### 1.2 Confirm $120 credit + set budget alert (human step, browser)
1. AWS Console → search **"Billing"** → **Credits** (left sidebar)

**VERIFY**: Credits page shows a credit entry with remaining balance close to $120.00 and a visible expiry date.

**IF FAILS**: If no credit appears, the credit may be tied to a promotional signup that requires separate redemption — check the original email/link that granted the credit for a redemption code, and enter it under **Billing → Credits → Redeem Credit**.

2. **Billing → Budgets → Create Budget** → Budget type: **Cost budget** → Amount: **$100**
3. Add alert thresholds: 50%, 80%, 100% → Add your email

**VERIFY**: Budgets page lists "foodhubbie-budget" (or your chosen name) with status "OK" and correct $100 threshold.

### 1.3 Secure the root account
1. IAM → Security recommendations → **Add MFA**
2. Use an authenticator app, scan QR, enter two consecutive codes to confirm

**VERIFY**: IAM → Users → root account row shows "MFA: Enabled" (or equivalent green check).

### 1.4 Create daily-use IAM user
1. IAM → **Users → Create User**
2. Username: `nilesh-admin`
3. Enable **"Provide user access to the AWS Management Console"**
4. Set custom password, uncheck "require password reset"  (optional — your choice)
5. Permissions: **Attach policies directly** → search and check **AdministratorAccess**
6. Create user → **save the sign-in URL** shown on the confirmation screen exactly as displayed (format: `https://<ACCOUNT-ID>.signin.aws.amazon.com/console`)

**VERIFY**: Log out of root. Log into the saved sign-in URL using `nilesh-admin` credentials. Console loads without permission errors.

**IF FAILS**: If "Access Denied" appears anywhere, re-check that `AdministratorAccess` policy is actually attached: IAM → Users → nilesh-admin → Permissions tab → should list `AdministratorAccess`.

### 1.5 Set your region + install AWS CLI (for agent-driven steps going forward)

If the agent has terminal access (its own machine, not yet the EC2 instance):
```bash
# Install AWS CLI v2 (Linux/WSL)
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install
```
**VERIFY**:
```bash
aws --version
```
**EXPECTED OUTPUT**: `aws-cli/2.x.x Python/3.x.x ...` — any 2.x version is fine.

**IF FAILS**: If `unzip` is missing: `sudo apt install -y unzip` then retry.

Configure credentials (requires an IAM Access Key — create one first):
1. Browser (human step): IAM → Users → nilesh-admin → **Security credentials tab** → **Create access key** → Use case: **Command Line Interface (CLI)** → acknowledge warning → Create → **copy both Access Key ID and Secret Access Key immediately** (secret is shown once only)

```bash
aws configure
# AWS Access Key ID: <paste>
# AWS Secret Access Key: <paste>
# Default region name: ap-south-1
# Default output format: json
```
**VERIFY**:
```bash
aws sts get-caller-identity
```
**EXPECTED OUTPUT**: JSON with `"Arn"` containing `nilesh-admin` and correct account ID.

**IF FAILS**: `InvalidClientTokenId` error means the Access Key was copied incorrectly — regenerate a new key pair and retry `aws configure`.

---
<a name="section-2"></a>
## Section 2 — EC2 Instance Creation

> This section can be done via AWS CLI (agent-executable, no browser needed) OR AWS Console (human, browser). Both paths given — agent should prefer CLI.

### 2.1 — CLI path (agent-executable, recommended)

**Step 1: Create the key pair**
```bash
aws ec2 create-key-pair \
  --key-name foodhubbie-key \
  --query 'KeyMaterial' \
  --output text > ~/.ssh/foodhubbie-key.pem
chmod 400 ~/.ssh/foodhubbie-key.pem
```
**VERIFY**:
```bash
ls -la ~/.ssh/foodhubbie-key.pem
head -1 ~/.ssh/foodhubbie-key.pem
```
**EXPECTED OUTPUT**: File exists with `-r--------` permissions, first line reads `-----BEGIN RSA PRIVATE KEY-----`.

**IF FAILS**: If the file is empty or contains an error message instead of a key, the key pair name may already exist — run `aws ec2 describe-key-pairs --key-names foodhubbie-key` to check, and either delete the old one (`aws ec2 delete-key-pair --key-name foodhubbie-key`) or use a new name.

**Step 2: Find the latest Ubuntu 24.04 AMI ID for ap-south-1**
```bash
aws ec2 describe-images \
  --owners 099720109477 \
  --filters "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-noble-24.04-amd64-server-*" \
            "Name=state,Values=available" \
  --query 'reverse(sort_by(Images, &CreationDate))[:1].ImageId' \
  --region ap-south-1 \
  --output text
```
**EXPECTED OUTPUT**: An AMI ID like `ami-0abcdef1234567890`. Save this value — needed in Step 4.

**IF FAILS**: Empty output means the filter pattern didn't match — Canonical (Ubuntu's publisher, owner ID `099720109477`) occasionally changes naming patterns. Fallback: search manually at `https://cloud-images.ubuntu.com/locator/ec2/` filtering for `ap-south-1` + `24.04` + `amd64`.

**Step 3: Create the security group**
```bash
aws ec2 create-security-group \
  --group-name foodhubbie-sg \
  --description "SSH only - Food-Hubbie server" \
  --region ap-south-1 \
  --query 'GroupId' --output text
```
**EXPECTED OUTPUT**: A security group ID like `sg-0abcdef1234567890`. Save this value.

Add the SSH rule, scoped to your current public IP:
```bash
MY_IP=$(curl -s https://checkip.amazonaws.com)
aws ec2 authorize-security-group-ingress \
  --group-id <SG-ID-FROM-ABOVE> \
  --protocol tcp --port 22 \
  --cidr "${MY_IP}/32" \
  --region ap-south-1
```
**VERIFY**:
```bash
aws ec2 describe-security-groups --group-ids <SG-ID> --region ap-south-1 \
  --query 'SecurityGroups[0].IpPermissions'
```
**EXPECTED OUTPUT**: JSON showing one rule, port 22, your IP with `/32`.

**Step 4: Launch the instance**
```bash
aws ec2 run-instances \
  --image-id <AMI-ID-FROM-STEP-2> \
  --instance-type t3.small \
  --key-name foodhubbie-key \
  --security-group-ids <SG-ID-FROM-STEP-3> \
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":30,"VolumeType":"gp3"}}]' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=foodhubbie-server}]' \
  --region ap-south-1 \
  --query 'Instances[0].InstanceId' \
  --output text
```
**EXPECTED OUTPUT**: An instance ID like `i-0abcdef1234567890`. Save this value.

**Step 5: Wait for it to be running, then get the public IP**
```bash
aws ec2 wait instance-running --instance-ids <INSTANCE-ID> --region ap-south-1
aws ec2 describe-instances --instance-ids <INSTANCE-ID> --region ap-south-1 \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text
```
**VERIFY**: A valid public IP is returned (e.g. `13.234.56.78`), not `None`.

**IF FAILS**: If `PublicIpAddress` returns `None`, the subnet used doesn't auto-assign public IPs — check `aws ec2 describe-subnets --region ap-south-1` for `MapPublicIpOnLaunch: true` subnets, or explicitly pass `--subnet-id <subnet-with-public-ip>` on relaunch.

### 2.2 — Console path (human, browser — if not using CLI)
1. EC2 → **Launch Instance** → Name: `foodhubbie-server`
2. AMI: **Ubuntu Server 24.04 LTS**
3. Instance type: **t3.small**
4. Key pair: **Create new** → `foodhubbie-key` → RSA → `.pem` → download → move to `~/.ssh/foodhubbie-key.pem` → `chmod 400`
5. Network: Edit → Security group: create new, **only** SSH/22/My IP
6. Storage: 30 GB, gp3
7. **Launch Instance**

**VERIFY**: Instance list shows state `Running`, note the Public IPv4 address from the instance details page.

---
<a name="section-3"></a>
## Section 3 — Server Preparation

### 3.1 Connect via SSH
```bash
chmod 400 ~/.ssh/foodhubbie-key.pem
ssh -o StrictHostKeyChecking=accept-new -i ~/.ssh/foodhubbie-key.pem ubuntu@<PUBLIC-IP>
```
**VERIFY**: Prompt changes to `ubuntu@ip-172-31-x-x:~$`.

**IF FAILS**:
- `Connection timed out` → security group SSH rule doesn't include your current IP (it may have changed since Section 2). Re-run: `curl -s https://checkip.amazonaws.com` and update the security group rule with `aws ec2 authorize-security-group-ingress`.
- `Permission denied (publickey)` → wrong key file or wrong username. Ubuntu AMIs use username `ubuntu`, not `ec2-user` or `root`.
- `UNPROTECTED PRIVATE KEY FILE` warning → run `chmod 400 ~/.ssh/foodhubbie-key.pem` again, permissions may have reset.

### 3.2 Update system
```bash
sudo apt update && sudo apt upgrade -y
```
**VERIFY**:
```bash
echo $?
```
**EXPECTED OUTPUT**: `0` (exit code zero means success).

### 3.3 Install Node.js v20 LTS
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```
**VERIFY**:
```bash
node --version && npm --version
```
**EXPECTED OUTPUT**: `v20.x.x` and an `npm` version like `10.x.x`.

**IF FAILS**: If `node --version` shows a different major version (e.g. v18), an old NodeSource repo may be cached. Run `sudo apt remove -y nodejs && sudo apt autoremove -y` then repeat the curl/install commands.

### 3.4 Install PM2
```bash
sudo npm install -g pm2
```
**VERIFY**:
```bash
pm2 --version
```
**EXPECTED OUTPUT**: A version number like `5.x.x`, no error.

### 3.5 Install Redis
```bash
sudo apt install -y redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server
```
**VERIFY**:
```bash
redis-cli ping
sudo systemctl is-active redis-server
```
**EXPECTED OUTPUT**: `PONG` then `active`.

**IF FAILS**: If `redis-cli ping` hangs or errors, check `sudo systemctl status redis-server` for the actual error — most common cause is a port conflict; confirm nothing else is on 6379 with `sudo lsof -i :6379`.

### 3.6 Install Git
```bash
sudo apt install -y git
```
**VERIFY**:
```bash
git --version
```
**EXPECTED OUTPUT**: `git version 2.x.x`.

### 3.7 Full section verification (run all at once before proceeding)
```bash
echo "Node: $(node --version)"
echo "NPM: $(npm --version)"
echo "PM2: $(pm2 --version)"
echo "Redis: $(redis-cli ping)"
echo "Git: $(git --version)"
```
**EXPECTED OUTPUT**: All five lines populated with no `command not found` errors. Do not proceed to Section 4 until this is clean.

---
<a name="section-4"></a>
## Section 4 — Cloudflare Tunnel Setup (free HTTPS, no domain required)

### 4.1 Create a free Cloudflare account (human step — CAPTCHA/email verification)
1. Browser → `https://dash.cloudflare.com/sign-up`
2. Sign up with the designated Gmail
3. Verify email (click link sent to inbox)

**VERIFY**: Login at `https://dash.cloudflare.com` succeeds, dashboard loads.

### 4.2 Install cloudflared on the server (agent-executable)
```bash
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
```
**VERIFY**:
```bash
cloudflared --version
```
**EXPECTED OUTPUT**: `cloudflared version 202x.x.x ...`

**IF FAILS**: `dpkg: dependency problems` → run `sudo apt --fix-broken install -y` then retry `sudo dpkg -i cloudflared.deb`.

### 4.3 Authenticate cloudflared (human step — browser login required)
```bash
cloudflared tunnel login
```
**EXPECTED OUTPUT**: Prints a URL starting with `https://dash.cloudflare.com/argotunnel?...`

**Human action**: open this URL in a browser (any device), log into Cloudflare, click **Authorize**.

**VERIFY** (back on server, after authorizing in browser):
```bash
ls -la ~/.cloudflared/cert.pem
```
**EXPECTED OUTPUT**: File exists, non-zero size.

**IF FAILS**: If the command hangs indefinitely after printing the URL, the terminal session may have lost network connectivity mid-auth — press Ctrl+C and re-run `cloudflared tunnel login`.

### 4.4 — RECOMMENDED PATH: Quick Tunnel as permanent systemd service (₹0, no domain)

**Step 1: Create the systemd service file**
```bash
sudo tee /etc/systemd/system/cloudflared-quick.service > /dev/null << 'EOF'
[Unit]
Description=Cloudflare Quick Tunnel for Food-Hubbie Webhook
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/cloudflared tunnel --url http://localhost:5000 --logfile /var/log/cloudflared-quick.log
Restart=always
RestartSec=5
User=ubuntu

[Install]
WantedBy=multi-user.target
EOF
```
**VERIFY**:
```bash
sudo cat /etc/systemd/system/cloudflared-quick.service | head -1
```
**EXPECTED OUTPUT**: `[Unit]` (confirms the heredoc wrote correctly, no shell variable interpolation errors).

**IF FAILS**: If `cloudflared` binary isn't at `/usr/local/bin/cloudflared`, find its actual path first with `which cloudflared` and substitute the correct path in `ExecStart`.

**Step 2: Enable and start**
```bash
sudo systemctl daemon-reload
sudo systemctl enable cloudflared-quick
sudo systemctl start cloudflared-quick
```
**VERIFY**:
```bash
sudo systemctl status cloudflared-quick --no-pager
```
**EXPECTED OUTPUT**: `Active: active (running)` in green/highlighted text.

**IF FAILS**: `Active: failed` → run `sudo journalctl -u cloudflared-quick -n 50 --no-pager` to see the actual error. Most common cause: port 5000 isn't listening yet (that's expected at this stage — the webhook server isn't built until Section 8. The tunnel will still start and connect successfully even with nothing listening on 5000 yet; it just won't route real traffic until Section 8 is done).

**Step 3: Extract the public URL**
```bash
sleep 5
grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' /var/log/cloudflared-quick.log | tail -1
```
**EXPECTED OUTPUT**: A URL like `https://random-two-words-1234.trycloudflare.com`

**VERIFY** (confirm it resolves publicly):
```bash
curl -s -o /dev/null -w "%{http_code}" https://random-two-words-1234.trycloudflare.com
```
**EXPECTED OUTPUT**: `404` is actually correct/expected here — it confirms the tunnel is live and reachable, just that nothing is listening on port 5000 yet (Section 8 fixes that). A connection timeout or `000` means the tunnel itself isn't working — re-check Step 2.

**Save this URL** — needed for Meta webhook configuration in Section 5.6. It will be referred to as `<TUNNEL_URL>` for the rest of this guide.

### 4.5 Auto-update script (keeps Meta's webhook pointed correctly even if the URL ever changes)
```bash
mkdir -p /var/www/foodhubbie/webhook-server
sudo tee /var/www/foodhubbie/webhook-server/update-webhook-url.sh > /dev/null << 'EOF'
#!/bin/bash
LOGFILE="/var/log/cloudflared-quick.log"
STATEFILE="/var/www/foodhubbie/.last-tunnel-url"
WA_APP_ID="__REPLACE_WITH_META_APP_ID__"
WA_APP_SECRET="__REPLACE_WITH_META_APP_SECRET__"
WA_VERIFY_TOKEN="__REPLACE_WITH_VERIFY_TOKEN__"

CURRENT_URL=$(grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' "$LOGFILE" | tail -1)
LAST_URL=$(cat "$STATEFILE" 2>/dev/null)

if [ "$CURRENT_URL" != "$LAST_URL" ] && [ -n "$CURRENT_URL" ]; then
  echo "$(date): Tunnel URL changed: $LAST_URL -> $CURRENT_URL"
  curl -s -X POST "https://graph.facebook.com/v19.0/${WA_APP_ID}/subscriptions" \
    -H "Content-Type: application/json" \
    -d "{\"object\":\"whatsapp_business_account\",\"callback_url\":\"${CURRENT_URL}/webhook\",\"verify_token\":\"${WA_VERIFY_TOKEN}\",\"fields\":\"messages\"}" \
    -u "${WA_APP_ID}|${WA_APP_SECRET}"
  echo "$CURRENT_URL" > "$STATEFILE"
fi
EOF
chmod +x /var/www/foodhubbie/webhook-server/update-webhook-url.sh
```
**IMPORTANT — agent must replace 3 placeholders** in the script above before it works: `__REPLACE_WITH_META_APP_ID__`, `__REPLACE_WITH_META_APP_SECRET__`, `__REPLACE_WITH_VERIFY_TOKEN__` — these values don't exist until Section 5 is completed. Come back to this step after Section 5.

**VERIFY (after replacing placeholders)**:
```bash
grep -c "__REPLACE" /var/www/foodhubbie/webhook-server/update-webhook-url.sh
```
**EXPECTED OUTPUT**: `0` (zero remaining placeholders — confirms all three were replaced).

**Schedule it to run every 5 minutes**:
```bash
(crontab -l 2>/dev/null; echo "*/5 * * * * /var/www/foodhubbie/webhook-server/update-webhook-url.sh >> /var/log/webhook-url-update.log 2>&1") | crontab -
```
**VERIFY**:
```bash
crontab -l | grep update-webhook-url
```
**EXPECTED OUTPUT**: The cron line appears exactly as added.

### 4.6 Alternative — Option B: paid domain via Cloudflare Registrar (skip unless explicitly requested)
Only pursue this if the human explicitly asks for a permanent branded domain. Steps:
1. Cloudflare Dashboard → **Domain Registration → Register Domain** → purchase (~$9-12/year at cost)
2. DNS → Add record → Type `CNAME`, Name `webhook`, Target `<TUNNEL-ID>.cfargotunnel.com`, Proxy ON
3. Create a **named tunnel** instead of Quick Tunnel:
```bash
cloudflared tunnel create foodhubbie-webhook
```
**VERIFY**:
```bash
cloudflared tunnel list
```
**EXPECTED OUTPUT**: Table listing `foodhubbie-webhook` with a UUID.

4. Configure `~/.cloudflared/config.yml`:
```bash
TUNNEL_ID=$(cloudflared tunnel list | grep foodhubbie-webhook | awk '{print $1}')
sudo tee ~/.cloudflared/config.yml > /dev/null << EOF
tunnel: ${TUNNEL_ID}
credentials-file: /home/ubuntu/.cloudflared/${TUNNEL_ID}.json
ingress:
  - hostname: webhook.yourdomain.com
    service: http://localhost:5000
  - service: http_status:404
EOF
```
5. Route DNS to the tunnel:
```bash
cloudflared tunnel route dns foodhubbie-webhook webhook.yourdomain.com
```
6. Run as a service:
```bash
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared
```
**VERIFY**:
```bash
curl -s -o /dev/null -w "%{http_code}" https://webhook.yourdomain.com
```
**EXPECTED OUTPUT**: `404` (tunnel reachable, nothing on port 5000 yet — same as Option A verification logic).

---
<a name="section-5"></a>
## Section 5 — Meta / WhatsApp Cloud API Setup

> This entire section is human-driven (Meta's console has no CLI/API for initial app creation and OAuth-based setup). Agent's job here is to relay exact values collected from the human back into config files.

### 5.1 Create Meta Developer account (human, browser)
1. `https://developers.facebook.com` → log in with Facebook account → **Get Started** → accept terms

**VERIFY**: `https://developers.facebook.com/apps` loads without redirect to onboarding.

### 5.2 Create Meta App (human, browser)
1. **My Apps → Create App**
2. Use case: **Other** → **Business**
3. App name: `Food-Hubbie WhatsApp`
4. Create or link a **Business Portfolio**

**VERIFY**: App dashboard loads at `https://developers.facebook.com/apps/<APP_ID>/`. **Record this `APP_ID`** — visible in the URL and in App Settings → Basic.

### 5.3 Add WhatsApp product (human, browser)
1. App dashboard → find **WhatsApp** → **Set up**
2. Meta auto-creates a test number

**Record these three values exactly as shown on this screen**:
- `PHONE_NUMBER_ID` (test number's ID, not the phone number itself)
- `WABA_ID` (WhatsApp Business Account ID)
- `TEMPORARY_ACCESS_TOKEN` (valid 24 hours only — do not use this for the permanent `.env` value)

### 5.4 Send a test message (agent-executable, confirms API access works)
```bash
curl -X POST "https://graph.facebook.com/v19.0/<PHONE_NUMBER_ID>/messages" \
  -H "Authorization: Bearer <TEMPORARY_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "messaging_product": "whatsapp",
    "to": "<YOUR_OWN_NUMBER_WITH_COUNTRY_CODE_NO_PLUS>",
    "type": "text",
    "text": { "body": "Food-Hubbie test — API working" }
  }'
```
**EXPECTED OUTPUT**: JSON response containing `"messages":[{"id":"wamid...."}]`.

**VERIFY**: Message physically arrives on the target WhatsApp within ~10 seconds.

**IF FAILS**:
- `"error":{"code":100,...}` mentioning recipient → the target number must be added as a **test recipient** first: App dashboard → WhatsApp → API Setup → "To" field → **Manage phone number list** → add the number → resend.
- `"error":{"code":190,...}` → token expired (>24h old) or malformed — regenerate from the WhatsApp → API Setup screen and retry.
- Number format error → strip any `+`, spaces, or leading zeros; format is countrycode+number with no separators, e.g. `919999999999`.

### 5.5 Generate a permanent System User access token (human, browser)
1. `https://business.facebook.com/settings` → **Users → System Users → Add**
2. Name: `foodhubbie-bot-system-user`, Role: **Admin**
3. **Add Assets** → select the WhatsApp app from 5.2 → grant **Full Control**
4. **Generate New Token** → select the app → check both `whatsapp_business_messaging` and `whatsapp_business_management`
5. **Copy the token immediately — shown once only.**

**VERIFY** (agent-executable, confirms the permanent token actually works):
```bash
curl -s -X GET "https://graph.facebook.com/v19.0/<PHONE_NUMBER_ID>?fields=id,display_phone_number" \
  -H "Authorization: Bearer <PERMANENT_TOKEN>"
```
**EXPECTED OUTPUT**: JSON with `"id"` matching your `PHONE_NUMBER_ID`, no `"error"` key.

**Record**: `WA_PERMANENT_TOKEN` = this token. This is what goes into `.env` (Section 7.3), never the temporary one.

### 5.6 Also record your App Secret (needed for the auto-update script in Section 4.5)
1. App dashboard → **Settings → Basic** → **App Secret** → click **Show** (may require re-entering your Facebook password)

**Record**: `WA_APP_SECRET` = this value. Go back to Section 4.5 now and replace the placeholder in `update-webhook-url.sh` with `<APP_ID>` (from 5.2), `<APP_SECRET>` (this value), and a `WA_VERIFY_TOKEN` you invent now (any random string, e.g. generate one):
```bash
openssl rand -hex 16
```
**EXPECTED OUTPUT**: A 32-character random hex string — use this as `WA_VERIFY_TOKEN`, save it, it must match exactly in both the Meta dashboard (Step 5.7 below) and your `.env`/script files.

### 5.7 Configure the webhook (human, browser — requires the tunnel from Section 4 to already be running)
1. App dashboard → **WhatsApp → Configuration**
2. Callback URL: `<TUNNEL_URL>/webhook` (the URL saved in Section 4.4 Step 3)
3. Verify Token: paste the exact string generated in 5.6
4. Click **Verify and Save**

**VERIFY**: Green checkmark / "Webhook verified" confirmation appears in the Meta dashboard immediately. (This works because Section 8's webhook server, once running, responds to Meta's verification GET request — **if Section 8 isn't done yet, this step will fail; complete Section 8 first, then return here.**)

5. Under **Webhook fields**, click **Manage** → subscribe to **messages** only

**VERIFY**: The `messages` field shows "Subscribed" status.

### 5.8 Start Business Verification (human, browser — runs in background, doesn't block anything else)
1. Business Settings → **Business Info → Start Verification**
2. Requires: legal business name, Udyam/GST registration doc, business address proof, a website with matching details

**Note for agent**: this step has no immediate verification command — it's a multi-day external review process. Do not block subsequent sections on this completing; test-number messaging works throughout the wait.

---
<a name="section-6"></a>
## Section 6 — Project Folder Creation & GitHub Pull

### 6.1 Create the project directory
```bash
sudo mkdir -p /var/www/foodhubbie
sudo chown -R ubuntu:ubuntu /var/www/foodhubbie
cd /var/www/foodhubbie
```
**VERIFY**:
```bash
ls -ld /var/www/foodhubbie
whoami
```
**EXPECTED OUTPUT**: Directory owned by `ubuntu:ubuntu`, current user is `ubuntu`.

### 6.2 GitHub SSH access
```bash
ssh-keygen -t ed25519 -C "foodhubbie-server" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```
**EXPECTED OUTPUT**: A single line starting with `ssh-ed25519 AAAA...`.

**Human action**: copy this output → GitHub → **Settings → SSH and GPG keys → New SSH key** → paste → **Add SSH key**.

**VERIFY** (agent-executable, confirms GitHub accepted the key):
```bash
ssh -T git@github.com
```
**EXPECTED OUTPUT**: `Hi <your-github-username>! You've successfully authenticated, but GitHub does not provide shell access.`

**IF FAILS**: `Permission denied (publickey)` → the key wasn't added correctly, or the wrong key file is being used. Confirm with `ssh -i ~/.ssh/id_ed25519 -T git@github.com` explicitly.

### 6.3 Clone the repository (the NEW merged repo from Section P — not the original Roshani repo)
```bash
cd /var/www/foodhubbie
git clone git@github.com:nexorasoftwareagency-rgb/food-hubbie-platform.git .
```
> **This must be the repo URL you created in Section P.6** — the merged project containing Roshani's code plus the new `SupremeAdmin/`, `orchestrator/`, `webhook-server/`, `bot-control-api/` folders and the `DEPLOYMENT-PROGRESS.md` tracker. Cloning the original `roshani-pizza-bot` repo here would skip Section P entirely and leave you without those new folders or the tracker's history.

**VERIFY (confirms this is the right repo, not the original)**:
```bash
test -d SupremeAdmin && test -d orchestrator && test -d webhook-server && test -d bot-control-api && echo "Correct repo: OK"
test -f DEPLOYMENT-PROGRESS.md && echo "Tracker arrived with the clone: OK"
```
**EXPECTED OUTPUT**: Both `OK` lines. If either is missing, this cloned the wrong repo (likely the original Roshani-only one) — stop, verify the URL against what was created in Section P.6, and re-clone.

**VERIFY**:
```bash
git status
git log -1 --oneline
```
**EXPECTED OUTPUT**: `On branch main, nothing to commit, working tree clean` and a recent commit hash/message.

**IF FAILS**: `fatal: destination path '.' already exists and is not an empty directory` → the folder isn't empty (retry from a truly empty dir): `rm -rf /var/www/foodhubbie/* /var/www/foodhubbie/.[!.]*` then retry clone (only if certain nothing important is there).

### 6.4 Verify folder structure landed correctly
```bash
ls -la /var/www/foodhubbie
test -f /var/www/foodhubbie/database.rules.json && echo "rules: OK"
test -f /var/www/foodhubbie/PROJECT_LEDGER.md && echo "ledger: OK"
test -d /var/www/foodhubbie/bot && echo "bot folder: OK"
```
**EXPECTED OUTPUT**: All three `OK` lines print. If any is missing, the clone is incomplete or the repo structure differs from expected — stop and report to human rather than guessing paths.

---

<a name="section-7"></a>
## Section 7 — Dependencies & Credentials

### 7.1 Install bot dependencies
```bash
cd /var/www/foodhubbie/bot
npm install
```
**VERIFY**:
```bash
echo $?
ls node_modules | wc -l
```
**EXPECTED OUTPUT**: Exit code `0`, and `node_modules` contains a large number of folders (typically 200+).

**IF FAILS**: `EACCES` permission errors → the folder isn't owned by `ubuntu` — run `sudo chown -R ubuntu:ubuntu /var/www/foodhubbie/bot` then retry.

### 7.2 Firebase service account (human step on LOCAL machine, then transfer)
1. **Local machine browser**: Firebase Console → Project Settings → Service Accounts → **Generate new private key** → downloads a `.json` file

**Transfer to server** (run from LOCAL machine terminal, not SSH'd into the server):
```bash
scp -i ~/.ssh/foodhubbie-key.pem ~/Downloads/<downloaded-file-name>.json ubuntu@<PUBLIC-IP>:/var/www/foodhubbie/bot/service-account.json
```
**VERIFY** (back on the server via SSH):
```bash
test -f /var/www/foodhubbie/bot/service-account.json && echo "present"
python3 -c "import json; d=json.load(open('/var/www/foodhubbie/bot/service-account.json')); print('valid JSON, project_id:', d.get('project_id'))"
```
**EXPECTED OUTPUT**: `present`, then `valid JSON, project_id: <your-firebase-project-id>`.

**IF FAILS**: `json.decoder.JSONDecodeError` → the scp transfer was interrupted or corrupted — re-run the scp command.

### 7.3 Create the environment file
```bash
cd /var/www/foodhubbie
cat > .env << 'EOF'
FIREBASE_DATABASE_URL=https://your-project-default-rtdb.firebaseio.com
FIREBASE_SERVICE_ACCOUNT_PATH=/var/www/foodhubbie/bot/service-account.json
REDIS_URL=redis://127.0.0.1:6379
WA_PERMANENT_TOKEN=REPLACE_WITH_SECTION_5.5_TOKEN
WA_VERIFY_TOKEN=REPLACE_WITH_SECTION_5.6_TOKEN
WEBHOOK_PORT=5000
BOT_CONTROL_PORT=4000
EOF
```
**Agent must replace** `your-project-default-rtdb.firebaseio.com` (actual Firebase DB URL, visible in Firebase Console → Realtime Database), `REPLACE_WITH_SECTION_5.5_TOKEN` (from Section 5.5), and `REPLACE_WITH_SECTION_5.6_TOKEN` (from Section 5.6) with real values before proceeding.

**VERIFY**:
```bash
grep -c "REPLACE_WITH" /var/www/foodhubbie/.env
```
**EXPECTED OUTPUT**: `0` — confirms no placeholder text remains.

```bash
chmod 600 /var/www/foodhubbie/.env
```
**VERIFY**:
```bash
ls -l /var/www/foodhubbie/.env
```
**EXPECTED OUTPUT**: `-rw-------` permissions (only the `ubuntu` user can read this file — protects your tokens).

### 7.4 Add to .gitignore (critical — prevents accidentally committing secrets)
```bash
cd /var/www/foodhubbie
cat >> .gitignore << 'EOF'
service-account.json
.env
.env.*
node_modules/
EOF
```
**VERIFY**:
```bash
git status --ignored | grep -E "service-account.json|\.env"
```
**EXPECTED OUTPUT**: Both files listed under ignored files, confirming git will never stage them.

---
<a name="section-8"></a>
## Section 8 — Webhook Server

### 8.1 Create the webhook server files
```bash
mkdir -p /var/www/foodhubbie/webhook-server
cd /var/www/foodhubbie/webhook-server
npm init -y
npm install express firebase-admin redis dotenv
```
**VERIFY**:
```bash
test -f package.json && echo "package.json: OK"
node -e "require('express'); require('firebase-admin'); require('redis'); require('dotenv'); console.log('all modules load OK')"
```
**EXPECTED OUTPUT**: `package.json: OK` then `all modules load OK` with no errors.

### 8.2 Write the server code
```bash
cat > /var/www/foodhubbie/webhook-server/index.js << 'EOF'
require('dotenv').config({ path: '/var/www/foodhubbie/.env' });
const express = require('express');
const admin = require('firebase-admin');
const { createClient } = require('redis');

const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const app = express();
app.use(express.json());

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
    console.log('Webhook verified successfully by Meta.');
    return res.status(200).send(challenge);
  }
  console.warn('Webhook verification FAILED - token mismatch or wrong mode.');
  res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0]?.value;
    const phoneNumberId = change?.metadata?.phone_number_id;
    const message = change?.messages?.[0];
    if (!phoneNumberId || !message) return;

    const routingSnap = await admin.database()
      .ref(`phoneNumberIndex/${phoneNumberId}`).get();
    const routing = routingSnap.val();
    if (!routing) {
      console.warn('No routing found for phone_number_id:', phoneNumberId);
      return;
    }

    const redis = createClient({ url: process.env.REDIS_URL });
    await redis.connect();
    await redis.publish(
      `bot-inbox:${routing.businessId}:${routing.outletId}`,
      JSON.stringify(message)
    );
    await redis.quit();
    console.log(`Routed message to bot-inbox:${routing.businessId}:${routing.outletId}`);
  } catch (err) {
    console.error('Webhook processing error:', err);
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok', time: Date.now() }));

const PORT = process.env.WEBHOOK_PORT || 5000;
app.listen(PORT, () => console.log(`Webhook server listening on ${PORT}`));
EOF
```
**VERIFY**:
```bash
node --check /var/www/foodhubbie/webhook-server/index.js
```
**EXPECTED OUTPUT**: No output at all (silence = valid syntax). Any output indicates a syntax error.

### 8.3 Start it with PM2
```bash
cd /var/www/foodhubbie/webhook-server
pm2 start index.js --name webhook-server
pm2 save
```
**VERIFY**:
```bash
pm2 describe webhook-server | grep status
```
**EXPECTED OUTPUT**: `status : online`

```bash
sleep 2
pm2 logs webhook-server --lines 10 --nostream
```
**EXPECTED OUTPUT**: `Webhook server listening on 5000` with no error stack traces.

**IF FAILS**:
- `Error: Cannot find module` → dependencies didn't install correctly, re-run `npm install` in `/var/www/foodhubbie/webhook-server`.
- `Error: ENOENT ... service-account.json` → `FIREBASE_SERVICE_ACCOUNT_PATH` in `.env` doesn't match the actual file location — verify with `ls /var/www/foodhubbie/bot/service-account.json`.
- Process shows `errored` in `pm2 describe` → check `pm2 logs webhook-server --err --lines 30 --nostream` for the exact stack trace.

### 8.4 Test the health endpoint locally
```bash
curl -s http://localhost:5000/health
```
**EXPECTED OUTPUT**: `{"status":"ok","time":<timestamp>}`

### 8.5 Test through the tunnel (confirms Meta will actually be able to reach it)
```bash
curl -s <TUNNEL_URL>/health
```
**EXPECTED OUTPUT**: Same JSON as 8.4. If this works, Meta's webhook verification (Section 5.7) will succeed.

**IF FAILS**: Timeout or connection refused → re-check `sudo systemctl status cloudflared-quick` is still `active (running)`, and that the tunnel's `--url` flag points to `http://localhost:5000` matching this server's actual port.

### 8.6 NOW go back and complete Section 5.7 (webhook verification in Meta dashboard)
This step was deferred earlier because the webhook server didn't exist yet. It does now — complete Section 5.7's "Verify and Save" step, then return here.

**Final verify for this section**:
```bash
pm2 logs webhook-server --lines 20 --nostream | grep "Webhook verified successfully"
```
**EXPECTED OUTPUT**: The line appears, confirming Meta's verification request was received and passed.

---
<a name="section-9"></a>
## Section 9 — Sending / Receiving Messages (bot side, replaces Baileys entirely)

### 9.1 Create the shared send helper
```bash
cat > /var/www/foodhubbie/bot/whatsapp-send.js << 'EOF'
async function sendWhatsAppMessage(phoneNumberId, accessToken, to, text) {
  const res = await fetch(
    `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text }
      })
    }
  );
  const data = await res.json();
  if (!res.ok) {
    console.error('WhatsApp send failed:', JSON.stringify(data));
    throw new Error(data.error?.message || 'WhatsApp send failed');
  }
  return data;
}

async function sendWhatsAppImage(phoneNumberId, accessToken, to, imageUrl, caption) {
  const res = await fetch(
    `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'image',
        image: { link: imageUrl, caption }
      })
    }
  );
  const data = await res.json();
  if (!res.ok) {
    console.error('WhatsApp image send failed:', JSON.stringify(data));
    throw new Error(data.error?.message || 'WhatsApp image send failed');
  }
  return data;
}

module.exports = { sendWhatsAppMessage, sendWhatsAppImage };
EOF
```
**VERIFY**:
```bash
node --check /var/www/foodhubbie/bot/whatsapp-send.js
```
**EXPECTED OUTPUT**: Silent (no syntax errors).

**VERIFY (functional test — sends a real message)**:
```bash
cd /var/www/foodhubbie/bot
node -e "
require('dotenv').config({path:'/var/www/foodhubbie/.env'});
const { sendWhatsAppMessage } = require('./whatsapp-send');
sendWhatsAppMessage('<PHONE_NUMBER_ID>', process.env.WA_PERMANENT_TOKEN, '<YOUR_TEST_NUMBER>', 'Helper function test OK')
  .then(r => console.log('SUCCESS:', JSON.stringify(r)))
  .catch(e => console.error('FAILED:', e.message));
"
```
**EXPECTED OUTPUT**: `SUCCESS: {"messaging_product":"whatsapp",...}` and message arrives on the test WhatsApp.

### 9.2 Add receiving logic — this is a manual code-merge step, agent must be careful here

**Agent instruction**: this step modifies `bot/index.js`, an existing large file (1900+ lines) with a working state machine. Do NOT rewrite the file. Do NOT delete existing order-flow logic. The ONLY changes needed are:

1. **Remove** (comment out first, delete only after confirming the new flow works end-to-end):
   - Any `require('@whiskeysockets/baileys')` or similar Baileys imports
   - Any `makeWASocket(...)` initialization block
   - Any `sock.ev.on('messages.upsert', ...)` handler — but **copy its entire body** somewhere safe first, since the actual order-processing logic inside it must be preserved
   - Any `sock.sendMessage(...)` calls — these get replaced one-by-one with the new `reply()` helper (below), not deleted wholesale

2. **Add** near the top of `bot/index.js`, after existing requires:
```javascript
const { createClient } = require('redis');
const { sendWhatsAppMessage, sendWhatsAppImage } = require('./whatsapp-send');

const BUSINESS_ID = process.env.BUSINESS_ID;
const OUTLET_ID = process.env.OUTLET_ID;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WA_ACCESS_TOKEN = process.env.WA_ACCESS_TOKEN;

async function reply(to, text) {
  return sendWhatsAppMessage(PHONE_NUMBER_ID, WA_ACCESS_TOKEN, to, text);
}
async function replyWithImage(to, imageUrl, caption) {
  return sendWhatsAppImage(PHONE_NUMBER_ID, WA_ACCESS_TOKEN, to, imageUrl, caption);
}

const subscriber = createClient({ url: process.env.REDIS_URL });
subscriber.connect().then(() => {
  subscriber.subscribe(`bot-inbox:${BUSINESS_ID}:${OUTLET_ID}`, async (rawMessage) => {
    try {
      const message = JSON.parse(rawMessage);
      const sender = message.from;
      const text = message.text?.body || '';
      await handleIncomingMessage(sender, text); // <-- existing state machine entry point goes here
    } catch (e) {
      console.error('Error processing inbound message:', e);
    }
  });
  console.log(`Bot worker ${OUTLET_ID} listening on Redis channel bot-inbox:${BUSINESS_ID}:${OUTLET_ID}`);
});
```

3. **Find and replace** every existing `sock.sendMessage(jid, {text: '...'})` call pattern with `reply(jid, '...')`. **Agent must search for the literal string `sock.sendMessage` across `bot/index.js` and enumerate every occurrence before making changes** — do not assume there's only one.

**VERIFY (search step, run BEFORE editing)**:
```bash
grep -n "sock.sendMessage\|sock.ev.on\|makeWASocket\|baileys" /var/www/foodhubbie/bot/index.js
```
**EXPECTED OUTPUT**: A list of line numbers and matching lines. **Record every line number** — this is your complete edit checklist. Do not consider this migration done until every line from this grep result has been addressed.

**VERIFY (after editing, run the same grep again)**:
```bash
grep -n "sock.sendMessage\|sock.ev.on\|makeWASocket\|baileys" /var/www/foodhubbie/bot/index.js
```
**EXPECTED OUTPUT**: Empty (no matches) — confirms all Baileys references are gone.

```bash
node --check /var/www/foodhubbie/bot/index.js
```
**EXPECTED OUTPUT**: Silent (no syntax errors after the edit).

### 9.3 Remove Baileys package (only after 9.2 is fully verified working)
```bash
cd /var/www/foodhubbie/bot
npm uninstall @whiskeysockets/baileys
rm -rf session_data_*
```
**VERIFY**:
```bash
grep -q baileys package.json && echo "STILL PRESENT - STOP" || echo "removed OK"
```
**EXPECTED OUTPUT**: `removed OK`

### 9.4 End-to-end test before moving on
```bash
# Manually publish a test message to the bot's Redis channel, simulating an incoming WhatsApp message
redis-cli PUBLISH "bot-inbox:<BUSINESS_ID>:<OUTLET_ID>" '{"from":"<YOUR_TEST_NUMBER>","text":{"body":"hi"}}'
```
**VERIFY**:
```bash
pm2 logs bot-<BUSINESS_ID>-<OUTLET_ID> --lines 20 --nostream
```
**EXPECTED OUTPUT**: Log shows the message was received and the state machine responded (e.g. sent the greeting/webview link). Confirm the reply physically arrives on the test WhatsApp number too.

---
<a name="section-10"></a>
## Section 10 — Orchestrator Service

### 10.1 Create the orchestrator
```bash
mkdir -p /var/www/foodhubbie/orchestrator
cd /var/www/foodhubbie/orchestrator
npm init -y
npm install firebase-admin pm2 dotenv
```
**VERIFY**:
```bash
node -e "require('firebase-admin'); require('pm2'); require('dotenv'); console.log('modules OK')"
```
**EXPECTED OUTPUT**: `modules OK`

### 10.2 Write the orchestrator code
```bash
cat > /var/www/foodhubbie/orchestrator/index.js << 'EOF'
require('dotenv').config({ path: '/var/www/foodhubbie/.env' });
const admin = require('firebase-admin');
const pm2 = require('pm2');

const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});

const db = admin.database();
const runningWorkers = new Set();

pm2.connect((err) => {
  if (err) { console.error('PM2 connect failed:', err); process.exit(1); }
  console.log('Orchestrator running. Watching businesses/ for changes...');

  db.ref('businesses').on('child_added', (bizSnap) => {
    const bid = bizSnap.key;
    bizSnap.ref.child('outlets').on('child_added', (s) => handleOutletChange(bid, s.key, s.val()));
    bizSnap.ref.child('outlets').on('child_changed', (s) => handleOutletChange(bid, s.key, s.val()));
    bizSnap.ref.child('outlets').on('child_removed', (s) => stopWorker(bid, s.key));
  });
});

function handleOutletChange(bid, oid, outlet) {
  const workerName = `bot-${bid}-${oid}`;
  const shouldRun = outlet?.whatsapp?.status === 'active' && outlet?.suspended !== true;

  if (shouldRun && !runningWorkers.has(workerName)) {
    console.log(`Starting: ${workerName}`);
    pm2.start({
      name: workerName,
      script: '/var/www/foodhubbie/bot/index.js',
      env: {
        BUSINESS_ID: bid,
        OUTLET_ID: oid,
        PHONE_NUMBER_ID: outlet.whatsapp.phoneNumberId,
        WA_ACCESS_TOKEN: process.env.WA_PERMANENT_TOKEN,
        FIREBASE_DATABASE_URL: process.env.FIREBASE_DATABASE_URL,
        FIREBASE_SERVICE_ACCOUNT_PATH: process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
        REDIS_URL: process.env.REDIS_URL
      }
    }, (err) => {
      if (err) console.error(`Failed to start ${workerName}:`, err);
      else { runningWorkers.add(workerName); console.log(`${workerName} started OK`); }
    });

    db.ref(`phoneNumberIndex/${outlet.whatsapp.phoneNumberId}`).set({ businessId: bid, outletId: oid })
      .then(() => console.log(`Routing index updated for ${outlet.whatsapp.phoneNumberId}`))
      .catch(e => console.error('Failed to write routing index:', e));
  }

  if (!shouldRun && runningWorkers.has(workerName)) stopWorker(bid, oid);
}

function stopWorker(bid, oid) {
  const workerName = `bot-${bid}-${oid}`;
  if (!runningWorkers.has(workerName)) return;
  console.log(`Stopping: ${workerName}`);
  pm2.stop(workerName, (err) => {
    if (!err) { runningWorkers.delete(workerName); console.log(`${workerName} stopped OK`); }
    else console.error(`Failed to stop ${workerName}:`, err);
  });
}
EOF
```
**VERIFY**:
```bash
node --check /var/www/foodhubbie/orchestrator/index.js
```
**EXPECTED OUTPUT**: Silent (no syntax errors).

### 10.3 Start it
```bash
cd /var/www/foodhubbie/orchestrator
pm2 start index.js --name orchestrator
pm2 save
```
**VERIFY**:
```bash
pm2 describe orchestrator | grep status
pm2 logs orchestrator --lines 10 --nostream
```
**EXPECTED OUTPUT**: `status : online`, and log line `Orchestrator running. Watching businesses/ for changes...` with no error stack trace.

**IF FAILS**: `Error: Cannot find module '/var/www/foodhubbie/bot/service-account.json'` → path mismatch, re-verify `FIREBASE_SERVICE_ACCOUNT_PATH` in `.env` exactly matches the real file location.

### 10.4 End-to-end test — write a fake restaurant directly to Firebase, confirm the orchestrator reacts
```bash
node -e "
require('dotenv').config({path:'/var/www/foodhubbie/.env'});
const admin = require('firebase-admin');
admin.initializeApp({
  credential: admin.credential.cert(require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});
admin.database().ref('businesses/test_biz_001/outlets/test_outlet_001').set({
  name: 'Test Restaurant',
  whatsapp: { phoneNumberId: '<REAL_TEST_PHONE_NUMBER_ID>', status: 'active' }
}).then(() => { console.log('Test outlet written'); process.exit(0); });
"
```
**VERIFY** (within ~5 seconds):
```bash
pm2 list | grep bot-test_biz_001-test_outlet_001
```
**EXPECTED OUTPUT**: A new PM2 process row, status `online`.

**Cleanup after test**:
```bash
node -e "
require('dotenv').config({path:'/var/www/foodhubbie/.env'});
const admin = require('firebase-admin');
admin.initializeApp({
  credential: admin.credential.cert(require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)),
  databaseURL: process.env.FIREBASE_DATABASE_URL
});
admin.database().ref('businesses/test_biz_001').remove().then(() => { console.log('Test data removed'); process.exit(0); });
"
```
**VERIFY**:
```bash
sleep 5 && pm2 list | grep bot-test_biz_001-test_outlet_001
```
**EXPECTED OUTPUT**: No matching line — confirms the orchestrator correctly stopped the worker when the Firebase record was removed.

### 10.5 Enable PM2 startup on reboot (do this once, after orchestrator + webhook-server are both confirmed working)
```bash
pm2 save
pm2 startup
```
**EXPECTED OUTPUT**: Prints a command starting with `sudo env PATH=...`. **Agent must copy and execute that exact printed command** — it's unique to this server and cannot be hardcoded in this guide.

**VERIFY**:
```bash
sudo systemctl status pm2-ubuntu --no-pager
```
**EXPECTED OUTPUT**: `Active: active (running)` — confirms PM2 will restart all saved processes automatically after any server reboot.

---
<a name="section-11"></a>
## Section 11 — Supreme Admin Dual-Dashboard (Firebase Hosting only)

> This section runs on the LOCAL/CI machine, not the EC2 server, per Section 0.1's fixed rule.

### 11.1 Folder structure
```bash
cd ~/roshani-pizza-bot   # or wherever the repo is cloned locally
mkdir -p SupremeAdmin/js/features SupremeAdmin/css
```
**VERIFY**:
```bash
ls -la SupremeAdmin/js/features
```
**EXPECTED OUTPUT**: Empty directory listing (just `.` and `..`), confirms it was created.

### 11.2 Add Firebase Hosting target
```bash
firebase target:apply hosting supremeadmin <YOUR-FIREBASE-PROJECT-ID>-supreme
```
**VERIFY**:
```bash
cat .firebaserc
```
**EXPECTED OUTPUT**: JSON showing `"supremeadmin"` mapped under `"targets"` → your project ID.

Edit `firebase.json` to add the new hosting entry — agent should use a JSON-aware edit (not blind text append) to avoid breaking existing `Admin`/`menu`/`rider-app` hosting configs already in that file:
```bash
node -e "
const fs = require('fs');
const config = JSON.parse(fs.readFileSync('firebase.json', 'utf8'));
if (!Array.isArray(config.hosting)) config.hosting = [config.hosting];
config.hosting.push({
  target: 'supremeadmin',
  public: 'SupremeAdmin',
  rewrites: [{ source: '**', destination: '/index.html' }]
});
fs.writeFileSync('firebase.json', JSON.stringify(config, null, 2));
console.log('firebase.json updated');
"
```
**VERIFY**:
```bash
python3 -c "import json; json.load(open('firebase.json')); print('valid JSON')"
grep -c "supremeadmin" firebase.json
```
**EXPECTED OUTPUT**: `valid JSON` then a count of `2` or more (appears in both `.firebaserc` reference and the hosting array).

### 11.3 Minimal index.html + deploy test (confirms the pipeline works before building real pages)
```bash
cat > SupremeAdmin/index.html << 'EOF'
<!DOCTYPE html>
<html><head><title>Food-Hubbie Supreme Admin</title></head>
<body><h1>Supreme Admin — deployment test OK</h1></body></html>
EOF
firebase deploy --only hosting:supremeadmin
```
**EXPECTED OUTPUT**: Ends with `Hosting URL: https://<project>-supreme.web.app` (or similar).

**VERIFY**:
```bash
curl -s https://<project>-supreme.web.app | grep "deployment test OK"
```
**EXPECTED OUTPUT**: The matching line found — confirms the page is genuinely live.

### 11.4 Build out the real pages
Reference file list (each is its own JS module, matching `Admin/js/features/*.js` conventions already in the repo — agent should literally open 2-3 existing `Admin/js/features/*.js` files first to copy the exact coding style: `escapeHtml()` usage, `data-action` dispatcher pattern, drawer CSS classes):

| File | Purpose |
|---|---|
| `SupremeAdmin/js/main.js` | Hash-based router switching between Restaurant Mgmt / Bot Mgmt |
| `SupremeAdmin/js/auth.js` | Checks `isSuper` claim, copy logic from `Admin/js/auth.js` |
| `SupremeAdmin/js/features/restaurant-list.js` | Table of all restaurants |
| `SupremeAdmin/js/features/restaurant-onboarding.js` | Add Restaurant form + Embedded Signup |
| `SupremeAdmin/js/features/restaurant-profile.js` | **Search + single restaurant deep-dive, including live bot status + manage controls — see 11.4a** |
| `SupremeAdmin/js/features/restaurant-analytics.js` | Orders/revenue charts |
| `SupremeAdmin/js/features/bot-fleet-overview.js` | ALL bot workers across ALL restaurants, one grid (platform-wide bird's-eye view) |
| `SupremeAdmin/js/features/whatsapp-linking.js` | Embedded Signup handler |

### 11.4a — Restaurant Profile Page: Search, Bot Status & Manage (the specific flow you asked for)

This is the page that answers "is this restaurant's bot integrated and active, and can I manage it" — tied directly to restaurant identity, not a separate disconnected grid.

**Search bar (top of Restaurant Management page)**:
```javascript
// SupremeAdmin/js/features/restaurant-list.js
async function searchRestaurants(query) {
  const snap = await firebase.database().ref('businesses').get();
  const businesses = snap.val() || {};
  const q = query.toLowerCase();
  const results = [];
  Object.entries(businesses).forEach(([bid, biz]) => {
    Object.entries(biz.outlets || {}).forEach(([oid, outlet]) => {
      if (outlet.name?.toLowerCase().includes(q) || biz.name?.toLowerCase().includes(q)) {
        results.push({ bid, oid, name: outlet.name, businessName: biz.name });
      }
    });
  });
  renderSearchResults(results); // each result links to openRestaurantProfile(bid, oid)
}
```

**Profile page — combines Firebase data (restaurant identity) with live PM2 status (bot health)**:
```javascript
// SupremeAdmin/js/features/restaurant-profile.js
async function openRestaurantProfile(bid, oid) {
  location.hash = `#profile/${bid}/${oid}`;
  const outlet = (await firebase.database().ref(`businesses/${bid}/outlets/${oid}`).get()).val();
  const botStatus = await fetchBotStatus(bid, oid); // calls Bot Control API, see below

  document.getElementById('profile-content').innerHTML = `
    <h2>${escapeHtml(outlet.name)}</h2>
    <div class="status-row">
      <span class="label">WhatsApp Number:</span>
      <span>${outlet.whatsapp?.phoneNumberId ? '✅ Connected' : '⚪ Not connected'}</span>
    </div>
    <div class="status-row">
      <span class="label">Bot Status:</span>
      <span class="${botStatus.status === 'online' ? 'status-online' : 'status-offline'}">
        ${botStatus.status === 'online' ? '🟢 Active' : '🔴 Inactive'}
      </span>
    </div>
    <div class="status-row"><span class="label">Uptime:</span><span>${formatUptime(botStatus.uptime)}</span></div>
    <div class="status-row"><span class="label">Memory:</span><span>${(botStatus.memory / 1024 / 1024).toFixed(0)} MB</span></div>

    <div class="profile-actions">
      <button data-action="restart-bot" data-bid="${bid}" data-oid="${oid}">Restart Bot</button>
      <button data-action="stop-bot" data-bid="${bid}" data-oid="${oid}">Stop Bot</button>
      <button data-action="reconnect-whatsapp" data-bid="${bid}" data-oid="${oid}">Reconnect WhatsApp</button>
    </div>
  `;
}

async function fetchBotStatus(bid, oid) {
  const token = await firebase.auth().currentUser.getIdToken();
  const res = await fetch(`<TUNNEL_URL>/api/bot/status/${bid}/${oid}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.ok ? res.json() : { status: 'unknown', uptime: 0, memory: 0 };
}
```

**Manage actions — wired through `main.js`'s existing `data-action` dispatcher**:
```javascript
// Add to SupremeAdmin/js/main.js dispatcher
case 'restart-bot': await callBotControlApi('restart', bid, oid); break;
case 'stop-bot': await callBotControlApi('stop', bid, oid); break;
case 'reconnect-whatsapp': launchWhatsAppSignup(bid, oid); break; // reuses 11.4's Embedded Signup

async function callBotControlApi(action, bid, oid) {
  const token = await firebase.auth().currentUser.getIdToken();
  const res = await fetch(`<TUNNEL_URL>/api/bot/${action}/${bid}/${oid}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }
  });
  if (res.ok) openRestaurantProfile(bid, oid); // refresh the profile view to show new status
}
```

**This requires the Bot Control API from Section 10 (not yet in this guide as a standalone piece)** — add it now if not already present:
```bash
mkdir -p /var/www/foodhubbie/bot-control-api
cd /var/www/foodhubbie/bot-control-api
npm init -y
npm install express pm2 firebase-admin dotenv
cat > index.js << 'EOF'
require('dotenv').config({ path: '/var/www/foodhubbie/.env' });
const express = require('express');
const pm2 = require('pm2');
const admin = require('firebase-admin');
const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount), databaseURL: process.env.FIREBASE_DATABASE_URL });

const app = express();
app.use(express.json());

async function requireSupreme(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    const isSuper = (await admin.database().ref(`admins/${decoded.uid}/isSuper`).get()).val();
    if (!isSuper) return res.status(403).json({ error: 'Not authorized' });
    next();
  } catch (e) { res.status(401).json({ error: 'Invalid token' }); }
}
app.use(requireSupreme);

app.get('/api/bot/status/:bid/:oid', (req, res) => {
  pm2.connect(() => {
    pm2.describe(`bot-${req.params.bid}-${req.params.oid}`, (err, list) => {
      pm2.disconnect();
      if (err || !list.length) return res.json({ status: 'not_found' });
      res.json({
        status: list[0].pm2_env.status,
        memory: list[0].monit.memory,
        cpu: list[0].monit.cpu,
        uptime: Date.now() - list[0].pm2_env.pm_uptime
      });
    });
  });
});

app.post('/api/bot/restart/:bid/:oid', (req, res) => {
  pm2.connect(() => {
    pm2.restart(`bot-${req.params.bid}-${req.params.oid}`, (err) => {
      pm2.disconnect();
      res.json({ success: !err });
    });
  });
});

app.post('/api/bot/stop/:bid/:oid', (req, res) => {
  pm2.connect(() => {
    pm2.stop(`bot-${req.params.bid}-${req.params.oid}`, (err) => {
      pm2.disconnect();
      res.json({ success: !err });
    });
  });
});

const PORT = process.env.BOT_CONTROL_PORT || 4000;
app.listen(PORT, () => console.log(`Bot Control API on ${PORT}`));
EOF
node --check index.js
pm2 start index.js --name bot-control-api
pm2 save
```
**VERIFY**:
```bash
pm2 describe bot-control-api | grep status
```
**EXPECTED OUTPUT**: `status : online`

**Expose it through the tunnel** — add to the Cloudflare Tunnel config (Section 4) as a second ingress rule, or route it via the same webhook tunnel with a path-based split (agent should append this to whichever tunnel config exists from Section 4.4/4.6, not create a second tunnel):
```yaml
ingress:
  - hostname: <your-tunnel-hostname>
    path: /webhook*
    service: http://localhost:5000
  - hostname: <your-tunnel-hostname>
    path: /api/*
    service: http://localhost:4000
  - service: http_status:404
```
**VERIFY**:
```bash
curl -s -o /dev/null -w "%{http_code}" <TUNNEL_URL>/api/bot/status/test/test
```
**EXPECTED OUTPUT**: `401` (correctly rejects the request — no auth token supplied — confirming the API is reachable through the tunnel and enforcing the `isSuper` check as designed).



**Agent instruction**: build and deploy ONE file at a time, verify each with `firebase deploy --only hosting:supremeadmin` + a `curl` check that the new page loads without a JS console error, before moving to the next file. Do not batch all 8 files and deploy once — smaller verifiable increments reduce risk of an undiagnosable combined failure.

---

### 11.5 — Ops & Fleet Expansion Plan (11 features, implement one at a time)

> **Cross-cutting principle**: every feature below is *additive* to Sections 10 & 11. None touches the order-flow state machine (Section 16 boundary — the "don't rewrite `bot/index.js`" rule still applies). Each feature lands as its own file/commit with its own VERIFY. Build order is listed so that dependencies land first: **1 → 5 → 3 → 6 → 7 → 2 → 4 → 9 → 10 → 11 → 8**.

| # | Feature | Touches | Depends on |
|---|---|---|---|
| 1 | Real-time bot status (replace 15s polling) | orchestrator, `bot-fleet-overview.js`, bot-control-api | — |
| 5 | Role granularity (support = view-only) | `auth.js`, bot-control-api, all feature pages | — |
| 3 | 24h uptime/status sparkline per outlet | orchestrator, `bot-fleet-overview.js` | 1 |
| 6 | Onboarding progress stepper | `restaurant-onboarding.js` | 1 |
| 7 | Offline alerting (Slack/email webhook) | orchestrator | 1 |
| 2 | CSV export (restaurant list + fleet grid) | `utils.js`, `restaurant-list.js`, `bot-fleet-overview.js` | — |
| 4 | Search/filter by plan tier + WhatsApp status | `restaurant-list.js` | — |
| 9 | Command palette (⌘K) | `cmd-palette.js`, `main.js` | — |
| 10 | WhatsApp quota visibility (usage vs cap) | orchestrator, fleet card, profile | — |
| 11 | Per-restaurant analytics drill-down | `restaurant-analytics.js` | — |
| 8 | Fleet bulk actions (multi-select restart) | `bot-fleet-overview.js`, bot-control-api | 5 |

---

#### Feature 1 — Real-time bot status (replace 15s polling)

**Problem**: 11.4's design has the dashboard `fetch()` the Bot Control API every 15s per outlet; across a growing fleet that's N requests/sec hammering PM2's `describe`.

**Data model** — orchestrator owns `businesses/{bid}/outlets/{oid}/botStatus`:
```json
{ "status": "online|offline|restarting|stopped", "uptimeMs": 123456, "cpu": 0.05, "memoryMb": 123, "transport": "meta", "updatedAt": 1710000000000 }
```

**Orchestrator change** (Section 10.2's `index.js`):
- After every `pm2.start` / `pm2.stop` / `pm2.restart` callback, write `botStatus` for that worker.
- Add a 30s heartbeat `setInterval` that re-reads `pm2.list()` once (batched — one PM2 call for all workers, not one per outlet) and writes each worker's `botStatus` + `updatedAt`. This also self-heals a stale `botStatus` after an orchestrator restart.
- Add a `pm2.launchBus()` listener for `process:event` (`online`/`exit`) to catch crashes the interval might miss.

**Fleet page** (`bot-fleet-overview.js`): replace the poll loop with
```javascript
firebase.database().ref('businesses').on('value', snap => renderFleet(snap.val()));
```
and read each outlet's `botStatus` from the snapshot. Keep `fetchBotStatus` only as a manual "refresh now" button.

**Bot Control API**: `/api/bot/status/:bid/:oid` becomes optional (dashboard no longer calls it). Keep the endpoint for curl/manual checks. This is the load-reduction win.

**VERIFY**: `pm2 stop bot-roshani-pizza-pizza` → within ~30s `botStatus.status` in Firebase shows `offline` with no browser polling; `pm2 restart` → flips back `online` with new `uptimeMs`.

---

#### Feature 2 — CSV export (restaurant list + fleet grid)

- Add `SupremeAdmin/js/utils.js` with one function reusing the pattern already in `Admin/js/features/orders.js`:
```javascript
function exportCsv(filename, headers, rows) { /* Blob + a.download + \ufeff BOM so Excel keeps unicode */ }
```
- "Export CSV" toolbar button on both the restaurant-list page and the fleet grid, exporting the **currently filtered** rows (not the raw Firebase dump).
- **VERIFY**: apply a filter, click export → file downloads, headers match visible columns, ₹/names open un-mangled in Excel.

---

#### Feature 3 — 24h uptime/status sparkline per outlet

- The 30s heartbeat (Feature 1) also appends `{ t: <epochMs>, s: 'online'|'offline' }` to `botStatus.history`, capped at the last 288 samples (5-min × 24h) — shift when over.
- Fleet card + profile render an inline SVG sparkline from `history` (colored cells — no chart library, ponytail: native SVG).
- **VERIFY**: view fleet → each card shows 24h of color cells; a bot you stopped for a minute shows a visible offline notch.

---

#### Feature 4 — Restaurant list search/filter by plan tier + WhatsApp status

- Filter row above the table: name text + **plan tier** dropdown (`free|basic|pro`) + **WhatsApp status** dropdown (`connected|not_connected`).
- Source of truth: tier from `businesses/{bid}/plan/tier` if the field exists, else `businesses/{bid}/settings/plan` (confirm at implementation); WhatsApp status from `outlet.whatsapp.phoneNumberId` presence.
- Extend 11.4a's `searchRestaurants(query, filters)` — combine text + tier + status with AND logic.
- **VERIFY**: set tier=`pro` + status=`connected` → table shows only matching restaurants; combined with a name query still narrows correctly.

---

#### Feature 5 — Role granularity (support = view-only)

**Data model**: `admins/{uid}/role` ∈ `super | support`, default `support`. Existing supers keep `isSuper: true` (backward compatible — `super` implies `isSuper`).

- `SupremeAdmin/js/auth.js`: read `role`; render the dashboard read-only for `support` — hide/disable the Restart/Stop/Reconnect buttons and bulk-restart.
- **Bot Control API**: split the single `requireSupreme` middleware into `requireRead` (GET status — `super` **or** `support`) and `requireWrite` (all POST actions — `super` only). POST with a support token → `403`.
- **VERIFY**: create a `support` user in Firebase, log in → restart button absent, fleet grid checkboxes hidden; `curl -X POST /api/bot/restart/roshani-pizza/pizza` with the support user's ID token → `403`.

---

#### Feature 6 — Onboarding progress stepper

No new schema — derive all four steps from existing nodes (ponytail: derivation over storage):
| Step | Derivation |
|---|---|
| 1. Business created | `businesses/{bid}` exists |
| 2. Outlet created | `businesses/{bid}/outlets/{oid}` exists |
| 3. WhatsApp linked | `outlet.whatsapp.phoneNumberId` set |
| 4. Bot online | `botStatus.status === 'online'` (Feature 1) |

- `restaurant-onboarding.js` renders a 4-cell stepper; the current stuck step is highlighted, so "where is onboarding stuck" is answered at a glance.
- **VERIFY**: open the page → stepper shows real state (e.g. WhatsApp linked but bot offline → step 3 done, step 4 pending).

---

#### Feature 7 — Offline alerting (Slack/email webhook from Orchestrator)

- Config: `OFFLINE_ALERT_MINUTES` (default 10) in `/var/www/foodhubbie/.env` + `ALERT_WEBHOOK_URL`. Primary = Slack incoming webhook (zero dependency). If the human has no Slack webhook, a generic HTTPS endpoint works too (e.g. IFTTT/Make email trigger); document `nodemailer` only as a last resort.
- Orchestrator logic (on top of Feature 1's heartbeat): track `offlineSince` per worker; when still offline past `OFFLINE_ALERT_MINUTES`, POST once (native Node `fetch` — Node 20+, no new dependency):
```json
{ "text": "🟥 Bot OFFLINE: <outletName> (<bid>/<oid>) since <ts> — transport <transport>" }
```
- Debounce: fire once per offline episode; clear `offlineSince` on recovery.
- **VERIFY**: set `OFFLINE_ALERT_MINUTES=1`, `pm2 stop` a bot → webhook receives the alert ~1 min later; restart → no repeat alert.

---

#### Feature 8 — Fleet bulk actions (multi-select restart)

- Fleet grid gets a checkbox column + "Restart selected" toolbar button (super only, per Feature 5).
- Bot Control API adds one endpoint (single auth check, one round-trip):
```javascript
app.post('/api/bot/bulk/restart', requireWrite, (req, res) => {
  const { bots } = req.body; // [{bid,oid}, ...]
  pm2.connect(() => {
    const ops = bots.map(b => new Promise(r => pm2.restart(`bot-${b.bid}-${b.oid}`, () => r())));
    Promise.all(ops).then(() => { pm2.disconnect(); res.json({ success: true, count: bots.length }); });
  });
});
```
- **VERIFY**: select 3 offline bots → restart → all flip `online` in the realtime view within ~30s.

---

#### Feature 9 — Command palette (⌘K)

- `SupremeAdmin/js/cmd-palette.js`: global `keydown` for `Ctrl/Cmd+K` opens an overlay; input fuzzy-matches restaurant/outlet names + actions; ↑/↓ + Enter navigate to `#profile/{bid}/{oid}`.
- Hand-rolled contains/fuzzy filter — no dependency (ponytail: a few lines).
- **VERIFY**: press ⌘K → type a restaurant name → Enter → profile page opens.

---

#### Feature 10 — WhatsApp quota visibility (usage vs cap)

- Meta exposes per-WABA messaging-limit tier + usage. Orchestrator hourly cron writes `businesses/{bid}/outlets/{oid}/waQuota = { tier, conversationLimit, currentUsage, updatedAt }`. Confirm the exact Graph field names at implementation time against the WABA (`GET /{WABA_ID}/account_metrics` with usage/messaging-limit fields) — field names have shifted across Graph versions.
- Fleet card + profile render a usage-vs-cap bar (green <70%, amber 70–90%, red >90%).
- **VERIFY**: quota bar renders live values; cross-check the number against Meta's WhatsApp Manager limits page.

---

#### Feature 11 — Per-restaurant analytics drill-down

- `restaurant-analytics.js`: add an outlet selector; the platform-wide aggregation queries become scoped to `businesses/{bid}/outlets/{oid}/orders` + session totals when an outlet is chosen. Route `#analytics/{bid}/{oid}` so it's linkable from the fleet card.
- Reuse the same aggregation code as the platform-wide view — one source, scoped by path.
- **VERIFY**: pick an outlet → charts show only that outlet's orders/revenue; link from a fleet card lands on the scoped view.

---

**Agent instruction for 11.5**: implement in the table's dependency order, ONE feature per commit. Each feature ends with its VERIFY passing against the live Firebase + PM2 (Feature 1 and 3 require orchestrator redeploys — `pm2 restart orchestrator`). Features that only touch `SupremeAdmin/` verify via `firebase deploy --only hosting:supremeadmin`. Do not combine features in a single deploy.

---

<a name="section-12"></a>
## Section 12 — New Restaurant Onboarding Flow (reference, not new commands)

Already fully specified in Sections 5, 10, 11 above. Full sequence for reference/agent self-check:
```
1. SupremeAdmin dashboard: Add Restaurant form submit
   → writes businesses/{bid} + businesses/{bid}/outlets/{oid} to Firebase
2. Embedded Signup popup (Section 11.4's whatsapp-linking.js)
   → returns phoneNumberId + wabaId
3. Dashboard writes businesses/{bid}/outlets/{oid}/whatsapp = {phoneNumberId, wabaId, status:'active'}
4. Orchestrator (Section 10) detects change within ~5s → starts PM2 worker, writes phoneNumberIndex
5. Bot worker connects to Redis, subscribes to its inbox channel (Section 9.2)
6. Firebase Auth: create restaurant owner login (manual via Firebase Console initially, or via a callable function added later)
7. Test message sent to new number → confirms full pipeline (Section 9.4's test method, using the real number this time)
```
**Full pipeline VERIFY** (run this after onboarding EVERY new restaurant):
```bash
BID="<new-business-id>"; OID="<new-outlet-id>"
pm2 list | grep "bot-${BID}-${OID}"
curl -s https://graph.facebook.com/v19.0/<PHONE_NUMBER_ID>?fields=id -H "Authorization: Bearer $WA_PERMANENT_TOKEN"
```
**EXPECTED OUTPUT**: Worker listed `online`, and the Graph API call returns the phone number's ID with no `"error"` key.

---
<a name="section-13"></a>
## Section 13 — Final Cross-Verification Checklist (agent-runnable as one script)

```bash
#!/bin/bash
echo "=== FOOD-HUBBIE DEPLOYMENT VERIFICATION ==="

echo -n "1. Node.js installed: "; node --version 2>/dev/null || echo "FAIL"
echo -n "2. PM2 installed: "; pm2 --version 2>/dev/null || echo "FAIL"
echo -n "3. Redis alive: "; redis-cli ping 2>/dev/null || echo "FAIL"
echo -n "4. Cloudflare tunnel active: "; sudo systemctl is-active cloudflared-quick 2>/dev/null || echo "FAIL"
echo -n "5. Webhook server online: "; pm2 describe webhook-server 2>/dev/null | grep -q "online" && echo "OK" || echo "FAIL"
echo -n "6. Orchestrator online: "; pm2 describe orchestrator 2>/dev/null | grep -q "online" && echo "OK" || echo "FAIL"
echo -n "7. .env has no placeholders: "; grep -qc "REPLACE_WITH" /var/www/foodhubbie/.env 2>/dev/null && echo "FAIL - placeholders remain" || echo "OK"
echo -n "8. service-account.json present: "; test -f /var/www/foodhubbie/bot/service-account.json && echo "OK" || echo "FAIL"
echo -n "9. .env is gitignored: "; cd /var/www/foodhubbie && git check-ignore .env >/dev/null 2>&1 && echo "OK" || echo "FAIL"
echo -n "10. service-account.json is gitignored: "; git check-ignore bot/service-account.json >/dev/null 2>&1 && echo "OK" || echo "FAIL"
echo -n "11. No Baileys references remain: "; grep -rq "baileys\|sock.sendMessage\|makeWASocket" bot/index.js 2>/dev/null && echo "FAIL - references still present" || echo "OK"
echo -n "12. Webhook health check via tunnel: "; curl -s -o /dev/null -w "%{http_code}" $(grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' /var/log/cloudflared-quick.log | tail -1)/health 2>/dev/null

echo ""
echo "=== Manual checks still required (cannot be scripted) ==="
echo "[ ] Meta webhook shows 'Verified' in App Dashboard → WhatsApp → Configuration"
echo "[ ] Test WhatsApp message physically received on a real phone"
echo "[ ] Test order appears in Firebase under businesses/{bid}/outlets/{oid}/orders"
echo "[ ] SupremeAdmin dashboard loads at its Firebase Hosting URL with no console errors"
echo "[ ] AWS Billing Dashboard shows spend tracking against the $120 credit as expected"
```
Save this as `/var/www/foodhubbie/verify-all.sh`, `chmod +x`, and run it:
```bash
chmod +x /var/www/foodhubbie/verify-all.sh
/var/www/foodhubbie/verify-all.sh
```
**EXPECTED OUTPUT**: All 12 automated checks show `OK` (or a valid version/PONG/etc.), zero `FAIL` lines. Any `FAIL` must be resolved — cross-reference the corresponding numbered section above for the exact fix — before considering deployment complete.

---

<a name="section-14"></a>
## Section 14 — Quick Command Reference

```bash
# SSH in
ssh -i ~/.ssh/foodhubbie-key.pem ubuntu@<PUBLIC-IP>

# Pull latest code + zero-downtime reload
cd /var/www/foodhubbie && git pull && pm2 reload all

# Full status check
pm2 list
/var/www/foodhubbie/verify-all.sh

# Logs
pm2 logs bot-<bid>-<oid> --lines 100 --nostream
pm2 logs orchestrator --nostream
pm2 logs webhook-server --nostream

# Tunnel status/logs
sudo systemctl status cloudflared-quick --no-pager
sudo journalctl -u cloudflared-quick -f

# Redis
redis-cli ping
redis-cli PUBLISH "bot-inbox:<bid>:<oid>" '{"from":"<num>","text":{"body":"test"}}'

# Manual WhatsApp send test
curl -X POST "https://graph.facebook.com/v19.0/<PHONE_NUMBER_ID>/messages" \
  -H "Authorization: Bearer <TOKEN>" -H "Content-Type: application/json" \
  -d '{"messaging_product":"whatsapp","to":"<num>","type":"text","text":{"body":"test"}}'

# Deploy dashboards (from LOCAL machine)
firebase deploy --only hosting:admin
firebase deploy --only hosting:supremeadmin
```

---

<a name="section-15"></a>
## Section 15 — Pricing Decisions & Complete Costing

### 15.1 Core pricing decisions
| Decision | Why |
|---|---|
| Official Meta Cloud API, no BSP | Saves ₹4,500+/mo platform fee for a dashboard you're building yourself |
| No Baileys, even temporarily | Same ₹0 cost, zero ban risk |
| Cloudflare Quick Tunnel, no domain | Free vs ₹800-3,000/year; auto-update script (Section 4.5) removes the only real downside |
| AWS credit now, Contabo later | Free runway now, cheaper long-term once paying real money |
| No marketing WhatsApp messages | Keeps 100% of messaging in the free service window |

### 15.2 Complete cost map
| Item | Cost |
|---|---|
| AWS EC2 t3.small | ~$21/mo, covered by $120 credit for ~5-6 months |
| Meta Cloud API — service window replies | ₹0 forever |
| Meta Cloud API — marketing messages | ₹0.86/msg + 18% GST (avoid) |
| Cloudflare account + Quick Tunnel | ₹0 |
| Firebase Hosting (both dashboards) | ₹0 at this scale |
| Firebase RTDB (Spark) | ₹0 until ~30 restaurants (connection limit) |
| Redis (self-hosted) | ₹0 |
| Domain (optional, Option B only) | ~₹800-3,000/year — not required |

### 15.3 Monthly spend by stage
| Stage | Cost |
|---|---|
| Building/testing (AWS credit active) | $0 out of pocket |
| 1-10 restaurants, credit active | $0 out of pocket (~$21/mo drawn from credit) |
| After credit exhausted (~month 5-6) | ~₹1,750/mo (AWS) |
| After Contabo migration | ~₹399/mo — steady-state minimum |
| 10-40 restaurants | Still ~₹399/mo total, NOT per restaurant |

### 15.4 Key insight
Total infrastructure cost stays flat from 2 to ~40 restaurants — WhatsApp is free (service window), Firebase is free (under Spark limits), server has headroom for dozens of lightweight bot workers. Per-restaurant cost drops automatically as you scale.

### 15.5 Future spend triggers
| Trigger | Action | Added cost |
|---|---|---|
| AWS credit exhausted | Migrate to Contabo (do proactively) | Saves money |
| Want promo blasts | Budget ₹0.86/msg × GST | Optional |
| ~30 restaurants | Firebase Blaze upgrade | ₹0 if under quotas |
| ~40 restaurants | Contabo VPS S → VPS M | +₹300/mo |
| Want permanent branded URL | Cloudflare Registrar domain | ~₹800-3,000/yr |

### 15.6 Action item
Set a calendar reminder at month 4 of AWS credit usage to begin Contabo migration proactively.

---
<a name="section-16"></a>
## Section 16 — Agent Failure Recovery Matrix

> When something fails and the specific "IF FAILS" note in that section doesn't resolve it, consult this table before escalating to the human. Escalate immediately (do not keep retrying blindly) for anything marked **STOP**.

| Symptom | Likely cause | Self-recovery action | Escalate? |
|---|---|---|---|
| `pm2 describe <name>` shows `errored`, restart count climbing | Crash loop — usually a missing env var or bad require path | `pm2 logs <name> --err --lines 50 --nostream`, check for `Cannot find module` or `undefined` env var, fix `.env`/config, `pm2 restart <name>` | If same error persists after 2 fix attempts: STOP |
| `redis-cli ping` fails | Redis service stopped | `sudo systemctl restart redis-server`, re-verify | If still failing after restart: STOP |
| SSH connection refused/timeout | Security group IP rule stale (home IP changed) | Re-run `curl -s https://checkip.amazonaws.com`, update security group via `aws ec2 authorize-security-group-ingress` | Never — this is always self-recoverable |
| Cloudflare tunnel URL changed unexpectedly | Server rebooted or tunnel process crashed | Cron job (Section 4.5) should auto-fix within 5 min — verify with `cat /var/www/foodhubbie/.last-tunnel-url` vs current log | If cron didn't fire: check `crontab -l` is still present, `sudo systemctl status cron` |
| Meta webhook shows "verification failed" | Verify token mismatch between `.env`/script and Meta dashboard | `grep WA_VERIFY_TOKEN /var/www/foodhubbie/.env` — compare character-for-character with Meta dashboard field | If tokens match but still fails: STOP, may be a tunnel connectivity issue |
| WhatsApp send returns `error code 190` | Token expired or invalid | Confirm using `WA_PERMANENT_TOKEN` not a temporary one — re-verify with Section 5.5's curl test | If permanent token also fails: STOP, token may have been revoked in Meta Business Settings |
| WhatsApp send returns `error code 131047` | Outside the 24-hour service window, and no approved template used | This is expected behavior, not a bug — either wait for customer to message first, or this specific message needs a Meta-approved template | Never — this is correct API behavior |
| `git pull` fails with merge conflict | Local server changes diverged from repo (should never happen if server is never edited directly) | `git status` to see conflicting files, `git stash` local changes if any exist, retry pull | STOP always — investigate why the server has local changes at all |
| Orchestrator doesn't start a new worker after Firebase write | Outlet record missing required fields, or malformed | `node -e "..." ` re-read the exact Firebase path written, compare field names against Section 10.2's expected shape exactly (`whatsapp.status`, `whatsapp.phoneNumberId`) | If fields match spec exactly but still fails: STOP |
| `npm install` fails with permission errors | Ownership drift on project folder | `sudo chown -R ubuntu:ubuntu /var/www/foodhubbie`, retry | If still failing: STOP |
| AWS Billing alert email received | Spend approaching $100 threshold | Check `aws ce get-cost-and-usage` for breakdown, confirm nothing runaway (e.g. an oversized instance accidentally launched) | Always notify human immediately, regardless of cause |
| Any `database.rules.json` deploy | — | **STOP always** — per this project's standing convention, rules changes must be human-reviewed before `firebase deploy --only database`, never agent-auto-deployed | Always STOP |
| Any change to `bot/index.js` beyond the Section 9.2 migration | — | **STOP** — the existing state machine logic (order flow, discount engine, rider notifications) must not be rewritten by an agent without explicit human instruction for that specific change | Always STOP |

### 16.1 General agent operating principles for this project
1. **Always run the VERIFY command** after every STEP — never assume success from lack of an error message alone.
2. **Never proceed past a failed VERIFY** without either resolving it via the IF FAILS note, or escalating per the table above.
3. **Never modify `database.rules.json`** without explicit human sign-off, even if a VERIFY step suggests a rules issue — flag it, don't fix it autonomously.
4. **Never delete Baileys-related code before Section 9.2's replacement is fully verified working end-to-end** (Section 9.4's test) — keep it commented out as a rollback path until confidence is high.
5. **Test on one restaurant/outlet before applying any change platform-wide.**
6. **When in doubt about a Firebase field name or structure** (since the `businesses/{bid}/outlets/{oid}` refactor is human-owned per Section 0.1), stop and ask rather than inferring a schema.

---

*Sections 0 and 16 define the hard boundaries an agent must not cross without human involvement. Continue to Section 17 for the Firebase refactor scope this guide depends on.*

---

<a name="section-17"></a>
## Section 17 — Firebase Refactor Scope Checklist (human-owned, tracked here for completeness)

> Per Section 0.5, this refactor is Nilesh's own responsibility, not agent-driven — but it's tracked here so the deployment guide's dependency chain is honest: **Sections 8-12 of this guide assume this refactor is either complete or being done in parallel.** If any `businesses/{bid}/outlets/{oid}` path referenced elsewhere in this guide doesn't yet exist in the real database, those sections will fail their VERIFY steps — that's expected, not a bug in the guide.

### 17.1 The root cause
```
OLD structure: pizza/{...}, cake/{...}          (one flat root per outlet)
NEW structure: businesses/{bid}/outlets/{oid}/{...}   (two levels of nesting)
```
Every connection point below inherits this change because it's nested under the outlet root — this single structural decision is why the change touches so many files.

### 17.2 Complete inventory — every file/node that needs updating

| # | File / Node | What changes | Priority |
|---|---|---|---|
| 1 | `database.rules.json` | Restructure all rules from `{outlet}/...` (or single `$outletId` wildcard) to `businesses/$bid/outlets/$oid/...` (two wildcards). **Re-verify** the `orders`/`bot`/`webviewTokens` security fixes made earlier still hold at the new nesting depth — a rule correct at one level isn't automatically correct at two | 🔴 Do first — everything else depends on rules matching the real structure |
| 2 | `bot/index.js` — `OUTLET` env var | Replace single `OUTLET` with `BUSINESS_ID` + `OUTLET_ID` (two separate values) | 🔴 Critical |
| 3 | `bot/index.js` — `OUTLET_NAME` ternary | `OUTLET === 'pizza' ? 'Roshani Pizza' : 'Roshani Cake'` → Firebase lookup: `businesses/{bid}/outlets/{oid}/name` | 🔴 Critical |
| 4 | `bot/index.js` / `delivery-order.js` — hardcoded coordinates | `OUTLET === 'cake' ? 25.887... : 25.887...` → read from `businesses/{bid}/outlets/{oid}/settings/lat` and `.../lng` | 🔴 Critical |
| 5 | `bot/index.js` — `initFCMWatcher` | Hardcoded `for (const outlet of ['pizza','cake'])` → dynamically iterate all outlets read from Firebase, not a fixed array | 🔴 Critical |
| 6 | `bot/index.js` — discount engine, promotions, reports, rider notifications | Every `{outlet}/...` path reference → `businesses/{bid}/outlets/{oid}/...` | 🟡 High |
| 7 | `menu/js/firebase.js` — `OUTLET` resolution | Current: `pathParts[0] \|\| 'pizza'` (one URL segment = one outlet). **Design decision needed**: either two URL segments (`/menu/{bid}/{oid}/`) or a slug-to-`{bid,oid}` lookup table. Not a mechanical rename — pick one before implementing | 🔴 Critical — blocks Section 9's webview flow testing |
| 8 | `Admin/js/features/orders.js` | Outlet-scoped read/write paths → carry both `bid` and `oid` | 🟡 High |
| 9 | `Admin/js/features/tables.js` | Same | 🟡 High |
| 10 | `Admin/js/features/catalog.js` | Same | 🟡 High |
| 11 | `Admin/js/features/pos.js` | Same | 🟡 High |
| 12 | `Admin/js/features/inventory.js` | Same | 🟡 High |
| 13 | `Admin/js/features/discounts.js` | Same | 🟡 High |
| 14 | `Admin/js/features/promotions.js` | Same | 🟡 High |
| 15 | `Admin/js/auth.js` | `admins/{uid}/outlet` field → split into `admins/{uid}/businessId` + `admins/{uid}/outletId` | 🔴 Critical — blocks all Admin dashboard access checks |
| 16 | `rider-app/src/services/orderService.ts` | Order paths, `acceptOrder()` transaction, `assignedRider` queries → two-level path | 🟡 High |
| 17 | `webviewTokens` node | Currently likely `{outlet}/webviewTokens` → move to `businesses/{bid}/outlets/{oid}/webviewTokens` | 🟡 High |
| 18 | `.env` files (per outlet, if any remain outside the orchestrator flow) | `OUTLET=pizza` → `BUSINESS_ID=...` + `OUTLET_ID=...` | 🟢 Already handled by this guide's orchestrator (Section 10) |

### 17.3 Already correctly built for the NEW structure (no rework needed)
These pieces in this guide were designed fresh against `businesses/{bid}/outlets/{oid}`, so they don't need touching once the refactor above is done:

| Component | Section |
|---|---|
| Orchestrator (`orchestrator/index.js`) | Section 10 |
| Webhook routing (`phoneNumberIndex/{phoneNumberId}` → `{businessId, outletId}`) | Section 8 |
| Bot Control API | Section 11.4a |
| SupremeAdmin dashboard code | Section 11 |
| PM2 worker naming (`bot-{bid}-{oid}`) | Sections 9-10 |

### 17.4 Recommended sequencing
```
1. database.rules.json restructure (item 1) — do this FIRST, alone, test with Firebase Rules Playground
2. Admin/js/auth.js (item 15) — required before any Admin dashboard testing works at all
3. bot/index.js items 2-6 — do together, they're all in the same file
4. menu/js/firebase.js design decision (item 7) — make this call before implementing, it affects the webview URL scheme customers will see
5. Remaining Admin/js/features/*.js files (items 8-14) — can be done incrementally, one feature at a time, each independently testable
6. rider-app (item 16) — can be done in parallel with 5, no dependency
7. webviewTokens migration (item 17) — do alongside item 7 since they're both webview-related
```

### 17.5 Verification gate before this guide's Section 8 onward can be trusted
```bash
# Run this against the REAL Firebase project once the refactor is done, to confirm
# the structure actually matches what this guide's orchestrator/webhook code expects:
node -e "
const admin = require('firebase-admin');
admin.initializeApp({
  credential: admin.credential.cert(require('/var/www/foodhubbie/bot/service-account.json')),
  databaseURL: '<YOUR_DB_URL>'
});
admin.database().ref('businesses').limitToFirst(1).once('value', (snap) => {
  const data = snap.val();
  if (!data) { console.log('FAIL: no businesses/ node found — refactor not done yet'); process.exit(1); }
  const bid = Object.keys(data)[0];
  const outlets = data[bid].outlets;
  if (!outlets) { console.log('FAIL: businesses/' + bid + '/outlets missing'); process.exit(1); }
  console.log('OK: found businesses/' + bid + '/outlets/' + Object.keys(outlets)[0]);
  process.exit(0);
});
"
```
**EXPECTED OUTPUT**: `OK: found businesses/<bid>/outlets/<oid>` — only once this passes should the agent proceed with Sections 8 onward of this guide. If it prints `FAIL`, stop and wait for the human to confirm the refactor is ready.

---

*End of Master Project Deployment Guide v3.*
