import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Append-only audit trail for administrative actions.
 *
 * Every admin mutation that changes configuration, people or assignments calls
 * this. Failures are swallowed on purpose: an audit write must never roll back
 * the action the admin actually asked for, and it is written in the same
 * transaction so a committed change always has its record.
 */
export async function logAudit(
  ctx: MutationCtx,
  entry: {
    hackathonId: Id<"hackathons">;
    actor: Doc<"users">;
    action: string;
    targetType: string;
    targetId?: string;
    targetLabel?: string;
    metadata?: Record<string, string>;
  },
) {
  try {
    await ctx.db.insert("auditLog", {
      hackathonId: entry.hackathonId,
      actorId: entry.actor._id,
      actorName: entry.actor.name ?? entry.actor.email ?? "Unknown admin",
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      targetLabel: entry.targetLabel,
      metadata: entry.metadata,
      createdAt: Date.now(),
    });
  } catch (error) {
    console.error("[audit] failed to record entry", entry.action, error);
  }
}
