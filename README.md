# nebula_v1

Nebula's complete interface and browser-only functional shell.

## Run

Use Node.js 22 or newer and pnpm 11.21.0.

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
- Discovery, categories, artist pages and search.
- Symbolic artist support, contribution previews, pledge history and receipts.

The shell starts empty. Profiles and records entered during a preview stay in the current browser tab's session storage. They survive a page refresh and can be removed with **clear preview**. They are not published with the source code.

All actions are interface previews. Profiles are not real service accounts and contribution previews do not move money. There is no application server, database service, payment service, identity provider, telemetry, API client, remote media or remote font loading. The page policy blocks fetch, XHR, WebSockets and frames. Standard packages are downloaded during installation and then bundled locally.

## Checks

```sh
pnpm test
pnpm build
pnpm test:browser
```

The browser checks use a local installation of Google Chrome. They cover desktop and mobile flows while the browser is offline after the initial page load.

## Source layout

- `artifacts/nebula`: interface and local assets.
- `lib/local`: tab storage, local interactions, types and React hooks.
- `tests`: browser verification.

Author: **manuellcossio**.
