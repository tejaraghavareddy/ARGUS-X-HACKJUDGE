import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireRole } from "./lib/authorization";
import { getCurrentHackathon } from "./lib/resolve";
import { logAudit } from "./lib/audit";
import { ROLES } from "./schema";
import type { Doc } from "./_generated/dataModel";

/**
 * Administrative score-anomaly detection.
 *
 * DETECTION IS READ-ONLY. This module never changes, normalizes, excludes or
 * re-weights a single score. It only flags patterns an organizer may want to
 * look at; every remediation (reopen a card, stand a judge down, seek a
 * replacement evaluation) remains a separate, explicit, audited decision.
 *
 * Flags are informational: a divergence may be legitimate (one judge simply
 * rated a weak project far below the others), which is why nothing is acted
 * on automatically and why each flag carries its evidence.
 */

/** Any pairwise difference beyond this many points is flagged. */
const DIVERGENCE_THRESHOLD = 20;
/** Any individual total this far below the rubric ceiling is flagged. */
const LOW_SCORE_FRACTION = 0.4;
/** Any individual total above this fraction of the ceiling is flagged. */
const HIGH_SCORE_FRACTION = 0.98;
/** Fraction of a judge's finalized cards that must match for a near-duplicate. */
const DUPLICATE_MATCH_FRACTION = 0.9;

type Anomaly = {
  type:
    | "divergence"
    | "outlier_high"
    | "outlier_low"
    | "incomplete"
    | "pattern"
    | "duplicate";
  /** Short human headline, e.g. "Potential scoring divergence detected." */
  title: string;
  /** What the system observed, with the numbers, no interpretation attached. */
  detail: string;
  /** Judge names (or emails) implicated, when the flag is about people. */
  judgeNames: string[];
  /** The numbers behind the flag so the admin can judge for themselves. */
  evidence: Record<string, number>;
};

function judgeLabel(judge: Doc<"users"> | null): string {
  return judge?.name ?? judge?.email ?? "Unknown judge";
}

