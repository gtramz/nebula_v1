# Persistent local mock server

This is the integrated review environment. Antiq production integration remains owned by Manuel; no production identity or payment service is activated. For the new private draft contracts and legacy remix policy see [private remix handoff](../docs/private-remix-handoff.md).

Run from the repository root using Node 24.17 or newer:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Open `http://127.0.0.1:4174`. This process serves both the application and its API.
`pnpm preview` on 4173 deliberately remains the isolated browser-only prototype
used by the previous regression tests. It cannot publish server-backed content.
Do not run a preview server on 4174 at the same time as `pnpm start`.

## Accounts and existing browser data

New accounts belong to this server and work in separate browsers. The server
derives PBKDF2-SHA256 password hashes with individual salts and 600,000 iterations.
Session tokens are random, stored hashed in SQLite, expire after seven days and
are carried by HttpOnly/SameSite=Strict cookies (Secure on HTTPS). Logout revokes
the current token. Tabs in one browser share the server session; use separate
browser profiles to test different accounts simultaneously.

At login, **Transfer my browser-only account** verifies the entered password
against a temporary in-memory copy of the old account, then registers that one
identity and artist profile on the server. It does not import projects, payments,
posts or other accounts, delete browser data, or replace an existing server
account. If the email already exists on the server, sign in to that account.
This is a migration from a trusted local prototype, not email ownership verification.

## Data and API

The default data directory is `.data/server` (ignored by Git):

- `nebula.sqlite`, with WAL files while running: accounts, project/history state,
  hashed sessions, rate-limit counters, media metadata, publication records, stars, private saves, comments and temporary feed snapshots.
- `media/`: uploaded bytes under generated IDs, not user-controlled filenames.

The existing project/history domain runs behind an explicit RPC allowlist.
Only the session-derived account can mutate owned records. Account tables,
password hashes, reset functions and arbitrary store methods are never exposed.
Publication/media metadata uses separate SQLite tables. The existing domain
snapshot remains a versioned JSON document in SQLite to preserve its tested
USD/history rules. This is a **single-process** server; do not run multiple
instances against the same data directory. A multi-instance deployment needs
a database-backed transactional domain model and shared object storage first.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/session` | Current public session profile, never credential hashes. |
| `POST /api/rpc` | Explicit account/project/history operations, `{method,args}`. |
| `POST /api/uploads` | Raw bytes, `X-Media-Kind: audio`, `video`, `image`, `document` (PDF) or `archive` (ZIP); optional URI-encoded `X-File-Name`. |
| `GET /api/uploads` | Current artist's unused uploads. |
| `DELETE /api/uploads/:id` | Owner-only removal of an unreferenced upload. |
| `GET /api/publications?before=:id` | Newest public posts, 20 at a time, next cursor. |
| `GET /api/publications?mine=1` | Artist's published, draft and withdrawn posts. |
| `GET /api/feed?snapshot=:token&offset=:n` | Ranked public feed; stable order for this browsing session. |
| `GET /api/saved?before=:id` | Current account's private collection, published posts only. |
| `PUT /api/publications/:id/star` | `{enabled:boolean}`, unique reversible star per account. |
| `PUT /api/publications/:id/save` | `{enabled:boolean}`, private reversible bookmark. |
| `GET /api/publications/:id/comments?before=:id` | Public comments, newest first, 30 per page. |
| `POST /api/publications/:id/comments` | Authenticated `{text:string}`, 1–500 trimmed characters. |
| `DELETE /api/publications/:id/comments/:commentId` | Comment author or publication owner only. |
| `GET /api/publications/:id` | Public post, or owner-only private post. |
| `POST /api/publications` | Artist creates a publication. |
| `PATCH /api/publications/:id` | Owner edits; revision conflicts return 409. |
| `GET/HEAD /media/:id` | Owner or a reference from a published post; byte ranges supported. |

Writes require the configured Origin and `X-Nebula-Request: 1`. There is no
cross-origin API. Incoming host names must match `PUBLIC_ORIGIN`.
The frontend never falls back to browser storage if the server is unreachable.
Browser storage originals remain available separately for manual recovery.

Publications support title, description, audio/video, optional cover, optional
owned project, `allowRemix`, and `draft`/`published`/`withdrawn` status. A linked
draft project must be published first. Withdrawing a post prevents new public
media requests unless another published post references the same asset; it
cannot recall already downloaded or buffered copies. Permission to remix is enforced by the audio/video studios described below.

Limits: 100 MB audio/video/ZIP, 20 MB PDFs, 5 MB covers, 1 GB stored per artist, 5 GB overall.
Signatures are checked server-side (not just filenames or submitted MIME types).
Supported types: MP4/WebM, MP3/WAV/OGG, PNG/JPEG/WebP, PDF and ZIP. The editor previews uploads
and requires playable media before publishing. There is no server transcoding;
codec compatibility depends on the browser. Use H.264/AAC MP4 for video where
possible. Broken media shows an error rather than silently publishing via the editor.
API clients must also submit decodable files; signature checks are not full decoding.
Interrupted uploads are removed; unused uploads can be cleaned up from Studio.

## Deployment preparation

The supplied Dockerfile builds the UI and server and runs as the unprivileged
`node` user. No runtime npm dependencies are required by the server. It requires:

1. One persistent volume at `/data`, writable by UID 1000.
2. `PUBLIC_ORIGIN=https://your-domain.example` and a TLS reverse proxy forwarding
   the original Host header. Configure an upload limit of at least 100 MB plus
   request overhead and a timeout compatible with the server's 120-second limit.
