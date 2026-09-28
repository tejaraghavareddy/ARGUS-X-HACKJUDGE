import { v } from "convex/values";
import { action, internalMutation, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireRole } from "./lib/authorization";
import { getCurrentHackathon } from "./lib/resolve";
import { ROLES } from "./schema";
import { actionUser, judgeAccess, isJudgeAssigned, hasConflict } from "./lib/actionAuth";
import { AIProviderError, getAIProvider } from "./lib/aiProvider";
import {
  REPO_NARRATIVE_PROMPT,
  REPO_NARRATIVE_SCHEMA,
} from "./lib/copilot";
import {
  buildRepoReport,
  type RepoFileContent,
  type RepoMeta,
  type RepoScan,
  type RepoTreeEntry,
} from "./lib/github";

/**
 * GitHub repository analysis — server-side analyzer.
 *
 * Flow: Judge/admin UI → this action → public GitHub REST API (server-side
 * only; an optional GITHUB_TOKEN stays in the environment) → deterministic
 * evidence extraction with per-item sources → `repoAnalyses` table → judge UI.
 *
 * The analysis NEVER claims a feature is absent: thin evidence is stored with
 * the fixed wording "Supporting evidence was not identified in the analyzed
 * repository." and the scan's coverage limits are stored beside the findings,
 * so a judge can tell "the scan did not surface this" from "this does not
 * exist".
 *
 * Separation from judging is structural, as with the AI copilot: this module
 * has no reference to the `scores` table, and its rows live in `repoAnalyses`,
 * which no scoring code path reads or writes.
 */

const GH_API = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 12_000;
/** Root manifests worth reading, by exact path in the default-branch tree. */
const MANIFEST_PATHS = [
  "package.json",
  "requirements.txt",
  "pyproject.toml",
  "go.mod",
  "Cargo.toml",
  "Gemfile.lock",
];

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export const analysisForSubmission = query({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ROLES.JUDGE, ROLES.ADMIN);
    const hackathon = await getCurrentHackathon(ctx);
    if (!hackathon) return null;

    if (user.role === ROLES.JUDGE) {
      if (!(await isJudgeAssigned(ctx, user._id, args.teamId))) {
        throw new Error("You are not assigned to this team.");
      }
      if (await hasConflict(ctx, user._id, args.teamId)) {
        throw new Error(
          "You have been stood down from this submission due to a declared conflict of interest.",
        );
      }
    }

    const row = await ctx.db
      .query("repoAnalyses")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .first();

    if (!row) return { state: "missing" as const, analysis: null };

    return {
      state: row.status,
      error: row.error ?? null,
      repoFullName: row.repoFullName ?? null,
      repoUrl: row.repoUrl ?? null,
      requestedUrl: row.requestedUrl ?? null,
      scanCoverage: row.scanCoverage,
      sections: row.sections,
      summary: row.summary,
      verification: row.verification,
      narrative: row.narrative ?? null,
      narrativeProvider: row.narrativeProvider ?? null,
      narrativeModel: row.narrativeModel ?? null,
      readmeExcerpt: row.readmeExcerpt ?? null,
      fetchedAt: row.fetchedAt,
    };
  },
});

// ---------------------------------------------------------------------------
// Internals: what the action needs from the database
// ---------------------------------------------------------------------------

/** The submission's GitHub URL and id, resolved for the analyzer. */
export const submissionRepoSource = internalQuery({
  args: { teamId: v.id("teams") },
  handler: async (ctx, args) => {
    const submission = await ctx.db
      .query("submissions")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .unique();
    if (!submission) return null;
    return {
      submissionId: submission._id as Id<"submissions">,
      githubUrl: submission.githubUrl ?? null,
    };
  },
});

/**
 * Persist a repo analysis. Any previous analysis for the same team is
 * replaced, so a re-run never leaves two contradictory reports in place.
 *
 * Note what this mutation does NOT do: it never touches `scores`.
 */
