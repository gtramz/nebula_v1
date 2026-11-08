# Artist identity Phase 1.1

> Historical phase snapshot. For current status, superseding features and consolidated verification, see [Manuel release handoff](manuel-release-handoff.md). Earlier deferred items may now be implemented; the current operation inventory is [integration-contracts.md](integration-contracts.md).

The subsequent [structured taxonomy and private editor extension](artist-taxonomy-extension.md) expands the role catalog and introduces canonical `genreIds`, legacy review and reusable selection controls. This document records the initial data-foundation increment; consult the extension for the current genre contract and editing behavior.

## Technical proposal and scope

Reuse `Artist`, the existing account ID, `State.version = 3`, the SQLite `state` record, the browser store and authenticated RPC transport. Artist and investor remain distinct account types. No new identity table, authentication provider, UI, following edges or recommendation engine.

Public additive fields on Artist: `creativeRoles` (multiple stable professional taxonomy IDs), `genres` (multiple normalized artist genre labels), `collaborationAvailability` (`unspecified`, `open`, `limited`, `unavailable`). Availability is a public, self-declared signal, not a permission or contractual commitment. Roles describe capabilities; they never authorize access. Opportunity needs remain Verse, Feature, Production, Mix and Master, independently of professional roles.

Private optional `artistPreferences` belongs to the existing artist account, never to the public Artist object. Collaboration preferences contain opportunity types, creative roles the artist wants to perform, and existing compensation kinds (`fee`, `split`). Discovery preferences contain genres, project types and opportunity types (including Funding). There is no investor-preference extension in this phase; investment interests for an investor require that later scope. Defaults are empty, not inferred interests.

Use the existing `updateArtist` operation for optional public additions, and owner-only `getMyArtistPreferences` / `updateMyArtistPreferences` RPC operations for private preferences. No user ID can be supplied to target another account. Updates patch specified preference fields; arrays replace the respective set, omitted fields remain intact. Public reads use an explicit allowlist, including nested Artist values in projects and sessions. Preferences are not automatically returned with login/session data.

## Compatibility and genre strategy

There is no canonical musical genre registry in the current repository: the existing field is free text. Preserve `genre` exactly as stored. Without an explicit `genres` value, reads project a nonblank legacy value into one array element, without splitting composites or writing data. Explicit `genres`, including `[]`, takes precedence in the structured representation. The legacy field remains independent for the current UI and search; editing either representation never silently overwrites the other. Phase 1.2 must reconcile this visibly in its editor rather than infer classifications. New labels use Unicode NFC, trimmed/collapsed whitespace, bounded length and case-insensitive uniqueness; no invented project/work genre taxonomy.

All additions are optional in stored v3 data. Reads do not migrate or materialize defaults; only an explicit owner write persists new fields. Existing profile edits retain new fields and private preferences. No existing account must register again. New artists receive no fabricated roles/interests. Public defaults are empty roles and unspecified availability.

Back up the SQLite database and original media before activation. This release requires no destructive migration or DDL. Rollback to a pre-release backup is safe before new writes; after new writes preserve/export the newer state and use a compatible adapter so new professional data is not lost. Do not blindly restore an old database over newer work. Browser backups contain private preferences and remain private; the existing tab migration preserves account-bound data when importing new identities. The explicit browser-to-server identity transfer continues to omit private preferences.

## Validation and future integration

Professional roles use one extensible catalog: vocalist, rapper, producer, beatmaker, songwriter, composer, mixing-engineer, mastering-engineer, instrumentalist, dj. Existing opportunity needs and supported project types are reused from shared constants. Unknown enums and unknown update keys fail; arrays are bounded, normalized and deduplicated, with `[]` as the explicit clear operation. `null` is not an implicit reset. Optional stored extensions are validated on load; invalid persisted data raises the existing recovery error instead of being silently discarded. Investor accounts cannot carry artist preferences.

Public and private domain types and validation contain no browser, SQL or UI dependencies. Future editing and progressive onboarding should call these same operations and populate the same records. Following, messaging, project genres, ranking, Antiq SSO and production migration remain out of scope. Current Home and global Search continue reading the legacy genre field in this phase. For You does not consume these preferences yet.

The existing serial server writes and browser Web Locks protect patch read-modify-write operations. Disjoint preference patches preserve each other; writes to the same field use last-write semantics. Revision-based conflict UX can be introduced when the new editor is implemented.

## Verification and delivery

### Operations and boundaries

All operations use the existing `POST /api/rpc` envelope `{method, args}` and existing cookie, origin checks and serialization. No endpoint or database table was added.

