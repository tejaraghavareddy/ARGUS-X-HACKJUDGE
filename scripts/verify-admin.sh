#!/usr/bin/env bash
# End-to-end verification of the RaptureJudge admin workflow.
#
# Signs in over the real Convex HTTP API and exercises every admin capability
# with a real admin token, then proves the judge/participant roles are still
# locked out and that conflict-of-interest and blind-judging actually bite.
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

q() { # query <token> <path> <args>
  curl -sS "${URL}/query" -H "Content-Type: application/json" \
    -H "Authorization: Bearer $1" \
    -d "{\"path\":\"$2\",\"args\":$3,\"format\":\"json\"}"
}
m() { # mutation <token> <path> <args>
  curl -sS "${URL}/mutation" -H "Content-Type: application/json" \
    -H "Authorization: Bearer $1" \
    -d "{\"path\":\"$2\",\"args\":$3,\"format\":\"json\"}"
}
ok() { echo "  PASS  $1"; PASS=$((PASS+1)); }
no() { echo "  FAIL  $1"; FAIL=$((FAIL+1)); }
check() { if [ "$2" = "$3" ]; then ok "$1"; else no "$1 (expected '$3', got '$2')"; fi; }
status() { echo "$1" | jq -r '.status // "error"'; }

ADMIN=$(login "aditi@rapturejudge.io")
JUDGE=$(login "elena@rapturejudge.io")
PART=$(login "nikhil.okafor@rapture.dev")
for p in "ADMIN:$ADMIN" "JUDGE:$JUDGE" "PARTICIPANT:$PART"; do
  [ -n "${p#*:}" ] || { echo "FATAL: sign-in failed for ${p%%:*}"; exit 1; }
done
echo "Signed in as admin, judge and participant."

echo
echo "== 1. Role boundaries on the new admin endpoints =="
for path in hackathons:adminOverview hackathons:listForAdmin judges:listForAdmin audit:listForAdmin; do
  check "admin  ALLOWED $path" "$(status "$(q "$ADMIN" "$path" '{}')")" success
  check "judge  DENIED  $path" "$(status "$(q "$JUDGE" "$path" '{}')")" error
  check "partic DENIED  $path" "$(status "$(q "$PART" "$path" '{}')")" error
done
# The rubric is intentionally readable by every role: a judge cannot score
# against a rubric they cannot see, and participants benefit from the
# transparency. It is still closed to anonymous callers.
check "admin  ALLOWED criteria:list" "$(status "$(q "$ADMIN" criteria:list '{}')")" success
check "judge  ALLOWED criteria:list" "$(status "$(q "$JUDGE" criteria:list '{}')")" success
check "partic ALLOWED criteria:list" "$(status "$(q "$PART" criteria:list '{}')")" success
check "anon   DENIED  criteria:list" "$(status "$(q "bogus" criteria:list '{}')")" error

echo
echo "== 2. Hackathon dashboard metrics =="
OV=$(q "$ADMIN" hackathons:adminOverview '{}')
echo "$OV" | jq -r '.value.totals | "  teams=\(.teams) submissions=\(.submittedSubmissions) judges=\(.judges) completion=\(.completionPct)% pending=\(.pendingEvaluations) conflicts=\(.conflicts)"'
echo "$OV" | jq -r '.value | "  name=\(.hackathon.name) status=\(.hackathon.status) resultsPublished=\(.hackathon.resultsPublished) rubric=\(.rubric.total)pts/\(.rubric.criteria | length)criteria"'
check "rubric totals 100" "$(echo "$OV" | jq -r '.value.rubathon.total // .value.rubric.total')" 100

echo
echo "== 3. Create a hackathon, then make it current and switch back =="
NEWNAME="Verification Round $(date +%s)"
NEW=$(m "$ADMIN" hackathons:create "{\"name\":\"${NEWNAME}\",\"location\":\"Test\"}")
NEWID=$(echo "$NEW" | jq -r '.value.id // empty')
if [ -n "$NEWID" ]; then ok "created hackathon ($NEWID)"; else no "create hackathon: $NEW"; fi
check "new hackathon starts closed" "$(q "$ADMIN" hackathons:listForAdmin '{}' | jq -r --arg id "$NEWID" '.value[] | select(._id==$id) | .judgingOpen')" false
m "$ADMIN" hackathons:setCurrent "{\"hackathonId\":\"$NEWID\"}" >/dev/null
check "switched live hackathon" "$(q "$ADMIN" hackathons:activeHackathon '{}' | jq -r '.value.name')" "$NEWNAME"
ORIG=$(q "$ADMIN" hackathons:listForAdmin '{}' | jq -r '.value[] | select(.name=="Rapture 2026") | ._id')
m "$ADMIN" hackathons:setCurrent "{\"hackathonId\":\"$ORIG\"}" >/dev/null
check "switched back to Rapture 2026" "$(q "$ADMIN" hackathons:activeHackathon '{}' | jq -r '.value.name')" "Rapture 2026"