export const saveRepoAnalysis = internalMutation({
  args: {
    hackathonId: v.id("hackathons"),
    submissionId: v.id("submissions"),
    teamId: v.id("teams"),
    repoFullName: v.string(),
    repoUrl: v.string(),
    requestedUrl: v.string(),
    scanCoverage: v.object({
      treeEntries: v.number(),
      filesRead: v.number(),
      truncated: v.boolean(),
      warning: v.optional(v.string()),
    }),
    sections: v.any(),
    summary: v.string(),
    verification: v.array(v.string()),
    narrative: v.optional(v.string()),
    narrativeProvider: v.optional(v.string()),
    narrativeModel: v.optional(v.string()),
    readmeExcerpt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    for (const existing of await ctx.db
      .query("repoAnalyses")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect()) {
      await ctx.db.delete(existing._id);
    }
    return await ctx.db.insert("repoAnalyses", {
      hackathonId: args.hackathonId,
      submissionId: args.submissionId,
      teamId: args.teamId,
      status: "ready" as const,
      repoFullName: args.repoFullName,
      repoUrl: args.repoUrl,
      requestedUrl: args.requestedUrl,
      visibility: "public" as const,
      scanCoverage: args.scanCoverage,
      sections: args.sections,
      summary: args.summary,
      verification: args.verification,
      narrative: args.narrative,
      narrativeProvider: args.narrativeProvider,
      narrativeModel: args.narrativeModel,
      // The README is participant-written documentation, so it is stored so
      // the copilot can quote it as submission evidence without re-fetching
      // GitHub (and without burning the unauthenticated rate limit).
      readmeExcerpt: args.readmeExcerpt,
      fetchedAt: Date.now(),
    });
  },
});

