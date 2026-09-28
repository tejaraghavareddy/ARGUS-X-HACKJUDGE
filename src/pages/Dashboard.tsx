import { useSession } from "@/hooks/use-session";
import { ROLE_HOME } from "@/lib/rapture";
import { Navigate, useLocation } from "react-router";

/**
 * Entry point for any signed-in user.
 *
 * There is no shared dashboard: each role works from a different screen, so
 * this only resolves where the signed-in user belongs and forwards them.
 */
export default function Dashboard() {
  const { isLoading, user, role } = useSession();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="nb-inset px-6 py-4 text-sm font-semibold uppercase tracking-widest">
          Loading…
        </div>
      </div>
    );
  }

  if (!user) {
    const returnTo = `${location.pathname}${location.search}`;
    return <Navigate to={`/auth?returnTo=${encodeURIComponent(returnTo)}`} replace />;
  }

  if (!role) {
    // Authenticated but unassigned — land on the explanation, not a blank app.
    return <Navigate to="/no-role" replace />;
  }

  return <Navigate to={ROLE_HOME[role]} replace />;
}
