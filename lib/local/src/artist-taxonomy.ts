export type TaxonomyOption = { id: string; label: string; category?: string; parentId?: string; aliases?: readonly string[] };

/** Stable IDs are independent of labels and of collaboration opportunity needs. */
export const creativeRoleTaxonomy = [
  { id: 'vocalist', label: 'Vocalist', category: 'Performance', aliases: ['Singer'] },
  { id: 'rapper', label: 'Rapper', category: 'Performance' },
  { id: 'singer-songwriter', label: 'Singer-Songwriter', category: 'Performance' },
  { id: 'instrumentalist', label: 'Instrumentalist', category: 'Performance' },
  { id: 'session-musician', label: 'Session Musician', category: 'Performance' },
  // Preserve the Phase 1.1 producer ID; Music Producer is a label change only.
  { id: 'producer', label: 'Music Producer', category: 'Production', aliases: ['Producer'] },
  { id: 'beatmaker', label: 'Beatmaker', category: 'Production', aliases: ['Beat Maker'] },
  { id: 'recording-engineer', label: 'Recording Engineer', category: 'Production' },
  { id: 'mixing-engineer', label: 'Mixing Engineer', category: 'Production', aliases: ['Mix Engineer'] },
  { id: 'mastering-engineer', label: 'Mastering Engineer', category: 'Production' },
  { id: 'songwriter', label: 'Songwriter', category: 'Composition' },
  { id: 'composer', label: 'Composer', category: 'Composition' },
  { id: 'lyricist', label: 'Lyricist', category: 'Composition' },
  { id: 'arranger', label: 'Arranger', category: 'Composition' },
  { id: 'dj', label: 'DJ', category: 'Other creative roles', aliases: ['Disc Jockey'] },
  { id: 'sound-designer', label: 'Sound Designer', category: 'Other creative roles' },
  { id: 'music-director', label: 'Music Director', category: 'Other creative roles' },
] as const satisfies readonly TaxonomyOption[];
export type CreativeRole = typeof creativeRoleTaxonomy[number]['id'];

/** Artist identity vocabulary. Parent links aid browsing; they do not imply selections. */
export const musicalGenreTaxonomy = [
  { id: 'hip-hop', label: 'Hip-hop', aliases: ['Hip hop', 'Hiphop'] },
  { id: 'trap', label: 'Trap', parentId: 'hip-hop' },
  { id: 'rnb', label: 'R&B', aliases: ['RnB', 'R and B', 'Rhythm and Blues'] },
  { id: 'soul', label: 'Soul' },
  { id: 'pop', label: 'Pop' },
  { id: 'synth-pop', label: 'Synth-pop', parentId: 'pop', aliases: ['Synthpop'] },
  { id: 'rock', label: 'Rock' },
  { id: 'indie-rock', label: 'Indie Rock', parentId: 'rock' },
  { id: 'metal', label: 'Metal' },
  { id: 'punk', label: 'Punk' },
  { id: 'electronic', label: 'Electronic', aliases: ['Electronica', 'Electrónica', 'Electronic Music'] },
  { id: 'house', label: 'House', parentId: 'electronic' },
  { id: 'deep-house', label: 'Deep House', parentId: 'house' },
  { id: 'tech-house', label: 'Tech House', parentId: 'house' },
  { id: 'techno', label: 'Techno', parentId: 'electronic' },
  { id: 'ambient', label: 'Ambient', parentId: 'electronic' },
  { id: 'drum-and-bass', label: 'Drum and Bass', parentId: 'electronic', aliases: ['Drum & Bass', 'DnB', 'D&B'] },
  { id: 'dubstep', label: 'Dubstep', parentId: 'electronic' },
  { id: 'indie', label: 'Indie' },
  { id: 'alternative', label: 'Alternative', aliases: ['Alternativa'] },
  { id: 'jazz', label: 'Jazz' },
  { id: 'classical', label: 'Classical', aliases: ['Clásica', 'Classical Music'] },
  { id: 'reggaeton', label: 'Reggaeton', aliases: ['Reguetón', 'Reggaetón'] },
  { id: 'latin', label: 'Latin', aliases: ['Latino', 'Latin Music'] },
  { id: 'latin-pop', label: 'Latin Pop', parentId: 'latin', aliases: ['Pop Latino'] },
  { id: 'regional-mexican', label: 'Regional Mexican', aliases: ['Regional Mexicano', 'Música Regional Mexicana'] },
  { id: 'banda', label: 'Banda', parentId: 'regional-mexican' },
  { id: 'norteno', label: 'Norteño', parentId: 'regional-mexican' },
  { id: 'corridos', label: 'Corridos', parentId: 'regional-mexican' },
  { id: 'cumbia', label: 'Cumbia' },
  { id: 'salsa', label: 'Salsa' },
  { id: 'bachata', label: 'Bachata' },
  { id: 'funk', label: 'Funk' },
  { id: 'disco', label: 'Disco' },
  { id: 'blues', label: 'Blues' },
  { id: 'folk', label: 'Folk' },
  { id: 'country', label: 'Country' },
  { id: 'reggae', label: 'Reggae' },
  { id: 'afrobeats', label: 'Afrobeats' },
  { id: 'gospel', label: 'Gospel' },
] as const satisfies readonly TaxonomyOption[];
export type MusicalGenre = typeof musicalGenreTaxonomy[number]['id'];
export const normalizeTaxonomyTerm = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[-_]/g, ' ').replace(/\s+/g, ' ');

export function validateTaxonomyIds<T extends string>(value: unknown, options: readonly { id: T }[], name: string, limit = 50): T[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error(`${name} must be an array with at most ${limit} values.`);
  const allowed = new Set<string>(options.map(option => option.id));
  if (value.some(id => typeof id !== 'string' || !allowed.has(id))) throw new Error(`Unknown ${name} identifier. Choose an option from the list.`);
  return [...new Set(value)] as T[];
}

/** Exact normalized aliases only. No fuzzy matching, composite splitting or role/need inference. */
export function resolveLegacyTaxonomy<T extends string>(values: readonly string[], options: readonly (TaxonomyOption & { id: T })[]) {
  const index = new Map<string, T | null>();
  for (const option of options) for (const label of [option.id, option.label, ...(option.aliases ?? [])]) {
    const key = normalizeTaxonomyTerm(label);
    if (!index.has(key)) index.set(key, option.id);
    else if (index.get(key) !== option.id) index.set(key, null); // ambiguous aliases remain unresolved
  }
  const ids = new Set<T>(), unresolved = new Set<string>();
  for (const value of values) {
    const id = index.get(normalizeTaxonomyTerm(value));
    if (id) ids.add(id); else if (value.trim()) unresolved.add(value);
  }
  return { ids: [...ids], unresolved: [...unresolved] };
}
