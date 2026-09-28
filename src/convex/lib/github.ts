/**
 * GitHub repository analysis — evidence extraction and report building.
 *
 * Pure functions: no Convex imports, no I/O. Fetching lives in the action;
 * this module turns raw GitHub API responses into a structured, source-labeled
 * technical report.
 *
 * THE CARDINAL RULE OF THIS MODULE
 * --------------------------------
 * An analyzer that only sees a slice of a repository (a shallow file listing,
 * a truncated tree, a rate-limited response) can miss a feature that exists.
 * If it reported "no authentication found", judges would read a FALSE negative
 * as a finding. So detection here can only ever ASSERT what it saw, never
 * what it did not:
 *
 *   - Every detected indicator carries the file or payload that showed it.
 *   - Absence is phrased exactly one way: "Supporting evidence was not
 *     identified in the analyzed repository." (NO_EVIDENCE_DETECTED)
 *   - The report also states the scan's coverage limits, so a "not identified"
 *     can never be mistaken for "checked and absent".
 *
 * This report is advisory context for human judges. Like the AI copilot, it
 * has no notion of scores and never will: the table it is stored in is not
 * readable by, or writable from, any scoring code path.
 */

export const NO_EVIDENCE_DETECTED =
  "Supporting evidence was not identified in the analyzed repository.";

// ---------------------------------------------------------------------------
// Detected evidence
// ---------------------------------------------------------------------------

/** One piece of technical evidence, with the file that shows it. */
export type RepoEvidence = {
  /** What was detected, phrased as an observation (never a quality judgment). */
  label: string;
  /** The file path (or payload source) the detection came from. */
  source: string;
  /** A short verbatim snippet that triggered the detection, when available. */
  detail?: string;
};

/** One analysis dimension of the report. */
export type RepoSection = {
  key: string;
  title: string;
  /** What the analyzer looked at for this dimension. */
  evidence: RepoEvidence[];
  /**
   * Filled with NO_EVIDENCE_DETECTED (not by the model, not by a guess) when
   * nothing was identified. Kept separate from `evidence` so the UI can style
   * "saw nothing" differently from "saw this".
   */
  noEvidence: boolean;
};

export type RepoReport = {
  /** The dimension sections (languages/frameworks, database, auth, …). */
  sections: RepoSection[];
  /** Human/LLM-readable synthesis of the sections, for the judge's first read. */
  summary: string;
  /** Potential verification steps derived ONLY from detected evidence. */
  verification: string[];
};

// ---------------------------------------------------------------------------
// GitHub payload shapes (only the fields we read)
// ---------------------------------------------------------------------------

export type RepoMeta = {
  fullName: string;
  description: string | null;
  defaultBranch: string;
  stars: number;
  forks: number;
  openIssues: number;
  pushedAt: string | null;
  createdAt: string | null;
  language: string | null;
  license: string | null;
  homepage: string | null;
  archived: boolean;
};

export type RepoTreeEntry = { path: string; type: "blob" | "tree" };

export type RepoFileContent = {
  path: string;
  /** Decoded text content, or null when too large / binary / fetch failed. */
  text: string | null;
  truncated: boolean;
};

export type RepoContributor = { login: string; commits: number };

export type RepoScan = {
  meta: RepoMeta | null;
  tree: RepoTreeEntry[];
  languages: Record<string, number>;
  files: RepoFileContent[];
  contributors: RepoContributor[];
  /** Non-null when part of the scan failed (rate limit, 403, …). */
  scanWarning: string | null;
};

// ---------------------------------------------------------------------------
// Pattern tables — each entry pairs a regex with judge-neutral wording
// ---------------------------------------------------------------------------

type Pattern = { re: RegExp; label: string };

