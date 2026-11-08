# Antiq Nebula

A React/Tailwind application with a **persistent local mock backend**, prepared for Manuel to connect to Antiq's existing central system. It is not connected to production Antiq identity, storage, payments or royalties.

## Run the integrated review environment

Use Node >=24.17, pnpm 11.21.0, FFmpeg and FFprobe. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Open <http://127.0.0.1:4174>. The same process serves the UI, API and authorized media. Accounts and product data persist in SQLite; uploads remain on disk under `.data/server`. The directory is ignored by Git. **Cloning this public repository does not copy anybody's account, uploads or private messages.**

For configuration, safe backups, restoration, media tools and deployment preparation, see [server operations](server/README.md). For the complete return handoff, read [Manuel's release handoff](docs/manuel-release-handoff.md) and [operation contracts](docs/integration-contracts.md). [Resumen para Manuel en español](docs/cambios-para-manuel.md).

## Environments and routes

| Environment | Purpose |
| --- | --- |
| `pnpm dev`, 5173 | Isolated browser-only prototype; no implicit API proxy. |
| `pnpm preview`, 4173 | Static browser-only preview; not backend integration evidence. |
| `pnpm start`, 4174 | Primary persistent local mock review environment. |
| Playwright integrated suites, 4175 | Automatically created disposable database and files; run suites sequentially. |

The integrated server stamps the HTML with its data mode. Failed API calls never fall back silently to demo records. The browser-only prototype uses separate local/session storage and does not implement every connected feature.

## Current product

- **Artist / visitor Home** at `/explore`: eligible projects with active creative offers or funding; contextual search, autocomplete, per-identity search history, multi-dimension filters, For You, Recently created and Following. Investor Explore retains the project catalog. `/` remains the public landing page.
- **Global Search** at `/search`: artists and public projects, distinct from Home's opportunity search. Both resolve the artist's structured genres while preserving legacy text provenance.
- **Discovery** at `/discovery`: audio/video publications, stars, comments, saves, sharing, contextual project/offer access and private Remix entry. Mobile fills the space above navigation. `/discovery?demo=1` is a separate, labeled sample feed.
- **Identity**: automatic role detection on login; Artist onboarding, multiple creative roles/genres, public professional profile and private preferences. Concurrent profile edits merge unrelated fields and reject conflicting changes.
- **Social graph**: real Artist follow/unfollow, counts, paginated public lists and Following in Home. Follow notifications are transactional, recipient-scoped and deduplicated by relationship occurrence.
- **Messages**: one inbox for general requests and offer-based proposals. Recipients accept/reject requests before general conversation. Existing collaborations retain files, terms, revisions and their original authorized routes.
- **Projects and songs**: ordered reusable songs within Single/EP/Album projects; optional song-scoped offers and publications; stable contextual links. Songs are metadata, not a new audio player or royalty ledger.
- **Private Remix** at `/studio/remix`: resumable owner-bound settings, contributions and renders, waveform clip selection and audio/video mixing. Only a submitted final mix is shared with authorized collaboration participants. No new public remix publishing; historical published remixes remain intact.
- **Notifications**: one in-screen panel, persistent read state and typed collaboration/profile/conversation destinations. `/notifications` remains a compatible direct entry. Polling is not real-time push.
- **USD previews**: private Investor Pledges and Artist Received history, receipts and independently opt-in public identity/amount. These are simulated contributions, not money movement. Removing a project preserves its financial history.

Navigation uses a 240/72 px desktop sidebar, a 72 px tablet sidebar and mobile bottom navigation. Mobile Profile contains More, Logout and the existing Contributions received access; desktop keeps its controls. Contextual returns preserve relevant filters, drafts and active feed position.

## Validation

```sh
pnpm test
pnpm test:server
pnpm build
pnpm test:browser
pnpm test:shared
pnpm test:collaborations
pnpm test:remix
pnpm exec playwright test --config playwright.discovery.config.ts
pnpm exec playwright test --config playwright.return.config.ts
pnpm exec playwright test --config playwright.performance.config.ts
```

Browser suites use locally installed Chrome; cross-browser suites also require Playwright WebKit (`pnpm exec playwright install webkit`). Run integrated suites sequentially. The `test:shared`, `test:collaborations` and `test:remix` scripts create a fresh test server per specification to respect the real registration rate limiter. Direct Playwright commands spanning many specifications should be split similarly. `NEBULA_TEST_PUBLIC_DIR` selects a staged build; `NEBULA_TEST_SERVER_MODULE` selects an explicitly compiled baseline for controlled comparisons. Both are test-only options and always use temporary data.

## Boundaries

The local service is single-process. Production central identity/storage integration, password recovery/email verification, moderation, malware scanning, legal agreements, payments and royalty settlement remain separate. Following and preference-based Home ranking are implemented; they are not substitutes for Antiq's central services or a machine-learning recommendation engine. Combined/negotiable compensation and project-specific genre metadata are not fabricated.

Source: `artifacts/nebula` (UI), `lib/local` (types, adapters and browser prototype), `server` (local mock API), `tests*` (isolated validation). Historical phase handoffs in `docs` describe their respective releases; the consolidated release handoff takes precedence for current status.
