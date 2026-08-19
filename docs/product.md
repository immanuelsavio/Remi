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
each 5-day streak multiple. Restart Day clears today but keeps backlog,
history and preferences.

**Streaks.** A day counts when it has completed work. Weekends, PTO and
revived days bridge a gap for free. The first genuinely missed weekday
ends the streak. Dates before day 1 are never misses. PTO can only be set
for today or later — never retroactively.

**Evidence.** Interruption count / total / longest / per focused hour /
top causes by time cost / stretched tasks. Plus the time-sense trainer:
logs estimate-vs-actual on completion when `trainerOn`, and gives a
verdict — accurate ≤1.1×, "a bit over" <1.5×, otherwise "you underestimate
a lot… try estimating, then doubling."

**Data.** Backlog. Structured text import with a preview and a copyable
prompt. JSON backup export + restore. Opt-in anonymous usage logging.
Reset & Uninstall with a keep-history option.

**Preferences.** Light/dark × six accents. Workday target. Check-in
interval. Five wellness nudges (water / stand / walk / lunch / break) —
opt-in, one at a time, never during a break, never touch the clock. Daily
routines. Private notifications, which keeps task names out of OS
banners.

See [timing-and-interruptions.md](timing-and-interruptions.md) for the
behavioral contract behind these features.
