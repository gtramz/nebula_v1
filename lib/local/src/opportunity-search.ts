import { normalizeTaxonomyTerm } from './artist-taxonomy.js';
import { artistGenreLabel, artistGenreMatches, normalizeArtistGenreCriterion, searchableArtistGenres } from './artist-search-genres.js';
import type { OpportunityProject } from './opportunities.js';
import type { ArtistSummary } from './types.js';
import type { OfferInput } from './collaborations.js';

import { opportunityNeeds } from './collaborations.js';
import { supportedProjectTypes as projectTypes } from './types.js';
export { opportunityNeeds, projectTypes };
export type HomeCriteria = { genre?: string; need?: OfferInput['need']; compensation?: 'split' | 'fee'; opportunity?: 'funding'; projectType?: string };
export type HomeFilters = { projectTypes: string[]; artistGenres: string[]; participation: (OfferInput['need'] | 'Funding')[]; compensationKinds: ('fee' | 'split')[] };
export type HomeFacetOptions = { projectTypes: string[]; artistGenres: string[] };
export type HomeMode = 'for-you' | 'recent' | 'following';
export const emptyHomeFilters = (): HomeFilters => ({ projectTypes: [], artistGenres: [], participation: [], compensationKinds: [] });
export type HomeSearch = { q: string; criteria: HomeCriteria; filters?: HomeFilters };
export type HomeSuggestion = { id: string; label: string; type: string } & (
  { action: 'criterion'; field: keyof HomeCriteria; value: string } |
  { action: 'navigate'; href: string }
);
export const normalizeSearch = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
export const criteriaLabels = { genre: 'Artist genre', need: 'Opportunity', compensation: 'Compensation', opportunity: 'Opportunity', projectType: 'Project type' };
export function criterionLabel(field: keyof HomeCriteria, value: string) {
  if (field === 'genre') return artistGenreLabel(value);
  return field === 'compensation' ? value === 'split' ? 'Royalty share' : 'USD payment' : field === 'opportunity' ? 'Funding open' : value;
}
export function homeSearchParams(search: HomeSearch, category = 'all', mode: HomeMode = 'for-you') {
  const params = new URLSearchParams();
  if (search.q.trim()) params.set('q', search.q.trim());
  if (category !== 'all') params.set('category', category);
  for (const [key, value] of Object.entries(search.criteria)) if (value) params.set(key, value);
  if (mode !== 'for-you') params.set('mode', mode);
  for (const [key, values] of Object.entries(search.filters ?? {})) for (const value of values as string[]) params.append(key, value);
  return params;
}
const aliases: Record<string, string> = {
  Verse: 'verse vocalist', Feature: 'feature featured artist', Production: 'production producer music production',
  Mix: 'mix mixing mixing engineer', Master: 'master mastering mastering engineer',
  split: 'royalty royalties royalty share royalty split royalty-based collaboration', fee: 'fee paid gig fixed fee USD payment',
  funding: 'funding financing investment',
};
export function filterOpportunityProjects(items: OpportunityProject[], artists: ArtistSummary[], search: HomeSearch, category = 'all') {
  const genres = new Map(artists.map(artist => [artist.id, searchableArtistGenres(artist)]));
  const words = normalizeSearch(search.q).split(' ').filter(Boolean), c = search.criteria;
  return items.filter(({ project: p, offers }) => {
    if (category !== 'all' && normalizeSearch(p.category) !== normalizeSearch(category)) return false;
    if (c.projectType && normalizeSearch(p.category) !== normalizeSearch(c.projectType)) return false;
    if (c.genre && !artistGenreMatches(genres.get(p.artistId) ?? [], c.genre)) return false;
    if (c.opportunity === 'funding' && p.status !== 'funding') return false;
    // Both offer dimensions must be satisfied by the same currently available offer.
    if ((c.need || c.compensation) && !offers.some(o => (!c.need || o.need === c.need) && (!c.compensation || o.compensation.kind === c.compensation))) return false;
    const f = search.filters ?? emptyHomeFilters();
    if (f.projectTypes.length && !f.projectTypes.some(value => normalizeSearch(value) === normalizeSearch(p.category))) return false;
    if (f.artistGenres.length && !f.artistGenres.some(value => artistGenreMatches(genres.get(p.artistId) ?? [], value))) return false;
    if (f.participation.length || f.compensationKinds.length) {
      // Funding is an existing project-status opportunity, with no creative compensation.
      // A fee on another offer must never be attributed to that funding opportunity.
      const funding = f.participation.includes('Funding') && p.status === 'funding' && !f.compensationKinds.length && !c.need && !c.compensation;
      const creative = offers.some(o => (!c.need || o.need === c.need) && (!c.compensation || o.compensation.kind === c.compensation) && (!f.participation.length || f.participation.includes(o.need)) && (!f.compensationKinds.length || f.compensationKinds.includes(o.compensation.kind)));
      if (!funding && !creative) return false;
    }
    if (!words.length) return true;
    const text = normalizeSearch([p.title, p.artistName, p.pitch, p.story, p.category, ...(genres.get(p.artistId) ?? []).map(genre => genre.keywords), p.status === 'funding' ? aliases.funding : '',
      ...offers.flatMap(o => [aliases[o.need], o.deliverable, o.requirements, aliases[o.compensation.kind]])].filter(Boolean).join(' '));
    const genreText = normalizeTaxonomyTerm((genres.get(p.artistId) ?? []).map(genre => genre.keywords).join(' '));
    return words.every(word => {
      const genreWord = normalizeTaxonomyTerm(word).trim();
      return text.includes(word) || (!!genreWord && genreText.includes(genreWord));
    });
  });
}
export function opportunitySuggestions(items: OpportunityProject[], artists: ArtistSummary[], search: HomeSearch, category = 'all'): HomeSuggestion[] {
  const q = normalizeSearch(search.q); if (!q) return [];
  const context = filterOpportunityProjects(items, artists, { ...search, q: '' }, category);
  const candidates: (HomeSuggestion & { keywords?: string })[] = [];
  const criterion = (field: keyof HomeCriteria, value: string, keywords = value) => {
    if ((search.criteria[field] && normalizeSearch(criterionValue(field, search.criteria[field]!)) === normalizeSearch(criterionValue(field, value))) || homeFilterEntries(search.filters ?? emptyHomeFilters()).some(entry => entry.field === criterionFacet(field) && normalizeSearch(entry.value) === normalizeSearch(criterionValue(field, value)))) return;
    // Only suggest criteria that have eligible inventory within the current context.
    const candidate = normalizeHomeSearch({ ...search, q: '' });
    Object.assign(candidate.filters, { [criterionFacet(field)]: [criterionValue(field, value)] });
    if (!filterOpportunityProjects(items, artists, candidate, category).length) return;
    candidates.push({ id: `${field}:${normalizeSearch(criterionValue(field, value))}`, label: criterionLabel(field, value), type: criteriaLabels[field], action: 'criterion', field, value, keywords });
  };
  for (const need of opportunityNeeds) criterion('need', need, aliases[need]);
  for (const kind of ['split', 'fee'] as const) criterion('compensation', kind, aliases[kind]);
  criterion('opportunity', 'funding', aliases.funding);
  for (const type of homeFacetOptions(items, artists).projectTypes) criterion('projectType', type);
  const artistIds = new Set(context.map(item => item.project.artistId));
  const eligibleArtistIds = new Set(items.map(item => item.project.artistId));
  const seenGenres = new Set<string>();
  for (const artist of artists) if (eligibleArtistIds.has(artist.id)) for (const genre of searchableArtistGenres(artist)) {
    const key = normalizeSearch(genre.value); if (seenGenres.has(key)) continue;
    seenGenres.add(key);
    // Keep label-valued suggestions compatible with earlier clients; selection normalizes to IDs.
    criterion('genre', genre.label, genre.keywords);
  }
  const matches = (value: string) => q.split(' ').every(word => normalizeSearch(value).includes(word));
  const terms = candidates.filter(item => item.action === 'criterion' && item.field === 'genre'
    ? !!normalizeTaxonomyTerm(search.q).trim() && normalizeTaxonomyTerm(search.q).trim().split(' ').every(word => normalizeTaxonomyTerm(item.keywords ?? item.label).includes(word))
    : matches(`${item.label} ${item.keywords ?? ''}`)).slice(0, 6).map(({ keywords: _, ...item }) => item);
  const projects: HomeSuggestion[] = context.filter(({ project }) => matches(project.title)).slice(0, 3).map(({ project }) => ({ id: `project:${project.id}`, label: project.title, type: 'Project', action: 'navigate', href: `/project/${project.id}` }));
  const profiles: HomeSuggestion[] = artists.filter(a => artistIds.has(a.id) && matches(a.name)).sort((a,b) => a.name.localeCompare(b.name) || a.id - b.id).slice(0, 3).map(a => ({ id: `artist:${a.id}`, label: a.name, type: 'Artist', action: 'navigate', href: `/artist/${a.id}` }));
  return [...terms, ...projects, ...profiles];
}

