# Artist profile and onboarding — Phase 1.2

> Historical phase snapshot. For current status, superseding features and consolidated verification, see [Manuel release handoff](manuel-release-handoff.md). Earlier deferred items may now be implemented; the current operation inventory is [integration-contracts.md](integration-contracts.md).

## Delivered experience

One existing Artist identity now connects registration, optional four-step onboarding, the private `/profile` editor and the public `/artist/:id` page. Artist and Investor remain separate account types. New artists enter `/onboarding` after the existing registration succeeds; Investors retain their existing `/explore` destination and private profile. Login, password handling, cookies, permissions and account creation are unchanged.

Existing artists see an optional completion/resume card in `/profile`. Setup completion is separate from profile completeness: artists can finish with no music, projects, biography, image, roles or genres. Registration already provides their required account name. No additional artist record is created. No existing account is automatically rewritten or forced through setup.

The public profile uses Nebula's existing sidebar/bottom navigation, typography, controls and project cards. Its header contains the real image/name, stored username only when available, biography, canonical role/genre labels, public project count, public location and self-declared availability. Owners can open **Edit Profile**. A bounded role/genre summary keeps the header usable; About contains the full selection. There are no invented follower counts, Follow buttons or general Message actions.

| Section | Source and behavior |
| --- | --- |
| Music (default) | Published audio posts owned by the artist and linked to the same artist's visible Single, EP or Album projects. Reuses `DiscoveryMedia`, with explicit playback, track selection, source-post and project links. Clearly labeled **project audio**. |
| Discovery Posts | Paginated published audio/video from that artist, independent or linked to projects. Responsive grid links to the original post and existing engagement behavior. Drafts are excluded even for the owner. |
| Projects | Existing project cards grouped into open opportunities, other public projects, and closed projects. Closed is not labeled released or completed. Archived projects and private drafts are excluded. |
| Collaborations | Honest empty state because public credit attribution is not modeled. Owners can open their existing private workspace. No private conversations, proposals, deliveries or agreement terms are fetched for this section. |
| About | Full biography, canonical roles/genres, publicly shared location/label, public links, availability and explicitly selected public professional interests. |

Music and Discovery can reference the same publication, but share its existing ID, file and interactions; no duplicate records are created. No track list is inferred for an EP/Album and no artist is credited with another artist's work merely because they participated in a project.

## Onboarding and editing

The editor and onboarding reuse `IdentityFields`, `CreativeFields`, `PreferenceFields` and `CompletionFields`, the existing image upload mechanism, the 17-role/40-genre catalogs, and `TaxonomyMultiSelect`.

1. **Identity:** artist name, optional picture and biography.
2. **Creative identity:** multiple professional roles and musical genres, with existing canonical IDs. No single-role assumption or free-text taxonomy creation.
3. **Interests & preferences:** private opportunity needs, genres to explore, roles to perform, fixed-payment/royalty preferences, collaboration needs and existing project types. Public identity and private discovery preferences remain independent.
4. **Profile completion:** optional external links, availability, public location/label and explicitly public professional interests. Review includes the public name, bio, roles and genres. No upload requirement.

Each Save/Continue persists only the current step's profile or preference fields and progress together. Save/Previous saves before returning. Skip This Step preserves previously stored values; discarding unsaved edits asks for confirmation. Skip For Now / Save And Exit leaves the account usable and allows resuming from `/profile`. Errors retain the current edits and provide a retry. Background refresh failures do not unmount dirty forms. A navigation guard protects unsaved edits, and the current heading receives focus on step changes.

The private editor exposes all public fields plus private discovery/collaboration preferences. Saved public changes appear on the public page. Its existing projects, publications, collaboration workspace, saved items, activity, received funding and logout remain available. Existing legacy taxonomy values remain preserved for review; editing canonical selections does not overwrite legacy genre fields or infer new private preferences.

## Data and transport contract

This extends [Phase 1.1 identity](artist-identity-phase-1-1.md) and the [structured taxonomy extension](artist-taxonomy-extension.md). It adds optional fields to the same v3 state, not a new database table, migration, account system or media store.

| Stored location | Fields | Visibility |
| --- | --- | --- |
| Existing Artist | Existing name, picture, bio, username, `creativeRoles`, `genreIds`, `basedIn`, `recordLabel`, `collaborationAvailability` | Public projection; username remains read-only in this UI. |
| Existing Artist | New optional `externalLinks: { label, url }[]` and `publicInterests: PublicArtistInterest[]` | Explicit public fields. Never derived from private preferences. |
| Existing account `artistPreferences` | Existing discovery/collaboration preferences, including canonical private genre/role IDs | Current artist only. |
| Existing account `artistOnboarding` | Optional `{ version: 1, step: 1..4, completedSteps: (1..4)[], completedAt: string \| null }` | Current artist only; progress metadata, not a copy of profile fields. |

