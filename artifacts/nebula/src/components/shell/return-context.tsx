import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import { useLocation, useSearch } from 'wouter';
import { useNavigationSafety } from './navigation-guard';
import { useAuth } from '@/context/AuthContext';

type Position = { window: number; shell: number; page: number; focus?: string };
type Memory = { trail: string[]; positions: Map<string, Position>; values: Map<string, unknown> };
const Context = createContext<Memory | null>(null);
const empty = (): Memory => ({ trail: [], positions: new Map(), values: new Map() });

/** Per-account, in-memory UI context, never credentials, media or server records. */
export function ReturnContext({ children }: { children: ReactNode }) {
  useNavigationSafety();
  const { user } = useAuth();
  const identity = user ? `${user.role}:${user.artistId ?? user.investorId}` : 'guest';
  const memory = useMemo(empty, [identity]);
  const [path] = useLocation(), search = useSearch(), route = path + (search ? `?${search}` : '');
  const current = useRef(''), previousIndex = useRef<number>(Number(history.state?.__nebulaNavigationIndex ?? 0));
  if (current.current !== route || !memory.trail.length) {
    const index = Number(history.state?.__nebulaNavigationIndex ?? 0);
    const returning = history.state?.__nebulaReturn || index < previousIndex.current;
    const previous = returning ? memory.trail.lastIndexOf(route) : -1;
    const trail = !returning && index === previousIndex.current ? memory.trail.slice(0, -1) : memory.trail;
    memory.trail = previous >= 0 ? memory.trail.slice(0, previous + 1) : returning ? [route] : [...trail.slice(-49), route];
    previousIndex.current = index;
    current.current = route;
  }
  useLayoutEffect(() => {
    // Discovery owns its post identity and snap position, not pixel restoration.
    if (path === '/discovery') return;
    const saved = memory.positions.get(route);
    let restoring = !!saved, frame = 0;
    const shell = () => document.querySelector<HTMLElement>('.shell-page');
    const page = () => document.querySelector<HTMLElement>('[data-page-scroll]');
    const capture = (event: Event) => {
      if (restoring) return;
      // WebKit may blur a link on pointer activation before its click fires.
      const active = event.type === 'click' ? (event.target as Element).closest?.('a[href]') ?? document.activeElement : document.activeElement;
      memory.positions.set(route, { window: window.scrollY, shell: shell()?.scrollTop ?? 0, page: page()?.scrollTop ?? 0,
        focus: active instanceof HTMLAnchorElement && shell()?.contains(active) ? active.getAttribute('href') ?? undefined : memory.positions.get(route)?.focus });
    };
    const restore = () => {
      if (!restoring || !saved) return;
      window.scrollTo(0, saved.window);
      if (shell()) shell()!.scrollTop = saved.shell;
      if (page()) page()!.scrollTop = saved.page;
      const focused = saved.focus ? [...document.querySelectorAll<HTMLAnchorElement>('.shell-page a[href]')].find(a => a.getAttribute('href') === saved.focus) : null;
      if (Math.abs(window.scrollY - saved.window) < 2 && Math.abs((shell()?.scrollTop ?? 0) - saved.shell) < 2 && Math.abs((page()?.scrollTop ?? 0) - saved.page) < 2 && (!saved.focus || focused)) {
        focused?.focus({ preventScroll: true }); restoring = false; observer.disconnect();
      }
    };
    const observer = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(restore); });
    if (saved) { observer.observe(document.querySelector('.shell-page') ?? document.body, { childList: true, subtree: true }); frame = requestAnimationFrame(restore); }
    else { window.scrollTo(0, 0); if (shell()) shell()!.scrollTop = 0; }
    const stop = () => { restoring = false; observer.disconnect(); };
    const timeout = window.setTimeout(stop, 4000);
    document.addEventListener('scroll', capture, true);
    document.addEventListener('click', capture, true);
    document.addEventListener('wheel', stop, { passive: true });
    document.addEventListener('touchstart', stop, { passive: true });
    document.addEventListener('keydown', stop);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); clearTimeout(timeout); document.removeEventListener('scroll', capture, true); document.removeEventListener('click', capture, true); document.removeEventListener('wheel', stop); document.removeEventListener('touchstart', stop); document.removeEventListener('keydown', stop); };
  }, [route, memory, path]);
  return <Context.Provider value={memory}>{children}</Context.Provider>;
}

export function useReturnDestination(fallback: string) {
  const memory = useContext(Context);
  return memory && memory.trail.length > 1 ? memory.trail[memory.trail.length - 2] : fallback;
}

export function returnLabel(href: string) {
  const path = href.split('?')[0];
  const label = ({ '/explore': 'Explore', '/search': 'Search', '/discovery': 'Discovery', '/profile': 'profile', '/studio': 'studio', '/studio/remix': 'Remix studio', '/saved': 'saved publications', '/collaborations': 'collaborations', '/received': 'received pledges', '/pledges': 'pledges' } as Record<string, string>)[path]
    ?? (path.startsWith('/artist/') ? 'artist' : path.startsWith('/project/') ? 'project' : 'previous page');
  return `Back to ${label}`;
}

export function useViewState<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const memory = useContext(Context);
  const [value, setValue] = useState<T>(() => memory?.values.has(key) ? memory.values.get(key) as T : typeof initial === 'function' ? (initial as () => T)() : initial);
  const update: Dispatch<SetStateAction<T>> = next => setValue(previous => {
    const result = typeof next === 'function' ? (next as (previous: T) => T)(previous) : next;
    memory?.values.set(key, result); return result;
  });
  return [value, update];
}
