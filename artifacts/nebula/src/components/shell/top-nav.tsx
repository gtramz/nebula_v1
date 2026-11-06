import { Link, useLocation } from "wouter";
import { AntiqLogo } from "@/components/antiq-logo";
import { useAuth } from "@/context/AuthContext";

const LINKS = [
  { href: "/explore", label: "explore", match: (p: string) => p === "/explore" || p === "/" },
  { href: "/search", label: "search", match: (p: string) => p.startsWith("/search") },
  { href: "/pledges", label: "pledges", match: (p: string) => p.startsWith("/pledges") },
  { href: "/profile", label: "profile", match: (p: string) => p.startsWith("/profile"), authOnly: true },
];

export function TopNav() {
  const [location] = useLocation();
  const { user, isAuthenticated } = useAuth();

  return (
    <header className="relative z-40 hidden shrink-0 border-b border-white/[0.15] bg-bg lg:block">
      <div className="mx-auto flex h-20 w-full max-w-5xl items-center justify-between gap-8 px-8">
        <Link href="/explore" className="flex items-center gap-3 shrink-0 text-ink font-display text-xl font-bold tracking-tight">
          <AntiqLogo className="h-9 w-6" imageScaleClass="h-[272%] w-auto" />
          nebula
        </Link>
        <nav className="flex items-center gap-1">
          {LINKS.filter((link) => !link.authOnly || isAuthenticated).map((link) => {
            const active = link.match(location);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`voice px-4 py-2 text-[11px] transition ${
                  active
                    ? "text-ink border-b border-ink"
                    : "text-muted hover:text-ink"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          {isAuthenticated && user ? (
               <span className="voice truncate text-[10px] text-muted">
                {user.name}
            </span>
          ) : (
            <>
                <Link href="/login" className="voice px-4 py-2 text-[11px] text-muted hover:text-ink">
                log in
              </Link>
              <Link href="/register" className="voice rounded-full bg-cream px-4 py-2 text-[11px] font-semibold tracking-[0.06em] text-bg">
                sign up
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