External links allow at most six entries, labels of 1–80 characters and URLs up to 2,048 characters. Only HTTP(S) without embedded credentials is accepted; URLs are normalized and deduplicated. Links open with `noopener noreferrer`. The server does not fetch them. Public interests use the existing opportunity needs (`Verse`, `Feature`, `Production`, `Mix`, `Master`) plus `Funding`; these are interests, not additional professional roles or financial agreements.

New additive operations use the existing `POST /api/rpc` transport:

- `getPublicArtist(id)` returns `{ artist, projects, opportunityProjectIds }`. It always projects public visibility, including when called by the owner, without private aggregate financial summaries. Public project cards retain their existing public funding data. Existing `getArtist` remains available to private management with its previous owner visibility.
- `getMyArtistOnboarding()` returns the current artist's progress; missing progress gets an in-memory default without a write.
- `updateArtistIdentity({ profile?, preferences?, onboarding? })` validates the entire request and commits one existing state write. The caller cannot supply an owner. It returns the caller's updated public Artist, private preferences and progress. The existing `updateArtist` and preference RPC methods remain supported.

Example of saving creative identity and continuing:

```json
{
  "method": "updateArtistIdentity",
  "args": [{
    "profile": { "name": "Artist name", "creativeRoles": ["producer", "vocalist"], "genreIds": ["hip-hop", "rnb"] },
    "onboarding": { "step": 3, "completeStep": 2 }
  }]
}
```

`onboarding` accepts `step`, optional `completeStep`, and optional `finish: true` only at step 4. Completion timestamps are generated by the store; callers cannot forge stored metadata. Fields omitted from profile/preferences remain unchanged. Empty arrays explicitly clear their fields. The server validates authentication, Artist role, request origin/CSRF, allowed fields, taxonomy IDs, lengths, links and progress. A validation failure does not partially save the other sections.

The existing `GET /api/publications` read gains optional `artistId` and `projectAudio=1` parameters. `projectAudio` requires an artist; `artistId` cannot combine with `mine=1`. Filtering by real ownership, publication status, media kind and visible musical project relationship happens **before** the existing 20-result cursor pagination. Artist-scoped DTOs use public visibility even for the owner, so linked private project metadata is not exposed. General Discovery and the private publications query keep their previous behavior.

Server mode persists through the existing SQLite-backed local state and serialization. Browser-only mode reuses local storage, recovery and the write lock. Its profile/editor/onboarding work offline, while real server-backed publications remain unavailable there and receive an honest empty state. Browser-only storage is not a security boundary against someone controlling the browser. Explicit browser-to-server identity transfer includes the new public fields; it still does not transfer private preferences, onboarding progress or projects automatically.

## Privacy and integration boundaries

- Public Artist projection excludes account credentials, email, private preferences and onboarding metadata. The existing RPC envelope may contain the **caller's own session**; that does not make another artist's private identity public.
- Only explicit public project statuses (`published`, `funding`, `funded`, `closed`) qualify; draft/archived projects are excluded even on the owner's public profile.
- Public opportunity grouping uses active available creative offers and the existing funding status. It does not redefine eligibility, compensation, royalties or project lifecycle.
- Private collaboration activity is not a public credit. This page never loads private collaboration lists or attachments for display.
- Profile playback reuses the current player and original media URLs. Changing track, tab or page unmounts the old player and releases playback. Discovery's media/engagement code is not replaced.
- `ArtistSocialCapabilities` provides optional typed integration points for real follow counts/toggle and messaging destination. No caller supplies them until those services exist.
- Preference models and data access remain reusable for future For You/Antiq integration. There is no ranking, inferred recommendation score, SSO, new notification center, following backend or general messaging here.
- Investor registration/onboarding, profile, permissions and navigation are unchanged. Investors can view the same public artist profile as other visitors.
- Home, Project Browser, global Search, project creation, Featured Preview, project cards and funding/royalty logic are outside this implementation.

## Remaining limitations

1. There is no formal Work/Song/Release entity, release date, EP track membership or verified credit model. Music intentionally shows only supported project-audio relationships. A future release catalog needs explicit modeling.
2. Closed projects are not proof of completed work or released music. Collaboration credits need explicit public attribution/consent before they can appear.
3. Following and general profile messaging remain unavailable. Existing collaboration messaging stays in its workspace. No profile activity notifications or personalized For You ranking were added.
4. Home's provisional artist-genre facets still use their previous legacy source. Public profile canonical genres do not silently replace Home filtering or become project genres.
5. Public interests are limited to the existing need taxonomy. Availability is self-declared, not a guarantee, permission or booking system.
6. The private profile editor now sends only changed fields with their original baseline. The existing identity operation compares those fields before writing: unrelated changes merge, while conflicting edits are rejected with a visible instruction to reopen the editor; the unsaved draft stays visible. Nested private preference fields receive the same checks. Legacy callers without a baseline retain compatibility; this does not add a global conflict-resolution service or change onboarding. Private account information remains private in the API, but browser-only local testing does not provide server isolation.
7. Native Safari, physical devices and software keyboards have not been certified; browser verification uses desktop Chrome and emulated mobile Chrome.
8. Antiq central production identity/storage integration remains a separate handoff dependency. This phase does not claim production SSO is complete.

