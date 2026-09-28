import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireRole } from "./lib/authorization";
import { getCurrentHackathon } from "./lib/resolve";
import { logAudit } from "./lib/audit";
import { hashSecret } from "./lib/password";
import { ASSIGNMENT_STATUS, ROLES, SUBMISSION_STATUS } from "./schema";
import type { Id } from "./_generated/dataModel";

/**
 * Judge management, assignment and conflicts of interest.
 *
 * Two invariants this module owns:
 *  1. A judge can be assigned to many teams, and a team can have many judges.
 *     `assignments` is the join, so both directions are just index lookups.
 *  2. Declaring a conflict actively removes the pairing: any assignment for
 *     that judge/team is deleted, the team leaves the judge's queue, and both
 *     the read and the write path reject it. A conflict is therefore a removal,
 *     not a flag that something else has to remember to honour.
 */

/** Judges plus their workload, assignments and conflicts, in one payload. */
export const listForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ROLES.ADMIN);
    const hackathon = await getCurrentHackathon(ctx);
    if (!hackathon) return { judges: [], teams: [], conflicts: [] };

    const [judges, teams, assignments, conflicts, scores] = await Promise.all([
      ctx.db
        .query("users")
        .withIndex("by_role", (q) => q.eq("role", ROLES.JUDGE))
        .collect(),
      ctx.db
        .query("teams")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathon._id))
        .collect(),
      ctx.db
        .query("assignments")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathon._id))
        .collect(),
      ctx.db
        .query("judgeConflicts")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathon._id))
        .collect(),
      ctx.db
        .query("scores")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathon._id))
        .collect(),
    ]);

    const teamById = new Map(teams.map((t) => [t._id, t]));
    const conflicted = new Set(
      conflicts.map((c) => `${c.judgeId}:${c.teamId}`),
    );

    const rows = judges
      .map((judge) => {
        const own = assignments.filter((a) => a.judgeId === judge._id);
        const finalScores = scores.filter(
          (s) => s.judgeId === judge._id && s.isFinal,
        );
        return {
          id: judge._id,
          name: judge.name ?? "Unnamed judge",
          email: judge.email ?? "",
          title: judge.title ?? "",
          organization: judge.organization ?? "",
          capacity: judge.judgingCapacity ?? 0,
          isActive: judge.isActive !== false,
          assigned: own.length,
          completed: own.filter((a) => a.status === ASSIGNMENT_STATUS.SUBMITTED)
            .length,
          inProgress: own.filter(
            (a) => a.status === ASSIGNMENT_STATUS.IN_PROGRESS,
          ).length,
          notStarted: own.filter(
            (a) => a.status === ASSIGNMENT_STATUS.NOT_STARTED,
          ).length,
          conflicts: own.filter((a) =>
            conflicted.has(`${judge._id}:${a.teamId}`),
          ).length,
          finalizedScores: finalScores.length,
          teamIds: own.map((a) => a.teamId as string),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      judges: rows,
      teams: teams
        .map((team) => {
          const own = assignments.filter((a) => a.teamId === team._id);
          return {
            id: team._id,
            name: team.name,
            projectName: team.projectName,
            assigned: own.filter(
              (a) => !conflicted.has(`${a.judgeId}:${a.teamId}`),
            ).length,
            completed: own.filter(
              (a) =>
                a.status === ASSIGNMENT_STATUS.SUBMITTED &&
                !conflicted.has(`${a.judgeId}:${a.teamId}`),
            ).length,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
      conflicts: conflicts.map((conflict) => ({
        id: conflict._id,
        judgeId: conflict.judgeId,
        teamId: conflict.teamId,
        judgeName: judges.find((j) => j._id === conflict.judgeId)?.name ?? "Unknown",
        teamName: teamById.get(conflict.teamId)?.name ?? "Unknown team",
        reason: conflict.reason ?? null,
        createdAt: conflict.createdAt,
      })),
    };
  },
});

/** Add a judge. Creates the account so they can sign in immediately. */
export const createJudge = mutation({
  args: {
    name: v.string(),
    email: v.string(),
    password: v.string(),
    title: v.optional(v.string()),
    organization: v.optional(v.string()),
    capacity: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ROLES.ADMIN);
    const hackathon = await getCurrentHackathon(ctx);
    if (!hackathon) throw new Error("No hackathon is currently active.");

    const name = args.name.trim();
    const email = args.email.trim().toLowerCase();
    if (!name) throw new Error("A judge needs a name.");
    if (!email.includes("@")) throw new Error("Enter a valid email address.");
    if (args.password.length < 8) {
      throw new Error("The password must be at least 8 characters.");
    }

    const existing = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .unique();
    if (existing) {
      throw new Error("An account already exists for that email address.");
    }

    const judgeId = await ctx.db.insert("users", {
      name,
      email,
      emailVerificationTime: Date.now(),
      role: ROLES.JUDGE,
      title: args.title?.trim() || undefined,
      organization: args.organization?.trim() || undefined,
      judgingCapacity: args.capacity ?? 3,
      isActive: true,
    });

    // Password hashing is async, so the account is written with the same
    // implementation the sign-in path verifies against.
    await ctx.db.insert("authAccounts", {
      userId: judgeId,
      provider: "password",
      providerAccountId: email,
      secret: await hashSecret(args.password),
    });

    await logAudit(ctx, {
      hackathonId: hackathon._id,
      actor: admin,
      action: "judge.created",
      targetType: "judge",
      targetId: judgeId,
      targetLabel: name,
      metadata: { email },
    });

    return { id: judgeId };
  },
});

export const updateJudge = mutation({
  args: {
    judgeId: v.id("users"),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    title: v.optional(v.string()),
    organization: v.optional(v.string()),
    capacity: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ROLES.ADMIN);
    const hackathon = await getCurrentHackathon(ctx);
    if (!hackathon) throw new Error("No hackathon is currently active.");

    const judge = await ctx.db.get(args.judgeId);
    if (!judge) throw new Error("Judge not found.");

    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) {
      if (!args.name.trim()) throw new Error("A judge needs a name.");
      patch.name = args.name.trim();
    }
    if (args.email !== undefined) {
      const email = args.email.trim().toLowerCase();
      if (!email.includes("@")) throw new Error("Enter a valid email address.");
      const clash = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", email))
        .unique();
      if (clash && clash._id !== args.judgeId) {
        throw new Error("Another account already uses that email address.");
      }
      patch.email = email;
      // Keep the sign-in account in step with the address.
      const account = await ctx.db
        .query("authAccounts")
        .withIndex("userIdAndProvider", (q) =>
          q.eq("userId", args.judgeId).eq("provider", "password"),
        )
        .unique();
      if (account) {
        await ctx.db.patch(account._id, { providerAccountId: email });
      }
    }
    if (args.title !== undefined) patch.title = args.title.trim();
    if (args.organization !== undefined) {
      patch.organization = args.organization.trim();
    }
    if (args.capacity !== undefined) patch.judgingCapacity = args.capacity;

    if (Object.keys(patch).length === 0) return { updated: 0 };

    await ctx.db.patch(args.judgeId, patch);

    await logAudit(ctx, {
      hackathonId: hackathon._id,
      actor: admin,
      action: "judge.updated",
      targetType: "judge",
      targetId: args.judgeId,
      targetLabel: (patch.name as string) ?? judge.name ?? "Judge",
      metadata: { fields: Object.keys(patch).join(", ") },
    });

    return { updated: Object.keys(patch).length };
  },
});

