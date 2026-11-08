import type { ArtistPreferences, ArtistProfessionalIdentity } from '../lib/local/src/artist-identity.js';
import type { CreativeRole } from '../lib/local/src/artist-taxonomy.js';
import { artistGenreMatches, normalizeArtistGenreCriterion, searchableArtistGenres } from '../lib/local/src/artist-search-genres.js';
import { opportunityNeeds, type Compensation, type OfferInput } from '../lib/local/src/collaborations.js';
import type { OpportunityProject } from '../lib/local/src/opportunities.js';
import { emptyHomeFilters, normalizeSearch, type HomeSearch } from '../lib/local/src/opportunity-search.js';
import type { ArtistSummary } from '../lib/local/src/types.js';

type Participation = OfferInput['need'] | 'Funding';
export type HomeAffinitySource = 'explicit' | 'profile' | 'none';
type Signal<T extends string> = { values: T[]; source: HomeAffinitySource };
export type HomeAffinitySignals = {
  participation: Signal<Participation>;
  compensation: Signal<Compensation['kind']>;
  projectType: Signal<string>;
  artistGenre: Signal<string>;
};
export type HomeAffinityScore = [participation: number, compensation: number, projectType: number, artistGenre: number];
export type ScoredHomeProject = { item: OpportunityProject; score: HomeAffinityScore };
export type HomeAffinitySummary = { hasSignals: boolean; hasMatches: boolean; usesExplicitPreferences: boolean; usesPublicProfile: boolean };

/** Intentionally small, canonical role-to-need mapping; roles never become permissions.
 * Unsupported specialties stay neutral rather than inheriting a nearby profession.
 */
export const homeRoleNeeds: Readonly<Partial<Record<CreativeRole, readonly OfferInput['need'][]>>> = {
  producer: ['Production'],
  'mixing-engineer': ['Mix'],
  'mastering-engineer': ['Master'],
  rapper: ['Verse', 'Feature'],
  vocalist: ['Feature'],
};
const distinct = <T extends string>(values: readonly T[]): T[] => [...new Set(values)].sort();
const roleNeeds = (roles: readonly CreativeRole[]) => distinct(roles.flatMap(role => homeRoleNeeds[role] ?? []));
const signal = <T extends string>(values: readonly T[], source: Exclude<HomeAffinitySource, 'none'>): Signal<T> => {
  const unique = distinct(values);
  return { values: unique, source: unique.length ? source : 'none' };
};

/** Call once using the authenticated Artist, never caller-provided viewer IDs.
 * Arrays are canonical and sorted so callers may hash this private context without
 * persisting another preferences copy or putting readable values into a cursor.
 */
export function buildHomeAffinitySignals(
  profile: (ArtistProfessionalIdentity & { genre?: string | null }) | null | undefined,
  preferences: ArtistPreferences | null | undefined,
): HomeAffinitySignals {
  const discovery = preferences?.discovery, collaboration = preferences?.collaboration;
  const intentions = [...(discovery?.opportunityTypes ?? []), ...(collaboration?.opportunityTypes ?? [])];
  const privateRoles = collaboration?.creativeRoles ?? [];
  // These three fields all declare desired participation. An unsupported explicit
  // role still overrides public roles; it is not permission to invent a fallback.
  const explicitParticipation = intentions.length > 0 || privateRoles.length > 0;
  const participation = explicitParticipation
    ? signal([...intentions.filter(value => [...opportunityNeeds, 'Funding'].includes(value)), ...roleNeeds(privateRoles)], 'explicit')
    : signal(roleNeeds(profile?.creativeRoles ?? []), 'profile');

  const explicitGenres = searchableArtistGenres(discovery ?? {});
  // [] means cleared: never resurrect discovery.genres. With no requested genre,
  // public identity may be a secondary signal, labelled as profile rather than intent.
  // Nonempty declarations that cannot resolve are neutral and block that fallback.
  const genreDeclared = discovery?.genreIds !== undefined
    ? discovery.genreIds.length > 0
    : !!discovery?.genres.some(value => value.trim());
  const artistGenre = explicitGenres.length || genreDeclared
    ? signal(explicitGenres.map(genre => normalizeArtistGenreCriterion(genre.value)), 'explicit')
    : signal(searchableArtistGenres(profile ?? {}).map(genre => normalizeArtistGenreCriterion(genre.value)), 'profile');

  return {
    participation,
    compensation: signal(collaboration?.compensationKinds ?? [], 'explicit'),
    projectType: signal((discovery?.projectTypes ?? []).map(normalizeSearch), 'explicit'),
    artistGenre,
  };
}

