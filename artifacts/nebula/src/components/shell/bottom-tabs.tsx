import { Link, useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { Home, Search, HeartHandshake, UserCircle } from "lucide-react";

const TABS = [
  { href: "/explore", label: "explore", match: (p: string) => p === "/explore" || p === "/", icon: Home },
  { href: "/search", label: "search", match: (p: string) => p.startsWith("/search"), icon: Search },
  { href: "/pledges", label: "pledges", match: (p: string) => p.startsWith("/pledges"), icon: HeartHandshake },
  { href: "/profile", label: "profile", match: (p: string) => p.startsWith("/profile"), authOnly: true, icon: UserCircle },
];

export function BottomTabs() {
  const [location] = useLocation();
  const { isAuthenticated } = useAuth();

  const tabs = TABS.filter((tab) => !tab.authOnly || isAuthenticated);

  return (
    <nav className="pointer-events-auto fixed inset-x-0 bottom-10 z-40 border-t border-white/[0.15] bg-black px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-2 lg:hidden">
      <div className="flex h-14 items-stretch overflow-hidden">
        {tabs.map((tab) => {
          const active = tab.match(location);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
                aria-label={tab.label}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-1 items-center justify-center transition-colors ${
                  active ? "text-ink" : "text-muted"
              }`}
            >
              <Icon className="h-6 w-6" strokeWidth={1.75} />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
