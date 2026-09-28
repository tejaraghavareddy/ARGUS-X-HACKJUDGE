import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireRole } from "./lib/authorization";
import {
  getCurrentHackathon,
  hackathonDetailsValidator,
  hackathonFlagsValidator,
} from "./lib/resolve";
import { logAudit } from "./lib/audit";
import { ROLES } from "./schema";

/** The live hackathon with its rubric. Public — used by every signed-in role. */
export const activeHackathon = query({
  args: {},
  handler: async (ctx) => {
    const hackathon = await getCurrentHackathon(ctx);
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

    const sortedCriteria = criteria.sort((a, b) => a.order - b.order);

    return {
      ...hackathon,
      tracks: tracks.sort((a, b) => a.order - b.order),
      criteria: sortedCriteria,
      rubricTotal: sortedCriteria.reduce((sum, c) => sum + c.maxScore, 0),
    };
  },
});

/** Every hackathon, for the admin switcher. */
export const listForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ROLES.ADMIN);
    return await ctx.db.query("hackathons").collect();
  },
});

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Create a hackathon. New hackathons start closed on every phase. */
export const create = mutation({
  args: {
    ...hackathonDetailsValidator,
    status: v.optional(
      v.union(
        v.literal("registration"),
        v.literal("build"),
        v.literal("submissions_closed"),
        v.literal("judging"),
        v.literal("results"),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ROLES.ADMIN);
    const now = Date.now();

    const name = (args.name ?? "").trim();
    if (!name) throw new Error("A hackathon needs a name.");

    // Defaults are a sane single-day event if the admin leaves dates blank.
    const startsAt = args.startsAt ?? now;
    const id = await ctx.db.insert("hackathons", {
      name,
      slug: `${slugify(name) || "hackathon"}-${now.toString(36)}`,
      logo: args.logo,
      tagline: args.tagline ?? "",
      description: args.description ?? "",
      problemStatement: args.problemStatement,
      eligibility: args.eligibility,
      rules: args.rules,
      location: args.location ?? "",
      status: args.status ?? "registration",
      isCurrent: false,
      startsAt,
      endsAt: args.endsAt ?? startsAt + 36 * 60 * 60 * 1000,
      registrationClosesAt: args.registrationClosesAt ?? startsAt,
      submissionsCloseAt:
        args.submissionsCloseAt ?? (args.endsAt ?? startsAt + 36 * 60 * 60 * 1000),
      judgingStartsAt: args.judgingStartsAt ?? now,
      judgingEndsAt:
        args.judgingEndsAt ??
        (args.submissionsCloseAt ?? startsAt + 36 * 60 * 60 * 1000) +
          3 * 24 * 60 * 60 * 1000,
      // Nothing is open until an admin says so.
      registrationOpen: false,
      submissionsOpen: false,
      judgingOpen: false,
      blindJudging: false,
      publicLeaderboard: false,
      resultsPublished: false,
      maxTeamSize: args.maxTeamSize ?? 4,
      createdAt: now,
    });

    await logAudit(ctx, {
      hackathonId: id,
      actor: admin,
      action: "hackathon.created",
      targetType: "hackathon",
      targetId: id,
      targetLabel: name,
    });

    return { id };
  },
});

/** Edit hackathon details. Only provided fields are written. */
export const update = mutation({
  args: {
    hackathonId: v.id("hackathons"),
    ...hackathonDetailsValidator,
  },
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ROLES.ADMIN);
    const { hackathonId, ...details } = args;

    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(details)) {
      if (value !== undefined) patch[key] = value;
    }
    if (Object.keys(patch).length === 0) return { updated: 0 };

    await ctx.db.patch(hackathonId, patch);

    await logAudit(ctx, {
      hackathonId,
      actor: admin,
      action: "hackathon.updated",
      targetType: "hackathon",
      targetId: hackathonId,
      targetLabel: typeof patch.name === "string" ? patch.name : undefined,
      metadata: { fields: Object.keys(patch).join(", ") },
    });

    return { updated: Object.keys(patch).length };
  },
});

