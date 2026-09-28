import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireRole } from "./lib/authorization";
import { getCurrentHackathon } from "./lib/resolve";
import { logAudit } from "./lib/audit";
import { ASSIGNMENT_STATUS, ROLES, SUBMISSION_STATUS } from "./schema";
import type { Id } from "./_generated/dataModel";

/**
 * Judge workspace.
 *
 * Authorization rules enforced throughout:
 *  1. A judge sees only teams they have an `assignments` row for.
 *  2. A declared conflict of interest removes the team from their queue
 *     entirely and blocks both reading and writing it.
 *  3. A judge may only ever write their own scorecard.
 *
 * All three are checked server-side on every read and write, so none of them
 * depend on the client hiding a link.
 */

/**
 * Anonymous, stable labels used when blind judging is on.
 *
 * Derived from creation order so the same submission always maps to the same
 * anonymous label — otherwise "Submission 3" would shift between page loads
 * and judges could not keep notes on a particular project.
 */
type BlindLabels = Map<string, string>;

async function blindLabelsFor(
  ctx: QueryCtx,
  hackathonId: Id<"hackathons">,
): Promise<BlindLabels> {
  const teams = await ctx.db
    .query("teams")
    .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathonId))
    .collect();

  const sorted = [...teams].sort((a, b) => a.createdAt - b.createdAt);
  const labels = new Map<string, string>();
  sorted.forEach((team, index) => {
    labels.set(team._id as string, `Submission ${index + 1}`);
  });
  return labels;
}

