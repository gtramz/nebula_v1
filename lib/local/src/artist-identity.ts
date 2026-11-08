import type { Artist } from './types.js';
import { supportedProjectTypes } from './types.js';
import { opportunityNeeds, type Compensation } from './collaborations.js';
import { creativeRoleTaxonomy, musicalGenreTaxonomy, resolveLegacyTaxonomy, validateTaxonomyIds, type CreativeRole, type MusicalGenre } from './artist-taxonomy.js';
export { creativeRoleTaxonomy } from './artist-taxonomy.js';
export type { CreativeRole } from './artist-taxonomy.js';

export const collaborationAvailabilityValues = ['unspecified', 'open', 'limited', 'unavailable'] as const;
export type CollaborationAvailability = typeof collaborationAvailabilityValues[number];
export type ArtistProfessionalIdentity = {
  externalLinks?: ArtistExternalLink[];
  /** Deliberately public interests, independent of private discovery preferences. */
  publicInterests?: PublicArtistInterest[];
  creativeRoles?: CreativeRole[];
  /** Artist identity only; not verified project/work genres. Legacy genre stays intact. */
  genres?: string[];
  /** Canonical taxonomy IDs. Absent derives clear legacy matches; [] means cleared. */
  genreIds?: MusicalGenre[];
  /** Read-only source of the projected IDs; absent in stored records and profile writes. */
  genreSource?: import('./artist-search-genres.js').ArtistGenreSource;
  collaborationAvailability?: CollaborationAvailability;
  /** Read-only compatibility diagnostics; these are never accepted as profile writes. */
  identityReview?: { creativeRoles: string[]; genres: string[] };
};
export type ArtistExternalLink = { label: string; url: string };
export const publicArtistInterestValues = [...opportunityNeeds, 'Funding'] as const;
export type PublicArtistInterest = typeof publicArtistInterestValues[number];
export const onboardingSteps = [1, 2, 3, 4] as const;
export type OnboardingStep = typeof onboardingSteps[number];
export type ArtistOnboarding = { version: 1; step: OnboardingStep; completedSteps: OnboardingStep[]; completedAt: string | null };
export type ArtistOnboardingUpdate = { step: OnboardingStep; completeStep?: OnboardingStep; finish?: boolean };
export const emptyArtistOnboarding = (): ArtistOnboarding => ({ version: 1, step: 1, completedSteps: [], completedAt: null });
export function advanceArtistOnboarding(current: ArtistOnboarding | undefined, value: unknown): ArtistOnboarding {
  const data = object(value); keys(data, ['step', 'completeStep', 'finish']);
  if (!onboardingSteps.includes(data.step as OnboardingStep) || (data.completeStep !== undefined && !onboardingSteps.includes(data.completeStep as OnboardingStep)) || (data.finish !== undefined && typeof data.finish !== 'boolean')) throw new Error('Choose a valid onboarding step.');
  if (data.finish && data.step !== 4) throw new Error('Review your profile before finishing.');
  const prior = current ?? emptyArtistOnboarding();
  return { version: 1, step: data.step as OnboardingStep, completedSteps: [...new Set([...prior.completedSteps, ...(data.completeStep ? [data.completeStep as OnboardingStep] : [])])].sort(), completedAt: prior.completedAt ?? (data.finish ? new Date().toISOString() : null) };
}
export function validStoredOnboarding(value: unknown): boolean {
  try { const v = object(value); keys(v, ['version', 'step', 'completedSteps', 'completedAt']); return v.version === 1 && onboardingSteps.includes(v.step as OnboardingStep) && Array.isArray(v.completedSteps) && v.completedSteps.every(s => onboardingSteps.includes(s)) && new Set(v.completedSteps).size === v.completedSteps.length && (v.completedAt === null || (typeof v.completedAt === 'string' && Number.isFinite(Date.parse(v.completedAt)))); } catch { return false; }
}
export function validateArtistLinks(value: unknown): ArtistExternalLink[] {
  if (!Array.isArray(value) || value.length > 6) throw new Error('Add up to six public links.');
  const links = new Map<string, ArtistExternalLink>();
  for (const entry of value) {
    const v = object(entry); keys(v, ['label', 'url']);
    if (typeof v.label !== 'string' || !v.label.trim() || v.label.length > 80 || /[\u0000-\u001f]/.test(v.label)) throw new Error('Give each link a label of 1–80 characters.');
    if (typeof v.url !== 'string' || v.url.length > 2048) throw new Error('Enter a valid public link.');
    let url: URL; try { url = new URL(v.url); } catch { throw new Error('Use a complete https:// or http:// link.'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !url.hostname) throw new Error('Use an https:// or http:// link without credentials.');
    links.set(url.href, { label: v.label.trim(), url: url.href });
  }
  return [...links.values()];
}
/** Original text is retained in storage; public reads project canonical professional roles. */
export type StoredArtist = Omit<Artist, 'creativeRoles' | 'identityReview' | 'genreSource'> & { creativeRoles?: string[]; legacyCreativeRoles?: string[] };
export type ArtistPreferences = {
  collaboration: {
    opportunityTypes: (typeof opportunityNeeds[number])[];
    creativeRoles: CreativeRole[];
    compensationKinds: Compensation['kind'][];
  };
  discovery: {
    genres: string[];
    genreIds?: MusicalGenre[];
    projectTypes: (typeof supportedProjectTypes[number])[];
    opportunityTypes: (typeof opportunityNeeds[number] | 'Funding')[];
  };
};
export type ArtistPreferencesUpdate = {
  collaboration?: Partial<ArtistPreferences['collaboration']>;
  discovery?: Partial<ArtistPreferences['discovery']>;
};
export const emptyArtistPreferences = (): ArtistPreferences => ({
  collaboration: { opportunityTypes: [], creativeRoles: [], compensationKinds: [] },
  discovery: { genres: [], projectTypes: [], opportunityTypes: [] },
});

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected profile data as an object.');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unsupported artist profile or preference field.');
}
function enumValue<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`Choose a supported ${name}.`);
  return value as T;
}
function values<T extends string>(value: unknown, allowed: readonly T[], name: string): T[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error(`${name} must be an array with at most 50 values.`);
  return [...new Set(value.map(item => enumValue(item, allowed, name)))];
}
export function normalizeArtistGenres(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error('Genres must be an array with at most 20 values.');
  const result = new Map<string, string>();
  for (const item of value) {
    if (typeof item !== 'string' || item.length > 120 || /[\u0000-\u001f\u007f]/u.test(item)) throw new Error('Each genre must be 1–120 characters of text.');
    const label = item.normalize('NFC').trim().replace(/\s+/g, ' ');
    if (!label) throw new Error('Choose a nonempty genre.');
    const key = label.toLowerCase();
    if (!result.has(key)) result.set(key, label);
  }
  return [...result.values()];
}
const roleIds = creativeRoleTaxonomy.map(role => role.id);
const professionalKeys = ['creativeRoles', 'genres', 'genreIds', 'collaborationAvailability', 'externalLinks', 'publicInterests'] as const;
export const artistProfileUpdateKeys = ['name', 'genre', 'basedIn', 'bio', 'recordLabel', 'picture', ...professionalKeys] as const;
export function validateArtistProfileKeys(value: unknown) { keys(object(value), artistProfileUpdateKeys); }
export function professionalIdentityUpdate(value: unknown): ArtistProfessionalIdentity {
  const data = object(value), result: ArtistProfessionalIdentity = {};
  if (data.creativeRoles !== undefined) result.creativeRoles = values(data.creativeRoles, roleIds, 'creative role');
  if (data.genres !== undefined) result.genres = normalizeArtistGenres(data.genres);
  if (data.genreIds !== undefined) result.genreIds = validateTaxonomyIds(data.genreIds, musicalGenreTaxonomy, 'genre', 20);
  if (data.collaborationAvailability !== undefined) result.collaborationAvailability = enumValue(data.collaborationAvailability, collaborationAvailabilityValues, 'availability');
  if (data.externalLinks !== undefined) result.externalLinks = validateArtistLinks(data.externalLinks);
  if (data.publicInterests !== undefined) result.publicInterests = values(data.publicInterests, publicArtistInterestValues, 'public interest');
  return result;
}
export function artistPreferencesUpdate(value: unknown): ArtistPreferencesUpdate {
  const data = object(value), result: ArtistPreferencesUpdate = {};
  keys(data, ['collaboration', 'discovery']);
  if (data.collaboration !== undefined) {
    const v = object(data.collaboration), patch: Partial<ArtistPreferences['collaboration']> = {};
    keys(v, ['opportunityTypes', 'creativeRoles', 'compensationKinds']);
    if (v.opportunityTypes !== undefined) patch.opportunityTypes = values(v.opportunityTypes, opportunityNeeds, 'collaboration type');
    if (v.creativeRoles !== undefined) patch.creativeRoles = values(v.creativeRoles, roleIds, 'creative role');
    if (v.compensationKinds !== undefined) patch.compensationKinds = values(v.compensationKinds, ['fee', 'split'] as const, 'compensation preference');
    result.collaboration = patch;
  }
  if (data.discovery !== undefined) {
    const v = object(data.discovery), patch: Partial<ArtistPreferences['discovery']> = {};
    keys(v, ['genres', 'genreIds', 'projectTypes', 'opportunityTypes']);
    if (v.genres !== undefined) patch.genres = normalizeArtistGenres(v.genres);
    if (v.genreIds !== undefined) patch.genreIds = validateTaxonomyIds(v.genreIds, musicalGenreTaxonomy, 'genre', 20);
    if (v.projectTypes !== undefined) patch.projectTypes = values(v.projectTypes, supportedProjectTypes, 'project type');
    if (v.opportunityTypes !== undefined) patch.opportunityTypes = values(v.opportunityTypes, [...opportunityNeeds, 'Funding'], 'opportunity preference');
    result.discovery = patch;
  }
  return result;
}
export function mergeArtistPreferences(current: ArtistPreferences | undefined, patch: ArtistPreferencesUpdate): ArtistPreferences {
  const previous = current ?? emptyArtistPreferences();
  return { collaboration: { ...previous.collaboration, ...patch.collaboration }, discovery: { ...previous.discovery, ...patch.discovery } };
}

