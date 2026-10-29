import type { Metadata } from "next";
import Link from "next/link";
import { acceptInviteAction } from "@/app/actions/teams";
import { ActionForm } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { orNotFound } from "@/lib/load";
import { inviteForJoinPage } from "@/lib/teams/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Join your team", robots: { index: false } };

type Props = { params: Promise<{ token: string }> };

/** An invitation link. It needs sign-in, with the email address it was sent to. */
export default async function JoinPage({ params }: Props) {
  const { token } = await params;
  const user = await requireUser(`/team/join/${token}`);
  const invite = await orNotFound(() => inviteForJoinPage(token, user));

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        eyebrow="Invitation"
        title={`Join ${invite.org}`}
        description={
          invite.role
            ? `You've been invited to ${invite.org} as ${invite.role}.${invite.onboard ? " Persuna will take you through how the job is done there." : ""}`
            : `You've been invited to ${invite.org}.`
        }
      />
      <Card className="p-5">
        {invite.allowed.ok ? (
          <ActionForm
            action={acceptInviteAction}
            label={`Join ${invite.org}`}
            pendingLabel={invite.onboard ? "Joining and preparing your onboarding…" : "Joining…"}
          >
            <input type="hidden" name="token" value={token} />
            <p className="mb-4 text-sm text-muted">
              What you learn about {invite.org} and the skills you attach to your role there stay
              confidential to {invite.org}. Your other skills stay yours.
            </p>
          </ActionForm>
        ) : (
          <div className="space-y-2 text-sm">
            <p role="alert" className="text-danger">
              {invite.allowed.reason}
            </p>
            <p className="text-muted">
              You&apos;re signed in as {user.email}.{" "}
              <Link href="/team" className="underline">
                Go to Team
              </Link>
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
