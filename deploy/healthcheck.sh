#!/usr/bin/env bash
# OpenCard healthcheck: site reachability, containers, disk. Emails the
# operator on state CHANGES only (fail->ok, ok->fail) via the app's own SMTP
# (docker exec into a web container). Run from cron every 5 minutes.
#
# Config: /opt/opencard/deploy/healthcheck.env with ALERT_EMAIL="you@example.com"
set -uo pipefail

APP_DIR="/opt/opencard"
STATE_FILE="$APP_DIR/.health_state"
ENV_FILE="$APP_DIR/deploy/healthcheck.env"
ALERT_EMAIL=""
[ -f "$ENV_FILE" ] && source "$ENV_FILE"

PROBLEMS=""

# 1) Site checks through the full local stack (Caddy + app).
for host in opencard.id tapshare.cards; do
  code=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$host:443:127.0.0.1" "https://$host/healthz" || echo 000)
  [ "$code" = "200" ] || PROBLEMS="$PROBLEMS site:$host=$code"
done

# 2) Containers up (web_a + web_b since the zero-downtime split).
for c in opencard-web_a-1 opencard-web_b-1 opencard-db-1 opencard-caddy-1; do
  state=$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo missing)
  [ "$state" = "running" ] || PROBLEMS="$PROBLEMS container:$c=$state"
done

# 3) Disk usage on /.
usage=$(df --output=pcent / | tail -1 | tr -dc '0-9')
[ "${usage:-0}" -lt 90 ] || PROBLEMS="$PROBLEMS disk:${usage}%"

NOW_STATE="ok"
[ -n "$PROBLEMS" ] && NOW_STATE="fail"
PREV_STATE="$(cat "$STATE_FILE" 2>/dev/null || echo ok)"
echo "$NOW_STATE" > "$STATE_FILE"

[ "$NOW_STATE" = "$PREV_STATE" ] && exit 0   # no change, no noise
[ -z "$ALERT_EMAIL" ] && { echo "state change ($PREV_STATE -> $NOW_STATE) but no ALERT_EMAIL configured"; exit 0; }

if [ "$NOW_STATE" = "fail" ]; then
  SUBJ="[OpenCard ALERT] problems on $(hostname)"
  BODY="Healthcheck failing at $(date -u '+%F %T UTC'):${PROBLEMS}

Checks: site /healthz (both domains), containers, disk <90%.
This alert fires once per state change."
else
  SUBJ="[OpenCard OK] recovered on $(hostname)"
  BODY="All checks passing again at $(date -u '+%F %T UTC')."
fi

# Send via the app's SMTP config inside a web container (either instance).
# If both are down, this can't send — pair with an external uptime monitor.
MAILER="opencard-web_a-1"
docker inspect -f '{{.State.Status}}' "$MAILER" 2>/dev/null | grep -q running || MAILER="opencard-web_b-1"
docker exec "$MAILER" node -e '
const n=require("nodemailer");
const t=n.createTransport({host:process.env.SMTP_HOST,port:parseInt(process.env.SMTP_PORT||"587"),secure:process.env.SMTP_PORT==="465",auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}:undefined});
t.sendMail({from:process.env.SMTP_FROM,to:process.argv[1],subject:process.argv[2],text:process.argv[3]})
 .then(()=>console.log("alert sent")).catch(e=>{console.error("alert failed:",String(e.message||e));process.exit(1);});
' "$ALERT_EMAIL" "$SUBJ" "$BODY" || echo "could not send alert email"
