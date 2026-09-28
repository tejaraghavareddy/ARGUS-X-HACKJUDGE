import { Link, NavLink, useNavigate } from "react-router";
import type { ReactNode } from "react";
import { LogOut, Menu } from "lucide-react";
import { useState } from "react";
import { useSession } from "@/hooks/use-session";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { ROLE_LABEL, ROLE_NAV, initials, type AppRole } from "@/lib/rapture";
import { cn } from "@/lib/utils";

const ROLE_BLOCK: Record<AppRole, string> = {
  admin: "bg-[#d8382a] text-white",
  judge: "bg-[#2b6be4] text-white",
  participant: "bg-[#ffe500] text-ink",
};

function Wordmark() {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <span className="flex size-9 items-center justify-center border-2 border-ink bg-[#ffe500] text-sm font-black text-ink">
        RJ
      </span>
      <span className="text-base font-black tracking-tight">RaptureJudge</span>
    </Link>
  );
}

/**
 * The signed-in application shell.
 *
 * Navigation comes entirely from the user's role, so no surface ever offers a
 * link into an area that role cannot use.
 */
export function AppShell({
  role,
  children,
}: {
  role: AppRole;
  children: ReactNode;
}) {
  const { user, signOut } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const hackathon = useQuery(api.hackathons.activeHackathon);

  const nav = ROLE_NAV[role];

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="border-b-2 border-ink px-5 py-4">
        <Wordmark />
      </div>

      <div className="border-b-2 border-ink px-5 py-4">
        <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Event
        </p>
        <p className="mt-1 text-sm font-bold leading-tight">
          {hackathon?.name ?? "Loading…"}
        </p>
        {hackathon && (
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {hackathon.location} · Judging
          </p>
        )}
      </div>

      <nav className="flex-1 space-y-2 p-4">
        {nav.map((item) => (
          <NavLink
            key={item.href}
            to={item.href}
            end={item.href === `/${role}` || item.href === "/admin"}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              cn(
                "block border-2 border-ink px-3 py-2.5 text-sm font-bold uppercase tracking-wide transition-none",
                isActive
                  ? "bg-ink text-white"
                  : "bg-surface text-ink hover:bg-accent",
              )
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t-2 border-ink p-4">
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center border-2 border-ink bg-[#e6e6de] text-xs font-black">
            {initials(user?.name ?? "?")}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold leading-tight">
              {user?.name}
            </p>
            <span
              className={cn(
                "mt-1 inline-block border-2 border-ink px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                ROLE_BLOCK[role],
              )}
            >
              {ROLE_LABEL[role]}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          className="mt-3 flex w-full items-center justify-center gap-2 border-2 border-ink bg-surface px-3 py-2 text-xs font-bold uppercase tracking-widest hover:bg-accent"
        >
          <LogOut className="size-3.5" />
          Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop: fixed rail. Mobile: toggled drawer. */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r-2 border-ink bg-surface lg:block">
        {sidebar}
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-ink/50"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-64 border-r-2 border-ink bg-surface">
            {sidebar}
          </div>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b-2 border-ink bg-surface px-4 py-3 lg:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
            className="flex size-10 items-center justify-center border-2 border-ink bg-surface"
          >
            <Menu className="size-5" />
          </button>
          <Wordmark />
        </header>

        <main className="mx-auto w-full max-w-[1400px] p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
