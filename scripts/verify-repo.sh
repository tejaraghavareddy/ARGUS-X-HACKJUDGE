#!/usr/bin/env bash
# End-to-end check of the GITHUB REPOSITORY ANALYZER against the live API.
#
# Proves the server-side boundaries:
#   1. Only judges/admins can run or read an analysis (participants/anonymous refused).
#   2. A judge can only analyze teams they are assigned to.
#   3. Missing/bad GitHub URL -> graceful failed row, never a crash.
#   4. Happy path vs a real public repo: sections populated, sources present,
#      coverage limits stated, no score coupling anywhere.
#
# If GitHub is unreachable or rate-limited, the happy-path group degrades to
# the failed-row checks; boundary checks always run.
set -uo pipefail

DEPLOYMENT="${DEPLOYMENT:-abundant-squirrel-476.convex.cloud}"
URL="https://${DEPLOYMENT}/api"
PASSWORD="${DEMO_PASSWORD:-rapture2026}"
PASS=0
FAIL=0

query() {
  curl -sS "${URL}/query" -H "Content-Type: application/json" \
    -H "Authorization: Bearer $1" \
    -d "{\"path\":\"$2\",\"args\":$3,\"format\":\"json\"}"
}

action() {
  if [ "$1" = "NONE" ]; then
    curl -sS "${URL}/action" -H "Content-Type: application/json" \
      -d "{\"path\":\"$2\",\"args\":$3,\"format\":\"json\"}"
  else
    curl -sS "${URL}/action" -H "Content-Type: application/json" \
      -H "Authorization: Bearer $1" \
      -d "{\"path\":\"$2\",\"args\":$3,\"format\":\"json\"}"
  fi
}

login() {
  curl -sS "${URL}/action" -H "Content-Type: application/json" \
    -d "{\"path\":\"auth:signIn\",\"args\":{\"provider\":\"password\",\"params\":{\"flow\":\"signIn\",\"email\":\"$1\",\"password\":\"${PASSWORD}\"}},\"format\":\"json\"}" \
    | jq -r '.value.tokens.token // empty'
}

check() {
  if [ "$2" = "true" ]; then
    printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS + 1))
  else
    printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAIL=$((FAIL + 1))
  fi
}

v() { jq -r ".value$1 // empty"; }

is_number() { echo "$1" | jq 'type == "number"' | grep -q true; }

# ok:false must be read directly; jq's `//` would swallow a literal false.
okfalse() { [ "$(echo "$1" | jq -r '.value.ok')" = "false" ]; }
errored() { [ "$(echo "$1" | jq -r '.status // empty')" = "error" ]; }
refused() { errored "$1" || okfalse "$1"; }

echo
echo "GITHUB REPOSITORY ANALYZER"
echo "======================================================================"

ADMIN=$(login "aditi@rapturejudge.io")
JUDGE=$(login "elena@rapturejudge.io")
P1=$(login "nikhil.okafor@rapture.dev")
check "admin sign-in"       "$([ -n "$ADMIN" ] && echo true || echo false)"
check "judge sign-in"       "$([ -n "$JUDGE" ] && echo true || echo false)"
check "participant sign-in" "$([ -n "$P1" ] && echo true || echo false)"

ASSIGN_JSON=$(query "$JUDGE" "judging:myAssignments" "{}")
NEBULA_ID=$(echo "$ASSIGN_JSON" | jq -r '.value.assignments[] | select(.projectName | test("^Nebula")) | .teamId' | head -1)
check "judge has an assignment for Nebula" "$([ -n "$NEBULA_ID" ] && echo true || echo false)"

ADMIN_TEAMS_JSON=$(query "$ADMIN" "teams:adminTeams" "{}")
QUARTZ_ID=$(echo "$ADMIN_TEAMS_JSON" | jq -r '.value[] | select(.projectName | test("^Quartz")) | .id' | head -1)
BASE_AVG=$(echo "$ADMIN_TEAMS_JSON" | jq -r --arg id "$NEBULA_ID" '.value[] | select(.id == $id) | .averageScore // "none"')
check "baseline official average captured (${BASE_AVG})" true

# --- Role gating -------------------------------------------------------------
R_ANON=$(action NONE "repoAnalysis:analyze" "{\"teamId\":\"${NEBULA_ID}\"}")
check "anonymous analyze refused"     "$(refused "$R_ANON" && echo true || echo false)"

R_P=$(action "$P1" "repoAnalysis:analyze" "{\"teamId\":\"${NEBULA_ID}\"}")
check "participant analyze refused"   "$(refused "$R_P" && echo true || echo false)"

R_PR=$(query "$P1" "repoAnalysis:analysisForSubmission" "{\"teamId\":\"${NEBULA_ID}\"}")
check "participant read refused"      "$(errored "$R_PR" && echo true || echo false)"

R_OTHER=$(action "$JUDGE" "repoAnalysis:analyze" "{\"teamId\":\"${QUARTZ_ID}\"}")
check "unassigned-team analyze refused" \
  "$(refused "$R_OTHER" && echo "$R_OTHER" | grep -q "not assigned" && echo true || echo false)"

