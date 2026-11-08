import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { normalizeTaxonomyTerm, type TaxonomyOption } from '@nebula/local';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { controlStyles } from './workspace';

type Props<T extends string> = {
  label: string;
  options: readonly (TaxonomyOption & { id: T })[];
  selected: readonly T[];
  onChange: (ids: T[]) => void;
  disabled?: boolean;
  maxSelections?: number;
};

/** Canonical IDs in/out. Search and display labels never become new values. */
export function TaxonomyMultiSelect<T extends string>({ label, options, selected, onChange, disabled = false, maxSelections = 50 }: Props<T>) {
  const id = useId(), input = useRef<HTMLInputElement>(null), trigger = useRef<HTMLButtonElement>(null), list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0), [announcement, announce] = useState('');
  const labels = useMemo(() => new Map<string, string>(options.map(option => [option.id, option.label])), [options]);
  const shown = useMemo(() => {
    const words = normalizeTaxonomyTerm(query).split(' ').filter(Boolean);
    return options.filter(option => {
      const searchable = normalizeTaxonomyTerm([option.label, option.id, option.category ?? '', option.parentId ? labels.get(option.parentId) ?? '' : '', ...(option.aliases ?? [])].join(' '));
      return words.every(word => searchable.includes(word));
    });
  }, [options, query, labels]);
  const activeIndex = Math.min(active, Math.max(0, shown.length - 1));
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open, query]);
  function change(id: T) {
    if (disabled) return;
    if (selected.includes(id)) {
      onChange(selected.filter(value => value !== id)); announce(`${labels.get(id)} removed.`);
    } else if (selected.length < maxSelections) {
      onChange([...selected, id]); announce(`${labels.get(id)} selected.`);
    } else announce(`Select up to ${maxSelections} options.`);
  }
  function keys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (shown.length) setActive(event.key === 'Home' ? 0 : event.key === 'End' ? shown.length - 1 : (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length);
    } else if (event.key === 'Enter') {
      event.preventDefault(); if (shown[activeIndex]) change(shown[activeIndex].id);
    } else if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
  }
  return <div className="min-w-0 space-y-3" role="group" aria-labelledby={`${id}-label`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span id={`${id}-label`} className="voice text-[10px] text-muted">{label}</span>
      {selected.length > 0 && <button type="button" disabled={disabled} className="min-h-11 min-w-11 px-3 text-sm text-muted underline disabled:opacity-50" aria-label={`Clear ${label.toLowerCase()}`} onClick={() => { onChange([]); announce(`${label} cleared.`); trigger.current?.focus(); }}>Clear all</button>}
    </div>
    <div className="flex flex-wrap gap-2" aria-label={`Selected ${label.toLowerCase()}`}>
      {selected.map(value => <button type="button" key={value} disabled={disabled} className={`${controlStyles.button} max-w-full px-3 text-sm`} aria-label={`Remove ${labels.get(value) ?? value}`} onClick={() => { change(value); trigger.current?.focus(); }}>
        <span className="min-w-0 break-words">{labels.get(value) ?? value}</span><X size={16} className="shrink-0" aria-hidden />
      </button>)}
    </div>
    <Popover open={open} onOpenChange={next => { setOpen(next); if (next) { setQuery(''); setActive(0); } }}>
      <PopoverTrigger asChild><button ref={trigger} type="button" disabled={disabled} className={`${controlStyles.field} flex items-center justify-between gap-3 text-left`} aria-label={`Choose ${label.toLowerCase()}`}>
        <span>{selected.length ? `${selected.length} selected` : `Select ${label.toLowerCase()}`}</span><ChevronDown size={18} aria-hidden />
      </button></PopoverTrigger>
      <PopoverContent align="start" collisionPadding={16} className="flex flex-col w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-32px)] max-h-[var(--radix-popover-content-available-height)] overflow-hidden rounded-surface border-border bg-bg p-0 text-ink" aria-label={`${label} selector`} onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus(); }}>
        <div className="p-3 border-b border-border shrink-0"><input ref={input} className={controlStyles.field} role="combobox" aria-label={`Search ${label.toLowerCase()}`} aria-expanded={open} aria-autocomplete="list" aria-controls={`${id}-list`} aria-activedescendant={shown.length ? `${id}-option-${activeIndex}` : undefined} value={query} autoComplete="off" placeholder={`Search ${label.toLowerCase()}…`} onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={keys} /></div>
        <div ref={list} id={`${id}-list`} role="listbox" aria-label={label} aria-multiselectable="true" className="min-h-0 max-h-[min(18rem,35dvh)] overflow-y-auto overscroll-contain p-2">
          {shown.map((option, index) => <div key={option.id} id={`${id}-option-${index}`} data-option-index={index} role="option" aria-selected={selected.includes(option.id)} aria-disabled={!selected.includes(option.id) && selected.length >= maxSelections} className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-field px-3 py-2 text-sm ${index === activeIndex ? 'bg-surfaceAlt outline outline-1 outline-accent' : 'hover:bg-surfaceAlt'}`} onPointerMove={event => { if (event.pointerType === 'mouse') setActive(index); }} onMouseDown={event => event.preventDefault()} onClick={() => { setActive(index); change(option.id); input.current?.focus({ preventScroll: true }); }}>
            <span className="min-w-0 break-words"><span className="block">{option.label}</span>{(option.category || option.parentId) && <span className="block text-xs text-muted">{option.category ?? `${labels.get(option.parentId!) ?? option.parentId} · subgenre`}</span>}</span>
            {selected.includes(option.id) && <Check size={18} className="shrink-0 text-accent" aria-hidden />}
          </div>)}
          {!shown.length && <p className="p-3 text-sm text-muted">No matching options.</p>}
        </div>
        <div className="shrink-0 border-t border-border px-3 py-2 flex items-center justify-between gap-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"><span role="status" className="text-xs text-muted">{shown.length} options · {selected.length} selected</span><button type="button" className={controlStyles.button} onClick={() => setOpen(false)}>Done</button></div>
      </PopoverContent>
    </Popover>
    <span role="status" aria-live="polite" className="sr-only">{announcement}</span>
  </div>;
}
