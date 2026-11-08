# Local mock integration contracts — return package for Manuel

This inventory covers the implemented application, including changes after `aecbd000284c7578b45f32354c08f78326573d2f`. Paths below are **local mock contracts**, not invented Antiq production URLs. `server/app.ts` is the HTTP composition root. `lib/local/src/remote.ts` owns `apiRequest`, the RPC facade, session generation and cancellation/error mapping. UI feature modules use that boundary; browser-only behavior remains separate.

## Conventions, security and failures

- Same origin, cookie session; all non-GET/HEAD requests require `Origin` matching `PUBLIC_ORIGIN` and `X-Nebula-Request: 1`. Body is JSON except raw upload bytes. Never accept an account/role from the request as authority.
- `GET /api/session` returns `{user: SessionUser | null}`. RPC success is `{result, user}`. REST responses use the DTOs listed below. Errors are `{error: string}` with an HTTP status.
- Accounts and domain IDs are integers; media IDs and editable remix draft IDs are opaque UUIDs. `artistId`/`investorId` are role-scoped identity references in the client. Remix draft IDs confer no access.
- Server session cookies are HttpOnly, SameSite=Strict, Secure on HTTPS; seven-day lifetime. Local password hashes use salted PBKDF2-SHA256, 600,000 iterations. No email ownership or production recovery claim.
- 400 validation (including legacy domain/profile concurrency errors); 401 missing/expired session; 403 wrong role/origin; 404 unavailable or inaccessible resource; 409 revision/state/idempotency conflicts; 413 size/quota; 415 unsupported media; 422 invalid processable content; 429 rate limiting; 503 unavailable media processor. Unexpected errors do not expose database paths. Profile field conflicts currently remain 400 with a conflict message; project/REST revisions use 409. Central error normalization needs agreement.
- Queries consume AbortSignal where supplied. Search cancels obsolete queries and ignores stale results. Session generations prevent late reads/401s reviving or expiring another identity. Logout/login calls are serialized to avoid reversed cookie writes. Do not automatically retry arbitrary mutations.
- The HTTP server bounds request processing; waveforms allow one process at a time, a 60-second execution deadline and sources up to 10 minutes. Browser camera permissions depend on the browser/user. Video rendering runs in real time with explicit cancellation. There is no generic client deadline for every operation: transport timeouts must be agreed with Antiq.
- Upload cancellation removes incomplete bytes. Aborting a client request does **not** roll back an already committed mutation. Use the supplied operation key/revision mechanisms and reread after uncertain responses.
- Funding is USD only. Amounts use existing two-decimal domain validation; no money moves and no royalty settlement occurs.

## RPC inventory

Every row is `POST /api/rpc` with `{method, args:[...]}`. Canonical compile-time signatures are `Parameters/ReturnType` of `createLocalStore` in `lib/local/src/store.ts`, projected by `RemoteMethods` in `remote.ts`; model fields live in `types.ts` and `artist-identity.ts`. Server allowlist and validation are in `server/app.ts` and `server/validation.ts`.