## Files in this phase

- `artifacts/nebula/src/features/artist-identity/{fields,editor,onboarding,public-profile}.tsx` and `public-profile.css`: shared form fields, private editing, setup, public sections and scoped player layout.
- `artifacts/nebula/src/pages/{artist,profile,register}.tsx`, `App.tsx`: public page, owner entry points, Artist-only registration destination and onboarding route.
- `artifacts/nebula/src/context/AuthContext.tsx`: discard private onboarding query state when identity changes.
- `lib/local/src/{artist-identity,state,store,browser,remote,index}.ts`: optional field validation/projection, atomic owner-only mutation, progress persistence, public read DTO and hooks/transport.
- `server/app.ts`: existing RPC dispatch and additive artist-scoped publication filters.
- `lib/local/src/artist-profile.test.ts`, `server/app.test.mjs`, `tests-shared/artist-profile.spec.ts`: new unit/API/lifecycle/privacy/playback verification.
- `tests-shared/{artist-identity,artist-taxonomy,publications}.spec.ts`, `tests/{auth-persistence,offline-shell}.spec.ts`: existing scenarios adjusted for onboarding, canonical public labels and the Projects tab.
- This document, `docs/artist-taxonomy-extension.md`, `server/README.md`: current contract and cross-references.

The worktree also contains retained changes from earlier phases; those are not newly attributed to this phase.

## Verification and activation

Evidence is in `../auditoria/artist-profile/`, including logs, screenshots and `verification.json`. Tests use isolated temporary databases/browser contexts, not the user's live account. Activation uses staged content-hashed assets and a read-only comparison against the database/media backup.

Final verification on 2026-11-07: **173 distinct automated checks passed**:

- 55 unit and 24 API tests.
- 12 profile/identity/taxonomy browser checks and 8 navigation checks. The six new lifecycle checks were also repeated after the final responsive adjustment and are counted only once.
- 18 Home/contextual Search/Project Browser checks.
- 28 browser-only authentication/Discovery/history/offline checks.
- 14 publication/identity-transfer/return-navigation checks.
- 8 private collaboration interface checks.
- 6 server-backed social interaction, USD funding/history and profile/project editing checks.

Library, server and client TypeScript checks, production build and `git diff --check` passed. Desktop and emulated mobile screenshots were inspected, including reachable playback controls, tabs, About and onboarding. Initial checks identified accessible-name issues for availability/location controls, which were fixed. An initial privacy assertion incorrectly included the caller's own session envelope; it now checks the public result. Existing tests were updated for the Artist onboarding destination and public Projects tab. Earlier failure logs and successful reruns remain in the evidence folder; no authorization rules were relaxed.

Build warnings remain for the existing dropdown-menu sourcemap diagnostic and the main JS chunk (833.03 kB before gzip). No dependencies were added.

Activated at **http://127.0.0.1:4174**, using `index--bpXnqB3.js` and `index-DgcpG4sa.css`. Live read-only smoke verified the served assets, public profile and project-audio reads, and unauthenticated denial of private preferences/onboarding. Backup: `.data/backups/before-artist-profile-20261107T205058Z`. Post-activation comparison verified **all 18 original SQLite tables and all five original media files unchanged**, with SQLite integrity OK. No live test account, project or upload was created.

Rollback must preserve any user changes made after activation. Retained previous content-hashed assets and the saved previous index support frontend recovery. Reverting code to an older state reader may not preserve newly added progress/fields on later writes; use a compatible reader or export current data first. Never restore the pre-activation database over subsequent user work.


### Focused stabilization — 2026-11-07

The remote session transport discards results from obsolete session generations, including delayed successful reads, refreshes and 401 responses. Login, logout and registration requests are ordered within the client store so a delayed cookie-changing response cannot overwrite a subsequent login. Only the latest authentication attempt can close its generation. The stabilization regression covers a delayed logout followed by login and confirms the new session after reload.

Concurrent profile edits send changed fields and compare their original values before committing. Unrelated fields merge; conflicting public or nested private fields reject the entire update while keeping the editor draft visible. The server regression checks private preference persistence, unchanged profile fields after a rejected save and unauthenticated access denial. Existing clients without an edit baseline remain compatible; the protected path is the current profile editor.

Logout has a minimum 44 px touch target with visible keyboard focus. Following remains disabled with an explanation tied to following artists, rather than the already delivered profile system. No new social or recommendation feature is enabled.

Verification logs and preservation checks are under `../auditoria/stabilization-2026-11-07/`. Browser tests use temporary accounts and databases, with a fresh server per suite to avoid exhausting signup rate limits across fixtures. Coverage uses installed Chrome, including mobile emulation; this does not certify native mobile browsers.


Phase 2.1 now provides real Follow relationships, counts/lists and Home Following in the connected environment. See [Following and social graph](following-phase-2-1.md); earlier references to Following as unavailable describe the Phase 1.2 delivery.
