# Manual smoke test

Automated tests cover behavior; this checklist covers what only a human
clicking through the real menu-bar app on macOS or Windows can verify.
Use an isolated data folder if you don't want to touch real state (set
`dataFolder` in `settings.json`, or just note that this is a fresh
install).

1. [ ] The app launches without a Dock icon (macOS) flashing at any
       point.
2. [ ] The ring/mascot mark appears in the menu bar / system tray.
3. [ ] Clicking it opens the anchored popover, positioned under the tray
       icon (or top-right if no tray event has fired yet, e.g. a
       Spotlight reopen).
4. [ ] Clicking it again closes the popover (not a flicker-reopen).
5. [ ] Start Day works: seeds carried tasks + standard-daily routines,
       moves to the "today" list.
6. [ ] Add a task and a step.
7. [ ] Start timing a task, watch the timer run, stop it (switch or
       complete).
8. [ ] Use "Something came up" to interrupt, then return to the original
       task — confirm the interruption evidence shows up (Stats tab).
9. [ ] Start a break, extend it, end it — confirm it resumes the same
       task.
10. [ ] Open the command center (Dashboard) from the popover's footer
        link.
11. [ ] Make an edit in the popover (e.g. add a task) and confirm it
        appears in the dashboard without a manual refresh, and vice
        versa.
12. [ ] Close the dashboard window, then reopen it from the tray menu —
        confirm it reopens instantly (warm webview, not a fresh load).
13. [ ] Trigger a notification (e.g. set a 1-minute reminder) after
        granting OS notification permission — confirm it fires.
14. [ ] With both windows open, confirm check-ins/reminders/wellness
        nudges/break-end notifications only ever appear once, not
        doubled from both windows.
15. [ ] Quit the app while a task is running, reopen it — confirm the
        elapsed time was banked only up to the last save (not credited
        for the time the app was closed), and the "Welcome back" offer
        appears if `welcomeBack` is on.
        15a.[ ] Opening the dashboard shows Remi's own wordmark on a splash while
        the day loads, not the word "Loading". It clears on its own and
        never outstays a slow boot.
16. [ ] The guided tour runs by itself on a genuinely fresh install,
        and does **not** run again on the next launch. Settings → Help →
        "Start the tour" brings it back. The walkthrough steps switch to
        the tab they describe, and the app is still clickable throughout.
        16a.[ ] On a FIRST launch specifically (day never started), the tour's
        demo tasks are visible and usable — the Start-day gate is lifted
        for its duration and put back when it ends, so you are still asked
        to start your own day afterwards.
        16b.[ ] Each walking step rings a real element and Remi stands beside it:
        the Plan add-task box, a Start button, "Wrap up the day", the
        calendar grid, and the Stats headline. Everything OUTSIDE the ring
        is blurred, the ringed element is not, and the blurred area is
        still clickable — dimming must never become disabling. Scroll the
        panel; the ring, the blur and the bubble all follow.
        16g.[ ] The bubble never lands on top of the thing it is pointing at, and
        takes the side with the most room rather than always the right.
        Opening the reminder sheet from a tour step hides the bubble until
        the sheet closes, instead of covering the date fields.
        16c.[ ] On the Plan step, type a task and press Enter: the tour STAYS on
        that step and the instruction changes to "now add a step". Work
        through step → tag → deadline and confirm each one is ticked off as
        you actually do it, that the ring moves from the add box onto YOUR
        task (never a demo one), and that Next still skips ahead if you
        would rather not. Enter in the tour's own name field still advances.
        16e.[ ] On the "Finding it again" step, press a tag chip or type in the
        Calendar search — the beat ticks and the results appear.
        16f.[ ] On the notification step, press "Send me a deadline and a water
        nudge": macOS asks permission the first time, then TWO real banners
        arrive about a second apart, and the water one also raises the
        in-app nudge card. Deny permission and confirm the in-app card
        still appears and nothing looks broken.
        16d.[ ] Turn "Show Remi" off on its tour page — the outfit/wander page
        disappears and the step counter shrinks to match, with the
        progress bar still reaching the end. Turning it back on restores
        the page.
17. [ ] Tag a task, then filter the work record by that tag (Data →
        Export a work record) — confirm the daily totals shown match the
        tasks listed, not the untagged day total.
18. [ ] Export a work record with interruptions on and off; confirm it
        opens in the browser and Print → Save as PDF produces a file.
19. [ ] Search in Calendar finds a task completed on an earlier day by
        title, and by tag.
20. [ ] Wrap up the day WITHOUT choosing per task — confirm nothing is
        lost and everything carries. Then reopen the day and confirm it
        comes back as it was, with banked time unchanged.
21. [ ] Wrap up again choosing per task (one to tomorrow, one to the
        backlog), reopen, and confirm the tomorrow task is marked as such
        while the backlogged one stays in the backlog.
22. [ ] The mascot runs while a task is timed, sleeps on the break screen,
        and cheers once when today's list is clear. Switching it off in
        Settings → Appearance removes it everywhere without leaving a gap
        in any layout.
23. [ ] With macOS "Reduce motion" on (System Settings → Accessibility →
        Display), the mascot holds a still pose rather than animating.
24. [ ] Clicking a past day on the Calendar opens it BELOW the grid —
        completed and unfinished tasks, times, tags and interruptions —
        and the selected cell is outlined. Paging months closes it.
25. [ ] With more than a dozen distinct tags, the Calendar and report
        filters show ten chips plus a "+N more", and a search box finds
        one by name. A tag you have already selected stays visible even
        when it would otherwise be collapsed away.
26. [ ] Before starting the day, every tab is still clickable and answers
        with the Start-my-day screen; Settings opens normally. "Restart
        day…" is absent from Settings until the day has begun — it would
        otherwise start the day and discard the carried tasks.
27. [ ] The popover's ⏻ button asks before quitting, and names the running
        task if one is on the clock.
28. [ ] Settings → Danger zone offers TWO separate actions. "Factory
        reset" erases everything and Remi STAYS OPEN, coming back at day 1
        with the tour on the next dashboard open. Confirm `~/Remi` holds a
        fresh `state.json` afterwards and that later edits still save —
        a reset that left saves latched off would look fine and persist
        nothing. "Uninstall" still quits.
29. [ ] Spend a revive on a streak broken within the last week: the button
        names how many days come back, the calendar keeps showing the
        missed day as missed, and the streak reads old + new from there.
        It is refused once two days of a new streak have been worked.
30. [ ] Verify the built macOS `.app`'s `Info.plist` contains
        `LSUIElement = true`:
        `bash
/usr/libexec/PlistBuddy -c "Print :LSUIElement" \
  "/path/to/Remi.app/Contents/Info.plist"
`

Record which of these were completed and which couldn't be (e.g. running
in a headless CI environment) alongside any automated verification
results.
