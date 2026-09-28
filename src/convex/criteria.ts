import { v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireRole } from "./lib/authorization";
import { getCurrentHackathon } from "./lib/resolve";
import { logAudit } from "./lib/audit";
import { ROLES } from "./schema";
import type { Id } from "./_generated/dataModel";

/**
 * Rubric builder.
 *
 * The rubric is data, not code: an admin can add, edit, delete and reorder
 * criteria freely, and scoring follows automatically because a criterion
 * contributes exactly its `maxScore` to the total.
 *
 * Reshaping the rubric does not rewrite history. Every scorecard stores the
 * `maxTotalScore` it was scored against, so a submitted score keeps its
 * original denominator and is never silently rescaled. The UI surfaces that as
 * a notice rather than blocking the admin.
 */
async function hasSubmittedScores(
  ctx: QueryCtx,
  hackathonId: Id<"hackathons">,
): Promise<boolean> {
  const scores = await ctx.db
    .query("scores")
    .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathonId))
    .collect();
  return scores.some((score) => score.isFinal);
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const hackathon = await getCurrentHackathon(ctx);
    if (!hackathon) return { criteria: [], total: 0, locked: false };

    const [criteria, scores] = await Promise.all([
      ctx.db
        .query("judgingCriteria")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathon._id))
        .collect(),
      ctx.db
        .query("scores")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathon._id))
        .collect(),
    ]);

    const sorted = criteria.sort((a, b) => a.order - b.order);
    return {
      criteria: sorted,
      total: sorted.reduce((sum, c) => sum + c.maxScore, 0),
      hasSubmittedScores: scores.some((score) => score.isFinal),
    };
  },
});

const criterionFields = {
  name: v.string(),
  description: v.string(),
  guidance: v.optional(v.string()),
  maxScore: v.number(),
};

export const create = mutation({
  args: criterionFields,
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ROLES.ADMIN);
    const hackathon = await getCurrentHackathon(ctx);
    if (!hackathon) throw new Error("No hackathon is currently active.");

    const name = args.name.trim();
    if (!name) throw new Error("A criterion needs a name.");
    if (args.maxScore <= 0) throw new Error("Maximum score must be above 0.");

    const existing = await ctx.db
      .query("judgingCriteria")
      .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathon._id))
      .collect();
    if (existing.some((c) => c.name === name)) {
      throw new Error(`A criterion named "${name}" already exists.`);
    }

    const id = await ctx.db.insert("judgingCriteria", {
      hackathonId: hackathon._id,
      name,
      description: args.description.trim(),
      guidance: args.guidance?.trim() || undefined,
      maxScore: args.maxScore,
      order: existing.length,
    });

    await logAudit(ctx, {
      hackathonId: hackathon._id,
      actor: admin,
      action: "rubric.criterion_created",
      targetType: "criterion",
      targetId: id,
      targetLabel: name,
      metadata: { maxScore: String(args.maxScore) },
    });

    return { id };
  },
});

export const update = mutation({
  args: {
    criterionId: v.id("judgingCriteria"),
    ...criterionFields,
  },
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ROLES.ADMIN);
    const hackathon = await getCurrentHackathon(ctx);
    if (!hackathon) throw new Error("No hackathon is currently active.");

    const criterion = await ctx.db.get(args.criterionId);
    if (!criterion) throw new Error("Criterion not found.");
    if (args.maxScore <= 0) throw new Error("Maximum score must be above 0.");

    const name = args.name.trim();
    if (!name) throw new Error("A criterion needs a name.");

    const clash = await ctx.db
      .query("judgingCriteria")
      .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathon._id))
      .collect();
    if (clash.some((c) => c.name === name && c._id !== args.criterionId)) {
      throw new Error(`A criterion named "${name}" already exists.`);
    }

    await ctx.db.patch(args.criterionId, {
      name,
      description: args.description.trim(),
      guidance: args.guidance?.trim() || undefined,
      maxScore: args.maxScore,
    });

    await logAudit(ctx, {
      hackathonId: hackathon._id,
      actor: admin,
      action: "rubric.criterion_updated",
      targetType: "criterion",
      targetId: args.criterionId,
      targetLabel: name,
    });

    return { ok: true };
  },
});

/**
 * Delete a criterion and re-pack the display order so the remaining ones stay
 * contiguous. Any draft scorecards that referenced it are left alone: their
 * breakdown simply carries a key the rubric no longer has, which `saveScore`
 * already tolerates by ignoring unknown keys.
 */
export const remove = mutation({
  args: { criterionId: v.id("judgingCriteria") },
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ROLES.ADMIN);
    const hackathon = await getCurrentHackathon(ctx);
    if (!hackathon) throw new Error("No hackathon is currently active.");

    const criterion = await ctx.db.get(args.criterionId);
    if (!criterion) throw new Error("Criterion not found.");

    await ctx.db.delete(args.criterionId);

    const remaining = await ctx.db
      .query("judgingCriteria")
      .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathon._id))
      .collect();
    remaining.sort((a, b) => a.order - b.order);
    for (const [index, row] of remaining.entries()) {
      if (row.order !== index) await ctx.db.patch(row._id, { order: index });
    }

    await logAudit(ctx, {
      hackathonId: hackathon._id,
      actor: admin,
      action: "rubric.criterion_deleted",
      targetType: "criterion",
      targetId: args.criterionId,
      targetLabel: criterion.name,
    });

    return { ok: true };
  },
});

/**
 * Move a criterion to an absolute position. The client sends the target index
 * rather than a direction so dragging is idempotent.
 */
export const reorder = mutation({
  args: { criterionId: v.id("judgingCriteria"), toIndex: v.number() },
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ROLES.ADMIN);
    const hackathon = await getCurrentHackathon(ctx);
    if (!hackathon) throw new Error("No hackathon is currently active.");

    const rows = await ctx.db
      .query("judgingCriteria")
      .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathon._id))
      .collect();
    rows.sort((a, b) => a.order - b.order);

    const from = rows.findIndex((r) => r._id === args.criterionId);
    if (from === -1) throw new Error("Criterion not found.");

    const to = Math.max(0, Math.min(args.toIndex, rows.length - 1));
    if (to === from) return { ok: true };

    const [moved] = rows.splice(from, 1);
    rows.splice(to, 0, moved);
    for (const [index, row] of rows.entries()) {
      if (row.order !== index) await ctx.db.patch(row._id, { order: index });
    }

    await logAudit(ctx, {
      hackathonId: hackathon._id,
      actor: admin,
      action: "rubric.criterion_reordered",
      targetType: "criterion",
      targetId: args.criterionId,
      targetLabel: moved.name,
      metadata: { from: String(from + 1), to: String(to + 1) },
    });

    return { ok: true };
  },
});
