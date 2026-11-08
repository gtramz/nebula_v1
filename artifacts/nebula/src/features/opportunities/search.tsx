import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Search, X, ArrowUpRight } from 'lucide-react';
import { apiRequest, homeSearchParams, readHomeHistory, rememberHomeSearch, writeHomeHistory, normalizeHomeSearch, emptyHomeFilters, addHomeCriterion, homeFilterEntries, facetLabels, facetValueLabel, type HomeFilters, type HomeMode, type HomeSearch, type HomeSuggestion } from '@nebula/local';
import { controlStyles } from '@/components/antiq/workspace';
import { useViewState } from '@/components/shell/return-context';

const storage = () => { try { return window.localStorage; } catch { return undefined; } };
const describe = (value: HomeSearch) => [value.q, ...homeFilterEntries(normalizeHomeSearch(value).filters).map(({field,value}) => `${facetLabels[field]}: ${facetValueLabel(field,value)}`)].filter(Boolean).join(' · ');
export function useHomeSearch(identity: string) {
  const [search, setSearch] = useViewState<HomeSearch>('home-search', { q: '', criteria: {}, filters: emptyHomeFilters() });
  const [settled, setSettled] = useState(search);
  const [composing, setComposing] = useState(false);
  const [history, setHistory] = useState(() => readHomeHistory(identity, storage()));
  const ready = !composing && JSON.stringify(search) === JSON.stringify(settled);
  useEffect(() => {
    if (composing) return;
    const timeout = window.setTimeout(() => setSettled(search), 300);
    return () => window.clearTimeout(timeout);
  }, [search, composing]);
  useEffect(() => { const refresh = () => setHistory(readHomeHistory(identity, storage())); window.addEventListener('storage', refresh); return () => window.removeEventListener('storage', refresh); }, [identity]);
  const apply = (value: HomeSearch) => { const next = normalizeHomeSearch(value); setSearch(next); setSettled(next); };
  const confirm = (next = search) => { const normalized = normalizeHomeSearch(next); apply(normalized); setHistory(rememberHomeSearch(identity, normalized, storage())); };
  const clear = () => { setComposing(false); apply({ ...search, q: '' }); };
  const applyFilters = (filters: HomeFilters) => apply({ q: search.q, criteria: {}, filters });
  const restore = (entry: HomeSearch) => confirm(entry.filters ? entry : normalizeHomeSearch({ ...entry, filters: normalizeHomeSearch(search).filters }));
  const removeHistory = (index: number) => setHistory(previous => writeHomeHistory(identity, previous.filter((_, i) => i !== index), storage()));
  const clearHistory = () => setHistory(writeHomeHistory(identity, [], storage()));
  return { identity, search, setSearch, settled, ready, composing, setComposing, history, confirm, clear, applyFilters, restore, removeHistory, clearHistory };
}
export function HomeSearchControl({ model, category = 'all', mode = 'for-you' }: { model: ReturnType<typeof useHomeSearch>; category?: string; mode?: HomeMode }) {
  const { search, setSearch, settled, ready, composing, setComposing, history, confirm } = model;
  const [open, setOpen] = useState(false), [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null), options = useRef<(HTMLElement | null)[]>([]);
  const recent = !search.q.trim();
  const suggestions = useQuery({
    queryKey: ['home-suggestions', model.identity, category, mode, settled], enabled: open && ready && !recent,
    queryFn: ({ signal }) => apiRequest<{ items: HomeSuggestion[] }>(`/api/opportunities/suggestions?${homeSearchParams(settled, category, mode)}`, { signal }),
    staleTime: 0, retry: false,
  });
  const items = ready && !recent ? suggestions.data?.items ?? [] : [];
  const count = recent ? history.length : items.length;
  useEffect(() => setActive(-1), [search, category, open, suggestions.data, history]);
  useEffect(() => { if (active >= 0) options.current[active]?.scrollIntoView({ block: 'nearest' }); }, [active]);
  const choose = (item: HomeSuggestion) => {
    if (item.action === 'criterion') confirm(addHomeCriterion(search, item.field, item.value));
    setOpen(false); setActive(-1);
  };
  const waiting = !ready || suggestions.isFetching;
  return <div className="min-w-0 flex-1" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) { setOpen(false); setActive(-1); } }}>
    <div className="relative">
      <label htmlFor="home-search" className="sr-only">Search Home opportunities</label>
      <Search aria-hidden size={18} className="absolute left-4 top-4 text-muted pointer-events-none" />
      <input id="home-search" ref={input} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={open ? 'home-search-options' : undefined}
        aria-activedescendant={open && active >= 0 && active < count ? `home-option-${active}` : undefined}
        autoComplete="off" maxLength={200} placeholder="Search projects, artists, opportunities..." value={search.q}
        className={`${controlStyles.field} min-h-12 w-full pl-11 pr-12 text-base sm:text-sm`}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)}
        onChange={e => { setSearch({ ...search, q: e.target.value }); setActive(-1); setOpen(true); }}
        onCompositionStart={() => { setComposing(true); setActive(-1); }} onCompositionEnd={e => { setSearch({ ...search, q: e.currentTarget.value }); setComposing(false); }}
        onKeyDown={event => {
          if (composing || event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') { event.preventDefault(); setOpen(false); setActive(-1); }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); if (count) setActive(old => event.key === 'ArrowDown' ? (old + 1) % count : old <= 0 ? count - 1 : old - 1); }
          if (event.key === 'Enter') { event.preventDefault(); if (open && active >= 0 && active < count) options.current[active]?.click(); else { confirm(); setOpen(false); } }
        }} />
      {search.q && <button type="button" aria-label="Clear Home search" className="absolute right-0 top-0 min-h-12 min-w-12 flex items-center justify-center focus-visible:outline focus-visible:outline-accent" onClick={() => { model.clear(); input.current?.focus(); setOpen(true); }}><X size={18} aria-hidden /></button>}
      {open && <div className="absolute z-30 top-full mt-2 w-full border border-border bg-bg shadow-xl max-h-[min(26rem,50dvh)] overflow-y-auto p-2" aria-label="Home search suggestions">
        {recent && <div className="flex items-center justify-between gap-3 px-2"><p className="text-xs text-muted">Recent searches</p>{history.length > 0 && <button className="min-h-11 px-2 text-sm underline" onMouseDown={e => e.preventDefault()} onClick={() => { model.clearHistory(); input.current?.focus(); }}>Clear all</button>}</div>}
        <div className="flex items-start">
          <div id="home-search-options" role="listbox" aria-label={recent ? 'Recent searches' : 'Search suggestions'} className="min-w-0 flex-1">
            {recent ? history.map((entry, i) => <button key={i} id={`home-option-${i}`} ref={el => { options.current[i] = el; }} role="option" title={describe(entry)} aria-selected={active === i} tabIndex={-1}
              className={`w-full h-12 min-h-12 text-left px-3 py-3 text-sm truncate hover:bg-surfaceAlt ${active === i ? 'bg-surfaceAlt text-accent' : ''}`}
              onMouseDown={e => e.preventDefault()} onClick={() => { model.restore(entry); setOpen(false); }}>{describe(entry)}</button>)
              : items.map((item, i) => {
                const content = <><span className="text-xs text-muted">{item.type}</span><span className="block break-words">{item.label}</span><span className="flex items-center gap-1 text-xs text-muted">{item.action === 'criterion' ? 'Search Home' : item.type === 'Artist' ? 'View profile' : 'View project'}{item.action === 'navigate' && <ArrowUpRight size={12} aria-hidden />}</span></>;
                const props = { id: `home-option-${i}`, role: 'option', 'aria-selected': active === i, tabIndex: -1, className: `block w-full text-left min-h-11 px-3 py-2 text-sm hover:bg-surfaceAlt ${active === i ? 'bg-surfaceAlt text-accent' : ''}`, onMouseDown: (e: React.MouseEvent) => e.preventDefault(), onClick: () => choose(item) };
                return item.action === 'navigate' ? <Link key={item.id} href={item.href} {...props} ref={el => { options.current[i] = el; }}>{content}</Link> : <button key={item.id} {...props} ref={el => { options.current[i] = el; }}>{content}</button>;
              })}
          </div>
          {recent && history.length > 0 && <div aria-label="Delete recent searches" className="shrink-0">{history.map((entry,i) => <button key={i} aria-label={`Remove recent search: ${describe(entry)}`} className="flex items-center justify-center min-h-12 min-w-11" onMouseDown={e => e.preventDefault()} onClick={() => { model.removeHistory(i); input.current?.focus(); }}><X size={16} aria-hidden /></button>)}</div>}
        </div>
        <p role="status" className="text-xs text-muted px-3" aria-live="polite">{recent ? !history.length ? 'No recent searches.' : '' : waiting ? 'Finding suggestions…' : suggestions.error ? 'Suggestions unavailable.' : !items.length ? 'No matching suggestions. Press Enter to search Home.' : ''}</p>
        {!recent && suggestions.error && ready && <button className={controlStyles.button} onMouseDown={e => e.preventDefault()} onClick={() => void suggestions.refetch()}>Retry suggestions</button>}
      </div>}
    </div>

  </div>;
}
