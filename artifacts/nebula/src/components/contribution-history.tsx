import { useState } from 'react';
import { Link } from 'wouter';
import { sumMoney, useUpdateProjectVisibility, type Investment, type ReceivedInvestment } from '@nebula/local';
import { formatMoney } from '@/lib/utils';
import { PublicVisibilityFields } from './public-visibility';

type HistoryEntry = Investment | ReceivedInvestment;
const inputClass = 'w-full bg-surfaceAlt border border-border p-3 text-sm text-ink';

function localDate(value: string) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function ContributionHistory({ entries, received = false }: { entries: HistoryEntry[]; received?: boolean }) {
  const [projectFilter, setProjectFilter] = useState('all');
  const [availability, setAvailability] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState(8);
  const projects = new Map(entries.map(entry => [entry.projectId!, entry.projectTitle!]));
  const invalidDates = !!from && !!to && from > to;
  const filtered = invalidDates ? [] : entries.filter(entry =>
    (projectFilter === 'all' || String(entry.projectId) === projectFilter)
    && (availability === 'all' || (availability === 'removed' ? entry.projectArchived : !entry.projectArchived))
    && (!from || localDate(entry.createdAt) >= from) && (!to || localDate(entry.createdAt) <= to));
  const groups = new Map<number, HistoryEntry[]>();
  for (const entry of filtered) groups.set(entry.projectId!, [...(groups.get(entry.projectId!) ?? []), entry]);
  const activeFilters = projectFilter !== 'all' || availability !== 'all' || !!from || !!to;
  const filterKey = `${projectFilter}/${availability}/${from}/${to}`;

  return (
    <div className="space-y-8">
      <div className="border border-border p-5 grid gap-5 sm:grid-cols-3">
        <div><p className="text-xs text-muted">{received ? 'Total received' : 'Total contributed'}{activeFilters ? ' · filtered' : ''}</p><p className="text-xl sm:text-2xl font-bold break-words mt-2">{formatMoney(sumMoney(filtered.map(entry => entry.amount)))}</p></div>
        <div><p className="text-xs text-muted">Contributions</p><p className="text-2xl font-bold mt-2">{filtered.length}</p></div>
        <div><p className="text-xs text-muted">Projects</p><p className="text-2xl font-bold mt-2">{groups.size}</p></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs text-muted space-y-2"><span>Project</span><select className={inputClass} value={projectFilter} onChange={event => { setProjectFilter(event.target.value); setLimit(8); }}><option value="all">All projects</option>{[...projects].map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
        <label className="text-xs text-muted space-y-2"><span>Project availability</span><select className={inputClass} value={availability} onChange={event => { setAvailability(event.target.value); setLimit(8); }}><option value="all">All</option><option value="current">Current projects</option><option value="removed">Removed projects</option></select></label>
        <label className="text-xs text-muted space-y-2"><span>From date</span><input className={inputClass} type="date" value={from} onChange={event => { setFrom(event.target.value); setLimit(8); }} /></label>
        <label className="text-xs text-muted space-y-2"><span>To date</span><input className={inputClass} type="date" value={to} onChange={event => { setTo(event.target.value); setLimit(8); }} /></label>
      </div>
      {activeFilters && <button className="text-sm underline text-muted" onClick={() => { setProjectFilter('all'); setAvailability('all'); setFrom(''); setTo(''); setLimit(8); }}>Clear filters</button>}
      {invalidDates && <p role="alert" className="text-danger text-sm">The end date must be on or after the start date.</p>}
      {!filtered.length && <div className="border border-dashed border-border p-8 text-muted text-center">{activeFilters ? 'No contributions match these filters.' : received ? 'No contributions received yet.' : "you haven't backed any projects yet"}</div>}
      {[...groups].slice(0, limit).map(([projectId, movements]) => <HistoryProject key={`${projectId}/${filterKey}`} movements={movements} received={received} filtered={activeFilters} />)}
      {groups.size > limit && <button onClick={() => setLimit(limit + 8)} className="border border-border px-6 py-3 text-sm">Show more projects</button>}
      <p className="text-xs text-muted">All amounts are in USD. These are preview contributions; no money has moved.</p>
    </div>
  );
}