| Method / arguments | Result / permissions / side effects | Verification |
| --- | --- | --- |
| `register([AccountRegistration])` | `SessionUser`; guest establishes server account/session. Unique email, Artist/Investor only, optional client-verified browser-transfer profile (trusted local migration only). Duplicate email 409; not blindly retryable. | `server/app.test.mjs`, `tests-shared/artist-profile.spec.ts` |
| `login([LocalLogin])`, `logout([])` | `SessionUser` / null; cookie rotation/revocation. Role inferred from credentials. Logout clears scoped UI state. | `remote.test.ts`, `session-profile-regressions.spec.ts`, `auth-persistence.spec.ts` |
| `listAuthEvents([])` | Current account's bounded activity only; no password material. | `app.test.mjs`, `auth-persistence.spec.ts` |
| `listProjects([ListProjectsParams?])` | `Project[]`; category/search/status with owner/public visibility rules. Global Search source, not Home opportunity ranker. | `app.test.mjs`, `search.spec.ts` |
| `getProject([id])` | `ProjectDetail` or null; private drafts owner-only, removed unavailable publicly; associated history retained. | `app.test.mjs`, `history-privacy.spec.ts` |
| `listArtists([ListArtistsParams?])`, `getArtist([id])` | Public artist summaries/detail; structured + compatible legacy genre search. No private preferences. | `artist-search-genres.test.ts`, `genre-search.spec.ts` |
| `getPublicArtist([id])` | Public professional profile, visible projects and opportunity project IDs; no credential/private-preference projection. | `artist-profile.test.ts`, `artist-profile.spec.ts` |
| `updateArtist([profile])` | Own `Artist`; legacy-compatible profile update. New editor uses field patch API below to avoid blanket overwrites. | `artist-identity.test.ts`, `app.test.mjs` |
| `getMyArtistPreferences([])`, `getMyArtistOnboarding([])` | `ArtistPreferences` / `ArtistOnboarding`; current Artist only, arbitrary identity arguments rejected. | `app.test.mjs`, `session-profile-regressions.spec.ts` |
| `updateMyArtistPreferences([ArtistPreferencesUpdate])` | Own private preferences; invalid fields rejected; rank context invalidated after successful commit. | `remote.test.ts`, `home-for-you.test.mjs` |
| `updateArtistIdentity([{profile?,preferences?,onboarding?,expected?}])` | Atomic current-Artist identity update. Only changed fields; `expected` baseline detects conflicting edits; unrelated changes merge; no speculative profile fields. | `artist-identity.test.ts`, `session-profile-regressions.spec.ts` |
| `createProject([ProjectInput & {songs?,operationId?}])` | Owned `Project`; optional initial tracklist committed atomically. operationId required with songs; reuse same ID/payload after uncertain response. Old clients without songs remain supported. | `works.test.mjs`, `project-songs.spec.ts` |
| `updateProject([id, ProjectUpdate & {expected?}])` | Owned Project; changed-field baseline conflicts 409. Musical-format change with existing songs blocked. | `works.test.mjs`, `project-songs.spec.ts` |
| `deleteProject([id])` | null; owner archives/removes visibility, preserves pledges, receipts, song memberships and collaboration history. No cascading purge. | `app.test.mjs`, `history-privacy.spec.ts` |
| `toggleProjectSupport([id])` | Symbolic Artist support state. Toggle, not an idempotent PUT; reread before retrying. No funds. | `app.test.mjs`, browser history suites |
| `createInvestment([InvestmentInput])` | Investor's simulated USD `Investment`; funding eligibility, amount and identity validated. No general idempotency key; UI blocks duplicate pending submits, uncertain response requires history check. | `app.test.mjs`, `history-privacy.spec.ts` |
| `listMyInvestments([])`, `listReceivedInvestments([])` | Own Investor / recipient Artist history, including removed projects. Not public transaction feeds. | `app.test.mjs`, `history-privacy.spec.ts` |
| `getInvestment([id])` | Authorized receipt, never arbitrary account's receipt. | `app.test.mjs`, `return-context.spec.ts` |
| `updateProjectVisibility([projectId, PublicVisibility])` | Own project-level public name/amount preference, applied across repeated contributions. Public list aggregates per investor; private receipts remain separate. | `app.test.mjs`, `history-privacy.spec.ts` |

## Content, media and Discovery

DTOs: `PublicationInput`, `Publication`, `UploadedMedia`, `Waveform` in `lib/local/src/publications.ts`. Handlers: `server/app.ts`, `server/waveforms.ts`. Tests: `server/app.test.mjs`, `server/waveforms.test.mjs`, `tests-shared/publications.spec.ts`, `social.spec.ts`, `tests-discovery/*`.

| Method/path | Request → response and ownership/side effect |
| --- | --- |
| `POST /api/uploads` | Raw bytes; `X-Media-Kind` audio/video/image/document/archive; optional URI-encoded filename. Artist only → `UploadedMedia`. Signature, quota and size validation; no generic upload deduplication. |
| `GET /api/uploads`, `DELETE /api/uploads/:id` | Artist's unused uploads; owner deletes only unreferenced media, including associated waveform cache. Referenced file 409; another owner's ID 404. |
| `GET/HEAD /media/:id` | Owner or explicitly authorized published/proposal reference; range responses 206/416. Not a publicly readable uploads directory. Withdrawal cannot recall already downloaded bytes. |
| `GET /api/publications` | Published posts, 20/page, `before`; `mine=1` Artist-owned draft/published/withdrawn posts; `project` + `song` restrict authorized public context. |
| `GET /api/publications/:id` | Public publication or owner's private publication; linked hidden project/song suppressed. |
| `POST /api/publications` | `PublicationInput` → `Publication`, 201. Own media/project/song references; public media requires publication. No universal create idempotency key. New public remixes prohibited; ordinary posts unchanged. |
| `PATCH /api/publications/:id` | Publication fields + `revision`; owner, 409 stale revision. Draft/publish/withdraw/edit; omitted workId preserves old association, null explicitly removes it. |
| `GET /api/feed?snapshot=&offset=` | `{items,snapshot,nextCursor}`; public, ranked stable snapshot, 20/page; 24-hour expiry. Removed/withdrawn items rechecked. Ranking is Discovery engagement/recency, not Home preference ranking. |
| `PUT /api/publications/:id/star` | `{enabled:boolean}` → current social state. Signed-in account, idempotent unique relation. |
| `PUT /api/publications/:id/save` | `{enabled:boolean}` → private save/social state. Signed-in account; never exposes other users' bookmarks. |
| `GET /api/saved?before=` | Current account's saved published content, 20/page. |
| `GET /api/publications/:id/comments?before=` | Public comments, 30/page, visible names only. |
| `POST /api/publications/:id/comments` | `{text}` 1–500 characters; authenticated; returns comment. No general retry key; reread on uncertain write. |
| `DELETE /api/publications/:id/comments/:commentId` | Author or publication owner; deletes live comment text. |
| `GET /api/publications/:id/waveform` | `Waveform`; authorized Artist + current source/remix permission, including cached reads. Local registered media only, immutable-file cache v1; silence and no-audio tracks represented truthfully. |