export const myAssignments = query({
  args: {},
  handler: async (ctx) => {
    const judge = await requireRole(ctx, ROLES.JUDGE);
    const hackathon = await getCurrentHackathon(ctx);
    if (!hackathon) {
      return {
        criteria: [],
        assignments: [],
        summary: emptySummary(),
        deadline: null,
        recentActivity: [],
        blindJudging: false,
        judgingOpen: false,
      };
    }

    const [assignments, criteria, conflicts, tracks] = await Promise.all([
      ctx.db
        .query("assignments")
        .withIndex("by_judge", (q) => q.eq("judgeId", judge._id))
        .collect(),
      ctx.db
        .query("judgingCriteria")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathon._id))
        .collect(),
      ctx.db
        .query("judgeConflicts")
        .withIndex("by_judge", (q) => q.eq("judgeId", judge._id))
        .collect(),
      ctx.db
        .query("tracks")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathon._id))
        .collect(),
    ]);

    const conflicted = new Set(conflicts.map((c) => c.teamId as string));
    const trackById = new Map(tracks.map((t) => [t._id, t]));
    const blind = hackathon.blindJudging;
    const labels = blind ? await blindLabelsFor(ctx, hackathon._id) : new Map();

    // A conflicted assignment stays in the database (so the admin can see who
    // was stood down), but it is filtered out of the judge's queue entirely.
    const visible = assignments.filter((a) => !conflicted.has(a.teamId as string));

    const teamIds = visible.map((a) => a.teamId);
    const [teams, submissions, myScores] = await Promise.all([
      Promise.all(teamIds.map((id) => ctx.db.get(id))),
      Promise.all(
        teamIds.map((id) =>
          ctx.db
            .query("submissions")
            .withIndex("by_team", (q) => q.eq("teamId", id))
            .unique(),
        ),
      ),
      ctx.db
        .query("scores")
        .withIndex("by_judge", (q) => q.eq("judgeId", judge._id))
        .collect(),
    ]);

    const scoreByAssignment = new Map(
      myScores.map((s) => [s.assignmentId as string, s]),
    );

    const rows = visible
      .map((assignment, index) => {
        const team = teams[index];
        if (!team) return null;
        const submission = submissions[index];
        const score = scoreByAssignment.get(assignment._id as string);
        const label = labels.get(team._id as string) ?? "Submission";

        // How much of the judge's own scorecard is filled in. Counted against
        // this judge's own draft only.
        const scoredCount = score
          ? criteria.filter(
              (c) => typeof score.breakdown[c.name] === "number",
            ).length
          : 0;

        return {
          assignmentId: assignment._id,
          teamId: team._id,
          // Under blind judging the team name and roster are withheld; the
          // project itself is content, not identity, so it stays readable.
          displayName: blind ? label : team.name,
          projectName: team.projectName,
          tagline: blind ? "" : team.tagline,
          trackName: team.trackId
            ? (trackById.get(team.trackId)?.name ?? "—")
            : "—",
          techStack: team.techStack,
          submissionRef: submission?.submissionRef ?? null,
          submissionStatus: submission?.status ?? null,
          hasDemoUrl: Boolean(submission?.liveDemoUrl),
          hasDocuments: false,
          hasAiReview: Boolean(submission?.aiReview),
          status: assignment.status,
          dueAt: assignment.dueAt,
          assignedAt: assignment.assignedAt,
          // Presence of a score drives the "Started"/"Submitted" column, and
          // this is the judge's own draft — never another judge's.
          hasScore: Boolean(score),
          isFinal: score?.isFinal ?? false,
          myTotal: score?.totalScore ?? null,
          myCommentedCount: score
            ? criteria.filter(
                (c) => (score.criterionComments?.[c.name] ?? "").trim().length > 0,
              ).length
            : 0,
          criteriaCount: criteria.length,
          scoredCount,
          lastTouchedAt: score?.updatedAt ?? assignment.assignedAt,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

    // Document counts need the files index, which is fetched per team above;
    // do it here so the table can show "has attachments" without opening it.
    const filesByTeam = new Map<string, number>();
    await Promise.all(
      rows.map(async (row) => {
        const files = await ctx.db
          .query("submissionFiles")
          .withIndex("by_team", (q: any) => q.eq("teamId", row.teamId))
          .collect();
        filesByTeam.set(row.teamId as string, files.length);
      }),
    );
    for (const row of rows) {
      row.hasDocuments = (filesByTeam.get(row.teamId as string) ?? 0) > 0;
    }

    // Recent activity is this judge's own trail only. Surfacing other judges'
    // activity would leak how a submission is being received, which is exactly
    // what the panel process is designed to prevent.
    const recentActivity = [
      ...rows
        .filter((r) => r.hasScore)
        .map((r) => ({
          kind: r.isFinal ? ("submitted" as const) : ("draft" as const),
          teamId: r.teamId,
          label: r.displayName,
          at: r.lastTouchedAt,
        })),
    ]
      .sort((a, b) => b.at - a.at)
      .slice(0, 8);

    return {
      criteria: criteria.sort((a, b) => a.order - b.order),
      assignments: rows,
      blindJudging: blind,
      judgingOpen: hackathon.judgingOpen,
      // The single date a judge actually plans around.
      deadline: hackathon.judgingEndsAt,
      recentActivity,
      summary: {
        total: rows.length,
        submitted: rows.filter((r) => r.status === ASSIGNMENT_STATUS.SUBMITTED)
          .length,
        inProgress: rows.filter(
          (r) => r.status === ASSIGNMENT_STATUS.IN_PROGRESS,
        ).length,
        notStarted: rows.filter(
          (r) => r.status === ASSIGNMENT_STATUS.NOT_STARTED,
        ).length,
      },
    };
  },
});

function emptySummary() {
  return { total: 0, submitted: 0, inProgress: 0, notStarted: 0 };
}

