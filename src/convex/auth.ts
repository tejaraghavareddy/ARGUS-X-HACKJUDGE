// THIS FILE IS READ ONLY. Do not touch this file unless you are correctly adding a new auth provider in accordance to the vly auth documentation

import { convexAuth } from "@convex-dev/auth/server";
import { Anonymous } from "@convex-dev/auth/providers/Anonymous";
import { Password } from "@convex-dev/auth/providers/Password";
import { emailOtp } from "./auth/emailOtp";
import { hashSecret, verifySecret } from "./lib/password";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    emailOtp,
    Anonymous,
    // RaptureJudge judges and admins are provisioned by the organizers, not
    // self-served, so they sign in with an email + password issued with their
    // invite. `crypto` is supplied so the seeder (src/convex/seed.ts) can hash
    // demo passwords with the identical implementation and have them verify
    // against a real sign-in.
    Password({
      id: "password",
      crypto: { hashSecret, verifySecret },
    }),
  ],
});