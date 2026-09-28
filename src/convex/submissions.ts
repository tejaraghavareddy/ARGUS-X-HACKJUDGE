import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireRole } from "./lib/authorization";
import { ROLES, SUBMISSION_STATUS } from "./schema";

/**
 * Participant submission editing.
 *
 * There is deliberately no `teamId` argument: the team is derived from the
 * caller's own membership, so a participant cannot address another team's
 * record even by passing an id.
 *
 * `scores` is never referenced in this file. A submission and a scorecard are
 * separate records with no path between them.
 */
export const updateSubmission = mutation({
  args: {
    abstract: v.string(),
    highlights: v.array(v.string()),
    videoUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ROLES.PARTICIPANT);

    const membership = await ctx.db
      .query("teamMembers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    if (!membership) {
      throw new Error("You are not part of a team in this hackathon.");
    }

    const submission = await ctx.db
      .query("submissions")
      .withIndex("by_team", (q) => q.eq("teamId", membership.teamId))
      .unique();

    if (!submission) {
      throw new Error("No submission found for your team.");
    }

    if (submission.status === SUBMISSION_STATUS.SUBMITTED) {
      throw new Error(
        "Submissions are locked once submitted. Contact an admin if you need a change.",
      );
    }

    await ctx.db.patch(submission._id, {
      abstract: args.abstract.trim(),
      highlights: args.highlights.map((h) => h.trim()).filter(Boolean),
      videoUrl: args.videoUrl?.trim() || undefined,
    });

    return { ok: true };
  },
});

/** Lock the team's submission in. */
export const submitSubmission = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireRole(ctx, ROLES.PARTICIPANT);

    const membership = await ctx.db
      .query("teamMembers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    if (!membership) {
      throw new Error("You are not part of a team in this hackathon.");
    }

    const submission = await ctx.db
      .query("submissions")
      .withIndex("by_team", (q) => q.eq("teamId", membership.teamId))
      .unique();

    if (!submission) {
      throw new Error("No submission found for your team.");
    }
    if (submission.status !== SUBMISSION_STATUS.DRAFT) {
      throw new Error("This submission has already been submitted.");
    }
    if (!submission.abstract.trim()) {
      throw new Error("Add a project summary before submitting.");
    }

    await ctx.db.patch(submission._id, {
      status: SUBMISSION_STATUS.SUBMITTED,
      submittedAt: Date.now(),
    });

    return { ok: true };
  },
});
