# Artist Professional Identity — Phase 1.1 extension

> Historical phase snapshot. For current status, superseding features and consolidated verification, see [Manuel release handoff](manuel-release-handoff.md). Earlier deferred items may now be implemented; the current operation inventory is [integration-contracts.md](integration-contracts.md).

> Subsequent delivery: [Public Artist profile and onboarding — Phase 1.2](artist-profile-onboarding-phase-1-2.md) now uses these catalogs in the public profile, optional onboarding and private preference editor. The public-profile/onboarding deferrals below describe the original Phase 1.1 scope; Home's legacy genre source and production integration remain unchanged.

## Delivered scope

The existing private `/profile` editor now provides reusable searchable multi-selects for professional creative roles and musical genres. Multiple roles coexist; none is a primary account role or authorization permission. The private profile summary displays their labels in the existing layout. Public `/artist/:id` layout, Home filtering, global Search, projects, opportunities, collaboration workspaces, messaging, Discovery, account types and authentication are unchanged.

This extends [Artist identity Phase 1.1](artist-identity-phase-1-1.md). Its original free-text genre strategy and ten-role catalog are superseded by the contracts below. No new dependency, endpoint, database table or state-version migration was introduced. Antiq production identity and storage integration remains pending.

## Shared taxonomy and canonical contract

`lib/local/src/artist-taxonomy.ts` owns the catalogs, ID unions, alias resolution and canonical validation. There are 17 professional roles in four categories and 40 genres/subgenres. IDs are stable independently of display labels. The existing `producer` ID remains valid with the display label **Music Producer**; there is no second `music-producer` role.

Artist public fields:

| Field | Meaning |
| --- | --- |
| `creativeRoles: CreativeRole[]` | Canonical professional role IDs. Existing field, expanded catalog. |
| `genreIds: MusicalGenre[]` | New optional stored canonical artist genre IDs, separate from legacy labels. |
| `genre` / `genres` | Existing legacy text fields retained for API compatibility and current public profile/Home consumers. |
| `identityReview` | Read-only projection of unresolved legacy role and genre labels. It is not accepted in writes. |
| `collaborationAvailability` | Existing self-declared signal; unchanged, not an authorization or agreement. |

Use the existing `POST /api/rpc` envelope and current-artist `updateArtist` method:

```json
{"method":"updateArtist","args":[{"name":"Artist name","creativeRoles":["producer","songwriter","vocalist","mixing-engineer"],"genreIds":["hip-hop","rnb","house"]}]}
```

Omitted fields remain unchanged. `[]` explicitly clears a selection. Writes validate exact canonical IDs on both the browser store and server, reject display labels/aliases/unknown IDs/null, and deduplicate valid repetitions. Roles allow at most 50 submitted values and genres at most 20. Unknown write keys, including `identityReview` and storage-only `legacyCreativeRoles`, are rejected. Validation failures return the existing HTTP 400 response with an explanatory error; no state is committed. Artist authentication, ownership, CSRF protection and serialized writes remain in force. Investors cannot edit an artist profile.

Private account preferences remain separate: collaboration preference roles reuse this expanded role catalog; `discovery.genreIds` is an optional canonical preference array. Existing private `discovery.genres` labels remain intact. Editing public professional identity does not infer or modify private preferences. Private preferences still use the existing owner-only operations and are excluded from public/session Artist DTOs.

## Legacy compatibility

Inspection before implementation found three stored artists and legacy `genre` values of null and `Demo projects`, without stored professional role/genre arrays. `Demo projects` is preserved for review, never invented as a musical genre.

Reads normalize exact matches against canonical IDs, display labels and the explicit aliases listed below. Matching ignores case, diacritics, surrounding/repeated whitespace, hyphens and underscores. It does not use fuzzy matching, split composites or infer genres from projects. For example, `Hip hop` resolves to `hip-hop`, `RnB` to `rnb`, but `Jazz / Soul` stays unresolved. Alias collisions remain unresolved rather than choosing arbitrarily.

- Legacy stored role labels project to canonical IDs when clear. Unknown role labels remain in storage and appear in `identityReview.creativeRoles`.
- When the owner replaces the active role selection, unresolved prior roles are retained in storage-only `legacyCreativeRoles` (bounded at 100 values). They remain available for review after saving, clearing and restart. Clear matches are represented by their stable IDs in the newly saved selection.
- When `genreIds` is absent, the read projection derives clear matches from existing `genres`, or from `genre` when `genres` is absent. Explicit `genres: []` prevents fallback to the single legacy field. Explicit `genreIds: []` prevents legacy genres from reappearing as active selections.
- The new editor sends `genreIds` and does not overwrite `genre` or `genres`. Original text remains visible under **Previous profile values**; ambiguous values are labeled for review. No read writes defaults or migrates records.
- Legacy API clients can still submit bounded text through `genre`/`genres`; these compatibility fields are not canonical IDs. Once `genreIds` exists, legacy text edits do not silently change the canonical selection. New integrations should use `genreIds`.
- Browser-only persistence uses the same contracts. Explicit browser-to-server identity transfer includes canonical genre IDs, including an empty selection, and keeps the original browser state intact. As before, it does not transfer private preferences, projects or other accounts. Unresolved role archives remain in the source browser; cross-environment reconciliation is not added in this phase.