Upload limits: 100 MB audio/video/ZIP, 20 MB PDF, 5 MB image; 1 GB/artist, 5 GB instance. Remix audio engine additionally limits audio inputs to 25 MB. Server signatures and container checks are not malware scanning or forensic media verification. UI send/copy links are not delivery receipts.

## Home, public genres and social graph

Models: `opportunities.ts`, `opportunity-search.ts`, `artist-search-genres.ts`; services `server/project-browser.ts`, `home-affinity.ts`, `follows.ts`, `app.ts`.

| Method/path | Request / response / behavior |
| --- | --- |
| `GET /api/opportunities/projects` | Optional q, category, single criteria genre/need/compensation/opportunity/projectType; repeated projectTypes/artistGenres/participation/compensationKinds; mode for-you/recent/following; cursor. `OpportunityPage`, 24 projects/page, no duplicates. Eligibility and same-offer matching before pagination/ranking. |
| `GET /api/opportunities/suggestions` | Same contextual query/facets/mode → bounded `{items:HomeSuggestion[]}`. Real artists/projects/criteria only; no private preference values in response. |
| `GET /api/artists/:id/social` | Public counts and viewer-relative following state. |
| `GET /api/artists/:id/followers` / `following` | Public paginated lists with before cursor; real relationships, no mock counts. |
| `PUT /api/artists/:id/follow` | Current Artist follows target; no self-follow or mismatched account/profile. Relationship + notification commit atomically. Repeated/concurrent retry adds no duplicate notification. |
| `DELETE /api/artists/:id/follow` | Current Artist removes only its relation. Historical notification remains. A later real Follow obtains a new occurrence ID. |

OR within facets; AND across dimensions; role + compensation must match the same active offer. Funding is project-level, not an invented artist funding instrument. Supported needs: Verse/Feature/Production/Mix/Master plus Funding participation; fee USD or royalty split. Artist genre is explicitly provenance-aware and **not a verified project genre**.

For You ranks eligible/filtered projects by current Artist private preferences/public profile signals, with a truthful general fallback. Recently created uses `createdAt`, not fabricated `publishedAt`. Following restricts to actually followed artists and does not use For You scores. Signed encrypted Home cursors include identity/filter/mode/signal context; changes or server restart invalidate cursors without deleting data. A preference edit restarts the ranking generation while retaining text/facets. Investor catalog is unchanged.

Tests: `opportunity-search.test.ts`, `home-affinity.test.mjs`, `home-for-you.test.mjs`, `follows.test.mjs`, `follow-notifications.test.mjs`; Home/search/browser/following/genre/For You Playwright suites.

## Requests, collaboration and notification contracts

Models: `messages.ts`, `collaborations.ts`, `notifications.ts`; services share one SQLite transaction boundary and notification instance. Recipient identity comes only from session. There is no generic notification-creation endpoint.

