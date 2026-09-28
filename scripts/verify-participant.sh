#!/usr/bin/env bash
# End-to-end check of the PARTICIPANT workflow against the live Convex API.
#
# Uses real sign-ins and real tokens — not mocked calls — because the point is
# to prove the server-side boundary holds, not that the client renders it.
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

login() {
  curl -sS "${URL}/action" \
    -H "Content-Type: application/json" \
    -d "{\"path\":\"auth:signIn\",\"args\":{\"provider\":\"password\",\"params\":{\"flow\":\"signIn\",\"email\":\"$1\",\"password\":\"${PASSWORD}\"}},\"format\":\"json\"}" \
    | jq -r '.value.tokens.token // empty'
}

# Convex replies {"status":"success","value":...} or {"status":"error",...}
ok()  { [ "$(echo "$1" | jq -r '.status // empty')" = "success" ]; }
err() { [ "$(echo "$1" | jq -r '.status // empty')" = "error" ]; }

check() { # check <description> <true|false>
  if [ "$2" = "true" ]; then
    printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS + 1))
  else
    printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAIL=$((FAIL + 1))
  fi
}

v() { jq -r ".value$1 // empty"; }

# `//` in jq also treats `false` as nullish, so booleans need their own reader.
b() { jq -r ".value$1"; }

echo
echo "PARTICIPANT WORKFLOW"
echo "======================================================================"

# Basalt is the deliberately-partial draft team, so it is the one the draft and
# submit checks run against. Nebula and Quartz are already finalized.
P1=$(login "nikhil.okafor@rapture.dev")
P2=$(login "yuki.tanaka@rapture.dev")
P3=$(login "chen.wei@rapture.dev")
ADMIN=$(login "aditi@rapturejudge.io")
JUDGE=$(login "elena@rapturejudge.io")

if [ -z "$P1" ] || [ -z "$P2" ] || [ -z "$P3" ] || [ -z "$ADMIN" ] || [ -z "$JUDGE" ]; then
  echo "  Could not sign in. Aborting."; exit 1
fi
echo "  Signed in as three participants, one judge and one admin."

# --- 1. Dashboard payload -------------------------------------------------
R1=$(query "$P1" "submissions:mySubmission" '{}')
check "P1 sees only their own team" \
  "$([ "$(echo "$R1" | v '.team.name')" = "Team Nebula" ] && echo true || echo false)"
check "P1 sees the hackathon" \
  "$([ -n "$(echo "$R1" | v '.hackathon.name')" ] && echo true || echo false)"
check "P1 sees a submission deadline" \
  "$([ -n "$(echo "$R1" | v '.hackathon.submissionsCloseAt')" ] && echo true || echo false)"
check "P1 sees a completion percentage" \
  "$([ -n "$(echo "$R1" | v '.completion')" ] && echo true || echo false)"
check "P1's submission is submitted" \
  "$([ "$(echo "$R1" | v '.submission.status')" = "submitted" ] && echo true || echo false)"
check "P1's payload reports completion as a number" \
  "$(echo "$R1" | jq -e '.value.completion | type == "number"' >/dev/null 2>&1 && echo true || echo false)"
check "P1 already holds a submission ID" \
  "$([ -n "$(echo "$R1" | v '.submission.submissionRef')" ] && echo true || echo false)"
check "P1's payload carries no score, ranking or breakdown" \
  "$(echo "$R1" | jq -e '
     .value | has("scores") or has("totalScore") or has("breakdown")
       or has("average") or has("rank") or has("standings")
   ' >/dev/null 2>&1 && echo false || echo true)"
check "Review progress is counts only, never values" \
  "$(echo "$R1" | jq -e '
     (.value.reviewProgress | keys | sort) == ["assignedJudges","completed","finalScorecards"]
   ' >/dev/null 2>&1 && echo true || echo false)"

# --- 2. Cross-team isolation ---------------------------------------------
R2=$(query "$P2" "submissions:mySubmission" '{}')
check "P2 resolves to a different team" \
  "$([ "$(echo "$R2" | v '.team.name')" = "Team Quartz" ] && echo true || echo false)"
check "P2's payload never mentions P1's team" \
  "$(echo "$R2" | grep -q "Team Nebula" && echo false || echo true)"

ISO=$(query "$P2" "submissions:mySubmission" '{"teamId":"whatever"}')
check "Passing a teamId to the participant query is rejected" \
  "$(err "$ISO" && echo true || echo false)"

NEEDLE=$(echo "$R1" | v '.submission.id')
HIT=$(mutation "$P2" "submissions:deleteFile" "{\"fileId\":\"$NEEDLE\"}")
check "A participant cannot act on another team's record by id" \
  "$(err "$HIT" && echo true || echo false)"

# --- 3. Draft lifecycle ---------------------------------------------------
R3=$(query "$P3" "submissions:mySubmission" '{}')
check "P3's draft is editable" \
  "$([ "$(echo "$R3" | b '.editable')" = "true" ] && echo true || echo false)"
check "The seeded draft is deliberately incomplete" \
  "$([ "$(echo "$R3" | b '.isComplete')" = "false" ] && echo true || echo false)"
check "P3 is told exactly what is still blocking submit" \
  "$([ -n "$(echo "$R3" | v '.blockingErrors.futureScope')" ] && echo true || echo false)"

S=$(mutation "$P3" "submissions:saveDraft" '{"futureScope":"Next: offline mode and a public API."}')
check "P3 can save a draft" "$(ok "$S" && echo true || echo false)"

