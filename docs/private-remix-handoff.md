# Private Remix Workspace — implementation handoff

## Scope and baseline

This change implements the private remix workspace decision from UX-05 and its local API boundary from INT-01, against baseline `aecbd000284c7578b45f32354c08f78326573d2f`. It does not claim completion of the separate collaboration styling, search, notification overlay or Discovery profiling workstreams. The integrated local mock server remains the review environment; no Antiq production service, identity provider or payment provider is connected.

## User-visible behavior

- Discovery's Remix action opens `/studio/remix` and explicitly creates a private editable draft. A source is supplied in navigation state and validated by the API. Navigation state is not authorization.
- Direct workspace entry resumes the tab's selected draft, or lists the signed-in artist's drafts. **Your private drafts** clears that selection. Draft identifiers are opaque UUIDs and never form the workspace URL.
- Save works before rendering. Durable contribution files, clip, gains, source revision, title and description are restored on reload. Microphone/imported audio is stored as bounded stereo 44.1 kHz PCM WAV; video retains its uploaded container. Browser object URLs are only temporary playback references.
- Clip/gain/contribution changes invalidate the preview. Seeking does not. Volume is 5–100% (no mute); Reset volumes restores 65% base / 80% contribution. Both render engines use those values. Normalization in the existing WAV exporter can reduce the final overall level to prevent clipping; this is not independent track automation.
- Fixed clip handles are named **Move clip start/end**. They move the entire selection. The single duration control, overview, zoom, scrubber and keyboard adjustments remain; removed Custom/Fine adjustment/offset fields are not reintroduced.
- A saved preview can be submitted to the original project's offer with additional ordinary attachments. Only that final output becomes readable by the two collaboration participants. Editable tracks and the draft remain owner-only.
- New remix publication is unavailable, including through the old publication API. Ordinary publication workflows remain available.
- Legacy `/remix/:id` resolves source context and redirects to the fixed workspace, but does not create a draft on GET. The user explicitly starts it. `?mode=video` does not switch studios. Legacy proposal links resolve the existing owner's flattened remix in the fixed workspace.

## Contracts

Shared DTOs: `lib/local/src/remix-drafts.ts`. Client boundary: `features/remix/draft-api.ts` plus `@nebula/local`'s `apiRequest`. These are **local mock contracts**, not invented Antiq production endpoints.

| Operation | Request | Response / effects |
| --- | --- | --- |
| `POST /api/remix-drafts` | `{sourceId, sourceRevision, requestKey}` | `RemixDraft`, 201; creates an owner-bound UUID. Repeating the same owner/request key/source returns the existing draft, 200. |
| `GET /api/remix-drafts` | Artist session | `{items: RemixDraft[]}`; owner-only, newest updated first. No public list. |
| `GET /api/remix-drafts/:id` | Artist owner session | `RemixDraft`. Read access does not mutate or create work. |
| `PATCH /api/remix-drafts/:id` | `RemixDraftUpdate`: revision, title, description, settings, contributionId/duration, renderId or null | Validates current owner/source permission/source revision and private file ownership. Updates atomically with a revision increment. `renderRevision` records the revision of a saved render. |
| Same PATCH, render authorization | `{action:'prepare-render', revision}` | Checks ownership, revision and current original permission before client rendering. Does not render or alter state. Saving rechecks everything. |
| `POST /api/uploads` | Existing raw upload protocol plus `X-Remix-Draft: UUID` | Private media bound to that draft; authorization rechecked after asynchronous upload. Audio/video signatures are checked. |
| `GET/HEAD /media/:id` | Existing media route, optional `?download=1` | Owner-only for private tracks; submitted output additionally available to authorized collaboration participants. No-store, range support. |
| `PATCH /api/collaborations/:id` | Existing proposal/delivery payload plus `remixDraftId`; main file must equal saved render | Snapshot of title, attribution and draft revision stored with submission. Project must match, source must still be permitted, revision/state/terms rules remain. |

`RemixDraft` separates immutable attribution/source identity, mutable edit settings, contribution file, final render and revision. Attribution comes from the server's source publication, not client-supplied author/title fields. A draft cannot change its source or source revision. Start a new draft if the source changes; existing work is retained.

### Failures and lifecycle

- 401: missing/expired session; shared transport clears signed-in workspace state. 403: investor role. 404: nonexistent or another artist's draft/file. 409: stale edit, source change, revoked permission or stale render reuse. 400: invalid fragment/gain/format/file ownership. Upload errors also include 413, 415 and 429 from the existing media service.
- Two-tab editing uses optimistic revisions. Conflict preserves the losing local edit and offers an explicit **Reopen saved draft** action. It never silently overwrites the saved version.
- A create request key survives a lost response/reload through navigation state. PATCH is not automatically retried after uncertain completion: reload the saved revision. Successful uploads are retained for a retry in the current workspace; interrupted uploads are cleaned by the existing server. Unreferenced uploads remain owner-only and can be removed from Your publications.
- Uploads, media reads and render authorization accept cancellation. Client audio decoding/offline rendering cannot be forcibly interrupted internally; cancelled/unmounted results are discarded. Video rendering stops its recorder, tracks and playback. Existing operation/media timeouts apply; no production service SLA is claimed.
- Session pointers are per-tab, owner-scoped and cleared on logout/account change/401. Private draft query caches are invalidated/removed when identity changes. The API remains authoritative regardless of pointer tampering.
- Permission revocation blocks create, draft mutation, draft uploads, render authorization and new proposals. Owners can still read their previously saved draft/files. Already submitted output remains accessible as part of the collaboration record.

### Security boundary and limitations