function HistoryProject({ movements, received, filtered }: { movements: HistoryEntry[]; received: boolean; filtered: boolean }) {
  const first = movements[0];
  const [editing, setEditing] = useState(false);
  const [visibility, setVisibility] = useState(first.publicVisibility ?? { showName: false, showAmount: false });
  const [saved, setSaved] = useState(false);
  const [limit, setLimit] = useState(10);
  const mutation = useUpdateProjectVisibility();
  const total = sumMoney(movements.map(entry => entry.amount));
  return (
    <article className="border border-border p-5 sm:p-6 space-y-5" aria-label={`${first.projectTitle} history`}>
      <div className="flex flex-col sm:flex-row sm:justify-between gap-4">
        <div className="space-y-2 min-w-0">
          <h2 className="text-xl font-bold break-words">{first.projectTitle}</h2>
          {!received && <p className="text-sm text-muted">by {first.artistName}</p>}
          <p className="text-xs text-muted">{movements.length} contribution{movements.length === 1 ? '' : 's'}{filtered ? ' in this selection' : ''} · {first.projectArchived ? 'Removed project' : 'Current project'}</p>
        </div>
        <p className="font-bold text-xl shrink-0">{formatMoney(total)}</p>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        {!first.projectArchived && <Link href={`/project/${first.projectId}`} className="underline text-muted">View project</Link>}
        {!received && <button className="underline text-muted" onClick={() => { setVisibility(first.publicVisibility ?? { showName: false, showAmount: false }); setEditing(!editing); setSaved(false); mutation.reset(); }}>Public visibility</button>}
      </div>
      {!received && <p className="text-xs text-muted">Public name: {first.publicVisibility?.showName ? 'visible' : 'anonymous'} · Public amount: {first.publicVisibility?.showAmount ? 'visible' : 'hidden'}</p>}
      {editing && <form className="space-y-4 border-t border-border pt-5" onSubmit={event => {
        event.preventDefault();
        mutation.mutate({ projectId: first.projectId!, data: visibility }, { onSuccess: () => { setEditing(false); setSaved(true); } });
      }}>
        <PublicVisibilityFields value={visibility} onChange={setVisibility} disabled={mutation.isPending} />
        <button disabled={mutation.isPending} className="bg-cream text-bg px-5 py-3 text-sm font-bold disabled:opacity-50">Save visibility</button>
        {mutation.error && <p role="alert" className="text-danger text-sm">{mutation.error.message}</p>}
      </form>}
      {saved && <p role="status" className="text-sm text-accent">Visibility updated for all your contributions to this project.</p>}
      <details className="border-t border-border pt-4">
        <summary className="cursor-pointer text-sm font-medium">View {movements.length} contribution{movements.length === 1 ? '' : 's'}</summary>
        <div className="mt-4 divide-y divide-border">
          {movements.slice(0, limit).map(entry => <div key={entry.id} className="py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm">
            <div className="space-y-1">
              {received && 'investorName' in entry && <p className="font-medium">{entry.investorName}</p>}
              <p className="text-muted">{new Date(entry.createdAt).toLocaleString()}</p>
              <p className="text-xs text-muted">#{entry.id} · PREVIEW</p>
            </div>
            <div className="flex items-center gap-4"><span className="font-bold">{formatMoney(entry.amount)}</span>{!received && <Link href={`/receipt/${entry.id}`} className="underline text-muted">View receipt</Link>}</div>
          </div>)}
          {movements.length > limit && <button className="py-3 underline text-sm" onClick={() => setLimit(limit + 10)}>Show more contributions</button>}
        </div>
      </details>
    </article>
  );
}
