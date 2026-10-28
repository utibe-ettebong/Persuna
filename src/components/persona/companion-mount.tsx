import { voiceMode } from "@/env";
import { companion } from "@/lib/persona/service";
import { Companion } from "./companion";

/** Loads the signed-in user's Persona and renders the companion. */
export async function CompanionMount({
  userId,
  userName,
  standalone = false,
  overlay = false,
}: {
  userId: string;
  userName?: string;
  standalone?: boolean;
  overlay?: boolean;
}) {
  const persona = await companion(userId);
  return (
    <Companion
      name={persona.profile.name}
      avatar={persona.profile.avatar}
      focus={persona.profile.focus}
      focusSkill={persona.focusSkill}
      setupDone={persona.profile.setupDone}
      wrapupDay={persona.profile.wrapupDay}
      skills={persona.skills}
      standalone={standalone}
      overlay={overlay}
      voiceMode={voiceMode()}
      userName={userName}
      messages={persona.messages.map((m) => ({
        id: m.id,
        role: m.role,
        kind: m.kind,
        content: m.content,
        jobId: m.jobId,
        switchTo: switchOffer(m.askedKey, persona.skills),
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
