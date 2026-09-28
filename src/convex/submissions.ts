import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { getSessionUser, requireRole } from "./lib/authorization";
import { logAudit } from "./lib/audit";
import {
  FILE_KINDS,
  SUBMISSION_FIELDS,
  URL_FIELDS,
  checkFile,
  checkUrl,
  completionPercent,
  formatSubmissionRef,
  validateForSubmit,
  type FileKind,
  type SubmissionValues,
} from "./lib/participant";
import { ROLES, SUBMISSION_STATUS } from "./schema";
import { getCurrentHackathon } from "./lib/resolve";

// ---------------------------------------------------------------------------
// Access control
//
// Every function resolves the caller's team from the authenticated identity.
// There is deliberately no `teamId` argument on any participant-facing
// function, so a participant cannot reach another team's submission by
// guessing an id. The admin function is the only one that takes an id, and it
// requires the admin role.
// ---------------------------------------------------------------------------

/** The team the signed-in participant belongs to, or null if they have none. */
async function teamForUser(
  ctx: any,
  user: Doc<"users">,
): Promise<Id<"teams"> | null> {
  const membership = await ctx.db
    .query("teamMembers")
    .withIndex("by_user", (q: any) => q.eq("userId", user._id))
    .unique();
  return membership ? membership.teamId : null;
}

/** Loads the caller's own team + submission, or throws. Used by every write. */
async function requireOwnSubmission(ctx: any) {
  const user = await requireRole(ctx, ROLES.PARTICIPANT);
  const teamId = await teamForUser(ctx, user);
  if (!teamId) {
    throw new Error("You are not part of a team yet. Create one first.");
  }
  const team = await ctx.db.get(teamId);
  if (!team) throw new Error("Your team no longer exists.");
  const submission = await ctx.db
    .query("submissions")
    .withIndex("by_team", (q: any) => q.eq("teamId", teamId))
    .unique();
  return { user, team, submission };
}

/**
 * A finalized submission is read-only. This is the single gate every
 * participant write goes through, so an admin reopen is the only way back in.
 */
function assertEditable(submission: Doc<"submissions"> | null) {
  if (submission && submission.status !== SUBMISSION_STATUS.DRAFT) {
    throw new Error(
      "This submission is locked. It can only be changed if an administrator reopens it.",
    );
  }
}

/** Project identity and links, stitched with the narrative into one document. */
function formValues(
  team: Doc<"teams">,
  submission: Doc<"submissions"> | null,
): SubmissionValues {
  return {
    projectName: team.projectName,
    techStack: (team.techStack ?? []).join(", "),
    problemStatement: submission?.problemStatement ?? "",
    solutionDescription: submission?.solutionDescription ?? "",
    targetUsers: submission?.targetUsers ?? "",
    keyFeatures: (submission?.keyFeatures ?? []).join("\n"),
    innovation: submission?.innovation ?? "",
    expectedImpact: submission?.expectedImpact ?? "",
    implementationDetails: submission?.implementationDetails ?? "",
    futureScope: submission?.futureScope ?? "",
    repoUrl: submission?.githubUrl ?? "",
    demoUrl: submission?.liveDemoUrl ?? "",
    videoUrl: submission?.demoVideoUrl ?? "",
  };
}

const storageUrl = (ctx: any, storageId: string) =>
  ctx.storage.getUrl(storageId as unknown as Id<"_storage">);

async function filesForSubmission(ctx: any, submissionId: Id<"submissions">) {
  const rows = await ctx.db
    .query("submissionFiles")
    .withIndex("by_submission", (q: any) => q.eq("submissionId", submissionId))
    .collect();
  return Promise.all(
    rows.map(async (row: Doc<"submissionFiles">) => ({
      id: row._id,
      kind: row.kind as FileKind,
      name: row.fileName,
      size: row.size,
      contentType: row.contentType,
      uploadedAt: row.uploadedAt,
      url: await storageUrl(ctx, row.storageId),
    })),
  );
}

/**
 * The single server-side gate on accepting new work.
 *
 * It checks both the admin's `submissionsOpen` switch and the deadline, so the
 * client never has to be trusted about either — and so what the participant is
 * told ("the organizers have paused new submissions") matches what actually
 * happens.
 */
