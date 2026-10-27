import Link from "next/link";

/** The PERSUNA mark: an outlined frame with a filled offset square, a method and its copy. */
export function Mark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="none">
      <rect x="2.75" y="2.75" width="13.5" height="13.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="8" y="8" width="14" height="14" fill="currentColor" />
    </svg>
  );
}

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 text-foreground" aria-label="PERSUNA home">
      <Mark />
      <span className="font-display text-[1.15rem] font-semibold tracking-[-0.02em]">Persuna</span>
    </Link>
  );
}

/** "[01] FEATURES": the numbered mono eyebrow that opens a section. */
export function SectionLabel({ index, children }: { index?: string; children: React.ReactNode }) {
  return (
    <p className="label-mono text-foreground">
      {index && <span className="mr-2 text-faint">[{index}]</span>}
      {children}
    </p>
  );
}

/** A full-width band with the page frame's side rules continued through it. */
export function Frame({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`mx-auto w-full max-w-6xl border-x border-line ${className}`}>{children}</div>
  );
}

export function HatchStrip({ className = "h-6" }: { className?: string }) {
  return <div aria-hidden className={`hatch border-y border-line ${className}`} />;
}