const DB_PATTERNS: Pattern[] = [
  { re: /mongodb/i, label: "MongoDB client usage detected" },
  { re: /postgres|pg(embed)?\b|pg-promise/i, label: "PostgreSQL client usage detected" },
  { re: /mysql/i, label: "MySQL client usage detected" },
  { re: /sqlite|better-sqlite3/i, label: "SQLite usage detected" },
  { re: /redis|ioredis/i, label: "Redis client usage detected" },
  { re: /prisma/i, label: "Prisma ORM detected" },
  { re: /drizzle-orm/i, label: "Drizzle ORM detected" },
  { re: /\btypeorm\b/i, label: "TypeORM detected" },
  { re: /mongoose/i, label: "Mongoose ODM detected" },
  { re: /sequelize/i, label: "Sequelize ORM detected" },
  { re: /knex/i, label: "Knex query builder detected" },
  { re: /\bdynamodb\b|aws-sdk\/clients\/dynamodb/i, label: "AWS DynamoDB usage detected" },
  { re: /\bconvex\b\/server|api\.convex|_generated\/server/i, label: "Convex backend usage detected" },
  { re: /firestore|firebase-admin/i, label: "Firebase/Firestore usage detected" },
  { re: /supabase/i, label: "Supabase client detected" },
  { re: /\bmemcached\b/i, label: "Memcached usage detected" },
  { re: /elastic(search)?|opensearch/i, label: "Elasticsearch/OpenSearch usage detected" },
];

