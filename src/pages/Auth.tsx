import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useAuthActions } from "@convex-dev/auth/react";
import { ArrowRight, Check, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSession } from "@/hooks/use-session";
import {
  DEMO_ACCOUNTS,
  DEMO_PASSWORD,
  ROLE_LABEL,
  ROLE_HOME,
  type AppRole,
} from "@/lib/rapture";
import { cn } from "@/lib/utils";

interface AuthProps {
  redirectAfterAuth?: string;
}

function resolveRedirect(returnTo: string | null, fallback: string) {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) return returnTo;
  return fallback;
}

const ROLE_TONE: Record<AppRole, string> = {
  admin: "bg-danger-soft text-danger-foreground",
  judge: "bg-info-soft text-info-foreground",
  participant: "bg-accent text-accent-foreground",
};

const PROMISES = [
  "Per-judge isolation on every read and write",
  "Locked scorecards with a full audit trail",
  "AI briefs the judge, never scores for them",
];

export default function Auth({ redirectAfterAuth = "/dashboard" }: AuthProps) {
  const { signIn } = useAuthActions();
  const { isLoading, isAuthenticated } = useSession();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = resolveRedirect(
    searchParams.get("returnTo"),
    redirectAfterAuth,
  );

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Already signed in? Don't leave someone staring at a login form they no
  // longer need — /dashboard sorts out where their role belongs.
  useEffect(() => {
    if (!isLoading && isAuthenticated) navigate(redirect, { replace: true });
  }, [isLoading, isAuthenticated, navigate, redirect]);

  const signInAs = async (withEmail: string, withPassword: string) => {
    setBusy(withEmail);
    setError(null);
    try {
      // `flow` is required by the Password provider to disambiguate sign-in
      // from sign-up and password reset. Without it the provider throws.
      await signIn("password", {
        flow: "signIn",
        email: withEmail,
        password: withPassword,
      });
      navigate(redirect, { replace: true });
    } catch (err) {
      console.error("Sign-in failed:", err);
      setError(
        err instanceof Error
          ? err.message
          : "That email and password combination was not recognised.",
      );
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-primary p-12 text-primary-foreground lg:flex">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-md bg-white/15 text-xs font-bold">
            RJ
          </span>
          <span className="text-[0.9375rem] font-semibold tracking-[-0.02em]">
            RaptureJudge
          </span>
        </Link>

        <div className="max-w-md">
          <span className="inline-flex items-center rounded-full bg-white/12 px-2.5 py-1 text-xs font-medium">
            Rapture 2026 · National final
          </span>
          <h1 className="mt-6 text-4xl leading-[1.08] font-semibold tracking-[-0.03em]">
            Judging you can actually defend.
          </h1>
          <p className="mt-5 text-sm leading-relaxed text-primary-foreground/75">
            Submission tracking, weighted scorecards and a complete audit trail
            for every decision. Built for organizers who have to stand behind
            the result.
          </p>

          <ul className="mt-8 space-y-2.5">
            {PROMISES.map((item) => (
              <li
                key={item}
                className="flex items-start gap-2.5 text-sm text-primary-foreground/85"
              >
                <Check className="mt-0.5 size-4 shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-primary-foreground/50">
          Bengaluru + remote · 36 hour build sprint
        </p>
      </div>

      <div className="flex items-center justify-center bg-background px-5 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Link to="/" className="flex items-center gap-2.5">
              <span className="flex size-8 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
                RJ
              </span>
              <span className="text-[0.9375rem] font-semibold tracking-[-0.02em]">
                RaptureJudge
              </span>
            </Link>
          </div>

          <h2 className="text-2xl font-semibold tracking-[-0.021em]">Sign in</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Use the email address your organizer issued to you.
          </p>

          <form
            className="mt-6 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void signInAs(email, password);
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@rapturejudge.io"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-md border border-destructive/25 bg-danger-soft px-3 py-2 text-xs text-danger-foreground"
              >
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={busy !== null}>
              {busy ? (
                <>
                  <Loader2 className="animate-spin" />
                  Signing in…
                </>
              ) : (
                <>
                  Sign in
                  <ArrowRight />
                </>
              )}
            </Button>
          </form>

          {/* Demo shortcuts: the point of v1 is proving the three role
              boundaries, so each one is one click away. */}
          <div className="mt-8">
            <div className="flex items-center gap-2">
              <span className="h-px flex-1 bg-border" />
              <span className="flex items-center gap-1.5 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
                <ShieldCheck className="size-3" />
                Demo accounts
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <p className="mt-3 text-xs text-muted-foreground">
              Shared password{" "}
              <code className="rounded bg-secondary px-1 py-0.5 font-medium text-secondary-foreground">
                {DEMO_PASSWORD}
              </code>
            </p>

            <div className="mt-3 space-y-2">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.role}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void signInAs(account.email, DEMO_PASSWORD)}
                  className="surface-flat group flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-muted disabled:opacity-50"
                >
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold",
                      ROLE_TONE[account.role],
                    )}
                  >
                    {ROLE_LABEL[account.role]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium leading-tight">
                      {account.name}
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                      {account.blurb}
                    </span>
                  </span>
                  {busy === account.email ? (
                    <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                  ) : (
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  )}
                </button>
              ))}
            </div>

            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              Each account lands in a different area. Role limits are enforced
              on the server, not just hidden in the interface.
            </p>
          </div>

          <p className="mt-8 text-center text-xs text-muted-foreground">
            <Link
              to="/"
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              Back to the home page
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
