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
      <div className="nb-card w-full max-w-lg p-8">
        <div className="flex size-12 items-center justify-center border-2 border-ink bg-[#ffe500]">
          <ShieldQuestion className="size-6" />
        </div>
        <h1 className="mt-5 text-2xl font-black tracking-tight">
          No role assigned yet
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          You are signed in as{" "}
          <span className="font-semibold text-ink">{user?.email}</span>, but
          you have not been added as an admin, judge or participant for this
          hackathon. Ask an organizer to grant your role, then sign in again.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void signOut()}
            className="nb-press h-10 border-2 border-ink bg-surface px-4 text-sm font-semibold uppercase tracking-wide"
          >
            Sign out
          </button>
          <Link
            to="/"
            className="nb-press inline-flex h-10 items-center border-2 border-ink bg-primary px-4 text-sm font-semibold uppercase tracking-wide text-primary-foreground"
          >
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
