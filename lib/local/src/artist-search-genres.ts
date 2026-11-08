import { musicalGenreTaxonomy, normalizeTaxonomyTerm, resolveLegacyTaxonomy, type MusicalGenre, type TaxonomyOption } from './artist-taxonomy.js';

/** Read-only provenance: publicArtist projects derived IDs for legacy profiles too. */
export type ArtistGenreSource = 'structured' | 'legacy';
type GenreInput = { genreIds?: readonly string[]; genreSource?: ArtistGenreSource; genres?: readonly string[]; genre?: string | null };
export type SearchableArtistGenre = { value: string; label: string; canonical: boolean; keywords: string };
const taxonomy = new Map<MusicalGenre, TaxonomyOption>(musicalGenreTaxonomy.map(genre => [genre.id, genre]));

/** Accept old labels/aliases at the boundary; compare stable IDs internally. Unknown text stays text. */
export function normalizeArtistGenreCriterion(value: string): string {
  return resolveLegacyTaxonomy([value], musicalGenreTaxonomy).ids[0] ?? value.trim();
}
export function artistGenreLabel(value: string): string {
  const option = taxonomy.get(normalizeArtistGenreCriterion(value) as MusicalGenre);
  return option?.label ?? `${value.trim()} (legacy text)`;
}
export function searchableArtistGenres(artist: GenreInput): SearchableArtistGenre[] {
  const structured = artist.genreSource === 'structured' || (artist.genreSource !== 'legacy' && artist.genreIds !== undefined);
  const legacy = artist.genres !== undefined ? artist.genres : artist.genre?.trim() ? [artist.genre] : [];
  const resolved = resolveLegacyTaxonomy(legacy, musicalGenreTaxonomy);
  const ids = structured ? artist.genreIds ?? [] : resolved.ids;
  const entries = new Map<string, SearchableArtistGenre>();
  for (const id of ids) {
    const option = taxonomy.get(id as MusicalGenre); if (!option) continue;
    const terms = [option.id, option.label, ...(option.aliases ?? [])];
    entries.set(option.id, { value: option.id, label: option.label, canonical: true, keywords: [...terms, ...terms.map(normalizeTaxonomyTerm)].join(' ') });
  }
  // No fallback at all for structured profiles, including an explicitly empty selection.
  if (!structured) for (const text of resolved.unresolved) {
    const key = normalizeTaxonomyTerm(text);
    if (!entries.has(key)) entries.set(key, { value: text, label: text, canonical: false, keywords: `${text} ${key}` });
  }
  return [...entries.values()];
}
export function artistGenreMatches(genres: SearchableArtistGenre[], value: string): boolean {
  const key = normalizeTaxonomyTerm(normalizeArtistGenreCriterion(value));
  return genres.some(genre => normalizeTaxonomyTerm(genre.value) === key);
}
export function artistSearchText(artist: GenreInput & { name: string }): string {
  return normalizeTaxonomyTerm([artist.name, ...searchableArtistGenres(artist).map(genre => genre.keywords)].join(' '));
}
export function artistSearchGenreLabel(artist: GenreInput): string {
  return searchableArtistGenres(artist).map(genre => artistGenreLabel(genre.value)).join(', ');
}
