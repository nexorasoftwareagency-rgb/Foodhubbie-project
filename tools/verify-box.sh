#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# verify-box.sh - the provisioning gate for a Foodhubbie EC2 socket host.
#
#   bash /var/www/foodhubbie/tools/verify-box.sh
#
# Runs gates 1-22 of PLAN/BACKEND-ARCHITECTURE.md section 5.10 on THIS box and
# prints one PASS/FAIL line per gate. Exits 1 if any gate failed.
#
# Gates 16, 19, 20, 23 and 24 are manual:
#   16  send a real WhatsApp message and watch a reply arrive (proves the socket)
#   19  place a demo APP order and watch stock decrement (proves the cloud half)
#   20  mark that order Delivered and watch points credit
#   23  bash tools/server-deploy.sh must end with "401 = up, auth required"
#   24  sudo reboot, then re-run this script (proves pm2 startup + save)
#
# This script only READS. It never restarts, writes or repairs anything.
# ------------------------------------------------------------------------------
set -uo pipefail

REPO=${REPO:-/var/www/foodhubbie}
BRANCH=${BRANCH:-server}
BID=${BID:-roshani-pizza}
OID=${OID:-pizza}
API=https://api.foodhubbie.in/api/bot/status-all

PASS=0
FAIL=0
MANUAL=0

ok()   { printf 'PASS    %-32s %s\n' "$1" "${2:-}"; PASS=$((PASS + 1)); }
bad()  { printf 'FAIL    %-32s %s\n' "$1" "${2:-}"; FAIL=$((FAIL + 1)); }
man()  { printf 'MANUAL  %-32s %s\n' "$1" "${2:-}"; MANUAL=$((MANUAL + 1)); }
head1(){ printf '\n--- %s\n' "$1"; }

cd "$REPO" 2>/dev/null || { echo "FATAL: $REPO not found"; exit 1; }

# Load .env without exporting anything unexpected. Values are URL/token shaped
# (no spaces, no quotes), which is what section 5.5 of the plan requires.
if [ -f "$REPO/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$REPO/.env"
  set +a
fi

head1 "runtime"

# 1 - node version (require(esm) needs >= 22.12)
NODE_V=$(node -v 2>/dev/null | sed 's/^v//')
if [ -z "$NODE_V" ]; then
  bad "1 node version" "node not found"
else
  NODE_MAJOR=${NODE_V%%.*}
  NODE_MINOR=$(printf '%s' "$NODE_V" | cut -d. -f2)
  if [ "$NODE_MAJOR" -gt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -ge 12 ]; }; then
    ok "1 node version" "v$NODE_V"
  else
    bad "1 node version" "v$NODE_V - need >= 22.12 for require(esm)"
  fi
fi

# 2 - pm2 present and owned by this user
if command -v pm2 >/dev/null 2>&1; then
  ok "2 pm2" "$(pm2 -v 2>/dev/null | tail -1)"
else
  bad "2 pm2" "pm2 not installed"
fi

head1 "repository"

# 3 - branch
CURRENT=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
if [ "$CURRENT" = "$BRANCH" ]; then
  ok "3 branch" "$CURRENT @ $(git rev-parse --short HEAD)"
else
  bad "3 branch" "on '$CURRENT', expected '$BRANCH'"
fi

# 3b - no hand-edited tracked files (that is how drift starts)
DIRTY=$(git status --porcelain --untracked-files=no 2>/dev/null)
if [ -z "$DIRTY" ]; then
  ok "3b clean tree" "no tracked modifications"
else
  bad "3b clean tree" "$(printf '%s' "$DIRTY" | wc -l) modified tracked file(s)"
fi

# 4 - bot dependencies
if node -e "require('$REPO/bot/node_modules/firebase-admin')" >/dev/null 2>&1; then
  ok "4 bot deps" "firebase-admin resolvable"
else
  bad "4 bot deps" "run: npm ci --prefix bot"
fi

# 5 - service account
SA=${GOOGLE_APPLICATION_CREDENTIALS:-$REPO/bot/service-account.json}
if [ -f "$SA" ]; then
  PROJ=$(node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync('$SA','utf8')).project_id||''))" 2>/dev/null)
  if [ "$PROJ" = "foodhubbie-10" ]; then
    ok "5 service account" "project_id=$PROJ"
  else
    bad "5 service account" "project_id='$PROJ', expected foodhubbie-10"
  fi
else
  bad "5 service account" "missing $SA"
fi