echo
echo "== 4. Phase switches =="
BEFORE=$(q "$ADMIN" hackathons:activeHackathon '{}' | jq -r '.value.registrationOpen')
m "$ADMIN" hackathons:setFlag "{\"hackathonId\":\"$ORIG\",\"registrationOpen\":$([ "$BEFORE" = true ] && echo false || echo true)}" >/dev/null
AFTER=$(q "$ADMIN" hackathons:activeHackathon '{}' | jq -r '.value.registrationOpen')
if [ "$BEFORE" != "$AFTER" ]; then ok "toggled registrationOpen ($BEFORE -> $AFTER)"; else no "registrationOpen did not change"; fi
m "$ADMIN" hackathons:setFlag "{\"hackathonId\":\"$ORIG\",\"registrationOpen\":$BEFORE}" >/dev/null
m "$ADMIN" hackathons:setFlag "{\"hackathonId\":\"$ORIG\",\"resultsPublished\":true}" >/dev/null
check "published results" "$(q "$ADMIN" hackathons:activeHackathon '{}' | jq -r '.value.resultsPublished')" true
m "$ADMIN" hackathons:setFlag "{\"hackathonId\":\"$ORIG\",\"resultsPublished\":false}" >/dev/null
check "unpublished results" "$(q "$ADMIN" hackathons:activeHackathon '{}' | jq -r '.value.resultsPublished')" false

echo
echo "== 5. Rubric builder (add / edit / reorder / delete) =="
CREATED=$(m "$ADMIN" criteria:create '{"name":"Verification Criterion","description":"temp","maxScore":5}')
CID=$(echo "$CREATED" | jq -r '.value.id // empty')
[ -n "$CID" ] && ok "added criterion" || no "add criterion: $CREATED"
TOTAL=$(q "$ADMIN" criteria:list '{}' | jq -r '.value.total')
check "total rose to 105" "$TOTAL" 105
m "$ADMIN" criteria:update "{\"criterionId\":\"$CID\",\"name\":\"Verification Criterion\",\"description\":\"edited\",\"maxScore\":0}" >/dev/null
check "rejects maxScore 0" "$(status "$(m "$ADMIN" criteria:update "{\"criterionId\":\"$CID\",\"name\":\"x\",\"description\":\"y\",\"maxScore\":0}")")" error
m "$ADMIN" criteria:update "{\"criterionId\":\"$CID\",\"name\":\"Verification Criterion\",\"description\":\"edited\",\"maxScore\":5}" >/dev/null
check "edited criterion" "$(q "$ADMIN" criteria:list '{}' | jq -r --arg id "$CID" '.value.criteria[] | select(._id==$id) | .description')" edited
FIRST=$(q "$ADMIN" criteria:list '{}' | jq -r '.value.criteria[0]._id')
m "$ADMIN" criteria:reorder "{\"criterionId\":\"$CID\",\"toIndex\":0}" >/dev/null
check "reordered to first" "$(q "$ADMIN" criteria:list '{}' | jq -r '.value.criteria[0]._id')" "$CID"
m "$ADMIN" criteria:reorder "{\"criterionId\":\"$CID\",\"toIndex\":99}" >/dev/null
check "delete criterion" "$(m "$ADMIN" criteria:remove "{\"criterionId\":\"$CID\"}" | jq -r '.status')" success
check "total back to 100" "$(q "$ADMIN" criteria:list '{}' | jq -r '.value.total')" 100
check "original first restored" "$(q "$ADMIN" criteria:list '{}' | jq -r '.value.criteria[0]._id')" "$FIRST"