function assertSubmissionsOpen(hackathon: Doc<"hackathons"> | null) {
  if (!hackathon) return;
  if (!hackathon.submissionsOpen) {
    throw new Error(
      "The organizers have paused new submissions. Contact them if you need an extension.",
    );
  }
  if (Date.now() > hackathon.submissionsCloseAt) {
    throw new Error("The submission deadline has passed.");
  }
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export const mySubmission = query({
  args: {},
  handler: async (ctx) => {
    // Deliberately one return with a single shape. Returning early per case
    // would give callers a ragged union and push null-guards into every page;
    // here the client checks `signedIn` and `team` and gets the same keys.
    const user = await getSessionUser(ctx);
    const hackathon = user ? await getCurrentHackathon(ctx) : null;
    const teamId = user ? await teamForUser(ctx, user) : null;
    const team = teamId ? await ctx.db.get(teamId) : null;

    const [membership, members, submission] = team && user
      ? await Promise.all([
          ctx.db
            .query("teamMembers")
            .withIndex("by_user", (q: any) => q.eq("userId", user._id))
            .unique(),
          ctx.db
            .query("teamMembers")
            .withIndex("by_team", (q: any) => q.eq("teamId", team._id))
            .collect(),
          ctx.db
            .query("submissions")
            .withIndex("by_team", (q: any) => q.eq("teamId", team._id))
            .unique(),
        ])
      : [null, [], null];

    const files = submission ? await filesForSubmission(ctx, submission._id) : [];
    const uploadedKinds = [
      ...new Set(files.map((f) => f.kind)),
    ] as FileKind[];

    // Progress only — never a score. The numbers a participant can see are how
    // many judges are assigned and how many have finished, nothing more.
    const [assignments, scores] = team
      ? await Promise.all([
          ctx.db
            .query("assignments")
            .withIndex("by_team", (q: any) => q.eq("teamId", team._id))
            .collect(),
          ctx.db
            .query("scores")
            .withIndex("by_team", (q: any) => q.eq("teamId", team._id))
            .collect(),
        ])
      : [[], []];

    const values: SubmissionValues = team
      ? formValues(team, submission)
      : ({} as SubmissionValues);
    const blocking = team
      ? validateForSubmit(values, uploadedKinds)
      : ({} as Record<string, string>);

    return {
      signedIn: Boolean(user),
      hackathon: hackathon
        ? {
            id: hackathon._id,
            name: hackathon.name,
            logo: hackathon.logo ?? null,
            tagline: hackathon.tagline,
            problemStatement: hackathon.problemStatement ?? "",
            submissionsCloseAt: hackathon.submissionsCloseAt,
            submissionsOpen: hackathon.submissionsOpen,
            maxTeamSize: hackathon.maxTeamSize,
          }
        : null,
      team: team
        ? {
            id: team._id,
            name: team.name,
            tagline: team.tagline,
            description: team.description,
            projectName: team.projectName,
            techStack: team.techStack,
            createdAt: team.createdAt,
            // Only the lead may restructure the team; anyone on it may submit.
            isLead: membership?.isLead ?? false,
            members: members.map((m) => ({
              id: m._id,
              userId: m.userId ?? null,
              name: m.name,
              email: m.email,
              role: m.role,
              isLead: m.isLead,
              isYou: m.userId === (user?._id ?? null),
            })),
          }
        : null,
      submission: submission
        ? {
            id: submission._id,
            status: submission.status,
            submissionRef: submission.submissionRef ?? null,
            submittedAt: submission.submittedAt ?? null,
            lockedAt: submission.lockedAt ?? null,
            reopenedAt: submission.reopenedAt ?? null,
            reopenNote: submission.reopenNote ?? null,
            updatedAt: submission.updatedAt ?? null,
            // Shown to participants transparently: the same advisory text the
            // judge sees. It has no effect on scoring.
            aiReview: submission.aiReview ?? null,
          }
        : null,
      values,
      files,
      reviewProgress: {
        assignedJudges: assignments.length,
        completed: assignments.filter(
          (a: Doc<"assignments">) => a.status === "submitted",
        ).length,
        finalScorecards: scores.filter((s: Doc<"scores">) => s.isFinal).length,
      },
      completion: team ? completionPercent({ values, uploadedKinds }) : 0,
      blockingErrors: blocking,
      isComplete: team && Object.keys(blocking).length === 0,
      editable:
        team !== null &&
        (!submission || submission.status === SUBMISSION_STATUS.DRAFT),
    };
  },
});

// ---------------------------------------------------------------------------
// Draft
// ---------------------------------------------------------------------------

export const saveDraft = mutation({
  args: {
    projectName: v.optional(v.string()),
    techStack: v.optional(v.string()),
    problemStatement: v.optional(v.string()),
    solutionDescription: v.optional(v.string()),
    targetUsers: v.optional(v.string()),
    keyFeatures: v.optional(v.string()),
    innovation: v.optional(v.string()),
    expectedImpact: v.optional(v.string()),
    implementationDetails: v.optional(v.string()),
    futureScope: v.optional(v.string()),
    repoUrl: v.optional(v.string()),
    demoUrl: v.optional(v.string()),
    videoUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { team, submission } = await requireOwnSubmission(ctx);
    assertEditable(submission);

    const hackathon = await getCurrentHackathon(ctx);
    assertSubmissionsOpen(hackathon);

    // Drafts are deliberately permissive — only length and URL syntax are
    // checked, so a team can save partial work at any point. Completeness is
    // enforced at final submit, not here.
    for (const spec of SUBMISSION_FIELDS) {
      const raw = (args[spec.key] ?? "").trim();
      if (raw.length > spec.maxLength) {
        throw new Error(`${spec.label} must be under ${spec.maxLength} characters.`);
      }
    }
    for (const url of URL_FIELDS) {
      const raw = (args[url.key] ?? "").trim();
      if (!raw) continue;
      const result = checkUrl(raw, url.hosts);
      if (!result.ok) throw new Error(`${url.label}: ${result.error}`);
    }

    const stack = (args.techStack ?? "")
      .split(/[,\n]/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 20);
    const features = (args.keyFeatures ?? "")
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-*\d.\s]+/, "").trim())
      .filter(Boolean)
      .slice(0, 20);

    // Project identity and stack live on the team row, which is what the judge
    // queue and team registry read; everything else lives on the submission.
    await ctx.db.patch(team._id, {
      projectName: (args.projectName ?? "").trim(),
      techStack: stack,
    });

    const solution = (args.solutionDescription ?? "").trim();
    // Optional fields are cleared with `undefined`, not `null`: Convex models
    // `v.optional()` as "absent or T", and an explicit null is not a valid
    // value for it.
    const patch = {
      problemStatement: args.problemStatement || undefined,
      solutionDescription: solution || undefined,
      targetUsers: args.targetUsers || undefined,
      keyFeatures: features,
      innovation: args.innovation || undefined,
      expectedImpact: args.expectedImpact || undefined,
      technologyStack: stack,
      implementationDetails: args.implementationDetails || undefined,
      futureScope: args.futureScope || undefined,
      githubUrl: (args.repoUrl ?? "").trim() || undefined,
      liveDemoUrl: (args.demoUrl ?? "").trim() || undefined,
      demoVideoUrl: (args.videoUrl ?? "").trim() || undefined,
      // `abstract` and `highlights` are what the original single-field judge
      // views render, so they stay derived from the structured answers rather
      // than being maintained separately.
      abstract: solution ? solution.slice(0, 600) : undefined,
      highlights: features.slice(0, 5),
      updatedAt: Date.now(),
    };

    if (submission) {
      await ctx.db.patch(submission._id, patch);
      return submission._id;
    }

    return await ctx.db.insert("submissions", {
      hackathonId: team.hackathonId,
      teamId: team._id,
      status: SUBMISSION_STATUS.DRAFT,
      ...patch,
    });
  },
});

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export const requestUploadUrl = mutation({
  args: { kind: v.string() },
  handler: async (ctx, args) => {
    const { submission } = await requireOwnSubmission(ctx);
    assertEditable(submission);
    if (!FILE_KINDS.some((f) => f.key === args.kind)) {
      throw new Error("Unknown file category.");
    }
    assertSubmissionsOpen(await getCurrentHackathon(ctx));
    return { uploadUrl: await ctx.storage.generateUploadUrl() };
  },
});