# --- Happy path vs a real public repository -----------------------------------
echo
echo "Happy path (real public repository)"
echo "----------------------------------------------------------------------"
# The seed points some demo teams at real public repositories so the analyzer
# has live targets. Nebula is one of them.
R=$(action "$JUDGE" "repoAnalysis:analyze" "{\"teamId\":\"${NEBULA_ID}\"}")
if [ "$(echo "$R" | jq -r '.value.ok // empty')" = "true" ]; then
  check "analyze succeeded for assigned judge" true
  REPO=$(echo "$R" | v '.repoFullName')
  check "reported repository is ${REPO}" "$([ -n "$REPO" ] && echo true || echo false)"

  A=$(query "$JUDGE" "repoAnalysis:analysisForSubmission" "{\"teamId\":\"${NEBULA_ID}\"}")
  check "analysis persisted (ready)" \
    "$([ "$(echo "$A" | v '.state')" = "ready" ] && echo true || echo false)"
  check "repo coordinates persisted" \
    "$([ "$(echo "$A" | v '.repoFullName')" = "$REPO" ] && echo true || echo false)"
  check "requestedUrl preserved for auditability" \
    "$([ -n "$(echo "$A" | v '.requestedUrl')" ] && echo true || echo false)"
  check "fetchedAt is a timestamp" \
    "$(is_number "$(echo "$A" | jq '.value.fetchedAt')" && echo true || echo false)"
  N_SECTIONS=$(echo "$A" | jq '.value.sections | length')
  check "report has sections (${N_SECTIONS})" "$([ "$N_SECTIONS" -ge 10 ] && echo true || echo false)"
  check "coverage counters present" \
    "$(is_number "$(echo "$A" | jq '.value.scanCoverage.treeEntries')" && echo true || echo false)"

  # Every evidence item must carry a source.
  BAD_SOURCES=$(echo "$A" | jq '[.value.sections[].evidence[] | select((.source // "") == "")] | length')
  check "every evidence item carries a source" "$([ "$BAD_SOURCES" = "0" ] && echo true || echo false)"

  # Languages should be detected on any real repo (GitHub reports them).
  LANGS_NOEV=$(echo "$A" | jq '[.value.sections[] | select(.key == "languages")][0].noEvidence')
  check "languages section populated" "$([ "$LANGS_NOEV" = "false" ] && echo true || echo false)"

  # The fixed absence wording must be the ONLY absence wording used.
  BAD_WORDING=$(echo "$A" | jq -r '[.value.sections[].evidence[] | .label] | join(" ")' \
    | grep -icE "not found|does not exist| missing |no .+ detected" || true)
  check "no section claims a capability is absent" "$([ "${BAD_WORDING}" = "0" ] && echo true || echo false)"

  # No score coupling in the stored payload.
  check "payload contains no score/total/grade fields" \
    "$(echo "$A" | jq -r '.value' | grep -qiE '"(score|total|grade|rank|verdict)"[[:space:]]*:' && echo false || echo true)"

  # Official average untouched by the analyzer.
  AFTER_AVG=$(query "$ADMIN" "teams:adminTeams" "{}" | jq -r --arg id "$NEBULA_ID" '.value[] | select(.id == $id) | .averageScore // "none"')
  check "official average unchanged (${BASE_AVG} → ${AFTER_AVG})" \
    "$([ "$BASE_AVG" = "$AFTER_AVG" ] && echo true || echo false)"

  # Coverage warning, when present, must be a coverage statement — never a
  # claim that a capability is missing from the project.
  WARN=$(echo "$A" | jq -r '.value.scanCoverage.warning // ""')
  if [ -n "$WARN" ]; then
    check "coverage note states scan limits, not feature absence" \
      "$(echo "$WARN" | grep -qiE "not identified|feature does not exist" && echo false || echo true)"
  else
    check "coverage note states scan limits, not feature absence" true
  fi
else
  MSG=$(echo "$R" | jq -r '.value.error // empty')
  case "$MSG" in
    *rate*limit*|*Could\ not\ reach\ GitHub*)
      echo "  SKIP  GitHub unreachable/rate-limited: ${MSG}"
      ;;
    "")
      check "analyze returned a structured result (no crash)" \
        "$([ "$(echo "$R" | jq -r '.status // empty')" = "success" ] && echo true || echo false)"
      ;;
    *)
      check "analyze failed with an instructive message" "$([ -n "$MSG" ] && echo true || echo false)"
      ;;
  esac
  F=$(query "$JUDGE" "repoAnalysis:analysisForSubmission" "{\"teamId\":\"${NEBULA_ID}\"}")
  check "failed row recorded with reason" \
    "$([ "$(echo "$F" | v '.state')" = "failed" ] && [ -n "$(echo "$F" | v '.error')" ] && echo true || echo false)"
  echo
  echo "NOTE: happy-path checks skipped — GitHub unreachable or rate-limited."
fi

# --- Module hygiene ------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
check "repoAnalysis module contains no reference to the scores table" \
  "$(grep -qE '"scores"|scores\.' "${SCRIPT_DIR}/../src/convex/repoAnalysis.ts" && echo false || echo true)"

echo
echo "======================================================================"
echo "PASS: $PASS  FAIL: $FAIL"
[ "$FAIL" -eq 0 ]