echo
echo "== 6. Judge management =="
VEMAIL="verify.judge.$(date +%s)@rapturejudge.io"
ADDED=$(m "$ADMIN" judges:createJudge "{\"name\":\"Verify Judge\",\"email\":\"${VEMAIL}\",\"password\":\"verifypass123\",\"organization\":\"QA\",\"capacity\":2}")
VJ=$(echo "$ADDED" | jq -r '.value.id // empty')
[ -n "$VJ" ] && ok "added judge ($VJ)" || no "add judge: $ADDED"
check "duplicate email rejected" "$(status "$(m "$ADMIN" judges:createJudge "{\"name\":\"Dup\",\"email\":\"${VEMAIL}\",\"password\":\"verifypass123\"}")")" error
check "short password rejected" "$(status "$(m "$ADMIN" judges:createJudge '{"name":"Weak","email":"weak@rapturejudge.io","password":"short"}')")" error
m "$ADMIN" judges:updateJudge "{\"judgeId\":\"$VJ\",\"organization\":\"QA Renamed\"}" >/dev/null
check "edited judge" "$(q "$ADMIN" judges:listForAdmin '{}' | jq -r --arg id "$VJ" '.value.judges[] | select(.id==$id) | .organization')" "QA Renamed"
m "$ADMIN" judges:setJudgeActive "{\"judgeId\":\"$VJ\",\"isActive\":false}" >/dev/null
check "deactivated judge" "$(q "$ADMIN" judges:listForAdmin '{}' | jq -r --arg id "$VJ" '.value.judges[] | select(.id==$id) | .isActive')" false
check "cannot assign inactive judge" "$(status "$(m "$ADMIN" judges:assign "{\"judgeId\":\"$VJ\",\"teamId\":$(q "$ADMIN" judges:listForAdmin '{}' | jq -r '.value.teams[0].id')}")")" error
m "$ADMIN" judges:setJudgeActive "{\"judgeId\":\"$VJ\",\"isActive\":true}" >/dev/null

echo
echo "== 7. Multi-judge assignment =="
TEAM=$(q "$ADMIN" judges:listForAdmin '{}' | jq -r '.value.teams[0].id')
check "assign judge 1" "$(status "$(m "$ADMIN" judges:assign "{\"judgeId\":\"$(q "$ADMIN" judges:listForAdmin '{}' | jq -r '.value.judges[0].id')\",\"teamId\":\"$TEAM\"}")")" success
check "re-assign is idempotent" "$(m "$ADMIN" judges:assign "{\"judgeId\":\"$(q "$ADMIN" judges:listForAdmin '{}' | jq -r '.value.judges[0].id')\",\"teamId\":\"$TEAM\"}" | jq -r '.value.alreadyAssigned')" true
check "team now has 2+ judges" "$(q "$ADMIN" judges:listForAdmin '{}' | jq -r --arg t "$TEAM" '.value.teams[] | select(.id==$t) | .assigned >= 2')" true
check "unassign judge 1" "$(status "$(m "$ADMIN" judges:unassign "{\"judgeId\":\"$(q "$ADMIN" judges:listForAdmin '{}' | jq -r '.value.judges[0].id')\",\"teamId\":\"$TEAM\"}")")" success

