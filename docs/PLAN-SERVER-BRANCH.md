# PLAN — Server Branch (`server`)

**Status:** all phases done 2026-11-08 · **Live:** EC2 tracks `origin/server` (`fc26ec2`), deploy script + invariant guard shipped · sparse-checkout **reverted** (see incident)
**Replaces:** the standing rule *"EC2 `/var/www/foodhubbie` is a pinned dirty worktree — never `git pull` there"* (AGENTS.md → Key Decisions).

### Progress

| Phase | State | Evidence |
|---|---|---|
| 0 — `.gitignore` hardening | **done** `c8b5165` | no pattern shadows a tracked file |
| 1 — create + push `server` | **done** `c8b5165` | `merge-base --is-ancestor server main` → 0 |
| 2 — EC2 snapshot | **done** 2026-11-08 04:12 | `/home/ubuntu/backups/foodhubbie-worktree-20261108-041224.tgz` — 26 MB, 1218 entries, 313 session dirs, `service-account.json` present |
| 3 — checkout `server` on EC2 | **done** 2026-11-08 04:38 | `HEAD server 5ba10ad`, `git diff --quiet` clean, 4 processes online, `status-all` 401, pizza `[TENANT] outlet=pizza business=roshani-pizza` / `transport=baileys` / `Online`, fresh `pair.connectedAt`, heartbeat 15 s |
| 4 — sparse-checkout | **reverted** 2026-11-08 | `init --cone` deleted ignored runtime files (`node_modules`, `service-account.json`, `session_data_*`); restored from the Phase 2 snapshot; sparse-checkout disabled — see the incident below |
| 5 — `tools/server-deploy.sh` + guard | **done** 2026-11-08 | script run twice (2nd = `already up to date`); `tools/check-server-branch.cjs` wired to `npm run test:server-branch` + CI |

### Incident 2026-11-08 — sparse-checkout deleted ignored runtime files

`git sparse-checkout init --cone` sets the cone to **empty** (`/*` + `!/*/`) before `set` runs.
Applying an empty cone removes the tracked files from every subdirectory **and deletes the ignored
files inside them**. On this box that was:

- `bot/node_modules/` (the whole bot dependency tree)
- `bot-control-api/node_modules/`
- `bot/service-account.json`
- `bot/session_data_*/` (the paired WhatsApp session — 19 dirs)

`set …` then restored the tracked files, so `git status` looked clean, but the next `pm2 restart`
took all four apps down with `MODULE_NOT_FOUND`. `webhook-server/node_modules/` and the untracked
media survived only because their directories had no tracked files at `init` time.

Reproduced in a scratch repo (git 2.43.0):

| step | `bot/node_modules` | `bot/secret.json` | `other/node_modules` |
|---|---|---|---|
| baseline | Y | Y | Y |
| after `git sparse-checkout init --cone` | **N** | **N** | Y |
| after `git sparse-checkout set bot` | N | N | Y |
| after `git reset --hard` | N | N | Y |

One-shot `git sparse-checkout set bot` (no separate `init`) keeps everything in the included dir and
only removes ignored files from **excluded** dirs — that part is expected. `git reset --hard` is safe
(it does not touch ignored files).

**Recovery:** extracted `bot/service-account.json` + `bot/session_data_*` from
`/home/ubuntu/backups/foodhubbie-worktree-20261108-041224.tgz`, ran `npm ci` in `bot/` and
`bot-control-api/`, restarted all four apps. Pizza reconnected on the restored session
(`pair.connectedAt` fresh, `transport=baileys`, `Online`). **Zero orders** were created in the outage
window (checked both outlets), so no customer impact.

**Decision:** sparse-checkout stays **off**. It saves ~330 MB on a disk with 21 GB free and its
failure mode is silent deletion of `node_modules` and the WhatsApp session. The deploy script now
refuses to restart if any of those runtime paths is missing, and never runs `git clean`.

---

## 1. Goal