/**
 * Activate or deactivate a judge.
 *
 * Deactivating blocks new scorecard submissions and removes them from the
 * assignment picker, but never deletes their history — prior scorecards stay
 * exactly as filed, because altering a submitted record is never acceptable.
 */
export const setJudgeActive = mutation({
  args: { judgeId: v.id("users"), isActive: v.boolean() },
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ROLES.ADMIN);
    const hackathon = await getCurrentHackathon(ctx);
    if (!hackathon) throw new Error("No hackathon is currently active.");

    const judge = await ctx.db.get(args.judgeId);
    if (!judge) throw new Error("Judge not found.");

    await ctx.db.patch(args.judgeId, { isActive: args.isActive });

    await logAudit(ctx, {
      hackathonId: hackathon._id,
      actor: admin,
      action: args.isActive ? "judge.activated" : "judge.deactivated",
      targetType: "judge",
      targetId: args.judgeId,
      targetLabel: judge.name ?? "Judge",
    });

    return { ok: true };
  },
});

/** Assign a judge to a team. Idempotent — re-assigning is a no-op. */
export const assign = mutation({
  args: { judgeId: v.id("users"), teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ROLES.ADMIN);
    const hackathon = await getCurrentHackathon(ctx);
    if (!hackathon) throw new Error("No hackathon is currently active.");

    const [judge, team] = await Promise.all([
      ctx.db.get(args.judgeId),
      ctx.db.get(args.teamId),
    ]);
    if (!judge) throw new Error("Judge not found.");
    if (!team) throw new Error("Team not found.");
    if (judge.role !== ROLES.JUDGE) throw new Error("That user is not a judge.");
    if (judge.isActive === false) {
      throw new Error("Reactivate the judge before assigning them a team.");
    }

    // A conflict is an absolute bar: it must not be undone by reassigning.
    const conflict = await ctx.db
      .query("judgeConflicts")
      .withIndex("by_judge_team", (q) =>
        q.eq("judgeId", args.judgeId).eq("teamId", args.teamId),
      )
      .unique();
    if (conflict) {
      throw new Error(
        "This judge has a declared conflict with that team. Remove the conflict first.",
      );
    }

    const existing = await ctx.db
      .query("assignments")
      .withIndex("by_judge_team", (q) =>
        q.eq("judgeId", args.judgeId).eq("teamId", args.teamId),
      )
      .unique();
    if (existing) return { ok: true, alreadyAssigned: true };

    await ctx.db.insert("assignments", {
      hackathonId: hackathon._id,
      judgeId: args.judgeId,
      teamId: args.teamId,
      status: ASSIGNMENT_STATUS.NOT_STARTED,
      assignedAt: Date.now(),
      dueAt: hackathon.judgingEndsAt,
    });

    await logAudit(ctx, {
      hackathonId: hackathon._id,
      actor: admin,
      action: "assignment.created",
      targetType: "team",
      targetId: args.teamId,
      targetLabel: team.name,
      metadata: { judge: judge.name ?? "Judge" },
    });

    return { ok: true, alreadyAssigned: false };
  },
});