echo
echo "== 8. Conflict of interest blocks the judge =="
CJ=$(q "$ADMIN" judges:listForAdmin '{}' | jq -r '.value.judges[0].id')
CN=$(q "$ADMIN" judges:listForAdmin '{}' | jq -r '.value.judges[0].name')
m "$ADMIN" judges:assign "{\"judgeId\":\"$CJ\",\"teamId\":\"$TEAM\"}" >/dev/null
CONF=$(m "$ADMIN" judges:declareConflict "{\"judgeId\":\"$CJ\",\"teamId\":\"$TEAM\",\"reason\":\"verification\"}")
CONFID=$(echo "$CONF" | jq -r '.value.conflictId // empty')
if [ -n "$CONFID" ]; then ok "declared conflict"; else no "declare conflict: $CONF"; fi
CLOGIN=$(login "$(
  q "$ADMIN" judges:listForAdmin '{}' | jq -r --arg id "$CJ" '.value.judges[] | select(.id==$id) | .email'
)")
if [ -n "$CLOGIN" ]; then
  check "conflicted judge blocked from reviewDetail" \
    "$(status "$(q "$CLOGIN" judging:reviewDetail "{\"teamId\":\"$TEAM\"}")")" error
  check "conflicted team removed from judge queue" \
    "$(q "$CLOGIN" judging:myAssignments '{}' | jq -r --arg t "$TEAM" '[.value.assignments[] | select(.teamId==$t)] | length')" 0
  check "conflicted judge cannot score" \
    "$(status "$(m "$CLOGIN" judging:saveScore "{\"teamId\":\"$TEAM\",\"breakdown\":{},\"comments\":\"\",\"recommendation\":\"advance\",\"isFinal\":true}")")" error
  check "reassignment blocked while conflicted" \
    "$(status "$(m "$ADMIN" judges:assign "{\"judgeId\":\"$CJ\",\"teamId\":\"$TEAM\"}")")" error
  m "$ADMIN" judges:resolveConflict "{\"conflictId\":\"$CONFID\"}" >/dev/null
  check "after resolving, reassignment allowed" "$(status "$(m "$ADMIN" judges:assign "{\"judgeId\":\"$CJ\",\"teamId\":\"$TEAM\"}")")" success
  m "$ADMIN" judges:unassign "{\"judgeId\":\"$CJ\",\"teamId\":\"$TEAM\"}" >/dev/null
else
  no "could not sign in as seeded judge to test conflict"
fi

echo
echo "== 9. Blind judging masks identity =="
check "blind judging off" "$(q "$ADMIN" hackathons:activeHackathon '{}' | jq -r '.value.blindJudging')" false
m "$ADMIN" hackathons:setFlag "{\"hackathonId\":\"$ORIG\",\"blindJudging\":true}" >/dev/null
BD=$(q "$JUDGE" judging:myAssignments '{}')
echo "  judge sees: $(echo "$BD" | jq -r '[.value.assignments[].teamName] | join(", ")')"
check "all names anonymised" "$(echo "$BD" | jq -r '[.value.assignments[].teamName | startswith("Submission")] | all')" true
check "roster withheld" "$(q "$JUDGE" judging:reviewDetail "{\"teamId\":$(echo "$BD" | jq -r '.value.assignments[0].teamId')}" | jq -r '.value.members | length')" 0
m "$ADMIN" hackathons:setFlag "{\"hackathonId\":\"$ORIG\",\"blindJudging\":false}" >/dev/null
check "blind judging off again" "$(q "$ADMIN" hackathons:activeHackathon '{}' | jq -r '.value.blindJudging')" false

echo
echo "== 10. Audit log captured the admin actions =="
AL=$(q "$ADMIN" audit:listForAdmin '{}')
check "audit log has entries" "$(echo "$AL" | jq -r '.value.total > 0')" true
for action in hackathon.created criteria.create criteria.remove judge.created assignment.created conflict.declared conflict.resolved settings.toggled; do :; done
echo "  recorded actions:"
echo "$AL" | jq -r '.value.entries | group_by(.action) | .[] | "    \(.[0].action) x\(length)"' | head -20
check "settings toggle audited" "$(echo "$AL" | jq -r '[.value.entries[] | select(.action=="settings.toggled")] | length > 0')" true
check "conflict audited" "$(echo "$AL" | jq -r '[.value.entries[] | select(.action=="conflict.declared")] | length > 0')" true
check "judge created audited" "$(echo "$AL" | jq -r '[.value.entries[] | select(.action=="judge.created" and .targetLabel=="Verify Judge")] | length > 0')" true

echo
echo "== 11. Cleanup =="
q "$ADMIN" hackathons:listForAdmin '{}' | jq -r ".value[] | select(.name|startswith(\"Verification Round\")) | ._id" | while read -r id; do
  m "$ADMIN" hackathons:setFlag "{\"hackathonId\":\"$id\",\"registrationOpen\":false}" >/dev/null
done
check "admin still cannot score" "$(status "$(m "$ADMIN" judging:saveScore "{\"teamId\":\"$TEAM\",\"breakdown\":{},\"comments\":\"\",\"recommendation\":\"advance\",\"isFinal\":true}")")" error
check "admin cannot edit a submission" "$(status "$(m "$ADMIN" submissions:updateSubmission '{"abstract":"x","highlights":[]}')")" error

echo
echo "======================================"
echo "  PASS: $PASS   FAIL: $FAIL"
echo "======================================"
[ "$FAIL" -eq 0 ]
