import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useMyArtistPreferences, useMyArtistOnboarding, useUpdateArtistIdentity, creativeRoleTaxonomy, musicalGenreTaxonomy, type Artist, type ArtistPreferences, type ArtistOnboarding, type ArtistIdentityUpdate, type OnboardingStep } from '@nebula/local';
import { useAuth } from '@/context/AuthContext';
import { ContentWidth } from '@/components/shell/app-shell';
import { controlStyles, Panel } from '@/components/antiq/workspace';
import { useLeaveGuard } from '@/components/shell/navigation-guard';
import { IdentityFields, CreativeFields, PreferenceFields, CompletionFields, profileValues, preferenceValues } from './fields';

const steps = ['Identity', 'Creative identity', 'Interests & preferences', 'Profile completion'];
export default function ArtistOnboardingPage() {
  const { user } = useAuth();
  if (!user) return <ContentWidth className="py-12 space-y-5"><h1 className="text-3xl font-bold">Artist setup</h1><p>Log in to resume your artist profile.</p><Link className={controlStyles.primary} href="/login">Log in</Link></ContentWidth>;
  if (user.role !== 'artist') return <ContentWidth className="py-12 space-y-5"><h1 className="text-3xl font-bold">Artist setup</h1><p>This setup is for artist accounts.</p><Link className={controlStyles.button} href="/profile">Back to profile</Link></ContentWidth>;
  return <LoadSetup key={user.artistId} artist={user.artist!} />;
}
function LoadSetup({ artist }: { artist: Artist }) {
  const preferences = useMyArtistPreferences(), onboarding = useMyArtistOnboarding();
  if (preferences.isLoading || onboarding.isLoading) return <ContentWidth className="py-12"><p role="status">Loading your saved progress…</p></ContentWidth>;
  if (!preferences.data || !onboarding.data) return <ContentWidth className="py-12 space-y-4"><p role="alert">{preferences.error?.message ?? onboarding.error?.message ?? 'Could not load your progress.'}</p><button className={controlStyles.button} onClick={() => { void preferences.refetch(); void onboarding.refetch(); }}>Retry setup</button></ContentWidth>;
  return <>{(preferences.isError || onboarding.isError) && <p role="alert" className="p-4">Saved progress could not refresh. Your current edits remain here. <button className={controlStyles.button} onClick={() => { void preferences.refetch(); void onboarding.refetch(); }}>Retry setup</button></p>}<Setup artist={artist} preferences={preferences.data} onboarding={onboarding.data} /></>;
}
function Setup({ artist, preferences, onboarding }: { artist: Artist; preferences: ArtistPreferences; onboarding: ArtistOnboarding }) {
  const [, navigate] = useLocation();
  const [step, setStep] = useState<OnboardingStep>(onboarding.step), [profile, setProfile] = useState(() => profileValues(artist)), [privateValues, setPrivateValues] = useState(() => preferenceValues(preferences));
  const initial = useRef(JSON.stringify([profile, privateValues])), title = useRef<HTMLHeadingElement>(null);
  const update = useUpdateArtistIdentity(), [saved, setSaved] = useState('');
  const dirty = initial.current !== JSON.stringify([profile, privateValues]);
  const release = useLeaveGuard(update.isPending || dirty ? 'Leave without saving this setup step? Previously saved steps are safe.' : null);
  useEffect(() => { title.current?.focus({ preventScroll: true }); title.current?.scrollIntoView({ block: 'start', behavior: 'instant' }); }, [step]);
  function patch(): ArtistIdentityUpdate {
    if (step === 1) return { profile: { name: profile.name, picture: profile.picture, bio: profile.bio } };
    if (step === 2) return { profile: { name: profile.name, creativeRoles: profile.creativeRoles, genreIds: profile.genreIds } };
    if (step === 3) return { preferences: privateValues };
    return { profile: { name: profile.name, basedIn: profile.basedIn, recordLabel: profile.recordLabel, externalLinks: profile.externalLinks, publicInterests: profile.publicInterests, collaborationAvailability: profile.collaborationAvailability } };
  }
  function save(action: 'next' | 'back' | 'exit' | 'skip') {
    if (update.isPending) return;
    if (action === 'skip' && dirty && !window.confirm('Skip without saving this step? Previously saved information will remain.')) return;
    const next = action === 'back' ? Math.max(1, step - 1) : action === 'exit' ? step : Math.min(4, step + 1);
    const finish = step === 4 && action === 'next';
    update.mutate({ data: { ...(action === 'skip' ? {} : patch()), onboarding: { step: next as OnboardingStep, ...(action === 'next' ? { completeStep: step } : {}), ...(finish ? { finish: true } : {}) } } }, { onSuccess: result => {
      const nextProfile = profileValues(result.artist), nextPreferences = preferenceValues(result.preferences);
      initial.current = JSON.stringify([nextProfile, nextPreferences]); setProfile(nextProfile); setPrivateValues(nextPreferences); release();
      setSaved('Progress saved.');
      if (finish || action === 'exit') navigate('/profile'); else setStep(next as OnboardingStep);
    } });
  }
  return <ContentWidth className="py-8 md:py-12 space-y-6 pb-16">
    <div className="flex flex-wrap justify-between gap-3 items-center"><span className="voice text-xs text-accent">ARTIST SETUP / {step} OF 4</span><Link className={controlStyles.button} href="/profile">Back to profile</Link></div>
    <div><h1 ref={title} tabIndex={-1} className="text-3xl md:text-4xl font-bold outline-none">{steps[step - 1]}</h1><p className="text-muted mt-3">Your account is ready. Add what matters to you, and come back anytime.</p></div>
    <ol className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs" aria-label="Artist setup progress">{steps.map((label, index) => <li key={label} aria-current={step === index + 1 ? 'step' : undefined} className={`border-t-2 pt-3 ${step === index + 1 ? 'border-accent text-ink' : 'border-border text-muted'}`}>{index + 1}. {label}</li>)}</ol>
    <Panel>
      <form className="space-y-8" onSubmit={event => { event.preventDefault(); save('next'); }}>
        <fieldset disabled={update.isPending} className="space-y-6 min-w-0">
          {step === 1 && <IdentityFields value={profile} onChange={setProfile} />}
          {step === 2 && <CreativeFields value={profile} onChange={setProfile} disabled={update.isPending} />}
          {step === 3 && <PreferenceFields value={privateValues} onChange={setPrivateValues} disabled={update.isPending} />}
          {step === 4 && <><CompletionFields value={profile} onChange={setProfile} disabled={update.isPending} /><section aria-label="Profile review" className="border-t border-border pt-5 space-y-3"><h2 className="text-xl font-bold">Review your profile</h2><p className="text-lg font-semibold">{profile.name}</p><p className="whitespace-pre-wrap break-words">{profile.bio || 'No biography added.'}</p><p>{profile.creativeRoles?.map(id => creativeRoleTaxonomy.find(r => r.id === id)?.label).join(' · ') || 'No creative roles selected.'}</p><p>{profile.genreIds?.map(id => musicalGenreTaxonomy.find(g => g.id === id)?.label).join(' · ') || 'No musical genres selected.'}</p><p className="text-sm text-muted">Discovery and collaboration preferences stay private. Music, projects and portfolio uploads are optional.</p></section></>}
          {update.error && <p role="alert" className="text-danger">{update.error.message}</p>}
          <p role="status" className="text-sm text-muted">{update.isPending ? 'Saving your progress…' : saved}</p>
          <div className="flex flex-wrap gap-3">
            {step > 1 && <button type="button" className={controlStyles.button} onClick={() => save('back')}>Save & previous step</button>}
            <button type="submit" className={controlStyles.primary}>{step === 4 ? 'Finish setup' : 'Save & continue'}</button>
            {step < 4 && <button type="button" className={controlStyles.button} onClick={() => save('skip')}>Skip this step</button>}
            <button type="button" className={controlStyles.button} onClick={() => save('exit')}>{dirty ? 'Save and exit' : 'Skip for now'}</button>
          </div>
        </fieldset>
      </form>
    </Panel>
  </ContentWidth>;
}
