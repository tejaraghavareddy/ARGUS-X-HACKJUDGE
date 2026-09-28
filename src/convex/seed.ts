import { mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { hashSecret } from "./lib/password";

/**
 * Demo data for RaptureJudge.
 *
 * Creates exactly what the product brief asks for: 1 hackathon, 3 admins,
 * 5 judges and 10 teams, plus the submissions, judge assignments and a spread
 * of judge scorecards so the dashboards and progress charts have real numbers
 * in them.
 *
 * Idempotent: re-running wipes the demo slice and rebuilds it, so it is safe
 * to call from the "Reset demo data" button on the admin dashboard.
 */

export const DEMO_PASSWORD = "rapture2026";

const HACKATHON_SLUG = "rapture-2026";

type DemoUser = {
  key: string;
  name: string;
  email: string;
  role: "admin" | "judge" | "participant";
  title: string;
  organization: string;
};

const ADMINS: DemoUser[] = [
  {
    key: "admin-1",
    name: "Aditi Raghunathan",
    email: "aditi@rapturejudge.io",
    role: "admin",
    title: "Head of Programs",
    organization: "Rapture Foundation",
  },
  {
    key: "admin-2",
    name: "Marcus Bell",
    email: "marcus@rapturejudge.io",
    role: "admin",
    title: "Operations Director",
    organization: "Rapture Foundation",
  },
  {
    key: "admin-3",
    name: "Sofia Alvarez",
    email: "sofia@rapturejudge.io",
    role: "admin",
    title: "Judging Coordinator",
    organization: "Rapture Foundation",
  },
];

const JUDGES: DemoUser[] = [
  {
    key: "judge-1",
    name: "Dr. Elena Vasquez",
    email: "elena@rapturejudge.io",
    role: "judge",
    title: "Principal Engineer",
    organization: "Northwind Labs",
  },
  {
    key: "judge-2",
    name: "Rahul Menon",
    email: "rahul@rapturejudge.io",
    role: "judge",
    title: "Founder & CTO",
    organization: "Tessellate",
  },
  {
    key: "judge-3",
    name: "Grace Okonkwo",
    email: "grace@rapturejudge.io",
    role: "judge",
    title: "Product Lead",
    organization: "Meridian Health",
  },
  {
    key: "judge-4",
    name: "Tomás Bergman",
    email: "tomas@rapturejudge.io",
    role: "judge",
    title: "Security Architect",
    organization: "Gatehouse",
  },
  {
    key: "judge-5",
    name: "Priya Nandakumar",
    email: "priya@rapturejudge.io",
    role: "judge",
    title: "Design Director",
    organization: "Fieldwork Studio",
  },
];

const TEAMS = [
  {
    name: "Team Nebula",
    project: "Nebula Care",
    tagline: "Triage that keeps clinicians ahead of the queue.",
    track: "Health Tech",
    stack: ["Next.js", "Convex", "LLM", "Postgres"],
    abstract:
      "Nebula Care reads inbound referral notes and produces a live prioritisation queue for hospital triage teams. A retrieval pass grounds every summary in the source record, and a clinician-in-the-loop UI shows exactly which note drove each recommendation.",
    highlights: [
      "Grounded summaries with per-note citations",
      "Triage queue reprioritises as new labs arrive",
      "Full audit log of every suggested reordering",
    ],
  },
  {
    name: "Team Quartz",
    project: "Quartz Grid",
    tagline: "Predictive load balancing for community microgrids.",
    track: "Climate",
    stack: ["React", "Python", "TimescaleDB", "Grafana"],
    abstract:
      "Quartz Grid forecasts demand across a village microgrid 24 hours out and proposes a dispatch plan for battery and diesel assets. The forecast degrades gracefully when telemetry drops, which is the common case in the field.",
    highlights: [
      "24h load forecast with confidence bands",
      "Degrades safely on partial telemetry",
      "Operator approval before any dispatch change",
    ],
  },
  {
    name: "Team Basalt",
    project: "Ledger Loop",
    tagline: "Tamper-evident supply chain receipts.",
    track: "Fintech",
    stack: ["Rust", "Solidity", "IPFS", "React"],
    abstract:
      "Ledger Loop turns a physical handoff into a verifiable receipt anchored to a public log. Auditors can walk a shipment's provenance without trusting our operator, and the mobile capture works fully offline.",
    highlights: [
      "Offline-first mobile capture",
      "Open provenance graph for auditors",
      "Anchored receipts resist operator tampering",
    ],
  },
  {
    name: "Team Cobalt",
    project: "Beacon",
    tagline: "Emergency mesh networking for cut-off districts.",
    track: "Civic",
    stack: ["Go", "LoRa", "MQTT", "Svelte"],
    abstract:
      "Beacon runs a low-power mesh over LoRa that keeps a district reachable when the fibre backbone is down. Volunteers register handsets from a phone, and the network routes around damaged nodes automatically.",
    highlights: [
      "Self-healing mesh with no central server",
      "Volunteer onboarding from a phone in minutes",
      "Text-only fallback for feature phones",
    ],
  },
  {
    name: "Team Onyx",
    project: "SignBridge",
    tagline: "Real-time sign language interpretation for classrooms.",
    track: "Accessibility",
    stack: ["PyTorch", "WebRTC", "React", "FastAPI"],
    abstract:
      "SignBridge turns a phone camera into a live interpreter overlay for deaf and hard-of-hearing students. Latency is held under 300ms by streaming skeletal keypoints rather than raw video.",
    highlights: [
      "Under 300ms end-to-end latency",
      "Keypoint streaming, not video round-trips",
      "Runs on a mid-range Android device",
    ],
  },
  {
    name: "Team Ferrous",
    project: "Forge CI",
    tagline: "CI feedback that arrives before you switch context.",
    track: "Dev Tools",
    stack: ["TypeScript", "Bun", "Postgres", "WebSockets"],
    abstract:
      "Forge CI pushes a failing build's diagnosis into the editor that caused it, with a ranked list of likely culprits. It learns from which suggestion you actually took, so the ranking improves per repository.",
    highlights: [
      "In-editor failure diagnosis",
      "Ranks suggestions from your accept/reject history",
      "Runs against any CI, not just one vendor",
    ],
  },
  {
    name: "Team Umber",
    project: "Terrace",
    tagline: "Farm-to-shelf traceability for smallholder co-ops.",
    track: "Climate",
    stack: ["Next.js", "Postgres", "Stripe", "Expo"],
    abstract:
      "Terrace gives a farming co-op one shared record from seed to sale. Buyers scan a crate code and see the lot, the harvest date and the price paid to the co-op, which is the part smallholders are usually locked out of.",
    highlights: [
      "One shared record across the whole co-op",
      "Proves the grower price paid to farmers",
      "Works on a basic phone with one bar of signal",
    ],
  },
  {
    name: "Team Indigo",
    project: "Quiet Hours",
    tagline: "Shared focus rooms that respect your calendar.",
    track: "Productivity",
    stack: ["React", "Convex", "Tailwind", "WebRTC"],
    abstract:
      "Quiet Hours runs focus rooms that form around whoever shows up, rather than around a fixed schedule. Presence is derived from actual activity so a dropped connection releases the room instead of holding it hostage.",
    highlights: [
      "Rooms form on demand, not on a timetable",
      "Presence derived from real activity",
      "Handover when a session member drops",
    ],
  },
  {
    name: "Team Ochre",
    project: "Sift",
    tagline: "Turn a messy research corpus into a cited answer.",
    track: "AI for Good",
    stack: ["Python", "pgvector", "Next.js", "Anthropic"],
    abstract:
      "Sift ingests a folder of research PDFs and answers questions with citations that open the exact page. It refuses to answer when the corpus does not support one, which is the behaviour that makes it usable in a research workflow.",
    highlights: [
      "Page-level citations, not document-level",
      "Refuses to answer when unsupported",
      "Admins can delete a source and re-index",
    ],
  },
  {
    name: "Team Slate",
    project: "Ferry",
    tagline: "Live ETAs for island ferry services.",
    track: "Civic",
    stack: ["Kotlin", "MapLibre", "Firestore", "FastAPI"],
    abstract:
      "Ferry combines vessel telemetry with timetables to publish an ETA that accounts for the weather rather than assuming a flat run. Islanders get a notification when the ferry is actually delayed.",
    highlights: [
      "Weather-aware, not schedule-only ETAs",
      "Push alerts on real delays",
      "Offline timetable bundled in the app",
    ],
  },
];

const TRACKS = [
  {
    name: "Health Tech",
    description: "Software that measurably improves care delivery.",
    color: "#4C6EF5",
  },
  {
    name: "Climate",
    description: "Energy, agriculture and adaptation tooling.",
    color: "#2F9E44",
  },
  {
    name: "Civic",
    description: "Public infrastructure and essential services.",
    color: "#F08C00",
  },
  {
    name: "Fintech",
    description: "Trust, inclusion and money movement.",
    color: "#7048E8",
  },
  {
    name: "Accessibility",
    description: "Removing barriers for disabled users.",
    color: "#E03131",
  },
  {
    name: "Dev Tools",
    description: "Tooling for people who build software.",
    color: "#0C8599",
  },
  {
    name: "Productivity",
    description: "Tools that respect attention and time.",
    color: "#D6336C",
  },
  {
    name: "AI for Good",
    description: "Applied AI with accountable grounding.",
    color: "#495057",
  },
];

// The default rubric from the product brief. Nothing here is hard-coded into
// scoring — this is simply the set the demo hackathon starts with, and an admin
// can reshape all of it from the rubric builder.
const CRITERIA = [
  {
    name: "Innovation",
    description: "Originality of the approach and the idea itself.",
    guidance:
      "Does the team have a point of view, or have they assembled something that already exists? A familiar stack is fine; a familiar idea is not.",
    maxScore: 20,
  },
  {
    name: "Technical Complexity",
    description: "Does it work, and is it built soundly?",
    guidance:
      "Judge the working demo, not the slide. Reward honest handling of failure over a happy path that only works on the demo data.",
    maxScore: 20,
  },
  {
    name: "Impact",
    description: "Meaningful difference for real people.",
    guidance:
      "Who specifically is better off, and by how much? A narrow, real beneficiary beats a broad, hypothetical one.",
    maxScore: 20,
  },
  {
    name: "User Experience",
    description: "Usability, clarity and craft of the experience.",
    guidance:
      "Could a stranger complete the core task unaided? Penalise features that are visible but not reachable.",
    maxScore: 15,
  },
  {
    name: "Feasibility",
    description: "Could this realistically keep running?",
    guidance:
      "Consider cost, data access and the team's own runway. Be sceptical of anything that only works on one laptop.",
    maxScore: 15,
  },
  {
    name: "Presentation",
    description: "Clarity of the pitch and the demo.",
    guidance:
      "Structure, timing and whether the team can answer a hard follow-up without flinching.",
    maxScore: 10,
  },
];

const FIRST_NAMES = [
  "Nikhil", "Sara", "Tomas", "Yuki", "Amara", "Bilal", "Chen", "Dara",
  "Elif", "Farid", "Greta", "Hana", "Idris", "Jaya", "Kofi", "Lena",
  "Mateo", "Nour", "Oskar", "Paloma", "Quinn", "Rafael", "Sana", "Theo",
  "Uma", "Vikram", "Wren", "Xiomara", "Yusuf", "Zara",
];

const LAST_NAMES = [
  "Okafor", "Lindqvist", "Moreau", "Tanaka", "Silva", "Haddad", "Wei",
  "Novak", "Demir", "Rossi", "Andersen", "Kaur", "Mensah", "Bianchi",
  "Petrov", "Nakamura", "Osei", "Larsen", "Costa", "Farouk", "Nielsen",
  "Barros", "Ivanova", "Kim",
];

const ROLES_FOR_MEMBERS = [
  "Full-stack Engineer",
  "Product Designer",
  "Data Scientist",
  "ML Engineer",
  "Backend Engineer",
];

// Member identities are derived purely from a cursor, so the same team always
// gets the same people. Both the cleanup pass and the creation loop call this,
// which is what keeps them from drifting and leaving orphaned accounts behind.
const MEMBERS_PER_TEAM = 3;

function memberIdentity(
  cursor: number,
  teamIndex: number,
  memberIndex: number,
) {
  const first = FIRST_NAMES[cursor % FIRST_NAMES.length];
  const last = LAST_NAMES[cursor % LAST_NAMES.length];
  const isLead = memberIndex === 0;
  const email = isLead
    ? `${first.toLowerCase()}.${last.toLowerCase()}@rapture.dev`
    : `${first.toLowerCase()}.${last.toLowerCase()}.${memberIndex}@rapture.dev`;

  return {
    first,
    last,
    name: `${first} ${last}`,
    isLead,
    email,
    role: isLead
      ? "Team Lead"
      : ROLES_FOR_MEMBERS[(teamIndex + memberIndex) % ROLES_FOR_MEMBERS.length],
  };
}

/** Every participant login this seed will create, for the cleanup pass. */
function buildParticipantEmails(): string[] {
  const emails: string[] = [];
  let cursor = 0;
  for (let teamIndex = 0; teamIndex < TEAMS.length; teamIndex++) {
    for (let memberIndex = 0; memberIndex < MEMBERS_PER_TEAM; memberIndex++) {
      emails.push(memberIdentity(cursor, teamIndex, memberIndex).email);
      cursor += 1;
    }
  }
  return emails;
}

// Deterministic pseudo-random so re-seeding produces a stable dataset.
function makeRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const now = Date.now();

export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const random = makeRandom(20260118);
    const passwordHash = await hashSecret(DEMO_PASSWORD);

    // --- Clear previous demo slice -----------------------------------------
    // Only demo data is removed, and only by slug, so unrelated records are
    // never touched.
    const existingHackathon = await ctx.db
      .query("hackathons")
      .withIndex("by_slug", (q) => q.eq("slug", HACKATHON_SLUG))
      .unique();

    if (existingHackathon) {
      const hackathonId = existingHackathon._id;
      const teams = await ctx.db
        .query("teams")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathonId))
        .collect();
      const teamIds = new Set(teams.map((t) => t._id));

      const assignments = await ctx.db
        .query("assignments")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathonId))
        .collect();
      for (const row of assignments) await ctx.db.delete(row._id);

      const scores = await ctx.db
        .query("scores")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathonId))
        .collect();
      for (const row of scores) await ctx.db.delete(row._id);

      const submissions = await ctx.db
        .query("submissions")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathonId))
        .collect();
      for (const row of submissions) await ctx.db.delete(row._id);

      const members = await ctx.db
        .query("teamMembers")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathonId))
        .collect();
      for (const row of members) await ctx.db.delete(row._id);

      const criteria = await ctx.db
        .query("judgingCriteria")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathonId))
        .collect();
      for (const row of criteria) await ctx.db.delete(row._id);

      for (const track of await ctx.db
        .query("tracks")
        .withIndex("by_hackathon", (q) => q.eq("hackathonId", hackathonId))
        .collect()) {
        await ctx.db.delete(track._id);
      }

      for (const team of teams) await ctx.db.delete(team._id);
      await ctx.db.delete(hackathonId);
    }

    // Remove every account this seed owns, so re-running it is safe.
    //
    // Deleting by (provider, providerAccountId) rather than by scanning users
    // is deliberate: `authAccounts` is keyed by that pair, so leaving even one
    // stale row behind makes Convex Auth's `unique()` lookup throw on the next
    // sign-in for that email. The participant list has to be regenerated the
    // same way the creation loop generates it, which is why both call
    // buildParticipantEmails().
    const demoEmails = new Set(
      [...ADMINS, ...JUDGES].map((u) => u.email.toLowerCase()).concat(
        buildParticipantEmails(),
      ),
    );

    for (const email of demoEmails) {
      const accounts = await ctx.db
        .query("authAccounts")
        .withIndex("providerAndAccountId", (q) =>
          q.eq("provider", "password").eq("providerAccountId", email),
        )
        .collect();

      for (const account of accounts) {
        const owner = account.userId;
        const sessions = await ctx.db
          .query("authSessions")
          .withIndex("userId", (q) => q.eq("userId", owner))
          .collect();
        for (const session of sessions) await ctx.db.delete(session._id);
        await ctx.db.delete(account._id);
        await ctx.db.delete(owner);
      }
    }

    // Reclaim abandoned records left behind by earlier demo runs. This is
    // deliberately conservative: a hackathon is only removed if it has no
    // teams and no scores, and a judge only if they never scored anything.
    // Anything with real work in it is left alone.
    for (const other of await ctx.db.query("hackathons").collect()) {
      if (other.slug === HACKATHON_SLUG) continue;
      const [otherTeams, otherScores] = await Promise.all([
        ctx.db
          .query("teams")
          .withIndex("by_hackathon", (q) => q.eq("hackathonId", other._id))
          .collect(),
        ctx.db
          .query("scores")
          .withIndex("by_hackathon", (q) => q.eq("hackathonId", other._id))
          .collect(),
      ]);
      if (otherTeams.length === 0 && otherScores.length === 0) {
        await ctx.db.delete(other._id);
      }
    }

    const seededJudgeEmails = new Set(JUDGES.map((j) => j.email));
    for (const user of await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "judge"))
      .collect()) {
      if (user.email && seededJudgeEmails.has(user.email)) continue;
      const theirScores = await ctx.db
        .query("scores")
        .withIndex("by_judge", (q) => q.eq("judgeId", user._id))
        .collect();
      if (theirScores.length > 0) continue;

      const theirAssignments = await ctx.db
        .query("assignments")
        .withIndex("by_judge", (q) => q.eq("judgeId", user._id))
        .collect();
      for (const row of theirAssignments) await ctx.db.delete(row._id);

      const accounts = await ctx.db
        .query("authAccounts")
        .withIndex("userIdAndProvider", (q) =>
          q.eq("userId", user._id).eq("provider", "password"),
        )
        .collect();
      for (const account of accounts) await ctx.db.delete(account._id);
      await ctx.db.delete(user._id);
    }

    // --- Hackathon ---------------------------------------------------------
    const hackathonId = await ctx.db.insert("hackathons", {
      name: "Rapture 2026",
      slug: HACKATHON_SLUG,
      logo: "RJ",
      tagline: "Build something worth shipping in 36 hours.",
      description:
        "Rapture is a national-level build sprint for teams working on civic, climate, health and accessibility problems. Ten shortlisted teams advance to the national final, where the judging rubric and standards are identical to this round.",
      problemStatement:
        "Public-interest infrastructure in India is fragmented: the people who need it most rarely control the tools meant to serve them. Build a tool that moves one of those decisions closer to the people making it.",
      eligibility:
        "Open to teams of 2-4. At least one member must be currently enrolled at, or employed by, an accredited institution. Teams may have exactly one lead. Prior hackathon wins are not disqualifying, but the previous build cannot be resubmitted.",
      rules:
        "All code must be committed to the public repository by the submission deadline. Third-party APIs must be disclosed. Teams may not include a team member who has declared a conflict of interest. Judging follows the published rubric; scores are final once submitted.",
      location: "Bengaluru + remote",
      status: "judging",
      isCurrent: true,
      startsAt: now - 9 * DAY,
      endsAt: now - 3 * DAY,
      registrationClosesAt: now - 8 * DAY,
      submissionsCloseAt: now - 3 * DAY,
      judgingStartsAt: now - 3 * DAY,
      judgingEndsAt: now + 2 * DAY,
      registrationOpen: false,
      submissionsOpen: false,
      judgingOpen: true,
      blindJudging: false,
      publicLeaderboard: true,
      resultsPublished: false,
      maxTeamSize: 4,
      createdAt: now - 30 * DAY,
    });

    // --- Tracks + rubric ---------------------------------------------------
    const trackIds = new Map<string, Id<"tracks">>();
    for (const [index, track] of TRACKS.entries()) {
      const id = await ctx.db.insert("tracks", {
        hackathonId,
        name: track.name,
        description: track.description,
        color: track.color,
        order: index,
      });
      trackIds.set(track.name, id);
    }

    for (const [index, criterion] of CRITERIA.entries()) {
      await ctx.db.insert("judgingCriteria", {
        hackathonId,
        name: criterion.name,
        description: criterion.description,
        guidance: criterion.guidance,
        maxScore: criterion.maxScore,
        order: index,
      });
    }

    // --- Staff + judges ----------------------------------------------------
    const upsertUser = async (user: DemoUser) => {
      const id = await ctx.db.insert("users", {
        name: user.name,
        email: user.email,
        emailVerificationTime: now,
        role: user.role,
        title: user.title,
        organization: user.organization,
        ...(user.role === "judge" ? { judgingCapacity: 3 } : {}),
      });
      await ctx.db.insert("authAccounts", {
        userId: id,
        provider: "password",
        providerAccountId: user.email.toLowerCase(),
        secret: passwordHash,
      });
      return id;
    };

    const adminIds: Id<"users">[] = [];
    for (const admin of ADMINS) adminIds.push(await upsertUser(admin));
    const judgeIds: Id<"users">[] = [];
    for (const judge of JUDGES) judgeIds.push(await upsertUser(judge));

    // --- Teams, members, submissions --------------------------------------
    const teamIds: Id<"teams">[] = [];
    let memberCursor = 0;
    const participantLogins: { name: string; email: string; team: string }[] =
      [];

    for (const [index, team] of TEAMS.entries()) {
      const teamId = await ctx.db.insert("teams", {
        hackathonId,
        trackId: trackIds.get(team.track),
        name: team.name,
        projectName: team.project,
        tagline: team.tagline,
        description: team.abstract,
        techStack: team.stack,
        repoUrl: `https://github.com/rapture/${team.project.toLowerCase().replace(/\s+/g, "-")}`,
        demoUrl: `https://${team.project.toLowerCase().replace(/\s+/g, "-")}.rapture.dev`,
        createdAt: now - 8 * DAY + index * HOUR,
      });
      teamIds.push(teamId);

      // 3 members per team; the first one is a real login account so every
      // team can be opened as a participant.
      for (let m = 0; m < MEMBERS_PER_TEAM; m++) {
        const member = memberIdentity(memberCursor, index, m);
        memberCursor += 1;
        const email = member.email;

        const memberUserId = await ctx.db.insert("users", {
          name: member.name,
          email,
          emailVerificationTime: now,
          role: "participant",
          organization: `Team ${team.name.replace("Team ", "")}`,
        });
        await ctx.db.insert("authAccounts", {
          userId: memberUserId,
          provider: "password",
          providerAccountId: email.toLowerCase(),
          secret: passwordHash,
        });

        await ctx.db.insert("teamMembers", {
          teamId,
          hackathonId,
          userId: memberUserId,
          name: member.name,
          email,
          isLead: member.isLead,
          role: member.role,
        });

        if (member.isLead) {
          participantLogins.push({
            name: member.name,
            email,
            team: team.name,
          });
        }
      }

      // One team is deliberately left unsubmitted so the admin oversight
      // screens show a realistic mix of states.
      const isUnsubmitted = index === TEAMS.length - 1;

      await ctx.db.insert("submissions", {
        hackathonId,
        teamId,
        status: isUnsubmitted ? "draft" : "submitted",
        abstract: team.abstract,
        highlights: team.highlights,
        videoUrl: `https://www.youtube.com/watch?v=rapture${index + 1}`,
        ...(isUnsubmitted ? {} : { submittedAt: now - 3 * DAY - index * HOUR }),
        aiReview: {
          summary: `${team.project} addresses ${team.tagline.toLowerCase()} The team demonstrates a working end-to-end path rather than a prototype-only slice.`,
          strengths: team.highlights.slice(0, 2),
          risks: [
            "Scaling beyond the demo dataset was not demonstrated.",
            "No unit test coverage was found in the public repository.",
          ],
          suggestedFocus:
            "Ask the team how the system behaves when its most reliable input is unavailable.",
          model: "rapture-advisory-v1",
          generatedAt: now - 3 * DAY,
        },
      });
    }

    // --- Judge assignments + a spread of scorecards ------------------------
    // Teams are dealt round-robin so every judge carries a comparable load,
    // and a second judge is added to half of them so multi-judge review is
    // genuinely exercised. The last team is left unassigned so admins can see
    // a real coverage gap on the dashboard.
    const assignableTeamCount = TEAMS.length - 1;
    const rubricMax = CRITERIA.reduce((sum, c) => sum + c.maxScore, 0);
    let scorecards = 0;
    let finalized = 0;

    const addAssignment = async (judgeId: Id<"users">, teamIndex: number) => {
      if (teamIndex >= assignableTeamCount) return null;
      return await ctx.db.insert("assignments", {
        hackathonId,
        judgeId,
        teamId: teamIds[teamIndex],
        status: "not_started",
        assignedAt: now - 3 * DAY,
        dueAt: now + 2 * DAY,
      });
    };

    // (judge index, team index) pairs to seed.
    const pairs: [number, number][] = [];
    for (let j = 0; j < judgeIds.length; j++) {
      for (let slot = 0; slot < 2; slot++) {
        pairs.push([j, j + slot * judgeIds.length]);
      }
    }
    // A second, independent judge on the even-indexed teams.
    for (let teamIndex = 0; teamIndex < assignableTeamCount; teamIndex += 2) {
      pairs.push([(teamIndex + 1) % judgeIds.length, teamIndex]);
    }

    const seen = new Set<string>();
    let pairIndex = 0;
    for (const [j, teamIndex] of pairs) {
      if (teamIndex >= assignableTeamCount) continue;
      const key = `${j}:${teamIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const judgeId = judgeIds[j];
      const teamId = teamIds[teamIndex];
      const assignmentId = await addAssignment(judgeId, teamIndex);
      if (!assignmentId) continue;

      // A spread of progress: a majority finalized, a few drafts, a few
      // untouched, so the dashboards and progress bars have real numbers.
      const isFinal = pairIndex % 3 !== 0;
      const isDraft = pairIndex % 5 === 0;
      pairIndex += 1;

      if (!isFinal && !isDraft) continue;

      // A criterion contributes exactly the points awarded, so the ceiling is
      // the sum of every maxScore. Scores are spread across that range so the
      // seeded standings look like real judging rather than all-100s.
      const breakdown: Record<string, number> = {};
      for (const criterion of CRITERIA) {
        const ratio = 0.5 + random() * 0.5;
        breakdown[criterion.name] = Math.max(
          1,
          Math.min(criterion.maxScore, Math.round(criterion.maxScore * ratio)),
        );
      }

      const total = Number(
        CRITERIA.reduce(
          (sum, criterion) => sum + (breakdown[criterion.name] ?? 0),
          0,
        ).toFixed(2),
      );

      if (isFinal) finalized += 1;
      scorecards += 1;

      await ctx.db.insert("scores", {
        hackathonId,
        assignmentId,
        teamId,
        judgeId,
        breakdown,
        totalScore: total,
        maxTotalScore: rubricMax,
        comments: isFinal
          ? "Clear problem framing and a working demo. The team was honest about the limits of the current build, which helped the review."
          : "Still working through the rubric — early read is that the demo is strong but the scaling story is thin.",
        recommendation:
          total > rubricMax * 0.72
            ? "advance"
            : total > rubricMax * 0.58
              ? "hold"
              : "reject",
        isFinal,
        updatedAt: now - 2 * DAY + scorecards * HOUR,
        ...(isFinal ? { submittedAt: now - 2 * DAY + scorecards * HOUR } : {}),
      });

      await ctx.db.patch(assignmentId, {
        status: isFinal ? "submitted" : "in_progress",
      });
    }

    // --- Conflict of interest --------------------------------------------
    // Declaring a conflict stands a judge down, which also removes the pairing
    // from their queue. The judge named here is one whose assignment to this
    // team is deleted, exactly as `judges.declareConflict` would do.
    const conflictJudge = judgeIds[3];
    const conflictTeamIndex = 1;
    await ctx.db.insert("judgeConflicts", {
      hackathonId,
      judgeId: conflictJudge,
      teamId: teamIds[conflictTeamIndex],
      reason:
        "Judge is a former advisor to this team's university lab; declared at onboarding.",
      createdBy: adminIds[2],
      createdAt: now - 2 * DAY,
    });
    const conflictedAssignment = await ctx.db
      .query("assignments")
      .withIndex("by_judge_team", (q) =>
        q.eq("judgeId", conflictJudge).eq("teamId", teamIds[conflictTeamIndex]),
      )
      .unique();
    if (conflictedAssignment) {
      await ctx.db.delete(conflictedAssignment._id);
    }

    // --- A deactivated judge ----------------------------------------------
    // Kept active in the roster with their history intact, so the admin UI has
    // a realistic "inactive" row to show.
    await ctx.db.patch(judgeIds[4], { isActive: false });

    // --- A second, not-yet-live hackathon ---------------------------------
    const draftHackathonId = await ctx.db.insert("hackathons", {
      name: "Rapture 2027",
      slug: `${HACKATHON_SLUG}-draft`,
      logo: "R7",
      tagline: "Same standards, next cohort.",
      description:
        "The 2027 edition. Planning is under way; the rubric and tracks will be confirmed once this round's results are published.",
      problemStatement: "To be announced.",
      eligibility: "To be announced.",
      rules: "To be announced.",
      location: "Bengaluru + remote",
      status: "registration",
      isCurrent: false,
      startsAt: now + 120 * DAY,
      endsAt: now + 122 * DAY,
      registrationClosesAt: now + 119 * DAY,
      submissionsCloseAt: now + 122 * DAY,
      judgingStartsAt: now + 122 * DAY,
      judgingEndsAt: now + 125 * DAY,
      registrationOpen: false,
      submissionsOpen: false,
      judgingOpen: false,
      blindJudging: true,
      publicLeaderboard: false,
      resultsPublished: false,
      maxTeamSize: 4,
      createdAt: now - 4 * DAY,
    });

    // --- Audit history ----------------------------------------------------
    // Seeded so the log reads like a real event rather than an empty table.
    const auditActorId = adminIds[0];
    const auditEntries: [number, string, string, string, string, string?][] = [
      [now - 21 * DAY, "hackathon.created", "hackathon", hackathonId, "Rapture 2026"],
      [now - 20 * DAY, "rubric.criterion_created", "criterion", "", "Innovation"],
      [now - 20 * DAY, "rubric.criterion_created", "criterion", "", "Technical Complexity"],
      [now - 20 * DAY, "rubric.criterion_created", "criterion", "", "Impact"],
      [now - 20 * DAY, "rubric.criterion_created", "criterion", "", "User Experience"],
      [now - 20 * DAY, "rubric.criterion_created", "criterion", "", "Feasibility"],
      [now - 20 * DAY, "rubric.criterion_created", "criterion", "", "Presentation"],
      [now - 14 * DAY, "judge.created", "judge", judgeIds[0], "Dr. Elena Vasquez"],
      [now - 14 * DAY, "judge.created", "judge", judgeIds[1], "Rahul Menon"],
      [now - 13 * DAY, "judge.created", "judge", judgeIds[2], "Grace Okonkwo"],
      [now - 13 * DAY, "judge.created", "judge", judgeIds[3], "Tomás Bergman"],
      [now - 12 * DAY, "judge.created", "judge", judgeIds[4], "Priya Nandakumar"],
      [now - 9 * DAY, "settings.toggled", "hackathon", hackathonId, "Registration opened", "Registration=true"],
      [now - 3 * DAY, "settings.toggled", "hackathon", hackathonId, "Submissions closed", "Submissions=false"],
      [now - 3 * DAY, "settings.toggled", "hackathon", hackathonId, "Judging started", "Judging=true"],
      [now - 2 * DAY, "assignment.created", "team", "", "Team Quartz", "judge=Dr. Elena Vasquez"],
      [now - 2 * DAY, "conflict.declared", "team", teamIds[conflictTeamIndex], "Team Quartz", "reason=former advisor"],
      [now - 1 * DAY, "judge.deactivated", "judge", judgeIds[4], "Priya Nandakumar"],
      [now - 1 * DAY, "hackathon.created", "hackathon", draftHackathonId, "Rapture 2027"],
    ];

    for (const [createdAt, action, targetType, targetId, targetLabel, summary] of
      auditEntries) {
      await ctx.db.insert("auditLog", {
        hackathonId,
        actorId: auditActorId,
        actorName: ADMINS[0].name,
        action,
        targetType,
        targetId: targetId || undefined,
        targetLabel,
        metadata: summary ? { summary } : undefined,
        createdAt,
      });
    }

    return {
      hackathon: "Rapture 2026",
      draftHackathon: "Rapture 2027",
      password: DEMO_PASSWORD,
      admins: ADMINS.length,
      judges: JUDGES.length,
      teams: TEAMS.length,
      assignments: seen.size,
      scorecards,
      finalized,
      conflicts: 1,
      auditEntries: auditEntries.length,
      unassignedTeams: TEAMS.length - assignableTeamCount,
      participantSample: participantLogins.slice(0, 3),
    };
  },
});
