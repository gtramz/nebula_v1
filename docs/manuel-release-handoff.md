# Antiq Nebula — consolidated engineering return handoff

## 1. Release identity and scope

Repository: https://github.com/gtramz/nebula_v1 (public). Manuel's reviewed baseline: `aecbd000284c7578b45f32354c08f78326573d2f`, Engineering Handoff Rev 1.0, 6 November 2026, eight pages. This return package covers all changes since that baseline, not just the latest song feature. The final release commit is recorded in the accompanying PDF. `docs/verification/manuel-release.json` records the exact reviewed build and source content hashes independently of Git metadata.

The current implementation is **persistent local mock-backed**, not connected to Antiq's production central system. The static browser prototype remains an isolated compatibility/demo mode. Manuel owns production identity, storage and service mapping. No paid service, new production provider, public application deployment or payment processing was enabled.

The original PDF's temporary attachment no longer existed during this review. Its complete eight-page text was recovered from its original extraction in this same work session. Requirement IDs and acceptance language below refer to that original brief, not to an outdated functional audit.

## 2. Requirement traceability and adaptations

Paths in this report are repository-relative. UI prefix: `artifacts/nebula/src/`. Per-operation types, ownership, effects, errors and tests are in [integration-contracts.md](integration-contracts.md).

| Requirement | Before → implemented now | Source and acceptance evidence |
| --- | --- | --- |
| UX-01 | Ad hoc collaboration controls → shared workspace surfaces, buttons, feedback and return controls; contextual next actions, safe working copies and terms. Later adapted to unified Messages without discarding historical collaborations. | `components/antiq/workspace.tsx`, `features/collaborations/*`, `features/messages/*`, `index.css`; collaboration workflow/interface/messages suites. |
| UX-02 | Individual underlined return links/history dependence → shared explicit parent controls, identity-scoped query/filter/scroll memory, stable Discovery publication restoration and dirty-exit protection. Later adapted to Home and song links. | `components/shell/{return-context,navigation-guard,project-destination}`, `components/antiq/workspace`; return-context and navigation suites, Chrome + WebKit. |
| UX-03 | Misaligned Search controls and vulnerable stale requests → stable input box, debounce/composition/cancellation, explicit loading/empty/error/retry states. Home contextual Search is a separate reuse of transport, not a replacement of global Search. | `pages/search.tsx`, `lib/local/src/remote.ts`, `features/opportunities/*`; global Search and Home search suites. |
| PERF-01 | Feed-wide mounted media and competing resize corrections → at most active + two neighbors, stable IDs/models, one frame-coalesced scroll policy, queued resize correction and scoped feed cache. Mobile immersion retains the same lifecycle. | `features/discovery/{live-discovery,media-player,discovery.css}`, `pages/discovery.tsx`; 50-transition A/B in four profiles; Discovery/return suites and traces. Tail latency and physical-device limitations remain explicit below. |
| UX-04 | Bell navigates to a separate page → one app-shell panel, retained underlying route/work and one summary polling owner. Later extended to Follow/general-request destinations and unavailable historical targets. `/notifications` remains compatible. | `features/notifications/index.tsx`, `App.tsx`, `lib/local/src/notifications.ts`, `server/notifications.ts`; notification panel, transactional follow and message suites; A/B request/commit sampling. |
| UX-05 | Source-numbered, flattened remix publishing → authenticated `/studio/remix`, private editable drafts, durable contribution/render references, immutable credit, revision checks, proposal-only output access. Unified format rules and explicit selection/gain controls remain wired. | `features/remix/*`, `server/remix-drafts.ts`, `lib/local/src/remix-drafts.ts`; private ownership, format/export, reload, conflict, revocation and proposal tests. |
| INT-01 | Fragmented/stale documentation → consolidated real operation inventory, ports/configuration, local mock boundaries, source ownership, migrations, retries and central decisions. No production API invented. | README, server README, integration contracts and this handoff; current API tests and typed build. |
| QA-01 | No consolidated comparison with original baseline → isolated `aecbd000` frontend/server builds, identical media fixtures and four browser profiles; current regression release run, failure records and preservation comparison. | `tests-performance/*`, Playwright configs, `scripts/test-server.mjs`, verification summary. Physical mobile and branded Safari remain unverified, not silently passed. |
| DEL-01 | Code alone / phase-specific notes → full English return PDF, current contracts, Spanish change summary and release evidence. | This package, `docs/cambios-para-manuel.md`, `docs/verification/manuel-release.json`. |

