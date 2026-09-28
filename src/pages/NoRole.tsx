import { useSession } from "@/hooks/use-session";
import { Link } from "react-router";
import { ShieldQuestion } from "lucide-react";

/**
 * Shown to a signed-in user with no granted role. This is a real state for
 * self-serve sign-ups: an organizer still has to assign them a role.
 */
export default function NoRole() {
  const { user, signOut } = useSession();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="surface-card w-full max-w-lg p-7">
        <div className="flex size-10 items-center justify-center rounded-md bg-warning-soft text-warning-foreground">
          <ShieldQuestion className="size-5" />
        </div>
        <h1 className="mt-5 text-xl font-semibold tracking-[-0.021em]">
          No role assigned yet
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          You are signed in as{" "}
          <span className="font-medium text-foreground">{user?.email}</span>, but
          you have not been added as an admin, judge or participant for this
          hackathon. Ask an organizer to grant your role, then sign in again.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void signOut()}
            className="btn-base btn-outline"
          >
            Sign out
          </button>
          <Link to="/" className="btn-base btn-primary">
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
