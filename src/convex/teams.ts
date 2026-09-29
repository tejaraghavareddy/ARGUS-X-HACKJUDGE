import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireRole } from "./lib/authorization";
import { getCurrentHackathon } from "./lib/resolve";
import { logAudit } from "./lib/audit";
import { ROLES, SUBMISSION_STATUS } from "./schema";

// ---------------------------------------------------------------------------
// Team management (participant self-service)
//
// Scoped the same way as every participant read: the team is resolved from the
// authenticated identity, never from an argument. `memberId` arguments are
// validated against that resolved team, so a participant cannot restructure
// somebody else's team by passing its id.
// ---------------------------------------------------------------------------

/** The caller's own membership, or null. Never takes a teamId. */
async function ownMembership(ctx: any) {
  const user = await requireRole(ctx, ROLES.PARTICIPANT);
  const membership = await ctx.db
    .query("teamMembers")
    .withIndex("by_user", (q: any) => q.eq("userId", user._id))
    .unique();
  return { user, membership };
}

/** Throws unless the caller is the lead of their own team. */
async function requireOwnTeamAsLead(ctx: any) {
  const { user, membership } = await ownMembership(ctx);
  if (!membership) {
    throw new Error("You are not part of a team yet.");
  }
  if (!membership.isLead) {
    throw new Error("Only the team lead can do that.");
  }
  const team = await ctx.db.get(membership.teamId);
  if (!team) throw new Error("Your team no longer exists.");
  return { user, membership, team };
}

export const createTeam = mutation({
  args: { name: v.string(), tagline: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { user, membership } = await ownMembership(ctx);
    if (membership) {
      throw new Error("You are already on a team. Leave it before creating another.");
    }

    const name = args.name.trim();
    if (name.length < 2 || name.length > 60) {
      throw new Error("Team name must be between 2 and 60 characters.");
    }

    const hackathon = await getCurrentHackathon(ctx);
    if (!hackathon) throw new Error("There is no active hackathon to join.");
    if (!hackathon.registrationOpen && Date.now() > hackathon.registrationClosesAt) {
      throw new Error("Registration for this hackathon has closed.");
    }

    const teamId = await ctx.db.insert("teams", {
      hackathonId: hackathon._id,
      name,
      projectName: "",
      tagline: args.tagline?.trim() ?? "",
      description: "",
      techStack: [],
      createdAt: Date.now(),
      createdBy: user._id,
    });

    await ctx.db.insert("teamMembers", {
      teamId,
      hackathonId: hackathon._id,
      userId: user._id,
      name: user.name ?? user.email ?? "Team lead",
      email: user.email ?? "",
      isLead: true,
      role: "Lead",
    });

    await logAudit(ctx, {
      hackathonId: hackathon._id,
      actor: user,
      action: "team.create",
      targetType: "team",
      targetId: teamId,
      targetLabel: name,
    });

    return teamId;
  },
});

export const updateTeam = mutation({
  args: { name: v.string(), tagline: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { team } = await requireOwnTeamAsLead(ctx);
    const name = args.name.trim();
    if (name.length < 2 || name.length > 60) {
      throw new Error("Team name must be between 2 and 60 characters.");
    }
    await ctx.db.patch(team._id, {
      name,
      tagline: args.tagline?.trim() ?? "",
    });
    return team._id;
  },
});

export const addMember = mutation({
  args: { name: v.string(), email: v.string(), role: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { team } = await requireOwnTeamAsLead(ctx);
    const hackathon = await getCurrentHackathon(ctx);

    const email = args.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Enter a valid email address.");
    }
    const name = args.name.trim();
    if (name.length < 2 || name.length > 60) {
      throw new Error("Name must be between 2 and 60 characters.");
    }

    const members = await ctx.db
      .query("teamMembers")
      .withIndex("by_team", (q: any) => q.eq("teamId", team._id))
      .collect();
    if (members.length >= (hackathon?.maxTeamSize ?? 6)) {
      throw new Error(
        `This hackathon allows a maximum of ${hackathon?.maxTeamSize ?? 6} people per team.`,
      );
    }
    if (members.some((m: any) => m.email.toLowerCase() === email)) {
      throw new Error("That person is already on your team.");
    }

    // Link to the account if it exists, so the teammate sees the team the
    // moment they sign in. Otherwise the row is a placeholder by email.
    const existingUser = await ctx.db
      .query("users")
      .withIndex("email", (q: any) => q.eq("email", email))
      .first();
    if (existingUser) {
      const already = await ctx.db
        .query("teamMembers")
        .withIndex("by_user", (q: any) => q.eq("userId", existingUser._id))
        .first();
      if (already) throw new Error("That person is already on a team.");
    }

    return await ctx.db.insert("teamMembers", {
      teamId: team._id,
      hackathonId: team.hackathonId,
      userId: existingUser?._id,
      name,
      email,
      isLead: false,
      role: args.role?.trim() || "Member",
    });
  },
});

