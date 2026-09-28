#!/usr/bin/env bash
# End-to-end role verification for RaptureJudge.
#
# Signs in as each demo role over the real Convex HTTP API, then calls the
# role-scoped queries and mutations with that user's real token. This proves the
# boundaries hold on the server, not merely in the UI.
set -uo pipefail

DEPLOYMENT="abundant-squirrel-476.convex.cloud"
URL="https://${DEPLOYMENT}/api"
PASSWORD="rapture2026"

login() {
  curl -sS "${URL}/action" \
    -H "Content-Type: application/json" \
    -d "{\"path\":\"auth:signIn\",\"args\":{\"provider\":\"password\",\"params\":{\"flow\":\"signIn\",\"email\":\"$1\",\"password\":\"${PASSWORD}\"}},\"format\":\"json\"}" \
    | jq -r '.value.tokens.token // empty'
}

query() {
  curl -sS "${URL}/query" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $1" \
    -d "{\"path\":\"$2\",\"args\":$3,\"format\":\"json\"}"
}

mutation() {
  curl -sS "${URL}/mutation" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $1" \
    -d "{\"path\":\"$2\",\"args\":$3,\"format\":\"json\"}"
}

# Convex JSON responses are {"status":"success","value":...} or
# {"status":"error","errorMessage":...}.
allowed() { [ "$(echo "$1" | jq -r '.status // empty')" = "success" ]; }

# ALLOWED / DENIED
verdict() {
  if allowed "$2"; then echo "ALLOWED"; else
    echo "DENIED  <- $(echo "$2" | jq -r '.errorMessage // "error"' 2>/dev/null | grep -oE 'This action requires[^\\"]*|You must be signed in[^\\"]*|You are not assigned[^\\"]*' | head -1)"
  fi
}

ADMIN=$(login "aditi@rapturejudge.io")
JUDGE=$(login "elena@rapturejudge.io")
PARTICIPANT=$(login "nikhil.okafor@rapture.dev")

for pair in "ADMIN:$ADMIN" "JUDGE:$JUDGE" "PARTICIPANT:$PARTICIPANT"; do
  [ -n "${pair#*:}" ] || { echo "FATAL: could not sign in ${pair%%:*}"; exit 1; }
done
echo "PASS  all three demo accounts signed in with a password"
echo

echo "=== Which role can reach which endpoint ==="
printf "%-28s %-10s %-10s %-12s\n" "endpoint" "admin" "judge" "participant"
for path in hackathons:adminOverview teams:adminTeams judging:myAssignments teams:myTeam session:me; do
  a=$(verdict x "$(query "$ADMIN" "$path" '{}')" | awk '{print $1}')
  j=$(verdict x "$(query "$JUDGE" "$path" '{}')" | awk '{print $1}')
  p=$(verdict x "$(query "$PARTICIPANT" "$path" '{}')" | awk '{print $1}')
  printf "%-28s %-10s %-10s %-12s\n" "$path" "$a" "$j" "$p"
done
echo

# --- Judge isolation: the core guarantee -----------------------------------
MY_IDS=$(query "$JUDGE" judging:myAssignments '{}' | jq -r '.value.assignments[].teamId')
MY_COUNT=$(echo "$MY_IDS" | grep -c .)
# A team the judge was NOT assigned to, taken from the admin registry.
OTHER_ID=$(query "$ADMIN" teams:adminTeams '{}' | jq -r ".value[].id" | grep -vxF -f <(echo "$MY_IDS") | head -1)
FIRST_MY=$(echo "$MY_IDS" | head -1)

echo "=== Judge isolation (judge has ${MY_COUNT} assigned teams) ==="
printf "%-44s %s\n" "reviewDetail on an ASSIGNED team" \
  "$(verdict x "$(query "$JUDGE" judging:reviewDetail "{\"teamId\":\"${FIRST_MY}\"}")")"
printf "%-44s %s\n" "reviewDetail on an UNASSIGNED team" \
  "$(verdict x "$(query "$JUDGE" judging:reviewDetail "{\"teamId\":\"${OTHER_ID}\"}")")"
echo

echo "=== Write isolation ==="
printf "%-44s %s\n" "participant saving a scorecard" \
  "$(verdict x "$(mutation "$PARTICIPANT" judging:saveScore "{\"teamId\":\"${FIRST_MY}\",\"breakdown\":{},\"comments\":\"\",\"recommendation\":\"advance\",\"isFinal\":true}")")"
printf "%-44s %s\n" "judge saving a scorecard for an UNASSIGNED team" \
  "$(verdict x "$(mutation "$JUDGE" judging:saveScore "{\"teamId\":\"${OTHER_ID}\",\"breakdown\":{},\"comments\":\"\",\"recommendation\":\"advance\",\"isFinal\":true}")")"
printf "%-44s %s\n" "admin reading the participant editor path" \
  "$(verdict x "$(mutation "$ADMIN" submissions:updateSubmission '{"abstract":"x","highlights":[]}')")"
echo

echo "=== Judge's own queue ==="
query "$JUDGE" judging:myAssignments '{}' \
  | jq -r '.value.assignments[] | "  \(.teamName)  [\(.trackName)]  status=\(.status)  final=\(.isFinal)  hasAiReview=\(.hasAiReview)"'
echo
echo "=== Judge's scorecards must not leak other judges' data ==="
DETAIL=$(query "$JUDGE" judging:reviewDetail "{\"teamId\":\"${FIRST_MY}\"}")
echo "  own scorecard present: $(echo "$DETAIL" | jq -r 'if .value.myScore then "yes" else "no" end')"
echo "  exposes another judge's scores: $(echo "$DETAIL" | jq -r 'if (.value | has("judgeId") or has("otherScores") or has("allScores") or has("scorecards")) then "YES (BAD)" else "no" end')"
echo
echo "=== Participant sees their team only ==="
query "$PARTICIPANT" teams:myTeam '{}' \
  | jq -r '"  team=\(.value.team.name)  track=\(.value.team.trackName)  members=\(.value.team.members | length)  assignedJudges=\(.value.reviewProgress.assignedJudges)"'
echo "  exposes any score field: $(query "$PARTICIPANT" teams:myTeam '{}' | jq -r 'if (.value | has("scores") or has("myScore") or has("standings")) then "YES (BAD)" else "no" end')"
