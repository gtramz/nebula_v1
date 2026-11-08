import { useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { SlidersHorizontal, X } from 'lucide-react';
import { Dialog, DialogPortal, DialogOverlay, DialogTrigger, DialogClose, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { controlStyles } from '@/components/antiq/workspace';
import { emptyHomeFilters, facetLabels, facetValueLabel, homeFilterEntries, normalizeHomeFilters, opportunityNeeds, projectTypes, type HomeFilters, type HomeFacetOptions } from '@nebula/local';
import './browser.css';

export function HomeFiltersPanel({ filters, facets, loading, failed, retry, onApply }: { filters: HomeFilters; facets?: HomeFacetOptions; loading: boolean; failed: boolean; retry: () => void; onApply: (next: HomeFilters) => void }) {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState<HomeFilters>(emptyHomeFilters);
  const panel = useRef<HTMLDivElement | null>(null);
  const count = homeFilterEntries(filters).length;
  const groups: { field: keyof HomeFilters; values: string[] }[] = [
    { field: 'projectTypes', values: facets?.projectTypes ?? [...projectTypes] },
    { field: 'artistGenres', values: normalizeHomeFilters({ artistGenres: facets?.artistGenres ?? [] }).artistGenres },
    { field: 'participation', values: [...opportunityNeeds, 'Funding'] },
    { field: 'compensationKinds', values: ['fee','split'] },
  ];
  function toggle(field: keyof HomeFilters, value: string) {
    setDraft(current => normalizeHomeFilters({ ...current, [field]: (current[field] as readonly string[]).includes(value) ? current[field].filter(item => item !== value) : [...current[field], value] }));
  }
  return <Dialog open={open} onOpenChange={value => { if (value) setDraft(normalizeHomeFilters(filters)); setOpen(value); }}>
    <DialogTrigger asChild><button className={`${controlStyles.button} shrink-0 h-12 px-3 sm:px-5`} aria-label={`Filters${count ? ` (${count} active)` : ''}`}><SlidersHorizontal size={18} aria-hidden /><span className="hidden sm:inline">Filters</span>{count > 0 && <span className="text-accent">{count}</span>}</button></DialogTrigger>
    <DialogPortal>
      <DialogOverlay className="z-[80]" />
      <DialogPrimitive.Content className="home-filter-panel" ref={node => { if (node) panel.current = node; }} onCloseAutoFocus={event => {
          // Preserve a user's new focus if they already started editing after Apply.
          const active = document.activeElement;
          if (active && active !== document.body && active !== document.documentElement && !panel.current?.contains(active)) event.preventDefault();
        }}>
        <header className="border-b border-border px-6 py-4 pr-16 space-y-2 shrink-0">
          <DialogTitle className="text-xl font-semibold">Filter projects</DialogTitle>
          <DialogDescription className="text-sm text-muted">Choose any options within a group. Projects must match each selected group.</DialogDescription>
          <DialogClose className="absolute top-2 right-2 flex h-11 w-11 items-center justify-center" aria-label="Close filters"><X size={20} aria-hidden /></DialogClose>
        </header>
        <div className="home-filter-options space-y-6">
          {groups.map(({ field, values }) => <fieldset key={field} className="space-y-2">
            <legend className="text-sm font-semibold mb-2">{facetLabels[field]}</legend>
            {field === 'artistGenres' && <p className="text-xs text-muted">From artist profiles; project-specific genres are not available yet.</p>}
            {field === 'participation' && <p className="text-xs text-muted">Funding has no creative payment or royalty terms. Those filters apply to creative offers.</p>}
            <div className="grid grid-cols-1 min-[360px]:grid-cols-2 gap-x-3">{[...new Set([...values, ...draft[field]])].map(value => <label key={value} className="flex min-h-11 items-center gap-3 text-sm cursor-pointer min-w-0 py-2">
              <input type="checkbox" className="h-5 w-5 shrink-0 accent-accent" checked={(draft[field] as readonly string[]).includes(value)} onChange={() => toggle(field,value)} />
              <span className="break-words min-w-0">{facetValueLabel(field,value)}</span>
            </label>)}</div>
            {field === 'artistGenres' && !values.length && !draft.artistGenres.length && <p role="status" className="text-xs text-muted">{loading ? 'Loading artist genres…' : failed ? 'Artist genres unavailable.' : 'No artist genres are available in the current opportunities.'}</p>}
            {field === 'artistGenres' && failed && !facets && <button className={controlStyles.button} onClick={retry}>Retry filters</button>}
          </fieldset>)}
        </div>
        <footer className="home-filter-footer border-t border-border flex gap-3 justify-between shrink-0">
          <button className={controlStyles.button} onClick={() => setDraft(emptyHomeFilters())}>Clear all</button>
          <button className={controlStyles.primary} onClick={() => { onApply(draft); setOpen(false); }}>Apply filters{homeFilterEntries(draft).length ? ` (${homeFilterEntries(draft).length})` : ''}</button>
        </footer>
      </DialogPrimitive.Content>
    </DialogPortal>
  </Dialog>;
}
export function HomeFilterChips({ filters, onChange }: { filters: HomeFilters; onChange: (filters: HomeFilters) => void }) {
  const entries = homeFilterEntries(filters); if (!entries.length) return null;
  return <div className="flex flex-wrap gap-2 items-center" aria-label="Active filters">
    {entries.map(({field,value}) => <button key={`${field}:${value}`} className={`${controlStyles.button} text-xs max-w-full`} aria-label={`Remove ${facetLabels[field]}: ${facetValueLabel(field,value)}`} onClick={() => onChange(normalizeHomeFilters({ ...filters, [field]: filters[field].filter(item => item !== value) }))}><span className="break-words min-w-0">{facetValueLabel(field,value)}</span><X size={14} className="shrink-0" aria-hidden /></button>)}
    <button className="min-h-11 px-3 text-xs text-muted underline" onClick={() => onChange(emptyHomeFilters())}>Clear all filters</button>
  </div>;
}
