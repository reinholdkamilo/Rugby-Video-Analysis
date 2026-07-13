"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["/", "Workspace", "01"],
  ["/catalog", "Programme", "02"],
  ["/coding", "Coding", "03"],
  ["/timeline", "Timeline", "04"],
  ["/suggestions", "Suggestions", "05"],
  ["/understanding", "Understanding", "06"],
  ["/intelligence", "Intelligence", "07"],
  ["/system", "System", "08"],
] as const;

export function AppNav() {
  const pathname = usePathname();
  return (
    <nav className="sticky top-0 z-50 border-b border-slate-800 bg-white/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1440px] items-center gap-5 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-3 rounded-xl pr-2" aria-label="Rugby Video Analysis home">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-400 text-sm font-black text-white shadow-lg">RVA</span>
          <span className="hidden sm:block">
            <span className="block text-sm font-extrabold tracking-tight text-slate-950">Rugby Video Analysis</span>
            <span className="block text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Performance intelligence</span>
          </span>
        </Link>

        <div className="h-8 w-px shrink-0 bg-slate-800" />

        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1">
          {links.map(([href, label, step]) => {
            const active = href === "/" ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`group flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  active
                    ? "bg-emerald-400 text-white shadow-md"
                    : "text-slate-500 hover:bg-slate-800 hover:text-slate-950"
                }`}
              >
                <span className={`text-[10px] font-black ${active ? "text-white/70" : "text-slate-500"}`}>{step}</span>
                {label}
              </Link>
            );
          })}
        </div>

        <div className="hidden shrink-0 items-center gap-2 rounded-full border border-slate-800 bg-white px-3 py-2 text-xs font-semibold text-slate-500 lg:flex">
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
          Phase 1
        </div>
      </div>
    </nav>
  );
}