One branch, `server`, is the **only** thing the EC2 box ever fetches. Everything that runs on a
server — `bot/`, `bot-control-api/`, `webhook-server/`, `shared/`, `tools/`, `assets/`, the pm2
ecosystem configs — is committed and pushed to `server`. Deploys stop being `scp` + md5 + `.bak-*`
and become `git fetch` + `git merge --ff-only` + `pm2 restart`.

Why bother: today a deploy is a manual file-by-file copy with no record of what is live. There is
no way to answer "what commit is the bot running?" or "roll back the bot to yesterday". The box is
`c56175b` (69 commits behind `main`) with 119 dirty entries, so `git status` there is noise, not a
signal.

---

## 2. What the investigation found (facts this plan is built on)

Measured on EC2 `3.111.39.210` on 2026-11-08:

| Fact | Value | Consequence |
|---|---|---|
| EC2 HEAD | `c56175b` on `main`, **69 behind** `origin/main` | cannot fast-forward today without a checkout |
| Dirty entries | 14 modified tracked + 105 untracked | 105 is almost entirely backup/junk |
| **Real** content drift in server code | **9 files**, all **repo-newer** | the branch already equals what is running |
| EOL-only drift | 29 files | local `core.autocrlf=true`, EC2 LF — cosmetic |
| `bot/`, `bot-control-api/`, `webhook-server/`, `shared/`, `assets/` | **byte-identical to repo HEAD** (modulo CRLF) | zero reconciliation needed |
| `.git` size | 798 MB (worktree 1.4 GB) | full checkout kept; sparse-checkout was tried and reverted (see incident) |
| `bot/service-account.json`, `bot/session_data_*/` | already gitignored | safe |
| Tracked secrets | none | safe |

The 9 real drifts: `.gitignore`, `bot/tests/billing.test.js`, `bot/tests/unit.test.js`,
`database.rules.json`, `firebase.json`, `package.json`, `package-lock.json`,
`tools/check-shared-twins.cjs`, `tools/seed-billing-defaults.cjs`. In every case the **repo copy is
newer** (verified: EC2's seeder still targets the legacy `businesses/{bid}/outlets/{oid}/billing`
node; the repo one targets `walletBilling/` and seeds `messageCaps`).

**This is the key finding:** the migration is not a code reconciliation, it is a *git plumbing*
exercise. The branch already matches production.

---

## 3. Branch model — the decision

### 3.1 Chosen: full-tree `server` branch + strict one-way invariant

- `server` is a normal branch containing the **same tree** as `main` (cut from `main`).
- **Invariant: `server` is always an ancestor of `main`** (`git merge-base --is-ancestor server main`).
  `server` is either equal to `main` or behind it. It is never ahead, never diverged.
- EC2 tracks `origin/server` and keeps the **full tree** (sparse-checkout was tried and reverted —
  see the incident in the Progress section).

Consequences:
- No merge conflicts, ever. `git merge --ff-only origin/server` on the box can never fail.
- `main` stays the complete, browsable history (GitHub default branch untouched).
- "Deploy" = move the `server` pointer forward. "Roll back" = move it back. Both are one command.
- Frontend work on `main` never reaches EC2 unless it is promoted, and promoting carries the whole
  tree (the box simply ignores the frontend paths).

### 3.2 Rejected: subset / orphan `server` branch

Tempting (small checkout, literal "only server files") but broken at the merge step: if `server`
does not contain `Admin/`, `menu/`, `website/`, then `git merge server` into `main` **deletes those
directories** (they are "deleted" relative to the merge base). Every sync-back would need
`cherry-pick` or `merge -s ours`, and the `shared/*.js` files that are consumed by *both* the bot and
the browser (`money-math`, `discount-rules`, `cost-math`, `loyalty-math`) would live in two trees
that drift silently. Not worth it.

### 3.3 Rejected: separate git repository for server code

