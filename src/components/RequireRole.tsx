import { useSession } from "@/hooks/use-session";
import { ROLE_HOME, ROLE_LABEL, type AppRole } from "@/lib/rapture";
import { Link } from "react-router";
import type { ReactNode } from "react";
import { ShieldAlert, Loader2 } from "lucide-react";

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
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Checking access…
        </div>
      </div>
    );
  }

  // Not signed in at all: hand them to the sign-in screen.
  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="surface-card w-full max-w-md p-7">
          <h1 className="text-xl font-semibold tracking-[-0.021em]">
            Sign in required
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            You need to be signed in to open this area.
          </p>
          <Link to="/auth" className="btn-base btn-primary mt-6">
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
        <div className="surface-card w-full max-w-md p-7">
          <h1 className="text-xl font-semibold tracking-[-0.021em]">
            No role assigned
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
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
        <div className="surface-card w-full max-w-md p-7">
          <div className="flex size-10 items-center justify-center rounded-md bg-danger-soft text-danger-foreground">
            <ShieldAlert className="size-5" />
          </div>
          <h1 className="mt-5 text-xl font-semibold tracking-[-0.021em]">
            Not available to your role
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            This area is for {allow.map((r) => ROLE_LABEL[r]).join(" or ")}{" "}
            accounts. You are signed in as a {ROLE_LABEL[role]}.
          </p>
          <Link to={ROLE_HOME[role]} className="btn-base btn-primary mt-6">
            Go to my dashboard
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
