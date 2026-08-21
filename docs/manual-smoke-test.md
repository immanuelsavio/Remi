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
16. [ ] The guided tour runs by itself on a genuinely fresh install,
        and does **not** run again on the next launch. Settings → Help →
        "Start the tour" brings it back. Each step switches to the tab it
        describes, and the app is still clickable while it is open.
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
24. [ ] Verify the built macOS `.app`'s `Info.plist` contains
        `LSUIElement = true`:
        `bash
/usr/libexec/PlistBuddy -c "Print :LSUIElement" \
  "/path/to/Remi.app/Contents/Info.plist"
`

Record which of these were completed and which couldn't be (e.g. running
in a headless CI environment) alongside any automated verification
results.
