import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireRole } from "./lib/authorization";
import { getCurrentHackathon } from "./lib/resolve";
import { ROLES } from "./schema";

/**
 * Read-only view of the audit log.
 *
 * Written exclusively by `lib/audit.ts`; this query never mutates, so the log
 * cannot be edited from the product at all.
 */
export const listForAdmin = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ROLES.ADMIN);
    const hackathon = await getCurrentHackathon(ctx);
    if (!hackathon) return { entries: [], total: 0 };

    const all = await ctx.db
      .query("auditLog")
      .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathon._id))
      .collect();

    const entries = all
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, args.limit ?? 200);

    return {
      entries,
      total: all.length,
    };
  },
});

/** Distinct actions present in the log, for the filter control. */
export const actions = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ROLES.ADMIN);
    const hackathon = await getCurrentHackathon(ctx);
    if (!hackathon) return [];

    const all = await ctx.db
      .query("auditLog")
      .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathon._id))
      .collect();
    return [...new Set(all.map((row) => row.action))].sort();
  },
});
