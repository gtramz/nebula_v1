import { useRef, useState } from 'react';
import { Link } from 'wouter';
import { useMyArtistPreferences, useMyArtistOnboarding, useUpdateArtistIdentity, type Artist, type ArtistPreferences } from '@nebula/local';
import { useAuth } from '@/context/AuthContext';
import { useLeaveGuard } from '@/components/shell/navigation-guard';
import { controlStyles, Panel } from '@/components/antiq/workspace';
import { profileValues, preferenceValues, IdentityFields, CreativeFields, CompletionFields, PreferenceFields, LegacyIdentityValues } from './fields';

// Arrays are one field; private preference groups are diffed separately.
function changedFields<T extends object>(next: T, original: T): Partial<T> {
  return Object.fromEntries(Object.entries(next).filter(([key, value]) =>
    JSON.stringify(value) !== JSON.stringify(original[key as keyof T]))) as Partial<T>;
}

export function ArtistCompletionPrompt() {
  const query = useMyArtistOnboarding();
  if (query.isError) return <p role="alert" className="text-sm">Profile setup status is unavailable. <button className={controlStyles.button} onClick={() => void query.refetch()}>Retry setup status</button></p>;
  if (!query.data || query.data.completedAt) return null;
  return <Panel><h2 className="text-xl font-bold">Make your profile yours.</h2><p className="text-sm text-muted">Add your creative identity at your own pace. Your account is ready to use; every setup step is optional.</p><Link href="/onboarding" className={controlStyles.button}>{query.data.completedSteps.length || query.data.step > 1 ? 'Resume artist setup' : 'Complete your artist profile'}</Link></Panel>;
}
export function ArtistIdentityEditor({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const preferences = useMyArtistPreferences();
  if (preferences.isLoading) return <p role="status">Loading your profile preferences…</p>;
  if (!preferences.data) return <Panel><p role="alert">{preferences.error?.message ?? 'Profile preferences are unavailable.'}</p><button className={controlStyles.button} onClick={() => void preferences.refetch()}>Retry preferences</button><button className={controlStyles.button} onClick={onClose}>cancel</button></Panel>;
  return <>{preferences.isError && <p role="alert">Preferences could not refresh. Your edits remain here. <button className={controlStyles.button} onClick={() => void preferences.refetch()}>Retry preferences</button></p>}<EditorForm key={user!.artistId} artist={user!.artist!} preferences={preferences.data} onClose={onClose} /></>;
}
function EditorForm({ artist, preferences, onClose }: { artist: Artist; preferences: ArtistPreferences; onClose: () => void }) {
  const [profile, setProfile] = useState(() => profileValues(artist)), [privateValues, setPrivateValues] = useState(() => preferenceValues(preferences));
  const baseline = useRef({ profile: structuredClone(artist), preferences: structuredClone(preferences), values: structuredClone(profile), privateValues: structuredClone(privateValues) });
  const initial = useRef(JSON.stringify([profile, privateValues])), update = useUpdateArtistIdentity();
  const release = useLeaveGuard(update.isPending || initial.current !== JSON.stringify([profile, privateValues]) ? 'Leave without saving your profile changes?' : null);
  return <Panel className="p-6 lg:p-10 space-y-8">
    <div className="flex items-center justify-between gap-4"><h2 className="text-2xl font-bold">edit artist profile</h2><button type="button" disabled={update.isPending} className={controlStyles.button} onClick={onClose}>cancel</button></div>
    <form className="space-y-8" onSubmit={event => { event.preventDefault();
      update.mutate({ data: { profile: changedFields(profile, baseline.current.values), preferences: { collaboration: changedFields(privateValues.collaboration, baseline.current.privateValues.collaboration), discovery: changedFields(privateValues.discovery, baseline.current.privateValues.discovery) }, expected: { profile: baseline.current.profile, preferences: baseline.current.preferences } } }, { onSuccess: () => { release(); onClose(); } }); }}>
      <fieldset disabled={update.isPending} className="min-w-0 space-y-8">
        <section className="space-y-5"><h3 className="text-xl font-semibold">Public identity</h3><IdentityFields value={profile} onChange={setProfile} /></section>
        <CreativeFields value={profile} onChange={setProfile} disabled={update.isPending} />
        <LegacyIdentityValues artist={artist} />
        <details className="border-t border-border pt-4"><summary className="min-h-11 flex items-center cursor-pointer font-semibold">Public details & links</summary><div className="pt-5"><CompletionFields value={profile} onChange={setProfile} disabled={update.isPending} /></div></details>
        <details className="border-t border-border pt-4"><summary className="min-h-11 flex items-center cursor-pointer font-semibold">Private discovery & collaboration preferences</summary><div className="pt-5"><PreferenceFields value={privateValues} onChange={setPrivateValues} disabled={update.isPending} /></div></details>
        {update.error && <p role="alert" className="text-sm text-danger">{update.error.message}</p>}
        <button type="submit" className={`${controlStyles.primary} w-full`}>{update.isPending ? 'saving...' : 'save profile'}</button>
      </fieldset>
    </form>
  </Panel>;
}