| Method/path | Typed payload / result / authorization |
| --- | --- |
| `GET /api/messages?view=&direction=&closed=&cursor=` | Artist inbox, `ConversationCard` items; conversations=accepted, requests=pending or closed with sent/received direction. Cursor tied to viewer and scope. |
| `GET /api/messages/compose?artist=&project=` | Validated public recipient/project and existing pair; read only, creates nothing. |
| `POST /api/messages/requests` | `{operationId,recipientId,projectId?,text,kind?:'general'}` → `GeneralConversation`. Pair reused, first isolated message is a Request. |
| `GET /api/messages/general/:id?before=` | Participant-only `GeneralConversation`, last 50 messages and earlier cursor. |
| `PATCH /api/messages/general/:id` | `{operationId,revision,action:'accept'|'reject',response?}`; pending recipient decides; updates history + notification transactionally. |
| `POST /api/messages/general/:id/messages` | `{operationId,text}`; participant, accepted only; 1–4,000 characters. General chat does not add arbitrary file sharing. |
| `PATCH /api/messages/:kind/:id/read` | `{throughId}`; participant read cursor, never marks unseen later activity read. |
| `GET/POST /api/projects/:id/offers` | Visible `CollaborationOffer[]` / own `OfferInput` → created offer. Optional workId must belong to same project/owner. |
| `PATCH /api/offers/:id` | Offer fields + revision or `{revision,action:'close'}`. Owner only; stale revision 409. Song scope cannot change after request history. |
| `GET /api/offers/:id/conversations` | Authorized composer context; no empty thread created by reading. |
| `POST /api/offers/:id/conversations` | Formal request with operationId, offerRevision, acceptTerms, introduction, submission text/media IDs (or private remix reference); creates/reuses applicant/offer thread. Required proposal/files, not an isolated chat shortcut. |
| `GET /api/collaborations?before=` | Own legacy-compatible collaboration list; unified inbox is preferred UI. |
| `GET /api/collaborations/:id?before=` | Participant-only `CollaborationDetail`, terms, submissions, attachments, paginated messages. Old route preserved. |
| `POST /api/collaborations/:id/messages` | `{operationId,text}`; admitted participants. Historical legacy threads retain prior policy; new requests cannot converse before admission. |
| `PATCH /api/collaborations/:id` | `{operationId,revision,action,...}` submit/request_changes/accept/reject/withdraw/deliver/complete. Owner/applicant and current state checked. Submission may require current offerRevision + acceptTerms; acceptance checks latest submission/terms. |
| `GET /api/notifications`, `/summary` | Current Artist `NotificationPage` (30/page) / `NotificationSummary`. Mixed collaboration/follow/conversation destinations; unavailable historical target has no active link. |
| `PATCH /api/notifications/read` | `{id}` or `{throughId}` as implemented in `collaborations.ts`; recipient-scoped, later arrivals remain unread. |

Notifications use typed target references, never client URLs. `artist.followed:<relationshipId>` has persistent uniqueness surviving Unfollow; new Refollow creates one new occurrence; no retroactive notices. Conversation operations carry durable payload-bound operation keys; changed payload with same key is rejected. Legacy collaboration mutations without keys preserve compatibility, while new flows require keys. Offer creation and old contact-era operations are not advertised as universally idempotent.

Proposal/delivery: 1–10 audio/video/PDF/ZIP files, combined 250 MB. Private assets readable only by authorized participants/owner; an independently published file was already public and is not retroactively private. Accepting closes one offer and resolves other pending requests atomically. No dispute/cancellation flow for accepted work, royalty execution or legal signature. Term/submission snapshots remain immutable; renaming a song does not rewrite accepted historical terms.

Tests: `messages.test.mjs`, `message-migration.test.mjs`, `notifications.test.mjs`, `follow-notifications.test.mjs`, `app.test.mjs`; `tests-collaborations/*` (two independent clients, receipt isolation, failed insertion rollback, lost response, retry, history compatibility and UI panels).

## Private Remix contracts and state

Canonical request/response types: `RemixDraft`, `RemixDraftUpdate` in `lib/local/src/remix-drafts.ts`, `RemixInput` in `publications.ts`. Implementation: `server/remix-drafts.ts`, `features/remix/{index,studio,fragment-selector,audio,video}`. Detailed examples and permissions: [private remix handoff](private-remix-handoff.md).

| Operation | Payload → result / side effect |
| --- | --- |
| `GET /api/remix-drafts` | `{items:RemixDraft[]}`, current Artist's private workspace list. |
| `POST /api/remix-drafts` | `{sourceId,sourceRevision,requestKey}` → UUID draft (201; same key/source reuses 200). Explicit mutation only; GET never creates. |
| `GET /api/remix-drafts/:uuid` | Owner-only `RemixDraft`; source/revision/immutable credit/settings/durable contribution/render references. |
| `PATCH /api/remix-drafts/:uuid` | `RemixDraftUpdate` or `{revision,action:'prepare-render'}`; owner, revision and current source permission checked; changed settings invalidate render revision. |
| Upload/render output | Existing `/api/uploads` with `X-Remix-Draft: UUID`; bound private media, reauthorized after upload; no new render service endpoint. Browser exports, server validates ownership/format/revision. |
| Submit output | Existing proposal contract, authorized final render only. Original contribution and editable settings are not automatically shared. |

