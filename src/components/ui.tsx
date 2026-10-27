import Link from "next/link";

export type Variant = "primary" | "secondary" | "danger" | "accent";

const BUTTON_STYLES: Record<Variant, string> = {
  primary: "bg-ink text-ink-foreground border border-ink hover:bg-ink/85",
  accent: "bg-accent text-accent-ink border border-accent hover:bg-accent/90",
  secondary: "bg-card text-foreground border border-line-strong hover:border-foreground",
  danger: "bg-card text-danger border border-danger/50 hover:bg-danger/10",
};

/** Square, mono, uppercase: the one button style across site and studio. */
export function buttonClass(variant: Variant = "primary", size: "sm" | "md" = "sm") {
  const pad = size === "md" ? "px-5 py-3" : "px-3.5 py-2";
  return `label-mono inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md ${pad} transition-colors disabled:cursor-wait disabled:opacity-60 ${BUTTON_STYLES[variant]}`;
}

export function PageHeader({
  back,
  eyebrow,
  title,
  description,
  children,
}: {
  back?: { href: string; label: string };
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="label-mono text-muted hover:text-foreground">
            ← {back.label}
          </Link>
        )}
        {eyebrow && !back && <div className="label-mono text-faint">{eyebrow}</div>}
        <h1 className="mt-2 font-display text-3xl font-medium tracking-[-0.03em] sm:text-4xl">
          {title}
        </h1>
        {description && (
          <div className="mt-2 max-w-2xl text-[0.95rem] leading-relaxed text-muted">
            {description}
          </div>
        )}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </header>
  );
}

export function Card({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={`rounded-md border border-line bg-card ${className}`}>{children}</div>;
}

export type Tone = "neutral" | "good" | "warn" | "danger" | "accent";

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  const tones: Record<Tone, string> = {
    neutral: "border-line-strong text-muted bg-card",
    good: "border-good/40 text-good bg-good/8",
    warn: "border-warn/40 text-warn bg-warn/8",
    danger: "border-danger/40 text-danger bg-danger/8",
    accent: "border-accent/50 text-accent bg-accent-soft",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[0.7rem] uppercase leading-4 tracking-[0.06em] ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export const inputClass =
  "mt-1.5 w-full rounded-md border border-line-strong bg-card px-3 py-2 text-sm placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="font-medium">{label}</span>
      {hint && <span className="ml-2 text-faint">{hint}</span>}
      {children}
    </label>
  );
}

export function Prose({ children }: { children: string }) {
  return (
    <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
      {children}
    </pre>
  );
}

/** Mono heading used inside cards and panels. */
export function PanelTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="label-mono mb-3 text-muted">{children}</h2>;
}

export function SkillTabs({ slug, active }: { slug: string; active: string }) {
  const tabs = [
    { href: `/skills/${slug}`, label: "Overview" },
    { href: `/skills/${slug}/interview`, label: "Interview" },
    { href: `/skills/${slug}/examples`, label: "Examples" },
    { href: `/skills/${slug}/rules`, label: "Edit rules" },
    { href: `/skills/${slug}/trust`, label: "Trust" },
    { href: `/skills/${slug}/listing`, label: "Listing" },
    { href: `/skills/${slug}/activity`, label: "Activity" },
  ];
  return (
    <nav
      className="-mx-4 flex overflow-x-auto overflow-y-hidden border-y border-line sm:-mx-8"
      aria-label="Skill"
    >
      {tabs.map((t) => {
        const current = t.label === active;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={current ? "page" : undefined}
            className={`label-mono whitespace-nowrap border-r border-line px-4 py-3 transition-colors ${
              current
                ? "bg-card text-accent shadow-[inset_0_-2px_0_var(--accent)]"
                : "text-muted hover:bg-card hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
      <div aria-hidden className="hatch min-w-6 flex-1" />
    </nav>
  );
}