export const recordFile = mutation({
  args: {
    storageId: v.string(),
    kind: v.string(),
    name: v.string(),
    size: v.number(),
    contentType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user, team, submission } = await requireOwnSubmission(ctx);
    assertEditable(submission);
    if (!submission) {
      throw new Error("Save your submission details before uploading files.");
    }
    assertSubmissionsOpen(await getCurrentHackathon(ctx));

    const kind = args.kind as FileKind;
    const spec = FILE_KINDS.find((f) => f.key === kind);
    if (!spec) throw new Error("Unknown file category.");

    // Re-validated server-side: the browser's accept attribute and the client
    // checks are a convenience, never the enforcement point.
    const result = checkFile(kind, args.name, args.size);
    if (!result.ok) throw new Error(result.error);

    const existing = await ctx.db
      .query("submissionFiles")
      .withIndex("by_submission", (q: any) => q.eq("submissionId", submission._id))
      .collect();

    // Single-file categories replace their predecessor; supporting files stack.
    if (!spec.multiple) {
      for (const row of existing.filter((r) => r.kind === kind)) {
        await ctx.storage.delete(row.storageId as unknown as Id<"_storage">);
        await ctx.db.delete(row._id);
      }
    } else {
      if (existing.filter((r) => r.kind === kind).length >= 5) {
        throw new Error("You can attach at most 5 supporting files.");
      }
    }

    return await ctx.db.insert("submissionFiles", {
      hackathonId: team.hackathonId,
      teamId: team._id,
      submissionId: submission._id,
      kind,
      fileName: args.name.slice(0, 120),
      contentType: args.contentType || "application/octet-stream",
      size: args.size,
      storageId: args.storageId,
      uploadedBy: user._id,
      uploadedAt: Date.now(),
    });
  },
});

