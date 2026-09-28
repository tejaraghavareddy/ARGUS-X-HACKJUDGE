import { v } from "convex/values";
import { query } from "./_generated/server";
import { ROLES } from "./schema";
import { requireRole } from "./lib/authorization";

/** The single hackathon this deployment is currently running. */
export const activeHackathon = query({
  args: {},
  handler: async (ctx) => {
    const hackathon = await ctx.db
      .query("hackathons")
      .withIndex("by_slug", (q) => q.eq("slug", "rapture-2026"))
      .unique();

    if (!hackathon) return null;

    const [tracks, criteria] = await Promise.all([
      ctx.db
        .query("tracks")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathon._id))
        .collect(),
      ctx.db
        .query("judgingCriteria")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathon._id))
        .collect(),
    ]);

    return {
      ...hackathon,
      tracks: tracks.sort((a, b) => a.order - b.order),
      criteria: criteria.sort((a, b) => a.order - b.order),
    };
  },
});

/**
 * Admin oversight dashboard.
 *
 * Aggregated in a single pass so the charts and stat tiles are all reading from
 * one consistent snapshot of the data.
 */
export const adminOverview = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ROLES.ADMIN);

    const hackathon = await ctx.db
      .query("hackathons")
      .withIndex("by_slug", (q) => q.eq("slug", "rapture-2026"))
      .unique();
    if (!hackathon) {
      return { hackathon: null };
    }
    const hackathonId = hackathon._id;

    const [teams, submissions, assignments, scores, tracks, judges] =
      await Promise.all([
        ctx.db
          .query("teams")
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
        ctx.db
          .query("tracks")
          .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathonId))
          .collect(),
        ctx.db
          .query("users")
          .withIndex("by_role", (q) => q.eq("role", ROLES.JUDGE))
          .collect(),
      ]);

    const teamById = new Map(teams.map((t) => [t._id, t]));
    const trackById = new Map(tracks.map((t) => [t._id, t]));

    // Only finalized scorecards count toward standings, so an in-progress
    // draft from one judge can never move a team up the leaderboard.
    const finalScores = scores.filter((s) => s.isFinal);
    const averageByTeam = new Map<string, { total: number; count: number }>();
    for (const score of finalScores) {
      const key = score.teamId as string;
      const entry = averageByTeam.get(key) ?? { total: 0, count: 0 };
      entry.total += score.totalScore;
      entry.count += 1;
      averageByTeam.set(key, entry);
    }

    const standings = teams
      .map((team) => {
        const entry = averageByTeam.get(team._id as string);
        return {
          teamId: team._id,
          teamName: team.name,
          projectName: team.projectName,
          trackName: team.trackId
            ? (trackById.get(team.trackId)?.name ?? "—")
            : "—",
          average: entry ? Number((entry.total / entry.count).toFixed(1)) : null,
          scorecards: entry?.count ?? 0,
        };
      })
      .sort((a, b) => (b.average ?? -1) - (a.average ?? -1));

    const byTrack = tracks
      .map((track) => ({
        name: track.name,
        color: track.color,
        teams: teams.filter((t) => t.trackId === track._id).length,
      }))
      .filter((t) => t.teams > 0)
      .sort((a, b) => b.teams - a.teams);

    const assignmentsByJudge = judges.map((judge) => {
      const own = assignments.filter((a) => a.judgeId === judge._id);
      return {
        judgeId: judge._id,
        name: judge.name ?? "Unnamed judge",
        email: judge.email ?? "",
        organization: judge.organization ?? "—",
        capacity: judge.judgingCapacity ?? own.length,
        assigned: own.length,
        completed: own.filter((a) => a.status === "submitted").length,
        inProgress: own.filter((a) => a.status === "in_progress").length,
      };
    });

    const assignedTeamIds = new Set(assignments.map((a) => a.teamId as string));

    return {
      hackathon,
      totals: {
        teams: teams.length,
        judges: judges.length,
        participants: teams.length * 3,
        assignments: assignments.length,
        completed: assignments.filter((a) => a.status === "submitted").length,
        inProgress: assignments.filter((a) => a.status === "in_progress").length,
        notStarted: assignments.filter((a) => a.status === "not_started").length,
        unassignedTeams: teams.filter(
          (t) => !assignedTeamIds.has(t._id as string),
        ).length,
        scorecards: scores.length,
        finalizedScorecards: finalScores.length,
      },
      submissionBreakdown: {
        draft: submissions.filter((s) => s.status === "draft").length,
        submitted: submissions.filter((s) => s.status === "submitted").length,
        underReview: submissions.filter((s) => s.status === "under_review")
          .length,
        scored: submissions.filter((s) => s.status === "scored").length,
      },
      byTrack,
      standings: standings.slice(0, 10),
      judgeLoad: assignmentsByJudge,
    };
  },
});