# 6 - .env permissions
if [ -f "$REPO/.env" ]; then
  PERM=$(stat -c %a "$REPO/.env" 2>/dev/null || echo "?")
  if [ "$PERM" = "600" ]; then
    ok "6 .env perms" "600"
  else
    bad "6 .env perms" "$PERM - run: chmod 600 .env"
  fi
else
  bad "6 .env perms" ".env missing"
fi

head1 "database (read-only)"

# 7 / 15 / 17 / 18 / 21 come from one admin-SDK pass
NODECHK=$(mktemp)
cat > "$NODECHK" <<'JSEOF'
const REPO = process.env.FH_REPO || '/var/www/foodhubbie';
const BID = process.env.FH_BID || 'roshani-pizza';
const OID = process.env.FH_OID || 'pizza';
const base = `businesses/${BID}/outlets/${OID}`;
const out = (s, n, d) => console.log(`${s}|${n}|${d || ''}`);

let admin;
try {
  admin = require(`${REPO}/bot/node_modules/firebase-admin`);
} catch (e) {
  out('FAIL', '7 db reachable', 'firebase-admin not resolvable');
  process.exit(0);
}

try {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://foodhubbie-10-default-rtdb.firebaseio.com',
    });
  }
} catch (e) {
  out('FAIL', '7 db reachable', e.message);
  process.exit(0);
}

const db = admin.database();
const get = async (p) => (await db.ref(p).once('value')).val();

(async () => {
  let cfg;
  try {
    cfg = await get('config');
    out('PASS', '7 db reachable', 'config readable');
  } catch (e) {
    out('FAIL', '7 db reachable', e.message);
    return;
  }

  try {
    const pair = await get(`${base}/bot/pair/status`);
    if (pair === 'connected') out('PASS', '15 pairing', 'connected');
    else out('FAIL', '15 pairing', `status='${pair || 'absent'}' - re-pair by QR`);
  } catch (e) { out('FAIL', '15 pairing', e.message); }

  try {
    const st = await get(`${base}/botStatus`);
    const age = st && st.updatedAt ? Math.round((Date.now() - Number(st.updatedAt)) / 60000) : null;
    if (age === null) out('FAIL', '17 liveness fresh', 'no botStatus.updatedAt');
    else if (age <= 2) out('PASS', '17 liveness fresh', `${age} min old, status=${st.status}`);
    else out('FAIL', '17 liveness fresh', `${age} min old - status-watcher not running?`);
  } catch (e) { out('FAIL', '17 liveness fresh', e.message); }

  const flags = ['pushRelay', 'orderFinalizer', 'loyaltyRelay', 'riderRelay'];
  const off = flags.filter((f) => !cfg || !cfg[f] || cfg[f].enabled !== true);
  if (off.length === 0) out('PASS', '18 relay flags', 'all four enabled');
  else out('FAIL', '18 relay flags', `not true: ${off.join(', ')}`);

  try {
    const ph = await get('platformHealth/state');
    const age = ph && ph.checkedAt ? Math.round((Date.now() - Number(ph.checkedAt)) / 60000) : null;
    if (age === null) out('FAIL', '21 platformHealth', 'no platformHealth/state.checkedAt');
    else if (age <= 70 && ph.apiOk === true) out('PASS', '21 platformHealth', `${age} min old, apiOk=true`);
    else out('FAIL', '21 platformHealth', `${age} min old, apiOk=${ph.apiOk}, state=${ph.state}`);
  } catch (e) { out('FAIL', '21 platformHealth', e.message); }

  try { await db.goOffline(); } catch (_) {}
  process.exit(0);
})();
JSEOF

NODE_OUT=$(FH_REPO="$REPO" FH_BID="$BID" FH_OID="$OID" node "$NODECHK" 2>/dev/null)
rm -f "$NODECHK"
while IFS='|' read -r s n d; do
  case "$s" in
    PASS) ok "$n" "$d" ;;
    FAIL) bad "$n" "$d" ;;
  esac
done <<< "$NODE_OUT"

# If the probe died before printing anything (missing deps, bad credentials,
# no network) every one of its five gates is a failure, not a silent omission.
if [ -z "$NODE_OUT" ]; then
  bad "7 db reachable" "node probe produced no output"
  bad "15 pairing" "node probe produced no output"
  bad "17 liveness fresh" "node probe produced no output"
  bad "18 relay flags" "node probe produced no output"
  bad "21 platformHealth" "node probe produced no output"
fi

head1 "processes"

