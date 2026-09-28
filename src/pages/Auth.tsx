import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useAuthActions } from "@convex-dev/auth/react";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";
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

interface AuthProps {
  redirectAfterAuth?: string;
}

function resolveRedirect(returnTo: string | null, fallback: string) {
  if (returnTo?.startsWith("/") && !returnTo.startsWith("//")) return returnTo;
  return fallback;
}

const ROLE_BLOCK: Record<AppRole, string> = {
  admin: "bg-[#d8382a] text-white",
  judge: "bg-[#2b6be4] text-white",
  participant: "bg-[#ffe500] text-ink",
};

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
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel — flat colour blocks, no gradients or glass. */}
      <div className="flex flex-col justify-between border-b-2 border-ink bg-ink p-8 text-white lg:border-b-0 lg:border-r-2 lg:p-12">
        <Link to="/" className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center border-2 border-white bg-[#ffe500] text-base font-black text-ink">
            RJ
          </span>
          <span className="text-lg font-black tracking-tight">RaptureJudge</span>
        </Link>

        <div className="py-12 lg:py-0">
          <h1 className="max-w-lg text-4xl font-black leading-[1.05] tracking-tight lg:text-5xl">
            Judging you can
            <br />
            actually defend.
          </h1>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-white/80">
            Submission tracking, weighted scorecards and a complete audit trail
            for every judge decision. AI briefs the judge; it never makes the
            call.
          </p>

          <div className="mt-8 flex flex-wrap gap-2">
            {["Weighted rubric", "Per-judge isolation", "Locked scorecards"].map(
              (chip) => (
                <span
                  key={chip}
                  className="border-2 border-white px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider"
                >
                  {chip}
                </span>
              ),
            )}
          </div>
        </div>

        <p className="text-[11px] font-bold uppercase tracking-widest text-white/50">
          Rapture 2026 · Bengaluru + remote
        </p>
      </div>

      <div className="flex items-center justify-center p-6 lg:p-12">
        <div className="w-full max-w-md">
          <div className="nb-card p-7">
            <h2 className="text-2xl font-black tracking-tight">Sign in</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Use the email your organizer issued to you.
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
                <p className="border-2 border-ink bg-[#d8382a] px-3 py-2 text-xs font-semibold text-white">
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
          </div>

          {/* Demo shortcuts: the whole point of v1 is proving the three role
              boundaries, so each one is one click away. */}
          <div className="nb-inset mt-5 p-5">
            <p className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest">
              <ShieldCheck className="size-3.5" />
              Demo accounts · password {DEMO_PASSWORD}
            </p>
            <div className="mt-3 space-y-2">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.role}
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void signInAs(account.email, DEMO_PASSWORD)}
                  className="nb-press flex w-full items-center gap-3 border-2 border-ink bg-surface p-3 text-left disabled:opacity-50"
                >
                  <span
                    className={`flex shrink-0 items-center border-2 border-ink px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${ROLE_BLOCK[account.role]}`}
                  >
                    {ROLE_LABEL[account.role]}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold leading-tight">
                      {account.name}
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                      {account.blurb}
                    </span>
                  </span>
                  {busy === account.email ? (
                    <Loader2 className="size-4 shrink-0 animate-spin" />
                  ) : (
                    <ArrowRight className="size-4 shrink-0" />
                  )}
                </button>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
              Each account lands in a different area. Role limits are enforced
              on the server, not just hidden in the interface.
            </p>
          </div>

          <p className="mt-5 text-center text-xs text-muted-foreground">
            <Link to="/" className="underline underline-offset-4 hover:text-ink">
              Back to the home page
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
