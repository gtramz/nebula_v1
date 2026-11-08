# Collaboration workspace consistency (UX-01)

> Historical phase snapshot. For current status, superseding features and consolidated verification, see [Manuel release handoff](manuel-release-handoff.md). Earlier deferred items may now be implemented; the current operation inventory is [integration-contracts.md](integration-contracts.md).

Scope: `/collaborations`, `/collaborations/:id` and their offer/proposal controls.
The integrated local API remains the review backend. No endpoints, migrations,
permissions, payment flows or dependencies are added. USD remains the only fee
currency. The application-wide UX-02 return controls and Discovery performance follow-up
are documented in [navigation-performance-handoff.md](navigation-performance-handoff.md).
The final consolidated handoff PDF remains a separate workstream.

## Shared presentation

`components/antiq/workspace.tsx` defines reusable panels, status badges, return
links and field/action styles. Collaboration screens use the existing Antiq color,
typography and spacing tokens: square surfaces, 12 px fields, pill actions and
44 px minimum button targets. Two-column work/conversation layout starts at
1280 px to keep fields readable beside the sidebar; narrower screens stack it.
The workspace identifies project owner versus collaborating artist, shows the
current state and explains the next permitted action or waiting condition.
Empty lists link to projects or Explore. Decline and withdrawal use the existing
native confirmation pattern and explain closure and continued conversation/file
access. Terms snapshots, offer versions, submission history and downloads remain.

The universal `border-radius: 0 !important` rule is removed. Base-layer defaults
supply field and action shapes; component classes can now express their intent.
Shared Card explicitly uses the square card token; shared Button explicitly uses
pill radii and 44 px targets. Avatars retain `.rounded-full`; waveform ranges keep
the scoped square exception. Shadow suppression and reduced-motion policies are
unchanged. This deliberately affects explicit radius utilities across routes;
Search/navigation and Remix/Discovery regressions are required alongside these
collaboration checks.

## Working copies and recovery

`features/collaborations/drafts.ts` keeps per-tab, artist-scoped working copies in
sessionStorage, with an in-memory fallback when storage is unavailable. This is
not a server draft or a substitute for the existing database. It contains unsent
message/feedback/proposal/delivery/offer text and references to completed uploads,
not file bytes or credentials. Closing the tab, logging out or changing accounts
clears the working-copy lifetime; unavailable storage cannot survive a reload.
Server-side ownership and current terms are always rechecked when sending.

Returning to the list preserves Sent/Received and the relevant scroll container.
Direct workspace entry has an explicit list fallback; it does not rely on history.
Returning/reloading restores unfinished text and completed uploads; terms must be
acknowledged again. A background read failure preserves the loaded form and shows
a retry instead of unmounting it. 401/403/404 do not continue displaying cached
workspace content. A 409 refreshes current terms/state, retains work and requires
review before a new send; it never automatically repeats the mutation.

Restored offer edits from an older revision show the current terms and require
explicitly keeping the edits against that version or loading the current offer.
Completed submissions clear their working copy. Proposal and delivery copies use
separate keys, so transition to delivery cannot inherit proposal attachments.
A current upload or submission warns before link navigation/reload. Leaving or
cancelling an upload aborts the unfinished transfer; already completed files stay
attached, and returning explicitly asks to select missing files again. Transfers
are not resumable byte streams. Browser Back can unmount/cancel an upload; the
same interrupted-upload recovery applies. Notification opening does not unmount
the form or interrupt its transfer.

Synchronous in-flight locks guard review actions, offer saves, submissions and
messages against repeated clicks/events. Fields being sent are disabled to avoid
clearing newly typed text after a response. This is client-side duplicate-submit
protection, not server idempotency across lost responses/reloads. Existing revision
checks protect collaboration transitions; message POST idempotency remains an
integration-contract consideration for Antiq.

## Verification entry points

- `pnpm run typecheck` and an isolated Vite build.
- `pnpm test` for existing local data rules.
- `tests-collaborations/interface.spec.ts`: working-copy restoration, account
  cleanup, notification overlay, failed refresh, stale terms, explicit decline /
  withdrawal, upload navigation guard, duplicate submission/message events, shapes.
- `tests-collaborations/workflow.spec.ts`: both artists complete contact, proposal,
  revision, acceptance, files/delivery and completion; decline/withdrawal/closure.
- Shared navigation/Search, notification context and Remix waveform/proposal
  regressions verify the global corner-policy change outside this workspace.

Use `NEBULA_TEST_PUBLIC_DIR` with the staged build and port 4175 disposable test
data. Never run E2E writes against the review database at port 4174. Back up the
stopped review server and compare all tables and media hashes before activation.
Desktop Chrome and emulated mobile checks are not physical Safari/iOS coverage.