const FLAG_LABELS: Record<string, string> = {
  registrationOpen: "Registration",
  submissionsOpen: "Submissions",
  judgingOpen: "Judging",
  blindJudging: "Blind judging",
  publicLeaderboard: "Public leaderboard",
  resultsPublished: "Results published",
};

/**
 * Toggle a phase switch or visibility flag.
 *
 * Publishing results is the one irreversible-looking action, so it also stamps
 * `resultsPublishedAt` and is recorded in the audit log. Judges' scorecards are
 * never touched here: publishing only changes who can *see* the outcome.
 */
export const setFlag = mutation({
  args: {
    hackathonId: v.id("hackathons"),
    ...hackathonFlagsValidator,
  },
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ROLES.ADMIN);
    const { hackathonId, ...flags } = args;

    const changed: string[] = [];
    for (const [key, value] of Object.entries(flags)) {
      if (typeof value === "boolean") changed.push(`${key}=${value}`);
    }
    if (changed.length === 0) return { updated: 0 };

    const hackathon = await ctx.db.get(hackathonId);
    if (!hackathon) throw new Error("Hackathon not found.");

    await ctx.db.patch(hackathonId, {
      ...(flags.registrationOpen !== undefined && {
        registrationOpen: flags.registrationOpen,
      }),
      ...(flags.submissionsOpen !== undefined && {
        submissionsOpen: flags.submissionsOpen,
      }),
      ...(flags.judgingOpen !== undefined && { judgingOpen: flags.judgingOpen }),
      ...(flags.blindJudging !== undefined && {
        blindJudging: flags.blindJudging,
      }),
      ...(flags.publicLeaderboard !== undefined && {
        publicLeaderboard: flags.publicLeaderboard,
      }),
      ...(flags.resultsPublished !== undefined && {
        resultsPublished: flags.resultsPublished,
        resultsPublishedAt: flags.resultsPublished ? Date.now() : undefined,
      }),
    });

    await logAudit(ctx, {
      hackathonId,
      actor: admin,
      action: flags.resultsPublished !== undefined
        ? flags.resultsPublished
          ? "results.published"
          : "results.unpublished"
        : "settings.toggled",
      targetType: "hackathon",
      targetId: hackathonId,
      targetLabel: hackathon.name,
      metadata: {
        changes: changed.join(", "),
        summary: changed
          .map((c) => FLAG_LABELS[c.split("=")[0]] ?? c.split("=")[0])
          .join(", "),
      },
    });

    return { updated: changed.length };
  },
});

/** Make one hackathon the live one; every other is stood down. */
export const setCurrent = mutation({
  args: { hackathonId: v.id("hackathons") },
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ROLES.ADMIN);
    const target = await ctx.db.get(args.hackathonId);
    if (!target) throw new Error("Hackathon not found.");

    // Exactly one hackathon is live: set the target, clear every other.
    for (const other of await ctx.db.query("hackathons").collect()) {
      const shouldBeCurrent = other._id === target._id;
      if (other.isCurrent !== shouldBeCurrent) {
        await ctx.db.patch(other._id, { isCurrent: shouldBeCurrent });
      }
    }

    await logAudit(ctx, {
      hackathonId: args.hackathonId,
      actor: admin,
      action: "hackathon.set_current",
      targetType: "hackathon",
      targetId: args.hackathonId,
      targetLabel: target.name,
    });

    return { ok: true };
  },
});

/**
 * The admin dashboard.
 *
 * Aggregated in one pass so every tile, chart and table on the page reads from
 * a single consistent snapshot.
 */
