# Home For You — explicit-preference ranking

> Historical phase snapshot. For current status, superseding features and consolidated verification, see [Manuel release handoff](manuel-release-handoff.md). Earlier deferred items may now be implemented; the current operation inventory is [integration-contracts.md](integration-contracts.md).

## Scope and contract

This local implementation extends `GET /api/opportunities/projects` only for Home's `for-you` mode. The current request parameters, eligible inventory, contextual text search, facets, cards, and 24-project page size remain intact. Suggestions remain catalog-based. No schema, stored project, preference shape, endpoint, external service, or background task is added.

The response adds `forYou: { basis: 'preferences' | 'profile' | 'mixed' | 'general', reason?: 'no-signals' | 'no-matches' }` in For You. This is a description of the authenticated viewer's ordering, not an explanation or private data attached to a shared project. Recent and Following responses do not include it. Existing JSON responses use `Cache-Control: no-store`.

Discovery audiovisual ranking, feed snapshots, media, interactions, and scroll are independent and unchanged. Following still scopes the eligible catalog by real followed artists and uses descending project ID. Recently created still uses descending `createdAt`, then ID. Investor's catalog, Global Search, financial permissions, profiles, onboarding, messages, and notifications retain their existing behavior.

## Canonical sources and precedence

The session chooses the viewer; there is no `viewerId` input. The server reads that Artist's existing private preferences once per results request. It uses the current public identity only as a permitted secondary source. It does not inspect messages, proposals, money raised, followers, likes, plays, saves, or search history.

| Dimension | Explicit preference | Secondary source |
| --- | --- | --- |
| Participation | `discovery.opportunityTypes` (opportunities to discover), `collaboration.opportunityTypes` (collaboration interests), and mapped `collaboration.creativeRoles` (roles I want to perform) | Mapped public `creativeRoles`, only when none of those participation intentions is declared |
| Compensation | `collaboration.compensationKinds`: `fee`, `split` | None |
| Project type | `discovery.projectTypes` | None |
| Artist genre | `discovery.genreIds`, or compatible `discovery.genres` when canonical IDs are absent | Viewer's public genres when no private genre intention is declared; matched against the owner's public genres |

The three participation fields express desired participation, so their supported values form a union. Public interests, availability, and unrelated specialties are not silently added. A declared but unmapped private role blocks public-role fallback. An explicit preference that does not match the inventory is never replaced by a public identity that would match better.

`genreIds: []` suppresses stale legacy genre text. With no private genre selected, a current public genre may contribute as a **profile** signal, never as a resurrected private interest. Existing canonical IDs, exact aliases, legacy text, and `genreSource` provenance are reused. Genres describe the **artist**, not a verified project or musical work. No genre is inferred or written.

## Role-to-need mapping

| Canonical role ID | Opportunity need |
| --- | --- |
| `producer` | Production |
| `mixing-engineer` | Mix |
| `mastering-engineer` | Master |
| `rapper` | Verse, Feature |
| `vocalist` | Feature |

Other canonical roles remain neutral until a supported opportunity correspondence is defined. Songwriter is not Production, Composer is not Verse, and Mix does not imply Master. All selected supported roles participate; none is treated as a primary role or permission.

## Ordering policy

The server builds the public eligible inventory, applies existing text and structured filters, prepares viewer signals, ranks the full remaining inventory, and only then paginates. `server/home-affinity.ts` is a pure policy boundary.

Each valid candidate opportunity receives the tuple:

1. Participation: 2 for explicit intent, 1 for public-role fallback, otherwise 0.
2. Compensation: 1 for the preferred supported model on **that candidate**, otherwise 0.
3. Project type: 1 for an explicit match, otherwise 0.
4. Owner artist genre: 2 for explicit preference, 1 for profile fallback, otherwise 0.

Tuples are compared lexicographically, not summed. The project's best coherent opportunity supplies its tuple; descending project ID is the final tie-breaker. All available offers participate, including the fourth and later offers hidden by the existing card summary. More offers, labels, money, or followers do not multiply a score.

Structured participation and compensation filters constrain candidate offers together. A project with Mix/split and Feature/fee cannot manufacture a Mix/fee match. With Mix+fee filters it remains excluded under the existing filtering rules. Without strict filters it remains eligible, below a coherent Mix/fee match for a viewer seeking that combination.

Funding is a separate candidate only while the project is funding. It can match an explicit Funding interest, but has no fee/split compensation. Funding never borrows compensation from a creative offer. Legacy `opportunity=funding` alone scores funding; when combined with a creative need/compensation, the pre-existing contract still means a funding project with a qualifying creative offer. No independent artist financing or combined/negotiable compensation is introduced.

Missing data is neutral. No useful signals, or no matches in the filtered catalog, yields the existing general order; it does not remove eligible projects or force onboarding. Visitors and Investors use general ordering. Errors remain errors, with retry; no demo or previous-account fallback.

## Pagination, updates, and privacy

`server/project-browser.ts` retains the general and Recently created order boundaries and adds a score-and-ID boundary for For You. Current clients consume `nextPageCursor`. The authenticated, encrypted cursor contains only an ordering boundary and a hash bound to the session-derived account, normalized signal context, query, filters, and mode. It cannot expose readable preferences or be edited to select another viewer. Invalid/mismatched cursors return HTTP 400 and require a fresh first page. The encryption key lives in the server process; restarting expires old cursors without changing data.

Older numeric `before` callers remain supported. For personalized pages the ID identifies an anchor in the current ordering; an absent anchor requires a refresh. This compatibility path is not a stable snapshot or a cross-context cursor.

