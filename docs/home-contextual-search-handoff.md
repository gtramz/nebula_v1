# Home contextual search — Phase 1

> Historical phase snapshot. For current status, superseding features and consolidated verification, see [Manuel release handoff](manuel-release-handoff.md). Earlier deferred items may now be implemented; the current operation inventory is [integration-contracts.md](integration-contracts.md).

Subsequent increment: [Project Browser](project-browser-handoff.md) extends this implementation with multiselect facets and discovery modes. Its documented clear/history/pagination behavior supersedes the single-category/singular-chip details below; the original search and history mechanisms remain in use.

Home search remains an opportunity-discovery feature inside `/explore` for server-mode artists and visitors. Investor Explore, browser-only Explore, global Search, Discovery/playback, navigation, project cards/details, private Remix, financial operations and account storage retain their existing behavior. There are no migrations, new dependencies or new services. Existing uncommitted Home and Discovery work is preserved.

## Behavior and fields

The search updates after 300 ms; Enter submits immediately. IME composition does not dispatch unfinished text. Matching ignores case, accents and repeated spaces; every whitespace-separated query word must occur in the searchable text. This is deterministic text/criterion matching, not AI, personalization, typo correction or recommendation ranking. Projects remain newest-ID-first, one card per project.

Searchable fields: project title, artist name, pitch, story, category, **artist profile genre**, and currently available offers' need, deliverable, requirements and compensation kind. Project funding status is searchable as funding/financing/investment. Need aliases include producer/music production, mixing engineer and mastering engineer; compensation aliases include royalty/royalties/share/split and paid/gig/USD payment. No amounts, credentials, messages, private drafts or unavailable offers are indexed.

Genre is an artist-level free-text field; it is not inferred as a per-project musical genre. Genre suggestions come from actual eligible artists, treated as the stored genre label (no invented genre splitting). The model has no independent artist funding opportunity, so only project funding is discoverable. No new feature/schema is invented to fill this gap.

A single per-account view state holds text and typed criteria; the existing category filter remains independent. All dimensions combine with AND. Need and compensation must match the **same active offer**. Selecting a taxonomy suggestion clears the partial typed text and adds/replaces that criterion; project-type suggestions are search chips, distinct from the existing category filter. A conflicting category and project-type chip yields an explicit empty result, not silently changed filters. Clearing search removes text/chips but keeps category; Clear filters removes category but keeps text/chips. Return navigation restores the search and filter state. A reload resets the active search but preserves confirmed history.

## Read API contract

Both endpoints are same-origin public GET reads using the existing server/transport. Owner sessions do not expose private drafts. No authentication, account mutations, schema changes or external services are needed. Existing host validation remains in effect. Errors use the existing `{error: string}` envelope: 400 for invalid input, 405 for unsupported method, 403 for an invalid host/origin. Transport/server failures have explicit retry controls; requests are abortable and use the existing transport (no new network timeout policy).

- `GET /api/opportunities/projects`: retains optional `category` (max 60) and `before` (positive integer exclusive ID cursor). Adds `q` (max 200), `genre` (max 200, exact normalized artist genre), `need` (`Verse|Feature|Production|Mix|Master`), `compensation` (`split|fee`), `opportunity` (`funding`), `projectType` (`album|ep|single|tour|video`). Empty query is allowed; supplied empty criteria are rejected. Returns `{items: OpportunityProject[], nextCursor: number|null, eligibleCount: number}`. `eligibleCount` describes the unfiltered eligible public inventory, not matching projects. Old clients can ignore the additive field. Filtering occurs before cursor pagination; page size stays 24.
- `GET /api/opportunities/suggestions`: same search/filter criteria, no result pagination. Returns `{items: HomeSuggestion[]}` with up to 6 supported criteria, 3 real projects and 3 real artists. Empty query returns no suggestions. Each suggestion has `id,label,type` and either `action:'criterion',field,value` or `action:'navigate',href`. Links are canonical project/artist routes. No artwork, account information or full project payload is returned.

Both operations reuse the existing public inventory and collaboration availability rules (nonarchived/public projects, open unexpired offers, or active project funding). Suggestions respect existing filters/criteria, then match typed text against labels/aliases or entity names. They do not synthesize fake entities. Public artist profiles without eligible Home projects remain available through global Search rather than being suggested here. Criterion suggestions only appear when eligible matching inventory exists.

