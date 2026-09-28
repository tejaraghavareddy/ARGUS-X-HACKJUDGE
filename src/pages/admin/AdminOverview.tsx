import { Link } from "react-router";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app/AppShell";
import {
  BlockProgress,
  PageHeader,
  SectionCard,
  StatTile,
  StatusBadge,
} from "@/components/app/Primitives";
import { Button } from "@/components/ui/button";
import { HACKATHON_TONE, formatDate } from "@/lib/rapture";

export default function AdminOverview() {
  const data = useQuery(api.hackathons.adminOverview);
  const seed = useMutation(api.seed.seed);
  const [seeding, setSeeding] = useState(false);

  if (data === undefined) {
    return (
      <AppShell role="admin">
        <div className="nb-inset px-6 py-10 text-center text-sm font-semibold uppercase tracking-widest">
          Loading oversight data…
        </div>
      </AppShell>
    );
  }

  if (!data.hackathon) {
    return (
      <AppShell role="admin">
        <div className="nb-card p-8">
          <h1 className="text-xl font-black">No hackathon yet</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The database is empty. Load the demo dataset to get started.
          </p>
          <Button
            className="mt-5"
            onClick={async () => {
              setSeeding(true);
              try {
                await seed({});
                toast.success("Demo data loaded.");
              } catch (error) {
                toast.error(
                  error instanceof Error ? error.message : "Seed failed.",
                );
              } finally {
                setSeeding(false);
              }
            }}
          >
            <RotateCcw />
            {seeding ? "Loading…" : "Load demo data"}
          </Button>
        </div>
      </AppShell>
    );
  }

  const { totals, submissionBreakdown, byTrack, standings, judgeLoad } = data;

  const scoreDistribution = standings
    .filter((row) => row.average !== null)
    .map((row) => ({ name: row.projectName, average: row.average }));

  return (
    <AppShell role="admin">
      <PageHeader
        title="Oversight"
        description={`${data.hackathon.name} · submissions closed ${formatDate(
          data.hackathon.submissionsCloseAt,
        )} · judging ends ${formatDate(data.hackathon.judgingEndsAt)}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              tone={HACKATHON_TONE[data.hackathon.status] ?? HACKATHON_TONE.judging}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={seeding}
              onClick={async () => {
                setSeeding(true);
                try {
                  await seed({});
                  toast.success("Demo data rebuilt.");
                } catch (error) {
                  toast.error(
                    error instanceof Error ? error.message : "Reset failed.",
                  );
                } finally {
                  setSeeding(false);
                }
              }}
            >
              <RotateCcw />
              {seeding ? "Rebuilding…" : "Reset demo data"}
            </Button>
          </div>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Teams"
          value={totals.teams}
          hint={`${totals.participants} participants`}
          tone="ink"
        />
        <StatTile label="Judges" value={totals.judges} tone="surface" />
        <StatTile
          label="Scorecards in"
          value={totals.finalizedScorecards}
          hint={`of ${totals.assignments} assigned`}
        />
        <StatTile
          label="Unassigned teams"
          value={totals.unassignedTeams}
          hint={totals.unassignedTeams ? "Needs a judge" : "Fully covered"}
          tone={totals.unassignedTeams ? "accent" : "surface"}
        />
      </div>

      {/* The one thing an organizer most needs to act on. */}
      {totals.unassignedTeams > 0 && (
        <div className="mb-6 flex items-start gap-3 border-2 border-ink bg-[#ffe500] p-4">
          <AlertTriangle className="mt-0.5 size-5 shrink-0" />
          <p className="text-sm font-semibold leading-snug">
            {totals.unassignedTeams} team
            {totals.unassignedTeams === 1 ? " has" : "s have"} no judge assigned
            and will not be scored until that is fixed.
          </p>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard
          title="Judging progress"
          description="Completed, in progress and not yet started assignments."
        >
          <BlockProgress
            done={totals.completed}
            total={totals.assignments}
            label="Scorecards submitted"
          />
          <div className="mt-5 grid grid-cols-3 gap-2">
            <StatTile label="Done" value={totals.completed} />
            <StatTile label="In progress" value={totals.inProgress} />
            <StatTile label="Not started" value={totals.notStarted} />
          </div>
        </SectionCard>

        <SectionCard
          title="Submissions"
          description="Current state of every team's submission."
        >
          <div className="grid grid-cols-2 gap-2">
            <StatTile
              label="Submitted"
              value={submissionBreakdown.submitted}
            />
            <StatTile
              label="Under review"
              value={submissionBreakdown.underReview}
            />
            <StatTile label="Draft" value={submissionBreakdown.draft} />
            <StatTile label="Scored" value={submissionBreakdown.scored} />
          </div>
        </SectionCard>

        <SectionCard
          title="Teams by track"
          description="Where this round's submissions are concentrated."
        >
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byTrack} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="#111111" strokeOpacity={0.15} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fontWeight: 700, fill: "#111111" }}
                  axisLine={{ stroke: "#111111", strokeWidth: 2 }}
                  tickLine={false}
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                  height={50}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fontWeight: 700, fill: "#111111" }}
                  axisLine={{ stroke: "#111111", strokeWidth: 2 }}
                />
                <Tooltip
                  cursor={{ fill: "#ffe500", fillOpacity: 0.35 }}
                  contentStyle={{
                    border: "2px solid #111111",
                    borderRadius: 0,
                    fontWeight: 700,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="teams" radius={0} stroke="#111111" strokeWidth={2}>
                  {byTrack.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard
          title="Average score by team"
          description="From finalized scorecards only. Drafts never move the standings."
        >
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={scoreDistribution}
                layout="vertical"
                margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
              >
                <CartesianGrid stroke="#111111" strokeOpacity={0.15} />
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  tick={{ fontSize: 11, fontWeight: 700, fill: "#111111" }}
                  axisLine={{ stroke: "#111111", strokeWidth: 2 }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={92}
                  tick={{ fontSize: 11, fontWeight: 700, fill: "#111111" }}
                  axisLine={{ stroke: "#111111", strokeWidth: 2 }}
                />
                <Tooltip
                  cursor={{ fill: "#ffe500", fillOpacity: 0.35 }}
                  contentStyle={{
                    border: "2px solid #111111",
                    borderRadius: 0,
                    fontWeight: 700,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="average" fill="#2b6be4" radius={0} stroke="#111111" strokeWidth={2} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>
      </div>

      <SectionCard
        className="mt-5"
        title="Standings"
        description="Ranked by mean of finalized scorecards."
        actions={
          <Link
            to="/admin/teams"
            className="nb-press inline-flex h-8 items-center border-2 border-ink bg-surface px-3 text-xs font-bold uppercase tracking-wider hover:bg-accent"
          >
            All teams
          </Link>
        }
      >
        {standings.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No finalized scorecards yet, so there is nothing to rank.
          </p>
        ) : (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b-2 border-ink text-left">
                  {["#", "Project", "Track", "Scorecards", "Average"].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-widest"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {standings.map((row, index) => (
                  <tr
                    key={row.teamId}
                    className="border-b border-ink/20 last:border-b-0 hover:bg-accent/40"
                  >
                    <td className="tabular px-3 py-2.5 font-black">
                      {index + 1}
                    </td>
                    <td className="px-3 py-2.5">
                      <Link
                        to={`/admin/teams/${row.teamId}`}
                        className="font-bold hover:underline"
                      >
                        {row.projectName}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {row.teamName}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs font-semibold">
                      {row.trackName}
                    </td>
                    <td className="tabular px-3 py-2.5">
                      {row.scorecards}
                    </td>
                    <td className="tabular px-3 py-2.5 text-base font-black">
                      {row.average ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        className="mt-5"
        title="Judge workload"
        description="Assignments, completion and remaining capacity per judge."
      >
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b-2 border-ink text-left">
                {["Judge", "Organization", "Assigned", "Done", "In progress", "Load"].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-widest"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {judgeLoad.map((judge) => (
                <tr
                  key={judge.judgeId}
                  className="border-b border-ink/20 last:border-b-0 hover:bg-accent/40"
                >
                  <td className="px-3 py-2.5 font-bold">{judge.name}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {judge.organization}
                  </td>
                  <td className="tabular px-3 py-2.5">{judge.assigned}</td>
                  <td className="tabular px-3 py-2.5 font-bold">
                    {judge.completed}
                  </td>
                  <td className="tabular px-3 py-2.5">{judge.inProgress}</td>
                  <td className="px-3 py-2.5">
                    <BlockProgress
                      done={judge.completed}
                      total={judge.assigned}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </AppShell>
  );
}
