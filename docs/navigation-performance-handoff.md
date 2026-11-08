# Return navigation and Discovery performance (UX-02 / PERF-01)

> Historical phase snapshot. For current status, superseding features and consolidated verification, see [Manuel release handoff](manuel-release-handoff.md). Earlier deferred items may now be implemented; the current operation inventory is [integration-contracts.md](integration-contracts.md).

This delivery extends the shared collaboration controls to the rest of the UI.
It keeps the existing runtime boundary: no new API, migration, dependency,
production provider or account/project/media changes.

## Return navigation

`components/antiq/workspace.tsx` owns `ReturnLink` and `ReturnButton`: arrow +
text, 44 px targets, hover/pressed/focus states. Project and artist headers,
publication editing/errors, the studio, saved publications, private Remix and
its proposal step, the demo feed, receipts, authentication, notification fallback
and 404 screens use these controls. Brand/home navigation remains separate.

`components/shell/return-context.tsx` records in-memory navigation context scoped
to the signed-in identity. Catalog and Search retain category/query, their actual
scroll container and the originating link's focus. A project or artist returns
to its contextual parent; direct entries use Explore. The publication editor has
an explicit studio fallback. Discovery restores a stable publication ID instead
of a pixel offset. An explicit post URL takes priority over a remembered post.
The private studio returns to its source publication. Collaboration Sent/Received
and per-tab working copies keep their existing implementation.

Context is UI memory, not an additional persistence system: a full reload or
account switch starts fresh context. It does not store credentials or file bytes.
Async list restoration waits for content, is bounded to four seconds and gives
control back immediately when the user scrolls, touches or types. Returning to a
removed/unavailable item falls back to the available view; it cannot resurrect
withdrawn publications.

`components/shell/navigation-guard.ts` protects dirty publication, project,
profile and Remix edits and pending collaboration uploads/submissions. It checks
internal link intent before handlers perform side effects (including notification
read writes), plus programmatic route changes and indexed same-document Back /
Forward. Cancelling leaves the editor and its work mounted. Confirming discards
unsaved work; the explicit save flows and existing private drafts are unchanged.
Document exits use the browser's native beforeunload protection. Browser policy
controls that prompt, and external/cross-document history is not intercepted by
the SPA. Return controls always have explicit destinations rather than relying on
an unknown browser history entry. Download/new-tab links are not treated as exits.

## Discovery changes

- Keep at most three media elements: active publication and immediate neighbors.
  Retain lightweight cards and stable IDs for native scroll snap. Leaving that
  window releases the decoder/source and visibility listener. Audio remains
  opt-in; inactive media pauses; opening panels does not resume playback on close.
- Memoize media components and publication presentation models so unrelated feed
  updates reuse unchanged media. Artwork is lazy-loaded. Waveform requests consume
  their query cancellation signal and have a bounded freshness/cache interval.
- Use one passive scroll listener coalesced with requestAnimationFrame. Fixed-height
  card geometry determines the active item. ResizeObserver schedules alignment
  outside its callback instead of writing scroll while observing size changes.
  Keyboard/next/previous pause the outgoing player before moving.
- Retain the ranked feed snapshot/pages in the account-scoped query cache for five
  minutes after leaving, to restore the same feed context. Refresh feed remains an
  explicit fresh load. A transient refresh failure preserves the visible feed and
  offers retry; access/not-found failures do not keep presenting a cached selected
  publication. Server permission checks and snapshot expiry remain authoritative.
- Very short landscape viewports use two columns of action buttons, preserving
  44 px targets and clearance above mobile navigation even with the demo return.

## Reproducible comparison

`playwright.performance.config.ts` and `tests-performance/feed.spec.ts` compare a
fixed 30-publication feed, alternating the same local 8-second audio/video files.
There are 50 down/up transitions per profile, with 100 ms between transitions to
exercise playback, followed by panel and breakpoint changes. Traces, screenshots
and raw JSON include browser version, environment and per-transition latency.
The setup uses an isolated temporary database, never the user's examples.

The local before/after baseline is the version immediately preceding this work,
`bd7b9e299615d543070c6e39f7de1e43fe1e2f44`. This isolates this delivery's effects.
It is not the original handoff baseline `aecbd000`; the overall delivery comparison
against that earlier version still belongs to QA-01.

