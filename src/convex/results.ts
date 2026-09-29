import { v } from "convex/values";
import { action, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { api } from "./_generated/api";
import { requireRole } from "./lib/authorization";
import { getCurrentHackathon } from "./lib/resolve";
import { actionUser } from "./lib/actionAuth";
import { ROLES } from "./schema";

/**
 * Results center.
 *
 * Two surfaces, one data model:
 *  - `adminResultsCenter` — the admin dashboard: full submission, judging,
 *    scoring, workload and completion detail. Judges' comments stay behind
 *    this wall; they never reach the public leaderboard.
 *  - `publicLeaderboard` — exactly rank, display name and average per team,
 *    and nothing else. No judge names, no comments, no criterion commentary,
 *    no workload or audit data. Gated behind the admin-controlled
 *    publicLeaderboard + resultsPublished flags.
 *
 * Aggregation is the same transparent arithmetic mean used everywhere else:
 * sum of finalized judge totals ÷ number of finalized judges, rounded to one
 * decimal for display only. Drafts never count.
 */

function round1(n: number): number {
  return Number(n.toFixed(1));
}

/**
 * One team's outcome, shared by the admin view and the leaderboard.
 * `judgeScores` (individual totals, judge names) is ADMIN-ONLY data — the
 * public leaderboard reads everything else from these rows but never that
 * field.
 */
async function teamResults(ctx: QueryCtx) {
  const hackathon = await getCurrentHackathon(ctx);
  if (!hackathon) return null;

  const [teams, assignments, scores, criteria, conflicts, submissions] =
    await Promise.all([
      ctx.db
        .query("teams")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathon._id))
        .collect(),
      ctx.db
        .query("assignments")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathon._id))
        .collect(),
      ctx.db
        .query("scores")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathon._id))
        .collect(),
      ctx.db
        .query("judgingCriteria")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathon._id))
        .collect(),
      ctx.db
        .query("judgeConflicts")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathon._id))
        .collect(),
      ctx.db
        .query("submissions")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathon._id))
        .collect(),
    ]);

  const judgeIds = [...new Set(assignments.map((a) => a.judgeId))];
  const judges = await Promise.all(judgeIds.map((id) => ctx.db.get(id)));
  const judgeById = new Map(
    judges.filter((j) => j !== null).map((j) => [j!._id, j!]),
  );

  const sortedCriteria = [...criteria].sort((a, b) => a.order - b.order);
  const rubricMax = sortedCriteria.reduce((sum, c) => sum + c.maxScore, 0);
  const refByTeam = new Map(
    submissions.map((s) => [s.teamId as string, s.submissionRef ?? null]),
  );

  const rows = teams.map((team) => {
    const teamAssignments = assignments.filter((a) => a.teamId === team._id);
    const finals = scores.filter((s) => s.teamId === team._id && s.isFinal);
    const judgeCount = finals.length;
    const totals = finals.map((s) => s.totalScore);
    const average =
      judgeCount > 0
        ? round1(
            totals.reduce((sum, t) => sum + t, 0) / judgeCount,
          )
        : null;
    const completed = teamAssignments.filter(
      (a) => a.status === "submitted",
    ).length;

    // Criterion-level mean across judges — same plain arithmetic mean, never
    // normalized, judges who left a criterion unscored excluded from it.
    const criterionAverages = sortedCriteria.map((c) => {
      const awarded = finals
        .map((s) => s.breakdown[c.name])
        .filter((v): v is number => typeof v === "number");
      return {
        name: c.name,
        maxScore: c.maxScore,
        average:
          awarded.length > 0
            ? round1(awarded.reduce((sum, v) => sum + v, 0) / awarded.length)
            : null,
      };
    });

    // Distribution over 10-point bands across the rubric ceiling.
    const ceiling = Math.max(1, finals[0]?.maxTotalScore ?? rubricMax);
    const distribution = Object.entries(
      totals.reduce<Record<string, number>>((acc, total) => {
        const band = Math.max(0, Math.min(9, Math.floor((total / ceiling) * 10)));
        const label = `${band * 10}-${band === 9 ? 100 : band * 10 + 9}`;
        acc[label] = (acc[label] ?? 0) + 1;
        return acc;
      }, {}),
    )
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return {
      teamId: team._id as string,
      teamName: team.name,
      projectName: team.projectName,
      submissionRef: refByTeam.get(team._id as string) ?? null,
      judgeCount,
      assignedJudges: teamAssignments.length,
      completionPct:
        teamAssignments.length === 0
          ? 0
          : Math.round((completed / teamAssignments.length) * 100),
      isComplete: teamAssignments.length > 0 && completed === teamAssignments.length,
      average,
      min: judgeCount > 0 ? Math.min(...totals) : null,
      max: judgeCount > 0 ? Math.max(...totals) : null,
      range: judgeCount > 0 ? round1(Math.max(...totals) - Math.min(...totals)) : null,
      maxTotalScore: finals[0]?.maxTotalScore ?? rubricMax,
      distribution,
      criterionAverages,
      // Admin-only: who scored what. Never surfaced publicly.
      judgeScores: finals
        .map((s) => ({
          judgeName: judgeById.get(s.judgeId)?.name ?? "Unknown judge",
          totalScore: s.totalScore,
          recommendation: s.recommendation,
        }))
        .sort((a, b) => b.totalScore - a.totalScore),
      conflictedJudges: conflicts.filter((c) => c.teamId === team._id).length,
    };
  });

  rows.sort((a, b) => {
    if (b.average !== a.average) return (b.average ?? -1) - (a.average ?? -1);
    return a.teamName.localeCompare(b.teamName);
  });

  return {
    hackathon: {
      id: hackathon._id,
      name: hackathon.name,
      status: hackathon.status,
      judgingOpen: hackathon.judgingOpen,
      publicLeaderboard: hackathon.publicLeaderboard,
      resultsPublished: hackathon.resultsPublished,
      resultsPublishedAt: hackathon.resultsPublishedAt ?? null,
      leaderboardDisplay: hackathon.leaderboardDisplay ?? "team_names",
    },
    criteria: sortedCriteria.map((c) => ({ name: c.name, maxScore: c.maxScore })),
    rubricMax,
    rows,
  };
}