Duplicates `shared/` (4 files are byte-identical twins already guarded by
`tools/check-shared-twins.cjs`), needs submodules or a copy step, and splits history. No.

---

## 4. Branch contents

`server` carries the whole tree, but **only these paths are "owned" by it** — server work is
committed here, and these are the paths EC2 runs:

```
bot/                      bot worker (Baileys + Meta transport), discount engine, pricing, loyalty
bot-control-api/          orchestrator, wallet publisher, quota endpoint, auto-onboarding
webhook-server/           webhook receiver + status media
shared/                   money-math, cost-math, loyalty-math, discount-rules, meta-cost-math,
                          billing-defaults, payroll-math, push-inbox, report-catalog/export
tools/                    seeders and migrations that run on the box
assets/                   brand media the bot sends
ecosystem.config.js       pm2 app definitions
ecosystem-bot-control.config.js
package.json / package-lock.json / .gitignore
```

Everything else (`Admin/`, `SupremeAdmin/`, `menu/`, `website/`, `rider-app/`, `docs/`, `tests/`,
`reference/`, `PLAN/`) is **not deployed to EC2** and is not committed on `server` unless it arrives
via a promotion from `main`.

### 4.1 Never committed on any branch

`bot/service-account.json`, `bot/session_data_*/`, `.env`, `*.pem`, `Credentials/`,
`GUIDEs/SERVER-ACCESS-GUIDE.md`. All already covered by `.gitignore`; §8 adds a guard so a
`git add -f` mistake fails CI.

### 4.2 Runtime media on EC2 — leave untracked (§9.2 resolved)

Measured 2026-11-08: **nothing references these files.** A recursive scan of `businesses/**` in RTDB
found **0** values containing `/public/` or `assets/images`; every bot image comes from DB settings
(`botSettings.imgConfirmed` / `menuImage` / `storeSettings.bannerImage`) as base64 data URLs, with an
inline 1×1 PNG as the final fallback (`bot/index.js:1842`). `webhook-server/index.js:26` does serve
`express.static(__dirname/public)`, but no stored URL points at it.

They are also **duplicates of each other** — same byte sizes, same six images:

```
webhook-server/public/status-greeting.jpg  49,531  ==  assets/images/greetingImage.jpg
webhook-server/public/status-menu.jpg     408,468  ==  assets/images/menuImage.jpg
webhook-server/public/status-confirmed.jpg 28,509  ==  assets/images/imgConfirmed.jpg
webhook-server/public/status-ready.jpg    203,721  ==  assets/images/imgReady.jpg
webhook-server/public/status-out.jpg       49,915  ==  assets/images/imgOut.jpg
webhook-server/public/status-delivered.jpg 50,445  ==  assets/images/imgDelivered.jpg
                                          + assets/images/imgFeedback.jpg (49,841, no public/ twin)
                                          + assets/images/Roshani-ERP LOGO.jpeg (14,643)
```

**Decision: do not version them.** ~1.7 MB of unreferenced legacy media from the pre-template
webhook era. They stay untracked and survive any checkout — but a `git clean -xdf` would remove them,
so the deploy script (§5.5) never runs `git clean`. Deleting them is a separate, safe cleanup.

---

## 5. Migration runbook

Six phases. Each has a gate; do not proceed past a red gate.

### Phase 0 — Harden `.gitignore` on `main` (no EC2 impact)

The box can only ever show a clean `git status` if the 105 untracked entries are classified. Add to
`.gitignore`:

```gitignore
# EC2 deploy artifacts — staged files and pre-deploy backups (never commit)
*.bak
*.bak-*
*.bak2
*.new
.env.bak-*
.last-tunnel-url*

# ad-hoc probes left on the server (never part of the app)
bot/check*.js
bot/apply_fix.js
bot/trigger_status.js
bot/test-wa-send.cjs
bot/outlet-resolution.js        # legacy duplicate of bot/helpers/outlet-resolution.js
bot-control-api/check-*.js
webhook-server/update-webhook-url.sh
```

