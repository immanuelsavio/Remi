# Contributing to Remi

Thanks for taking a look. Issues and pull requests are both welcome.

## Before you start

Please **read [CLAUDE.md](CLAUDE.md)**. It is short, and it lists the
invariants this codebase does not bend on — session transactions, time
accounting, day-rollover idempotence, the persistence recovery contract,
single effect ownership, and the module boundaries. Every one of them is
there because breaking it lost, duplicated, or misattributed real user data
at some point.

If you are touching timing, the day lifecycle, or `state_io.rs`, also read
the matching document in [`docs/`](docs/) first.

## Setting up

```bash
npm install
npm run app        # the real menu-bar app, in dev mode
```

You need Node 20+, Rust stable with `rustfmt` and `clippy`, and Xcode
Command Line Tools on macOS.

## The gate

```bash
npm run verify
```

That runs the frontend tests, the type check, the formatter check, the
production build, `cargo test`, `cargo fmt --check` and
`cargo clippy -D warnings`. If it is green, CI will be too.

If you changed `install.sh` or `uninstall.sh`, also run:

```bash
bash tests/scripts/test-install.sh
bash tests/scripts/test-uninstall.sh
```

These are real tests — no mocks. They stand up a local HTTP server, build a
genuine `.app` bundle with a compiled binary, and run the actual scripts
against a throwaway `$HOME`. They never touch your real installation or
your real `~/Remi`.

## How to make a change

1. **Write the failing test first.** Domain logic lives in `src/domain/`
   and is pure — every time-dependent function takes `now` as an explicit
   parameter, which is what makes the tests deterministic without fake
   timers. If a change is hard to test, that usually means the boundary is
   in the wrong place.
2. **Keep the module graph a star, not a cycle.** Components import actions
   from `src/store` and read-only helpers from `src/view.ts`, never from a
   store internal. Store action modules import `state.ts` and not each
   other.
3. **Match the surrounding code.** Comment density, naming and idiom vary
   by file; follow the file you are in. Comments here explain _why_, not
   _what_ — particularly where a naive implementation would be wrong.
4. **One concern per pull request.** A behaviour change and a refactor in
   the same diff are hard to review and harder to revert.

## Commit messages

Plain imperative summaries are fine: `fix popover level clobbered by async
set_level`. Explain the _why_ in the body when the change is not obvious.

## Reporting bugs

Use the bug report template. The single most useful thing you can include
is what you expected to happen versus what did. If it involves timing or
lost time, please say what you did, in order, and roughly when — that class
of bug is almost always about ordering.

Please do not paste your `state.json` into a public issue; it contains your
task titles and notes. Describe the shape of the problem instead, or strip
it first.

## Security

Do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).

## Licensing of contributions

Remi is released under the
[PolyForm Noncommercial License 1.0.0](LICENSE). By opening a pull request
you agree that your contribution is licensed on those same terms, and that
you have the right to license it.

That licence permits non-commercial use only. If you are contributing on
behalf of an employer, please check that this is acceptable to them first.

## Code of conduct

Participation is covered by the [Code of Conduct](CODE_OF_CONDUCT.md).
