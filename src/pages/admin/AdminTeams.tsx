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
        <div className="surface-inset px-6 py-14 text-center text-sm text-muted-foreground">
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
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="data-table min-w-[860px]">
              <thead>
                <tr>
                  <th className="w-[30%]">Team</th>
                  <th>Track</th>
                  <th>Submission</th>
                  <th className="w-48">Judging</th>
                  <th className="text-right">Average</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((team) => (
                  <tr key={team.id}>
                    <td>
                      <Link
                        to={`/admin/teams/${team.id}`}
                        className="font-medium hover:underline"
                      >
                        {team.projectName}
                      </Link>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {team.name} · {formatDate(team.submittedAt)}
                      </span>
                    </td>
                    <td className="text-sm text-muted-foreground">
                      {team.trackName}
                    </td>
                    <td>
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
                    <td>
                      <BlockProgress
                        done={team.completedJudges}
                        total={team.assignedJudges}
                        label="Scored"
                      />
                    </td>
                    <td className="tabular text-right text-base font-semibold">
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
