import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireRole } from "./lib/authorization";
import { ROLES } from "./schema";

/**
 * The signed-in participant's team and submission.
 *
 * Scoped strictly by `userId`, so a participant cannot read another team by
 * guessing an id — there is no id argument on this query at all.
 */
export const myTeam = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireRole(ctx, ROLES.PARTICIPANT);

    const membership = await ctx.db
      .query("teamMembers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    if (!membership) {
      return { membership: null, team: null };
    }

    const [team, members, submission, tracks, assignments, scores] =
      await Promise.all([
        ctx.db.get(membership.teamId),
        ctx.db
          .query("teamMembers")
          .withIndex("by_team", (q) => q.eq("teamId", membership.teamId))
          .collect(),
        ctx.db
          .query("submissions")
          .withIndex("by_team", (q) => q.eq("teamId", membership.teamId))
          .unique(),
        ctx.db.query("tracks").collect(),
        ctx.db
          .query("assignments")
          .withIndex("by_team", (q) => q.eq("teamId", membership.teamId))
          .collect(),
        ctx.db
          .query("scores")
          .withIndex("by_team", (q) => q.eq("teamId", membership.teamId))
          .collect(),
      ]);

    const finalScores = scores.filter((s) => s.isFinal);

    return {
      membership: { isLead: membership.isLead, role: membership.role },
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
              ? (tracks.find((t) => t._id === team.trackId)?.name ?? "—")
              : "—",
            members: members.map((m) => ({
              name: m.name,
              role: m.role,
              isLead: m.isLead,
              isYou: m.userId === user._id,
            })),
          }
        : null,
      submission: submission
        ? {
            id: submission._id,
            status: submission.status,
            abstract: submission.abstract,
            highlights: submission.highlights,
            videoUrl: submission.videoUrl ?? null,
            submittedAt: submission.submittedAt ?? null,
            // Shown to participants transparently: the same advisory text the
            // judge sees. It has no effect on scoring.
            aiReview: submission.aiReview ?? null,
          }
        : null,
      // Participants see only progress, never scores, until results are
      // published by an admin.
      reviewProgress: {
        assignedJudges: assignments.length,
        completed: assignments.filter((a) => a.status === "submitted").length,
        finalScorecards: finalScores.length,
      },
    };
  },
});

/** Full team registry for admins. */
export const adminTeams = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ROLES.ADMIN);

    const hackathon = await ctx.db
      .query("hackathons")
      .withIndex("by_slug", (q) => q.eq("slug", "rapture-2026"))
      .unique();
    if (!hackathon) return [];

    const hackathonId = hackathon._id;

    const [teams, tracks, submissions, assignments, scores] = await Promise.all([
      ctx.db
        .query("teams")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathonId))
        .collect(),
      ctx.db
        .query("tracks")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathonId))
        .collect(),
      ctx.db
        .query("submissions")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathonId))
        .collect(),
      ctx.db
        .query("assignments")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathonId))
        .collect(),
      ctx.db
        .query("scores")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathonId))
        .collect(),
    ]);

    const trackById = new Map(tracks.map((t) => [t._id, t]));
    const submissionByTeam = new Map(
      submissions.map((s) => [s.teamId as string, s]),
    );

    return teams
      .map((team) => {
        const teamAssignments = assignments.filter(
          (a) => a.teamId === team._id,
        );
        const finals = scores.filter(
          (s) => s.teamId === team._id && s.isFinal,
        );
        const average = finals.length
          ? Number(
              (
                finals.reduce((sum, s) => sum + s.totalScore, 0) / finals.length
              ).toFixed(1),
            )
          : null;

        return {
          id: team._id,
          name: team.name,
          projectName: team.projectName,
          tagline: team.tagline,
          trackName: team.trackId
            ? (trackById.get(team.trackId)?.name ?? "—")
            : "—",
          techStack: team.techStack,
          submissionStatus:
            submissionByTeam.get(team._id as string)?.status ?? null,
          submittedAt:
            submissionByTeam.get(team._id as string)?.submittedAt ?? null,
          assignedJudges: teamAssignments.length,
          completedJudges: teamAssignments.filter(
            (a) => a.status === "submitted",
          ).length,
          averageScore: average,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  },
});

/** Admin detail for a single team, including every scorecard. */
export const adminTeamDetail = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ROLES.ADMIN);

    const [team, members, submission, assignments, scores, criteria, tracks] =
      await Promise.all([
        ctx.db.get(args.teamId),
        ctx.db
          .query("teamMembers")
          .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
          .collect(),
        ctx.db
          .query("submissions")
          .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
          .unique(),
        ctx.db
          .query("assignments")
          .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
          .collect(),
        ctx.db
          .query("scores")
          .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
          .collect(),
        ctx.db.query("judgingCriteria").collect(),
        ctx.db.query("tracks").collect(),
      ]);

    const judgeIds = assignments.map((a) => a.judgeId);
    const judges = await Promise.all(judgeIds.map((id) => ctx.db.get(id)));
    const judgeById = new Map(
      judges.filter((j) => j !== null).map((j) => [j!._id, j!]),
    );

    return {
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
              ? (tracks.find((t) => t._id === team.trackId)?.name ?? "—")
              : "—",
          }
        : null,
      members: members.map((m) => ({
        name: m.name,
        email: m.email,
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
            aiReview: submission.aiReview ?? null,
          }
        : null,
      criteria: criteria.sort((a, b) => a.order - b.order),
      scorecards: scores
        .map((score) => ({
          judgeName: judgeById.get(score.judgeId)?.name ?? "Unknown judge",
          totalScore: score.totalScore,
          breakdown: score.breakdown,
          comments: score.comments,
          recommendation: score.recommendation,
          isFinal: score.isFinal,
          submittedAt: score.submittedAt ?? null,
        }))
        .sort((a, b) => b.totalScore - a.totalScore),
    };
  },
});