Shared CSS now places shape defaults in the base layer so explicit component pills/timeline choices can work; it no longer applies universal `border-radius:0 !important`. Keyboard outlines remain visible and 44 px action targets are used. The global no-shadow policy remains intentional; component shadows are not a new design direction. Typography, color and spacing continue to use Nebula's tokens.

Later explicit product decisions supersede details in the original brief: one cyclic clip-duration control instead of Custom/numeric fields; contribution aligns to the selected fragment; mobile Discovery omits the top bell/header; mobile More/Logout/Received live in Profile; `/collaborations` now redirects to Messages while individual historical collaboration URLs remain valid. These are deliberate adaptations, not accidental removal of authorization or history.

## 3. All changes since the published baseline

The five already-local commits preceding this consolidated release delivered private remixes (`2890942`), notification overlay (`fcd25d6`), global Search (`602ddcf`), collaboration consistency (`bd7b9e2`) and contextual return/media bounding (`553a1a6`). None had reached GitHub main at the start of this task.

Subsequent working-tree development adds:

1. Artist/visitor opportunity Home on `/explore`, preserving Investor catalog and project cards.
2. Home contextual Search, real entity/criterion suggestions, account-separated confirmed-query history and coherent retained state.
3. Faceted Project Browser: project types, Artist genres, participation and fee/split compensation; same-opportunity matching, OR within/AND across dimensions, pagination after eligibility/filtering.
4. Professional Artist identity, multiple structured roles/genres, private preferences, resumable onboarding, grid selectors and public profile projection.
5. Session race and concurrent profile-edit corrections; unrelated fields merge and same-field conflicts retain the user's draft. Current closure also keys session identity by role + ID when detecting a cross-role refresh.
6. Actual Artist Following graph/counts/lists and Home mode, with account isolation and public eligibility.
7. Structured/legacy Artist genre integration in Home and Global Search, without pretending genres belong to projects.
8. Transactional Follow notifications, discriminated profile/collaboration/conversation targets and persistent occurrence deduplication.
9. Unified Artist Messages with Requests/admission, real conversation retrieval, formal offer proposals, typed notification destinations and preserved legacy messages/files/terms.
10. Mobile Profile navigation refinements and antiq UI attribution; desktop and Investor Pledges preserved.
11. Immersive mobile Discovery for audio and video, accessible project artwork links and contextual return, preserving desktop/tablet and existing playback rules.
12. Preference-based Home For You: explicit preferences take precedence, permitted public-profile fallback, same-opportunity ranking, truthful general fallback, identity-bound encrypted cursors and refresh on successful preference changes. This does not personalize Discovery.
13. Ordered, reusable songs inside musical projects, optional song-scoped offers/publications, immutable proposal context and concurrency/idempotency protections. No independent song player or royalty ledger.
14. Final handoff adaptations: consistent source-monitor gain in Remix, cancelled waveform requests on departure, non-overlapping 44 px clip handles on narrow screens, current documentation, isolated per-file integrated test commands (without weakening authentication limits), and reproducible original-baseline comparisons.

The Spanish note is written for direct forwarding. The assistant has not sent it to Manuel.

## 4. Application, routes and user journeys

| Area | Routes / entry / ownership |
| --- | --- |
| Public entry and accounts | `/`, `/login`, `/register`; role chosen only at registration, credentials infer role at login. |
| Home / catalog | `/explore`: Artist and guest opportunities; Investor existing catalog. Modes and facets remain local contextual navigation state. |
| Global Search | `/search`: public artists and projects; broader than Home's eligible opportunity inventory. |
| Discovery / collection | `/discovery`, separate `?demo=1`, `/saved`; public publication feed, session-required interactions, private saved list. |
| Profiles / onboarding | `/profile` own account; `/artist/:id` public projection; `/onboarding` current Artist's progress/preferences. |
| Project detail | `/project/:id`, optional `?song=:id`; project visibility, song membership and offer permissions independently validated. |
| Financial previews | `/pledges`, `/received`, `/receipt/:id`; private role/ownership history, USD simulations only. |
| Publication studio | `/studio`, `/publish`, `/publish/:id`; Artist-owned ordinary publication draft/publish/withdraw. |
| Private Remix | `/studio/remix`, `/studio/remix/proposal`; legacy `/remix/:id` and proposal compatibility, no create-on-read. |
| Messages / proposals | `/messages`, `/messages/new/:id`, `/messages/offer/:id`, `/messages/general/:id`, `/messages/collaboration/:id`; old `/collaborations/:id` still authorized. |
| Notifications | Shared panel from bell; `/notifications` compatible standalone deep entry. |

