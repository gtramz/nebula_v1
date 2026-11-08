# Following and social graph — Phase 2.1

> Historical phase snapshot. For current status, superseding features and consolidated verification, see [Manuel release handoff](manuel-release-handoff.md). Earlier deferred items may now be implemented; the current operation inventory is [integration-contracts.md](integration-contracts.md).

Following is an Artist-to-Artist public relationship, independent of stars, saves, project support, collaboration and investment. It grants no private access. Existing account IDs, cookies, CSRF validation and role checks are reused. Investor profiles and workflows are unchanged.

## Persistence and API

SQLite adds one table, `artist_follows(id, follower, artist, created)`, with a unique `(follower, artist)` constraint, a self-follow check and indexes for incoming/outgoing lists ordered by relationship ID. Accounts remain in the existing state record; server checks verify both endpoints are Artist accounts. No existing record is rewritten or migrated.

- `GET /api/artists/:id/social`: actual `followers`, `following`, and viewer-specific `isFollowing`.
- `GET /api/artists/:id/followers?before=ID` and `/following?before=ID`: public page with at most 24 artists, a nullable `nextCursor`, and only `id`, `name`, `picture`, `isFollowing` per artist. Images use existing profile values. Cursor is a positive relationship ID, not an account offset.
- `PUT /api/artists/:id/follow`: authenticated Artist follows target Artist. Repetition preserves the original relationship/timestamp.
- `DELETE /api/artists/:id/follow`: authenticated Artist unfollows target; repetition succeeds without negative counts.

Mutations infer the follower from the session, enforce origin/request-header checks and limit requests per account. Visitors receive 401, Investors 403, missing/non-Artist targets 404 and self-follow 400. All responses use no-store caching. Public lists and counts remain readable by visitors and Investors; they cannot mutate relationships.

## Profiles and Home

The existing profile header includes interactive counts and Follow/Following controls. Own profiles retain Edit Profile and omit self-follow. Visitors receive a sign-in link. Lists reuse Avatar and Dialog, with loading, errors/retry, empty state, incremental loading, Escape/focus return, mobile safe-area padding and scroll containment.

Home accepts `mode=following` for authenticated Artists. It intersects the existing eligible catalog with the viewer's followed Artist IDs before applying contextual search, same-offer criteria, facets and pagination. The suggestions endpoint uses the same scoped inventory. A viewer ID is included in Home cursor signatures. No private, closed or expired opportunities are made eligible by a follow. Repeated opportunities still produce one card per project.

For You keeps the existing general ID ordering. Recently created keeps createdAt ordering. Search/history, active filters and card layouts are preserved when switching modes. Following distinguishes no followed artists, no eligible opportunities, and no matching search/filter results.

React Query keys include viewer identity for follow state, lists, Home results and suggestions. Successful mutations invalidate those reads; a BroadcastChannel refreshes open tabs. Existing focus refresh and 15-second polling cover changes in other clients. This is not a real-time push service. Requests are abortable; identity changes render a separate cache scope. The current profile/session stabilization protections remain in place.

## Future boundaries and limitations

`follows.change()` returns an internal typed `FollowCreated` event only for an actual insertion, including relationship ID and timestamp. The subsequent [compatible notifications delivery](follow-notifications-handoff.md) now consumes that event synchronously inside the same SQLite transaction as the relationship. A persisted unique `artist.followed:<relationshipId>` occurrence prevents duplicate notices. Unfollow preserves historical notices; a genuine refollow creates a new occurrence. Existing relationships are never backfilled. No external delivery or asynchronous outbox is required for this local transactional implementation.

The indexed outgoing graph is available for future recommendation input. For You does not consume it for ranking in this phase. There are no onboarding or professional-role changes, no messaging, no suggested users and no new financial behavior.

Following requires the connected SQLite environment. Browser-only mode does not fabricate relationships or store them exclusively in localStorage, and displays an availability message. Account deletion is not part of this phase; future deletion must remove graph edges consistently. Public graph privacy controls are not modeled in this phase.

## Verification and preservation

`server/follows.test.mjs` covers permission/CSRF checks, self/duplicate follow, idempotent removal, bounded pagination, public DTOs, restart/login persistence, event uniqueness, Home filtering before pagination, same-offer matching and private project exclusion. `tests-shared/following.spec.ts` covers both desktop and emulated mobile, profile navigation, counts, reload, cross-tab refresh, search/facets, empty/error states, visitor/Investor separation and account switching. Existing API, unit, session/profile, Home, navigation, Investor/history and browser-only suites are also run in isolated temporary environments.

Evidence and final counts: `../auditoria/following-2026-11-07/`. Live accounts, projects and original files are not used as test fixtures. Activation preserves every preexisting SQLite table/row and media file, adds only the empty graph table, and retains previous content-hashed assets for existing tabs.


## Files changed in this delivery

- `server/follows.ts`, `server/app.ts`, `server/project-browser.ts`: graph persistence, API, Home scoping and ordering boundary.
- `lib/local/src/opportunity-search.ts`, `lib/local/src/opportunities.ts`: Following mode and response metadata.
- `artifacts/nebula/src/features/following/index.tsx`, `following/following.css`: controls, counts, dialog/sheet, queries and cross-tab refresh.
- `artifacts/nebula/src/features/artist-identity/public-profile.tsx`: public header integration.
- `artifacts/nebula/src/features/opportunities/index.tsx`, `opportunities/search.tsx`: mode controls, actor-scoped query keys, empty states and suggestions.
- `server/follows.test.mjs`, `server/app.test.mjs`, `tests-shared/following.spec.ts`, `tests-shared/project-browser.spec.ts`: new coverage and updated expectations.
- `docs/following-phase-2-1.md`, `docs/artist-profile-onboarding-phase-1-2.md`, `server/README.md`: contracts and implementation notes.
