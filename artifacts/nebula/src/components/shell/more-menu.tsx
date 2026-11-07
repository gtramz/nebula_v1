import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Menu } from 'lucide-react';
import { isServerMode, useResetPreview } from '@nebula/local';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';

export function MoreMenu({ sidebar = false }: { sidebar?: boolean }) {
  const reset = useResetPreview(), [location, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [location]);
  useEffect(() => { const close = () => setOpen(false); window.addEventListener('resize', close); return () => window.removeEventListener('resize', close); }, []);
  return <DropdownMenu open={open} onOpenChange={setOpen}>
    <DropdownMenuTrigger asChild><button type="button" aria-label="More" title="More" className={sidebar ? 'sidebar-link text-muted hover:text-ink' : 'flex min-h-11 min-w-11 items-center justify-center text-muted hover:text-ink'}>
      <span className={sidebar ? 'nav-icon' : ''}><Menu aria-hidden size={24} /></span>{sidebar && <span className="sidebar-label text-sm">More</span>}
    </button></DropdownMenuTrigger>
    <DropdownMenuContent side={sidebar ? 'right' : 'bottom'} align="end" collisionPadding={16} className="z-[70] w-64 max-w-[calc(100vw-32px)] p-2">
      <DropdownMenuItem asChild className="min-h-11 focus:text-bg"><Link href="/">home</Link></DropdownMenuItem>
      <DropdownMenuItem asChild className="min-h-11 focus:text-bg"><Link href="/explore">explore</Link></DropdownMenuItem>
      {!isServerMode() && <DropdownMenuItem disabled={reset.isPending} className="min-h-11 focus:text-bg" onSelect={event => {
        event.preventDefault();
        if (window.confirm('Clear projects, pledges and supports in this browser? Accounts and artist profiles will be kept. This affects all tabs.')) {
          reset.mutate(undefined, { onSuccess: () => { setOpen(false); navigate('/'); } });
        }
      }}>clear demo data</DropdownMenuItem>}
      {reset.error && <p role="alert" className="p-2 text-xs text-danger">{reset.error.message}</p>}
      <DropdownMenuSeparator />
      <div className="space-y-2 p-2 text-[10px] text-muted"><p>© 2026 manuellcossio</p><p>{isServerMode() ? 'local server · persistent storage' : 'local preview · saved in this browser'}</p></div>
    </DropdownMenuContent>
  </DropdownMenu>;
}