export const deleteFile = mutation({
  args: { fileId: v.id("submissionFiles") },
  handler: async (ctx, args) => {
    const { submission } = await requireOwnSubmission(ctx);
    assertEditable(submission);

    const file = await ctx.db.get(args.fileId);
    // Ownership re-checked: a valid id belonging to another team fails here.
    if (!file || !submission || file.submissionId !== submission._id) {
      throw new Error("File not found on your submission.");
    }
    await ctx.storage.delete(file.storageId as unknown as Id<"_storage">);
    await ctx.db.delete(file._id);
    return true;
  },
});

// ---------------------------------------------------------------------------
// Final submit
// ---------------------------------------------------------------------------

export const finalSubmit = mutation({
  args: {},
  handler: async (ctx) => {
    const { team, submission } = await requireOwnSubmission(ctx);
    if (!submission) throw new Error("You have nothing to submit yet.");
    if (submission.status !== SUBMISSION_STATUS.DRAFT) {
      throw new Error("This submission was already submitted and is now locked.");
    }
    assertSubmissionsOpen(await getCurrentHackathon(ctx));

    const rows = await ctx.db
      .query("submissionFiles")
      .withIndex("by_submission", (q: any) => q.eq("submissionId", submission._id))
      .collect();
    const uploadedKinds = [
      ...new Set(rows.map((r) => r.kind as FileKind)),
    ] as FileKind[];

    const values = formValues(team, submission);
    const errors = validateForSubmit(values, uploadedKinds);
    if (Object.keys(errors).length > 0) {
      throw new Error(`Cannot submit yet: ${Object.values(errors)[0]}`);
    }

    // The ID is issued once, at submit, and never changes. It is what the team
    // quotes in correspondence and what the admin reopens against.
    const count = await ctx.db
      .query("submissions")
      .withIndex("by_hackathon", (q: any) => q.eq("hackathonId", team.hackathonId))
      .collect();
    const hackathon = await getCurrentHackathon(ctx);
    const ref = formatSubmissionRef(hackathon?.slug ?? "rapture-2026", count.length);
    const now = Date.now();

    await ctx.db.patch(submission._id, {
      status: SUBMISSION_STATUS.SUBMITTED,
      submissionRef: ref,
      submittedAt: now,
      lockedAt: now,
      updatedAt: now,
    });

    return { id: submission._id, submissionRef: ref, submittedAt: now };
  },
});

// ---------------------------------------------------------------------------
// Admin reopen
// ---------------------------------------------------------------------------

export const adminReopen = mutation({
  args: {
    submissionId: v.id("submissions"),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ROLES.ADMIN);
    const submission = await ctx.db.get(args.submissionId);
    if (!submission) throw new Error("Submission not found.");
    if (submission.status === SUBMISSION_STATUS.DRAFT) {
      throw new Error("That submission is not locked.");
    }

    await ctx.db.patch(args.submissionId, {
      status: SUBMISSION_STATUS.DRAFT,
      reopenedAt: Date.now(),
      reopenedBy: admin._id,
      reopenNote: args.note?.trim() || "Reopened by an administrator",
      lockedAt: undefined,
      updatedAt: Date.now(),
    });

    await logAudit(ctx, {
      hackathonId: submission.hackathonId,
      actor: admin,
      action: "submission.reopen",
      targetType: "submission",
      targetId: submission._id,
      targetLabel: submission.submissionRef ?? undefined,
      metadata: args.note?.trim() ? { note: args.note.trim() } : undefined,
    });

    return true;
  },
});
