import { v } from "convex/values";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";

/**
 * Resolve the live hackathon.
 *
 * The app is scoped to exactly one live event at a time; `isCurrent` is the
 * flag that says which. Every other query resolves its scope through here so
 * there is a single definition of "the current hackathon".
 */
export async function getCurrentHackathon(
  ctx: QueryCtx,
): Promise<Doc<"hackathons"> | null> {
  const current = await ctx.db
    .query("hackathons")
    .withIndex("by_current", (q) => q.eq("isCurrent", true))
    .first();
  if (current) return current;

  // Fall back to the slug the demo seed creates, so a freshly migrated
  // database without the flag still resolves rather than 404-ing.
  return await ctx.db
    .query("hackathons")
    .withIndex("by_slug", (q) => q.eq("slug", "rapture-2026"))
    .first();
}

/** Shape shared by admin mutations that edit a hackathon. */
export const hackathonDetailsValidator = {
  name: v.optional(v.string()),
  logo: v.optional(v.string()),
  tagline: v.optional(v.string()),
  description: v.optional(v.string()),
  problemStatement: v.optional(v.string()),
  eligibility: v.optional(v.string()),
  rules: v.optional(v.string()),
  location: v.optional(v.string()),
  startsAt: v.optional(v.number()),
  endsAt: v.optional(v.number()),
  registrationClosesAt: v.optional(v.number()),
  submissionsCloseAt: v.optional(v.number()),
  judgingStartsAt: v.optional(v.number()),
  judgingEndsAt: v.optional(v.number()),
  maxTeamSize: v.optional(v.number()),
};

/** Toggleable phase/visibility switches on a hackathon. */
export const hackathonFlagsValidator = {
  registrationOpen: v.optional(v.boolean()),
  submissionsOpen: v.optional(v.boolean()),
  judgingOpen: v.optional(v.boolean()),
  blindJudging: v.optional(v.boolean()),
  publicLeaderboard: v.optional(v.boolean()),
  resultsPublished: v.optional(v.boolean()),
};

export type HackathonDetails = {
  [K in keyof typeof hackathonDetailsValidator]?: string | number;
};

export type HackathonFlags = {
  [K in keyof typeof hackathonFlagsValidator]?: boolean;
};

export type HackathonId = Id<"hackathons">;