Artist journey: login/onboard or resume → Home text/facets/mode → public project/song/offer → formal proposal with reviewed terms → recipient Requests → accept/reject/request changes → admitted conversation, delivery and completion. General artist contact instead starts a text Request. Private Remix can supply a final proposal file; it does not imply permission to collaborate or receive royalties.

Investor journey: login → existing Explore/catalog or Global Search → visible project → USD contribution preview → private receipt/Pledges and per-project public visibility preferences. Investor may use permitted publication reactions/comments/saves; Artist-only offers, following mutations, messaging, notifications and private Remix remain restricted. Artist Received preserves separate contributions/history even where public entries aggregate by investor.

Desktop ≥1024: fixed 240 px expanded / 72 px collapsed sidebar, preference remembered. Tablet 768–1023: 72 px only. Mobile: bottom primary nav with safe-area reservation; Artist has Discovery/Home/Search/Messages/Profile. Mobile Profile contains More, Logout and Contributions received; desktop Received remains in sidebar. Discovery mobile fills `100dvh` minus bottom navigation; other screens retain the mobile header. Panels use a desktop side surface and mobile bottom sheet with focus/Escape behavior.

## 5. Integration and data ownership

The full operation-by-operation inventory, request examples, typed model references, permissions, errors, cancellation, retry and concurrency rules are in **integration-contracts.md**, included as the PDF's contract appendix. It includes the added Home, social graph, Messages, notification and song domains; Manuel should not integrate against the obsolete baseline-only list.

`lib/local/src/remote.ts` is the shared server transport; `server/app.ts` composes local services. Public profile projection, private preferences, work metadata, publication media and financial history have separate meanings. React Query and return/search memory are projections, not authority. The local browser prototype cannot enforce server privacy and is not a fallback on connection failure.

Database upgrades preserve legacy records. Notification migration reconstructs its target table transactionally and retains IDs, timestamps, reads, indexes and sequence; mixed destinations do not require fictitious collaboration rows. Follow stores a real unique relationship; occurrence identity survives its deletion. Messages adds persistent admission/read/activity/idempotency data and explicitly preserves legacy threads. Songs adds `works`, `project_works`, `project_tracklists`, `work_operations`; old projects/posts/offers remain valid without workId. No historical record is automatically seeded or reclassified as a song/private remix.

## 6. Reproducible operations and review

Runtime: Node >=24.17, pnpm 11.21.0, installed Chrome, optional Playwright WebKit; FFmpeg/FFprobe available through PATH, `.data/tools` or the explicit environment overrides. Docker includes media tools but container/proxy deployment has not been certified by this local run.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

The review URL is `http://127.0.0.1:4174`. Keep that server for manual review. `HOST`, `PORT`, `PUBLIC_ORIGIN`, `NEBULA_DATA_DIR`, `NEBULA_FFMPEG_PATH`, `NEBULA_FFPROBE_PATH` are documented in `.env.example`; `.env` is not implicitly loaded (`node --env-file=.env dist-server/server/main.js` is explicit). The server refuses non-loopback HTTP; TLS proxy setup is separate.

5173 is browser-only Vite development; 4173 is isolated static demo; 4174 is integrated review; 4175 is disposable integrated E2E. Before starting, inspect `lsof -nP -iTCP:4174 -sTCP:LISTEN`. Do not terminate an unknown listener. Foreground `pnpm start` stops with Ctrl-C; for a managed background process verify its recorded PID/command before SIGTERM. Review logs are retained locally at `.data/unified-messages-server.log`; no production/user logs are committed. New operator setups may redirect stdout/stderr to their own private log path.

Connectivity: `curl -f http://127.0.0.1:4174/api/session` should return a null visitor session without credentials; a page request should contain server data-mode metadata. Protected API 401 for a visitor is expected, not an outage. Do not expose the review port or publish a tunnel as part of this handoff.