/** Negative means a sorts before b; the stable project ID remains the final tie-break. */
export function compareHomeAffinityScores(a: HomeAffinityScore, b: HomeAffinityScore): number {
  for (let dimension = 0; dimension < a.length; dimension++) {
    const order = b[dimension] - a[dimension];
    if (order) return order;
  }
  return 0;
}

/** Input is the full authorized, eligible, already text/facet-filtered Home inventory.
 * Never changes eligibility or terms. Availability includes expiry, computed upstream
 * by the existing offer projection using its request clock; no hidden clock or I/O here.
 */
export function rankHomeProjects(
  items: readonly OpportunityProject[], artists: readonly ArtistSummary[], search: HomeSearch, signals: HomeAffinitySignals,
): { entries: ScoredHomeProject[]; summary: HomeAffinitySummary } {
  const artistGenres = new Map(artists.map(artist => [artist.id, searchableArtistGenres(artist)]));
  const c = search.criteria, f = search.filters ?? emptyHomeFilters();
  // Legacy opportunity=funding alone selects the funding opportunity. Combined
  // with creative criteria, that legacy API means a funding project plus a
  // matching creative offer. Do not normalize it to the newer facet OR semantics.
  const legacyFundingOnly = c.opportunity === 'funding' && !c.need && !c.compensation
    && !f.compensationKinds.length && !f.participation.some(need => need !== 'Funding');
  const weight = (source: HomeAffinitySource) => source === 'explicit' ? 2 : source === 'profile' ? 1 : 0;
  const entries = items.map(item => {
    const { project, offers } = item;
    const projectType = Number(signals.projectType.values.includes(normalizeSearch(project.category)));
    const ownerGenres = artistGenres.get(project.artistId) ?? [];
    const artistGenre = signals.artistGenre.values.some(value => artistGenreMatches(ownerGenres, value)) ? weight(signals.artistGenre.source) : 0;
    let score: HomeAffinityScore = [0, 0, 0, 0];
    const consider = (need: Participation, compensation?: Compensation['kind']) => {
      const candidate: HomeAffinityScore = [
        signals.participation.values.includes(need) ? weight(signals.participation.source) : 0,
        Number(!!compensation && signals.compensation.values.includes(compensation)),
        projectType,
        artistGenre,
      ];
      if (compareHomeAffinityScores(candidate, score) < 0) score = candidate;
    };
    for (const offer of offers) {
      if (legacyFundingOnly || !offer.available || offer.status !== 'open') continue;
      // Same conjunction as the existing filter, including legacy criteria + facets.
      if ((c.need && offer.need !== c.need) || (c.compensation && offer.compensation.kind !== c.compensation)
        || (f.participation.length && !f.participation.includes(offer.need))
        || (f.compensationKinds.length && !f.compensationKinds.includes(offer.compensation.kind))) continue;
      consider(offer.need, offer.compensation.kind);
    }
    // Funding is a separate opportunity, never a fee/split inherited from an offer.
    if (project.status === 'funding' && !c.need && !c.compensation && !f.compensationKinds.length
      && (!f.participation.length || f.participation.includes('Funding'))) consider('Funding');
    return { item, score };
  }).sort((a, b) => compareHomeAffinityScores(a.score, b.score) || b.item.project.id - a.item.project.id);
  const used = Object.values(signals).filter(dimension => dimension.values.length);
  return {
    entries,
    summary: {
      hasSignals: !!used.length,
      hasMatches: entries.some(entry => entry.score.some(value => value > 0)),
      usesExplicitPreferences: used.some(dimension => dimension.source === 'explicit'),
      usesPublicProfile: used.some(dimension => dimension.source === 'profile'),
    },
  };
}