/** Full review context for one assigned team. */
export const reviewDetail = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const judge = await requireRole(ctx, ROLES.JUDGE);
    const hackathon = await getCurrentHackathon(ctx);
    if (!hackathon) throw new Error("No hackathon is currently active.");

    const assignment = await ctx.db
      .query("assignments")
      .withIndex("by_judge_team", (q) =>
        q.eq("judgeId", judge._id).eq("teamId", args.teamId),
      )
      .unique();

    // No assignment means this judge has no business here.
    if (!assignment) {
      throw new Error("You are not assigned to this team.");
    }

    // A declared conflict blocks the read outright, not just the write.
    const conflict = await ctx.db
      .query("judgeConflicts")
      .withIndex("by_judge_team", (q) =>
        q.eq("judgeId", judge._id).eq("teamId", args.teamId),
      )
      .unique();
    if (conflict) {
      throw new Error(
        "You have been stood down from this submission due to a declared conflict of interest.",
      );
    }

    const [team, submission, track, criteria, members, myScore, files] =
      await Promise.all([
        ctx.db.get(args.teamId),
        ctx.db
          .query("submissions")
          .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
          .unique(),
        ctx.db
          .query("tracks")
          .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathon._id))
          .collect(),
        ctx.db
          .query("judgingCriteria")
          .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathon._id))
          .collect(),
        ctx.db
          .query("teamMembers")
          .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
          .collect(),
        ctx.db
          .query("scores")
          .withIndex("by_assignment", (q) => q.eq("assignmentId", assignment._id))
          .unique(),
        ctx.db
          .query("submissionFiles")
          .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
          .collect(),
      ]);

    const blind = hackathon.blindJudging;
    const labels = blind ? await blindLabelsFor(ctx, hackathon._id) : new Map();

    // Uploaded documents. Served through Convex storage URLs scoped to this
    // judge reading a team they are actually assigned to.
    const documents = await Promise.all(
      files.map(async (file) => ({
        id: file._id,
        kind: file.kind,
        name: file.fileName,
        size: file.size,
        url: await ctx.storage.getUrl(
          file.storageId as unknown as Id<"_storage">,
        ),
      })),
    );

    return {
      assignment: {
        id: assignment._id,
        status: assignment.status,
        dueAt: assignment.dueAt,
      },
      blindJudging: blind,
      judgingOpen: hackathon.judgingOpen,
      deadline: hackathon.judgingEndsAt,
      team: team
        ? {
            id: team._id,
            name: blind
              ? (labels.get(team._id as string) ?? "Submission")
              : team.name,
            projectName: team.projectName,
            tagline: blind ? "" : team.tagline,
            description: team.description,
            techStack: team.techStack,
            repoUrl: submission?.githubUrl ?? null,
            demoUrl: submission?.liveDemoUrl ?? null,
            videoUrl: submission?.demoVideoUrl ?? null,
            trackName: team.trackId
              ? (track.find((t) => t._id === team.trackId)?.name ?? "—")
              : "—",
          }
        : null,
      // Under blind judging the roster is withheld entirely — names, and with
      // them any employer or college the team listed.
      members: blind
        ? []
        : members.map((m) => ({
            name: m.name,
            role: m.role,
            isLead: m.isLead,
          })),
      documents,
      submission: submission
        ? {
            status: submission.status,
            submissionRef: submission.submissionRef ?? null,
            // The structured form, exactly as the team wrote it.
            problemStatement: submission.problemStatement ?? "",
            solutionDescription: submission.solutionDescription ?? "",
            targetUsers: submission.targetUsers ?? "",
            keyFeatures: submission.keyFeatures,
            innovation: submission.innovation ?? "",
            expectedImpact: submission.expectedImpact ?? "",
            implementationDetails: submission.implementationDetails ?? "",
            futureScope: submission.futureScope ?? "",
            abstract: submission.abstract,
            highlights: submission.highlights,
            submittedAt: submission.submittedAt ?? null,
            // Read-only advisory context. Carries no score and cannot write one.
            aiReview: submission.aiReview ?? null,
          }
        : null,
      criteria: criteria.sort((a, b) => a.order - b.order),
      myScore: myScore
        ? {
            breakdown: myScore.breakdown,
            criterionComments: myScore.criterionComments ?? {},
            totalScore: myScore.totalScore,
            maxTotalScore: myScore.maxTotalScore,
            comments: myScore.comments,
            recommendation: myScore.recommendation,
            isFinal: myScore.isFinal,
            submittedAt: myScore.submittedAt ?? null,
            updatedAt: myScore.updatedAt,
          }
        : null,
    };
  },
});