Before updating, use SQLite backup API plus a copy of all media and the previous frontend/server build. Never copy only the active main SQLite file while WAL writes are pending. Stop the process to restore a full matched backup. No application command clears shared server data; Clear demo data is limited to the isolated browser prototype. Tests create disposable directories and synthetic `example.invalid` accounts on 4175. To inspect test flows use their fixtures in a separate instance; do not reuse Luis's credentials or register fixture accounts in 4174.

## 7. Validation and controlled comparison

The structured run summary and metric tables below are generated from actual logs; they distinguish baseline setup failures, resolved test issues and remaining device limitations. Test mutations use temporary accounts/media. The local user's database and files are compared before/after activation.

The A/B feed fixture is exactly 30 alternating publications sharing the same local 8-second audio/video assets. Baseline frontend **and server** are built from `aecbd000`; candidate uses current source. Four profiles: installed Chrome desktop, Chrome iPhone emulation (4x CPU slowdown), WebKit desktop and iPhone emulation. Loopback network, default browser cache, one 50-transition down/up sweep per profile/build plus overlay/resize checks. Viewports are 1440×900 desktop and Playwright iPhone 13 (390×664 CSS viewport before resize); scripts subsequently exercise 768/390/1440 widths.

Transition latency is dispatched navigation → active-card state plus aligned scroll at an animation-frame opportunity. It is not first decoded video-frame latency. rAF missed-opportunity estimates are not hardware dropped-video-frame counts. Long-task observation is available in Chrome, not WebKit. No statistical improvement claim follows from this single run. Decoded-frame continuity is not instrumented at every step; codec/device validation remains separate. The baseline did not reproduce a complete freeze in this fixture; the clear resource change is 30 mounted media elements → at most 3. WebKit typical latency improves, but p95/max and Chrome mobile are not uniformly better. This is a measured limit, not a hidden acceptance pass for all devices.

Notification comparison uses the same empty synthetic inbox and typed Search query for 21 seconds. React root commits, API requests, route and retained DOM/input state are recorded; root commits are not component render-duration measurements. Browser traces accompany both comparisons. Current functional tests additionally exercise permission errors, delayed requests, conflicts, rollback, lost-response retry, malformed media, pagination, reads and preserved unsaved work.

### Executed checks and outcomes

Runtime: Node 24.22.1; pnpm 11.21.0 final checks (11.25.0 initial runs); macOS 26.6.2 (25G83); Chrome 157.0.8103.38; Playwright WebKit 27.2; FFmpeg/FFprobe 9.0.2.

| Check | Result | Evidence / reproduction |
| --- | --- | --- |
| Unit tests | 71 passed | `pnpm test`; shared types, search, identity, notifications, session races and waveform selection. |
| Current server/API | 79 passed | `pnpm test:server`; temporary SQLite/media, authorization, migrations, transactions and domain contracts. |
| Original-baseline API | 21 passed | Same Node/media tools; original source and server compiled separately. |
| Functional browser checks | 212 passed | Per-suite breakdown below; mobile/desktop and Chrome/WebKit return contexts. |
| Final paired measurement checks | 8 candidate + 8 baseline passed | `pnpm exec playwright test --config playwright.performance.config.ts`; baseline measured separately. |
| TypeScript, server and production UI build | Passed | `pnpm typecheck`, `pnpm build:server`, UI production build; final rebuild matched the tested JS/CSS byte-for-byte. |
| Frozen dependencies | Passed | Pinned pnpm 11.21.0, offline frozen lockfile validation; no dependency or lockfile change. |

There are **220 unique candidate browser checks**, including eight measurement cases, plus 71 unit and 79 API tests. Baseline runs and repeated confirmations are not counted as additional candidate coverage. No final failing or skipped cases. The original aggregate Remix/static failures are documented below instead of omitted.

