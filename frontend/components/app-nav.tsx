"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["/", "Workspace"],
  ["/catalog", "Programme"],
  ["/coding", "Coding"],
  ["/timeline", "Timeline"],
  ["/suggestions", "Suggestions"],
  ["/understanding", "Understanding"],
  ["/intelligence", "Intelligence"],
  ["/system", "System"],
] as const;

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="site-nav sticky top-0 z-50">
      <div className="mx-auto flex max-w-[1500px] items-center gap-6 px-5 py-3 lg:px-8">
        <Link href="/" className="brand-lockup shrink-0" aria-label="Rugby Video Analysis home">
          <span className="brand-mark" aria-hidden="true">
            <span className="brand-seam" />
          </span>
          <span className="hidden sm:block">
            <span className="block text-sm font-black tracking-[-0.02em] text-white">Rugby Video Analysis</span>
            <span className="block text-[9px] font-bold uppercase tracking-[0.2em] text-white/55">Performance intelligence</span>
          </span>
        </Link>

        <div className="hidden h-7 w-px shrink-0 bg-white/15 md:block" />

        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1">
          {links.map(([href, label]) => {
            const active = href === "/" ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`nav-link shrink-0 ${active ? "nav-link-active" : ""}`}
              >
                {label}
              </Link>
            );
          })}
        </div>

        <div className="hidden shrink-0 items-center gap-2 lg:flex">
          <span className="status-pill"><span className="status-dot" /> Phase 1 live</span>
          <Link href="/coding" className="nav-cta">Open analysis</Link>
        </div>
      </div>
    </nav>
  );
}
