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
    if (!hackathon) return { criteria: [], assignments: [], summary: emptySummary() };

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

        return {
          assignmentId: assignment._id,
          teamId: team._id,
          teamName: blind ? (labels.get(team._id as string) ?? "Submission") : team.name,
          projectName: team.projectName,
          tagline: team.tagline,
          trackName: team.trackId
            ? (trackById.get(team.trackId)?.name ?? "—")
            : "—",
          techStack: team.techStack,
          submissionStatus: submission?.status ?? null,
          hasDemoUrl: Boolean(team.demoUrl),
          hasAiReview: Boolean(submission?.aiReview),
          status: assignment.status,
          dueAt: assignment.dueAt,
          // Presence of a score drives the "Started"/"Submitted" column, and
          // this is the judge's own draft — never another judge's.
          hasScore: Boolean(score),
          isFinal: score?.isFinal ?? false,
          myTotal: score?.totalScore ?? null,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => a.teamName.localeCompare(b.teamName));

    return {
      criteria: criteria.sort((a, b) => a.order - b.order),
      assignments: rows,
      blindJudging: blind,
      judgingOpen: hackathon.judgingOpen,
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

    const [team, submission, track, criteria, members, myScore] = await Promise.all([
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
    ]);

    const blind = hackathon.blindJudging;
    const labels = blind ? await blindLabelsFor(ctx, hackathon._id) : new Map();

    return {
      assignment: {
        id: assignment._id,
        status: assignment.status,
        dueAt: assignment.dueAt,
      },
      blindJudging: blind,
      judgingOpen: hackathon.judgingOpen,
      team: team
        ? {
            id: team._id,
            name: blind
              ? (labels.get(team._id as string) ?? "Submission")
              : team.name,
            projectName: team.projectName,
            tagline: team.tagline,
            description: team.description,
            techStack: team.techStack,
            repoUrl: team.repoUrl ?? null,
            demoUrl: team.demoUrl ?? null,
            trackName: team.trackId
              ? (track.find((t) => t._id === team.trackId)?.name ?? "—")
              : "—",
          }
        : null,
      // Under blind judging the roster is withheld entirely.
      members: blind
        ? []
        : members.map((m) => ({
            name: m.name,
            role: m.role,
            isLead: m.isLead,
          })),
      submission: submission
        ? {
            status: submission.status,
            abstract: submission.abstract,
            highlights: submission.highlights,
            videoUrl: submission.videoUrl ?? null,
            submittedAt: submission.submittedAt ?? null,
            // Read-only advisory context. Carries no score and cannot write one.
            aiReview: submission.aiReview ?? null,
          }
        : null,
      criteria: criteria.sort((a, b) => a.order - b.order),
      myScore: myScore
        ? {
            breakdown: myScore.breakdown,
            totalScore: myScore.totalScore,
            maxTotalScore: myScore.maxTotalScore,
            comments: myScore.comments,
            recommendation: myScore.recommendation,
            isFinal: myScore.isFinal,
            submittedAt: myScore.submittedAt ?? null,
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