export const facetLabels: Record<keyof HomeFilters, string> = { projectTypes: 'Project type', artistGenres: 'Artist genre', participation: 'Participation', compensationKinds: 'Compensation' };
export function facetValueLabel(field: keyof HomeFilters, value: string) {
  if (field === 'artistGenres') return artistGenreLabel(value);
  if (field === 'compensationKinds') return value === 'fee' ? 'Fixed payment (USD)' : 'Royalty share';
  if (field === 'projectTypes') return value.toLowerCase() === 'ep' ? 'EP' : value.charAt(0).toUpperCase() + value.slice(1);
  return value;
}
export function criterionFacet(field: keyof HomeCriteria): keyof HomeFilters {
  return ({ genre: 'artistGenres', need: 'participation', compensation: 'compensationKinds', opportunity: 'participation', projectType: 'projectTypes' } as const)[field];
}
const criterionValue = (field: keyof HomeCriteria, value: string) => field === 'opportunity' ? 'Funding' : field === 'genre' ? normalizeArtistGenreCriterion(value) : value;
export function homeFilterEntries(filters: HomeFilters) {
  return (Object.keys(filters) as (keyof HomeFilters)[]).flatMap(field => filters[field].map(value => ({ field, value })));
}
export function normalizeHomeFilters(value: unknown): HomeFilters {
  const result = emptyHomeFilters();
  if (!value || typeof value !== 'object') return result;
  for (const field of Object.keys(result) as (keyof HomeFilters)[]) {
    const values = (value as Record<string, unknown>)[field]; if (!Array.isArray(values)) continue;
    const seen = new Set<string>();
    for (const v of values.slice(0, 50)) {
      if (typeof v !== 'string' || !v.trim() || v.length > (field === 'artistGenres' ? 200 : 60)) continue;
      if (field === 'participation' && ![...opportunityNeeds, 'Funding'].includes(v)) continue;
      if (field === 'compensationKinds' && !['fee', 'split'].includes(v)) continue;
      const normalized = field === 'artistGenres' ? normalizeArtistGenreCriterion(v) : v.trim();
      const key = normalizeSearch(normalized); if (seen.has(key)) continue;
      seen.add(key); (result[field] as string[]).push(field === 'projectTypes' ? key : normalized);
    }
  }
  return result;
}
export function normalizeHomeSearch(search: HomeSearch): HomeSearch & { filters: HomeFilters } {
  const filters = normalizeHomeFilters(search.filters);
  for (const [field, value] of Object.entries(search.criteria)) {
    const key = field as keyof HomeCriteria, facet = criterionFacet(key); if (!facet) continue;
    (filters[facet] as string[]).push(criterionValue(key, value));
  }
  return { q: search.q, criteria: {}, filters: normalizeHomeFilters(filters) };
}
export function addHomeCriterion(search: HomeSearch, field: keyof HomeCriteria, value: string) {
  const next = normalizeHomeSearch(search); next.q = '';
  (next.filters[criterionFacet(field)] as string[]).push(criterionValue(field, value));
  next.filters = normalizeHomeFilters(next.filters); return next;
}
export function homeFacetOptions(items: OpportunityProject[], artists: ArtistSummary[]): HomeFacetOptions {
  const owners = new Set(items.map(item => item.project.artistId));
  const genres = new Map<string, string>();
  // Preserve the existing label-valued response contract; UI/state normalize known labels to IDs.
  for (const artist of artists) if (owners.has(artist.id)) for (const genre of searchableArtistGenres(artist)) genres.set(normalizeSearch(genre.value), genre.label);
  return { projectTypes: [...new Set([...projectTypes, ...items.map(item => normalizeSearch(item.project.category))])], artistGenres: [...genres.values()].sort((a,b) => a.localeCompare(b)) };
}
