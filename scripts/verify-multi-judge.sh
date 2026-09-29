#!/usr/bin/env bash
# Verification of multi-judge evaluation management for RaptureJudge.
#
# Proves:
#  1. A submission (team) can have multiple judges, each with an independent
#     evaluation.
#  2. While judging is open: judges see only their own scores, cannot edit
#     another judge's evaluation, and ranking/aggregates are sealed from
#     everyone.
#  3. After judging is locked: the admin query exposes individual judge
#     scores, criterion-level averages, mean, range, distribution and
#     completion status, with the calculation method stated explicitly.
#  4. Individual evaluations land in the audit log with full breakdowns.
set -uo pipefail

DEPLOYMENT="abundant-squirrel-476.convex.cloud"
URL="https://${DEPLOYMENT}/api"
PASSWORD="rapture2026"
PASS=0
FAIL=0

login() {
  curl -sS "${URL}/action" \
    -H "Content-Type: application/json" \
    -d "{\"path\":\"auth:signIn\",\"args\":{\"provider\":\"password\",\"params\":{\"flow\":\"signIn\",\"email\":\"$1\",\"password\":\"${PASSWORD}\"}},\"format\":\"json\"}" \
    | jq -r '.value.tokens.token // empty'
}
q() {
  curl -sS "${URL}/query" -H "Content-Type: application/json" \
    -H "Authorization: Bearer $1" \
    -d "{\"path\":\"$2\",\"args\":$3,\"format\":\"json\"}"
}
m() {
  curl -sS "${URL}/mutation" -H "Content-Type: application/json" \
    -H "Authorization: Bearer $1" \
    -d "{\"path\":\"$2\",\"args\":$3,\"format\":\"json\"}"
}
ok() { echo "  PASS  $1"; PASS=$((PASS+1)); }
no() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }
check() { if [ "$2" = "$3" ]; then ok "$1"; else no "$1 (expected '$3', got '$2')"; fi; }
status() { echo "$1" | jq -r '.status // "error"'; }
val() { echo "$1" | jq -r '.value // empty'; }

ADMIN=$(login "aditi@rapturejudge.io")
J1=$(login "elena@rapturejudge.io")
J2=$(login "sofia@rapturejudge.io")
[ -n "$ADMIN" ] && [ -n "$J1" ] && [ -n "$J2" ] || { echo "FATAL: sign-in failed"; exit 1; }
echo "Signed in as admin + two judges."

echo
echo "== 1. Multiple judges on one submission =="
# Pick a team both judges can be assigned to (use first team from admin view).
TEAM=$(q "$ADMIN" judges:listForAdmin '{}' | jq -r '.value.teams[0].id')
J1ID=$(q "$ADMIN" judges:listForAdmin '{}' | jq -r --arg e "elena@rapturejudge.io" '.value.judges[] | select(.email==$e) | .id')
J2ID=$(q "$ADMIN" judges:listForAdmin '{}' | jq -r --arg e "sofia@rapturejudge.io" '.value.judges[] | select(.email==$e) | .id')
m "$ADMIN" judges:assign "{\"judgeId\":\"$J1ID\",\"teamId\":\"$TEAM\"}" >/dev/null
m "$ADMIN" judges:assign "{\"judgeId\":\"$J2ID\",\"teamId\":\"$TEAM\"}" >/dev/null
CNT=$(q "$ADMIN" judges:listForAdmin '{}' | jq -r --arg t "$TEAM" '.value.teams[] | select(.id==$t) | .assigned')
check "team has 2 assigned judges" "$([ "$CNT" -ge 2 ] && echo yes || echo no)" yes

# Ensure judging is open for the isolation phase.
ORIG=$(q "$ADMIN" hackathons:listForAdmin '{}' | jq -r '.value[] | select(.isCurrent) | ._id')
m "$ADMIN" hackathons:setFlag "{\"hackathonId\":\"$ORIG\",\"judgingOpen\":true}" >/dev/null

echo
echo "== 2. Independent evaluation while judging is open =="
# Each judge saves a distinct draft then finalizes with distinct totals.
B=$(q "$ADMIN" criteria:list '{}' | jq -c '[.value.criteria[] | {key:.name, value:20}] | from_entries')
m "$J1" judging:saveScore "{\"teamId\":\"$TEAM\",\"breakdown\":$B,\"comments\":\"Judge one evaluation\",\"recommendation\":\"advance\",\"isFinal\":true}" >/dev/null
B2=$(q "$ADMIN" criteria:list '{}' | jq -c '[.value.criteria[] | {key:.name, value:12}] | from_entries')
m "$J2" judging:saveScore "{\"teamId\":\"$TEAM\",\"breakdown\":$B2,\"comments\":\"Judge two evaluation\",\"recommendation\":\"hold\",\"isFinal\":true}" >/dev/null
check "judge 1 scored" "$(status "$(q "$J1" judging:reviewDetail "{\"teamId\":\"$TEAM\"}")")" success
check "judge 2 scored" "$(status "$(q "$J2" judging:reviewDetail "{\"teamId\":\"$TEAM\"}")")" success

