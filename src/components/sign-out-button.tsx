"use client";

import { authClient } from "@/lib/auth/client";

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={async () => {
        await authClient.signOut();
        // A full page load drops pages cached while signed in.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- the full load is the point
        window.location.assign("/");
      }}
      className="label-mono whitespace-nowrap text-muted hover:text-foreground"
    >
      Sign out
    </button>
  );
}
