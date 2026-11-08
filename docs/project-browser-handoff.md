# Home Project Browser — incremental handoff

> Historical phase snapshot. For current status, superseding features and consolidated verification, see [Manuel release handoff](manuel-release-handoff.md). Earlier deferred items may now be implemented; the current operation inventory is [integration-contracts.md](integration-contracts.md).

This extends the existing Home contextual Search. It does not replace the search control, autocomplete, confirmed-search history, card component, route or identity layer. Scope is server-mode Home for artists and visitors; investor Explore and browser-only Explore retain their existing experience. No account, project, offer, publication, financial, profile, publishing or onboarding schema/record changes, migrations, new services or dependencies.

## Interface and semantics

Header copy is now `HOME / OPEN OPPORTUNITIES`, `Find your next project.`, `Discover music worth being part of.` Search and Filters share one row. A compact mode row and removable active filter chips precede the existing project grid. The button displays the number of selected values, not the number of dimensions.

The existing Radix dialog primitives provide a 480px right drawer at >=768px and a bottom sheet below 768px, with a scrollable options area, persistent footer, safe-area padding, Escape/focus handling and >=44px label/button targets. The same mounted dialog adapts across sizes. Selection is a draft until Apply; Clear all inside the panel clears that draft. Escape, close or outside dismissal discards uncommitted changes. Clear all filters beside the chips applies immediately. Closing does not steal focus from an input the user has already focused.

Supported facets:

- Project type: Album, EP, Single, Tour, Video, plus actual additional category values present on eligible projects. Existing category data is not rewritten.
- Artist genre: actual nonempty artist profile genre labels, normalized for matching/deduplication. Internally this dimension is explicitly `artistGenres`, not verified project genres. A compound free-text genre is treated as its stored label, not parsed into invented tags.
- Participation: Verse, Feature, Production, Mix, Master, Funding. No Songwriter or other unsupported roles are introduced.
- Compensation: fixed payment (USD) and royalty share only. Combined and negotiable compensation await real model support.

OR within each facet; AND across facets and the existing text query. Participation and compensation must match the same available creative offer. Funding is the existing project-status opportunity and has no creative compensation: Funding alone plus a compensation constraint does not match a fee/split on another offer. Selecting Funding OR Production plus royalty share can still match a Production royalty offer. A project is returned once regardless of matching offer count. Public eligibility, deadlines, archived/draft/closed exclusions and funding rules are unchanged.

Search text and all facets share `HomeSearch`; applying/changing facets preserves text and changing modes preserves both. Clearing the search input now clears text only; facet chips are removed individually or with Clear all filters. Autocomplete adds a facet value (rather than replacing other selected values), avoids already-selected values, and requires a real match for the proposed criterion with the other dimensions; entity navigation remains unchanged. The legacy singular criteria remain accepted for existing API/history consumers. Mixed legacy/new offer criteria are also checked on one offer.

## Discovery modes and future boundary

- **For You**: functional general inventory ordering, descending existing project ID. Copy explicitly says personalization is not active. This is the prior reliable Home ordering, not a new recommender.
- **Recently created**: descending actual `createdAt`, with descending ID as deterministic tie breaker. It explicitly describes creation date, not publication date. No `publishedAt` is introduced or inferred. The two modes can naturally show the same order for ordinarily created records; tests intentionally separate timestamps from IDs to prove their distinct semantics.
- **Following**: disabled with a persistent explanation that it becomes available after the profile system is implemented. There are no fake follow edges, support-as-follow substitutions or mocked results. The server rejects unsupported `mode=following`.

`server/project-browser.ts` isolates ordering and paging. Its injectable `GeneralProjectOrder` is the integration boundary for a later actual central ranking provider; it does not require a single creative role or invent speculative profile/onboarding fields. A real following inventory provider and its authentication/access checks must precede enabling Following. Ranking changes will require a versioned cursor strategy; current cursors describe only the two implemented orders.

## Additive read contract

Existing `GET /api/opportunities/projects` and `/api/opportunities/suggestions` are reused. Shared optional repeated query parameters:

- `projectTypes=ep&projectTypes=single`
- `artistGenres=Hip-hop&artistGenres=Rock`
- `participation=Production&participation=Mix&participation=Funding`
- `compensationKinds=fee&compensationKinds=split`
- `mode=for-you|recent` (default `for-you`)