3. A single running application instance. Do not use static-only/serverless
   hosting with ephemeral disk for this version.

`.env.example` documents local configuration; `pnpm start` reads environment
variables, not `.env` automatically. To load a file explicitly use
`node --env-file=.env dist-server/server/main.js`.

The runtime refuses non-loopback HTTP hosting. HTTPS is terminated by the
reverse proxy; `PUBLIC_ORIGIN` enables secure cookies. No internet deployment,
domain, paid provider or public network access has been created by this change.
The Dockerfile is provided for deployment preparation; validate the container
build and proxy configuration in the selected hosting environment.

## Backup and restore

Stop the server cleanly, then copy the **whole** data directory to a private
backup location. Include the database and all media together. Do not copy only
the main `.sqlite` file while WAL writes are active. Backups contain private
profiles and authentication material; protect them like the live database.
To restore, stop the server, preserve the current directory as a rollback copy,
restore a complete backup, set `NEBULA_DATA_DIR` to it, and restart. Keep Node and
application versions compatible. Browser exports are not server backups.

No automated backup schedule is enabled. Password reset/email verification,
malware scanning/transcoding, moderation and multi-instance scaling remain
separate work before a public production launch. Contributions remain simulated
USD previews, not payment processing. Royalties and collaboration agreements remain unimplemented. Demo interactions
remain separate from server-backed interactions.

## Validation

```sh
pnpm test
pnpm test:server
pnpm build
pnpm test:browser
pnpm test:shared
```

Server and shared-browser tests create temporary data directories. They test
independent clients, restart persistence, ownership, private media, ranges,
withdrawal, revision conflicts, malformed uploads, quotas, CSRF, transfers and
the publication UI. They do not populate the user's server or browser profile.