Gate: `git status --porcelain` on `main` is empty; `git ls-files | grep -E '\.bak|\.new$'` is empty.

### Phase 1 — Create and push `server`

```bash
git checkout main
git pull --ff-only origin main
git checkout -b server
git push -u origin server
git checkout main
```

Gate: `git merge-base --is-ancestor server main && echo OK` → `OK`.

### Phase 2 — Snapshot EC2 (rollback point)

```bash
ssh ubuntu@3.111.39.210
mkdir -p /home/ubuntu/backups
tar czf /home/ubuntu/backups/foodhubbie-worktree-$(date +%Y%m%d-%H%M%S).tgz \
  --exclude='*/node_modules' --exclude='./.git' \
  -C /var/www foodhubbie
ls -lh /home/ubuntu/backups/
```

Gate: archive exists, size plausible (expect ~100–250 MB), `tar tzf` lists `foodhubbie/bot/index.js`.

### Phase 3 — Move EC2 onto the branch

The 14 locally-modified tracked files are byte-identical to `server` content (§2), so a forced
checkout loses nothing. Untracked files (runtime media, sessions, service account) are untouched by
`checkout`.

```bash
cd /var/www/foodhubbie
git config core.autocrlf false          # Linux box: keep LF, no conversion
git fetch --prune origin
git checkout -f -B server origin/server
git branch --set-upstream-to=origin/server server
git log --oneline -1
```

Gate:
- `git rev-parse --abbrev-ref HEAD` → `server`
- `git status --porcelain` → only ignored-class files remain (Phase 0 rules must be present)
- `md5sum bot/index.js bot-control-api/server.js webhook-server/index.js` → identical to the local
  repo copies

**Then restart and prove the box still works:**

```bash
pm2 restart webhook-server bot-control-api bot-roshani-pizza-pizza \
  bot-e2e-biz-1792987605261-e2e-outlet-1792987605261 --update-env
sleep 12
pm2 list --no-color
curl -s -o /dev/null -w 'status-all HTTP:%{http_code}\n' http://localhost:4000/api/bot/status-all
pm2 logs bot-roshani-pizza-pizza --lines 60 --nostream --no-color | grep -E 'TENANT|baileys|Online|FATAL'
```

Gate: `status-all` → `401` (auth required = server up), pizza logs
`[TENANT] outlet=pizza business=roshani-pizza` + transport `baileys` + `Online`. **If red:**
`git reset --hard c56175b && pm2 restart …` and stop — do not continue to Phase 4.

### Phase 4 — sparse-checkout — **REVERTED, do not repeat**

> **Never run `git sparse-checkout init --cone` on this box.** With an empty cone it deletes the
> ignored files inside every subdirectory that contains tracked files — on 2026-11-08 that was
> `bot/node_modules`, `bot-control-api/node_modules`, `bot/service-account.json` and all of
> `bot/session_data_*`. See the incident section above. Sparse-checkout is disabled
> (`git sparse-checkout disable`) and the box keeps the full 1.4 GB tree.

If a small checkout is ever wanted again it must be a **single** command with the full cone — never
`init` followed by `set`:

```bash
git sparse-checkout set bot bot-control-api webhook-server shared tools assets
```

…and only after verifying that `bot/node_modules`, `bot/service-account.json` and
`bot/session_data_*` still exist. The ~330 MB saving is not worth the risk.

### Phase 5 — Replace the deploy path

Add `tools/server-deploy.sh` (runs on EC2) and drop `scp` from the workflow:

