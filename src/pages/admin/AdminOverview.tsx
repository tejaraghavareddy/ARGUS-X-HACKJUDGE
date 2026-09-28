import { useState } from "react";
import { Link } from "react-router";
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

const TOOLTIP_STYLE = {
  border: "1px solid #e2e3e7",
  borderRadius: "0.5rem",
  background: "#ffffff",
  fontSize: 12,
  boxShadow: "0 12px 24px -6px rgb(16 24 40 / 0.12)",
};

const AXIS = { fontSize: 11, fill: "#5b6270" };

export default function AdminOverview() {
  const data = useQuery(api.hackathons.adminOverview);
  const seed = useMutation(api.seed.seed);
  const [seeding, setSeeding] = useState(false);

  if (data === undefined) {
    return (
      <AppShell role="admin">
        <div className="surface-inset px-6 py-14 text-center text-sm text-muted-foreground">
          Loading oversight data…
        </div>
      </AppShell>
    );
  }

  const runSeed = async () => {
    setSeeding(true);
    try {
      await seed({});
      toast.success("Demo data rebuilt.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Reset failed.");
    } finally {
      setSeeding(false);
    }
  };

  if (!data.hackathon) {
    return (
      <AppShell role="admin">
        <div className="surface-card p-7">
          <h1 className="text-xl font-semibold">No hackathon yet</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The database is empty. Load the demo dataset to get started.
          </p>
          <Button className="mt-5" onClick={() => void runSeed()}>
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
              tone={
                HACKATHON_TONE[data.hackathon.status] ??
                HACKATHON_TONE.judging
              }
            />
            <Button variant="outline" size="sm" disabled={seeding} onClick={() => void runSeed()}>
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
          tone="primary"
        />
        <StatTile label="Judges" value={totals.judges} />
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
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3">
          <AlertTriangle className="mt-px size-4 shrink-0 text-warning" />
          <p className="text-sm leading-relaxed text-warning-foreground">
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
          <div className="mt-5 grid grid-cols-3 gap-3">
            <StatTile label="Done" value={totals.completed} />
            <StatTile label="In progress" value={totals.inProgress} />
            <StatTile label="Not started" value={totals.notStarted} />
          </div>
        </SectionCard>

        <SectionCard
          title="Submissions"
          description="Current state of every team's submission."
        >
          <div className="grid grid-cols-2 gap-3">
            <StatTile label="Submitted" value={submissionBreakdown.submitted} />
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
              <BarChart
                data={byTrack}
                margin={{ top: 4, right: 8, left: -22, bottom: 0 }}
              >
                <CartesianGrid vertical={false} stroke="#e2e3e7" />
                <XAxis
                  dataKey="name"
                  tick={AXIS}
                  axisLine={{ stroke: "#e2e3e7" }}
                  tickLine={false}
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                  height={52}
                />
                <YAxis
                  allowDecimals={false}
                  tick={AXIS}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  cursor={{ fill: "#f0f1f2" }}
                  contentStyle={TOOLTIP_STYLE}
                />
                <Bar dataKey="teams" radius={[4, 4, 0, 0]} maxBarSize={38}>
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
                margin={{ top: 4, right: 24, left: 8, bottom: 0 }}
              >
                <CartesianGrid horizontal={false} stroke="#e2e3e7" />
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  tick={AXIS}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={96}
                  tick={AXIS}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip cursor={{ fill: "#f0f1f2" }} contentStyle={TOOLTIP_STYLE} />
                <Bar
                  dataKey="average"
                  fill="#0d5c55"
                  radius={[0, 4, 4, 0]}
                  maxBarSize={22}
                />
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
          <Link to="/admin/teams" className="btn-base btn-outline btn-sm">
            All teams
          </Link>
        }
      >
        {standings.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No finalized scorecards yet, so there is nothing to rank.
          </p>
        ) : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="data-table min-w-[620px]">
              <thead>
                <tr>
                  <th className="w-12">#</th>
                  <th>Project</th>
                  <th>Track</th>
                  <th>Scorecards</th>
                  <th className="text-right">Average</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((row, index) => (
                  <tr key={row.teamId}>
                    <td className="tabular font-semibold text-muted-foreground">
                      {index + 1}
                    </td>
                    <td>
                      <Link
                        to={`/admin/teams/${row.teamId}`}
                        className="font-medium hover:underline"
                      >
                        {row.projectName}
                      </Link>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {row.teamName}
                      </span>
                    </td>
                    <td className="text-sm text-muted-foreground">
                      {row.trackName}
                    </td>
                    <td className="tabular">{row.scorecards}</td>
                    <td className="tabular text-right text-base font-semibold">
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
        <div className="-mx-5 overflow-x-auto px-5">
          <table className="data-table min-w-[640px]">
            <thead>
              <tr>
                <th>Judge</th>
                <th>Organization</th>
                <th className="text-right">Assigned</th>
                <th className="text-right">Done</th>
                <th className="w-48">Load</th>
              </tr>
            </thead>
            <tbody>
              {judgeLoad.map((judge) => (
                <tr key={judge.judgeId}>
                  <td className="font-medium">{judge.name}</td>
                  <td className="text-sm text-muted-foreground">
                    {judge.organization}
                  </td>
                  <td className="tabular text-right">{judge.assigned}</td>
                  <td className="tabular text-right font-medium">
                    {judge.completed}
                  </td>
                  <td>
                    <BlockProgress done={judge.completed} total={judge.assigned} />
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
