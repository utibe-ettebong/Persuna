import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { oneTimeToken } from "better-auth/plugins/one-time-token";
import { db, schema } from "@/db/client";
import { parseList, signUpAllowed } from "./policy";

/**
 * Accounts with email and password (Better Auth). Sessions live in Postgres;
 * Better Auth rate-limits sign-in attempts in production. Sign-ups can be
 * limited to listed emails or domains with AUTH_ALLOWED_EMAILS.
 */
function createAuth() {
  if (process.env.NODE_ENV === "production" && !process.env.BETTER_AUTH_SECRET) {
    throw new Error("BETTER_AUTH_SECRET must be set in production (openssl rand -base64 32)");
  }
  return betterAuth({
    appName: "PERSUNA",
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL ?? process.env.APP_URL,
    database: drizzleAdapter(db(), {
      provider: "pg",
      schema: {
        user: schema.authUsers,
        session: schema.authSessions,
        account: schema.authAccounts,
        verification: schema.authVerifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      autoSignIn: true,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 14,
      updateAge: 60 * 60 * 24,
    },
    telemetry: { enabled: false },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!signUpAllowed(user.email, parseList(process.env.AUTH_ALLOWED_EMAILS))) {
              throw new APIError("FORBIDDEN", {
                message: "Sign-ups are invite-only. Ask the owner to add your email.",
              });
            }
          },
        },
      },
    },
    plugins: [
      // Persuna Desktop signs in through the browser: the signed-in browser
      // makes a one-time token (server-side only, 3 minutes, stored hashed)
      // and the app trades it for its own session.
      oneTimeToken({ expiresIn: 3, disableClientRequest: true, storeToken: "hashed" }),
      // Must stay last: lets server actions set the session cookie.
      nextCookies(),
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as unknown as { persunaAuth?: Auth };

/** Created on first use, so builds don't need a database. */
export function auth(): Auth {
  globalForAuth.persunaAuth ??= createAuth();
  return globalForAuth.persunaAuth;
}