```bash
#!/bin/bash
# Pull the server branch and restart what changed. Run ON EC2.
set -uo pipefail
cd /var/www/foodhubbie || exit 1

# 1. Refuse to deploy over hand-edited tracked files — that is how drift starts.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "ABORT: tracked files modified on this box. Reconcile, then retry."
  git status --short --untracked-files=no
  exit 1
fi

BEFORE=$(git rev-parse HEAD)
git fetch --prune origin server || exit 1
if ! git merge --ff-only origin/server; then
  echo "ABORT: origin/server is not a fast-forward of $BEFORE."
  exit 1
fi
AFTER=$(git rev-parse HEAD)
if [ "$BEFORE" = "$AFTER" ]; then
  echo "already up to date at $AFTER"
  exit 0
fi
echo "deploying ${BEFORE:0:7} -> ${AFTER:0:7}"

# 2. Syntax-check every changed JS/CJS/MJS before anything restarts.
FAIL=0
for f in $(git diff --name-only "$BEFORE" "$AFTER" | grep -E '\.(js|cjs|mjs)$'); do
  [ -f "$f" ] || continue
  ext="${f##*.}"
  cp "$f" "/tmp/fhcheck.$ext"
  if ! node --check "/tmp/fhcheck.$ext" >/dev/null 2>&1; then
    echo "SYNTAX FAIL: $f"; FAIL=1
  fi
  rm -f "/tmp/fhcheck.$ext"
done
if [ "$FAIL" = "1" ]; then
  echo "Rolling back to $BEFORE"
  git reset --hard "$BEFORE"
  exit 1
fi

# 3. Restart. Cheap enough to restart all four; correctness over cleverness.
pm2 restart webhook-server bot-control-api bot-roshani-pizza-pizza \
  bot-e2e-biz-1792987605261-e2e-outlet-1792987605261 --update-env >/dev/null
sleep 10
pm2 list --no-color | grep -E 'bot-control-api|bot-roshani|bot-e2e-biz-1792987605261|webhook-server'
curl -s -o /dev/null -w 'control-api HTTP:%{http_code}\n' http://localhost:4000/api/bot/status-all
echo "deployed $AFTER"
```

Gate: run it twice — first run prints `already up to date`, proving idempotence.

---

## 6. Daily workflow after migration

**Deploying a server change**

```bash
# dev machine
git checkout server
# ...edit bot/ shared/ etc...
git commit -am "fix(bot): ..."
git push origin server
# keep the invariant: main must stay ahead of server
git checkout main && git merge --ff-only server && git push origin main
```

```bash
# EC2
bash /var/www/foodhubbie/tools/server-deploy.sh
```

**Deploying a frontend-only change** — normal `main` flow, nothing to do on EC2. The bot never sees it.

**Rolling back a bad server deploy**

```bash
# EC2, immediate
git reset --hard <good-sha> && pm2 restart webhook-server bot-control-api \
  bot-roshani-pizza-pizza bot-e2e-biz-1792987605261-e2e-outlet-1792987605261 --update-env

# then move the pointer back so the next deploy does not re-apply it
git push origin <good-sha>:server          # from dev machine
```

**Rolling back to the pre-migration state** — untar the Phase 2 archive over `/var/www` (`.git`
excluded, so the branch stays), or `git reset --hard c56175b`.

---

## 7. What this buys

| Before | After |
|---|---|
| Deploy = 6× `scp` + manual `.bak-*` + md5 compare | Deploy = one script, one commit id |
| "What is live?" = unknown | `git rev-parse HEAD` on the box |
| Rollback = restore a tarball | `git reset --hard <sha>` |
| Drift discovered weeks later (the 4 files found today) | Deploy aborts on any tracked modification |
| EC2 tree = 1.3 GB incl. frontend | EC2 tree = server paths only |

---

## 8. Guards

**One runnable check** — `tools/check-server-branch.cjs`, run in CI and pre-push:

1. `server` exists and is an ancestor of `main` (the §3.1 invariant). Fails loudly if someone
   commits on `server` without fast-forwarding `main`.
2. No forbidden path is tracked on `server`
   (`service-account.json`, `session_data_*`, `.env`, `*.pem`).
3. Every path in the §4 cone that exists on `main` also exists on `server` — catches a promotion
   that silently dropped a directory.