| Operation | Arguments | Access and result |
| --- | --- | --- |
| `updateArtist` | One profile object with required `name` and optional old/new public fields | Current artist only. Omitted fields are preserved; public Artist DTO returned. |
| `getMyArtistPreferences` | `[]` | Current artist only; complete private object with empty defaults. |
| `updateMyArtistPreferences` | One nested partial preference object | Current artist only; specified arrays replace sets, unspecified fields survive. Complete private object returned. |
| Existing public artist/project reads | Existing arguments unchanged | Explicit public Artist projection, without preferences or account secrets. |

Example public update:

```json
{"method":"updateArtist","args":[{"name":"Artist name","creativeRoles":["vocalist","producer"],"genres":["Jazz","Soul"],"collaborationAvailability":"open"}]}
```

Example private update:

```json
{"method":"updateMyArtistPreferences","args":[{"collaboration":{"opportunityTypes":["Feature","Production"],"creativeRoles":["producer"],"compensationKinds":["fee","split"]},"discovery":{"genres":["Soul"],"projectTypes":["ep","single"],"opportunityTypes":["Production","Funding"]}}]}
```

The session remains an explicit projection, not the account storage object. Private preferences are retrieved separately; their React Query cache is cleared on identity changes. Browser-only persistence remains a development preview: records are stored in that browser's local storage, not encrypted or isolated from someone who controls that storage. Server-mode privacy is enforced by authenticated API checks. Central storage/security contracts remain a later integration.

### Modified files in this increment

- `lib/local/src/artist-identity.ts` (new): professional taxonomy, data contracts, defaults, validation, normalization, public projection.
- `lib/local/src/types.ts`: optional public fields and shared project-type constant.
- `lib/local/src/collaborations.ts`: the existing opportunity vocabulary is exposed as a shared constant, without changing its values.
- `lib/local/src/opportunity-search.ts`: reuses/re-exports those same constants; filtering and search behavior are unchanged.
- `lib/local/src/state.ts`: optional private account field and stored-extension validation.
- `lib/local/src/store.ts`: compatible public profile patching, owner-only private operations and public allowlists.
- `lib/local/src/browser.ts`, `remote.ts`, `index.ts`: existing persistence lock/transport and hooks; explicit public fields for browser identity transfer. Private preferences remain in the source browser during transfer.
- `server/validation.ts`, `server/app.ts`: validate additions and expose owner-only RPC operations.
- `artifacts/nebula/src/context/AuthContext.tsx`: remove the new private preference cache on identity change. No layout change.
- `lib/local/src/artist-identity.test.ts` (new), `server/app.test.mjs`, `tests-shared/artist-identity.spec.ts` (new), `tests-shared/publications.spec.ts`: compatibility, ownership/privacy, persistence, old editor and transfer coverage.
- This handoff and `server/README.md`: domain contract and operational documentation.

### Phase 1.2 dependencies

The next UI can consume the shared catalog and existing public/private operations. It still needs an approved profile/editor layout, a visible reconciliation of the retained legacy genre with structured genres, the choice of a curated genre registry/aliases if desired, and product copy for self-declared availability. Onboarding should populate these same fields. No extra onboarding records are needed. Profiles, onboarding, following, general messaging, personalization and real Antiq production integration have not been implemented by this phase.

### Final verification and activation on 2026-11-07

138 distinct automated checks passed: 47 unit, 21 API, 26 Home/Search/Project Browser/profile/publication browser checks, 8 navigation, 8 collaboration interface and 28 browser-only account/Discovery/history/offline checks. Library, server and UI type checks, production build and `git diff --check` passed. Existing sourcemap and large-bundle warnings remain. Desktop Chrome and emulated mobile were exercised; this is not physical-device or branded Safari certification.

The initial combined shared-browser run reached the existing per-IP authentication limit, causing two mobile publication checks to receive 429. The complete six-case publication suite passed on a fresh isolated test server. Authentication limits were unchanged. Failure artifacts remain alongside final results.

Activated at `http://127.0.0.1:4174` with `index-BZrixrTr.js` and `index-DmCquHOO.css`. Live read-only smoke confirmed public additive fields and 401 for unauthenticated private preference access. The current user interface remains unchanged.

Backup: `.data/backups/before-artist-identity-20261107T201812Z`. Post-activation comparison verified all 18 original SQLite tables and all five original media files unchanged; database integrity was OK. No roles, genres or preferences were fabricated or persisted for existing accounts. New fields are materialized only through an explicit owner update. Evidence: `../auditoria/artist-identity/verification.json`, test logs and screenshots.
