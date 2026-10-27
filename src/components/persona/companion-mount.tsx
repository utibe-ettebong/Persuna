import { companion } from "@/lib/persona/service";
import { Companion } from "./companion";

/** Loads the signed-in user's Persona and renders the companion. */
export async function CompanionMount({
  userId,
  standalone = false,
}: {
  userId: string;
  standalone?: boolean;
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
      messages={persona.messages.map((m) => ({
        id: m.id,
        role: m.role,
        kind: m.kind,
        content: m.content,
        jobId: m.jobId,
      }))}
    />
  );
}