Add to `package.json` as `test:server-branch` and to `.github/workflows/ci.yml`.

---

## 9. Open decisions

### 9.1 Migration window
Phase 3 restarts all four pm2 processes (~15 s of bot downtime; in-flight WhatsApp messages retry,
nothing is lost — the bot reconnects). Options:
- **(a) Recommended** — do it in a low-traffic window (before 11:00 IST or after 23:00 IST), owner
  notified.
- (b) Do Phases 0–2 now and schedule Phase 3.

### 9.2 Runtime media — **RESOLVED: do not version**

See §4.2. Zero DB references, and `assets/images/*` are byte-identical duplicates of
`webhook-server/public/*`. ~1.7 MB of dead legacy media. Left untracked on the box; the deploy script
must never `git clean`.

### 9.3 The 798 MB `.git`
The history contains the 1,363-file vendored `PLAN/FoodHubbie-Customer APP by CLaude/FoodHubbie-Final/**`
from `e2db38f`. Branching does not shrink it. If the box ever needs reclaiming:
`git gc --aggressive --prune=now` (modest) or a fresh `git clone --single-branch --branch server`
into a new directory (large win, needs a pm2 path switch). **Out of scope** for this plan.

---

## 10. AGENTS.md changes required

The standing rule must be rewritten in the same commit that lands Phase 3, or a future session will
read *"never `git pull` there"* and refuse to deploy.

Replace, under **Key Decisions**:

> ~~EC2 `/var/www/foodhubbie` is a deployed worktree pinned at `c56175b` with a dirty `git status` BY
> DESIGN … **Never `git pull` there**.~~

with:

> **EC2 `/var/www/foodhubbie` tracks `origin/server` (2026-11-08).** `server` is the deploy branch:
> same tree as `main`, always an ancestor of `main`, never diverged. Server work is committed on
> `server`; frontend work stays on `main` and never reaches the box. Deploy with
> `bash tools/server-deploy.sh` on EC2 — it refuses to run over hand-edited tracked files, syntax-checks
> every changed file, and rolls back on failure. The box keeps the **full tree** (sparse-checkout was
> tried and reverted — it deleted ignored runtime files), so `Admin/`/`menu/`/`website/` are present
> but unused; hosting deploys run from the dev machine only. Runtime media
> (`assets/images/*.jpg`, `webhook-server/public/*.jpg`) and `bot/service-account.json` /
> `bot/session_data_*/` are box-local and must never be `git clean`ed.

Plus a new **Relevant Files** entry for `tools/server-deploy.sh` and `tools/check-server-branch.cjs`.

---

## 11. Honest limits

- **A branch does not make a box immutable.** Anyone can still `vim` a file on EC2; the deploy
  script's dirty check only *detects* it at the next deploy. Phase 5 turning that into a hard abort
  is the mitigation, not a cure.
- **`git merge --ff-only` protects against divergence, not against a bad commit.** Syntax checks
  catch typos; they do not catch logic errors. The existing bot unit suite (21 tests) should be run
  on the dev machine before pushing to `server` — add it to the pre-push habit.
- **Sparse-checkout is not safe here.** `git sparse-checkout init --cone` (empty cone) deleted
  `bot/node_modules`, `bot-control-api/node_modules`, `bot/service-account.json` and all
  `bot/session_data_*` on 2026-11-08. It stays off; the deploy script now refuses to restart when a
  required runtime path is missing.
- **The 105 untracked files are classified by pattern, not by inspection.** Phase 0's `.gitignore`
  covers the observed junk classes; anything genuinely useful that is currently untracked
  (`webhook-server/update-webhook-url.sh`, `bot-control-api/check-cake.js`) gets ignored rather than
  committed — if it matters, commit it deliberately before Phase 0.
- **This plan does not touch `webhook-server`'s untracked `public/` media or the pm2 `logrotate`
  module**, both of which live outside git by design.