Private media is marked independently from its latest draft references, so replacing a contribution cannot accidentally turn the old file into a public upload. The publication API rejects all such file IDs. Collaboration submission rejects private tracks and accepts only the selected draft's current final output as its main file.

Rendering still runs in the browser. The server validates declared settings, recorded revision, media ownership and file/container kind; it does **not** verify that uploaded audiovisual content was actually rendered from those tracks or prove duration/content by forensic analysis. Antiq must enforce equivalent authorization and decide whether trusted rendering/media analysis is required. Anyone who owns original bytes can make a separate copy; these rules are not DRM.

## Existing data and migration

Additive SQLite tables: `remix_drafts` and `remix_private_media`. Existing account/project/history state, posts, sessions and uploaded bytes are not rewritten. Back up the stopped review data directory before activation and compare original tables and file hashes afterward.

Existing public remixes keep their visibility and immutable attribution; they can be withdrawn. Existing flattened drafts remain readable/proposable but are not editable track workspaces and cannot newly publish. Once a legacy remix is withdrawn it cannot be republished through this release. No attempt is made to reconstruct lost component tracks or silently reclassify old content.

No currency changes: USD remains the only funding currency. Funding remains simulated and does not transfer payments or royalties.

## Runtime and operations

Node >=24.17; pnpm 11.21.0. No added dependencies. FFmpeg/FFprobe remain required for server waveforms; use the existing documented local binaries or Docker package. The studio retains the selector fallback if waveform processing fails.

| Port | Purpose |
| --- | --- |
| 5173 | Explicit browser-only Vite development; not API integration evidence. |
| 4173 | Isolated static browser demo / legacy tests. |
| 4174 | Integrated local mock API + UI for manual review. |
| 4175 | Disposable E2E server; never points to review data. |

From repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Configuration stays `HOST`, `PORT`, `PUBLIC_ORIGIN`, `NEBULA_DATA_DIR`, `NEBULA_FFMPEG_PATH`, `NEBULA_FFPROBE_PATH` as documented in `.env.example` and `server/README.md`. Startup logs go to the invoking terminal; request failures go to stderr. Use Ctrl-C in that process to stop. Inspect `lsof -nP -iTCP:4174 -sTCP:LISTEN` before starting; do not kill an unrelated process or run two servers on the same database. `curl -i http://127.0.0.1:4174/api/session` checks connectivity without exposing credentials. Preserve `.data/server` on restart. For rollback, stop the server, preserve any newly created drafts, and restore a complete backup with its matching application build. Never reset the review database as part of tests.

Existing operation inventory is in `server/README.md`: session/RPC account and project/history operations, uploads/publications, feed/social, offers/conversations/submissions/messages/notifications. Their interfaces remain unchanged except the explicit new private remix proposal and upload fields. Production authentication, object-storage signed URLs, account identifiers and service schemas require Manuel's confirmation; there is no automatic demo-data fallback when API requests fail.

## Verification

`server/app.test.mjs` exercises private owner/other-artist/guest/investor access, retry keys, conflicts, server restart persistence, all three format combinations, invalid video/audio combination, permission revocation, public media rejection, proposal-only sharing, immutable snapshots and historical records.

`tests-remix` exercises desktop Chrome and emulated mobile: fixed/legacy routing, camera/microphone permission/cancellation, media output pixels and frequencies, preview invalidation, restored editable tracks, unfinished save, multiple tabs, session loss, account switch, extra proposal attachments, waveform fallback and gestures. Browser checks are not proof of physical iOS/Safari behavior. Existing unit/server, static-browser, shared account/history/social, Discovery and collaboration suites remain regression checks.

A full handoff-wide latency A/B study, 50-transition feed traces, Safari/physical-device verification and other UX workstreams are outside this focused change. Do not interpret passing local tests as Antiq production integration certification.

### Candidate verification record (2026-11-06)

Runtime: Node 24.17.0, pnpm 11.21.0, Google Chrome 157.0.8103.38, FFmpeg/FFprobe 9.0.2, macOS ARM64. `pnpm install --frozen-lockfile --offline` completed without dependency changes. TypeScript checks and the staged Vite production build passed. Existing build warnings remain: dropdown-menu sourcemap resolution and a JavaScript chunk above 500 kB (approximately 741 kB / 231 kB gzip).

The first parallel static-browser run had an intermittent mobile ArrowUp navigation assertion (27/28 passed). That test passed in isolation without a Discovery code change, and the subsequent complete single-worker static suite passed 28/28. The cause is not established; this is recorded as a pre-existing-path stability observation, not a claimed Discovery performance fix.

Final results: 31 unit tests; 21 server tests; 28 static-browser tests; 28 Remix tests (14 desktop / 14 mobile); 20 shared navigation/account/publication/history/social tests; 6 Discovery layout tests; 6 collaboration/notification tests. All 140 distinct cases passed in the final relevant runs. Eight Remix cases were rerun successfully against the final build after the last audio-restoration and long-track-selection fixes. Shared desktop/mobile suites ran separately against fresh disposable servers to avoid exhausting the intentional authentication rate limit.

Activated locally after a stopped-server backup on 2026-11-07 05:37 UTC. All 13 original product/session tables matched the backup exactly; all five existing media files retained their SHA-256 hashes. SQLite integrity check: `ok`. The two new draft tables are additive. Live build: `index-DtnuX7Jd.js`, `index-CUr2Br0x.css`; `/studio/remix` returned 200 and unauthenticated `/api/remix-drafts` returned 401. No production connection or remote Git push was performed. Detailed local logs, screenshots and preservation evidence are in the workspace's sibling `auditoria/private-remix` directory.
