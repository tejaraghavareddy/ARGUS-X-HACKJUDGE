#!/usr/bin/env bash
# End-to-end check of the AI JUDGE COPILOT against the live Convex API.
#
# Uses real sign-ins and real tokens — not mocked calls — because the point is
# to prove the server-side boundaries hold:
#   1. Only judges and admins can generate or chat (participants/anonymous rejected).
#   2. A judge can only act on teams they are assigned to.
#   3. Without a working key, generation degrades into a graceful "failed"
#      brief row with an instructive error and a retry path — never a crash
#      and never a partially-written analysis.
#   4. The copilot NEVER writes a score: after a copilot run the team's
#      official average is unchanged, and the copilot module contains no
#      reference to the scores table at all.
#
# Happy-path checks (a "ready" brief produced by real Gemini) require
# GEMINI_API_KEY in the deployment environment; without it they are skipped
# with a notice and the boundary checks still run.
set -uo pipefail

DEPLOYMENT="${DEPLOYMENT:-abundant-squirrel-476.convex.cloud}"
URL="https://${DEPLOYMENT}/api"
PASSWORD="${DEMO_PASSWORD:-rapture2026}"
PASS=0
FAIL=0

query() { # query <token> <path> <json-args>
  curl -sS "${URL}/query" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $1" \
    -d "{\"path\":\"$2\",\"args\":$3,\"format\":\"json\"}"
}

mutation() { # mutation <token> <path> <json-args>
  curl -sS "${URL}/mutation" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $1" \
    -d "{\"path\":\"$2\",\"args\":$3,\"format\":\"json\"}"
}

action() { # action <token|NONE> <path> <json-args>
  if [ "$1" = "NONE" ]; then
    curl -sS "${URL}/action" \
      -H "Content-Type: application/json" \
      -d "{\"path\":\"$2\",\"args\":$3,\"format\":\"json\"}"
  else
    curl -sS "${URL}/action" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $1" \
      -d "{\"path\":\"$2\",\"args\":$3,\"format\":\"json\"}"
  fi
}

login() {
  curl -sS "${URL}/action" \
    -H "Content-Type: application/json" \
    -d "{\"path\":\"auth:signIn\",\"args\":{\"provider\":\"password\",\"params\":{\"flow\":\"signIn\",\"email\":\"$1\",\"password\":\"${PASSWORD}\"}},\"format\":\"json\"}" \
    | jq -r '.value.tokens.token // empty'
}

check() { # check <description> <true|false>
  if [ "$2" = "true" ]; then
    printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS + 1))
  else
    printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAIL=$((FAIL + 1))
  fi
}

v() { jq -r ".value$1 // empty"; }

tf() { # tf <exit-code-of-condition> -> prints true/false
  if [ "$1" -eq 0 ]; then echo true; else echo false; fi
}

# true when a copilot call is correctly refused (HTTP-level error OR ok:false)
refused() {
  [ "$(echo "$1" | jq -r '.status // empty')" = "error" ] && return 0
  [ "$(echo "$1" | jq -r '.value.ok // empty')" = "false" ] && return 0
  return 1
}

echo
echo "AI JUDGE COPILOT"
echo "======================================================================"

# --- Principals -------------------------------------------------------------
ADMIN=$(login "aditi@rapturejudge.io")
JUDGE=$(login "elena@rapturejudge.io")
P1=$(login "nikhil.okafor@rapture.dev")
check "admin sign-in"       "$([ -n "$ADMIN" ] && echo true || echo false)"
check "judge sign-in"       "$([ -n "$JUDGE" ] && echo true || echo false)"
check "participant sign-in" "$([ -n "$P1" ] && echo true || echo false)"

# --- Resolve Nebula (a fully submitted team assigned to Elena) --------------
ASSIGN_JSON=$(query "$JUDGE" "judging:myAssignments" "{}")
NEBULA_ID=$(echo "$ASSIGN_JSON" | jq -r '.value.assignments[] | select(.projectName | test("^Nebula")) | .teamId' | head -1)
check "judge has an assignment for Nebula" "$([ -n "$NEBULA_ID" ] && echo true || echo false)"

ADMIN_TEAMS_JSON=$(query "$ADMIN" "teams:adminTeams" "{}")
NEBULA_AVG_BEFORE=$(echo "$ADMIN_TEAMS_JSON" | jq -r --arg id "$NEBULA_ID" '.value[] | select(.id == $id) | .averageScore // "none"')
check "Nebula has a recorded official average (${NEBULA_AVG_BEFORE})" \
  "$([ "$NEBULA_AVG_BEFORE" != "none" ] && [ -n "$NEBULA_AVG_BEFORE" ] && echo true || echo false)"

# --- Role gating -------------------------------------------------------------
R_ANON=$(action NONE "copilot:generate" "{\"teamId\":\"${NEBULA_ID}\"}")
check "anonymous generate rejected"    "$(refused "$R_ANON" && echo true || echo false)"

R_P=$(action "$P1" "copilot:generate" "{\"teamId\":\"${NEBULA_ID}\"}")
check "participant generate rejected"  "$(refused "$R_P" && echo true || echo false)"

R_PC=$(action "$P1" "copilot:chat" "{\"teamId\":\"${NEBULA_ID}\",\"message\":\"hello\"}")
check "participant chat rejected"      "$(refused "$R_PC" && echo true || echo false)"

R_ANON_C=$(action NONE "copilot:chat" "{\"teamId\":\"${NEBULA_ID}\",\"message\":\"hello\"}")
check "anonymous chat rejected"        "$(refused "$R_ANON_C" && echo true || echo false)"

# --- Judge scoping ------------------------------------------------------------
# Quartz is presented to a different judge; Elena is not assigned to it.
QUARTZ_ID=$(echo "$ADMIN_TEAMS_JSON" | jq -r '.value[] | select(.projectName | test("^Quartz")) | .id' | head -1)
R_OTHER=$(action "$JUDGE" "copilot:generate" "{\"teamId\":\"${QUARTZ_ID}\"}")
check "unassigned-team generate rejected" \
  "$(refused "$R_OTHER" && echo "$R_OTHER" | grep -q "not assigned" && echo true || echo false)"

R_OTHER_C=$(action "$JUDGE" "copilot:chat" "{\"teamId\":\"${QUARTZ_ID}\",\"message\":\"hello\"}")
check "unassigned-team chat rejected" \
  "$(refused "$R_OTHER_C" && echo "$R_OTHER_C" | grep -q "not assigned" && echo true || echo false)"

# --- Generate + persist -------------------------------------------------------
echo
echo "Generation (provider: gemini)"
echo "----------------------------------------------------------------------"
R_GEN=$(action "$JUDGE" "copilot:generate" "{\"teamId\":\"${NEBULA_ID}\"}")
GEN_OK=$(echo "$R_GEN" | jq -r '.value.ok // empty')
BRIEF=$(query "$JUDGE" "copilot:briefForSubmission" "{\"teamId\":\"${NEBULA_ID}\"}")

if [ "$GEN_OK" = "true" ]; then
  DROPPED=$(echo "$R_GEN" | jq -r '.value.droppedUnverified // 0')
  check "generate succeeded for assigned judge" true
  check "grounding reported dropped-claim count (${DROPPED})" \
    "$(echo "$DROPPED" | grep -qE '^[0-9]+$' && echo true || echo false)"

  check "brief row exists (ready)" \
    "$([ "$(echo "$BRIEF" | v '.state')" = "ready" ] && echo true || echo false)"
  check "provider persisted as gemini" \
    "$([ "$(echo "$BRIEF" | v '.provider')" = "gemini" ] && echo true || echo false)"
  check "model persisted" \
    "$([ -n "$(echo "$BRIEF" | v '.model')" ] && echo true || echo false)"
  check "generatedAt is a timestamp" \
    "$(echo "$BRIEF" | jq -e '.value.generatedAt | type == "number"' >/dev/null 2>&1 && echo true || echo false)"
  check "inputHash recorded" \
    "$([ -n "$(echo "$BRIEF" | v '.inputHash')" ] && echo true || echo false)"

  N_CRITERIA=$(echo "$BRIEF" | jq '.value.criteria | keys | length')
  check "rubric evidence keyed per criterion (${N_CRITERIA} criteria)" \
    "$([ "$N_CRITERIA" -ge 1 ] && echo true || echo false)"

  # AI never scores: the brief payload carries no score-shaped fields at all.
  check "brief payload contains no score/total/grade fields" \
    "$(echo "$BRIEF" | jq -r '.value' | grep -qiE '"(score|total|grade|rank|verdict)"[[:space:]]*:' && echo false || echo true)"

  # Chat on the same submission.
  R_CHAT=$(action "$JUDGE" "copilot:chat" "{\"teamId\":\"${NEBULA_ID}\",\"message\":\"In one sentence, what does the submission say this project does?\",\"history\":[]}")
  check "chat answered from the submission" \
    "$([ "$(echo "$R_CHAT" | jq -r '.value.ok // empty')" = "true" ] && [ -n "$(echo "$R_CHAT" | v '.answer')" ] && echo true || echo false)"
  ANSWER=$(echo "$R_CHAT" | v '.answer')
  check "chat answer carries no score language" \
    "$(echo "$ANSWER" | grep -qiE '\b(score|out of 100|should win|deserves|[0-9]+/10)\b' && echo false || echo true)"

  R_CHAT_MISS=$(action "$JUDGE" "copilot:chat" "{\"teamId\":\"${NEBULA_ID}\",\"message\":\"What were the exact CPU benchmark numbers measured in production?\",\"history\":[]}")
  check "unanswerable question degrades to notInSource or empty evidence, never an invention" \
    "$([ "$(echo "$R_CHAT_MISS" | jq -r '.value.notInSource // empty')" = "true" ] || [ "$(echo "$R_CHAT_MISS" | jq '.value.quotes | length // 0')" = "0" ] && echo true || echo false)"

  echo
  echo "NOTE: happy-path generation succeeded — GEMINI_API_KEY is live in this deployment."
else
  MSG=$(echo "$R_GEN" | jq -r '.value.error // empty')
  case "$MSG" in
    *GEMINI_API_KEY*)
      check "generate fails gracefully without a key (structured error, not a crash)" true
      ;;
    "")
      check "generate returned a structured result (no crash)" \
        "$([ "$(echo "$R_GEN" | jq -r '.status // empty')" = "success" ] && echo true || echo false)"
      ;;
    *)
      check "generate failed with an instructive message" "$([ -n "$MSG" ] && echo true || echo false)"
      ;;
  esac

  check "failed brief row recorded with reason" \
    "$([ "$(echo "$BRIEF" | v '.state')" = "failed" ] && [ -n "$(echo "$BRIEF" | v '.error')" ] && echo true || echo false)"
  check "failed row carries provider/model for the retry path" \
    "$([ -n "$(echo "$BRIEF" | v '.provider')" ] && [ -n "$(echo "$BRIEF" | v '.model')" ] && echo true || echo false)"

  # Retry path: a second attempt is again a structured, non-crash result.
  R_RETRY=$(action "$JUDGE" "copilot:generate" "{\"teamId\":\"${NEBULA_ID}\"}")
  check "retry returns a structured (non-crash) result" \
    "$([ -n "$(echo "$R_RETRY" | jq -r '.value // empty')" ] && echo true || echo false)"

  echo
  echo "NOTE: happy-path generation checks skipped — add GEMINI_API_KEY in the Keys settings and re-run."
