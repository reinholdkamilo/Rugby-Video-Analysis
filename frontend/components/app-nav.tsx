"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["/", "Home"],
  ["/library", "Library"],
  ["/upload", "Upload"],
  ["/coding", "Coding"],
  ["/video-analysis", "Video Analysis"],
  ["/reports", "Reports"],
  ["/evidence", "Evidence"],
  ["/intelligence", "Intelligence"],
] as const;

export function AppNav() {
  const pathname = usePathname();
  if (pathname.startsWith("/video-analysis")) return null;

  return (
    <>
      <div className="product-strip">
        <div className="site-container product-strip__inner">
          <span>Professional rugby performance analysis</span>
          <div className="product-strip__status"><span /> Phase 1 live</div>
        </div>
      </div>
      <nav className="site-nav">
        <div className="site-container site-nav__inner">
          <Link href="/" className="brand-lockup" aria-label="Rugby Video Analysis home">
            <span className="brand-mark">R</span>
            <span>
              <strong>Rugby Video Analysis</strong>
              <small>Performance intelligence</small>
            </span>
          </Link>

          <div className="site-nav__links">
            {links.map(([href, label]) => {
              const active = href === "/" ? pathname === href : pathname.startsWith(href);
              return (
                <Link key={href} href={href} className={active ? "is-active" : ""}>
                  {label}
                </Link>
              );
            })}
          </div>

          <Link href="/upload" className="nav-cta">Upload match</Link>
        </div>
      </nav>
    </>
  );
}