Fixed `/studio/remix` uses an identity-scoped per-tab draft pointer, server hydration and dirty-exit guard. Source navigation state is untrusted. Legacy `/remix/:id` and `/remix/:id/proposal` resolve safely; historical public/flattened remixes are preserved and not silently converted into editable private works.

Single cyclic 15/30/60 duration control; shorter originals use full duration; handles move a fixed range. Pointer state is rounded to 1 ms; keyboard 0.1 s (Shift 1 s); displayed times hundredths. Playback cursor seeking does not invalidate a render. Clip/gain/contribution changes do. Original + own gain are 5–100%, no mute; reset 65%/80%; gain changes require rebuild. Source monitoring uses the selected base gain. Browser/mobile audio policies may override programmatic hardware volume; export gain is computed by the mixing engine.

Audio+audio → audio, audio+video → own video/mixed sound, video+video → vertical two-video composition/mixed sound. Video+audio is rejected. Max original 600 s, clip 60 s, contribution 120 s. Server metadata does not prove that submitted pixels/samples correspond to a declared interval. Browser codec/latency/physical-device quality still needs acceptance.

Tests: `server/app.test.mjs` (private draft cases), `waveforms.test.mjs`, media/API tests and `tests-remix/*`; reload, concurrent drafts, stale revision, revoked source, private media, proposal access, cancel, actual output and return.

## Songs inside projects

Types in `lib/local/src/works.ts`; service `server/works.ts`; [song handoff](project-songs-handoff.md).

| Operation | Payload / semantics |
| --- | --- |
| `GET /api/projects/:id/songs` | `Tracklist {revision,songs}` following project visibility; reference details owner-only. |
| `GET /api/works` | Current Artist's private reusable song library; no generic public work lookup. |
| `PUT /api/projects/:id/songs` | `{operationId,revision,songs:SongEntry[]}`; owner, list/song revisions; atomic edit/reorder/reuse; max 100. |
| `DELETE /api/works/:id` | `{operationId,revision}`; owner and no memberships/history references. UI removes memberships; does not add a destructive library screen. |

Work is metadata and belongs to an Artist. Project membership/order is separate. Offers and publications optionally reference a work in their own project. Removing referenced membership is blocked, not cascaded. One Home card remains one project, irrespective of song count. Existing records have no invented songs. Tests: `server/works.test.mjs`, `tests-shared/project-songs.spec.ts`.

## Canonical sources and migration boundary

- SQLite `state`: existing accounts, public Artist fields/private preferences/onboarding, projects and simulated financial history. No second identity service.
- Dedicated tables: posts/media/reactions/comments/snapshots, remix drafts/media, collaboration offers/threads/messages/files/submissions, notifications, Follow graph, unified conversation/activity/read/operation records, and four song tables. Uploaded bytes remain on disk; waveform cache is regenerable.
- Additive/rebuild migrations run in service constructors. Notification migration rebuilds the formerly mandatory collaboration-target table transactionally, retaining IDs/read dates/sequence/indexes while adding profile/conversation targets and occurrence uniqueness. Messages migration preserves legacy admission and history. Songs add four empty tables; optional references preserve old clients when omitted.
- No startup seed/import of real accounts or media into Git. Backup SQLite using its backup API or stop before filesystem copy; include media. Restore database and binary version together if rolling back a migration.
- React Query is a disposable projection; localStorage stores small UI preferences/history (identity scoped), not the server authority. Browser-only prototype stores separate demo data and cannot certify server privacy.

## Example exchanges (synthetic references only)

```json
{"method":"updateArtistIdentity","args":[{"profile":{"bio":"Available for collaboration"},"expected":{"profile":{"bio":""}}}]}
```

```text
GET /api/opportunities/projects?q=ambient&participation=Production&participation=Mix&compensationKinds=fee&mode=for-you
POST /api/remix-drafts
{"sourceId":123,"sourceRevision":2,"requestKey":"a-unique-client-operation-key"}
PUT /api/projects/456/songs
{"operationId":"a-new-unique-operation-key","revision":0,"songs":[{"title":"Example song","description":""}]}
```

IDs here are placeholders; they do not refer to the review user's data. For runnable examples use the test fixtures, which create independent accounts and temporary databases.

## Decisions Manuel must supply

Central session/token lifecycle and identity mapping; public/private profile schemas; project/song identifiers and revisions; storage upload/download authorization and visibility; transactional/idempotency guarantees; pagination/error conventions; production notification/event transport; payment/royalty/contract semantics; retention/moderation/backup policy. Keep provider replacement behind the existing shared adapter. Do not hide central failures with demo fallback or infer public media permission from an opaque ID.