React Query keys include text, criteria and category; previous-query data is not shown as current results. Pending edits hide the old result set until the new query is ready. Results retain Home's 15-second refresh. Suggestion requests are only active while the popover is open with settled nonempty text; stale queries are cancelled. Same-query cached results may remain visible alongside an explicit refresh-error message.

The local adapter still scans the current public inventory/offers and reads artist summaries. This avoids fetching all pages in the browser but is not a production full-text index. Larger deployment indexing, measured load budgets and the Antiq central adapter remain integration work; this feature does not pretend the local adapter is the central service.

## History, privacy and accessibility

Only Enter and selecting a criterion confirm a search. Automatic updates and direct entity navigation do not create history. Store at most ten normalized, deduplicated entries, most recent first; entries contain only text and search criteria. No account/profile object, password, token, external category filter or media is stored.

Versioned localStorage key: `nebula:home-search:v1:<role>:<id>` or `nebula:home-search:v1:guest`. Account/visitor histories never merge. Reusing a history entry retains the current external category filter. Individual removal and Clear all persist. Restricted storage and quota failures fall back to memory, including protection against an older persisted value overwriting a newer failed write. Local storage is browser-local convenience, not encrypted or synchronized account storage. Cross-device sync remains a future central integration concern.

Combobox/listbox uses Up/Down, Enter and Escape; focus stays on the input while selecting options. Options identify criterion versus View project/View profile actions. History removal controls are outside the listbox. Controls have visible focus styles and >=44px targets. Loading, unavailable suggestions, no matching suggestions, no matching projects and no eligible inventory have distinct messages. A suggestion error does not block the project search.

## Files and validation

Supporting logic/types: `lib/local/src/opportunity-search.ts`, `home-search-history.ts`, `opportunities.ts`, exports in `index.ts`; additive read routes in `server/app.ts`.

UI is isolated to `artifacts/nebula/src/features/opportunities/index.tsx` and `search.tsx`. Existing project card JSX is unchanged. Tests are in `lib/local/src/opportunity-search.test.ts`, `server/app.test.mjs`, and `tests-shared/home-search.spec.ts`.

Validation evidence and release/preservation results are recorded in `../auditoria/home-search/verification.json`. Tests use disposable databases/accounts on port 4175, or isolated browser fixtures on port 4173; production-local records on 4174 are never test fixtures. Local activation uses a SQLite/media backup and logical table/media hash comparison.

The feature follows the Manuel handoff boundaries: existing identity and permissions, explicit failures and retries, contextual return navigation, real supported entities/fields, no changes to private Remix publication rules or royalties/payment behavior. It does not claim to complete central integration, global baseline-vs-candidate performance QA, physical-device/Safari-app validation, or the final English technical PDF for the overall release. Those remain separate handoff deliverables.

### Verified release — 2026-11-07

- 152 distinct automated scenario/profile checks passed after fixes/retries: 36 unit, 18 API, 38 shared navigation/search/return/social (including Home Search), 6 existing Home, 18 browser account/offline/history, 8 WebKit Home Search, 20 collaboration/notification and 8 Discovery checks. Repeated successful runs are not counted twice.
- Chrome desktop/mobile and WebKit desktop/mobile covered search. The initial WebKit run exposed a history-delete pointer/focus issue, now fixed. A later desktop return test needed to await the existing navigation focus restoration before entering the next query; the isolated rerun passed. Two shared mobile regressions hit the unchanged auth rate limit (429) after cumulative logins; they passed with a fresh disposable server. Full evidence, including initial failures, remains in `../auditoria/home-search/`.
- Types, library/UI/server compilation and diff whitespace checks passed. Existing dropdown sourcemap and >500kB bundle warnings remain. Final assets: `index-DK-fligH.js`, `index-Bzg_ZpUr.css`; source base `553a1a6` plus the uncommitted working tree, not a new release commit.
- Activated at `http://127.0.0.1:4174/explore`. A post-activation read-only smoke verified the six existing demo projects and Production + Royalty share matching on 1440px and 390px viewports. Browser contexts were isolated visitors, not the user's account/session.
- SQLite integrity passed; all 18 logical tables and all 5 media files match the pre-activation backup byte hashes for media and logical row hashes for tables. Backup: `.data/backups/before-home-search-20261107T190409Z`. Existing accounts, offers, projects, publications and histories remain intact.
