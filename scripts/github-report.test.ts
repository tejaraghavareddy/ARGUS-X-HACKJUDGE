import { describe, expect, test } from "bun:test";
import {
  buildRepoReport,
  extractDependencyNames,
  NO_EVIDENCE_DETECTED,
  type RepoScan,
} from "../src/convex/lib/github";

/**
 * Network-free tests for the deterministic GitHub report builder.
 *
 * The live happy path is covered by scripts/verify-repo.sh against a real
 * repository; these tests pin the pure extraction logic so it cannot regress
 * when GitHub is unreachable or rate-limited.
 */

const SCAN: RepoScan = {
  meta: {
    fullName: "demo/demo-app",
    description: "A demo app",
    defaultBranch: "main",
    stars: 3,
    forks: 1,
    openIssues: 2,
    pushedAt: "2026-09-01T00:00:00Z",
    createdAt: "2026-08-01T00:00:00Z",
    language: "TypeScript",
    license: "MIT",
    homepage: null,
    archived: false,
  },
  tree: [
    { path: "src", type: "tree" },
    { path: "src/app.tsx", type: "blob" },
    { path: "src/server/routes/api.ts", type: "blob" },
    { path: "src/db/schema.prisma", type: "blob" },
    { path: "tests/login.test.ts", type: "blob" },
    { path: "Dockerfile", type: "blob" },
    { path: ".github/workflows/ci.yml", type: "blob" },
    { path: "package.json", type: "blob" },
  ],
  languages: { TypeScript: 54321, CSS: 1234 },
  files: [
    {
      path: "package.json",
      truncated: false,
      text: JSON.stringify({
        dependencies: {
          react: "^19.0.0",
          express: "^5.0.0",
          prisma: "^6.0.0",
          "@prisma/client": "^6.0.0",
          "socket.io": "^4.0.0",
          openai: "^5.0.0",
        },
        devDependencies: { vitest: "^3.0.0", tailwindcss: "^4.0.0" },
      }),
    },
    {
      path: "README.md",
      truncated: false,
      text: "# Demo App\n\n## Getting started\n\nInstall and run.\n\n```bash\nnpm i\n```\n",
    },
  ],
  contributors: [{ login: "octocat", commits: 12 }],
  scanWarning: null,
};

describe("extractDependencyNames", () => {
  test("reads package.json dependencies and devDependencies", () => {
    const deps = extractDependencyNames(
      "package.json",
      SCAN.files[0].text as string,
    );
    expect(deps).toContain("react");
    expect(deps).toContain("express");
    expect(deps).toContain("vitest");
    expect(deps).toContain("@prisma/client");
  });

  test("returns nothing for malformed JSON instead of guessing", () => {
    expect(extractDependencyNames("package.json", "{not json")).toEqual([]);
  });

  test("parses requirements.txt lines", () => {
    const deps = extractDependencyNames(
      "requirements.txt",
      "# comment\nfastapi==1.2.3\nuvicorn[standard]>=0.30\n",
    );
    expect(deps).toContain("fastapi");
    expect(deps).toContain("uvicorn");
  });
});

describe("buildRepoReport", () => {
  const report = buildRepoReport(SCAN);
  const byKey = (key: string) =>
    report.sections.find((s) => s.key === key)!;

  test("populates languages from the languages API payload", () => {
    const s = byKey("languages");
    expect(s.noEvidence).toBe(false);
    expect(s.evidence.some((e) => e.label.includes("TypeScript"))).toBe(true);
    expect(s.evidence.every((e) => e.source.length > 0)).toBe(true);
  });

  test("detects declared frameworks with their manifest as source", () => {
    const s = byKey("frameworks");
    expect(s.noEvidence).toBe(false);
    expect(s.evidence.some((e) => e.label.startsWith("React"))).toBe(true);
    expect(s.evidence.some((e) => e.label.startsWith("Express"))).toBe(true);
    expect(s.evidence.every((e) => e.source === "package.json")).toBe(true);
  });

  test("lists declared dependencies with counts and sources", () => {
    const s = byKey("dependencies");
    expect(s.noEvidence).toBe(false);
    expect(s.evidence[0].source).toBe("package.json");
    expect(s.evidence[0].label).toContain("8 declared dependencies");
  });

  test("detects database, auth-adjacent structure, testing and deployment signals", () => {
    expect(byKey("database").noEvidence).toBe(false); // schema.prisma in tree
    expect(byKey("testing").noEvidence).toBe(false); // tests/login.test.ts
    expect(byKey("deployment").noEvidence).toBe(false); // Dockerfile + workflow
    expect(byKey("ai").noEvidence).toBe(false); // openai dependency
  });

  test("empty dimensions use the fixed never-claim-absence wording", () => {
    const scanMissing: RepoScan = { ...SCAN, files: [SCAN.files[1]] };
    const r = buildRepoReport(scanMissing);
    const deps = r.sections.find((s) => s.key === "dependencies")!;
    expect(deps.noEvidence).toBe(true);
    expect(deps.evidence).toHaveLength(0);
  });

  test("NO_EVIDENCE_DETECTED is the product's fixed absence sentence", () => {
    expect(NO_EVIDENCE_DETECTED).toBe(
      "Supporting evidence was not identified in the analyzed repository.",
    );
  });

  test("verification steps are derived only from detected evidence", () => {
    // SCAN detects testing, deployment, ai, database — those prompts appear.
    expect(
      report.verification.some((v) => v.toLowerCase().includes("test")),
    ).toBe(true);
    // Nothing detected for maps/devices, so no verification step mentions them.
    expect(report.verification.some((v) => v.toLowerCase().includes("maps"))).toBe(
      false,
    );
  });

  test("summary states coverage limits for empty dimensions instead of absence", () => {
    const scanNarrow: RepoScan = { ...SCAN, files: [], languages: {} };
    const r = buildRepoReport(scanNarrow);
    expect(r.summary).toContain("not identified in the analyzed repository");
    expect(r.summary).toContain("not a verified absence");
  });

  test("scan warning is surfaced into the summary", () => {
    const r = buildRepoReport({ ...SCAN, scanWarning: "the tree was truncated" });
    expect(r.summary).toContain("the tree was truncated");
  });
});