/** The admin results dashboard (admin only, full detail). */
export const adminResultsCenter = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ROLES.ADMIN);
    const base = await teamResults(ctx);
    if (!base) return null;

    const [teams, assignments, conflicts] = await Promise.all([
      ctx.db
        .query("teams")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", base.hackathon.id))
        .collect(),
      ctx.db
        .query("assignments")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", base.hackathon.id))
        .collect(),
      ctx.db
        .query("judgeConflicts")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", base.hackathon.id))
        .collect(),
    ]);
    void teams;

    const completed = assignments.filter((a) => a.status === "submitted").length;

    // Judge workload.
    const judgeRoleUsers = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", ROLES.JUDGE))
      .collect();
    const conflictedPairs = new Set(
      conflicts.map((c) => `${c.judgeId}:${c.teamId}`),
    );
    const judgeWorkload = judgeRoleUsers
      .map((judge) => {
        const own = assignments.filter((a) => a.judgeId === judge._id);
        return {
          judgeId: judge._id,
          name: judge.name ?? "Unnamed judge",
          organization: judge.organization ?? "—",
          isActive: judge.isActive !== false,
          assigned: own.length,
          completed: own.filter((a) => a.status === "submitted").length,
          conflicted: own.filter((a) =>
            conflictedPairs.has(`${judge._id}:${a.teamId}`),
          ).length,
        };
      })
      .sort((a, b) => b.assigned - a.assigned);

    // Pending evaluations grouped by team — the "needs chasing" list.
    const pendingByTeam = new Map<string, number>();
    for (const a of assignments) {
      if (a.status !== "submitted") {
        pendingByTeam.set(
          a.teamId as string,
          (pendingByTeam.get(a.teamId as string) ?? 0) + 1,
        );
      }
    }

    // Anomaly flags, reusing the anomaly module's detection.
    const scan = await ctx.db
      .query("scores")
      .withIndex("by_hackathon", (q) => q.eq("hackathonId", base.hackathon.id))
      .collect();
    void scan;

    return {
      ...base,
      totals: {
        teams: base.rows.length,
        assignments: assignments.length,
        completed,
        pending: assignments.length - completed,
        completionPct:
          assignments.length === 0
            ? 0
            : Math.round((completed / assignments.length) * 100),
      },
      judgeWorkload,
      pendingByTeam: [...pendingByTeam.entries()].map(([teamId, pending]) => ({
        teamId,
        pending,
      })),
    };
  },
});

