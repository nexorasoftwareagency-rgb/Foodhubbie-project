#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Deploy the `server` branch on the EC2 box.
#
#   bash /var/www/foodhubbie/tools/server-deploy.sh
#
# This is the ONLY deploy path for server code (docs/PLAN-SERVER-BRANCH.md).
# It refuses to deploy over hand-edited tracked files (that is how drift
# starts), fast-forwards to origin/server, syntax-checks every changed
# JS/CJS/MJS, then restarts every pm2 app whose script lives in this repo.
#
# It never runs `git clean` — box-local runtime media, sessions and
# service-account.json stay exactly where they are.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

REPO=/var/www/foodhubbie
BRANCH=server
cd "$REPO" || { echo "ABORT: $REPO not found"; exit 1; }

current=$(git rev-parse --abbrev-ref HEAD)
if [ "$current" != "$BRANCH" ]; then
  echo "ABORT: on branch '$current', expected '$BRANCH'."
  echo "       Fix: git checkout -f -B $BRANCH origin/$BRANCH"
  exit 1
fi

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "ABORT: tracked files were modified on this box — that is how drift starts."
  git status --short --untracked-files=no
  echo "Reconcile them (git checkout -- <file>) or commit the change on the dev machine."
  exit 1
fi

before=$(git rev-parse HEAD)
git fetch --prune origin "$BRANCH" || { echo "ABORT: git fetch failed"; exit 1; }

if ! git merge --ff-only "origin/$BRANCH"; then
  echo "ABORT: origin/$BRANCH is not a fast-forward of $before."
  echo "       The server branch must always be an ancestor of main."
  exit 1
fi
after=$(git rev-parse HEAD)

if [ "$before" = "$after" ]; then
  echo "already up to date at $after"
  exit 0
fi

echo "deploying ${before:0:7} -> ${after:0:7}"

# ── syntax gate ──────────────────────────────────────────────────────────────
# node --check rejects unknown extensions (.new), so check through /tmp/fhcheck.<ext>.
fail=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  [ -f "$f" ] || continue
  ext=${f##*.}
  cp "$f" "/tmp/fhcheck.$ext"
  if ! node --check "/tmp/fhcheck.$ext" >/dev/null 2>&1; then
    echo "SYNTAX FAIL: $f"
    node --check "/tmp/fhcheck.$ext" 2>&1 | head -4
    fail=1
  fi
  rm -f "/tmp/fhcheck.$ext"
done < <(git diff --name-only "$before" "$after" -- '*.js' '*.cjs' '*.mjs')

if [ "$fail" != "0" ]; then
  echo "ROLLBACK: git reset --hard $before"
  git reset --hard "$before" >/dev/null
  exit 1
fi

# ── restart every running pm2 app that lives in this repo ────────────────────
# Derived from pm2, not hard-coded: a new tenant bot is picked up automatically,
# and `status === "stopped"` apps are never resurrected.
mapfile -t apps < <(pm2 jlist 2>/dev/null | node -e '
let d = "";
process.stdin.on("data", c => d += c).on("end", () => {
  let list = [];
  try { list = JSON.parse(d); } catch { process.exit(0); }
  for (const p of list) {
    const env = p.pm2_env || {};
    if (env.status === "stopped") continue;
    if ((env.pm_exec_path || "").startsWith("/var/www/foodhubbie/")) console.log(p.name);
  }
});')

if [ ${#apps[@]} -eq 0 ]; then
  echo "WARN: no running pm2 app found under $REPO — nothing restarted"
else
  echo "restarting: ${apps[*]}"
  pm2 restart "${apps[@]}" --update-env >/dev/null 2>&1
fi

sleep 10
if [ ${#apps[@]} -gt 0 ]; then
  pm2 list --no-color | grep -E "$(printf '%s|' "${apps[@]}" | sed 's/|$//')" || true
fi

http=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4000/api/bot/status-all)
echo "control-api /api/bot/status-all => HTTP $http (401 = up, auth required)"
if [ "$http" != "401" ]; then
  echo "WARNING: expected 401. Inspect: pm2 logs bot-control-api --lines 80 --nostream"
  exit 1
fi

echo "deployed $after"