| Browser group | Passed | Specification / configuration |
| --- | --- | --- |
| home | 10 | shared / home, project-browser |
| home-search | 8 | shared / home-search |
| affinity | 6 | shared / home-for-you |
| following-genres | 8 | shared / following, genre-search |
| identity | 16 | shared / session-profile-regressions, artist-profile |
| identity-taxonomy | 6 | shared / artist-identity, artist-taxonomy |
| navigation | 8 | shared / navigation |
| search-publications | 20 | shared / search, publications, social |
| songs | 4 | shared / project-songs |
| messages | 6 | collaborations / messages |
| collaborations | 12 | collaborations / workflow, interface |
| notifications | 2 | collaborations / notifications |
| follow-notifications | 10 | collaborations / follow-notifications |
| notification-panel | 6 | collaborations / notification-panel |
| discovery | 12 | discovery / layout, immersive |
| return | 20 | return / Chrome + WebKit |
| remix-isolated | 30 | remix / remix, unified, waveform, workspace |
| offline-final | 28 | default / static demo and compatibility |

Use `pnpm test:shared`, `pnpm test:collaborations`, `pnpm test:remix`, `pnpm test:browser`; specialized Discovery/return/measurement configs run through `pnpm exec playwright test --config playwright.<name>.config.ts`. Integrated commands isolate each specification in a fresh temporary server; they do not weaken production authentication limits. Tests use installed Chrome and cached WebKit. `NEBULA_TEST_PUBLIC_DIR` selects a staged frontend for test/review builds; normal builds still use `dist/public`.

### Discovery measurements: original baseline → current

Each timing cell lists p50 / p95 / maximum in milliseconds. Rounded to one decimal; raw values are in the JSON evidence.

| Profile | Baseline timing | Current timing | Mounted media |
| --- | --- | --- | --- |
| chrome-desktop | 5.0 / 17.2 / 17.8 | 6.3 / 16.9 / 17.2 | 30 → 3 |
| chrome-mobile | 12.7 / 18.0 / 20.4 | 15.0 / 18.9 / 22.9 | 30 → 3 |
| webkit-desktop | 102.0 / 104.0 / 105.0 | 14.0 / 110.0 / 112.0 | 30 → 3 |
| webkit-mobile | 103.0 / 106.0 / 109.0 | 11.0 / 70.0 / 109.0 | 30 → 3 |

| Profile | rAF missed-opportunity estimate | Long-task count | Overlapping playback / page errors |
| --- | --- | --- | --- |
| chrome-desktop | 0 → 0 | 0 → 0 | 0 / 0 in both builds |
| chrome-mobile | 14 → 15 | 0 → 1 | 0 / 0 in both builds |
| webkit-desktop | 292 → 102 | Not supported in WebKit | 0 / 0 in both builds |
| webkit-mobile | 297 → 92 | Not supported in WebKit | 0 / 0 in both builds |

Observed refresh opportunity was approximately 60 Hz in Chrome and 59 Hz in WebKit. The resource-bound change is consistent across profiles. The timing table does **not** support a universal speedup: Chrome mobile p50/p95 and WebKit desktop tail timing require further investigation. No freeze was reproduced in either version under this fixture.

### Notification measurements

The following result was observed in each of the four profiles during the same 21-second interval.

| Signal | Baseline | Current |
| --- | --- | --- |
| List + summary requests | 3 + 4 = 7 | 1 + 2 = 3 |
| React root commits | 3 | 6 |
| Route with notifications open | `/notifications` | `/search` |
| Original Search input remains mounted | No | Yes |
| Query after closing/returning | Empty | `kept query` |
| Page errors | 0 | 0 |

Requests decrease and context is preserved; root commits increase. This is not a claim that individual component rendering became faster. React root hooks provide commit counts, not render durations.

### Execution exceptions and final disposition

- Initial isolated baseline lacked its FFmpeg tools path; repeated with the same tools: 21/21 API tests passed.
- Combined Remix run reached the real registration limit: eight cases returned 429. Per-specification isolation now passes all 30 cases without changing the limiter.
- One static mobile demo assertion still expected the removed Discovery heading; updated to require immersive feed geometry, retained desktop heading assertion; final static suite passed.

The dependency runtime initially resolved pnpm 11.25.0; final unit/types/build/frozen checks and isolated Remix/static checks used the repository pin 11.21.0. Browser binaries and media tools were unchanged between baseline and candidate. The sole production-build warning is the existing >500 kB JS chunk.

### Activation and preserved data