Each facet accepts at most 50 supplied values, with bounded strings (200 chars for artist genres, 60 otherwise). Unsupported participation/compensation/mode values return 400; no new financial models are accepted. Legacy `q`, `category`, `genre`, `need`, `compensation`, `opportunity`, `projectType` continue to work. Existing `before` pagination remains supported in general mode. All reads use the public inventory even for owners.

Results retain `items`, `nextCursor`, and `eligibleCount`, and add:

- `facets: {projectTypes: string[], artistGenres: string[]}` derived from the unfiltered eligible inventory. Closed/private records do not leak facet values. Values stay selectable while searching, avoiding disappearing options; selected values remain removable even if an opportunity closes.
- `nextPageCursor: string|null`, a bounded opaque read cursor carrying mode, last creation time/ID and a query signature. The browser sends it as `cursor` and resets pagination on any text/facet/mode change. This supports chronological pagination without skipping or repeating records with equal dates. A mismatched query/mode or invalid cursor returns 400. `before` with Recently created is rejected so callers cannot accidentally page by ID under chronological ordering.

Filtering occurs before ranking/pagination. Page size remains 24; ID deduplication remains in the client. Suggestions keep their existing lean union payload, labels, navigation links, cancellation and debounce. They reuse the same facet predicates, including single-offer matching. No extra facets service or endpoint is introduced. Existing public artist/offer scans remain local-adapter behavior, not a production full-text index.

## Search history compatibility

The Phase 1 storage key and per-identity isolation remain unchanged. Entries can now include a bounded, validated `filters` object in addition to text/legacy criteria; no profile, credentials, mode or unrelated data is stored. Equivalent multi-selections deduplicate independent of selection order. Existing v1 entries are read without rewriting storage or dropping history. A legacy entry restores its criteria alongside current filters; a new entry restores its saved complete facet selection. Only Enter/autocomplete criterion selection confirms history; checking boxes, automatic queries, mode changes and Apply do not add entries. Restricted/quota-full storage keeps the existing in-memory fallback.

## Files, verification and remaining limitations

Changes are isolated to the Home feature (`index.tsx`, existing `search.tsx`, new `filters.tsx` and scoped `browser.css`), shared Home types/matching/history (`opportunities.ts`, `opportunity-search.ts`, `home-search-history.ts`), and read handling/order (`server/app.ts`, new `server/project-browser.ts`). Tests extend existing unit/API/Home Search/Home/navigation-return/social coverage and add `tests-shared/project-browser.spec.ts`. The project card function and all unrelated application components remain unchanged by this increment.

Evidence and release checks are recorded in `../auditoria/project-browser/verification.json`; screenshots and initial failures are retained there. Tests use disposable data on 4175 or isolated static browser data on 4173. Local activation follows a SQLite/media backup and before/after logical-table and file-hash comparisons.

Explicitly deferred: real publication dates, follow relationships, verified project genre taxonomy, additional roles, combined/negotiable compensation, personalized ranking and central profile/onboarding inputs. This does not complete the global Manuel handoff's central integration, controlled full baseline comparison, physical-device validation or final release PDF. Existing bundle/sourcemap warnings are tracked separately from this feature.

## Activation and final verification — 2026-11-07

Active at `http://127.0.0.1:4174/explore`, serving `index-rB3EVILC.js` and `index-DmCquHOO.css`. Library, UI and server type checks and the production build passed. A total of 152 distinct automated checks passed: 39 unit, 19 API, 18 Chrome Home/Search/Browser, 30 shared regressions, 12 WebKit Search/Browser, 8 collaboration-interface, 8 Discovery and 18 static account/offline/history checks.

Two initial Chrome search failures exposed dialog-close autofocus stealing focus from an immediately focused search input. This was fixed and the final 12 Chrome Search/Browser checks passed; initial failure artifacts remain for traceability. WebKit checks also passed. Existing sourcemap and large-bundle warnings remain.

Live guest smoke passed at 390, 1024 and 1440 px with no page errors. Existing demo records verified that Production plus royalty excludes a different offer’s compensation. Search, filter clearing and mode changes preserve the intended state. Screenshots confirm desktop and mobile layouts. Browser emulation does not substitute for physical-device or branded Safari validation.

Backup: `.data/backups/before-project-browser-20261107T193047Z`. Logical comparison after activation and smoke found all 18 SQLite tables and all 5 original media files unchanged; SQLite integrity was OK. No accounts, projects, publications, offers or financial history were modified.
