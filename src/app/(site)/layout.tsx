import { SiteChrome } from "@/components/chrome/site-chrome";

/** Public pages: the landing page, downloads, public profiles and employer approval links. */
export default function SiteLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <SiteChrome>{children}</SiteChrome>;
}