A second consistent SQLite/media backup was taken immediately before the review-server restart. All **28 tables** were byte-content-equivalent across activation; SQLite integrity returned `ok`. The **five original media files** retained identical hashes. Since the first backup, only the ephemeral `feed_snapshots` cache changed during normal reads; accounts, projects, publications, messages, preferences, relationships and financial history did not change. The server at `http://127.0.0.1:4174` serves the exact tested content-hashed frontend. No real-user data was used as a fixture.

Public evidence: `docs/verification/manuel-release.json`, `docs/verification/changed-files.txt`, synthetic screenshots and the reproducible test source. Raw local logs and traces are retained privately under `.data/manuel-release`; notification traces include temporary test sessions and are deliberately not published. The accompanying Discovery evidence ZIP contains only synthetic guest-feed traces/metrics for the paired builds. Backups and real-data hashes remain private.

## Change hypotheses and selected implementation

| Change | Expected effect / observed evidence | Decision |
| --- | --- | --- |
| Shared collaboration and return controls | Preserve actionable states, local working copies and contextual parent navigation. Baseline styles/links were source-inspected; current collaboration and cross-browser return journeys were executed. This is functional acceptance, not a timed A/B experiment. | Shared primitives + explicit parent context; preserve legacy workflows. |
| Global Search control and query handling | Stable alignment and no stale-query flash. Current focus, typing, composition, clear and failure assertions pass; Home remains independent. | Input-local positioning + cancellable shared transport. |
| In-screen notifications | Avoid route replacement and redundant polling. Paired empty-inbox runs measure route, retained Search node/query, root commits and request counts. | App-shell module with one summary owner and list invalidation. |
| Discovery media/transition lifecycle | Bound decoder resources and remove competing scroll corrections. Paired runs measure 50 transitions/profile, resources, frame opportunities and long tasks. Some tail metrics do not improve. | Retain resource bounding and one transition policy; defer device-specific tuning with explicit evidence. |
| Editable private Remix | Save/resume settings and contributions without public leakage; prevent stale render reuse and retain authorization on proposal outputs. Baseline source used flattened publications; candidate ownership, waveform, export, two-tab and proposal cases are exercised. | Fixed private workspace, existing mixing engines and owner-bound revisioned draft adapter. |
| Home, identity, graph, requests and songs | Add user-approved workflows without replacing Investor, history or ordinary publications. These capabilities were absent/less developed at baseline; current focused integration and regression suites verify them. | Extend canonical local models and adapters incrementally; do not claim a statistical A/B for newly added features. |

## 8. Remaining work, owners and decisions

| Severity / state | Owner | Impact / concrete next action |
| --- | --- | --- |
| P0 / intentionally not activated | Manuel / Antiq backend | Supply central identity/session/profile/project/work schemas, storage ownership/download rules, revisions, idempotency, event and error contracts; map adapters and run the same isolated contract tests. Local mock success is not production integration certification. |
| P1 / product decision | Manuel + Luis | Confirm legal/financial semantics, payments and royalty accounting, accepted-work disputes/cancellation and whether a future public remix release exists. Current actions remain local workflow decisions and USD previews. |
| P2 / device verification pending | Luis / QA with hardware | Run physical low-performance Android/iOS and branded Safari, real camera/mic, codec, latency, safe-area and production-like network journeys. WebKit automation and mobile emulation do not replace these checks. |
| P2 / performance refinement | Frontend owner | Investigate Chrome mobile and WebKit tail latency with representative codecs/devices. Collect true video-frame counters and production profiling as applicable; current 50-step fixture has no reproduced freezes/overlap but is not a universal smoothness guarantee. |
| P2 / retained engineering debt | Frontend owner | Initial bundle remains over Vite's 500 kB warning threshold. Plan measured route splitting separately; no risky bundling rewrite was introduced during stabilization. |
| P2 / before public service launch | Platform owner | Confirm multi-instance persistence, backups/restore drills, retention, upload scanning/moderation, email/recovery and observability. Local SQLite snapshot + disk media is single-process only. |
| P3 / intentional current model | Product + Manuel | Artist genres are provisional search context, Recently created uses createdAt; combined/negotiable compensation and verified project/work genres are not invented. Extend schemas only with a later approved product phase. |

No unresolved test failure is relabeled as a pass. Hardware/production decisions above remain outside this local delivery; they do not prevent reviewing and pushing the current mock-backed version. The public repository contains code, synthetic assets/tests and documentation, **not** Luis's database, sessions, messages or uploaded media.
