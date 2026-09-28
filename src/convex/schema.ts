import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// Roles are mutually exclusive and drive every authorization decision in the
// app. `admin` sees everything, `judge` is scoped to assigned submissions only,
// `participant` is scoped to their own team and submission.
export const ROLES = {
  ADMIN: "admin",
  JUDGE: "judge",
  PARTICIPANT: "participant",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.JUDGE),
  v.literal(ROLES.PARTICIPANT),
);
export type Role = Infer<typeof roleValidator>;

// Lifecycle of the event itself. Results stay locked until an admin publishes.
export const HACKATHON_STATUS = {
  REGISTRATION: "registration",
  BUILD: "build",
  SUBMISSIONS_CLOSED: "submissions_closed",
  JUDGING: "judging",
  RESULTS: "results",
} as const;
export const hackathonStatusValidator = v.union(
  v.literal(HACKATHON_STATUS.REGISTRATION),
  v.literal(HACKATHON_STATUS.BUILD),
  v.literal(HACKATHON_STATUS.SUBMISSIONS_CLOSED),
  v.literal(HACKATHON_STATUS.JUDGING),
  v.literal(HACKATHON_STATUS.RESULTS),
);

export const SUBMISSION_STATUS = {
  DRAFT: "draft",
  SUBMITTED: "submitted",
  UNDER_REVIEW: "under_review",
  SCORED: "scored",
} as const;
export const submissionStatusValidator = v.union(
  v.literal(SUBMISSION_STATUS.DRAFT),
  v.literal(SUBMISSION_STATUS.SUBMITTED),
  v.literal(SUBMISSION_STATUS.UNDER_REVIEW),
  v.literal(SUBMISSION_STATUS.SCORED),
);

export const ASSIGNMENT_STATUS = {
  NOT_STARTED: "not_started",
  IN_PROGRESS: "in_progress",
  SUBMITTED: "submitted",
} as const;
export const assignmentStatusValidator = v.union(
  v.literal(ASSIGNMENT_STATUS.NOT_STARTED),
  v.literal(ASSIGNMENT_STATUS.IN_PROGRESS),
  v.literal(ASSIGNMENT_STATUS.SUBMITTED),
);

/**
 * Advisory AI analysis attached to a submission.
 *
 * Product principle: AI ASSISTS, IT NEVER DECIDES. Every field here is
 * read-only context for a human judge. No server function derives, writes or
 * adjusts a `scores` record from this object — a score can only ever be set by
 * the judge it belongs to. `suggestedFocus` is deliberately named to signal it
 * is a prompt for the judge, not a recommendation to act on.
 */
const aiReview = v.object({
  summary: v.string(),
  strengths: v.array(v.string()),
  risks: v.array(v.string()),
  suggestedFocus: v.string(),
  model: v.string(),
  generatedAt: v.number(),
});

// ---------------------------------------------------------------------------
// AI copilot output
// ---------------------------------------------------------------------------

/**
 * A single claim the model made *about something the submission says*.
 *
 * It must be paired with `sourceQuote` — a verbatim span copied out of the
 * submitted text. The server re-checks that quote against the submission and
 * silently discards any claim it cannot find, which is what turns "do not
 * invent facts" from a prompt instruction into something the database enforces.
 */
const groundedClaim = v.object({
  claim: v.string(),
  sourceQuote: v.string(),
});

const criterionAnalysis = v.object({
  evidence: v.array(groundedClaim),
  strengths: v.array(groundedClaim),
  concerns: v.array(groundedClaim),
  // Absences cannot be quoted, so these are ungrounded by design: they describe
  // what the submission did NOT provide, which is the most useful thing a judge
  // can be told and the least risky thing for a model to assert.
  missingEvidence: v.array(v.string()),
  questions: v.array(v.string()),
});

const projectBrief = v.object({
  executiveSummary: v.string(),
  problemSummary: v.string(),
  solution: v.string(),
  targetUsers: v.string(),
  keyFeatures: v.array(v.string()),
  techStack: v.array(v.string()),
  architectureSummary: v.string(),
  innovationIndicators: v.array(groundedClaim),
  impactIndicators: v.array(groundedClaim),
  implementationIndicators: v.array(groundedClaim),
  missingInformation: v.array(v.string()),
});

// ---------------------------------------------------------------------------
// GitHub repository analysis
// ---------------------------------------------------------------------------

/**
 * One detected piece of technical evidence, with the file or payload that
 * shows it. Detection is deterministic (pattern/structure matching over the
 * public GitHub API), so `source` is always a real location in the scan,
 * never a model attribution.
 */
const repoEvidence = v.object({
  label: v.string(),
  source: v.string(),
  detail: v.optional(v.string()),
});