function detect(
  finals: {
    score: Doc<"scores">;
    judgeName: string;
  }[],
  assignedCount: number,
  maxTotal: number,
): Anomaly[] {
  const flags: Anomaly[] = [];
  const totals = finals.map((f) => f.score.totalScore);

  if (finals.length >= 2) {
    const max = Math.max(...totals);
    const min = Math.min(...totals);
    if (max - min > DIVERGENCE_THRESHOLD) {
      const high = finals.filter((f) => f.score.totalScore === max);
      const low = finals.filter((f) => f.score.totalScore === min);
      flags.push({
        type: "divergence",
        title: "Potential scoring divergence detected.",
        detail: `Judge totals span ${min} to ${max} (range ${max - min} of ${maxTotal} points), beyond the ${DIVERGENCE_THRESHOLD}-point review threshold.`,
        judgeNames: [...high, ...low].map((f) => f.judgeName),
        evidence: { min, max, range: max - min, threshold: DIVERGENCE_THRESHOLD },
      });
    }

    // A judge far from the panel's mean — catches the "one judge is out of
    // line with everyone else" case even when no single card is extreme.
    const mean = totals.reduce((s, t) => s + t, 0) / totals.length;
    for (const f of finals) {
      const delta = f.score.totalScore - mean;
      if (Math.abs(delta) > DIVERGENCE_THRESHOLD / 2) {
        flags.push({
          type: delta > 0 ? "outlier_high" : "outlier_low",
          title:
            delta > 0
              ? "Score far above the panel mean."
              : "Score far below the panel mean.",
          detail: `${f.judgeName} scored ${f.score.totalScore} against a panel mean of ${Number(mean.toFixed(1))} (${delta > 0 ? "+" : ""}${Number(delta.toFixed(1))} points).`,
          judgeNames: [f.judgeName],
          evidence: {
            total: f.score.totalScore,
            panelMean: Number(mean.toFixed(1)),
            delta: Number(delta.toFixed(1)),
          },
        });
      }
    }
  }

  for (const f of finals) {
    const total = f.score.totalScore;
    if (maxTotal > 0 && total <= maxTotal * LOW_SCORE_FRACTION) {
      flags.push({
        type: "outlier_low",
        title: "Extremely low score submitted.",
        detail: `${f.judgeName} scored ${total} of ${maxTotal} (≤ ${LOW_SCORE_FRACTION * 100}% of the ceiling).`,
        judgeNames: [f.judgeName],
        evidence: { total, maxTotal },
      });
    }
    if (maxTotal > 0 && total >= maxTotal * HIGH_SCORE_FRACTION) {
      flags.push({
        type: "outlier_high",
        title: "Near-perfect score submitted.",
        detail: `${f.judgeName} scored ${total} of ${maxTotal} (≥ ${HIGH_SCORE_FRACTION * 100}% of the ceiling).`,
        judgeNames: [f.judgeName],
        evidence: { total, maxTotal },
      });
    }
  }

  // Identical criteria scores across two or more judges on the same team —
  // possible duplicate evaluation. Judge totals are expected to differ; every
  // single criterion value matching exactly is not.
  if (finals.length >= 2) {
    for (let i = 0; i < finals.length; i++) {
      for (let j = i + 1; j < finals.length; j++) {
        const a = finals[i].score.breakdown;
        const b = finals[j].score.breakdown;
        const keys = [
          ...new Set([...Object.keys(a), ...Object.keys(b)]),
        ];
        if (keys.length === 0) continue;
        const same = keys.filter((k) => a[k] === b[k]).length;
        if (same / keys.length >= DUPLICATE_MATCH_FRACTION) {
          flags.push({
            type: "duplicate",
            title: "Possible duplicate evaluation.",
            detail: `${finals[i].judgeName} and ${finals[j].judgeName} awarded identical scores on ${same} of ${keys.length} criteria.`,
            judgeNames: [finals[i].judgeName, finals[j].judgeName],
            evidence: {
              matchingCriteria: same,
              totalCriteria: keys.length,
            },
          });
        }
      }
    }
  }

  // Comment-free evaluations are thin for a panel that has to defend its
  // decisions — flagged as a pattern, not an error.
  const silent = finals.filter((f) => !f.score.comments.trim());
  if (silent.length > 0) {
    flags.push({
      type: "pattern",
      title: "Finalized scorecard without an overall comment.",
      detail: `${silent.length === 1 ? silent[0].judgeName : `${silent.length} judges`} submitted no overall comment.`,
      judgeNames: silent.map((f) => f.judgeName),
      evidence: { silentCount: silent.length },
    });
  }

  // Suspiciously fast evaluation (submitted within 2 minutes of the previous
  // one by the same judge) — a light-touch throughput signal.
  const byJudge = new Map<string, Doc<"scores">[]>();
  for (const f of finals) {
    const list = byJudge.get(f.judgeName) ?? [];
    list.push(f.score);
    byJudge.set(f.judgeName, list);
  }
  for (const [name, cards] of byJudge) {
    const times = cards
      .map((c) => c.submittedAt ?? 0)
      .filter((t) => t > 0)
      .sort((a, b) => a - b);
    let fastest = Infinity;
    for (let i = 1; i < times.length; i++) {
      fastest = Math.min(fastest, times[i] - times[i - 1]);
    }
    if (Number.isFinite(fastest) && fastest < 2 * 60 * 1000) {
      flags.push({
        type: "pattern",
        title: "Unusually rapid consecutive submissions.",
        detail: `${name} submitted two scorecards less than 2 minutes apart.`,
        judgeNames: [name],
        evidence: { fastestGapMs: fastest },
      });
    }
  }

  return flags;
}

/** One flagged team, as listed in the overview. */
export type FlaggedTeam = {
  teamId: string;
  teamName: string;
  projectName: string;
  judgeCount: number;
  flags: Anomaly[];
};

/**
 * Team-level anomaly detail for the review interface (admin only).
 *
 * Read-only: returns the flags, every individual evaluation with its
 * criterion-level values, pairwise criterion differences, judge comments and
 * the submission evidence — everything an organizer needs to decide what, if
 * anything, to do. No score is touched by this query.
 */