/**
 * Total a scorecard.
 *
 * A criterion contributes exactly the points awarded, so the ceiling is the
 * sum of every criterion's `maxScore`. Nothing about the rubric is assumed
 * here — an admin reshaping it changes the denominator automatically.
 */
function computeTotal(
  breakdown: Record<string, number>,
  criteria: { name: string; maxScore: number }[],
): { total: number; maxTotal: number } {
  let total = 0;
  let maxTotal = 0;
  for (const criterion of criteria) {
    maxTotal += criterion.maxScore;
    const raw = breakdown[criterion.name];
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    total += Math.max(0, Math.min(criterion.maxScore, raw));
  }
  return { total: Number(total.toFixed(2)), maxTotal };
}

const scoreArgs = {
  teamId: v.id("teams"),
  breakdown: v.record(v.string(), v.number()),
  // criterion name -> the judge's reasoning. Same keying as `breakdown`, and
  // validated against the rubric for the same reason.
  criterionComments: v.optional(v.record(v.string(), v.string())),
  comments: v.string(),
  recommendation: v.union(
    v.literal("advance"),
    v.literal("hold"),
    v.literal("reject"),
  ),
};

/**
 * Save (draft) or submit (finalize) the judge's own scorecard.
 *
 * Rules enforced here and nowhere else:
 *  1. The caller must be the judge the assignment belongs to.
 *  2. A declared conflict of interest blocks writing entirely.
 *  3. A deactivated judge cannot submit.
 *  4. Final submission requires the judging window to be open.
 *  5. Once finalized the scorecard is immutable — no silent revisions, by a
 *     judge, an admin, or anything else.
 */
