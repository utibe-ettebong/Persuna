import { StudioChrome } from "@/components/chrome/studio-chrome";
import { requireUser } from "@/lib/auth/session";

/** The signed-in studio: framed page, mono navigation, mock-model notice. */
export default async function StudioLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();
  return <StudioChrome user={user}>{children}</StudioChrome>;
}
