import { Link } from "wouter";
import { UserCircle } from "lucide-react";
import { AntiqLogo } from "@/components/antiq-logo";
import { useAuth } from "@/context/AuthContext";
import { MoreMenu } from './more-menu';
import { NotificationBell } from '@/features/notifications';

export function MobileHeader() {
  const { user, isAuthenticated } = useAuth();

  return (
    <header className="relative z-40 flex min-h-16 shrink-0 items-center border-b border-white/[0.15] bg-bg px-4 md:hidden mobile-navigation-header">
      <div className="mx-auto flex w-full items-center justify-between gap-4">
        <Link
          href="/explore"
          aria-label="go to explore"
          className="flex min-h-11 min-w-0 items-center gap-2 text-ink"
        >
          <AntiqLogo className="h-8 w-5" imageScaleClass="h-[272%] w-auto" />
          <span className="font-display text-lg font-bold tracking-tight">nebula</span>
        </Link>

        <div className="flex min-w-0 items-center gap-2"><NotificationBell />
        {isAuthenticated && user ? (
          <Link
            href="/profile"
            aria-label="open your profile"
            className="flex min-h-11 min-w-11 items-center gap-2 text-muted transition-colors hover:text-ink"
          >
            <span className="max-w-[4rem] truncate text-right text-[10px] voice">{user.name}</span>
            <UserCircle className="h-5 w-5 shrink-0" strokeWidth={1.5} />
          </Link>
        ) : (
          <>
          <Link
            href="/login"
            className="flex min-h-11 min-w-11 items-center gap-2 text-muted transition-colors hover:text-ink"
          >
            <span className="text-[10px] voice">log in</span>
            <UserCircle className="h-5 w-5 shrink-0" strokeWidth={1.5} />
          </Link>
          <Link href="/register" className="flex min-h-11 items-center text-[10px] voice text-ink">sign up</Link>
          </>
        )}
        <MoreMenu />
        </div>
      </div>
    </header>
  );
}
