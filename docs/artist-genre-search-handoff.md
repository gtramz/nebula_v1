# Artist genres in Home and Global Search — local integration

> Historical phase snapshot. For current status, superseding features and consolidated verification, see [Manuel release handoff](manuel-release-handoff.md). Earlier deferred items may now be implemented; the current operation inventory is [integration-contracts.md](integration-contracts.md).

Date: 2026-11-07. Scope: the existing local/browser domain, Home contextual search and Project Browser, and artist results in Global Search. No deployment, external service, migration, taxonomy expansion or project-genre field.

## Read precedence

`lib/local/src/artist-search-genres.ts` is the shared read resolver. It reuses `musicalGenreTaxonomy`, `resolveLegacyTaxonomy` and `normalizeTaxonomyTerm`.

1. A stored `genreIds` field is authoritative, including `[]`. Resolve valid IDs to existing labels/aliases. Do not merge legacy fields into structured identity.
2. Without stored IDs, use `genres` when present, otherwise `genre`. An explicitly empty legacy `genres` array also remains empty. Only exact, unambiguous taxonomy ID/label/alias matches become canonical IDs; no inferred parent genres or splitting of composite text.
3. Keep unresolved legacy values in storage. They remain searchable as text and usable as exact legacy criteria. In search/filter display they carry `(legacy text)`; they are not new or verified taxonomy categories. Textual search remains substring-based, so a word in a composite legacy value can match without categorizing that artist as the corresponding canonical genre.
4. Removing a structured genre or clearing all structured genres suppresses stale legacy matches. Terms may still legitimately match other existing searchable fields, such as names or project descriptions.

## Additive read contract for Manuel

`publicArtist` already returned derived `genreIds: []` for some legacy profiles. That public array alone could not distinguish an unresolved legacy profile from an explicitly cleared structured profile.

The Artist/ArtistSummary projection now includes a read-only `genreSource: 'structured' | 'legacy'`, derived from the presence of the **stored** ID field. It is not persisted, is not a new profile preference, and is rejected by the existing profile-write allowlist. Do not infer it from the length of the projected array. A future central adapter must preserve this distinction when producing these DTOs.

Examples:

- Stored `{ genre: 'Jazz / Soul' }` → projected `{ genreIds: [], genreSource: 'legacy', genres: ['Jazz / Soul'], ... }`: search the preserved text, without canonical classification.
- Stored `{ genre: 'Jazz', genreIds: [] }` → projected `{ genreIds: [], genreSource: 'structured', ... }`: no genre search fallback.
- Stored `{ genre: 'Rock', genreIds: ['rnb', 'electronic'] }` → search R&B/Electronic and their existing aliases; do not search Rock on the basis of genre.

For raw domain records without the projection field, the resolver uses the actual presence of `genreIds`. `genreSource` does not grant access or change permissions.

No route or request schema changes. Existing Home `genre` / `artistGenres` criteria still accept labels, aliases and IDs; known values normalize to stable IDs internally. Unknown criteria remain intact. `facets.artistGenres` and autocomplete `value` retain their label-valued response shape for compatibility, while selected filters/history normalize known values to IDs and render labels through the taxonomy. Previously saved history entries are interpreted without a migration.

## Search integration

- Home: text matching, eligible genre facets, autocomplete, legacy single criterion, multiselect chips and history restore use the shared resolver. OR within genre; AND across dimensions. Role/compensation still match the same offer. Funding compensation rules, inventory eligibility, ordering and pagination are unchanged. Filtering remains on the server before pagination.
- Global Search: `listArtists` matches name plus resolved public artist genres, including taxonomy aliases. Its existing listProjects behavior stays unchanged: artist genres are not inferred as project genres. Results show current resolved artist genre labels instead of stale `genre`.
- Browser store and local server share `listArtists` and the resolver. No API failure fallback or demo activation was added. Home continues to require its already-existing server endpoints.
- Existing query invalidation, store snapshot keys, account-scoped query keys and Home refresh behavior remain in place. No new cache or synchronization service. Following keeps its existing relationships, scope and permissions.
- Private discovery preferences are never search identity or public facets. Investor navigation/permissions and financial data stay unchanged.

## Changed source files

| File | Purpose |
|---|---|
| `lib/local/src/artist-search-genres.ts` | Shared precedence, aliases, exact criteria and display helpers. |
| `lib/local/src/artist-identity.ts` | Read-only provenance in public projections; excluded from stored model. |
| `lib/local/src/index.ts` | Export shared helpers to existing UI consumers. |
| `lib/local/src/store.ts` | Global artist matching through resolved public identity. |
| `lib/local/src/opportunity-search.ts` | Home matching, suggestions, options and canonical criterion normalization. |
| `artifacts/nebula/src/features/opportunities/filters.tsx` | Normalize facet option values so selections/chips use the same IDs without duplicates. |
| `artifacts/nebula/src/pages/search.tsx` | Display current resolved artist genres in the existing result row. |

