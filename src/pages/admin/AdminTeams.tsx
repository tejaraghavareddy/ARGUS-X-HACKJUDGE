import { Link } from "react-router";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/app/AppShell";
import {
  BlockProgress,
  EmptyState,
  PageHeader,
  SectionCard,
  StatusBadge,
} from "@/components/app/Primitives";
import { SUBMISSION_TONE, formatDate } from "@/lib/rapture";

export default function AdminTeams() {
  const teams = useQuery(api.teams.adminTeams);

  if (teams === undefined) {
    return (
      <AppShell role="admin">
        <div className="nb-inset px-6 py-10 text-center text-sm font-semibold uppercase tracking-widest">
          Loading teams…
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell role="admin">
      <PageHeader
        title="Teams"
        description="Every team in this round, with submission state and judging coverage."
      />

      <SectionCard
        title="Team registry"
        description="Open a team to see its submission and the scorecards judges have filed."
      >
        {teams.length === 0 ? (
          <EmptyState
            title="No teams"
            description="No teams have registered for this hackathon yet."
          />
        ) : (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b-2 border-ink text-left">
                  {[
                    "Team",
                    "Track",
                    "Submission",
                    "Judges",
                    "Average",
                  ].map((h) => (
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
                {teams.map((team) => (
                  <tr
                    key={team.id}
                    className="border-b border-ink/20 align-middle last:border-b-0 hover:bg-accent/40"
                  >
                    <td className="px-3 py-3">
                      <Link
                        to={`/admin/teams/${team.id}`}
                        className="font-bold hover:underline"
                      >
                        {team.projectName}
                      </Link>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {team.name} · {formatDate(team.submittedAt)}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="border-2 border-ink bg-surface px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider">
                        {team.trackName}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {team.submissionStatus ? (
                        <StatusBadge
                          tone={
                            SUBMISSION_TONE[team.submissionStatus] ??
                            SUBMISSION_TONE.draft
                          }
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="w-40">
                        <BlockProgress
                          done={team.completedJudges}
                          total={team.assignedJudges}
                          label="Scored"
                        />
                      </div>
                    </td>
                    <td className="tabular px-3 py-3 text-base font-black">
                      {team.averageScore ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </AppShell>
  );
}