/** Explicit public allowlist. Never spread a storage record into public responses. */
export function publicArtist(artist: StoredArtist): Artist {
  const roles = resolveLegacyTaxonomy(artist.creativeRoles ?? [], creativeRoleTaxonomy);
  const legacyGenres = artist.genres !== undefined ? artist.genres : artist.genre?.trim() ? [artist.genre] : [];
  const resolvedGenres = resolveLegacyTaxonomy(legacyGenres, musicalGenreTaxonomy);
  const allLegacyGenres = [...legacyGenres, ...(artist.genre?.trim() ? [artist.genre] : [])];
  return {
    id: artist.id, name: artist.name,
    ...(artist.username !== undefined ? { username: artist.username } : {}),
    picture: artist.picture, genre: artist.genre, basedIn: artist.basedIn, bio: artist.bio, recordLabel: artist.recordLabel,
    creativeRoles: roles.ids,
    // A legacy composite is one value; no inference, splitting or write-on-read.
    genres: [...legacyGenres],
    genreIds: artist.genreIds !== undefined ? [...artist.genreIds] : resolvedGenres.ids,
    genreSource: artist.genreIds !== undefined ? 'structured' : 'legacy',
    identityReview: {
      creativeRoles: [...new Set([...roles.unresolved, ...(artist.legacyCreativeRoles ?? [])])],
      genres: resolveLegacyTaxonomy(allLegacyGenres, musicalGenreTaxonomy).unresolved,
    },
    collaborationAvailability: artist.collaborationAvailability ?? 'unspecified',
    externalLinks: artist.externalLinks?.map(link => ({ ...link })) ?? [],
    publicInterests: [...(artist.publicInterests ?? [])],
  };
}

