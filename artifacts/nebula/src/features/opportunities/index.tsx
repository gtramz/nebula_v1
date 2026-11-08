import { useFollowSync } from '@/features/following';
import { useRef, useState, useSyncExternalStore } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { ArrowUpRight, Music2 } from 'lucide-react';
import { apiRequest, isServerMode, getHomeRankingGeneration, subscribeHomeRanking, type OpportunityPage, type OpportunityProject } from '@nebula/local';
import { ContentWidth } from '@/components/shell/app-shell';
import { useViewState } from '@/components/shell/return-context';
import { controlStyles, StateBadge } from '@/components/antiq/workspace';
import { CompensationText } from '@/features/collaborations';
import { useAuth } from '@/context/AuthContext';
import { HomeSearchControl, useHomeSearch } from './search';
import { normalizeHomeSearch, homeFilterEntries, homeSearchParams, type HomeMode, type HomeFacetOptions } from '@nebula/local';
import { HomeFiltersPanel, HomeFilterChips } from './filters';
import { formatMoney, cn } from '@/lib/utils';


export function OpportunityProjectCard({ item }: { item: OpportunityProject }) {
  const { project, offers } = item;
  const [coverFailed, setCoverFailed] = useState(false);
  const funding = project.status === 'funding', count = offers.length + Number(funding);
  return <article aria-label={project.title} className="min-w-0 border-t border-border pt-5 flex flex-col gap-5">
    <div className="aspect-[4/3] bg-surfaceAlt overflow-hidden relative flex items-center justify-center">
      {project.coverUrl && !coverFailed ? <img src={project.coverUrl} onError={() => setCoverFailed(true)} alt={`${project.title} artwork`} loading="lazy" decoding="async" className="h-full w-full object-contain" />
        : <Music2 aria-hidden className="h-16 w-16 text-accent/30" strokeWidth={1} />}
      <span className="absolute left-3 top-3 bg-bg/90 border border-border px-3 py-1 voice text-[10px]">{project.category}</span>
    </div>
    <div className="space-y-2 min-w-0">
      <h2 className="text-2xl font-display font-semibold tracking-tight break-words">{project.title}</h2>
      <Link href={`/artist/${project.artistId}`} className="inline-flex items-center min-h-11 text-sm text-muted hover:text-ink break-words">{project.artistName}<ArrowUpRight size={14} className="ml-2 shrink-0" aria-hidden /></Link>
      {(project.pitch || project.story) && <p className="text-sm text-muted leading-relaxed line-clamp-3 break-words">{project.pitch || project.story}</p>}
    </div>
    <div className="space-y-3">
      <StateBadge>{count} open {count === 1 ? 'opportunity' : 'opportunities'}</StateBadge>
      <ul className="divide-y divide-border">
        {offers.slice(0, 3).map(offer => <li key={offer.id} className="py-3 space-y-1 text-sm break-words"><p className="font-medium">{offer.need}</p>{offer.workId&&<p className="text-xs text-muted">For: {offer.workTitle ?? "Song"}</p>}<p className="text-muted"><CompensationText value={offer.compensation} /></p></li>)}
        {funding && <li className="py-3 space-y-1 text-sm"><p className="font-medium">Funding open</p><p className="text-muted">{formatMoney(project.raisedAmount)} of {formatMoney(project.goalAmount)}</p></li>}
      </ul>
      {offers.length > 3 && <p className="text-xs text-muted">+{offers.length - 3} more creative {offers.length - 3 === 1 ? 'offer' : 'offers'} in this project</p>}
    </div>
    <Link href={`/project/${project.id}`} className={`${controlStyles.button} mt-auto self-start`}>View project<ArrowUpRight aria-hidden size={16} /></Link>
  </article>;
}

