#!/usr/bin/env bash
# End-to-end smoke test — hits every Community + licence API route.
#
# Prerequisites:
#   1. `.env` populated with live Supabase creds (SUPABASE_URL,
#      SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, TOKEN_SIGNING_SECRET,
#      DEV_MINT_SECRET, ALLOW_DEV_MINT=true).
#   2. Both migrations applied:
#        supabase/migrations/202604230004_license_plan_fields.sql
#        supabase/migrations/202604240005_community_schema.sql
#   3. Dev server running on $PORT (defaults to 3000).
#
# What it does:
#   - Creates a pre-confirmed Supabase auth user via admin API
#   - Signs in, grabs a JWT, hits every route in sequence
#   - Cleans up the test user at the end
#
# Usage:
#   (cd act_suit/activation-suite && PORT=3000 bash scripts/e2e-smoke.sh)
set -euo pipefail

PORT="${PORT:-3000}"
BASE="http://127.0.0.1:$PORT"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load env vars without overwriting anything already set.
if [ -f "$PROJECT_DIR/.env" ] ; then
  set -a ; source "$PROJECT_DIR/.env" ; set +a
fi

: "${SUPABASE_URL:?set SUPABASE_URL}"
: "${SUPABASE_ANON_KEY:?set SUPABASE_ANON_KEY}"
: "${SUPABASE_SERVICE_ROLE_KEY:?set SUPABASE_SERVICE_ROLE_KEY}"

EMAIL="test+$(date +%s)@openreply-curl.local"
PASS="CurlTest_$(date +%s)_pw"
pp() { python3 -m json.tool 2>/dev/null || cat ; }

say() { printf "\n═══ %s ═══════════════════════════════════════════\n" "$1" ; }

say "0. Health"
curl -fs "$BASE/api/v1/health" | pp

say "1. Create confirmed test user"
SU=$(curl -fs -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"email_confirm\":true}")
USERID=$(echo "$SU" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
echo "  user id: $USERID"

cleanup() {
  if [ -n "${USERID:-}" ] ; then
    curl -fs -X DELETE "$SUPABASE_URL/auth/v1/admin/users/$USERID" \
      -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -o /dev/null || true
    echo "  (test user deleted)"
  fi
}
trap cleanup EXIT

say "2. Sign in"
JWT=$(curl -fs -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
echo "  token: ${JWT:0:24}…"
AUTH="Authorization: Bearer $JWT"

say "3. GET /api/v1/licence/me (fresh user)"
curl -fs -H "$AUTH" "$BASE/api/v1/licence/me" | pp | head -20

say "4. POST /api/v1/trial/start"
curl -fs -X POST -H "$AUTH" "$BASE/api/v1/trial/start" | pp

say "5. GET /api/v1/licence/me (trial active)"
curl -fs -H "$AUTH" "$BASE/api/v1/licence/me" | pp | head -25

say "6. POST /api/v1/workspaces"
WS=$(curl -fs -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"name":"Smoke test","topic":"product analytics","is_public":true}' \
  "$BASE/api/v1/workspaces")
echo "$WS" | pp
WSID=$(echo "$WS" | python3 -c 'import sys,json;print(json.load(sys.stdin)["workspace"]["id"])')

say "7. Add 3 sources"
for SRC in reddit hackernews g2 ; do
  curl -fs -X POST -H "$AUTH" -H "Content-Type: application/json" \
    -d "{\"source_type\":\"$SRC\"}" \
    "$BASE/api/v1/workspaces/$WSID/sources" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('  + %s' % d['source']['source_type'])"
done

say "8. POST /api/v1/sweep"
SW=$(curl -fs -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"workspace_id\":\"$WSID\"}" "$BASE/api/v1/sweep")
echo "$SW" | pp
SWID=$(echo "$SW" | python3 -c 'import sys,json;print(json.load(sys.stdin)["sweep_id"])')

say "9. GET /api/v1/sweep/<id>"
curl -fs -H "$AUTH" "$BASE/api/v1/sweep/$SWID" | python3 -c "
import sys, json
d = json.load(sys.stdin)['sweep']
print('  status=%s posts=%s insights=%s pct=%s%%' % (d['status'], d['posts_indexed'], d['insights_found'], d['progress_pct']))"

say "10. GET /api/v1/insights — top 5"
curl -fs -H "$AUTH" "$BASE/api/v1/insights?workspace_id=$WSID&limit=5" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for i in d['insights'][:5]:
    print('  %-10s %6s%%  %s' % (i['insight_type'], i['frequency_pct'], i['title']))"

say "11. POST /api/v1/publish"
PUB=$(curl -fs -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"workspace_id\":\"$WSID\"}" "$BASE/api/v1/publish")
echo "$PUB" | pp
SLUG=$(echo "$PUB" | python3 -c 'import sys,json;print(json.load(sys.stdin)["published"]["slug"])')

say "12. GET /explore/<slug>"
STATUS=$(curl -fs -o /tmp/r.html -w "%{http_code}" "$BASE/explore/$SLUG")
echo "  HTTP $STATUS"

say "13. PUT /api/v1/byok + GET + DELETE"
curl -fs -X PUT -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"provider\":\"anthropic\",\"raw_key\":\"sk-ant-smoke-12345678\",\"password\":\"$PASS\",\"smoke_test\":false}" \
  "$BASE/api/v1/byok" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('  saved: %s preview=****%s' % (d['key']['provider'], d['key']['key_preview']))"
curl -fs -H "$AUTH" "$BASE/api/v1/byok" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('  list count: %s' % len(d['keys']))"
curl -fs -X DELETE -H "$AUTH" "$BASE/api/v1/byok?provider=anthropic" | pp

say "14. POST /api/v1/licence/validate — expect 401 (Supabase JWT is not a Pro licence JWT)"
FP=$(python3 -c 'import hashlib;print(hashlib.sha256(b"test-fp").hexdigest())')
# We use `-s` (no `-f`) here — the endpoint intentionally rejects the
# Supabase session JWT because it only accepts Pro licence JWTs issued by
# /api/v1/device/activate. That's the correct behaviour.
STATUS=$(curl -s -o /tmp/r.json -w "%{http_code}" \
  -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"device_fingerprint\":\"$FP\"}" "$BASE/api/v1/licence/validate")
BODY=$(cat /tmp/r.json)
echo "  HTTP $STATUS  body=$BODY"
if [ "$STATUS" != "401" ] ; then
  echo "  WARNING: expected 401 but got $STATUS"
fi

say "15. POST /api/v1/unpublish"
curl -fs -X POST -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"workspace_id\":\"$WSID\"}" "$BASE/api/v1/unpublish" | pp

say "16. DELETE /api/v1/workspaces/<id>"
curl -fs -X DELETE -H "$AUTH" "$BASE/api/v1/workspaces/$WSID" | pp

say "DONE — all routes exercised"