export const teamAnomalies = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    await requireRole(ctx, ROLES.ADMIN);
    const hackathon = await getCurrentHackathon(ctx);
    if (!hackathon) throw new Error("No hackathon is currently active.");

    const [team, assignments, scores] = await Promise.all([
      ctx.db.get(args.teamId),
      ctx.db
        .query("assignments")
        .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
        .collect(),
      ctx.db
        .query("scores")
        .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
        .collect(),
    ]);
    if (!team) throw new Error("Team not found.");

    const judgeIds = [...new Set(assignments.map((a) => a.judgeId))];
    const judges = await Promise.all(judgeIds.map((id) => ctx.db.get(id)));
    const judgeById = new Map(
      judges.filter((j) => j !== null).map((j) => [j!._id, j!]),
    );

    const criteria = (
      await ctx.db
        .query("judgingCriteria")
        .withIndex("by_hackathon", (q) =>
          q.eq("hackathonId", hackathon._id),
        )
        .collect()
    ).sort((a, b) => a.order - b.order);

    const finals = scores
      .filter((s) => s.isFinal)
      .map((score) => ({
        score,
        judgeName: judgeById.get(score.judgeId)?.name ?? "Unknown judge",
      }))
      .sort((a, b) => b.score.totalScore - a.score.totalScore);

    const maxTotal =
      finals[0]?.score.maxTotalScore ??
      criteria.reduce((sum, c) => sum + c.maxScore, 0);

    const flags = detect(finals, assignments.length, maxTotal);

    // Pairwise criterion-level differences between judges, so the admin can
    // see WHICH criteria drove a divergence rather than just its size.
    const pairwiseDiffs: {
      a: string;
      b: string;
      totalDelta: number;
      criteria: { name: string; a: number | null; b: number | null; delta: number | null }[];
      largest: { name: string; delta: number } | null;
    }[] = [];
    for (let i = 0; i < finals.length; i++) {
      for (let j = i + 1; j < finals.length; j++) {
        const sa = finals[i].score;
        const sb = finals[j].score;
        const rows = criteria.map((c) => {
          const va = typeof sa.breakdown[c.name] === "number" ? sa.breakdown[c.name] : null;
          const vb = typeof sb.breakdown[c.name] === "number" ? sb.breakdown[c.name] : null;
          return {
            name: c.name,
            a: va,
            b: vb,
            delta: va !== null && vb !== null ? va - vb : null,
          };
        });
        const numeric = rows.filter((r) => r.delta !== null);
        const largest =
          numeric.length > 0
            ? numeric.reduce((worst, r) =>
                Math.abs(r.delta!) > Math.abs(worst.delta!) ? r : worst,
              )
            : null;
        pairwiseDiffs.push({
          a: finals[i].judgeName,
          b: finals[j].judgeName,
          totalDelta: sa.totalScore - sb.totalScore,
          criteria: rows,
          largest: largest
            ? { name: largest.name, delta: largest.delta! }
            : null,
        });
      }
    }

    const submission = await ctx.db
      .query("submissions")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .unique();
    const files = await ctx.db
      .query("submissionFiles")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect();

    // Read-only review history: every prior recorded review of this team.
    const reviewHistory = (
      await ctx.db
        .query("auditLog")
        .withIndex("by_hackathon", (q) =>
          q.eq("hackathonId", hackathon._id),
        )
        .collect()
    )
      .filter(
        (e) =>
          e.action === "anomaly.reviewed" &&
          (e.targetId === args.teamId ||
            e.metadata?.teamId === args.teamId),
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((e) => ({
        actorName: e.actorName,
        action: e.action,
        decisions: e.metadata?.decisions ?? "",
        flagsSummary: e.metadata?.flagsSummary ?? "",
        createdAt: e.createdAt,
      }));

    return {
      team: {
        id: team._id,
        name: team.name,
        projectName: team.projectName,
        maxTotal,
      },
      judgingLocked: !hackathon.judgingOpen,
      criteria: criteria.map((c) => ({ name: c.name, maxScore: c.maxScore })),
      completion: {
        assigned: assignments.length,
        completed: assignments.filter((a) => a.status === "submitted").length,
      },
      flags,
      evaluations: finals.map((f) => ({
        judgeId: f.score.judgeId,
        judgeName: f.judgeName,
        totalScore: f.score.totalScore,
        maxTotalScore: f.score.maxTotalScore,
        breakdown: f.score.breakdown,
        criterionComments: f.score.criterionComments ?? {},
        comments: f.score.comments,
        recommendation: f.score.recommendation,
        submittedAt: f.score.submittedAt ?? null,
      })),
      pairwiseDiffs,
      submission: submission
        ? {
            submissionRef: submission.submissionRef ?? null,
            abstract: submission.abstract ?? "",
            highlights: submission.highlights,
            problemStatement: submission.problemStatement ?? "",
            solutionDescription: submission.solutionDescription ?? "",
            githubUrl: submission.githubUrl ?? null,
            liveDemoUrl: submission.liveDemoUrl ?? null,
          }
        : null,
      evidenceFiles: files.map((f) => ({
        name: f.fileName,
        kind: f.kind,
        size: f.size,
        contentType: f.contentType,
      })),
      reviewHistory,
    };
  },
});

