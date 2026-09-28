import { v } from "convex/values";
import type { FunctionReference } from "convex/server";
import { internalQuery, type QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { getCurrentHackathon } from "./resolve";
import { ROLES } from "../schema";

/**
 * Shared authorization for Convex ACTIONS in the AI/analysis modules.
 *
 * Actions have no `ctx.db`, so authorization runs through internal queries:
 * resolve the Convex Auth session subject to the app user, then apply the
 * same role rules `requireRole` enforces on queries and mutations. Both the
 * AI copilot and the GitHub repository analyzer share this gate so their
 * access rules cannot drift apart.
 */

async function isJudgeAssigned(
  ctx: QueryCtx,
  judgeId: Id<"users">,
  teamId: Id<"teams">,
): Promise<boolean> {
  const row = await ctx.db
    .query("assignments")
    .withIndex("by_judge_team", (q) =>
      q.eq("judgeId", judgeId).eq("teamId", teamId),
    )
    .first();
  return row !== null;
}

async function hasConflict(
  ctx: QueryCtx,
  judgeId: Id<"users">,
  teamId: Id<"teams">,
): Promise<boolean> {
  const row = await ctx.db
    .query("judgeConflicts")
    .withIndex("by_judge_team", (q) =>
      q.eq("judgeId", judgeId).eq("teamId", teamId),
    )
    .first();
  return row !== null;
}

/** Internal: resolve a users-table id to the fields authorization needs. */
export const sessionUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return null;
    return { _id: user._id, role: user.role, isActive: user.isActive };
  },
});

/** Internal: the live hackathon's id and blind-judging flag. */
export const currentHackathonMeta = internalQuery({
  args: {},
  handler: async (ctx) => {
    const hackathon = await getCurrentHackathon(ctx);
    if (!hackathon) return null;
    return { _id: hackathon._id, blindJudging: hackathon.blindJudging };
  },
});

/** Internal: assignment + conflict status for one judge/team pair. */
export const assignmentAccess = internalQuery({
  args: { judgeId: v.id("users"), teamId: v.id("teams") },
  handler: async (ctx, args) => {
    return {
      assigned: await isJudgeAssigned(ctx, args.judgeId, args.teamId),
      conflict: await hasConflict(ctx, args.judgeId, args.teamId),
    };
  },
});

type ActionRole = "judge" | "admin";
export type ActionUser = { _id: Id<"users">; role: ActionRole };

/**
 * Minimal action context used by the shared helpers. Structural (rather than
 * the full GenericActionCtx) so the helpers stay trivially testable, while the
 * permissive runQuery/runMutation signatures match how Convex types them.
 */
type ActionCtxLike = {
  auth: { getUserIdentity: () => Promise<{ subject: string } | null> };
  runQuery: (
    query: FunctionReference<"query", "public" | "internal">,
    args: Record<string, unknown>,
  ) => Promise<unknown>;
};

/**
 * Shared action-side authentication for judge/admin analysis surfaces: the
 * caller must be a judge or an admin. Returns a discriminated result so call
 * sites narrow cleanly.
 */
export async function actionUser(
  ctx: ActionCtxLike,
): Promise<{ ok: true; user: ActionUser } | { ok: false; error: string }> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return { ok: false, error: "You must be signed in to do that." };
  }
  // Convex Auth session tokens carry a composite subject ("userId|sessionId");
  // the users-table id is the segment before the separator.
  const userId = identity.subject.split("|")[0] as Id<"users">;
  const user = (await ctx.runQuery(internal.lib.actionAuth.sessionUser, {
    userId,
  })) as { _id: Id<"users">; role: "admin" | "judge" | "participant" } | null;
  if (!user) {
    return { ok: false, error: "You must be signed in to do that." };
  }
  if (user.role !== "judge" && user.role !== "admin") {
    return {
      ok: false,
      error: user.role
        ? `This analysis is available to judges and admins. You are signed in as ${user.role}.`
        : "Your account has not been granted a role for this hackathon yet.",
    };
  }
  return { ok: true, user: { _id: user._id, role: user.role } };
}

/** Assignment + conflict gate shared by every judge-facing analysis action. */
export async function judgeAccess(
  ctx: ActionCtxLike,
  user: ActionUser,
  teamId: Id<"teams">,
): Promise<string | null> {
  if (user.role !== ROLES.JUDGE) return null; // admins are unrestricted
  const access = (await ctx.runQuery(internal.lib.actionAuth.assignmentAccess, {
    judgeId: user._id,
    teamId,
  })) as { assigned: boolean; conflict: boolean };
  if (!access.assigned) {
    return "You are not assigned to this team.";
  }
  if (access.conflict) {
    return "You have been stood down from this submission due to a declared conflict of interest.";
  }
  return null;
}

export { isJudgeAssigned, hasConflict };
