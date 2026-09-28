import { describe, expect, test } from "bun:test";
import {
  NO_EVIDENCE,
  buildCorpus,
  buildSourceText,
  groundClaims,
  groundQuotes,
  isGroundedInCorpus,
  resolveSource,
  sanitizeCriteria,
  type SourceDocument,
} from "../src/convex/lib/copilot";

/**
 * Network-free tests for the evidence-grounding layer of the Judge Copilot.
 *
 * These pin the behaviour the product depends on and that a judge can see:
 *   - a claim survives only if its quote is verbatim in a corpus document;
 *   - every surviving claim says WHICH document (and which PDF page);
 *   - nothing is attributed to a document that was not in the corpus;
 *   - a short/vague span is not accepted as evidence.
 *
 * They do not test the model. They test the trust boundary applied after it.
 */

// --- Fixtures ---------------------------------------------------------------

const FORM = [
  "Project name: Nebula Care",
  "",
  "Problem statement:",
  "Rural clinics cannot keep track of follow-up visits on paper.",
  "",
  "Solution description:",
  "Nebula Care is an offline-first patient follow-up app for rural clinics.",
  "",
  "Technology stack:",
  "React Native, PostgreSQL, Node.js",
].join("\n");

const README = [
  "# Nebula Care",
  "",
  "Nebula Care is built with React Native and Expo.",
  "Data is stored in PostgreSQL via Prisma.",
  "",
  "## Testing",
  "We run unit tests with Vitest and Playwright end-to-end tests.",
].join("\n");

/** Two pages of an uploaded deck, with explicit character ranges. */
const PDF_PAGE_1 = "Nebula Care pitch deck. Page 1: the problem in rural clinics.";
const PDF_PAGE_2 = "Page 2: we use PostgreSQL for patient records.";
const PDF_TEXT = `${PDF_PAGE_1}\n${PDF_PAGE_2}`;
const DECK: SourceDocument = {
  sourceId: "pdf:pitch.pdf",
  source: "Uploaded document (PDF) — pitch.pdf",
  text: PDF_TEXT,
  pages: [
    { start: 0, end: PDF_PAGE_1.length, page: 1 },
    { start: PDF_PAGE_1.length + 1, end: PDF_TEXT.length, page: 2 },
  ],
};

const ANALYSIS = "GitHub repository analysis: 15 sections detected from vercel/next.js.";

function corpus() {
  // Order matters and mirrors the action: form first, so a quote that appears
  // in two documents is attributed to the submission itself.
  return buildCorpus([
    { sourceId: "form", source: "Project documentation", text: FORM },
    { sourceId: "github-readme", source: "README (GitHub)", text: README },
    { sourceId: "github-analysis", source: "GitHub repository analysis", text: ANALYSIS },
    DECK,
  ]);
}

// --- Attribution ------------------------------------------------------------

describe("source attribution", () => {
  test("a quote from the submission form is attributed to the form", () => {
    const source = resolveSource(
      "Nebula Care is an offline-first patient follow-up app for rural clinics.",
      corpus(),
    );
    expect(source?.sourceId).toBe("form");
    expect(source?.source).toBe("Project documentation");
    expect(source?.page).toBeUndefined();
  });

  test("a quote that exists only in the README is attributed to the README", () => {
    const source = resolveSource(
      "We run unit tests with Vitest and Playwright end-to-end tests.",
      corpus(),
    );
    expect(source?.sourceId).toBe("github-readme");
    expect(source?.source).toBe("README (GitHub)");
  });

  test("a quote from an uploaded PDF carries its page number", () => {
    const c = corpus();
    expect(resolveSource("Page 2: we use PostgreSQL for patient records.", c)?.page).toBe(2);
    expect(
      resolveSource("Nebula Care pitch deck. Page 1: the problem in rural clinics.", c)?.page,
    ).toBe(1);
  });

  test("page attribution survives punctuation and whitespace differences", () => {
    // The model re-wraps and re-punctuates; it must still land on page 2.
    const source = resolveSource("page 2 we use postgresql for patient records", corpus());
    expect(source?.sourceId).toBe("pdf:pitch.pdf");
    expect(source?.page).toBe(2);
  });

  test("a non-paginated document never gets a page number", () => {
    const source = resolveSource("Data is stored in PostgreSQL via Prisma.", corpus());
    expect(source?.page).toBeUndefined();
  });

  test("a quote from no document resolves to no source at all", () => {
    expect(resolveSource("This sentence is nowhere in the corpus.", corpus())).toBeUndefined();
  });

  test("the form wins a tie, because documents are ordered form-first", () => {
    const c = buildCorpus([
      { sourceId: "form", source: "Project documentation", text: "shared phrase here" },
      { sourceId: "pdf:x.pdf", source: "Deck", text: "shared phrase here" },
    ]);
    expect(resolveSource("shared phrase here", c)?.sourceId).toBe("form");
  });
});

