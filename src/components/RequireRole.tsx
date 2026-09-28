import { useSession } from "@/hooks/use-session";
import { ROLE_HOME, ROLE_LABEL, type AppRole } from "@/lib/rapture";
import { Link } from "react-router";
import type { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";

/**
 * Blocks a route unless the signed-in user holds one of `allow`.
 *
 * This is a convenience layer only — it stops a judge from clicking their way
 * into the admin area and makes the refusal legible. The real boundary is
 * `requireRole` in the Convex functions, which re-checks on every read and
 * write regardless of what the client renders.
 */
export function RequireRole({
  allow,
  children,
}: {
  allow: AppRole[];
  children: ReactNode;
}) {
  const { isLoading, user, role } = useSession();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="nb-inset px-6 py-4 text-sm font-semibold uppercase tracking-widest">
          Checking access…
        </div>
      </div>
    );
  }

  // Not signed in at all: hand them to the sign-in screen.
  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="nb-card w-full max-w-md p-8">
          <h1 className="text-2xl font-bold tracking-tight">Sign in required</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You need to be signed in to open this area.
          </p>
          <Link
            to="/auth"
            className="nb-press mt-6 inline-flex h-10 items-center border-2 border-ink bg-primary px-5 text-sm font-semibold uppercase tracking-wide text-primary-foreground"
          >
            Go to sign in
          </Link>
        </div>
      </div>
    );
  }

  // Signed in but no role has been granted for this hackathon. This is a real
  // state, not an error: an organizer has to assign the role first.
  if (!role) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="nb-card w-full max-w-md p-8">
          <h1 className="text-2xl font-bold tracking-tight">No role assigned</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {user.email} is signed in, but has not been granted an admin, judge
            or participant role for this hackathon yet. Ask an organizer to
            assign one.
          </p>
        </div>
      </div>
    );
  }

  // Wrong role: refuse, and do not silently redirect, so the boundary is
  // visible rather than feeling like a broken link.
  if (!allow.includes(role)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="nb-card w-full max-w-md p-8">
          <div className="flex size-12 items-center justify-center border-2 border-ink bg-[#d8382a] text-white">
            <ShieldAlert className="size-6" />
          </div>
          <h1 className="mt-5 text-2xl font-bold tracking-tight">
            Not available to your role
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This area is for{" "}
            {allow.map((r) => ROLE_LABEL[r]).join(" or ")} accounts. You are
            signed in as a {ROLE_LABEL[role]}.
          </p>
          <Link
            to={ROLE_HOME[role]}
            className="nb-press mt-6 inline-flex h-10 items-center border-2 border-ink bg-primary px-5 text-sm font-semibold uppercase tracking-wide text-primary-foreground"
          >
            Go to my dashboard
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
