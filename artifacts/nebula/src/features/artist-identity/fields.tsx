import type { Dispatch, SetStateAction } from 'react';
import { creativeRoleTaxonomy, musicalGenreTaxonomy, collaborationAvailabilityValues, publicArtistInterestValues, opportunityNeeds, supportedProjectTypes, resolveLegacyTaxonomy, type Artist, type ArtistProfileInput, type ArtistPreferences, type Compensation } from '@nebula/local';
import { TaxonomyMultiSelect } from '@/components/antiq/taxonomy-multi-select';
import { ImageUpload } from '@/components/image-upload';
import { controlStyles } from '@/components/antiq/workspace';

export const availabilityLabels = { unspecified: 'Not specified', open: 'Open to collaboration', limited: 'Limited availability', unavailable: 'Not available for collaboration' };
export const needOptions = opportunityNeeds.map(id => ({ id, label: id }));
export const interestOptions = publicArtistInterestValues.map(id => ({ id, label: id }));
const compensationOptions: { id: Compensation['kind']; label: string }[] = [{ id: 'fee', label: 'Fixed payment (USD)' }, { id: 'split', label: 'Royalty share' }];
export function profileValues(artist: Artist): ArtistProfileInput {
  return { name: artist.name, picture: artist.picture ?? null, bio: artist.bio ?? '', basedIn: artist.basedIn ?? '', recordLabel: artist.recordLabel ?? '', creativeRoles: artist.creativeRoles ?? [], genreIds: artist.genreIds ?? [], externalLinks: artist.externalLinks ?? [], publicInterests: artist.publicInterests ?? [], collaborationAvailability: artist.collaborationAvailability ?? 'unspecified' };
}
export function preferenceValues(preferences: ArtistPreferences): ArtistPreferences {
  return { collaboration: { ...preferences.collaboration }, discovery: { ...preferences.discovery, genreIds: preferences.discovery.genreIds ?? resolveLegacyTaxonomy(preferences.discovery.genres, musicalGenreTaxonomy).ids } };
}
export type ProfileFieldsProps = { value: ArtistProfileInput; onChange: Dispatch<SetStateAction<ArtistProfileInput>>; disabled?: boolean };
export function IdentityFields({ value, onChange }: ProfileFieldsProps) {
  return <div className="space-y-5">
    <label className="block space-y-2"><span className="voice text-[10px] text-muted">artist name</span><input required minLength={2} maxLength={120} className={controlStyles.field} value={value.name} onChange={e => onChange(v => ({ ...v, name: e.target.value }))} /></label>
    <label className="block space-y-2"><span className="voice text-[10px] text-muted">bio</span><textarea rows={4} maxLength={4000} className={controlStyles.field} value={value.bio ?? ''} onChange={e => onChange(v => ({ ...v, bio: e.target.value }))} /></label>
    <ImageUpload label="PROFILE IMAGE" value={value.picture} onChange={picture => onChange(v => ({ ...v, picture }))} />
  </div>;
}
export function CreativeFields({ value, onChange, disabled }: ProfileFieldsProps) {
  return <div className="space-y-6">
    <TaxonomyMultiSelect label="Creative roles" options={creativeRoleTaxonomy} selected={value.creativeRoles ?? []} onChange={creativeRoles => onChange(v => ({ ...v, creativeRoles }))} disabled={disabled} />
    <TaxonomyMultiSelect label="Musical genres" options={musicalGenreTaxonomy} selected={value.genreIds ?? []} onChange={genreIds => onChange(v => ({ ...v, genreIds }))} maxSelections={20} disabled={disabled} />
    <p className="text-sm text-muted">These describe your work. You can collaborate in any role or genre.</p>
  </div>;
}
export function PreferenceFields({ value, onChange, disabled }: { value: ArtistPreferences; onChange: Dispatch<SetStateAction<ArtistPreferences>>; disabled?: boolean }) {
  return <div className="space-y-6">
    <p className="text-sm text-muted">Private preferences. Choose what you want to explore, independently of your public identity. Home For You uses these preferences to order eligible opportunities.</p>
    <TaxonomyMultiSelect label="Opportunities to discover" options={interestOptions} selected={value.discovery.opportunityTypes} onChange={opportunityTypes => onChange(v => ({ ...v, discovery: { ...v.discovery, opportunityTypes } }))} disabled={disabled} />
    <TaxonomyMultiSelect label="Roles I want to perform" options={creativeRoleTaxonomy} selected={value.collaboration.creativeRoles} onChange={creativeRoles => onChange(v => ({ ...v, collaboration: { ...v.collaboration, creativeRoles } }))} disabled={disabled} />
    <TaxonomyMultiSelect label="Genres to explore" options={musicalGenreTaxonomy} selected={value.discovery.genreIds ?? []} onChange={genreIds => onChange(v => ({ ...v, discovery: { ...v.discovery, genreIds } }))} maxSelections={20} disabled={disabled} />
    <TaxonomyMultiSelect label="Compensation preferences" options={compensationOptions} selected={value.collaboration.compensationKinds} onChange={compensationKinds => onChange(v => ({ ...v, collaboration: { ...v.collaboration, compensationKinds } }))} disabled={disabled} />
    <TaxonomyMultiSelect label="Collaboration interests" options={needOptions} selected={value.collaboration.opportunityTypes} onChange={opportunityTypes => onChange(v => ({ ...v, collaboration: { ...v.collaboration, opportunityTypes } }))} disabled={disabled} />
    <TaxonomyMultiSelect label="Project interests" options={supportedProjectTypes.map(id => ({ id, label: id === 'ep' ? 'EP' : id[0].toUpperCase() + id.slice(1) }))} selected={value.discovery.projectTypes} onChange={projectTypes => onChange(v => ({ ...v, discovery: { ...v.discovery, projectTypes } }))} disabled={disabled} />
    {!!value.discovery.genres.length && <details className="border border-border p-4 text-sm"><summary className="min-h-11 cursor-pointer">Previous private genre preferences</summary><p className="break-words">{value.discovery.genres.join(', ')}</p><p className="text-muted mt-2">Preserved for review. They are not shown on your public profile.</p></details>}
  </div>;
}
export function CompletionFields({ value, onChange, disabled }: ProfileFieldsProps) {
  const links = value.externalLinks ?? [];
  return <div className="space-y-6">
    <label className="block space-y-2"><span>Collaboration availability</span><select aria-label="Collaboration availability" className={controlStyles.field} value={value.collaborationAvailability ?? 'unspecified'} onChange={e => onChange(v => ({ ...v, collaborationAvailability: e.target.value as ArtistProfileInput['collaborationAvailability'] }))}>{collaborationAvailabilityValues.map(id => <option key={id} value={id}>{availabilityLabels[id]}</option>)}</select></label>
    {([['basedIn', 'based in'], ['recordLabel', 'record label']] as const).map(([key, label]) => <label key={key} className="block space-y-2"><span>{label}</span><input aria-label={label} className={controlStyles.field} maxLength={120} value={value[key] ?? ''} onChange={e => onChange(v => ({ ...v, [key]: e.target.value }))} /><span className="block text-xs text-muted">Public when provided. Leave blank to keep it off your profile.</span></label>)}
    <TaxonomyMultiSelect label="Public professional interests" options={interestOptions} selected={value.publicInterests ?? []} onChange={publicInterests => onChange(v => ({ ...v, publicInterests }))} disabled={disabled} />
    <p className="text-xs text-muted">Only the interests selected above are public. Your private preferences remain separate.</p>
    <div className="space-y-4" role="group" aria-label="Public external links">
      <p className="font-medium">External links <span className="text-muted text-sm">· public · up to 6</span></p>
      {links.map((link, index) => <div key={index} className="space-y-3 rounded-field border border-border p-4">
        <label className="block space-y-2"><span>Link {index + 1} label</span><input required maxLength={80} className={controlStyles.field} value={link.label} onChange={e => onChange(v => ({ ...v, externalLinks: links.map((item, i) => i === index ? { ...item, label: e.target.value } : item) }))} /></label>
        <label className="block space-y-2"><span>Link {index + 1} URL</span><input required type="url" placeholder="https://" maxLength={2048} className={controlStyles.field} value={link.url} onChange={e => onChange(v => ({ ...v, externalLinks: links.map((item, i) => i === index ? { ...item, url: e.target.value } : item) }))} /></label>
        <button type="button" className={controlStyles.button} onClick={() => onChange(v => ({ ...v, externalLinks: links.filter((_, i) => i !== index) }))}>Remove link {index + 1}</button>
      </div>)}
      <button type="button" disabled={links.length >= 6} className={controlStyles.button} onClick={() => onChange(v => ({ ...v, externalLinks: [...links, { label: '', url: '' }] }))}>Add link</button>
    </div>
  </div>;
}
export function LegacyIdentityValues({ artist }: { artist: Artist }) {
  if (!artist.genre && !artist.genres?.length && !artist.identityReview?.creativeRoles.length) return null;
  return <details className="border border-border rounded-field p-4 text-sm space-y-3"><summary className="min-h-11 flex items-center cursor-pointer text-muted">Previous profile values</summary>
    {artist.genre && <p className="break-words">Previous genre: {artist.genre}</p>}
    {!!artist.genres?.length && <p className="break-words">Previous genres: {artist.genres.join(', ')}</p>}
    {!!artist.identityReview?.creativeRoles.length && <p className="break-words">Roles kept for review: {artist.identityReview.creativeRoles.join(', ')}</p>}
    {!!artist.identityReview?.genres.length && <p className="break-words">Genres kept for review: {artist.identityReview.genres.join(', ')}</p>}
    <p className="text-muted">Previous values are preserved. Unrecognized or combined labels are not assigned automatically.</p>
  </details>;
}
