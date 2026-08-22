# Privacy

Remi is a local application. It has no server, no account system, and no
analytics service behind it.

## What leaves your machine

Nothing about your work, ever. There is no sign-in, no sync, no crash
reporter, and nothing that describes your tasks, notes or time leaves this
machine.

Three things touch the network. None of them carries anything about you, and
two of the three can be switched off or avoided entirely:

- **The installer and uninstaller** (`install.sh` / `uninstall.sh`) download a
  release from GitHub. They are separate shell scripts you run from a
  terminal, not part of the app.
- **Update checks.** Remi asks GitHub's public releases API whether a newer
  version exists — a single request that sends no identifier beyond a
  `remi-updater` user agent, and no information about you or your work. It
  runs at startup unless you turn that off in Settings, and whenever you
  press _Check for updates_. Installing an update is always a button you
  press.
- **Web fonts.** The interface asks for the Fraunces and IBM Plex families
  from Google Fonts the first time a window opens, then the system caches
  them. This one is automatic and has no switch: Google sees a request for a
  stylesheet, which means it sees your IP address and roughly when you
  opened the app — nothing about your tasks, and nothing that identifies you
  to Remi. If the request fails, or you are offline, Remi falls back to
  system fonts and works normally.

## What Remi stores, and where

| What                                               | Where                                                                |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| Tasks, steps, notes, backlog, history, streaks     | `~/Remi/state.json`                                                  |
| Last-known-good copy                               | `~/Remi/state.json.bak`                                              |
| Files Remi could not parse, preserved for recovery | `~/Remi/recovery-<timestamp>/`                                       |
| Backups and exports you create                     | `~/Remi/`                                                            |
| Settings                                           | `~/Library/Application Support/com.immanuelsavio.remi/settings.json` |

These are plain JSON files. You can read them, back them up, move them
between machines, or delete them. Deleting `~/Remi` deletes your data;
nothing is retained anywhere else.

## Usage logging

Remi records anonymous usage counters. During the beta this is **on by
default**, and it is a one-click switch in **Data → Usage logs**. Turning it
off stops collection immediately — not just the export.

If you had an earlier build with logging off, it stays off. Only a fresh
install starts with it on.

When it is on, Remi counts:

- which buttons and screens were used, and how often
- feature counts (tasks started, interruptions recorded, imports run)
- friction signals (for example, how often an action is undone)
- error messages raised inside the app

When it is on, Remi **never** records:

- task titles, step titles, or notes
- backlog text
- reminder text
- file paths, or any other free text you typed

The counters stay in `state.json` with everything else. **Nothing is
transmitted.** They are only ever shared if you export them and hand the
file over yourself.

## The feedback note

**Data → Something wrong? Tell us** is a free-text box, and it is the one
part of an export that deliberately contains your own words rather than
counts. It is saved locally with everything else and travels with the log
export so a bug report arrives with the evidence attached.

The exported file says so about itself: its `containsNoContent` flag flips
to `false` whenever a note is present, so nobody reading it has to guess
whether it holds prose. Clear the box and the flag goes back to `true`.

## Notifications

Remi can post native notifications for reminders and for the end of a break.
By default these include the task name.

If you share your screen — or present, or record — turn on **Private
notifications** in Settings. Banners then say "A task reminder is due"
instead of naming the task, and the detail stays inside the app where only
you are looking.

## Removing everything

```bash
bash uninstall.sh --purge --yes
```

That deletes the app, the settings file and the entire data folder. It is not
reversible. A plain `bash uninstall.sh` removes only the app and leaves your
data in place.
