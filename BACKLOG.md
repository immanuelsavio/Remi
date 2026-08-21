# Backlog

Work we know we want but haven't done. Not a roadmap and not a promise —
a place to park a decision so it stops living in someone's head.

Keep entries short. When one gets picked up, move it to a CHANGELOG entry
rather than leaving a tombstone here.

---

## Trust and integrity

### Stamp backups with a hash

**Why.** Mostly for fun, and a little for pride: a backup is plain JSON, so
anyone can open one, invent three weeks of completed work, restore it, and
hand themselves a 40-day streak. Nobody is going to, but it is a nice touch
that the file can say "Remi wrote this and nobody edited it since".

**Shape.** Hash the history-ish fields on export, check it on restore. A file
that does not match still restores — this is a personal tool, not DRM — it
just says "unverified" next to anything derived from history.

**Worth knowing before building it.** A hash computed on the user's own
machine can be recomputed by that user, and any key baked into the binary
can be pulled back out. So this is a seal on an envelope, not a lock: it
makes casual editing obvious and that is all it is for. Fine — just do not
let the UI imply more.

**Open question.** Which fields go in. Include volatile ones and every
honest backup fails its own check.

## Updater

### Verify the self-update path end to end

The update _check_ and the _install_ trigger both exist, but neither has
ever run against a real published release — there hasn't been one. Before
trusting it: publish a release, install an older build, and confirm the
check finds it, the download verifies its checksum, the app replaces
itself, and it relaunches on the new version.

### Delta or background updates

Today an update re-downloads the whole `.app` archive. Fine at ~5MB; worth
revisiting if the bundle grows.

---

## Brand

### Keep the accent in step with the mark

`--accent` is `#ec6a4a`, sampled by hand from the icon's coral. The mark's
ring is now teal, so the app's accent and its icon tell slightly different
stories. Not wrong — coral is still in the mark — but worth a deliberate
look rather than drift.

## Platform

### Windows build and installer

The Rust code has real Windows paths (including an atomic-replace for state
writes) but there is no Windows CI job, no installer, and nobody has run it.
Either finish it or stop implying it exists.

### Self-host the web fonts

`global.css` pulls Fraunces and IBM Plex from Google Fonts, so first launch
makes an outbound request from an app otherwise described as local-only.
Vendoring the `.woff2` files (~200KB) removes the request and makes the app
work offline. Needs a CSP change.

---

## Product

### Screenshots in the README

The `assets/tray/` photos show the pre-redesign interface. The README has no
images at all as a result. Needs clean captures of the popover, the task map
and the Stats tab.

### Per-step carry decisions

End Day and Start Day both let you route a whole task. A task with six steps
where only one is left over still carries all six.

### Notification grouping

Several reminders due at once post several banners.
