#!/bin/bash
# EC2 tunnel keep-alive (cron */2). Two jobs:
#   1. Restart either cloudflared tunnel if its process died (survives nothing today —
#      no systemd, no pm2; EC2 reboot or OOM kill = silent death).
#   2. When the :4000 (bot-control-api) trycloudflare URL changes, sync it to RTDB
#      config/tunnelUrl — the admin app reads it to reach /tenant-api/notify.
# The :5000 (webhook) URL→Meta re-registration is already handled by
# update-webhook-url.sh (cron */5) — this script only keeps its process alive.
# trycloudflare hands out a NEW URL on every start; logfiles are how we read it.

LOG4000="/home/ubuntu/cloudflared-4000.log"
LOG5000="/home/ubuntu/cloudflared-quick.log"
STATE="/var/www/foodhubbie/.last-tunnel-url-4000"
KEEPALIVE_LOG="/home/ubuntu/tunnel-keepalive.log"
BIN="/usr/local/bin/cloudflared"

if ! pgrep -f "cloudflared tunnel --url http://localhost:5000" >/dev/null; then
  echo "$(date): :5000 dead — restarting" >> "$KEEPALIVE_LOG"
  nohup "$BIN" tunnel --url http://localhost:5000 --logfile "$LOG5000" >/dev/null 2>&1 &
  sleep 5
fi

if ! pgrep -f "cloudflared tunnel --url http://localhost:4000" >/dev/null; then
  echo "$(date): :4000 dead — restarting" >> "$KEEPALIVE_LOG"
  nohup "$BIN" tunnel --url http://localhost:4000 --logfile "$LOG4000" >/dev/null 2>&1 &
  sleep 8
fi

CURRENT=$(grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' "$LOG4000" 2>/dev/null | tail -1)
LAST=$(cat "$STATE" 2>/dev/null)
if [ -n "$CURRENT" ] && [ "$CURRENT" != "$LAST" ]; then
  echo "$(date): :4000 URL changed ${LAST:-<none>} -> $CURRENT — syncing RTDB" >> "$KEEPALIVE_LOG"
  if node /var/www/foodhubbie/tools/sync-tunnel-url-ec2.cjs "$CURRENT"; then
    echo "$CURRENT" > "$STATE"
  else
    echo "$(date): RTDB sync FAILED (will retry next run)" >> "$KEEPALIVE_LOG"
  fi
fi