Malformed persisted field shapes still trigger the existing recovery path rather than resetting data. Stored legacy strings are accepted and retained, including unknown labels. There is no bulk rewrite or automatic record creation.

## Reusable selector

`TaxonomyMultiSelect<T>` in `artifacts/nebula/src/components/antiq/taxonomy-multi-select.tsx` accepts shared taxonomy options, selected canonical IDs and an `onChange` callback. It reuses Nebula controls and the installed Radix Popover. No free-value creation is offered.

- Search matches labels, IDs, explicit aliases, category and parent-genre labels.
- Selected items appear as removable chips, with a clear-all action.
- Roles show their category; subgenres show their parent. Selecting a subgenre does not automatically select its parent.
- The searchable combobox controls a multi-select listbox with selected states, keyboard arrows/Home/End/Enter, Escape, focus return and live announcements. Composition Enter is ignored. Option and action targets are at least 44 px.
- Popovers fit desktop/mobile widths and viewport height, with a scrolling list and accessible Done action, including landscape. The selector supports disabled/pending state and an optional selection limit.
- Saving errors leave edits in the form. Cancel preserves stored identity. Public roles/genres are stored only after the explicit Save action.

The component can later serve onboarding or preference editors by supplying the same options and IDs. No onboarding or preference screens were added.

## Explicit boundaries and remaining limitations

1. Public profile redesign and canonical-label presentation there remain future work. Its legacy genre display is preserved; it can differ from the new private professional selection until that consumer is updated deliberately.
2. Home's current artist-genre filtering continues to use its existing legacy field. Selecting a new canonical genre does not update Home facets or project/work genres in this phase.
3. Professional roles are distinct from opportunity needs (`Verse`, `Feature`, `Production`, `Mix`, `Master`, plus the Home funding criterion). No automatic role-to-need mapping or restriction was added. Future cross-taxonomy matching needs an explicit compatibility layer.
4. No onboarding, public profile redesign, Following, recommendation ranking, new messaging/notifications, project creation changes or Antiq production integration. For You does not consume this identity yet.
5. The catalog is curated and extensible, not an exhaustive musical ontology. No arbitrary-value entry or automatic mapping of ambiguous composites. Review values are preserved, but no administrative reconciliation workflow is provided.
6. Existing last-write behavior for concurrent edits remains. Public profile identity and private discovery preferences are independent; the UI does not automatically synchronize them.
7. Browser-only storage is a local testing environment, not an authentication or privacy boundary against the person controlling that browser. Server-mode ownership checks are enforced by the API.

## Files changed in this extension

- `lib/local/src/artist-taxonomy.ts` — new shared catalogs, aliases and resolution/validation helpers.
- `lib/local/src/artist-identity.ts` — canonical genre IDs, compatible read projection, review data and optional preference support.
- `lib/local/src/state.ts` — separate stored artist type retaining legacy role text; same v3 state.
- `lib/local/src/store.ts` — canonical updates and preservation of unresolved old roles.
- `lib/local/src/index.ts` — shared taxonomy/type exports.
- `lib/local/src/remote.ts` — canonical genre IDs in existing explicit identity transfer.
- `artifacts/nebula/src/components/antiq/taxonomy-multi-select.tsx` — reusable searchable selection component.
- `artifacts/nebula/src/pages/profile.tsx` — existing private editor and professional summary integration.
- `lib/local/src/artist-taxonomy.test.ts`, `lib/local/src/artist-identity.test.ts`, `server/app.test.mjs` — taxonomy, compatibility, API validation/authorization and preservation coverage.
- `tests-shared/artist-taxonomy.spec.ts`, `tests-shared/artist-identity.spec.ts`, `tests-shared/publications.spec.ts`, `tests-shared/social.spec.ts`, `tests/offline-shell.spec.ts` — editor, transfer and regression checks.
- This document, `docs/artist-identity-phase-1-1.md` and `server/README.md` — current contract and references.

Existing worktree changes from earlier phases are outside this extension and have been retained.

## Verification and activation

Verification results and data preservation evidence are recorded in `../auditoria/artist-taxonomy/verification.json` and adjacent test logs/screenshots. Test accounts and uploads use isolated temporary databases or browser contexts, never the user's live account or media. Local activation uses staged hashed assets after a backup and compares the existing database tables and original media.