// --- Grounding --------------------------------------------------------------

describe("claim grounding", () => {
  test("a claim with a verbatim quote is kept, with its source attached", () => {
    const { verified, dropped } = groundClaims(
      [
        {
          claim: "The project stores patient records in PostgreSQL.",
          sourceQuote: "Data is stored in PostgreSQL via Prisma.",
        },
      ],
      corpus(),
    );
    expect(dropped).toBe(0);
    expect(verified).toHaveLength(1);
    expect(verified[0].claim).toContain("PostgreSQL");
    expect(verified[0].source?.sourceId).toBe("github-readme");
  });

  test("an invented claim is dropped and counted", () => {
    const { verified, dropped } = groundClaims(
      [
        {
          claim: "The project is used by 400 hospitals in production.",
          sourceQuote: "More than 400 hospitals use Nebula Care today.",
        },
      ],
      corpus(),
    );
    expect(verified).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  test("a claim quoting a document that is NOT in the corpus is dropped", () => {
    // The model sounds certain but is quoting something it was never shown.
    const { verified, dropped } = groundClaims(
      [
        {
          claim: "The pitch mentions a funding round.",
          sourceQuote: "We raised a Series A round in March to scale the team.",
        },
      ],
      corpus(),
    );
    expect(verified).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  test("a too-short span is rejected as evidence", () => {
    const c = buildCorpus([
      { sourceId: "form", source: "Project documentation", text: "PostgreSQL" },
    ]);
    expect(isGroundedInCorpus("PostgreSQL", c)).toBe(false);
  });

  test("re-wrapped and re-punctuated quotes still verify", () => {
    const { verified } = groundClaims(
      [
        {
          claim: "Rural clinics are the stated problem.",
          sourceQuote:
            "Rural clinics cannot keep  track, of follow-up visits on paper.",
        },
      ],
      corpus(),
    );
    expect(verified).toHaveLength(1);
  });

  test("mixed input yields only the verifiable claims", () => {
    const { verified, dropped } = groundClaims(
      [
        {
          claim: "Real claim.",
          sourceQuote: "Data is stored in PostgreSQL via Prisma.",
        },
        { claim: "Fake claim.", sourceQuote: "We onboarded 10,000 clinicians." },
        "not an object",
        { claim: "no quote" },
      ],
      corpus(),
    );
    expect(verified.map((v) => v.claim)).toEqual(["Real claim."]);
    expect(dropped).toBe(3);
  });

  test("a PDF claim is stored with the page as its source location", () => {
    const { verified } = groundClaims(
      [
        {
          claim: "The deck states PostgreSQL is used for patient records.",
          sourceQuote: "Page 2: we use PostgreSQL for patient records.",
        },
      ],
      corpus(),
    );
    expect(verified[0].source).toEqual({
      sourceId: "pdf:pitch.pdf",
      source: "Uploaded document (PDF) — pitch.pdf",
      page: 2,
    });
  });
});

// --- Chat quotes ------------------------------------------------------------

describe("chat grounding", () => {
  test("verified quotes carry their document and page", () => {
    const { verified, dropped } = groundQuotes(
      [
        "We run unit tests with Vitest and Playwright end-to-end tests.",
        "Page 2: we use PostgreSQL for patient records.",
        "The team has an ARR of $4M.",
      ],
      corpus(),
    );
    expect(dropped).toBe(1);
    expect(verified.map((q) => q.source.sourceId)).toEqual([
      "github-readme",
      "pdf:pitch.pdf",
    ]);
    expect(verified[1].source.page).toBe(2);
  });

  test("a corpus with no documents grounds nothing", () => {
    const empty = buildCorpus([]);
    const { verified, dropped } = groundQuotes(["anything at all in here"], empty);
    expect(verified).toHaveLength(0);
    expect(dropped).toBe(1);
  });
});

// --- Rubric sanitization ----------------------------------------------------

describe("criteria sanitization", () => {
  test("only requested criteria survive, and their claims are grounded", () => {
    const { criteria, dropped } = sanitizeCriteria(
      {
        "Technical Depth": {
          evidence: [
            {
              claim: "Tests exist.",
              sourceQuote: "We run unit tests with Vitest and Playwright end-to-end tests.",
            },
            {
              claim: "They have a security audit.",
              sourceQuote: "An independent security audit was completed in August.",
            },
          ],
        },
        "Business Viability": {
          evidence: [
            {
              claim: "Revenue exists.",
              sourceQuote: "We are profitable since March.",
            },
          ],
        },
        "Design": { evidence: [] },
      },
      ["Technical Depth", "Design"],
      corpus(),
    );

    expect(Object.keys(criteria).sort()).toEqual(["Design", "Technical Depth"]);
    // The invented criterion is discarded wholesale, and the one unverifiable
    // claim inside a requested criterion is dropped and counted.
    expect(dropped).toBe(1);
    expect(criteria["Technical Depth"].evidence).toHaveLength(1);
    expect(criteria["Technical Depth"].evidence[0].source?.sourceId).toBe(
      "github-readme",
    );
  });
});

// --- "Evidence not available." ---------------------------------------------

describe('the "Evidence not available." contract', () => {
  test("the exact wording is what the UI renders", () => {
    expect(NO_EVIDENCE).toBe("Evidence not available.");
  });

  test("it is what an empty brief field resolves to in the panel", () => {
    // CopilotPanel renders `text.trim() || NO_EVIDENCE`, so an empty field and
    // an explicit refusal are indistinguishable to the judge — on purpose.
    const empty = "";
    expect(empty.trim() || NO_EVIDENCE).toBe("Evidence not available.");
  });

  test("no claim is ever stored with that string as its evidence", () => {
    // It is a display value, never a quote: it is not in the corpus, so a
    // model that emits it as a sourceQuote has it dropped like any invention.
    const { verified, dropped } = groundClaims(
      [
        {
          claim: "The project uses PostgreSQL.",
          sourceQuote: NO_EVIDENCE,
        },
      ],
      corpus(),
    );
    expect(verified).toHaveLength(0);
    expect(dropped).toBe(1);
  });
});

// --- Corpus assembly inputs -------------------------------------------------

describe("submission form text", () => {
  test("it lists attached documents without claiming their contents were read", () => {
    const text = buildSourceText(
      {
        projectName: "Nebula Care",
        techStack: ["React Native", "PostgreSQL"],
        problemStatement: "Rural clinics cannot keep track of follow-up visits on paper.",
        solutionDescription: null,
        targetUsers: null,
        keyFeatures: ["Offline sync"],
        innovation: null,
        expectedImpact: null,
        implementationDetails: null,
        futureScope: null,
        abstract: null,
        documentNames: ["pitch.pdf", "notes.md"],
      },
      false,
    );
    expect(text).toContain("Attached documents:");
    expect(text).not.toContain("names only");
    expect(text).toContain("- pitch.pdf");
  });

  test("blind judging withholds the team's identity from the model", () => {
    const text = buildSourceText(
      {
        projectName: "Nebula Care",
        techStack: [],
        problemStatement: "Something",
        solutionDescription: null,
        targetUsers: null,
        keyFeatures: [],
        innovation: null,
        expectedImpact: null,
        implementationDetails: null,
        futureScope: null,
        abstract: null,
        documentNames: [],
      },
      true,
    );
    expect(text).toContain("blind judging is enabled");
  });
});
