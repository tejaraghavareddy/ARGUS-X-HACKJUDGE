import { query } from "./_generated/server";
import { getSessionUser } from "./lib/authorization";

/**
 * The signed-in user's app identity.
 *
 * `role` is nullable: a user with no role is authenticated but has no granted
 * access, and the client sends them to a "no role" screen rather than guessing.
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getSessionUser(ctx);
    if (!user) return null;

    return {
      id: user._id,
      name: user.name ?? "Unnamed user",
      email: user.email ?? "",
      role: user.role ?? null,
      title: user.title ?? null,
      organization: user.organization ?? null,
      image: user.image ?? null,
    };
  },
});