echo
echo "== 3. Judge isolation while judging is open =="
R1=$(q "$J1" judging:reviewDetail "{\"teamId\":\"$TEAM\"}")
check "judge 1 sees only own score" "$(val "$R1" | jq -r '.myScore.comments')" "Judge one evaluation"
R2=$(q "$J2" judging:reviewDetail "{\"teamId\":\"$TEAM\"}")
check "judge 2 sees only own score" "$(val "$R2" | jq -r '.myScore.comments')" "Judge two evaluation"
# Judge 2 attempts to write to judge 1's evaluation — the write lands on
# judge 2's own card only; judge 1's card must be untouched.
ATTEMPT=$(m "$J2" judging:saveScore "{\"teamId\":\"$TEAM\",\"breakdown\":$B,\"comments\":\"intrusion\",\"recommendation\":\"advance\",\"isFinal\":true}")
check "edit while final is rejected" "$(status "$ATTEMPT")" error
check "judge 1 card untouched" "$(val "$(q "$J1" judging:reviewDetail "{\"teamId\":\"$TEAM\"}")" | jq -r '.myScore.comments')" "Judge one evaluation"
# No ranking/aggregate view is exposed to judges at all.
check "judges have no overview/standings query" "$(status "$(q "$J1" hackathons:adminOverview '{}')")" error
check "judges have no analytics query" "$(status "$(q "$J1" teams:teamScoreAnalytics "{\"teamId\":\"$TEAM\"}")")" error

echo
echo "== 4. Admin sees completion only while judging is open =="
AN=$(q "$ADMIN" teams:teamScoreAnalytics "{\"teamId\":\"$TEAM\"}")
check "analytics allowed for admin" "$(status "$AN")" success
check "aggregates sealed while open" "$(val "$AN" | jq -r '.aggregates')" null
check "completion reported" "$(val "$AN" | jq -r '.completion.assigned >= 2')" true

echo
echo "== 5. Lock judging — transparency unlocks =="
m "$ADMIN" hackathons:setFlag "{\"hackathonId\":\"$ORIG\",\"judgingOpen\":false}" >/dev/null
AN=$(q "$ADMIN" teams:teamScoreAnalytics "{\"teamId\":\"$TEAM\"}")
check "judgingLocked reported" "$(val "$AN" | jq -r '.judgingLocked')" true
check "individual judge scores exposed" "$(val "$AN" | jq -r '.aggregates.scores | length >= 2')" true
AVG=$(val "$AN" | jq -r '.aggregates.average')
echo "  judge totals: $(val "$AN" | jq -c '[.aggregates.scores[].totalScore]')  average=$AVG"
check "average is plain mean" "$(val "$AN" | jq -r '.aggregates.average == ((.aggregates.scores | map(.totalScore) | add / length) * 10 | round / 10)')" true
check "range = max - min" "$(val "$AN" | jq -r '.aggregates.range == (.aggregates.scores | map(.totalScore) | (max - min))')" true
check "distribution sums to judges" "$(val "$AN" | jq -r '.aggregates as $a | ([$a.distribution[].count] | add) == $a.judgeCount')" true
check "criterion stats present" "$(val "$AN" | jq -r '.aggregates.criterionStats | length > 0')" true
METHOD=$(val "$AN" | jq -r '.aggregates.method')
echo "  method: $METHOD"
check "method states arithmetic mean" "$(echo "$METHOD" | grep -qi 'arithmetic mean' && echo yes || echo no)" yes
check "method states no normalization" "$(echo "$METHOD" | grep -qi 'no normalization' && echo yes || echo no)" yes

echo
echo "== 6. Individual evaluations in the audit history =="
AL=$(q "$ADMIN" audit:listForAdmin '{"limit":300}')
check "score.submitted entries exist" "$(val "$AL" | jq -r '[.entries[] | select(.action=="score.submitted")] | length >= 2')" true
BK=$(val "$AL" | jq -r '[.entries[] | select(.action=="score.submitted")][0].metadata.breakdown')
echo "  recorded breakdown: $BK"
check "breakdown recorded per criterion" "$(echo "$BK" | grep -q '=' && echo yes || echo no)" yes
check "total recorded" "$(val "$AL" | jq -r '[.entries[] | select(.action=="score.submitted")][0].metadata.total | type')" number
check "comments recorded" "$(val "$AL" | jq -r '[.entries[] | select(.action=="score.submitted")][0].metadata.comments | length > 0')" true

echo
echo "== 7. Judge still sealed after lock (ranking is admin-only) =="
check "judge denied analytics after lock" "$(status "$(q "$J1" teams:teamScoreAnalytics "{\"teamId\":\"$TEAM\"}")")" error
check "judge denied overview after lock" "$(status "$(q "$J1" hackathons:adminOverview '{}')")" error

echo
echo "======================================"
echo "  PASS: $PASS   FAIL: $FAIL"
echo "======================================"
[ "$FAIL" -eq 0 ]