const BACKEND_PATTERNS: Pattern[] = [
  { re: /express\b/, label: "Express server detected" },
  { re: /\bfastify\b/, label: "Fastify server detected" },
  { re: /\bkoa\b/, label: "Koa server detected" },
  { re: /\bnestjs\b|@nestjs\//, label: "NestJS framework detected" },
  { re: /\bdjango\b/, label: "Django framework detected" },
  { re: /\bflask\b/, label: "Flask framework detected" },
  { re: /\bfastapi\b/, label: "FastAPI framework detected" },
  { re: /spring-boot|org\.springframework/, label: "Spring Boot framework detected" },
  { re: /\brails\b/, label: "Ruby on Rails detected" },
  { re: /\bgin-gonic\b|\bgorilla\/mux\b/, label: "Go HTTP framework detected" },
  { re: /api\/routes?|app\.(get|post|put|delete|use)\s*\(/, label: "API route definitions detected" },
  { re: /websocket|socket\.io|ws:/i, label: "WebSocket usage detected" },
  { re: /graphql|apollo-server|@apollo\//i, label: "GraphQL layer detected" },
  { re: /\bgrpc\b|@grpc\//i, label: "gRPC usage detected" },
  { re: /serverless\.yml|vercel\.json|netlify\.toml|render\.yaml|fly\.toml/, label: "Serverless/platform config detected" },
];

const FRONTEND_PATTERNS: Pattern[] = [
  { re: /\breact\b|from ['"]react['"]/, label: "React usage detected" },
  { re: /next\b|from ['"]next['"]/, label: "Next.js detected" },
  { re: /vue\b|from ['"]vue['"]/, label: "Vue usage detected" },
  { re: /svelte\b/, label: "Svelte usage detected" },
  { re: /angular|@angular\//, label: "Angular detected" },
  { re: /\btailwind\b|tailwindcss/, label: "Tailwind CSS detected" },
  { re: /material-ui|@mui\//, label: "Material UI detected" },
  { re: /react-router|@tanstack\/router/, label: "Client-side routing detected" },
  { re: /redux|zustand|@tanstack\/query|apollo-client/, label: "State/data management library detected" },
  { re: /\bwebpack\b|\bvite\b|\brollup\b|\besbuild\b/, label: "Frontend bundler detected" },
  { re: /\bcypress\b|\bplaywright\b/, label: "Browser E2E test framework detected" },
];

const AI_ML_PATTERNS: Pattern[] = [
  { re: /\bopenai\b/, label: "OpenAI API integration detected" },
  { re: /\bgemini\b|generativelanguage/i, label: "Gemini API integration detected" },
  { re: /anthropic|claude/i, label: "Anthropic API integration detected" },
  { re: /langchain|llamaindex/i, label: "LLM framework detected" },
  { re: /\bhugging ?face\b|transformers\b/, label: "Hugging Face / transformers usage detected" },
  { re: /\bpytorch\b|torch\b/, label: "PyTorch usage detected" },
  { re: /tensorflow|keras/, label: "TensorFlow/Keras usage detected" },
  { re: /\bscikit-learn\b|sklearn/, label: "scikit-learn usage detected" },
  { re: /\bpandas\b|\bnumpy\b/, label: "Data science libraries detected" },
  { re: /onnx|mlflow|vertexai|@google\/genai|@google\/generative-ai/, label: "ML tooling detected" },
];

const AUTH_PATTERNS: Pattern[] = [
  { re: /passport|passportjs/i, label: "Passport authentication detected" },
  { re: /\bauth0\b|@auth0\//i, label: "Auth0 integration detected" },
  { re: /firebase\/auth|@firebase\/auth/i, label: "Firebase Auth detected" },
  { re: /next-auth|@auth\/core|@convex-dev\/auth/i, label: "Session auth framework detected" },
  { re: /jsonwebtoken|\bjwt\b/i, label: "JWT usage detected" },
  { re: /bcrypt|argon2/i, label: "Password hashing detected" },
  { re: /clerk|@clerk\//i, label: "Clerk auth detected" },
  { re: /oauth|openid/i, label: "OAuth/OIDC flow detected" },
  { re: /cognito/i, label: "AWS Cognito detected" },
  { re: /supabase\/auth|gotrue/i, label: "Supabase Auth detected" },
  { re: /middleware.*auth|requireAuth|isAuthenticated|getAuthUserId/i, label: "Auth middleware/ guards detected" },
];

const TESTING_PATTERNS: Pattern[] = [
  { re: /\bjest\b/, label: "Jest tests detected" },
  { re: /\bvitest\b/, label: "Vitest tests detected" },
  { re: /\bmocha\b/, label: "Mocha tests detected" },
  { re: /\bpytest\b/, label: "pytest tests detected" },
  { re: /\bgo test\b|testing package/i, label: "Go tests detected" },
  { re: /\bcypress\b/, label: "Cypress E2E tests detected" },
  { re: /\bplaywright\b/, label: "Playwright tests detected" },
  { re: /testing-library/, label: "Testing Library usage detected" },
  { re: /\bvitest\.config|\bjest\.config|pytest\.ini|\.github\/workflows\/[^"]*test/i, label: "Test configuration detected" },
];

const DEPLOY_PATTERNS: Pattern[] = [
  { re: /\bdockerfile\b|docker-compose/i, label: "Docker configuration detected" },
  { re: /k8s\/|kubernetes|helm/i, label: "Kubernetes manifests detected" },
  { re: /\.github\/workflows\//i, label: "GitHub Actions CI/CD workflows detected" },
  { re: /\bterraform\b/, label: "Terraform configuration detected" },
  { re: /\bvercel\.json\b/, label: "Vercel deployment config detected" },
  { re: /\bnetlify\.toml\b/, label: "Netlify deployment config detected" },
  { re: /nginx\.conf|caddyfile/i, label: "Reverse-proxy config detected" },
  { re: /heroku|render\.yaml|fly\.toml|railway\.json/i, label: "PaaS deployment config detected" },
];

const API_INTEGRATION_PATTERNS: Pattern[] = [
  { re: /stripe|@stripe\//i, label: "Stripe integration detected" },
  { re: /twilio/i, label: "Twilio integration detected" },
  { re: /sendgrid|resend\b|mailgun|postmark/i, label: "Email service integration detected" },
  { re: /aws-sdk|@aws-sdk\//i, label: "AWS SDK usage detected" },
  { re: /googleapis|google-auth-library/i, label: "Google API client detected" },
  { re: /sentry/i, label: "Sentry monitoring detected" },
  { re: /\baxios\b|\bnode-fetch\b|cross-fetch/i, label: "HTTP client library detected" },
  { re: /maps\.googleapis|@react-google-maps|mapbox|leaflet/i, label: "Maps integration detected" },
];

// Directory/file-name signals (matched against tree paths, no content needed).
const TREE_SIGNALS: Pattern[] = [
  { re: /(^|\/)api\/(v1\/)?(routes|endpoints)?\/?[\w-]*\.(ts|js|py|go)$/, label: "API route files detected" },
  { re: /(^|\/)(migrations|prisma\/migrations)\//, label: "Database migrations detected" },
  { re: /(^|\/)(models|entities|schemas)\/[\w-]+\.(ts|js|py|go)$/, label: "Data model definitions detected" },
  { re: /(^|\/)(controllers|handlers|routers)\//, label: "Request handler modules detected" },
  { re: /(^|\/)(components|pages|views|screens)\//, label: "UI component structure detected" },
  { re: /(^|\/)(services|lib|utils)\//, label: "Service/utility layer detected" },
  { re: /(^|\/)(middleware|guards)\//, label: "Middleware layer detected" },
  { re: /(^|\/)(tests?|__tests__|spec)\//, label: "Test directories detected" },
  { re: /(^|\/)(\.github\/workflows)\/.+\.ya?ml$/, label: "CI/CD workflow files detected" },
  { re: /(^|\/)docker-compose\.ya?ml$/, label: "Docker Compose detected" },
  { re: /(^|\/)Dockerfile$/, label: "Dockerfile detected" },
  { re: /(^|\/)(k8s|kubernetes|helm)\/.+\.ya?ml$/, label: "Kubernetes manifests detected" },
  { re: /(^|\/)(package\.json|requirements\.txt|pyproject\.toml|go\.mod|pom\.xml|build\.gradle|Cargo\.toml|composer\.json|Gemfile\.lock)$/, label: "Dependency manifest detected" },
  { re: /(^|\/)\.env\.example$/, label: "Environment variable template detected" },
  { re: /(^|\/)openapi\.(ya?ml|json)$|(^|\/)swagger\.(ya?ml|json)$/, label: "OpenAPI/Swagger spec detected" },
];

/** Frameworks: detected from declared dependencies rather than import scans. */
const FRAMEWORK_DEPENDENCIES: Pattern[] = [
  { re: /^react$/, label: "React" },
  { re: /^next$/, label: "Next.js" },
  { re: /^vue$/, label: "Vue" },
  { re: /^nuxt$/, label: "Nuxt" },
  { re: /^svelte$|^@sveltejs\/kit$/, label: "Svelte" },
  { re: /^@angular\/core$/, label: "Angular" },
  { re: /^express$/, label: "Express" },
  { re: /^fastify$/, label: "Fastify" },
  { re: /^@nestjs\/core$/, label: "NestJS" },
  { re: /^tailwindcss$/, label: "Tailwind CSS" },
  { re: /^prisma$|^@prisma\/client$/, label: "Prisma" },
  { re: /^drizzle-orm$/, label: "Drizzle" },
  { re: /^mongoose$/, label: "Mongoose" },
  { re: /^socket\.io$/, label: "Socket.IO" },
  { re: /^graphql$|^@apollo\/server$/, label: "GraphQL" },
  { re: /^bull$|^bullmq$|^agenda$/, label: "Background job queue" },
  { re: /^@google\/genai$|^@google\/generative-ai$|^openai$|^anthropic$/, label: "LLM SDK" },
  { re: /^stripe$|^@stripe\/stripe-js$/, label: "Stripe" },
  { re: /^passport$|^next-auth$|^@convex-dev\/auth$/, label: "Auth library" },
  { re: /^jest$|^vitest$|^mocha$|^cypress$|^playwright$|^@playwright\/test$/, label: "Test framework" },
  { re: /^pydantic$|^fastapi$/, label: "FastAPI/pydantic" },
  { re: /^flask$|^django$/, label: "Python web framework" },
];

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

const MAX_DETAIL = 90;

function collect(
  patterns: Pattern[],
  haystacks: { text: string; source: string }[],
  seen: Set<string>,
  max = 4,
): RepoEvidence[] {
  const out: RepoEvidence[] = [];
  for (const p of patterns) {
    if (out.length >= max) break;
    for (const h of haystacks) {
      const m = h.text.match(p.re);
      if (!m) continue;
      const key = `${p.label}::${h.source}`;
      if (seen.has(key) || seen.has(p.label)) break;
      seen.add(p.label);
      const idx = m.index ?? 0;
      out.push({
        label: p.label,
        source: h.source,
        detail: h.text.slice(Math.max(0, idx - 20), idx + MAX_DETAIL).replace(/\s+/g, " ").trim(),
      });
      break;
    }
  }
  return out;
}

function collectTree(patterns: Pattern[], tree: RepoTreeEntry[], seen: Set<string>, max = 4): RepoEvidence[] {
  const out: RepoEvidence[] = [];
  for (const p of patterns) {
    if (out.length >= max) break;
    const hit = tree.find((t) => p.re.test(t.path));
    if (!hit) continue;
    if (seen.has(p.label)) continue;
    seen.add(p.label);
    out.push({ label: p.label, source: hit.path });
  }
  return out;
}

function section(key: string, title: string, evidence: RepoEvidence[]): RepoSection {
  return { key, title, evidence, noEvidence: evidence.length === 0 };
}

// ---------------------------------------------------------------------------
// Dependency manifests
// ---------------------------------------------------------------------------

/** Extract declared dependency names from any JSON/YAML/TOML manifest text. */
export function extractDependencyNames(manifestPath: string, text: string): string[] {
  const names = new Set<string>();
  if (manifestPath.endsWith("package.json")) {
    try {
      const pkg = JSON.parse(text) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      for (const key of ["dependencies", "devDependencies", "peerDependencies"] as const) {
        for (const name of Object.keys(pkg[key] ?? {})) names.add(name);
      }
    } catch {
      // Malformed manifest: fall back to nothing rather than guessing.
    }
  } else if (manifestPath === "requirements.txt") {
    for (const line of text.split(/\r?\n/)) {
      const name = line.trim().split(/[=<>~\[; ]/)[0]?.trim();
      if (name && !name.startsWith("#") && !name.startsWith("-")) names.add(name.toLowerCase());
    }
  } else if (manifestPath === "pyproject.toml") {
    const depBlock = text.match(/dependencies\s*=\s*\[([^\]]*)\]/s);
    if (depBlock) {
      for (const m of depBlock[1].matchAll(/["']([^"']+)["']/g)) {
        names.add(m[1].split(/[=<>~\[; ]/)[0].toLowerCase());
      }
    }
  } else if (manifestPath === "go.mod") {
    for (const m of text.matchAll(/^\s+([\w./-]+)\s+v[\w.-]+/gm)) names.add(m[1]);
  } else if (manifestPath === "Cargo.toml") {
    for (const m of text.matchAll(/^\s*([\w-]+)\s*=\s*["']/gm)) names.add(m[1]);
  } else if (manifestPath === "Gemfile.lock") {
    for (const m of text.matchAll(/^\s{4}([\w-]+)\s+\(/gm)) names.add(m[1]);
  }
  return [...names].filter(Boolean).slice(0, 400);
}

// ---------------------------------------------------------------------------
// Report builder
// ---------------------------------------------------------------------------

const README_MAX_CHARS = 12_000;
const MAX_DEPENDENCIES_SHOWN = 10;

export function buildRepoReport(scan: RepoScan): RepoReport {
  const seen = new Set<string>();
  const sections: RepoSection[] = [];

  // --- Repository identity --------------------------------------------------
  const identity: RepoEvidence[] = [];
  if (scan.meta) {
    identity.push({
      label: `Repository ${scan.meta.fullName} (default branch: ${scan.meta.defaultBranch})`,
      source: "repository metadata",
    });
    if (scan.meta.language) {
      identity.push({
        label: `Primary repository language reported by GitHub: ${scan.meta.language}`,
        source: "repository metadata",
      });
    }
    if (scan.meta.license) {
      identity.push({ label: `License: ${scan.meta.license}`, source: "repository metadata" });
    }
    if (scan.meta.homepage) {
      identity.push({ label: `Linked homepage: ${scan.meta.homepage}`, source: "repository metadata" });
    }
    identity.push({
      label: `${scan.meta.stars} stars · ${scan.meta.forks} forks · ${scan.meta.openIssues} open issues`,
      source: "repository metadata",
    });
    if (scan.meta.pushedAt) {
      identity.push({
        label: `Last push to the default branch: ${new Date(scan.meta.pushedAt).toISOString().slice(0, 10)}`,
        source: "repository metadata",
      });
    }
  }
  sections.push(section("identity", "Repository", identity));

  // --- Languages -------------------------------------------------------------
  const langEvidence: RepoEvidence[] = Object.entries(scan.languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([lang, bytes]) => ({
      label: `${lang} — ${bytes.toLocaleString()} bytes per GitHub's language statistics`,
      source: "languages API",
    }));
  sections.push(section("languages", "Languages", langEvidence));

  // --- Frameworks & libraries (declared dependencies) ------------------------
  const frameworks = new Map<string, string>(); // label -> manifest source
  for (const file of scan.files) {
    if (!file.text) continue;
    const isManifest =
      file.path.endsWith("package.json") ||
      file.path === "requirements.txt" ||
      file.path === "pyproject.toml" ||
      file.path === "go.mod" ||
      file.path === "Cargo.toml" ||
      file.path === "Gemfile.lock";
    if (!isManifest) continue;

    const deps = extractDependencyNames(file.path, file.text);
    if (deps.length > 0 && !seen.has("Dependency manifest parsed")) {
      seen.add("Dependency manifest parsed");
    }
    for (const dep of deps) {
      for (const fw of FRAMEWORK_DEPENDENCIES) {
        if (fw.re.test(dep) && !frameworks.has(fw.label)) {
          frameworks.set(fw.label, file.path);
        }
      }
    }
  }
  sections.push(
    section(
      "frameworks",
      "Frameworks & libraries",
      [...frameworks.entries()].slice(0, 8).map(([label, source]) => ({
        label: `${label} declared in dependencies`,
        source,
      })),
    ),
  );

  // --- Directory structure ----------------------------------------------------
  const dirs = new Map<string, number>();
  for (const entry of scan.tree) {
    if (entry.type !== "tree") continue;
    const top = entry.path.split("/")[0];
    if (top) dirs.set(top, (dirs.get(top) ?? 0) + 1);
  }
  const structureEvidence: RepoEvidence[] = [
    ...[...dirs.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([dir, count]) => ({
        label: `${dir}/ (${count} entr${count === 1 ? "y" : "ies"} at this level)`,
        source: dir,
      })),
  ];
  if (scan.tree.length > 0) {
    structureEvidence.push({
      label: `${scan.tree.filter((t) => t.type === "blob").length} files indexed in the analyzed tree`,
      source: "git trees API",
    });
  }
  sections.push(section("structure", "Directory structure", structureEvidence));

  // --- README ------------------------------------------------------------------
  const readme = scan.files.find((f) => /(^|\/)readme(\.md|\.txt|\.rst)?$/i.test(f.path));
  const readmeEvidence: RepoEvidence[] = [];
  if (readme?.text) {
    const text = readme.text.slice(0, README_MAX_CHARS);
    readmeEvidence.push({
      label: `README present (${readme.text.length.toLocaleString()} characters)`,
      source: readme.path,
    });
    const heading = text.match(/^#\s+(.+)$/m);
    if (heading) {
      readmeEvidence.push({
        label: `Stated project name/description: “${heading[1].trim().slice(0, 120)}”`,
        source: readme.path,
      });
    }
    for (const [re, label] of [
      [/getting started|quick ?start|installation/i, "Getting-started/installation section detected"],
      [/```[\s\S]*?```/, "Code examples embedded in the README"],
      [/architecture|diagram|design/i, "Architecture/design discussion detected"],
      [/demo|screenshot|live/i, "Demo/screenshot references detected"],
    ] as [RegExp, string][]) {
      if (readmeEvidence.length >= 5) break;
      const m = text.match(re);
      if (m) {
        const idx = m.index ?? 0;
        readmeEvidence.push({
          label,
          source: readme.path,
          detail: text.slice(Math.max(0, idx - 20), idx + MAX_DETAIL).replace(/\s+/g, " ").trim(),
        });
      }
    }
  }
  sections.push(section("readme", "README", readmeEvidence));

  // --- Dependencies (the manifest itself is evidence) ---------------------------
  const depEvidence: RepoEvidence[] = [];
  for (const file of scan.files) {
    if (!file.text) continue;
    const isManifest =
      file.path.endsWith("package.json") ||
      file.path === "requirements.txt" ||
      file.path === "pyproject.toml" ||
      file.path === "go.mod" ||
      file.path === "Cargo.toml" ||
      file.path === "Gemfile.lock";
    if (!isManifest) continue;
    const deps = extractDependencyNames(file.path, file.text);
    if (deps.length > 0) {
      depEvidence.push({
        label: `${deps.length} declared dependencies in ${file.path}${file.truncated ? " (list truncated)" : ""}: ${deps
          .slice(0, MAX_DEPENDENCIES_SHOWN)
          .join(", ")}${deps.length > MAX_DEPENDENCIES_SHOWN ? ", …" : ""}`,
        source: file.path,
      });
    }
  }
  sections.push(section("dependencies", "Dependencies", depEvidence));

  // --- Capability dimensions ----------------------------------------------------
  const haystacks: { text: string; source: string }[] = scan.files
    .filter((f) => f.text)
    .map((f) => ({ text: f.text as string, source: f.path }));

  sections.push(
    section("frontend", "Frontend indicators", [
      ...collect(FRONTEND_PATTERNS, haystacks, seen),
      ...collectTree(
        [
          { re: /(^|\/)(components|pages|views|screens|app)\/$/, label: "UI directories present" },
          { re: /\.(tsx|jsx|vue|svelte)$/, label: "UI component files detected" },
        ],
        scan.tree,
        seen,
        2,
      ),
    ]),
  );

  sections.push(
    section("backend", "Backend indicators", [
      ...collect(BACKEND_PATTERNS, haystacks, seen),
      ...collectTree(
        [
          { re: /(^|\/)(server|api|backend|routes)\/|\bserver\.(ts|js|py)$/, label: "Server-side code files detected" },
        ],
        scan.tree,
        seen,
        2,
      ),
    ]),
  );

  sections.push(
    section("database", "Database indicators", [
      ...collect(DB_PATTERNS, haystacks, seen),
      ...collectTree(
        [
          { re: /(^|\/)(migrations|schema)\/|schema\.(prisma|sql)$/, label: "Database schema/migration files detected" },
        ],
        scan.tree,
        seen,
        2,
      ),
    ]),
  );

  sections.push(section("apis", "API integrations", collect(API_INTEGRATION_PATTERNS, haystacks, seen)));
  sections.push(section("ai", "AI/ML components", collect(AI_ML_PATTERNS, haystacks, seen)));
  sections.push(
    section("auth", "Authentication", [
      ...collect(AUTH_PATTERNS, haystacks, seen),
      ...collectTree(
        [{ re: /(^|\/)(auth|login|signup|session)/i, label: "Auth-related modules present" }],
        scan.tree,
        seen,
        2,
      ),
    ]),
  );

  // Testing: file presence is itself the primary evidence.
  const testFileEvidence = collectTree(
    [
      { re: /(^|\/)(tests?|__tests__|spec)\/|(\.test|\.spec)\.[tj]sx?$|(_test|_spec)\.(go|py)$/, label: "Test files present in the repository" },
    ],
    scan.tree,
    seen,
    1,
  );
  sections.push(
    section("testing", "Testing indicators", [...testFileEvidence, ...collect(TESTING_PATTERNS, haystacks, seen)]),
  );

  sections.push(
    section("deployment", "Deployment & configuration", [
      ...collect(DEPLOY_PATTERNS, haystacks, seen),
      ...collectTree(
        [
          { re: /(^|\/)(Dockerfile|docker-compose\.ya?ml|\.github\/workflows\/)/, label: "Deployment/CI configuration files detected" },
          { re: /(^|\/)\.env\.example$/, label: "Environment template detected" },
        ],
        scan.tree,
        seen,
        3,
      ),
    ]),
  );

  // --- Contributors ---------------------------------------------------------------
  sections.push(
    section(
      "contributors",
      "Contributors (public GitHub data)",
      scan.contributors.slice(0, 6).map((c) => ({
        label: `${c.login} — ${c.commits} commit${c.commits === 1 ? "" : "s"} to the default branch`,
        source: "contributors API",
      })),
    ),
  );

  // --- Potential verification (derived ONLY from detected evidence) ---------------
  const verification: string[] = [];
  const has = (key: string) => !sections.find((s) => s.key === key)?.noEvidence;
  if (has("apis")) verification.push("Verify the detected external integrations against what is demonstrated live (keys, sandbox vs production).");
  if (has("database")) verification.push("Ask the team to walk through the detected database layer during the demo (migrations, real queries).");
  if (has("auth")) verification.push("Exercise the detected authentication flow end-to-end in the demo, including a failure case.");
  if (has("testing")) verification.push("Run the detected test suite, or ask why it is not runnable in the demo environment.");
  if (has("deployment")) verification.push("Ask which of the detected deployment/CI configurations were actually used for the running demo.");
  if (has("ai")) verification.push("Ask the team to show the detected AI/ML path with real inputs and outputs, not a canned example.");
  if (has("contributors") && scan.contributors.length > 0) {
    verification.push("Compare commit history against the team's stated contribution split if individual credit matters for this event.");
  }
  if (verification.length === 0) {
    verification.push("With little detected surface area, the demo itself is the primary verification: ask for a live walkthrough of the main flow.");
  }

  return { sections, summary: buildDeterministicSummary(sections, scan), verification };
}

/**
 * Deterministic synthesis of the sections. States coverage limits explicitly
 * so an empty section is read as "the scan did not surface this", never as
 * "this does not exist".
 */
function buildDeterministicSummary(sections: RepoSection[], scan: RepoScan): string {
  const detected = sections.filter((s) => !s.noEvidence);
  const empty = sections.filter((s) => s.noEvidence);
  const filesScanned = scan.files.filter((f) => f.text).length;
  const name = scan.meta?.fullName ?? "the repository";

  const lines: string[] = [];
  lines.push(
    `The analyzer examined ${name}: ${scan.tree.length} tree entries indexed, ${filesScanned} text file${filesScanned === 1 ? "" : "s"} read (README, manifests, and configuration-first).`,
  );
  if (scan.scanWarning) {
    lines.push(`Scan coverage was limited: ${scan.scanWarning}`);
  }
  if (detected.length > 0) {
    lines.push(
      `Evidence was identified for: ${detected.map((s) => s.title.toLowerCase()).join(", ")}.`,
    );
  }
  if (empty.length > 0) {
    lines.push(
      `For ${empty.map((s) => s.title.toLowerCase()).join(", ")}, supporting evidence was not identified in the analyzed repository — this reflects what the scan could see, not a verified absence.`,
    );
  }
  return lines.join(" ");
}
