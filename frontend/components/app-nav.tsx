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
    <nav className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-2 overflow-x-auto px-4 py-3 sm:px-6">
        <span className="mr-3 shrink-0 text-xs font-black uppercase tracking-[0.2em] text-emerald-400">Rugby VA</span>
        {links.map(([href, label]) => {
          const active = href === "/" ? pathname === href : pathname.startsWith(href);
          return (
            <Link key={href} href={href} className={`shrink-0 rounded-lg px-3 py-2 text-sm font-semibold transition ${active ? "bg-emerald-400 text-slate-950" : "text-slate-300 hover:bg-slate-800 hover:text-white"}`}>
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
