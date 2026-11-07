# nebula_v1

Nebula's complete interface and browser-only functional shell.

## Private remix workspace

New remixes use `/studio/remix`: private editable drafts, durable tracks and settings, and proposal-only sharing of final mixes. Public release of new remixes is deferred. Existing published remixes are preserved. See [private remix implementation and API contracts](docs/private-remix-handoff.md).

## Persistent server and publications

`pnpm build && pnpm start` runs the shared local server on
`http://127.0.0.1:4174`. Accounts, projects and publications persist in SQLite;
uploaded media persists on disk. Artists can use **Profile → Your publications**
to upload, draft, publish, edit and withdraw posts. Discovery shows real posts;
its separate demo is available at `/discovery?demo=1`.

See [server setup, migration, deployment and backups](server/README.md).
The browser-only prototype described below remains available via `pnpm preview`
on 4173 for isolated demos and regression testing. Its storage and auth behavior
do not describe the persistent server mode.

## Run

Use Node.js 24.17.0 or newer and pnpm 11.21.0.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Open the local address printed in the terminal.

```sh
pnpm build
pnpm preview
```

The production files are in `artifacts/nebula/dist/public` and can be served as a static site with an SPA fallback.

## Included flows

- Landing screen, desktop and mobile navigation, and animated registration.
- Artist and investor profile creation, sign-in, sign-out and reset.
- Artist profile editing and images selected from the device.
- Project creation, editing, deletion, draft and funding states.
- Discovery demo feed, plus the separate Explore project catalog, categories, artist pages and search.
- Symbolic artist support, contribution previews, pledge history and receipts.

All new projects and pledges use **USD only**, with two decimal places. Removing a
project hides it from Explore and stops contributions, while preserving its
pledges, receipts and historical funding totals. A receipt for a removed project
links back to pledge history.

Investors use **Pledges** (`/pledges`) for a private history grouped by project,
with individual receipts and public visibility settings. Artists use **Received**
(`/received`) for contributions to their own projects, including removed projects.
Both views have project, date and availability filters.

Public project pages show one entry per investor, combining repeat contributions.
Name and cumulative amount are independently opt-in and hidden by default. Settings
apply to all of an investor's contributions to that project, including earlier ones.
The recipient artist still sees the name and individual amounts in private history.
Public totals and backer counts stay visible, so individual amounts may be inferred
when a project has very few contributors. Lists initially show ten public backers,
with a control to reveal more. Individual transactions remain separate privately.

Accounts, artist profiles and USD records are saved in this browser's localStorage
under `nebula-usd-preview`. They survive closing and reopening tabs. Sessions use
`nebula-session` in sessionStorage, allowing independent artist/investor sessions.
Use the same browser profile and origin (host and port). Clearing browser site data
or ending private browsing can remove these records; this is not server-backed auth.

Startup imports existing USD tab data and valid identities from the obsolete demo.
Original snapshots remain untouched. Obsolete projects and transactions are not
imported. Import markers prevent duplication and resurrection after demo cleanup;
conflicting credentials or damaged imports stop with a backup/retry screen rather
than overwriting accounts. First USD import preserves project/receipt IDs; merging
independent snapshots remaps colliding IDs. Web Locks serialize all writes, and
storage events refresh other tabs without changing their signed-in identity.

Login uses only email and password and detects the profile automatically. Role
selection is available only at signup; new registrations require a unique email.
Legacy duplicate emails remain intact: a unique password match selects the profile,
while multiple matches require account recovery rather than guessing a role. Account activity displays the user's most recent
20 events from a browser-wide bounded log of 200 events; no passwords are logged.
**Clear demo data** removes projects, pledges and supports across tabs while keeping
accounts and artist profiles. Recovery of corrupted persistent data still offers
an explicit full reset after a backup. Backups contain private profile data.
The demo's visibility controls are UI behavior, not server security.

All actions are interface previews. Profiles are not real service accounts and contribution previews do not move money. There is no application server, database service, payment service, identity provider, telemetry, API client, remote media or remote font loading. The page policy blocks fetch, XHR, WebSockets and frames. Standard packages are downloaded during installation and then bundled locally.

## Checks

### Discovery prototype

`/discovery` is a presentation-only vertical feed with three clearly labeled
samples: a video linked to a project with collaboration offers, standalone audio,
and an attributed remix. Project details open beside the feed on desktop or in a
bottom sheet on mobile. `/explore` remains the existing project catalog.

Stars, saves and new comments live only in component memory and reset on reload
or leaving Discovery. They never write to the account/project/history store.
Visitors can browse and read comments; signed-in artists and investors can react,
comment and copy sample links. Remix previews are artist-only and respect each
sample author's permission. Recording, publishing, messaging, submissions,
agreements and star-based distribution are not implemented in this stage.

Only the active media can play. Video enters muted; audio requires a play gesture.
Panels and hidden tabs pause playback; closing a panel does not resume it.
Reduced-motion users start video manually. Shared links use
`/discovery?post=after-hours`, `soft-signal`, or `after-hours-rework`; localhost
links are only usable where the application is running.

Media assets in `artifacts/nebula/public/discovery-demo` are original synthesized
tones and abstract canvas animation, with no third-party recordings or downloads.
They are committed as static assets; generating them is not required for builds.
To regenerate using the existing Playwright dependency and local Chrome:

```sh
node scripts/generate-discovery-media.mjs
```

### Validation

```sh
pnpm test
pnpm build
pnpm test:browser
```

The browser checks use a local installation of Google Chrome. They cover desktop
and mobile flows, including offline account/project behavior and Discovery's
playback, role restrictions, temporary interactions, panels and keyboard access.

## Source layout

- `artifacts/nebula`: interface and local assets.
- `lib/local`: persistent browser storage, local interactions, types and React hooks.
- `tests`: browser verification.

Author: **manuellcossio**.
