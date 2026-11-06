import { Link } from "wouter";
import { UserCircle } from "lucide-react";
import { AntiqLogo } from "@/components/antiq-logo";
import { useAuth } from "@/context/AuthContext";

export function MobileHeader() {
  const { user, isAuthenticated } = useAuth();

  return (
    <header className="relative z-40 flex h-16 shrink-0 items-center border-b border-white/[0.15] bg-bg px-6 lg:hidden">
      <div className="mx-auto flex w-full items-center justify-between gap-4">
        <Link
          href="/explore"
          aria-label="go to explore"
          className="flex min-w-0 items-center gap-2 text-ink"
        >
          <AntiqLogo className="h-8 w-5" imageScaleClass="h-[272%] w-auto" />
          <span className="font-display text-lg font-bold tracking-tight">nebula</span>
        </Link>

        {isAuthenticated && user ? (
          <Link
            href="/profile"
            aria-label="open your profile"
            className="flex min-w-0 items-center gap-2 text-muted transition-colors hover:text-ink"
          >
            <span className="max-w-[9rem] truncate text-right text-[10px] voice">{user.name}</span>
            <UserCircle className="h-5 w-5 shrink-0" strokeWidth={1.5} />
          </Link>
        ) : (
          <Link
            href="/login"
            className="flex items-center gap-2 text-muted transition-colors hover:text-ink"
          >
            <span className="text-[10px] voice">log in</span>
            <UserCircle className="h-5 w-5 shrink-0" strokeWidth={1.5} />
          </Link>
        )}
      </div>
    </header>
  );
}