export function OpportunityHome() {
  const { user } = useAuth();
  const identity = user ? `${user.role}:${user.artistId ?? user.investorId}` : 'guest';
  return <OpportunityHomeContent key={identity} identity={identity} />;
}
function OpportunityHomeContent({ identity }: { identity: string }) {
  const { user } = useAuth();
  const rankingGeneration = useSyncExternalStore(subscribeHomeRanking, () => getHomeRankingGeneration(user?.artistId));
  const canFollow = isServerMode() && user?.role === 'artist';
  useFollowSync();
  const model = useHomeSearch(identity);
  const filters = normalizeHomeSearch(model.search).filters;
  const filterCount = homeFilterEntries(filters).length;
  const hasSearch = !!model.search.q.trim();
  const [savedMode, setMode] = useViewState<HomeMode>('home-discovery-mode', 'for-you');
  const mode = savedMode === 'following' && !canFollow ? 'for-you' : savedMode;
  const lastFacets = useRef<HomeFacetOptions | undefined>(undefined);
  const query = useInfiniteQuery({
    queryKey: ['opportunity-projects', identity, mode, model.settled, mode === 'for-you' ? rankingGeneration : null], enabled: model.ready, initialPageParam: null as number | string | null,
    queryFn: ({ signal, pageParam }) => {
      const params = homeSearchParams(model.settled, 'all', mode);
      if (pageParam !== null) params.set(typeof pageParam === 'number' ? 'before' : 'cursor', String(pageParam));
      return apiRequest<OpportunityPage>(`/api/opportunities/projects?${params}`, { signal });
    },
    getNextPageParam: page => page.nextPageCursor !== undefined ? page.nextPageCursor ?? undefined : page.nextCursor ?? undefined,
    refetchInterval: 15_000, refetchOnWindowFocus: true, retry: false,
  });
  if (query.data?.pages[0]?.facets) lastFacets.current = query.data.pages[0].facets;
  // Defensive stable identity across pages when availability changes during browsing.
  const items = model.ready ? [...new Map((query.data?.pages.flatMap(page => page.items) ?? []).map(item => [item.project.id, item])).values()] : [];
  const forYou = query.data?.pages[0]?.forYou;
  const forYouDescription = !model.ready || query.isPending ? 'Ordering opportunities…'
    : query.error ? 'For You could not refresh. Try again.'
    : forYou?.basis === 'preferences' ? 'Ordered using your private preferences.'
    : forYou?.basis === 'profile' ? 'Ordered using relevant roles and artist genres from your public profile.'
    : forYou?.basis === 'mixed' ? 'Ordered using your private preferences, with relevant public profile details where preferences are not set.'
    : forYou?.reason === 'no-matches' ? 'General project order · no affinity matches in these results.'
    : forYou?.reason === 'no-signals' && user?.role === 'artist' ? 'General project order · no usable preference or profile signals yet.'
    : 'General project order.';
  return <div data-page-scroll className="flex-1 overflow-y-auto">
    <ContentWidth className="py-6 sm:py-8 space-y-5">
      <header className="max-w-2xl space-y-2">
        <p className="voice text-xs text-accent">HOME / OPEN OPPORTUNITIES</p>
        <h1 className="text-3xl sm:text-4xl font-display font-bold tracking-tight">Find your next project.</h1>
        <p className="text-muted text-sm sm:text-base leading-relaxed">Discover music worth being part of.</p>
      </header>
      <div className="space-y-3 border-b border-border pb-4">
        <div className="flex items-start gap-2 sm:gap-3">
          <HomeSearchControl model={model} mode={mode} />
          <HomeFiltersPanel filters={filters} facets={lastFacets.current} loading={query.isPending} failed={!!query.error} retry={() => void query.refetch()} onApply={model.applyFilters} />
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Discovery mode">
          <button className={cn(controlStyles.button, mode === 'for-you' && 'bg-cream text-bg hover:bg-cream hover:text-bg')} aria-pressed={mode === 'for-you'} onClick={() => setMode('for-you')}>For You</button>
          <button className={cn(controlStyles.button, mode === 'recent' && 'bg-cream text-bg hover:bg-cream hover:text-bg')} aria-pressed={mode === 'recent'} onClick={() => setMode('recent')}>Recently created</button>
          <button className={cn(controlStyles.button, mode === 'following' && 'bg-cream text-bg hover:bg-cream hover:text-bg')} disabled={!canFollow} aria-pressed={mode === 'following'} aria-describedby={!canFollow ? 'following-unavailable' : undefined} onClick={() => setMode('following')}>Following</button>
        </div>
        <p className="text-xs text-muted" data-testid="home-mode-description">{mode === 'following' ? 'Open opportunities from artists you follow.' : mode === 'for-you' ? forYouDescription : 'Newest creation date first · publication dates are not recorded yet.'}</p>
        {!canFollow && <p id="following-unavailable" className="text-xs text-muted">{user ? 'Following is available for artists in the connected environment.' : <>Sign in as an artist to browse Following. <Link href="/login" className="underline inline-flex min-h-11 items-center">Sign in</Link></>}</p>}
        <HomeFilterChips filters={filters} onChange={model.applyFilters} />
      </div>
      {model.ready && query.error && <div role="alert" className="space-y-3"><p className="text-sm">{query.error.message}</p><button className={controlStyles.button} disabled={query.isFetching} onClick={() => void query.refetch()}>Try again</button></div>}
      {!model.ready || query.isPending ? <p role="status" className="py-16 text-muted">{model.composing ? 'Finish typing to search.' : 'Loading opportunities…'}</p> : !items.length && !query.error ? <div className="py-16 space-y-4">
        <h2 className="text-xl font-semibold">{mode === 'following' && query.data?.pages[0]?.followedArtistCount === 0 ? 'Follow artists to discover their projects.' : mode === 'following' && query.data?.pages[0]?.eligibleCount === 0 ? 'No open opportunities from followed artists yet.' : query.data?.pages[0]?.eligibleCount === 0 || (!hasSearch && !filterCount) ? 'No open opportunities yet.' : 'No matching projects.'}</h2>
        <p className="text-sm text-muted">{hasSearch || filterCount ? 'Try another search or adjust your filters.' : 'Projects remain available through Search and artist profiles.'}</p>
        {hasSearch && <button className={controlStyles.button} onClick={model.clear}>Clear search</button>}

        <Link href="/search" className={controlStyles.button}>Search projects</Link>
      </div> : null}
      {model.ready && !!items.length && <p role="status" className="text-xs text-muted">{items.length} {items.length === 1 ? 'project' : 'projects'}{query.hasNextPage ? ' loaded' : ''}{hasSearch || filterCount ? ' matching your search and filters' : ''}.</p>}
      {!!items.length && <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-7 gap-y-12">{items.map(item => <OpportunityProjectCard key={item.project.id} item={item} />)}</div>}
      {model.ready && query.hasNextPage && <button className={controlStyles.button} disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>{query.isFetchingNextPage ? 'Loading…' : 'Load more projects'}</button>}
    </ContentWidth>
  </div>;
}