# 8 - bot online
BOT_PID=$(pm2 pid "bot-roshani-pizza-pizza" 2>/dev/null | tr -d '[:space:]')
if [ -n "$BOT_PID" ] && [ "$BOT_PID" != "0" ]; then
  ok "8 bot online" "pid $BOT_PID"
else
  bad "8 bot online" "bot-roshani-pizza-pizza not running"
fi

# 9 / 10 - tenant pinning and transport, from the bot's own log
BOTLOG="$HOME/.pm2/logs/bot-roshani-pizza-pizza-out.log"
if [ -f "$BOTLOG" ]; then
  TAIL=$(tail -n 400 "$BOTLOG" 2>/dev/null)
  if printf '%s' "$TAIL" | grep -q "\[TENANT\] outlet=$OID business=$BID"; then
    ok "9 tenant pinned" "[TENANT] outlet=$OID business=$BID"
  else
    bad "9 tenant pinned" "no [TENANT] line - BUSINESS_ID missing?"
  fi
  if printf '%s' "$TAIL" | grep -qi "transport=baileys"; then
    ok "10 transport" "baileys"
  else
    man "10 transport" "no transport line in the last 400 rows"
  fi
else
  bad "9 tenant pinned" "log file missing: $BOTLOG"
  bad "10 transport" "log file missing: $BOTLOG"
fi

# 11 - bot health endpoint (HEALTH_PORT is 3001+ and binds 0.0.0.0)
HEALTH=""
for p in $(seq 3001 3010); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 1 "http://127.0.0.1:$p/health" 2>/dev/null)
  if [ "$code" = "200" ]; then HEALTH=$p; break; fi
done
if [ -n "$HEALTH" ]; then
  ok "11 bot health" "127.0.0.1:$HEALTH/health -> 200"
else
  bad "11 bot health" "no /health on 3001-3010"
fi

head1 "api + tls"

# 12 - API on loopback
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${BOT_CONTROL_PORT:-4000}/api/bot/status-all" 2>/dev/null)
if [ "$CODE" = "401" ]; then
  ok "12 api loopback" "401 (up, auth required)"
else
  bad "12 api loopback" "HTTP $CODE - expected 401"
fi

# 13 - API over TLS
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$API" 2>/dev/null)
if [ "$CODE" = "401" ]; then
  ok "13 api via tls" "401"
else
  bad "13 api via tls" "HTTP $CODE - expected 401 (Caddy / DNS)"
fi

# 14 - certificate actually validates
if curl -sI --max-time 10 "https://api.foodhubbie.in" >/dev/null 2>&1; then
  ok "14 certificate" "TLS handshake verified"
else
  bad "14 certificate" "TLS handshake failed"
fi

head1 "hygiene"

# 22 - egress smoke: no single socket should have pulled tens of megabytes.
# This is the batch-11/14/15 bug class (a whole-tree listener). It is a smoke
# test, not a measurement - run it after an hour of uptime to be meaningful.
if command -v ss >/dev/null 2>&1; then
  WORST=$(ss -tnpi 2>/dev/null | awk '
    /users:\(\(/ { if (match($0, /pid=[0-9]+/)) pid = substr($0, RSTART + 4, RLENGTH - 4) }
    /bytes_received:/ { if (match($0, /bytes_received:[0-9]+/)) { v = substr($0, RSTART + 15, RLENGTH - 15) + 0; if (v > max) { max = v; who = pid } } }
    END { printf "%d %s", max, (who == "" ? "-" : who) }')
  BYTES=$(printf '%s' "$WORST" | cut -d' ' -f1)
  WHO=$(printf '%s' "$WORST" | cut -d' ' -f2)
  MB=$((BYTES / 1048576))
  if [ "$BYTES" -lt 104857600 ]; then
    ok "22 egress smoke" "largest socket ${MB} MB (pid $WHO)"
  else
    bad "22 egress smoke" "largest socket ${MB} MB (pid $WHO) - suspect a whole-tree listener"
  fi
else
  man "22 egress smoke" "ss unavailable"
fi

head1 "manual gates (cannot be automated)"
man "16 socket is real" "send a WhatsApp message, watch a reply arrive"
man "19 cloud finalizes" "place a demo APP order, stock must decrement"
man "20 cloud loyalty" "mark it Delivered, points must credit"
man "23 deploy script" "bash tools/server-deploy.sh must end with 401 = up"
man "24 reboot survival" "sudo reboot, wait 90 s, re-run this script"

printf '\n%d passed, %d failed, %d manual\n' "$PASS" "$FAIL" "$MANUAL"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