export const removeMember = mutation({
  args: { memberId: v.id("teamMembers") },
  handler: async (ctx, args) => {
    const { user, team } = await requireOwnTeamAsLead(ctx);
    const member = await ctx.db.get(args.memberId);

    // Ownership re-checked against the resolved team.
    if (!member || member.teamId !== team._id) {
      throw new Error("That person is not on your team.");
    }
    if (member.isLead) {
      throw new Error(
        "Hand leadership to someone else before removing the current lead.",
      );
    }
    if (member.userId === user._id) {
      throw new Error("You cannot remove yourself while you are the lead.");
    }
    await ctx.db.delete(member._id);
    return true;
  },
});

export const setLeader = mutation({
  args: { memberId: v.id("teamMembers") },
  handler: async (ctx, args) => {
    const { user, team } = await requireOwnTeamAsLead(ctx);
    const members = await ctx.db
      .query("teamMembers")
      .withIndex("by_team", (q: any) => q.eq("teamId", team._id))
      .collect();

    const target = members.find((m: any) => m._id === args.memberId);
    if (!target) throw new Error("That person is not on your team.");
    if (target._id === args.memberId && target.isLead) {
      throw new Error("They are already the team lead.");
    }

    // Exactly one lead at all times, so the demoted member is demoted in the
    // same transaction that promotes the new one.
    for (const m of members) {
      await ctx.db.patch(m._id, {
        isLead: m._id === target._id,
        role: m._id === target._id ? "Lead" : m.role === "Lead" ? "Member" : m.role,
      });
    }

    void user;
    return true;
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
            trackName: team.trackId
              ? (tracks.find((t) => t._id === team.trackId)?.name ?? "—")
              : "—",
            // Derived from the submission rather than stored on the team, so
            // the header can show the project's links without a second lookup.
            repoUrl: submission?.githubUrl ?? null,
            demoUrl: submission?.liveDemoUrl ?? null,
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
            id: submission._id,
            status: submission.status,
            submissionRef: submission.submissionRef ?? null,
            reopenedAt: submission.reopenedAt ?? null,
            reopenNote: submission.reopenNote ?? null,
            abstract: submission.abstract ?? "",
            highlights: submission.highlights,
            githubUrl: submission.githubUrl ?? null,
            liveDemoUrl: submission.liveDemoUrl ?? null,
            videoUrl: submission.demoVideoUrl ?? submission.videoUrl ?? null,
            submittedAt: submission.submittedAt ?? null,
            lockedAt: submission.lockedAt ?? null,
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

// ---------------------------------------------------------------------------
// Multi-judge aggregation
//
// Every number here is a plain arithmetic mean of the judges' own finalized
// totals — no normalization, weighting, trimming or rounding beyond display.
// The `method` string is returned alongside the numbers so whatever renders
// them can state exactly how they were computed.
// ---------------------------------------------------------------------------

/**
 * Full per-judge evaluation analytics for one team (admin only).
 *
 * Individual scorecards and aggregates are gated behind the judging lock:
 * while `judgingOpen` is true only completion status is returned, so no admin
 * peeking at in-flight scores can influence the panel. `rounding` is included
 * in the method string because means are rounded to 1 decimal for display
 * only — the underlying values are untouched.
 */
export const teamScoreAnalytics = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ROLES.ADMIN);
    const hackathon = await getCurrentHackathon(ctx);
    if (!hackathon) throw new Error("No hackathon is currently active.");

    const [assignments, scores, criteria] = await Promise.all([
      ctx.db
        .query("assignments")
        .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
        .collect(),
      ctx.db
        .query("scores")
        .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
        .collect(),
      ctx.db
        .query("judgingCriteria")
        .withIndex("by_hackathon", (q) =>
          q.eq("hackathonId", hackathon._id),
        )
        .collect(),
    ]);

    const judgeIds = [...new Set(assignments.map((a) => a.judgeId))];
    const judges = await Promise.all(judgeIds.map((id) => ctx.db.get(id)));
    const judgeById = new Map(
      judges.filter((j) => j !== null).map((j) => [j!._id, j!]),
    );

    const finalScores = scores.filter((s) => s.isFinal);
    const assigned = assignments.length;
    const completed = assignments.filter(
      (a) => a.status === "submitted",
    ).length;
    const inProgress = assignments.filter(
      (a) => a.status === "in_progress",
    ).length;
    const notStarted = assignments.filter(
      (a) => a.status === "not_started",
    ).length;

    const totals = finalScores.map((s) => s.totalScore);
    const mean =
      totals.length > 0
        ? totals.reduce((sum, t) => sum + t, 0) / totals.length
        : null;

    // Per-criterion: which judges scored it, and the plain mean of exactly
    // those scores. Judges who left a criterion unscored are excluded from
    // that criterion's mean, never counted as zero.
    const criterionStats = criteria
      .sort((a, b) => a.order - b.order)
      .map((criterion) => {
        const awarded = finalScores
          .map((s) => s.breakdown[criterion.name])
          .filter((v): v is number => typeof v === "number");
        return {
          name: criterion.name,
          maxScore: criterion.maxScore,
          judgeCount: awarded.length,
          average:
            awarded.length > 0
              ? Number(
                  (
                    awarded.reduce((sum, v) => sum + v, 0) / awarded.length
                  ).toFixed(1),
                )
              : null,
        };
      });

    const method =
      totals.length > 1
        ? `${totals.length} finalized scorecards. Average = arithmetic mean = (sum of all judge totals) ÷ ${totals.length}, rounded to 1 decimal place for display only. No normalization, weighting or outlier removal is applied. Example: 92, 88, 90 → (92+88+90) ÷ 3 = 90.`
        : totals.length === 1
          ? "1 finalized scorecard. Average equals that judge's total — no adjustment applied."
          : "No finalized scorecards yet.";

    return {
      judgingLocked: !hackathon.judgingOpen,
      completion: {
        assigned,
        completed,
        inProgress,
        notStarted,
        // All assigned judges have submitted a final scorecard.
        isComplete: assigned > 0 && completed === assigned,
        pct: assigned === 0 ? 0 : Math.round((completed / assigned) * 100),
      },
      // While judging is open, only the lock state and completion are
      // exposed. Score details unlock when the judging phase closes.
      aggregates: hackathon.judgingOpen
        ? null
        : {
            judgeCount: totals.length,
            scores: finalScores
              .map((s) => ({
                judgeId: s.judgeId,
                judgeName:
                  judgeById.get(s.judgeId)?.name ?? "Unknown judge",
                totalScore: s.totalScore,
                maxTotalScore: s.maxTotalScore,
                recommendation: s.recommendation,
                submittedAt: s.submittedAt ?? null,
              }))
              .sort((a, b) => b.totalScore - a.totalScore),
            average: mean === null ? null : Number(mean.toFixed(1)),
            min: totals.length ? Math.min(...totals) : null,
            max: totals.length ? Math.max(...totals) : null,
            range: totals.length
              ? Number((Math.max(...totals) - Math.min(...totals)).toFixed(2))
              : null,
            // Distribution over 10-point bands across the rubric ceiling,
            // e.g. { "90-100": 2, "80-89": 1 }. Counted from the raw totals.
            distribution: Object.entries(
              totals.reduce<Record<string, number>>((acc, total) => {
                const maxTotal =
                  finalScores.find((s) => s.totalScore === total)
                    ?.maxTotalScore ?? 100;
                const band = Math.max(
                  0,
                  Math.min(9, Math.floor((total / Math.max(1, maxTotal)) * 10)),
                );
                const label = `${band * 10}-${band === 9 ? 100 : band * 10 + 9}`;
                acc[label] = (acc[label] ?? 0) + 1;
                return acc;
              }, {}),
            )
              .map(([label, count]) => ({ label, count }))
              .sort((a, b) => a.label.localeCompare(b.label)),
            criterionStats,
            method,
          },
    };
  },
});