/** Remove a judge from a team. A filed scorecard is never deleted. */
export const unassign = mutation({
  args: { judgeId: v.id("users"), teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ROLES.ADMIN);
    const hackathon = await getCurrentHackathon(ctx);
    if (!hackathon) throw new Error("No hackathon is currently active.");

    const assignment = await ctx.db
      .query("assignments")
      .withIndex("by_judge_team", (q) =>
        q.eq("judgeId", args.judgeId).eq("teamId", args.teamId),
      )
      .unique();
    if (!assignment) return { ok: true };

    const score = await ctx.db
      .query("scores")
      .withIndex("by_assignment", (q) => q.eq("assignmentId", assignment._id))
      .unique();

    if (score?.isFinal) {
      throw new Error(
        "This judge has already submitted a scorecard for that team. Remove the conflict or leave the assignment in place.",
      );
    }

    await ctx.db.delete(assignment._id);
    if (score) await ctx.db.delete(score._id);

    const judge = await ctx.db.get(args.judgeId);
    const team = await ctx.db.get(args.teamId);
    await logAudit(ctx, {
      hackathonId: hackathon._id,
      actor: admin,
      action: "assignment.removed",
      targetType: "team",
      targetId: args.teamId,
      targetLabel: team?.name ?? "Team",
      metadata: { judge: judge?.name ?? "Judge" },
    });

    return { ok: true };
  },
});

