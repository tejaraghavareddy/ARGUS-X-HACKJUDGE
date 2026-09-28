import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireRole } from "./lib/authorization";
import { ASSIGNMENT_STATUS, ROLES, SUBMISSION_STATUS } from "./schema";

/**
 * Judge workspace.
 *
 * The authorization rule enforced throughout: a judge may only ever see teams
 * they have an `assignments` row for, and may only ever write their own
 * scorecard. Both are checked on the server on every read and every write, so
 * nothing here depends on the client hiding a link.
 */
export const myAssignments = query({
  args: {},
  handler: async (ctx) => {
    const judge = await requireRole(ctx, ROLES.JUDGE);

    const [assignments, criteria] = await Promise.all([
      ctx.db
        .query("assignments")
        .withIndex("by_judge", (q) => q.eq("judgeId", judge._id))
        .collect(),
      ctx.db
        .query("judgingCriteria")
        .collect()
        .then((rows) => rows.sort((a, b) => a.order - b.order)),
    ]);

    const teamIds = assignments.map((a) => a.teamId);
    const [teams, tracks, submissions, myScores] = await Promise.all([
      Promise.all(teamIds.map((id) => ctx.db.get(id))),
      ctx.db.query("tracks").collect(),
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

    const trackById = new Map(tracks.map((t) => [t._id, t]));
    const scoreByAssignment = new Map(
      myScores.map((s) => [s.assignmentId as string, s]),
    );

    const rows = assignments
      .map((assignment, index) => {
        const team = teams[index];
        if (!team) return null;
        const submission = submissions[index];
        const score = scoreByAssignment.get(assignment._id as string);

        return {
          assignmentId: assignment._id,
          teamId: team._id,
          teamName: team.name,
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
      criteria,
      assignments: rows,
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

/** Full review context for one assigned team. */
export const reviewDetail = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const judge = await requireRole(ctx, ROLES.JUDGE);

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

    const [team, submission, track, criteria, members, myScore] =
      await Promise.all([
        ctx.db.get(args.teamId),
        ctx.db
          .query("submissions")
          .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
          .unique(),
        ctx.db.query("tracks").collect(),
        ctx.db
          .query("judgingCriteria")
          .withIndex("by_hackathon", (q) =>
        q.eq("hackathonId", assignment.hackathonId),
      )
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

    return {
      assignment: {
        id: assignment._id,
        status: assignment.status,
        dueAt: assignment.dueAt,
      },
      team: team
        ? {
            id: team._id,
            name: team.name,
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
      members: members.map((m) => ({
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
            comments: myScore.comments,
            recommendation: myScore.recommendation,
            isFinal: myScore.isFinal,
            submittedAt: myScore.submittedAt ?? null,
          }
        : null,
    };
  },
});

function computeTotal(
  breakdown: Record<string, number>,
  criteria: { name: string; maxScore: number; weight: number }[],
): number {
  const total = criteria.reduce((sum, criterion) => {
    const raw = breakdown[criterion.name];
    if (typeof raw !== "number" || !Number.isFinite(raw)) return sum;
    const clamped = Math.max(0, Math.min(criterion.maxScore, raw));
    return sum + (clamped / criterion.maxScore) * criterion.weight;
  }, 0);
  return Number(total.toFixed(2));
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
 * Two rules are enforced here and nowhere else in the codebase:
 *  1. The caller must be the judge the assignment belongs to.
 *  2. Once finalized, the score is locked. A judge cannot quietly revise a
 *     scorecard they already submitted, and no AI or admin path can write to it
 *     at all — `scores` is only ever written by this mutation.
 */
export const saveScore = mutation({
  args: {
    ...scoreArgs,
    isFinal: v.boolean(),
  },
  handler: async (ctx, args) => {
    const judge = await requireRole(ctx, ROLES.JUDGE);

    const assignment = await ctx.db
      .query("assignments")
      .withIndex("by_judge_team", (q) =>
        q.eq("judgeId", judge._id).eq("teamId", args.teamId),
      )
      .unique();

    if (!assignment) {
      throw new Error("You are not assigned to this team.");
    }

    const criteria = await ctx.db
      .query("judgingCriteria")
      .withIndex("by_hackathon", (q) =>
        q.eq("hackathonId", assignment.hackathonId),
      )
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

    const totalScore = computeTotal(args.breakdown, criteria);
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
        totalScore,
        comments: args.comments,
        recommendation: args.recommendation,
        isFinal: args.isFinal,
        updatedAt: now,
        ...(args.isFinal ? { submittedAt: now } : {}),
      });
    } else {
      await ctx.db.insert("scores", {
        hackathonId: assignment.hackathonId,
        assignmentId: assignment._id,
        teamId: args.teamId,
        judgeId: judge._id,
        breakdown: args.breakdown,
        totalScore,
        maxTotalScore: 100,
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
    }

    return { totalScore };
  },
});