export const saveScore = mutation({
  args: {
    ...scoreArgs,
    isFinal: v.boolean(),
  },
  handler: async (ctx, args) => {
    const judge = await requireRole(ctx, ROLES.JUDGE);
    const hackathon = await getCurrentHackathon(ctx);
    if (!hackathon) throw new Error("No hackathon is currently active.");

    if (judge.isActive === false) {
      throw new Error(
        "Your judging access has been deactivated by an organizer.",
      );
    }

    const assignment = await ctx.db
      .query("assignments")
      .withIndex("by_judge_team", (q) =>
        q.eq("judgeId", judge._id).eq("teamId", args.teamId),
      )
      .unique();

    if (!assignment) {
      throw new Error("You are not assigned to this team.");
    }

    const conflict = await ctx.db
      .query("judgeConflicts")
      .withIndex("by_judge_team", (q) =>
        q.eq("judgeId", judge._id).eq("teamId", args.teamId),
      )
      .unique();
    if (conflict) {
      throw new Error(
        "You have been stood down from this submission due to a declared conflict of interest.",
      );
    }

    if (args.isFinal && !hackathon.judgingOpen) {
      throw new Error(
        "Judging is not open right now. You can still save a draft.",
      );
    }

    const criteria = await ctx.db
      .query("judgingCriteria")
      .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathon._id))
      .collect();

    if (criteria.length === 0) {
      throw new Error("No judging criteria are configured for this hackathon.");
    }

    // Reject scores against criteria that do not exist rather than silently
    // dropping them from the total.
    const known = new Set(criteria.map((c) => c.name));
    for (const name of Object.keys(args.breakdown)) {
      if (!known.has(name)) {
        throw new Error(`Unknown scoring criterion: ${name}`);
      }
    }
    for (const name of Object.keys(args.criterionComments ?? {})) {
      if (!known.has(name)) {
        throw new Error(`Unknown scoring criterion in comment: ${name}`);
      }
    }

    // Normalise the comments: trim, and drop empties so a blank box does not
    // persist as an empty string.
    const criterionComments: Record<string, string> = {};
    for (const [name, raw] of Object.entries(args.criterionComments ?? {})) {
      const value = raw.trim();
      if (value) criterionComments[name] = value.slice(0, 2000);
    }

    // An overall note to the panel is part of a complete evaluation, not an
    // optional extra — a score with no reasoning is not reviewable.
    if (args.isFinal && !args.comments.trim()) {
      throw new Error("Add an overall comment before submitting.");
    }

    if (args.isFinal) {
      const missing = criteria.filter(
        (c) => typeof args.breakdown[c.name] !== "number",
      );
      if (missing.length > 0) {
        throw new Error(
          `Score every criterion before submitting. Missing: ${missing
            .map((c) => c.name)
            .join(", ")}`,
        );
      }
    }

    const { total, maxTotal } = computeTotal(args.breakdown, criteria);
    const now = Date.now();

    const existing = await ctx.db
      .query("scores")
      .withIndex("by_assignment", (q) => q.eq("assignmentId", assignment._id))
      .unique();

    if (existing?.isFinal) {
      throw new Error(
        "This scorecard is already submitted and can no longer be changed.",
      );
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        breakdown: args.breakdown,
        criterionComments,
        totalScore: total,
        maxTotalScore: maxTotal,
        comments: args.comments,
        recommendation: args.recommendation,
        isFinal: args.isFinal,
        updatedAt: now,
        ...(args.isFinal ? { submittedAt: now } : {}),
      });
    } else {
      await ctx.db.insert("scores", {
        hackathonId: hackathon._id,
        assignmentId: assignment._id,
        teamId: args.teamId,
        judgeId: judge._id,
        breakdown: args.breakdown,
        criterionComments,
        totalScore: total,
        maxTotalScore: maxTotal,
        comments: args.comments,
        recommendation: args.recommendation,
        isFinal: args.isFinal,
        updatedAt: now,
        ...(args.isFinal ? { submittedAt: now } : {}),
      });
    }

    // Keep the assignment in step with the scorecard so the judge's table
    // reflects real progress.
    await ctx.db.patch(assignment._id, {
      status: args.isFinal
        ? ASSIGNMENT_STATUS.SUBMITTED
        : ASSIGNMENT_STATUS.IN_PROGRESS,
    });

    if (args.isFinal) {
      const submission = await ctx.db
        .query("submissions")
        .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
        .unique();
      if (submission && submission.status === SUBMISSION_STATUS.SUBMITTED) {
        await ctx.db.patch(submission._id, {
          status: SUBMISSION_STATUS.UNDER_REVIEW,
        });
      }

      await logAudit(ctx, {
        hackathonId: hackathon._id,
        actor: judge,
        action: "score.submitted",
        targetType: "team",
        targetId: args.teamId,
        metadata: { total: String(total) },
      });
    }

    return { totalScore: total, maxTotalScore: maxTotal };
  },
});

/**
 * Reopen a finalized scorecard.
 *
 * The counterpart to the lock in `saveScore`, and deliberately the ONLY way out
 * of it. Not a judge function: a judge cannot un-finalize their own card, which
 * is the property that makes "final" mean something. Admins can, and the reason
 * is recorded in the audit log so a reopened card is always explainable.
 */
export const adminReopenScore = mutation({
  args: {
    teamId: v.id("teams"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ROLES.ADMIN);
    const hackathon = await getCurrentHackathon(ctx);
    if (!hackathon) throw new Error("No hackathon is currently active.");

    const score = await ctx.db
      .query("scores")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect();
    const finalCards = score.filter((s) => s.isFinal);
    if (finalCards.length === 0) {
      throw new Error("That team has no submitted scorecard to reopen.");
    }

    for (const card of finalCards) {
      await ctx.db.patch(card._id, {
        isFinal: false,
        submittedAt: undefined,
        updatedAt: Date.now(),
      });
      // The owning judge, not the admin, makes the change from here.
      await ctx.db.patch(card.assignmentId, {
        status: ASSIGNMENT_STATUS.IN_PROGRESS,
      });
    }

    await logAudit(ctx, {
      hackathonId: hackathon._id,
      actor: admin,
      action: "score.reopen",
      targetType: "team",
      targetId: args.teamId,
      metadata: {
        reopened: String(finalCards.length),
        reason: args.reason?.trim() || "No reason given",
      },
    });

    return { reopened: finalCards.length };
  },
});