Final result on 2026-11-07: **149 distinct automated checks passed**: 51 unit, 22 API, 6 profile/taxonomy browser, 18 Home/Search/Project Browser, 6 publication/identity-transfer, 8 collaboration interface, 8 navigation, 28 browser-only account/Discovery/history/offline and 2 additional profile/project/global-Search flows. Library, server and UI type checks, production build and `git diff --check` passed. Desktop Chrome and emulated mobile/landscape were exercised; physical devices, software keyboards and native Safari have not been certified.

The first profile-browser run caught a test selecting two Done buttons during a popover exit animation; it was corrected to await closing and passed on recheck. The old offline-flow tests still targeted the replaced free-text genre input; both were updated to use the real selector and passed in desktop/mobile. Existing failures and successful reruns are retained in the evidence folder. No authentication or business rules were relaxed to pass tests.

Build warnings remain for the existing dropdown-menu sourcemap and the main JavaScript chunk size (approximately 803 kB before gzip). This extension adds no package dependencies.

Activated at `http://127.0.0.1:4174`, assets `index-CGwn4nsV.js` and `index-DYd393FI.css`. Anonymous read-only smoke passed, including denial of private preferences without authentication. Backup: `.data/backups/before-artist-taxonomy-20261107T203601Z`. Post-activation comparison verified all 18 original SQLite tables and all five original media files unchanged; database integrity remained OK. No live test account or sample project was created.

Rollback must preserve any identity edits made after activation. Earlier application versions may reject the newly supported role IDs; use a compatible reader or export the current state before reverting code. Restore the pre-release database only if there have been no subsequent user writes, never over newer work.

## Catalog reference

The tables below are generated from the shared source catalog. Every canonical ID and display label is also a recognized legacy alias after the normalization described above. The extra aliases column lists only additional equivalents. Parent links assist selection and do not imply selection or classification of projects.

### Professional roles

| ID | Label | Category | Extra aliases |
| --- | --- | --- | --- |
| vocalist | Vocalist | Performance | Singer |
| rapper | Rapper | Performance | — |
| singer-songwriter | Singer-Songwriter | Performance | — |
| instrumentalist | Instrumentalist | Performance | — |
| session-musician | Session Musician | Performance | — |
| producer | Music Producer | Production | Producer |
| beatmaker | Beatmaker | Production | Beat Maker |
| recording-engineer | Recording Engineer | Production | — |
| mixing-engineer | Mixing Engineer | Production | Mix Engineer |
| mastering-engineer | Mastering Engineer | Production | — |
| songwriter | Songwriter | Composition | — |
| composer | Composer | Composition | — |
| lyricist | Lyricist | Composition | — |
| arranger | Arranger | Composition | — |
| dj | DJ | Other creative roles | Disc Jockey |
| sound-designer | Sound Designer | Other creative roles | — |
| music-director | Music Director | Other creative roles | — |

### Musical genres

| ID | Label | Parent ID | Extra aliases |
| --- | --- | --- | --- |
| hip-hop | Hip-hop | — | Hip hop, Hiphop |
| trap | Trap | hip-hop | — |
| rnb | R&B | — | RnB, R and B, Rhythm and Blues |
| soul | Soul | — | — |
| pop | Pop | — | — |
| synth-pop | Synth-pop | pop | Synthpop |
| rock | Rock | — | — |
| indie-rock | Indie Rock | rock | — |
| metal | Metal | — | — |
| punk | Punk | — | — |
| electronic | Electronic | — | Electronica, Electrónica, Electronic Music |
| house | House | electronic | — |
| deep-house | Deep House | house | — |
| tech-house | Tech House | house | — |
| techno | Techno | electronic | — |
| ambient | Ambient | electronic | — |
| drum-and-bass | Drum and Bass | electronic | Drum & Bass, DnB, D&B |
| dubstep | Dubstep | electronic | — |
| indie | Indie | — | — |
| alternative | Alternative | — | Alternativa |
| jazz | Jazz | — | — |
| classical | Classical | — | Clásica, Classical Music |
| reggaeton | Reggaeton | — | Reguetón, Reggaetón |
| latin | Latin | — | Latino, Latin Music |
| latin-pop | Latin Pop | latin | Pop Latino |
| regional-mexican | Regional Mexican | — | Regional Mexicano, Música Regional Mexicana |
| banda | Banda | regional-mexican | — |
| norteno | Norteño | regional-mexican | — |
| corridos | Corridos | regional-mexican | — |
| cumbia | Cumbia | — | — |
| salsa | Salsa | — | — |
| bachata | Bachata | — | — |
| funk | Funk | — | — |
| disco | Disco | — | — |
| blues | Blues | — | — |
| folk | Folk | — | — |
| country | Country | — | — |
| reggae | Reggae | — | — |
| afrobeats | Afrobeats | — | — |
| gospel | Gospel | — | — |