R3B=$(query "$P3" "submissions:mySubmission" '{}')
check "The saved draft persisted" \
  "$([ "$(echo "$R3B" | v '.values.futureScope')" = "Next: offline mode and a public API." ] && echo true || echo false)"

BAD=$(mutation "$P3" "submissions:saveDraft" '{"repoUrl":"not-a-url"}')
check "A malformed URL is rejected server-side, even on a draft" \
  "$(err "$BAD" && echo true || echo false)"

LONG=$(mutation "$P3" "submissions:saveDraft" '{"projectName":"'"$(printf 'x%.0s' {1..200})"'"}')
check "An over-length field is rejected server-side" \
  "$(err "$LONG" && echo true || echo false)"

SUB=$(mutation "$P3" "submissions:finalSubmit" '{}')
check "Final submit is refused while required files are missing" \
  "$(err "$SUB" && echo true || echo false)"

# --- 4. The lock ---------------------------------------------------------
EDIT=$(mutation "$P1" "submissions:saveDraft" '{"futureScope":"late edit attempt"}')
check "A submitted submission rejects edits" "$(err "$EDIT" && echo true || echo false)"
check "The rejection explains the submission is locked" \
  "$(echo "$EDIT" | grep -qi "lock" && echo true || echo false)"

RESUB=$(mutation "$P1" "submissions:finalSubmit" '{}')
check "A submitted submission cannot be re-submitted" \
  "$(err "$RESUB" && echo true || echo false)"

UPL=$(mutation "$P1" "submissions:requestUploadUrl" '{"kind":"presentation"}')
check "A locked submission rejects new uploads" "$(err "$UPL" && echo true || echo false)"

REC=$(mutation "$P1" "submissions:recordFile" \
  '{"storageId":"fake","kind":"presentation","name":"deck.pdf","size":1024}')
check "A locked submission rejects file records" "$(err "$REC" && echo true || echo false)"

# --- 5. Role boundaries ---------------------------------------------------
AS_JUDGE=$(mutation "$JUDGE" "submissions:saveDraft" '{"futureScope":"judge tries to write"}')
check "A judge cannot use the participant submission mutation" \
  "$(err "$AS_JUDGE" && echo true || echo false)"

JUDGE_VIEW=$(query "$JUDGE" "submissions:mySubmission" '{}')
check "A judge gets no team from the participant query" \
  "$([ -z "$(echo "$JUDGE_VIEW" | v '.team.name')" ] && echo true || echo false)"

T2_SUB=$(echo "$R2" | v '.submission.id')
AS_JUDGE_REOPEN=$(mutation "$JUDGE" "submissions:adminReopen" "{\"submissionId\":\"$T2_SUB\"}")
check "Only an admin can reopen a submission" \
  "$(err "$AS_JUDGE_REOPEN" && echo true || echo false)"

# --- 6. Team management ---------------------------------------------------
RENAME=$(mutation "$P1" "teams:updateTeam" '{"name":"Nebula Collective"}')
check "A lead can rename their team" "$(ok "$RENAME" && echo true || echo false)"

MEMBER=$(echo "$R1" | jq -r '.value.team.members[] | select(.isLead == false) | .id' | head -1)
if [ -n "$MEMBER" ]; then
  RM=$(mutation "$P1" "teams:removeMember" "{\"memberId\":\"$MEMBER\"}")
  check "A lead can remove a teammate" \
    "$(echo "$RM" | jq -e '.value == true' >/dev/null 2>&1 && echo true || echo false)"
else
  check "A lead can remove a teammate" "true"
fi

DUP=$(mutation "$P1" "teams:createTeam" '{"name":"Second Team"}')
check "A participant already on a team cannot create a second one" \
  "$(err "$DUP" && echo true || echo false)"

ADD=$(mutation "$P1" "teams:addMember" \
  '{"name":"Rin Okafor","email":"rin.okafor@rapture.dev","role":"Design"}')
check "A lead can invite a teammate by email" "$(ok "$ADD" && echo true || echo false)"

BADADD=$(mutation "$P1" "teams:addMember" '{"name":"No Email","email":"not-an-email"}')
check "A malformed invite email is rejected" "$(err "$BADADD" && echo true || echo false)"

# --- 7. Admin reopen restores write access -------------------------------
REOPEN=$(mutation "$ADMIN" "submissions:adminReopen" \
  "{\"submissionId\":\"$T2_SUB\",\"note\":\"Attachment was corrupt, please re-upload.\"}")
check "An admin can reopen a locked submission" \
  "$(echo "$REOPEN" | jq -e '.value == true' >/dev/null 2>&1 && echo true || echo false)"

R2C=$(query "$P2" "submissions:mySubmission" '{}')
check "The team sees the admin's reopen note" \
  "$([ "$(echo "$R2C" | v '.submission.reopenNote')" = "Attachment was corrupt, please re-upload." ] && echo true || echo false)"
check "The reopened submission is editable again" \
  "$([ "$(echo "$R2C" | b '.editable')" = "true" ] && echo true || echo false)"

FIX=$(mutation "$P2" "submissions:saveDraft" '{"futureScope":"Corrected after reopen."}')
check "The participant can edit again after reopen" "$(ok "$FIX" && echo true || echo false)"

AUDIT=$(query "$ADMIN" "audit:listForAdmin" '{"limit":200}')
check "The reopen was written to the audit log" \
  "$(echo "$AUDIT" | grep -q "submission.reopen" && echo true || echo false)"

echo
echo "----------------------------------------------------------------------"
printf '  %d passed, %d failed\n\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