/** Record a failure so the judge sees why, with a retry, instead of a blank. */
export const saveFailedRepoAnalysis = internalMutation({
  args: {
    hackathonId: v.id("hackathons"),
    submissionId: v.id("submissions"),
    teamId: v.id("teams"),
    requestedUrl: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    for (const existing of await ctx.db
      .query("repoAnalyses")
      .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
      .collect()) {
      await ctx.db.delete(existing._id);
    }
    return await ctx.db.insert("repoAnalyses", {
      hackathonId: args.hackathonId,
      submissionId: args.submissionId,
      teamId: args.teamId,
      status: "failed" as const,
      requestedUrl: args.requestedUrl,
      visibility: "public" as const,
      scanCoverage: { treeEntries: 0, filesRead: 0, truncated: false },
      sections: [],
      summary: "",
      verification: [],
      error: args.error.slice(0, 1000),
      fetchedAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// GitHub access (server-side only)
// ---------------------------------------------------------------------------

/**
 * Decode GitHub's base64 file payloads. Convex actions run in a V8 isolate
 * without Node's Buffer, so the standard atob path is used (with strict
 * base64 re-padding, since GitHub strips padding).
 */
function decodeBase64(content: string): string {
  const normalized = content.replace(/\n/g, "");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  // atob yields a binary string; convert to UTF-8 via percent-encoding.
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    // GitHub requires a User-Agent; identify the app honestly.
    "User-Agent": "RaptureJudge-repo-analyzer",
  };
  // Optional: raises rate limits. Never required, never exposed to clients.
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function ghFetch(path: string): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
  let response: Response;
  try {
    response = await fetch(`${GH_API}${path}`, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      ok: false,
      error: `Could not reach GitHub: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (response.ok) {
    try {
      return { ok: true, json: await response.json() };
    } catch {
      return { ok: false, error: "GitHub returned a malformed response." };
    }
  }

  const body = await response.text().catch(() => "");
  if (response.status === 403 && /rate limit/i.test(body)) {
    return {
      ok: false,
      error:
        "GitHub's API rate limit was reached. Try again in a few minutes (a GITHUB_TOKEN raises the limit).",
    };
  }
  if (response.status === 404) {
    return { ok: false, error: "Repository not found (or not publicly accessible)." };
  }
  if (response.status === 401) {
    return { ok: false, error: "GitHub rejected the configured GITHUB_TOKEN." };
  }
  return { ok: false, error: `GitHub request failed (${response.status}): ${body.slice(0, 200)}` };
}

/** Parse an https://github.com/{owner}/{repo} style URL into coordinates. */
export function parseGitHubUrl(raw: string): { owner: string; repo: string } | { error: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { error: "That GitHub URL could not be parsed." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { error: "That GitHub URL could not be parsed." };
  }
  const host = url.hostname.replace(/^www\./, "");
  if (host !== "github.com" && host !== "gist.github.com") {
    return { error: "Only github.com repositories can be analyzed." };
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) {
    return { error: "That GitHub URL does not include a repository (expected github.com/owner/repo)." };
  }
  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/, "");
  if (!owner || !repo) {
    return { error: "That GitHub URL does not include a repository (expected github.com/owner/repo)." };
  }
  return { owner, repo };
}

// ---------------------------------------------------------------------------
// Analyze action
// ---------------------------------------------------------------------------

export const analyze = action({
  args: { teamId: v.id("teams") },
  handler: async (
    ctx,
    args,
  ): Promise<
    | { ok: true; repoFullName: string; sections: number; narrativeUsed: boolean }
    | { ok: false; error: string }
  > => {
    const auth = await actionUser(ctx);
    if (!auth.ok) return { ok: false, error: auth.error };
    const user = auth.user;

    const hackathon = await ctx.runQuery(
      internal.lib.actionAuth.currentHackathonMeta,
      {},
    );
    if (!hackathon) {
      return { ok: false, error: "No hackathon is currently active." };
    }

    const accessError = await judgeAccess(ctx, user, args.teamId);
    if (accessError) return { ok: false, error: accessError };

    const source = await ctx.runQuery(internal.repoAnalysis.submissionRepoSource, {
      teamId: args.teamId,
    });
    if (!source) {
      return { ok: false, error: "This team has no submission to analyze." };
    }

    const requestedUrl = source.githubUrl?.trim() ?? "";
    if (!requestedUrl) {
      return {
        ok: false,
        error: "This submission has no GitHub URL to analyze.",
      };
    }

    const parsed = parseGitHubUrl(requestedUrl);
    if ("error" in parsed) {
      await ctx.runMutation(internal.repoAnalysis.saveFailedRepoAnalysis, {
        hackathonId: hackathon._id,
        submissionId: source.submissionId,
        teamId: args.teamId,
        requestedUrl,
        error: parsed.error,
      });
      return { ok: false, error: parsed.error };
    }
    const { owner, repo } = parsed;
    const repoFullName = `${owner}/${repo}`;

    const fail = async (message: string) => {
      await ctx.runMutation(internal.repoAnalysis.saveFailedRepoAnalysis, {
        hackathonId: hackathon._id,
        submissionId: source.submissionId,
        teamId: args.teamId,
        requestedUrl,
        error: message,
      });
      return { ok: false as const, error: message };
    };

    // --- Fetch: repository metadata, languages, tree, contributors ---------
    const metaRes = await ghFetch(`/repos/${owner}/${repo}`);
    if (!metaRes.ok) return fail(metaRes.error);
    const rawMeta = metaRes.json as Record<string, unknown>;
    const license = rawMeta.license as { spdx_id?: string; name?: string } | null;
    const meta: RepoMeta = {
      fullName: String(rawMeta.full_name ?? repoFullName),
      description: (rawMeta.description as string | null) ?? null,
      defaultBranch: String(rawMeta.default_branch ?? "main"),
      stars: Number(rawMeta.stargazers_count ?? 0),
      forks: Number(rawMeta.forks_count ?? 0),
      openIssues: Number(rawMeta.open_issues_count ?? 0),
      pushedAt: (rawMeta.pushed_at as string | null) ?? null,
      createdAt: (rawMeta.created_at as string | null) ?? null,
      language: (rawMeta.language as string | null) ?? null,
      license: license?.spdx_id && license.spdx_id !== "NOASSERTION" ? license.spdx_id : (license?.name ?? null),
      homepage: (rawMeta.homepage as string | null) ?? null,
      archived: Boolean(rawMeta.archived),
    };

    const langRes = await ghFetch(`/repos/${owner}/${repo}/languages`);
    const languages = langRes.ok
      ? ((langRes.json as Record<string, number>) ?? {})
      : {};

    const treeRes = await ghFetch(
      `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(meta.defaultBranch)}?recursive=1`,
    );
    let tree: RepoTreeEntry[] = [];
    let treeTruncated = false;
    let scanWarning: string | null = null;
    if (treeRes.ok) {
      const rawTree = treeRes.json as {
        tree?: { path: string; type: string }[];
        truncated?: boolean;
      };
      tree = (rawTree.tree ?? [])
        .filter((t) => t.type === "blob" || t.type === "tree")
        .map((t) => ({ path: t.path, type: t.type as "blob" | "tree" }));
      treeTruncated = Boolean(rawTree.truncated);
      if (treeTruncated) {
        scanWarning =
          "the repository tree was truncated by GitHub, so file-level detection covered only part of the repository";
      }
    } else {
      scanWarning = "the file tree could not be retrieved, so directory-structure detection is incomplete";
    }

    const contribRes = await ghFetch(
      `/repos/${owner}/${repo}/contributors?per_page=6`,
    );
    const contributors = contribRes.ok
      ? ((contribRes.json as { login?: string; contributions?: number }[]) ?? [])
          .filter((c) => typeof c.login === "string")
          .map((c) => ({ login: c.login as string, commits: Number(c.contributions ?? 0) }))
      : [];

    // --- Fetch: README and root manifests ----------------------------------
    // Bounded so a pathological README cannot dominate the stored row.
    const README_EXCERPT_CHARS = 20_000;
    const files: RepoFileContent[] = [];
    let readmeExcerpt: string | undefined;
    const readmeRes = await ghFetch(`/repos/${owner}/${repo}/readme`);
    if (readmeRes.ok) {
      const raw = readmeRes.json as { path?: string; content?: string; encoding?: string };
      const text =
        raw.encoding === "base64" && raw.content
          ? decodeBase64(raw.content)
          : (raw.content ?? null);
      files.push({ path: raw.path ?? "README.md", text, truncated: false });
      if (text) readmeExcerpt = text.slice(0, README_EXCERPT_CHARS);
    }

    // Root manifests to read: prefer paths confirmed by the tree, but if the
    // tree could not be retrieved, still attempt the standard root locations
    // best-effort so dependency detection degrades instead of vanishing.
    const wanted = new Set(
      tree
        .filter((t) => t.type === "blob" && MANIFEST_PATHS.includes(t.path))
        .map((t) => t.path),
    );
    if (tree.length === 0) {
      for (const path of MANIFEST_PATHS) wanted.add(path);
    }
    for (const path of wanted) {
      const fileRes = await ghFetch(
        `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(meta.defaultBranch)}`,
      );
      if (!fileRes.ok) {
        // A single unreadable manifest is a coverage note, not a failure.
        scanWarning =
          (scanWarning ? `${scanWarning}; ` : "") +
          `${path} could not be read, so dependency detection may be incomplete`;
        continue;
      }
      const raw = fileRes.json as { content?: string; encoding?: string; size?: number };
      const text =
        raw.encoding === "base64" && raw.content
          ? decodeBase64(raw.content)
          : null;
      files.push({ path, text, truncated: raw.size === undefined || raw.size > 1_000_000 });
    }

    // --- Deterministic evidence extraction ---------------------------------
    const scan: RepoScan = {
      meta,
      tree,
      languages,
      files,
      contributors,
      scanWarning,
    };
    const report = buildRepoReport(scan);

    // --- Optional neutral narrative (same AIProvider abstraction) ----------
    let narrative: string | undefined;
    let narrativeProvider: string | undefined;
    let narrativeModel: string | undefined;
    try {
      const provider = getAIProvider();
      const evidenceLines = report.sections
        .filter((s) => !s.noEvidence)
        .flatMap((s) =>
          s.evidence.map((e) => `- [${s.title}] ${e.label} (source: ${e.source})`),
        )
        .slice(0, 80)
        .join("\n");
      if (evidenceLines.trim()) {
        const result = await provider.generateStructured({
          system: REPO_NARRATIVE_PROMPT,
          prompt: `DETECTED EVIDENCE (each item includes its source file):\n${evidenceLines}`,
          schema: REPO_NARRATIVE_SCHEMA as unknown as Record<string, unknown>,
          schemaName: "repo_narrative",
          schemaDescription: "A short neutral technical reading of detected repository evidence.",
        });
        const raw = (result.parsed ?? {}) as Record<string, unknown>;
        const text = (raw.narrative ?? "").toString().trim();
        if (text) {
          narrative = text.slice(0, 2000);
          narrativeProvider = result.provider;
          narrativeModel = result.model;
        }
      }
    } catch (error) {
      // The narrative is optional: deterministic evidence stands on its own.
      if (!(error instanceof AIProviderError) || !/No AI key/.test(error.message)) {
        scanWarning =
          (scanWarning ? `${scanWarning}; ` : "") +
          "the optional AI narrative could not be generated (deterministic evidence is unaffected)";
      }
    }

    await ctx.runMutation(internal.repoAnalysis.saveRepoAnalysis, {
      hackathonId: hackathon._id,
      submissionId: source.submissionId,
      teamId: args.teamId,
      repoFullName: meta.fullName,
      repoUrl: `https://github.com/${meta.fullName}`,
      requestedUrl,
      scanCoverage: {
        treeEntries: tree.length,
        filesRead: files.filter((f) => f.text).length,
        truncated: treeTruncated,
        warning: scanWarning ?? undefined,
      },
      sections: report.sections,
      summary: report.summary,
      verification: report.verification,
      narrative,
      narrativeProvider,
      narrativeModel,
      readmeExcerpt,
    });

    return {
      ok: true,
      repoFullName: meta.fullName,
      sections: report.sections.length,
      narrativeUsed: Boolean(narrative),
    };
  },
});
