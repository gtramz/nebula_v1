import { Link, useLocation } from 'wouter';
import { MessageCircle, Compass, Home, Search, HeartHandshake, UserCircle, LogIn, UserPlus, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { AntiqLogo } from '@/components/antiq-logo';
import { NotificationBell } from '@/features/notifications';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MoreMenu } from './more-menu';
import { projectDestination } from './project-destination';

const routes = [
  { href: '/discovery', label: 'discovery', icon: Compass, match: (path: string) => path === '/discovery' },
  { href: '/explore', label: 'explore', icon: Home, match: (path: string) => path === '/explore' || path === '/' },
  { href: '/search', label: 'search', icon: Search, match: (path: string) => path.startsWith('/search') },
  { href: '/pledges', label: 'pledges', icon: HeartHandshake, authOnly: true, match: (path: string) => path.startsWith('/pledges') || path.startsWith('/received') },
  { href: '/messages', label: 'messages', icon: MessageCircle, artistOnly: true, match: (path: string) => path.startsWith('/messages') || path.startsWith('/collaborations') },
  { href: '/profile', label: 'profile', icon: UserCircle, authOnly: true, match: (path: string) => path.startsWith('/profile') },
];

export function Navigation({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const [location] = useLocation();
  const { user, isAuthenticated } = useAuth();
  const isMobile = useIsMobile();
  const receivedInProfile = isMobile && user?.role === 'artist' && location.startsWith('/received');
  return <div className="app-navigation fixed inset-x-0 bottom-0 z-40 bg-bg border-t border-border md:inset-x-auto md:left-0 md:top-0 md:border-t-0 md:border-r" data-testid="app-navigation">
    <div className="hidden md:flex flex-col gap-4 mb-6">
      <Link href="/explore" aria-label={`go to ${projectDestination(user?.role).toLowerCase()}`} className="sidebar-link text-ink font-display text-xl font-bold">
        <span className="nav-icon"><AntiqLogo className="h-9 w-6" imageScaleClass="h-[272%] w-auto" /></span><span className="sidebar-label">nebula</span>
      </Link>
      <div className="hidden lg:block"><button type="button" aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'} aria-expanded={expanded} aria-controls="primary-navigation" onClick={onToggle} className="sidebar-link text-muted hover:text-ink" title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}>
        <span className="nav-icon">{expanded ? <PanelLeftClose aria-hidden size={22} /> : <PanelLeftOpen aria-hidden size={22} />}</span><span className="sidebar-label text-sm">Collapse</span>
      </button></div>
    </div>
    <nav id="primary-navigation" aria-label="Primary navigation" className="primary-navigation flex items-stretch md:flex-col md:gap-2">
      {routes.filter(route => (!route.authOnly || isAuthenticated) && (!route.artistOnly || user?.role === "artist")).map(route => {
        const received = route.href === '/pledges' && user?.role === 'artist';
        const label = received ? 'received' : route.href === '/explore' ? projectDestination(user?.role).toLowerCase() : route.label, href = received ? '/received' : route.href;
        const active = receivedInProfile ? route.href === '/profile' : route.match(location);
        return <Tooltip key={route.href}><TooltipTrigger asChild>
          <Link href={href} aria-label={label} aria-current={active ? 'page' : undefined} data-mobile-hidden={received || undefined} className="sidebar-link primary-link text-muted hover:text-ink">
            <span className="nav-icon"><route.icon aria-hidden className="h-6 w-6" strokeWidth={1.75} /></span><span className="sidebar-label voice text-xs">{label}</span>
          </Link>
        </TooltipTrigger><TooltipContent side="right" className="navigation-tooltip">{label}</TooltipContent></Tooltip>;
      })}
    </nav>
    <div className="hidden md:flex flex-col gap-2 mt-auto pt-6">
      <NotificationBell navigation />
      {isAuthenticated && user ? <p className="sidebar-label truncate px-3 voice text-[10px] text-muted" title={user.name}>{user.name}</p> : <>
        <Link href="/login" aria-label="log in" title="log in" className="sidebar-link text-muted hover:text-ink"><span className="nav-icon"><LogIn aria-hidden size={22} /></span><span className="sidebar-label text-sm">log in</span></Link>
        <Link href="/register" aria-label="sign up" title="sign up" className="sidebar-link text-ink"><span className="nav-icon"><UserPlus aria-hidden size={22} /></span><span className="sidebar-label text-sm">sign up</span></Link>
      </>}
      <MoreMenu sidebar />
    </div>
  </div>;
}
