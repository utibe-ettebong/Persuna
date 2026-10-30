import { voiceMode } from "@/env";
import { companion } from "@/lib/persuna/service";
import { Companion } from "./companion";

/** Loads the signed-in user's Persuna and renders the companion. */
export async function CompanionMount({
  userId,
  userName,
  standalone = false,
  overlay = false,
  build = null,
}: {
  userId: string;
  userName?: string;
  standalone?: boolean;
  overlay?: boolean;
  build?: string | null;
}) {
  const persuna = await companion(userId);
  return (
    <Companion
      name={persuna.profile.name}
      avatar={persuna.profile.avatar}
      focus={persuna.profile.focus}
      focusSkill={persuna.focusSkill}
      setupDone={persuna.profile.setupDone}
      wrapupDay={persuna.profile.wrapupDay}
      skills={persuna.skills}
      standalone={standalone}
      overlay={overlay}
      build={build}
      voiceMode={voiceMode()}
      userName={userName}
      messages={persuna.messages.map((m) => ({
        id: m.id,
        role: m.role,
        kind: m.kind,
        content: m.content,
        jobId: m.jobId,
        switchTo: switchOffer(m.askedKey, persuna.skills),
      }))}
    />
  );
}

/** A saved "switch to this skill?" question, so its buttons survive a reload. */
function switchOffer(askedKey: string | null, skills: { slug: string; name: string }[]) {
  if (!askedKey?.startsWith("switch:")) return null;
  const skill = skills.find((s) => s.slug === askedKey.slice("switch:".length));
  return skill ? { slug: skill.slug, name: skill.name } : null;
}
