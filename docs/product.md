# Product

Remi is a macOS/Windows menu-bar day tracker for people with ADHD. It lives
in the menu bar (no Dock icon), opens as a small popover under its tray
icon, and has a second, larger window for planning and evidence.

## The real subject is interruptions

Every other time tracker answers "how long did you work on this?" Remi also
answers "how long did this _take_, in wall-clock, from first touch to
done?" — and the gap between those two numbers is the whole point:

```
accrued          = focused time actually spent          (2h)
completedAt − firstStartedAt = real elapsed span        (5h)
                                     ↑
                        this gap is what interruptions cost
```

That gap is why someone can estimate a task accurately and still lose the
day. The app captures it as first-class evidence: what interrupted you, for
how long, and **which task paid for it**. Everything else — streaks,
nudges, the trainer — serves the same goal of making invisible time
visible.

## The three difficulties it's designed around

| Difficulty                                         | The feature that addresses it                                  |
| -------------------------------------------------- | -------------------------------------------------------------- |
| **Time blindness** — no felt sense of elapsed time | Live timer in the menu bar itself; nothing to click            |
| **Avoidance** — a task silently moves day to day   | `carries` counter, and a nudge at 3+ days                      |
| **Interruption cost is invisible**                 | Per-occurrence interruption records charged to the victim task |

Tone matters and is part of the spec: the app never scolds. Copy is
"You've moved this 3 days running — are you avoiding it? Try just the
first small step", not "OVERDUE".

## Feature reference

**Tasks.** One level of steps (deliberately — deeper nesting is a planning
trap). Notes on tasks and steps. Estimates. Reminders. Promote a step to
its own task keeping all its time. Delete with undo. Revive a completed
task. Prune blanks.

**Tags.** Free-form labels on a task, for project or kind. Normalised on
entry — lower-cased, leading `#` stripped, whitespace collapsed, 32
characters max, deduplicated, 12 per task — so the same label typed three
ways is one tag and the filter lists stay short. Tags travel into the
archived record, which is what makes a tag-filtered report over history
possible. They apply going forward only: days archived before tags existed
carry none.

**Working.** Start / switch (remembered or not) / interrupt with a
brand-new task / work a specific step. Timed breaks with extend and
resume-the-same-work.

Bounded check-ins fire at `pingMin × 1`, `× 2`, `× 4`, then stop for the
session. Measured against the _current session_ only — using all-time
`accrued` would make a task holding 30 minutes ping the instant it
resumes.

**The day.** Start Day seeds carried tasks + daily routines (skipping
duplicates). End Day takes a per-task disposition — `done` / `carry` /
`backlog` — archives an enriched snapshot, and awards a revive heart at
each 5-day streak multiple. Skipping the per-task step carries everything;
that is the default because the alternative reads as "wrapping up deleted
my tasks". Restart Day clears today but keeps backlog, history and
preferences.

**Reopening a day.** End Day writes a `resumable` snapshot taken _after_
the session is banked and the clock stopped, but _before_ the per-task
dispositions are applied. Reopening therefore undoes the dispositions and
nothing else — a task sent to tomorrow returns flagged `deferred`, one
parked in the backlog stays parked, one dropped stays dropped, and a day
closed with no decisions reopens exactly as it was. Banked time is never
rewound, because it was really spent.

**Streaks.** A day counts when it has completed work. Weekends, PTO and
revived days bridge a gap for free. The first genuinely missed weekday
ends the streak. Dates before day 1 are never misses. PTO can only be set
for today or later — never retroactively.

**Evidence.** Interruption count / total / longest / per focused hour /
top causes by time cost / stretched tasks. Search over every archived day
plus today, by title or tag, newest first with a running total —
deliberately _not_ over notes, and the empty state says so. The calendar
includes today rather than only archived days. Plus the time-sense trainer:
logs estimate-vs-actual on completion when `trainerOn`, and gives a
verdict — accurate ≤1.1×, "a bit over" <1.5×, otherwise "you underestimate
a lot… try estimating, then doubling."

**Data.** Backlog. Structured text import with a preview and a copyable
prompt. JSON backup export + restore. Opt-in anonymous usage logging.
Reset & Uninstall with a keep-history option.

**Work record.** A standalone HTML report built by a pure function in
`domain/report.ts`: brand mark, per-day task tables with focused time,
anything left open, and an optional interruption section naming the cause
and the task charged for it. Range is all / this year / this month /
explicit `from`–`to` (reversed dates are tolerated), and it can be filtered
by tag. **Filtering rewrites each day rather than merely hiding rows** —
`totalMs` is recomputed and interruptions charged to excluded work are
dropped — so the header can never claim hours the body does not show.

**The tour.** Fourteen steps declared as pure data in `domain/tour.ts` and
rendered by a corner-pinned panel, not a modal: each step switches the
dashboard to the tab it is describing, and a scrim would cover the exact
thing being pointed at. Auto-runs once per install (`tourSeen`), and is
re-runnable from Settings → Help. The steps are data so they can be
tested — required ids present, ids unique, every step has body copy, no
step points at a tab that does not exist.

**The mascot.** Remi is a mouse — the icon, the wordmark and the menu-bar
silhouette all agree — and `components/shared/Mascot.svelte` draws it as
live SVG so the pose can carry state: `run` while the clock runs, `sleep`
during a break, `idle` when the day is open but nothing is timed, `cheer`
once when today's list is clear. It is a status readout in the periphery,
which is the same argument as the menu-bar timer. Two independent ways to
stop it, composing rather than overriding: `mascotOn` hides it entirely
(the component self-gates, so call sites don't each repeat the check), and
`prefers-reduced-motion` freezes it mid-pose via the global rule. Its
palette is hard-coded brand colours rather than theme tokens — a mouse that
changes colour with the accent picker stops being the animal on the icon.

**Preferences.** Light/dark × seven accents. Workday target. Check-in
interval. Five wellness nudges (water / stand / walk / lunch / break) —
opt-in, one at a time, never during a break, never touch the clock. Daily
routines. Private notifications, which keeps task names out of OS
banners.

See [timing-and-interruptions.md](timing-and-interruptions.md) for the
behavioral contract behind these features.
