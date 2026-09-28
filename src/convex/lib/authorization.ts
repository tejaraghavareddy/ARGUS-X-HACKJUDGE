import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Role } from "../schema";

/**
 * The signed-in user's app profile.
 *
 * `role` is optional on the users table (Convex Auth owns that table), so a
 * brand-new or anonymous account has no role. Such a user is treated as having
 * no access at all rather than defaulting to something permissive.
 */
export type SessionUser = Doc<"users">;

export async function getSessionUser(
  ctx: QueryCtx | MutationCtx,
): Promise<SessionUser | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  return await ctx.db.get(userId);
}

export function isRole(user: SessionUser | null, ...roles: Role[]): boolean {
  if (!user?.role) return false;
  return roles.includes(user.role);
}

/**
 * Require a signed-in user with one of the given roles, or throw.
 *
 * Every restricted function calls this. Client-side route guards are a
 * convenience for the user; this is the boundary that actually holds.
 */
export async function requireRole(
  ctx: QueryCtx | MutationCtx,
  ...roles: Role[]
): Promise<SessionUser> {
  const user = await getSessionUser(ctx);
  if (!user) {
    throw new Error("You must be signed in to do that.");
  }
  if (!user.role) {
    throw new Error(
      "Your account has not been granted a role for this hackathon yet.",
    );
  }
  if (!roles.includes(user.role)) {
    throw new Error(
      `This action requires one of these roles: ${roles.join(", ")}. You are signed in as ${user.role}.`,
    );
  }
  return user;
}
