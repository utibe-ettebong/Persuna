import { ownedSkillBySlug } from "@/lib/auth/access";
import { requireUser } from "@/lib/auth/session";
import { orNotFound } from "@/lib/load";

/** Every page under a skill belongs to its owner (or an admin). */
export default async function SkillLayout({
  params,
  children,
}: {
  params: Promise<{ slug: string }>;
  children: React.ReactNode;
}) {
  const { slug } = await params;
  const user = await requireUser(`/skills/${slug}`);
  await orNotFound(() => ownedSkillBySlug(user, slug));
  return children;
}
