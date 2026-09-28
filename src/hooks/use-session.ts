import { api } from "@/convex/_generated/api";
import { useConvexAuth, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";

/**
 * The signed-in session: identity, role and sign-out.
 *
 * `user` is `undefined` while Convex is still resolving, and `null` when
 * signed out — callers must distinguish those two, which is why the loading
 * flag is derived rather than tracked separately.
 */
export function useSession() {
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth();
  const user = useQuery(api.session.me);
  const { signOut } = useAuthActions();

  const isLoading = authLoading || user === undefined;

  return {
    isLoading,
    isAuthenticated,
    user: user ?? null,
    role: user?.role ?? null,
    signOut,
  };
}