Tests added in `lib/local/src/artist-search-genres.test.ts`, `tests-shared/genre-search.spec.ts`, and `server/app.test.mjs`. The pre-existing taxonomy API regression now explicitly expects genre facets to change after editing identity, while still asserting the complete unchanged catalog, pagination and eligibility response. Its prior expectation that facets stayed stale is incompatible with this delivery.

## Verification

All generated accounts, projects and media used for integration/browser tests live in disposable test storage. The active database and original media are compared against a read-only baseline; no real account is used by the browser tests.

## Remaining limits

Genres describe the artist, not individual projects or musical works. This does not add personalization, follow relationships, global filters, external search, cross-device synchronization or automatic classification of unknown legacy text. Existing refresh policies apply; this does not introduce live cross-device profile updates.


### Acceptance coverage

| Requirement | Evidence |
|---|---|
| Multiple canonical genres without a legacy field | Unit resolver/store and API integration find each ID, label and alias. |
| Legacy-only accounts, contradictory legacy fields, explicit clearing | Raw and public projection unit cases; API persistence/restart; desktop/mobile editor flow. |
| Case, accents, separators, aliases and deduplication | Shared taxonomy normalization; Home/Global matching, canonicalized criteria and suggestion tests. |
| Unknown legacy values | Read-only legacy text preserved; exact filter works; `(legacy text)` display; no inferred canonical genre. |
| Genre/type/role/compensation and same-offer matching | Unit and API positive/negative cases; Project Browser desktop/mobile regression. |
| Following plus filters | Real test follow edge; genre filtering respects followed IDs; unfollow and account switch reset scope. |
| Global-only public project and foreign draft privacy | API explicitly checks Home exclusion, Global inclusion and own/foreign draft visibility. |
| Edits/reload/cache | Browser SPA flow selects two genres, searches both, removes one, checks both screens, clears all, reloads and verifies stored identity. |
| History/return | Legacy history unit compatibility plus browser autocomplete/chips, project return and persisted history. |
| Authentication/private preferences/Investor | Session race, parallel editors/conflicts, private preferences, social isolation and Investor funding regression suites. |

The review also inspected desktop and mobile screenshots of the existing filter panel, active chips and Home search; the automated suites check overflow, keyboard focus, composition, cancellation and control sizes. Mobile verification uses Chromium emulation, not a physical iOS/Safari device.

### Commands and results

Commands use the bundled local Node/pnpm runtime. No package installation or external service was required.

- `pnpm run build`: fresh TypeScript, Vite UI and server compilation. Successful. Vite reports a main chunk above 500 kB (approximately 844 kB uncompressed) and unresolved source locations in sourcemaps for `avatar.tsx`/`dropdown-menu.tsx`; these are not build failures and were not changed in this scope.
- `pnpm test`: 65/65 unit tests, 10 files, including the new genre compatibility tests.
- `pnpm run typecheck`: successful independently and as part of the build.
- `node --test server/*.test.mjs` after server compilation: 32/32 integration tests, including the new cross-search/Following/persistence test.
- Playwright uses `pnpm exec playwright test --config playwright.shared.config.ts <files> --reporter=line` with desktop and mobile projects. Run in four batches, each starting a fresh disposable server/database: identity/profile/taxonomy (12 tests); genre/Home/Project Browser/Global Search (28); session regressions/Following (16); social/Investor funding (6). Total: 62 distinct browser cases.

An initial combined browser run hit the existing 30-attempt authentication limit and was interrupted. Its 429 failures are retained in the audit logs; subsequent isolated batches use the unchanged rate limit. No existing correct permission or data-preservation expectation was weakened.

Local logs, screenshots and before/after hashes are in `../auditoria/genre-search-integration-2026-11-07/`. Screenshots are test fixtures, not the user's account. No deployment, central integration, account migration, active-server restart or new synchronization system was performed.

Final outcome: all 65 unit tests, all 32 API tests and all 62 distinct desktop/mobile regression cases passed. The full 28-case search block was rerun after the alias-normalization adjustment; the final two genre lifecycle cases and all API/unit tests were rerun after stabilizing suggestion IDs. No tests were skipped. The final production build includes those changes. `git diff --check` passed.

Preservation check: all 19 active SQLite tables have identical row counts and row-content hashes to the pre-edit baseline; all 5 original media files have identical hashes. The source comparison lists exactly seven implementation files, three test files and this handoff document, with no deleted files. Existing unrelated development changes were preserved.
