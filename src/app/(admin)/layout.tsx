import { StudioChrome } from "@/components/chrome/studio-chrome";
import { requireAdmin } from "@/lib/auth/session";

/** The super admin console: platform management for ADMIN_EMAILS only. */
export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await requireAdmin();
  return <StudioChrome user={user}>{children}</StudioChrome>;
}
