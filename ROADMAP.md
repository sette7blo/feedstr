# Feedstr Roadmap

Direction and sequence only. **Detail lives in GitHub Issues** —
[open issues](https://github.com/sette7blo/feedstr/issues).

- This file answers *what order, and where are we?*
- An issue answers *what exactly, in which files, and how do we know it works?*

Neither duplicates the other. If a line here needs a paragraph, it needs an issue.

## Working agreement

Work is tracked as issues using the **Agent task** template:

| Label | Meaning |
|---|---|
| `needs-spec` | Captured, not yet actionable. Needs a brief before anyone codes. |
| `ready` | Spec'd well enough to start with no other context. |
| `priority: high` / `medium` / `low` | Ordering within `ready`. |
| `idea` | Not committed to. May never be built. |

Start a session with `gh issue list --repo sette7blo/feedstr --label ready`. Close issues
from the commit that finishes them (`Closes #12`). Milestones are releases, so
`[Unreleased]` in `CHANGELOG.md` is whatever is closed in the open milestone.

## Where we are

**Released:** `v0.5.0` (2026-07-21) — [changelog](CHANGELOG.md)

**On `main`, unreleased:** Pass 8 and Pass 9 (`e04993c`, 2026-07-24), tracked in
[milestone v0.6.0](https://github.com/sette7blo/feedstr/milestone/1). Both shipped
syntax-checked and built but never exercised on a device, which is the whole content of
that milestone.

## Pass log

A numbered sequence of focused UI passes, each one surface at a time. Numbering is
reconstructed from `CHANGELOG.md` and the `?v=` asset tags in `public/index.html`
(`compose.js?v=compose-pass-5`, `helpers.js?v=media-pass-9`) — it was never written down
while the work happened, which is why this file exists.

| # | Pass | Status |
|---|---|---|
| — | Frontend split: inline script to `public/app/*.js`, no build step | v0.5.0 |
| 1 | Note cards and note actions | v0.5.0 |
| 2 | Column headers | v0.5.0 |
| 3 | Notifications | v0.5.0 |
| 4 | Profile column hero | v0.5.0 |
| 5 | Composer and inline replies | v0.5.0 |
| 6 | Mobile / PWA shell | v0.5.0 |
| 7 | Whole-app visual consistency | v0.5.0 |
| 8 | Timeline quality filters (Notes / Replies / All / Media) | on `main`, [unverified](https://github.com/sette7blo/feedstr/issues/2) |
| 9 | Media lightbox | on `main`, [unverified](https://github.com/sette7blo/feedstr/issues/1) |

The sequence ends at 9. There is no Pass 10 yet — file one as `needs-spec` when a surface
is worth a pass.

## Next

1. Verify Pass 9 on iPhone portrait — [#1](https://github.com/sette7blo/feedstr/issues/1)
2. Verify Pass 8 in a browser and on iOS — [#2](https://github.com/sette7blo/feedstr/issues/2)
3. Release v0.6.0 — [#3](https://github.com/sette7blo/feedstr/issues/3)

## Standing constraints

These hold for every pass and do not need restating in each issue.

- **Feedstr never signs.** Unsigned events go to Idenstr; keys never touch Feedstr.
- **`kind:3` is Idenstr-owned.** Follows go through Idenstr's `following` endpoints, never
  authored here.
- **Three stores stay distinct:** draft, private relay, public relays.
- **No build step.** Vanilla JS, plain CSS, `public/` is the deliverable.
- **Bump the `?v=` cache-buster** for every edited JS/CSS file or devices run stale code.

## Not planned

Deliberate omissions, so they stop being re-proposed: trending, algorithmic ranking,
engagement analytics, multi-user hosting, and any login of its own (Feedstr is a
trusted-network app behind a proxy).