Implementation references: [Node SQLite](https://nodejs.org/api/sqlite.html),
[Node HTTP](https://nodejs.org/api/http.html),
[cookie attributes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).

## Persistent interactions and feed order

Artists and investors can star, comment and save published content. Guests see
counts and comments but cannot write. No public list of bookmark owners or star
owners is exposed. Saved collections are available at Profile → Saved publications
(`/saved`); another account cannot request them by passing an account ID.
Withdrawing a post hides it from public feed, comments and saved collections;
existing reactions/comments remain stored for republication. Owners can inspect
comments on their private publications via the API. A comment's author can delete
it, including after withdrawal, and the publication owner can moderate it. Comment
deletion removes its text from the live database; operator backups may retain it.
Comments display public account names, never emails. HTML is rendered as text.

Star/save writes are idempotent and unique per account/post, not blind toggles.
Limits per account: 180 reaction writes/minute, 20 comments/minute. These basic
limits are not anti-bot or multi-account fraud detection.

The first ranking uses up to the latest 5,000 published posts:
`(1 + log2(1 + stars)) / (1 + ageInDays)^0.8`.
Every fourth position, when candidates exist, selects a post from the last seven
days by a creator with fewer than ten total stars among candidates. Discovery
slots rotate distinct creators within the snapshot. This is a transparent first
ranking, not personalized recommendations or a guaranteed audience.

SQLite snapshots store ordered public post IDs for 24 hours. Refreshing counts,
comments or private state never reranks the current snapshot. New publications
and ranking changes appear via **Refresh feed** or a new Discovery visit. Withdrawn
posts are filtered immediately on the next request; already buffered media cannot
be recalled. Pagination uses 20 posts/page and respects the same snapshot.
Snapshots expire with a visible refresh instruction. New snapshot requests are
limited to 120/minute/IP. Reactions/comments and visible saved collections refresh
every 15 seconds; these are polling updates, not live WebSockets.

The saved collection uses descending publication IDs for stable pagination. It is
not ordered by when the user bookmarked each post. Explore and Search now expose
connection errors with retry; domain queries refresh when the window regains focus
in server mode. Production scale still needs normalized domain storage, efficient
ranking jobs, stronger abuse controls and operational monitoring.

## Artist collaboration workflow

Project owners manage up to 50 collaboration offers per project on its detail
page. Offers specify Verse, Feature, Production, Mix or Master; the expected
work; free-text requirements; an optional application deadline (end of that UTC
date); and a fixed USD fee or a royalty percentage. Draft projects keep offers
private. Closed, archived and draft projects do not accept new applications.
Discovery exposes available offers from the linked project separately from remix
permission. Owners may close an offer without deleting its conversations/history.

Profile → Collaborations and Your publications → Collaborations & messages open
received/sent conversations. Each artist has at most one conversation per offer.
Both artists can message before submitting, during work and after completion.
Only those participants can view messages and submitted media; used files cannot
be removed as unused uploads. Proposals and deliveries accept 1–10 audio/video,
PDF or ZIP files, at most 250 MB combined. Files independently published
by their uploader are public by that publication, not made private retroactively.

A proposal requires the current offer revision and an explicit review of its
terms. Its terms are snapshotted; later offer edits cannot silently replace them.
Changes requested on a proposal require reviewing current terms again on resubmit.
The owner reviews the saved terms when accepting. Acceptance selects one artist,
closes the offer and declines its other pending conversations/proposals in one
transaction. To select multiple collaborators, create separate offers.

States: discussion → submitted → accepted → delivered → completed. Proposal
revisions use changes_requested → submitted; delivery revisions return to accepted
so the artist can deliver again. Before acceptance, applicants may withdraw and
owners may decline. Accepted work continues even if its project is archived.
There is no cancellation/dispute resolution for accepted work in this delivery.
Selection and completion record workflow decisions, not payments, signatures,
verified ownership or transfers of royalty rights. Split offers are not a global
royalty allocation ledger and are not summed across works/offers.

API (mutations retain the origin/session protections):
- GET/POST /api/projects/:id/offers — visible offers / owner creates.
- PATCH /api/offers/:id — owner changes terms/status with revision; action=close
  permits closing an expired offer without altering its terms.
- POST /api/offers/:id/conversations — artist creates/reuses own conversation.
- GET /api/collaborations?before=:id — own conversations, 30/page.
- GET /api/collaborations/:id?before=:messageId — participant workspace and
  latest 50 messages, with earlier-message pagination.
- POST /api/collaborations/:id/messages — participant message, 1–4,000 characters.
- PATCH /api/collaborations/:id — submit, request_changes, accept, reject,
  withdraw, deliver or complete; requires the current workspace revision.

Offers poll every 15 seconds; workspaces and lists poll every 10 seconds.
In-app notifications are available as described below. No read receipts, typing
indicators, blocking or reports yet.
Text is rendered literally. Writes are limited to 60/minute/account.
Tests: pnpm test:server and pnpm test:collaborations. The collaboration browser
suite runs separately from test:shared so each suite uses a fresh server and
respects production authentication throttling without test-only bypasses.

Every submission revision also stores its own term snapshot, accessible under
“Terms saved with this submission”. Existing records without a snapshot are left
null rather than reconstructing terms that cannot be proven. The additive schema
upgrade checks for the column before adding it; no existing record is reset.

## Private artist notifications

The navigation bell opens one app-shell modal without changing the current route: a
right-side drawer on desktop/tablet and a bottom sheet on mobile. Only signed-in
artists see it. `/notifications` remains available as a direct-link inbox. Closing
with Escape, the close button or the backdrop restores focus to the visible bell.
The underlying page stays mounted, retaining forms, files, previews and scroll.
Opening pauses page media; closing does not automatically resume playback. During
Remix recording/rendering/upload operations the bell is temporarily disabled until
the operation finishes or is cancelled, so opening a panel cannot damage capture.
It shows the recipient's unread count; the inbox lists 30 events
per page with earlier-event pagination. Artists can mark one event or all events
through the inbox's last observed ID as read. Selecting View collaboration on an
unread event marks that event read and navigates to the participant workspace. Read state is private,
not a message read receipt, and survives logout and server restart.

Events cover first contact, messages, proposals, revision requests, acceptance,
decline (including other pending applicants when someone is selected), withdrawal,
delivery and completion. Offer edits/closure notify applicants with pending work.
Reusing an existing conversation does not generate another contact event. An
action never notifies its own author. Each event is inserted in the same SQLite
transaction as its action; unsuccessful actions do not create notifications.

The existing `artist_notifications` storage is unchanged by the panel; no schema
migration is needed. Actions predating notifications are not replayed. Events contain a type, participants
and collaboration reference; they do not copy private message contents or files.
All reads and read-state mutations are restricted to the authenticated recipient.
Role, origin and session protections also apply to direct API requests.

- GET /api/notifications/summary — unreadCount and latestId for the current artist.
- GET /api/notifications?before=:id — recipient events, newest first, plus summary
  and nextCursor; no recipient ID is accepted from clients.
- PATCH /api/notifications/read — `{id}` for one event or `{throughId}` to mark
  all existing events through that recipient-owned ID. Repeated reads are
  idempotent. Events arriving after throughId stay unread. Limit: 120/min/account.

One app-shell query owns the 10-second summary poll and window-focus refresh,
shared by both responsive bell instances. The inbox has no polling timer: it loads
on opening and refreshes when the summary changes. Read mutations cancel stale
reads before writing; read-all retains its observed-ID boundary. Request signals
cancel abandoned loads, and account changes discard the previous artist cache.
They do not request OS/browser notification permission or send email/push.
No notification preferences, grouping, real-time transport or retention job yet.
Tests cover both recipient roles, unread indicators, keyboard entry, direct
workspace access, read persistence, pagination, new-arrival races and isolation.

Panel verification (2026-11-06, Chrome 157 on macOS and emulated iPhone 13):
96 distinct checks passed across unit (31), server (21), collaboration/notification
(12), shared account/history/navigation/publication (20), Discovery (6), and
selected audio/video/microphone Remix regression tests (6). Eight panel tests were
rerun on the final layout build `index-CAS95KN3.js`, including unsaved remix tracks,
preview URL and gains; unsent proposals/files/messages; cancelled navigation;
focus restoration after breakpoint changes; session expiry and request failures.
The polling check observes two 10-second periods, one list request for an unchanged
summary and no per-bell duplicate timer. Initial browser-test failures were locator
issues corrected to use accessible roles and the actual feed attributes, not data
loss. Safari and physical mobile devices were not exercised.

TypeScript and the production build passed; existing sourcemap and >500 kB bundle
warnings remain. Activation used a stopped-server backup and verified all 15
existing tables and all five media-file hashes unchanged. Evidence is under the
workspace's sibling `auditoria/notification-panel` directory. No API/schema or
production Antiq integration change is part of this panel.

## Private unified remix studio

The authoritative workflow and contracts are documented in
[Private Remix Workspace](../docs/private-remix-handoff.md).
Discovery opens `/studio/remix` for an authorized artist. New work is saved in
`remix_drafts`, with private contribution and render files, rather than as a
publication. Drafts are editable after reload. Source identity/revision and
attribution are immutable; clips, gains and contributions are editable with
optimistic revision checks. GET does not create a draft.

Public release of new remixes is deferred, including through direct publication
API requests. Existing published remixes remain visible and may be withdrawn;
legacy flattened drafts are preserved without reconstructing unavailable tracks.
Only the saved final mix is shared with a project owner when explicitly submitted
as a proposal. Draft/track access remains owner-only.

No Antiq production connection or new dependency is introduced. Accounts,
projects, USD history and ordinary publications keep their existing contracts.

## Multi-file collaboration packages

The existing collaboration PATCH accepts `mediaIds` (1–10 unique owned IDs) and
an optional `mediaId` identifying the main file, which must be included. Legacy
requests with only `mediaId` still work. All files are validated before any
submission, status or notification is committed. The submission and ordered file
references are written in one transaction; every revision retains its own package.
If using a saved remix, the main file must match its publication and original project.

The detail DTO retains `media` for compatibility and adds `files`. New references
live in `collaboration_files(submission,media,position)` with a media lookup index.
Old submissions are returned as one-file packages without rewriting their history.
A nullable `media.name` column stores a sanitized display name; bytes still use
UUID paths. Legacy unnamed files receive a deterministic display name.

The form uploads files sequentially, preserving successful uploads if a later file
fails or is cancelled. Removing a file from the form detaches it; it does not delete
its bytes or any previous submission. Unsubmitted files can be removed in Studio.
Audio/video require a playable preview; unsupported stems can be packaged in ZIP.
PDF/ZIP do not receive inline viewers. Participants can download each file using
`GET /media/:id?download=1`; PDF/ZIP always use attachment disposition and all file
responses retain sandbox CSP/nosniff. Authentication is checked on every request.
Published media retain their independent public visibility. Archives are never
extracted by this server; signatures are not malware scans or document validation.
No batch ZIP generation, inline PDF viewer, executable extraction, or arbitrary
Office document preview was added. Office/text documents can be included in ZIP.

## Video remix studio

Video originals require a video contribution. Audio originals can be combined
with audio or video in the same studio. The upload is detected automatically; there
is no mode selector or navigation between editors. Contributions may be
uploaded (up to 100 MB / 120 seconds) or recorded with camera and microphone after
an explicit click. Originals must have readable duration, up to 10 minutes; the
existing upload limit is 100 MB. WebM recordings without initial duration metadata
are probed by bounded-time seeking, without allocating decoded PCM for the whole file.
Fragments are 0.1–60 seconds. Camera recording plays the base for headphone monitoring,
automatically stops at the fragment end, and releases the devices on stop or exit.

Two videos use a vertical top/bottom composition. For audio originals with a video contribution, the new video occupies the
portrait canvas while the audio is mixed. Contributions begin with the selected fragment; short video
holds its last frame and longer audio/video is trimmed. Independent volume controls
feed a Web Audio compressor. A 720×1280 canvas is captured at 30 fps into MediaRecorder
with a supported WebM (preferred) or MP4 encoder. Rendering takes real time; the tab
must stay visible. Cancel, stalls, media errors or background interruption discard
incomplete exports. Format/codec support depends on the browser; no server encoder
or dependency was added. Finished videos may have no initial duration metadata,
which native playback and the studio's probing support.

The contribution and final output are saved privately and separately. Audio
contributions are persisted as stereo 44.1 kHz PCM WAV; video retains its container.
The same studio handles both output formats and restores edits on reload. The
server validates ownership, source permission/revision, parameter bounds and
container kind, not the audiovisual provenance of the rendered content.

Video originals reject audio-only contributions. Audio originals above 25 MB
keep compatible video contributions available, while audio mixing explains its
size limit. The contribution starts at the chosen base fragment; no separate
contribution-delay control is shown. Short video holds its last frame, long work
is trimmed. Preview changes require rebuilding before saving a current output.

Chrome tests inspect exported pixels, soundtrack frequencies, editable draft
recovery, proposal attachments, permission retry, device release and cancellation.
Physical camera/microphone latency and Safari/Firefox export compatibility still
need device validation. For isolated staged-build tests, set
`NEBULA_TEST_PUBLIC_DIR` for `test:shared`, `test:collaborations` or `test:remix`.

## Waveform fragment selector

Remix Studio has a single duration button cycling through 15/30/60-second fixed
windows, skipping lengths that exceed the original. The initial clip is 30 seconds,
15 for originals below 30 seconds, or the whole original below 15 seconds. When
only one duration fits, the button displays that duration and is disabled. There
is no Custom mode, separate timeline slider, or numeric fine-adjustment form.

Keyboard/pointer/touch handles move the complete fixed-length selection. The
waveform overview, zoom, and Fit selection remain available. The playback scrubber
does not change the recipe; moving the selection or changing duration invalidates
the rendered preview while preserving the contribution, text, and volumes. New
contributions start at the selected fragment's beginning (`voiceOffset: 0`), for
both uploads and recordings. Previously saved recipes and their offsets are
preserved; no stored data is migrated.

`GET /api/publications/:id/waveform` requires an artist session and a published,
remix-enabled, non-derived original. Access is checked before and after generation
and on every cache hit. Response: `Waveform { version, mediaId, duration, hasAudio,
pointsPerSecond, peaks }`. Peaks are absolute maximum amplitudes at 20 points/sec,
combined by maximum across decoded channels; silence remains zero. Video audio
retains its container-relative delay. The UI keeps video frames synchronized
using the original media element. Missing/failed processing leaves the temporal
selector and playback usable with a retry; no fabricated waveform is displayed.

Processing is lazy, one job at a time, deduplicated per immutable media ID. The
queue is bounded to eight distinct jobs. Each job has a 60-second total deadline
and bounded probe/PCM output, accepts originals up to ten minutes, launches tools
without a shell and restricts input protocols and demuxers to local supported
media. There is no network input. Versioned JSON cache files are written atomically
to `NEBULA_DATA_DIR/waveforms` and removed with unused media. Corrupt cache entries
regenerate. Cache files are not publications, are not publicly served and can be
regenerated without changing originals or stored remix recipes. No DB migration.

### FFmpeg / FFprobe setup

Both binaries are required for waveform generation, not for account/login or the
existing remix renderers. Install them with your platform package manager, e.g.
`brew install ffmpeg` on macOS with Homebrew, or `apt-get install ffmpeg` on Debian.
The runtime Docker image installs the Debian package. The executable search order
is `NEBULA_FFMPEG_PATH` / `NEBULA_FFPROBE_PATH`, then `.data/tools/ffmpeg` and
`.data/tools/ffprobe` in the project, then PATH. Overrides must name executables,
not commands or arguments. Check installation with each executable's `-version`.

This local Apple Silicon installation uses FFmpeg/FFprobe 9.0.2 static binaries
from https://www.osxexperts.net/ (also a source used by ffmpeg-static), downloaded
only into ignored `.data/tools`; no global installation or npm dependency added.
Verified SHA-256 of extracted binaries before execution:
- ffmpeg: `762f16b2913b8d3b8fdb8092df12b691053b035b13ae9b88205513c55cb8e71e`
- ffprobe: `e9d3ad989b11d1ff4e3b0d140df170a6b38f194f83ac77f0e05a127a0f3a0ae4`

Downloads used: `https://www.osxexperts.net/ffmpeg902arm.zip` and
`https://www.osxexperts.net/ffprobe902arm.zip`. These binaries are local tooling,
not part of the repository or a client download. Docker uses its own Linux package.
Processing flags follow https://ffmpeg.org/ffmpeg.html and
https://ffmpeg.org/ffmpeg-protocols.html. Keep server processors patched when deploying.

Tests cover peak amplitudes, silence, delayed video audio, missing audio, cache
reuse/regeneration/removal, processor failure/deadline, current permissions,
short originals, fixed/custom selection, overview/zoom, mouse and CDP touch input,
scrubbing without invalidation, offset adjustment and existing remix exports.

## Responsive application navigation

One primary navigation landmark changes layout at Tailwind's standard breakpoints:
mobile below 768 px uses a fixed 64 px bottom bar plus the bottom safe-area inset;
768–1023 px uses a 72 px left rail; desktop from 1024 px uses either the rail or
a 240 px expanded sidebar. Desktop starts expanded. The independent localStorage
key `nebula-navigation-expanded` remembers the choice; unavailable storage falls
back to in-memory state. Tablet and mobile never overwrite the desktop preference.

The routes are Discovery, Explore, Search, Pledges (investors) / Received (artists),
and Profile. History and Profile require a session. Notifications keep their
artist-only rules and appear in the sidebar or mobile header. Login and signup
remain available to visitors. Login, registration and the public landing page
have no primary navigation. They retain an in-flow More control.

The fixed footer is replaced by More, which holds Home, Explore, copyright and
local-mode information. Clear demo data remains exclusive to browser preview
mode and retains its confirmation and account-preserving behavior. More closes
with Escape and on navigation/viewport changes. Existing Radix menus/tooltips
provide keyboard access; primary icon targets are at least 44 px.

The page reserves the sidebar width or bottom-bar height. Discovery keeps a
100dvh shell and repositions its current post after viewport changes without
remounting the page. Resizing Remix preserves form fields and the generated mix.
No server endpoints, database schema or product data are changed by navigation.

## Search interaction (handoff UX-03)

`/search` searches artist names and projects through the existing `listArtists`
and `listProjects` RPC methods. There are no new endpoints, dependencies or data
migrations. The browser-only preview uses the same catalog selector against its
local store, without network requests.

The input waits 300 ms after editing, trims surrounding whitespace and requires
at least two characters (maximum 200). IME composition defers searching until the
text is committed. Each search is one query containing both result sets; its key
includes the current input, composition state, store revision and viewer identity.
Changing or clearing the input detaches obsolete queries and aborts their fetches.
Results from another query are never shown under the new text. Successful results
are reusable for 30 seconds; input edits still wait for the debounce. Window focus
does not refetch search; catalog mutations invalidate it through the existing
query client, and store revisions/identity changes get a new key.

Initial, short-query, loading, no-results, result-count and failure states have a
polite status announcement. A failed request shows an explicit retry for the pair;
partial results are not presented as a complete search. Clearing restores input
focus. Icon and clear button are centered inside the 56 px field, independently
of the divider padding. Clear has a 44 px touch target; native duplicate WebKit
search decoration and the cyan focus embellishment are removed. Native text
selection and the application's keyboard-focus outline remain intact.

`tests-shared/search.spec.ts` covers debounce/request counts, cache reuse, IME,
abort signals, late responses, clearing, failure/retry, empty results, alignment,
keyboard focus and touch targets in desktop Chrome and emulated mobile Chrome.
Existing shared social tests verify real artist/project search, navigation and
network recovery. These checks do not constitute physical iOS/Safari testing.

## Collaboration interface (handoff UX-01)

See [the collaboration interface handoff](../docs/collaboration-interface-handoff.md)
for the shared shape/control policy, role/state guidance, per-tab working-copy
recovery, revision review and verification boundaries. The collaboration APIs,
permissions and stored terms/submission history are unchanged.
