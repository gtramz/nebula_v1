import { useLayoutEffect, useRef } from 'react';

const guards = new Set<() => string | null>();
function mayLeave() {
  for (const guard of guards) { const message = guard(); if (message && !window.confirm(message)) return false; }
  return true;
}
const indexKey = '__nebulaNavigationIndex';

/** Protect SPA links/programmatic navigation and same-document browser Back/Forward. */
export function useNavigationSafety() {
  useLayoutEffect(() => {
    const push = history.pushState, replace = history.replaceState;
    const scrollRestoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    let currentIndex = Number(history.state?.[indexKey] ?? 0), restoring = false;
    let approved: { href: string; until: number } | null = null, nativeApproved = false;
    const check = (href: string) => {
      if (approved?.href === href && approved.until > Date.now()) { approved = null; return true; }
      approved = null; return mayLeave();
    };
    replace.call(history, { ...history.state, [indexKey]: currentIndex }, '');
    history.pushState = function (data, unused, url) {
      const destination = new URL(String(url ?? location.href), location.href);
      if (destination.href !== location.href && !check(destination.href)) return;
      const nextIndex = currentIndex + 1;
      push.call(this, { ...data, [indexKey]: nextIndex }, unused, url); currentIndex = nextIndex;
    };
    history.replaceState = function (data, unused, url) {
      if (url && new URL(String(url), location.href).href !== location.href && !check(new URL(String(url), location.href).href)) return;
      replace.call(this, { ...data, [indexKey]: currentIndex }, unused, url);
    };
    const pop = (event: PopStateEvent) => {
      const nextIndex = event.state?.[indexKey];
      if (restoring) { restoring = false; event.stopImmediatePropagation(); return; }
      if (typeof nextIndex === 'number' && nextIndex !== currentIndex && !mayLeave()) {
        event.stopImmediatePropagation(); restoring = true; history.go(currentIndex - nextIndex); return;
      }
      if (typeof nextIndex === 'number') currentIndex = nextIndex;
    };
    const unload = (event: BeforeUnloadEvent) => {
      if (nativeApproved) { nativeApproved = false; return; }
      if ([...guards].some(guard => guard())) { event.preventDefault(); event.returnValue = ''; }
    };
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
      if (!link || link.download || (link.target && link.target !== '_self') || link.href === location.href || new URL(link.href).origin !== location.origin) return;
      approved = null; nativeApproved = false;
      if (![...guards].some(guard => guard())) return;
      // Confirm before a link handler marks a notification read or closes a panel.
      if (!mayLeave()) { event.preventDefault(); event.stopImmediatePropagation(); }
      else { approved = { href: link.href, until: Date.now() + 30_000 }; queueMicrotask(() => { nativeApproved = !event.defaultPrevented; }); }
    };
    window.addEventListener('popstate', pop, true); window.addEventListener('beforeunload', unload);
    document.addEventListener('click', click, true);
    return () => { history.pushState = push; history.replaceState = replace; history.scrollRestoration = scrollRestoration; window.removeEventListener('popstate', pop, true); window.removeEventListener('beforeunload', unload); document.removeEventListener('click', click, true); };
  }, []);
}

export function useLeaveGuard(message: string | null) {
  const current = useRef(message); current.current = message;
  useLayoutEffect(() => { const guard = () => current.current; guards.add(guard); return () => { guards.delete(guard); }; }, []);
  // Successful saves can allow their own redirect before the next React render.
  return () => { current.current = null; };
}