fi

# --- AI never writes a score ---------------------------------------------------
echo
echo "No-score-writes boundary"
echo "----------------------------------------------------------------------"
# Save a normal (human) draft as the judge, then confirm the official average
# is untouched by everything the copilot did above.
mutation "$JUDGE" "judging:saveScore" \
  "{\"teamId\":\"${NEBULA_ID}\",\"breakdown\":{},\"comments\":\"copilot verification draft\",\"recommendation\":\"hold\",\"isFinal\":false}" > /dev/null

NEBULA_AVG_AFTER=$(query "$ADMIN" "teams:adminTeams" "{}" | jq -r --arg id "$NEBULA_ID" '.value[] | select(.id == $id) | .averageScore // "none"')
check "official average unchanged by copilot activity (${NEBULA_AVG_BEFORE} → ${NEBULA_AVG_AFTER})" \
  "$([ "$NEBULA_AVG_BEFORE" = "$NEBULA_AVG_AFTER" ] && echo true || echo false)"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
check "copilot module contains no reference to the scores table" \
  "$(grep -qE '"scores"|scores\.' "${SCRIPT_DIR}/../src/convex/copilot.ts" && echo false || echo true)"

# --- Scoring regression --------------------------------------------------------
echo
echo "Scoring still works end-to-end (regression)"
echo "----------------------------------------------------------------------"
if [ -f "${SCRIPT_DIR}/verify-admin.sh" ]; then
  if bash "${SCRIPT_DIR}/verify-admin.sh" > /tmp/verify-admin-copilot.log 2>&1; then
    check "existing admin/scoring suite still green" true
  else
    check "existing admin/scoring suite still green" false
    tail -20 /tmp/verify-admin-copilot.log
  fi
else
  echo "  SKIP  verify-admin.sh not found"
fi

echo
echo "======================================================================"
echo "PASS: $PASS  FAIL: $FAIL"
[ "$FAIL" -eq 0 ]