With static data and preferences, deterministic keyset pagination yields no duplicates or omissions. Inventory is live: every request rebuilds eligibility and availability, so closed/private/expired opportunities are not returned solely because of a prior cursor. New projects or changed affinity can move across an existing boundary; refresh from the first page to see the complete new ordering. This is explicitly not a new feed snapshot system.

The frontend scopes query keys by identity, query, filters, mode, and a narrow in-memory ranking generation. Successful preference/public-identity edits (including genre-source provenance transitions) restart For You from page one and cancel old requests while preserving the existing search, filter, and mode state. The existing cross-tab channel carries only a typed identity-change notice, never private preferences. Recent and Following do not adopt the new ranking.

## Reproducible temporary example

Create two temporary Artists with the existing preference editor:

- Artist A: Collaboration interests = Mix; Compensation preferences = Fixed payment.
- Artist B: Collaboration interests = Feature; Compensation preferences = Fixed payment.

In a disposable catalog, create Project A with Mix/royalty and Feature/fee offers, Project B with Mix/fee, and Project C with Feature/fee (newest). With no filters, Artist A sees B ahead of A and C; Artist B sees C and A ahead of B (ID resolves the equal Feature/fee matches). Selecting Mix + Fixed payment filters leaves only B for both accounts. Clearing filters restores the complete eligible inventory in each viewer's order. Switching to Recently created restores creation-date order; Following remains limited to followed artists.

Executable examples and assertions are in `server/home-for-you.test.mjs` and `tests-shared/home-for-you.spec.ts`; they create temporary identities and records and never use the review database as fixtures.

## Changed files

- Policy and paging: `server/home-affinity.ts`, `server/project-browser.ts`, `server/app.ts`.
- Compatible response model and client invalidation: `lib/local/src/opportunities.ts`, `lib/local/src/home-ranking-context.ts`, `lib/local/src/remote.ts`, `lib/local/src/index.ts`.
- Existing UI integration/copy: `artifacts/nebula/src/features/opportunities/index.tsx`, `artifacts/nebula/src/features/artist-identity/fields.tsx`.
- Tests: `server/home-affinity.test.mjs`, `server/home-for-you.test.mjs`, `server/app.test.mjs`, `lib/local/src/remote.test.ts`, `tests-shared/home-for-you.spec.ts`, `tests-shared/project-browser.spec.ts`.
- Delivery notes: this document. Generated build declarations/assets are build outputs, not new storage models.

## Verification

Completed: **242 distinct tests passed**, plus TypeScript and fresh frontend/server production builds.

| Check | Passed |
| --- | ---: |
| Vitest: local store, identity, preferences, auth transport, genres, search, history, notifications, remix | 70 |
| Node server/ranking tests: 17 pure affinity cases, 5 integrated For You cases, 48 API/regression cases | 70 |
| Browser: new For You flows | 6 |
| Browser: contextual Home search and Project Browser | 12 |
| Browser: Home eligibility/Investor and genre-search integration | 8 |
| Browser: Following | 6 |
| Browser: delayed sessions, logout/login races, concurrent profile/preference editing | 10 |
| Browser: artist identity, onboarding, public profile, taxonomy | 12 |
| Browser: Global Search | 8 |
| Browser: Discovery layout/playback/navigation/pagination | 12 |
| Browser: messages/proposals/requests/private attachments | 6 |
| Browser: Follow notifications, reading, account changes | 10 |
| Browser: browser-persistent accounts and investment-history privacy | 12 |

Browser counts are distinct desktop/mobile cases; repeated runs are not counted again. The final two-line genre-provenance invalidation refinement was followed by all 70 Vitest tests, TypeScript, a new production build, and 18 relevant browser cases (For You, session/profile concurrency, structured genres). The six new For You browser cases also verify a real 503 response/retry, no-match fallback, stale response cancellation, 24-card page reset, A→B→guest isolation, and actual editor saves with retained query/filter/mode. Screenshots were reviewed for desktop and 390px mobile.

Evidence and per-suite logs: `.data/home-for-you-20261107/verification.json`, `test-results-summary.json`, `api-regressions.log`, `unit.log`, `browser-*.log`, `typecheck.log`, `build-final.log`.

The tested final version is active at **http://127.0.0.1:4174/explore**, serving `index-B-0bZJRA.js`. A read-only live check confirmed the HTML and JS/CSS hashes, six existing visitor opportunities, general visitor ordering, and HTTP 401 for unauthenticated private preference access. **All 24 SQLite tables and all five original media files are unchanged**, with SQLite integrity OK. No real account, project, upload, relationship, message, or financial history was used as a test fixture or altered. Activation backup: `.data/backups/before-home-for-you-activation-20261108T042329Z`.

No unresolved functional findings remain in this delivery. Limits: the deterministic policy is not behavioral learning; genre is artist-level; live inventory changes can shift page boundaries; restart invalidates old cursors; testing used Chrome desktop and mobile emulation rather than physical mobile devices. The pre-existing production bundle-size warning remains. No additional product phase was implemented.

## Integration notes for Manuel

The pure signal preparation/ranking boundary and optional response metadata can be retained when replacing the local transport. Keep preferences server-owned, evaluate permissions before ranking, and do not share personalized pages across identities. Preserve existing taxonomy IDs and provenance, same-opportunity compensation, lexicographic tie-breaking, and query-context cursor invalidation. The policy is an initial deterministic product rule, not a validated compatibility statistic. No central, SSO, cloud, recommendation service, or external deployment was configured.
