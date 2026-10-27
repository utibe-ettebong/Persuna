import Link from "next/link";
import { Logo } from "@/components/brand";
import { StudioNav } from "@/components/studio-nav";
import { modelProvider } from "@/env";

/** The signed-in studio: framed page, mono navigation, mock-model notice. */
export default function StudioLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const mock = modelProvider() === "mock";
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-line bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 border-x border-line px-4 sm:px-6">
          <div className="py-2.5">
            <Logo href="/skills" />
          </div>
          <nav
            aria-label="Studio"
            className="order-last -mx-4 w-[calc(100%+2rem)] overflow-x-auto border-t border-line px-1 sm:-mx-6 sm:w-[calc(100%+3rem)] lg:order-none lg:mx-0 lg:w-auto lg:flex-1 lg:border-t-0 lg:px-0"
          >
            <StudioNav />
          </nav>
          <div className="ml-auto flex items-center gap-3 py-2.5">
            {mock && (
              <span
                className="label-mono rounded-sm border border-warn/40 bg-warn/8 px-2 py-1 text-warn"
                title="No model API key is set. Drafts are rough and scores are text overlap. Set EXTRACT_API_KEY or MODEL_PROVIDER=live for real models."
              >
                Mock models
              </span>
            )}
            <Link
              href="/"
              className="label-mono whitespace-nowrap text-muted hover:text-foreground"
            >
              Site ↗
            </Link>
          </div>
        </div>
      </header>
      <div className="flex flex-1">
        <div aria-hidden className="hatch hidden flex-1 lg:block" />
        <main className="w-full max-w-6xl flex-1 border-x border-line bg-background px-4 py-10 sm:px-8 lg:flex-none">
          {children}
        </main>
        <div aria-hidden className="hatch hidden flex-1 lg:block" />
      </div>
    </>
  );
}