Profiles: installed Chrome desktop, Chrome iPhone emulation with 4x CPU slowdown,
Playwright WebKit desktop and WebKit iPhone emulation. WebKit is not branded Safari;
none is a physical mobile device. Network is loopback with default browser caching.
No production-network, battery, memory-pressure or low-end physical-phone claim is
made. Synthetic fixtures do not represent every codec, file size or feed length.

Latency measures dispatch through active-card state + scroll alignment at an
animation-frame opportunity; it is not time to a decoded video frame. rAF interval
samples estimate missed frame opportunities over the whole measured journey,
including resize/panels; they are not a hardware/video dropped-frame counter.
Long-task entries (>50 ms) are collected where supported (Chrome); WebKit's lack
of that API is reported as unavailable, not as proof of zero long tasks. Traces and
functional playback tests complement these metrics.

Artifacts are under `../auditoria/navigation-performance/` in the local workspace.
Raw traces/test accounts are review evidence, not public repository fixtures.

## Checks and operational boundary

Run the production build and type checks. Run unit tests and the shared,
Discovery, collaboration and Remix browser suites against a staged build using
`NEBULA_TEST_PUBLIC_DIR`. Return-only cross-browser coverage is reproducible with
`playwright.return.config.ts`; `playwright.performance.config.ts` accepts
`NEBULA_PERF_OUTPUT` and `NEBULA_PERF_BUILD` for separate comparison artifacts.
Install WebKit with Playwright's existing tooling; it is a test browser, not an
application dependency.

All integrated test configurations use port 4175 and must run sequentially. Split
large account-creation batteries into fresh server runs: otherwise the unchanged
registration rate limit intentionally returns 429. Static/offline checks use 4173.
The live review instance remains 4174. Existing build warnings about the dropdown
sourcemap and large initial chunk are not resolved or relabeled by this delivery.

Before activation, back up SQLite using its backup API and hash every table and
original media file. Preserve the old public build, then atomically replace the
HTML only after copying the new content-hashed assets. Retain old assets for open
tabs. Compare data hashes afterward. No reset, test registration or test publication
is performed against 4174. Refresh the app after saving any current work to load
the release.

Remaining acceptance outside this local implementation: physical low-performance
mobile testing, branded Safari/version-specific checks, real production-network
conditions, the global `aecbd000` comparison and the final English PDF handoff.

## Recorded local results — 7 November 2026

Release assets: `index-DQNUljYj.js` and `index-DrZc-RX3.css`.

| Profile | Median before → after (ms) | p95 before → after (ms) | Peak media elements before → after |
| --- | --- | --- | --- |
| chrome-desktop | 8.9 → 8.7 | 16.9 → 17.7 | 30 → 3 |
| chrome-mobile | 11.9 → 11.7 | 18.2 → 16.7 | 30 → 3 |
| webkit-desktop | 101.0 → 11.0 | 103.0 → 108.0 | 30 → 3 |
| webkit-mobile | 100.0 → 11.0 | 104.0 → 115.0 | 30 → 3 |

Chrome 157.0.8103.38; WebKit 27.2. All four release profiles completed 50
transitions with zero overlapping playback samples and zero page errors. Chrome
recorded no long tasks in these runs; that metric is unavailable in WebKit.
Typical WebKit transition latency improved, but its p95/max did not improve
uniformly. This is a controlled local sample, not proof of universally faster
playback. The clear resource result is 30 → 3 mounted media elements; further
real-device/codec/network profiling remains necessary.

125 distinct scenario/profile checks passed across unit (31), shared Chrome (36),
Discovery Chrome (6), collaboration/notifications Chrome (14), Remix Chrome (14),
additional WebKit return tests (8), final performance profiles (4), and offline
Chrome checks (12). Repeated checks and before-build benchmark runs are excluded.
Earlier candidate failures are retained in the evidence directory; corrected
checks were rerun successfully. They exposed short-landscape clearance, WebKit
pointer-origin focus and notification side-effect ordering; the latter now
confirms navigation before marking a notification read. Two old receipt-link
locators were updated to the unified labels. A combined account-heavy test run
hit the existing 429 registration limit; separate fresh-server runs passed.

The backed-up 18 SQLite tables and five original media files matched exactly
before and after frontend activation; SQLite integrity was `ok`. Existing accounts,
examples, private drafts and uploaded media were not reset. Complete local evidence
and build identifiers are in `../auditoria/navigation-performance/verification.json`.