/**
 * The public leaderboard (any signed-in user, gated by admin flags).
 *
 * Deliberately minimal: rank, display name and average. When
 * `leaderboardDisplay` is "anonymous_ids" the name is the stable submission
 * reference (e.g. "RAP-0002") — team names, members and judges never leave
 * the admin surface. Judge comments, criterion commentary, individual judge
 * scores and internal fields are structurally absent from this response.
 */
export const publicLeaderboard = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { visible: false, published: false, entries: [] };

    const hackathon = await getCurrentHackathon(ctx);
    if (!hackathon) return { visible: false, published: false, entries: [] };

    const published = hackathon.resultsPublished;
    if (!(hackathon.publicLeaderboard && published)) {
      return { visible: false, published, entries: [] };
    }

    const base = await teamResults(ctx);
    if (!base) return { visible: true, published, entries: [] };

    const anonymous =
      (hackathon.leaderboardDisplay ?? "team_names") === "anonymous_ids";

    const ranked = [...base.rows]
      .filter((r) => r.average !== null)
      .sort(
        (a, b) =>
          b.average! - a.average! || a.teamName.localeCompare(b.teamName),
      );

    return {
      visible: true,
      published,
      hackathonName: hackathon.name,
      leaderboardDisplay: anonymous ? "anonymous_ids" : "team_names",
      entries: ranked.map((r, index) => ({
        rank: index + 1,
        // Anonymous mode shows the stable submission reference, not the name.
        displayName: anonymous
          ? (r.submissionRef ?? `Submission ${index + 1}`)
          : r.teamName,
        projectName: anonymous ? null : r.projectName,
        average: r.average,
        judgeCount: r.judgeCount,
      })),
    };
  },
});

/**
 * CSV export of the full results table (admin only).
 *
 * An action so the client can trigger a file download. Contains admin-facing
 * results — averages, per-criterion means, per-judge totals, completion — but
 * still no judge comments: exports are for announcing outcomes, not leaking
 * deliberation notes.
 */
export const exportCsv = action({
  args: { includeJudgeScores: v.boolean() },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; csv?: string; error?: string }> => {
    const auth = await actionUser(ctx);
    if (!auth.ok) return { ok: false, error: auth.error };
    if (auth.user.role !== ROLES.ADMIN) {
      return { ok: false, error: "Only admins can export results." };
    }

    const data = await ctx.runQuery(api.results.adminResultsCenter, {});
    if (!data) return { ok: false, error: "No hackathon is currently active." };

    const esc = (value: unknown) => {
      const s = String(value ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const lines: string[] = [];
    const head = [
      "rank",
      "team",
      "project",
      "submission_ref",
      "judges_completed",
      "judges_assigned",
      "completion_pct",
      "average",
      "min",
      "max",
      "range",
      ...data.criteria.map((c) => `criterion:${c.name}`),
      ...(args.includeJudgeScores ? ["judge_scores"] : []),
      "method",
    ];
    lines.push(head.map(esc).join(","));

    const ranked = [...data.rows].sort(
      (a, b) => (b.average ?? -1) - (a.average ?? -1),
    );
    ranked.forEach((r, index) => {
      const line = [
        r.average === null ? "" : index + 1,
        r.teamName,
        r.projectName,
        r.submissionRef ?? "",
        r.judgeCount,
        r.assignedJudges,
        r.completionPct,
        r.average ?? "",
        r.min ?? "",
        r.max ?? "",
        r.range ?? "",
        ...data.criteria.map((c) => {
          const found = r.criterionAverages.find((x) => x.name === c.name);
          return found?.average ?? "";
        }),
        ...(args.includeJudgeScores
          ? [
              r.judgeScores
                .map((j) => `${j.judgeName}=${j.totalScore}`)
                .join("; "),
            ]
          : []),
        "Arithmetic mean of finalized judge totals (sum / count), 1-decimal display rounding; no normalization",
      ];
      lines.push(line.map(esc).join(","));
    });

    return { ok: true, csv: lines.join("\n") };
  },
});
