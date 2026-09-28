import { Link, NavLink, useNavigate } from "react-router";
import type { ReactNode } from "react";
import { LogOut, Menu } from "lucide-react";
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useSession } from "@/hooks/use-session";
import { ROLE_LABEL, ROLE_NAV, initials, type AppRole } from "@/lib/rapture";
import { cn } from "@/lib/utils";

const ROLE_TONE: Record<AppRole, string> = {
  admin: "bg-danger-soft text-danger-foreground",
  judge: "bg-info-soft text-info-foreground",
  participant: "bg-accent text-accent-foreground",
};

function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-md bg-primary text-xs font-bold tracking-tight text-primary-foreground">
        RJ
      </span>
      {!compact && (
        <span className="text-[0.9375rem] font-semibold tracking-[-0.02em]">
          RaptureJudge
        </span>
      )}
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
    <div className="flex h-full flex-col bg-card">
      <div className="flex h-14 items-center border-b border-border px-4">
        <Wordmark />
      </div>

      <div className="border-b border-border px-4 py-3.5">
        <p className="text-[0.6875rem] font-semibold tracking-wide text-muted-foreground uppercase">
          Current event
        </p>
        <p className="mt-1 text-sm font-medium leading-tight">
          {hackathon?.name ?? "Loading…"}
        </p>
        {hackathon && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {hackathon.location}
          </p>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 p-3">
        {nav.map((item) => (
          <NavLink
            key={item.href}
            to={item.href}
            end={item.href === "/admin" || item.href === "/judge"}
            onClick={() => setOpen(false)}
            className={({ isActive }) =>
              cn(
                "flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2.5 rounded-md px-1 py-1">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-[0.6875rem] font-semibold text-secondary-foreground">
            {initials(user?.name ?? "?")}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-tight">
              {user?.name}
            </p>
            <span
              className={cn(
                "mt-0.5 inline-block rounded-full px-1.5 py-px text-[0.625rem] font-semibold",
                ROLE_TONE[role],
              )}
            >
              {ROLE_LABEL[role]}
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          className="mt-2 flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-border lg:block">
        {sidebar}
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-foreground/25"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-64 border-r border-border shadow-overlay">
            {sidebar}
          </div>
        </div>
      )}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-card/90 px-4 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
            className="flex size-9 items-center justify-center rounded-md border border-input bg-card"
          >
            <Menu className="size-4" />
          </button>
          <Wordmark />
        </header>

        <main className="mx-auto w-full max-w-[1440px] p-4 sm:p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