export const adminOverview = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ROLES.ADMIN);
    const hackathon = await getCurrentHackathon(ctx);
    if (!hackathon) return { hackathon: null };

    const hackathonId = hackathon._id;

    const [
      teams,
      submissions,
      assignments,
      scores,
      tracks,
      criteria,
      conflicts,
      allJudges,
    ] = await Promise.all([
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
        .query("judgingCriteria")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathonId))
        .collect(),
      ctx.db
        .query("judgeConflicts")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathonId))
        .collect(),
      ctx.db
        .query("users")
        .withIndex("by_role", (q) => q.eq("role", ROLES.JUDGE))
        .collect(),
    ]);

    const teamById = new Map(teams.map((t) => [t._id, t]));
    const trackById = new Map(tracks.map((t) => [t._id, t]));
    const sortedCriteria = criteria.sort((a, b) => a.order - b.order);

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
          average: entry
            ? Number((entry.total / entry.count).toFixed(1))
            : null,
          maxTotal: finalScores.find((s) => s.teamId === team._id)?.maxTotalScore ?? null,
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

    // A judge is only counted as active work if they are not deactivated and
    // have no declared conflicts.
    const conflictedPairs = new Set(
      conflicts.map((c) => `${c.judgeId}:${c.teamId}`),
    );

    const judgeLoad = allJudges.map((judge) => {
      const own = assignments.filter((a) => a.judgeId === judge._id);
      const usable = own.filter(
        (a) => !conflictedPairs.has(`${judge._id}:${a.teamId}`),
      );
      return {
        judgeId: judge._id,
        name: judge.name ?? "Unnamed judge",
        email: judge.email ?? "",
        organization: judge.organization ?? "—",
        isActive: judge.isActive !== false,
        capacity: judge.judgingCapacity ?? usable.length,
        assigned: own.length,
        conflicted: own.length - usable.length,
        completed: own.filter((a) => a.status === "submitted").length,
        inProgress: own.filter((a) => a.status === "in_progress").length,
        notStarted: own.filter((a) => a.status === "not_started").length,
      };
    });

    const assignedTeamIds = new Set(assignments.map((a) => a.teamId as string));
    const pendingEvaluations = assignments.filter(
      (a) => a.status !== "submitted",
    ).length;
    const completionPct =
      assignments.length === 0
        ? 0
        : Math.round(
            (assignments.filter((a) => a.status === "submitted").length /
              assignments.length) *
              100,
          );

    // Per-team assignment coverage, so the dashboard can show where a team has
    // multiple judges and where it has none.
    const teamCoverage = teams
      .map((team) => {
        const own = assignments.filter((a) => a.teamId === team._id);
        const entry = averageByTeam.get(team._id as string);
        return {
          teamId: team._id,
          teamName: team.name,
          projectName: team.projectName,
          trackName: team.trackId
            ? (trackById.get(team.trackId)?.name ?? "—")
            : "—",
          assigned: own.length,
          completed: own.filter((a) => a.status === "submitted").length,
          conflicts: own.filter((a) =>
            conflictedPairs.has(`${a.judgeId}:${a.teamId}`),
          ).length,
          average: entry
            ? Number((entry.total / entry.count).toFixed(1))
            : null,
        };
      })
      .sort((a, b) => b.assigned - a.assigned || a.teamName.localeCompare(b.teamName));

    return {
      hackathon,
      rubric: {
        criteria: sortedCriteria,
        total: sortedCriteria.reduce((sum, c) => sum + c.maxScore, 0),
      },
      totals: {
        teams: teams.length,
        teamsWithNoJudge: teams.filter(
          (t) => !assignedTeamIds.has(t._id as string),
        ).length,
        submissions: submissions.length,
        submittedSubmissions: submissions.filter(
          (s) => s.status !== "draft",
        ).length,
        participants: teams.length * 3,
        judges: allJudges.length,
        activeJudges: allJudges.filter((j) => j.isActive !== false).length,
        assignments: assignments.length,
        completed: assignments.filter((a) => a.status === "submitted").length,
        inProgress: assignments.filter((a) => a.status === "in_progress").length,
        notStarted: assignments.filter((a) => a.status === "not_started").length,
        unassignedTeams: teams.filter(
          (t) => !assignedTeamIds.has(t._id as string),
        ).length,
        pendingEvaluations,
        completionPct,
        conflicts: conflicts.length,
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
      judgeLoad,
      teamCoverage,
      conflicts: conflicts.map((conflict) => ({
        id: conflict._id,
        judgeName:
          allJudges.find((j) => j._id === conflict.judgeId)?.name ?? "Unknown",
        teamName: teamById.get(conflict.teamId)?.name ?? "Unknown team",
        teamProject: teamById.get(conflict.teamId)?.projectName ?? "",
        reason: conflict.reason ?? null,
        createdAt: conflict.createdAt,
      })),
    };
  },
});