/** Fail closed on malformed new persisted fields; do not discard or reset data. */
export function validStoredProfessionalIdentity(value: Record<string, unknown>): boolean {
  try {
    // Original labels (including unknown ones) stay recoverable. Only canonical ID fields are strict.
    const labels = (v: unknown, max: number) => v === undefined || (Array.isArray(v) && v.length <= max && v.every(item => typeof item === 'string' && item.length <= 120));
    if (!labels(value.creativeRoles, 50) || !labels(value.genres, 20) || !labels(value.legacyCreativeRoles, 100)) return false;
    if (value.genreIds !== undefined && JSON.stringify(value.genreIds) !== JSON.stringify(validateTaxonomyIds(value.genreIds, musicalGenreTaxonomy, 'genre', 20))) return false;
    if (value.collaborationAvailability !== undefined) enumValue(value.collaborationAvailability, collaborationAvailabilityValues, 'availability');
    if (value.externalLinks !== undefined && JSON.stringify(value.externalLinks) !== JSON.stringify(validateArtistLinks(value.externalLinks))) return false;
    if (value.publicInterests !== undefined && JSON.stringify(value.publicInterests) !== JSON.stringify(values(value.publicInterests, publicArtistInterestValues, 'public interest'))) return false;
    return true;
  } catch { return false; }
}
export function validStoredArtistPreferences(value: unknown): boolean {
  try {
    const data = object(value), patch = artistPreferencesUpdate(data);
    const full = mergeArtistPreferences(undefined, patch);
    // Every stored nested field is present and canonical, regardless of key order.
    return ['collaboration', 'discovery'].every(group => {
      const stored = object(data[group]), canonical = full[group as keyof ArtistPreferences];
      return Object.keys(canonical).every(key => JSON.stringify(stored[key]) === JSON.stringify(canonical[key as keyof typeof canonical]));
    });
  } catch { return false; }
}