/**
 * One analysis dimension of the report. When nothing was detected, `evidence`
 * is empty AND `noEvidence` is true; the UI then renders the fixed wording
 * "Supporting evidence was not identified in the analyzed repository." A
 * section never stores an inference that a capability is absent.
 */
const repoSection = v.object({
  key: v.string(),
  title: v.string(),
  evidence: v.array(repoEvidence),
  noEvidence: v.boolean(),
});

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // The users table is the default users table that is brought in by the
    // authTables. Only the role field is ours; everything else is owned by
    // Convex Auth.
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator),
      organization: v.optional(v.string()),
      title: v.optional(v.string()),      // Judges are deactivated rather than deleted, so historic scorecards keep
      // their author and assignment history stays auditable.
      isActive: v.optional(v.boolean()),
      judgingCapacity: v.optional(v.number()),
    }).index("email", ["email"]) // index for the email. do not remove or modify
      .index("by_role", ["role"]),

    hackathons: defineTable({
      name: v.string(),
      slug: v.string(),
      // Logo is a short text token (an emoji or short mark) or a URL. Storing
      // it as text keeps the dashboard usable with no asset pipeline.
      logo: v.optional(v.string()),
      tagline: v.string(),
      description: v.string(),
      problemStatement: v.optional(v.string()),
      eligibility: v.optional(v.string()),
      rules: v.optional(v.string()),
      location: v.string(),
      status: hackathonStatusValidator,
      // Exactly one hackathon is the live one; everything else is a draft or an
      // archive. Every other query resolves its scope through this flag.
      isCurrent: v.boolean(),
      // Schedule. Kept as separate deadlines because organizers close each
      // phase independently.
      startsAt: v.number(),
      endsAt: v.number(),
      registrationClosesAt: v.number(),
      submissionsCloseAt: v.number(),
      judgingStartsAt: v.number(),
      judgingEndsAt: v.number(),
      // Phase switches. An admin toggles these from the settings screen; the
      // judge and participant surfaces read them.
      registrationOpen: v.boolean(),
      submissionsOpen: v.boolean(),
      judgingOpen: v.boolean(),
      // Blind judging hides team and member identity from judges entirely.
      blindJudging: v.boolean(),
      publicLeaderboard: v.boolean(),
      resultsPublished: v.boolean(),
      resultsPublishedAt: v.optional(v.number()),
      maxTeamSize: v.number(),
      createdAt: v.number(),
    })
      .index("by_slug", ["slug"])
      .index("by_status", ["status"])
      .index("by_current", ["isCurrent"]),

    tracks: defineTable({
      hackathonId: v.id("hackathons"),
      name: v.string(),
      description: v.string(),
      // Flat accent color used for badges/blocks in the UI.
      color: v.string(),
      order: v.number(),
    }).index("by_hackathon", ["hackathonId"]),

    // Rubric shared by every judge so scores stay comparable.
    //
    // The rubric is fully admin-configurable: a criterion contributes exactly
    // its `maxScore` to the total, and the total is the sum of every maxScore.
    // Nothing about scoring is hard-coded, so an admin can reshape the whole
    // rubric (see the default 20/20/20/15/15/10 = 100 example) without code
    // changes. Because a score is locked once submitted, criteria are only
    // editable while no final scorecard exists.
    judgingCriteria: defineTable({
      hackathonId: v.id("hackathons"),
      name: v.string(),
      description: v.string(),
      // Shown to the judge next to the score buttons as evaluation guidance.
      guidance: v.optional(v.string()),
      maxScore: v.number(),
      order: v.number(),
    }).index("by_hackathon", ["hackathonId"]),

    teams: defineTable({
      hackathonId: v.id("hackathons"),
      trackId: v.optional(v.id("tracks")),
      name: v.string(),
      projectName: v.string(),
      tagline: v.string(),
      description: v.string(),
      techStack: v.array(v.string()),
      createdAt: v.number(),
      // Set when a participant self-serves the team, so "my team" resolution
      // works before any other member is added.
      createdBy: v.optional(v.id("users")),
    })
      .index("by_hackathon", ["hackathonId"])
      .index("by_track", ["trackId"])
      .index("by_createdBy", ["createdBy"]),

    // Membership is a join table so participants are only ever reachable
    // through their own team, which is what the participant queries rely on.
    teamMembers: defineTable({
      teamId: v.id("teams"),
      hackathonId: v.id("hackathons"),
      userId: v.optional(v.id("users")),
      name: v.string(),
      email: v.string(),
      isLead: v.boolean(),
      role: v.string(),
    })
      .index("by_team", ["teamId"])
      .index("by_user", ["userId"])
      .index("by_hackathon", ["hackathonId"]),

    submissions: defineTable({
      hackathonId: v.id("hackathons"),
      teamId: v.id("teams"),
      status: submissionStatusValidator,
      // Human-readable identifier issued at final submit, e.g. "RPT-26-0042".
      // This is what participants quote in correspondence, so it is generated
      // once and never changes.
      submissionRef: v.optional(v.string()),
      // The structured form. Field names mirror the submission UI one-to-one.
      problemStatement: v.optional(v.string()),
      solutionDescription: v.optional(v.string()),
      targetUsers: v.optional(v.string()),
      keyFeatures: v.array(v.string()),
      innovation: v.optional(v.string()),
      expectedImpact: v.optional(v.string()),
      // The technology stack is canonical on the team row (it is what the judge
      // queue and the team registry read), so it is duplicated here only as an
      // optional snapshot of what the participant declared at submit time.
      technologyStack: v.optional(v.array(v.string())),
      implementationDetails: v.optional(v.string()),
      futureScope: v.optional(v.string()),
      // External resources.
      githubUrl: v.optional(v.string()),
      liveDemoUrl: v.optional(v.string()),
      demoVideoUrl: v.optional(v.string()),
      // Retained from the original single-field form and still shown to judges.
      abstract: v.optional(v.string()),
      highlights: v.array(v.string()),
      videoUrl: v.optional(v.string()),
      submittedAt: v.optional(v.number()),
      updatedAt: v.optional(v.number()),
      // Set when the submission is finalized. A locked submission rejects every
      // participant write until an admin explicitly reopens it.
      lockedAt: v.optional(v.number()),
      reopenedAt: v.optional(v.number()),
      reopenedBy: v.optional(v.id("users")),
      // Why an admin reopened a locked submission, shown back to the team.
      reopenNote: v.optional(v.string()),
      // Advisory only — see the aiReview note in this file.
      aiReview: v.optional(aiReview),
    })
      .index("by_hackathon", ["hackathonId"])
      .index("by_team", ["teamId"])
      .index("by_status", ["status"]),

    // A judge is assigned to a team. The existence of this row is the
    // authorization boundary for a judge viewing a submission.
    assignments: defineTable({
      hackathonId: v.id("hackathons"),
      judgeId: v.id("users"),
      teamId: v.id("teams"),
      status: assignmentStatusValidator,
      assignedAt: v.number(),
      dueAt: v.number(),
    })
      .index("by_judge", ["judgeId"])
      // Used to resolve "is this judge assigned to this team" in one lookup,
      // which is the authorization check behind every judge read and write.
      .index("by_judge_team", ["judgeId", "teamId"])
      .index("by_team", ["teamId"])
      .index("by_hackathon", ["hackathonId"]),

    // One scorecard per (assignment). Only the owning judge can write it, and
    // only via `judging.saveScore`; no other function may update it.
    scores: defineTable({
      hackathonId: v.id("hackathons"),
      assignmentId: v.id("assignments"),
      teamId: v.id("teams"),
      judgeId: v.id("users"),
      // criterion name -> awarded points (0..criterion maxScore)
      breakdown: v.record(v.string(), v.number()),
      // criterion name -> the judge's own reasoning for that criterion. Kept
      // separate from `comments`, which is the overall note to the panel.
      criterionComments: v.optional(v.record(v.string(), v.string())),
      totalScore: v.number(),
      // Snapshot of the rubric ceiling at the time of scoring, so a later rubric
      // change can never retroactively rescale a locked scorecard.
      maxTotalScore: v.number(),
      comments: v.string(),
      recommendation: v.union(
        v.literal("advance"),
        v.literal("hold"),
        v.literal("reject"),
      ),
      // Judges may keep a private draft and finalize it later.
      isFinal: v.boolean(),
      updatedAt: v.number(),
      submittedAt: v.optional(v.number()),
    })
      .index("by_judge", ["judgeId"])
      .index("by_team", ["teamId"])
      .index("by_assignment", ["assignmentId"])
      .index("by_hackathon", ["hackathonId"]),

    // Uploaded supporting files. Binary content lives in Convex file storage
    // under `storageId`; this table is the team's own index to it. It is
    // separate from the submission document so a file can be removed without
    // touching the form.
    submissionFiles: defineTable({
      hackathonId: v.id("hackathons"),
      teamId: v.id("teams"),
      submissionId: v.id("submissions"),
      // One of "presentation" | "documentation" | "architecture" | "other".
      kind: v.string(),
      fileName: v.string(),
      contentType: v.string(),
      size: v.number(),
      storageId: v.string(),
      uploadedBy: v.id("users"),
      uploadedAt: v.number(),
    })
      .index("by_submission", ["submissionId"])
      .index("by_team", ["teamId"])
      .index("by_hackathon", ["hackathonId"]),

    // A judge declared unable to evaluate a specific team. Enforced on every
    // judge-facing read and write, not just hidden in the UI.
    judgeConflicts: defineTable({
      hackathonId: v.id("hackathons"),
      judgeId: v.id("users"),
      teamId: v.id("teams"),
      reason: v.optional(v.string()),
      createdBy: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_hackathon", ["hackathonId"])
      .index("by_judge", ["judgeId"])
      .index("by_team", ["teamId"])
      .index("by_judge_team", ["judgeId", "teamId"]),

    // Deep, per-criterion analysis produced by the AI copilot.
    //
    // Deliberately a SEPARATE table from `scores`. No server function derives,
    // writes, adjusts or reads a score through this table, so "the AI must never
    // change a judge's score" is a property of the schema rather than a promise
    // in a comment. A brief is only ever read alongside a scorecard, never
    // merged into one.
    judgingBriefs: defineTable({
      hackathonId: v.id("hackathons"),
      submissionId: v.id("submissions"),
      teamId: v.id("teams"),
      // "ready" briefs are safe to show; "failed" rows exist so a judge sees why
      // nothing loaded and gets a retry rather than a blank space.
      status: v.union(v.literal("ready"), v.literal("failed")),
      error: v.optional(v.string()),
      // Which AI provider produced (or was configured for) this analysis, e.g.
      // "gemini". Persisted with every row so history stays explainable when
      // the provider changes later.
      provider: v.string(),
      model: v.string(),
      brief: v.optional(projectBrief),
      // Failed rows carry an empty record; the criteria shape itself is only
      // meaningful for ready briefs.
      criteria: v.record(v.string(), criterionAnalysis),
      generatedAt: v.number(),
      // How many model claims failed verbatim verification and were discarded.
      // Surfaced in the UI, not hidden: a judge deserves to know the machine
      // asserted things that did not check out.
      droppedUnverified: v.number(),
      // Changes whenever the submission's content changes, so a stale brief is
      // never presented as current.
      inputHash: v.string(),
    })
      .index("by_submission", ["submissionId"])
      .index("by_team", ["teamId"])
      .index("by_hackathon", ["hackathonId"]),

    /**
     * GitHub repository analysis for a submission.
     *
     * SEPARATE from `scores`, like `judgingBriefs`: no server function derives,
     * writes, adjusts or reads a score through this table. A repo report is
     * advisory technical evidence for a human judge, nothing more.
     *
     * The report is produced deterministically from the public GitHub API
     * (plus an optional neutral LLM narrative); it never asserts that a
     * capability is absent — thin evidence is worded as "not identified in
     * the analyzed repository" with the scan's coverage limits stated.
     */
    repoAnalyses: defineTable({
      hackathonId: v.id("hackathons"),
      submissionId: v.id("submissions"),
      teamId: v.id("teams"),
      // "ready" reports are safe to show; "failed" rows exist so the judge
      // sees why nothing loaded and gets a retry rather than a blank space.
      status: v.union(v.literal("ready"), v.literal("failed")),
      error: v.optional(v.string()),
      // Resolved repository coordinates and how the scan was performed.
      repoFullName: v.optional(v.string()),
      repoUrl: v.optional(v.string()),
      requestedUrl: v.optional(v.string()),
      // Only "public" today; the field exists so authenticated/org repos or
      // other sources can be added without a migration.
      visibility: v.union(v.literal("public")),
      // What the analyzer actually had access to, so coverage limits are
      // always stated next to the findings.
      scanCoverage: v.object({
        treeEntries: v.number(),
        filesRead: v.number(),
        truncated: v.boolean(),
        warning: v.optional(v.string()),
      }),
      sections: v.array(repoSection),
      summary: v.string(),
      verification: v.array(v.string()),
      // Populated only when the optional narrative layer ran successfully.
      narrative: v.optional(v.string()),
      narrativeProvider: v.optional(v.string()),
      narrativeModel: v.optional(v.string()),
      fetchedAt: v.number(),
    })
      .index("by_submission", ["submissionId"])
      .index("by_team", ["teamId"])
      .index("by_hackathon", ["hackathonId"]),

    // Append-only record of administrative actions. Written only by
    // `logAudit`; nothing updates or deletes a row.
    auditLog: defineTable({
      hackathonId: v.id("hackathons"),
      actorId: v.id("users"),
      actorName: v.string(),
      action: v.string(),
      targetType: v.string(),
      targetId: v.optional(v.string()),
      targetLabel: v.optional(v.string()),
      metadata: v.optional(v.record(v.string(), v.string())),
      createdAt: v.number(),
    })
      .index("by_hackathon", ["hackathonId"])
      .index("by_createdAt", ["createdAt"])
      .index("by_actor", ["actorId"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