/**
 * Declare a conflict of interest.
 *
 * This also deletes any existing assignment for the pair, which is what makes
 * the judge's queue and write path reject the team without needing to check a
 * flag separately.
 */
export const declareConflict = mutation({
  args: {
    judgeId: v.id("users"),
    teamId: v.id("teams"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ROLES.ADMIN);
    const hackathon = await getCurrentHackathon(ctx);
    if (!hackathon) throw new Error("No hackathon is currently active.");

    const [judge, team] = await Promise.all([
      ctx.db.get(args.judgeId),
      ctx.db.get(args.teamId),
    ]);
    if (!judge) throw new Error("Judge not found.");
    if (!team) throw new Error("Team not found.");

    const existing = await ctx.db
      .query("judgeConflicts")
      .withIndex("by_judge_team", (q) =>
        q.eq("judgeId", args.judgeId).eq("teamId", args.teamId),
      )
      .unique();
    if (existing) {
      return { ok: true, alreadyDeclared: true, conflictId: existing._id };
    }

    const conflictId = await ctx.db.insert("judgeConflicts", {
      hackathonId: hackathon._id,
      judgeId: args.judgeId,
      teamId: args.teamId,
      reason: args.reason?.trim() || undefined,
      createdBy: admin._id,
      createdAt: Date.now(),
    });

    // Stand the judge down: drop the assignment and any unfinalized draft.
    const assignment = await ctx.db
      .query("assignments")
      .withIndex("by_judge_team", (q) =>
        q.eq("judgeId", args.judgeId).eq("teamId", args.teamId),
      )
      .unique();
    if (assignment) {
      const score = await ctx.db
        .query("scores")
        .withIndex("by_assignment", (q) => q.eq("assignmentId", assignment._id))
        .unique();
      if (score?.isFinal) {
        throw new Error(
          "This judge has already submitted a scorecard for that team, so a conflict cannot be declared retroactively.",
        );
      }
      if (score) await ctx.db.delete(score._id);
      await ctx.db.delete(assignment._id);
    }

    // Make sure the team is not stuck looking unreviewed.
    const remaining = await ctx.db
      .query("assignments")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect();
    if (remaining.length === 0) {
      const submission = await ctx.db
        .query("submissions")
        .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
        .unique();
      if (submission?.status === SUBMISSION_STATUS.UNDER_REVIEW) {
        await ctx.db.patch(submission._id, {
          status: SUBMISSION_STATUS.SUBMITTED,
        });
      }
    }

    await logAudit(ctx, {
      hackathonId: hackathon._id,
      actor: admin,
      action: "conflict.declared",
      targetType: "team",
      targetId: args.teamId,
      targetLabel: team.name,
      metadata: {
        judge: judge.name ?? "Judge",
        reason: args.reason?.trim() || "not stated",
      },
    });

    return { ok: true, alreadyDeclared: false, conflictId };
  },
});

export const resolveConflict = mutation({
  args: { conflictId: v.id("judgeConflicts") },
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ROLES.ADMIN);
    const hackathon = await getCurrentHackathon(ctx);
    if (!hackathon) throw new Error("No hackathon is currently active.");

    const conflict = await ctx.db.get(args.conflictId);
    if (!conflict) throw new Error("Conflict not found.");

    const judge = await ctx.db.get(conflict.judgeId);
    const team = await ctx.db.get(conflict.teamId);

    await ctx.db.delete(args.conflictId);

    await logAudit(ctx, {
      hackathonId: hackathon._id,
      actor: admin,
      action: "conflict.resolved",
      targetType: "team",
      targetId: conflict.teamId,
      targetLabel: team?.name ?? "Team",
      metadata: { judge: judge?.name ?? "Judge" },
    });

    return { ok: true };
  },
});

export type JudgeId = Id<"users">;