/**
 * Dashboard-wide anomaly scan (admin only).
 *
 * Read-only. Runs the same rules over every team and returns only flagged
 * teams, most severe first, for the "needs attention" list.
 */
export const scan = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ROLES.ADMIN);
    const hackathon = await getCurrentHackathon(ctx);
    if (!hackathon) return { flaggedTeams: [], scannedTeams: 0 };

    const [teams, assignments, scores] = await Promise.all([
      ctx.db
        .query("teams")
        .withIndex("by_hackathon", (q) =>
          q.eq("hackathonId", hackathon._id),
        )
        .collect(),
      ctx.db
        .query("assignments")
        .withIndex("by_hackathon", (q) =>
          q.eq("hackathonId", hackathon._id),
        )
        .collect(),
      ctx.db
        .query("scores")
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

    const criteria = await ctx.db
      .query("judgingCriteria")
      .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathon._id))
      .collect();
    const rubricMax = criteria.reduce((sum, c) => sum + c.maxScore, 0);

    const flaggedTeams: FlaggedTeam[] = [];
    for (const team of teams) {
      const teamAssignments = assignments.filter((a) => a.teamId === team._id);
      const finals = scores
        .filter((s) => s.teamId === team._id && s.isFinal)
        .map((score) => ({
          score,
          judgeName: judgeById.get(score.judgeId)?.name ?? "Unknown judge",
        }));
      if (finals.length === 0) continue;
      const maxTotal = finals[0]?.score.maxTotalScore ?? rubricMax;
      const flags = detect(finals, teamAssignments.length, maxTotal);
      if (flags.length > 0) {
        flaggedTeams.push({
          teamId: team._id,
          teamName: team.name,
          projectName: team.projectName,
          judgeCount: teamAssignments.length,
          flags,
        });
      }
    }

    flaggedTeams.sort((a, b) => {
      const sev = (t: FlaggedTeam) =>
        t.flags.reduce((s, f) => s + (f.type === "divergence" ? 2 : 1), 0);
      return sev(b) - sev(a);
    });

    return {
      flaggedTeams,
      scannedTeams: teams.length,
    };
  },
});

/**
 * Record the outcome of an admin's manual review.
 *
 * The ONLY write path in this module — and it writes to the audit log, never
 * to `scores`. `decisions` is a human-readable summary of what the organizer
 * decided (e.g. "Accepted spread as legitimate" or "Reopened Judge B's card").
 */
export const recordReview = mutation({
  args: {
    teamId: v.id("teams"),
    decisions: v.string(),
    flagsSummary: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ROLES.ADMIN);
    const hackathon = await getCurrentHackathon(ctx);
    if (!hackathon) throw new Error("No hackathon is currently active.");

    const team = await ctx.db.get(args.teamId);
    if (!team) throw new Error("Team not found.");

    const decisions = args.decisions.trim();
    if (!decisions) {
      throw new Error("Record what you decided before saving the review.");
    }

    await logAudit(ctx, {
      hackathonId: hackathon._id,
      actor: admin,
      action: "anomaly.reviewed",
      targetType: "team",
      targetId: args.teamId,
      targetLabel: team.name,
      metadata: {
        teamId: args.teamId,
        decisions: decisions.slice(0, 2000),
        flagsSummary: (args.flagsSummary ?? "").slice(0, 1000),
      },
    });

    return { ok: true };
  },
});
