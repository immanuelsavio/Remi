## What this changes

<!-- One or two sentences. What behaviour is different after this? -->

## Why

<!-- The problem being solved. Link the issue if there is one. -->

## How it was verified

<!-- Delete what does not apply. -->

- [ ] `npm run verify` is green
- [ ] Added or updated tests covering the change
- [ ] `bash tests/scripts/test-install.sh` / `test-uninstall.sh` (if the scripts changed)
- [ ] Checked by hand in the real app — see [docs/manual-smoke-test.md](../docs/manual-smoke-test.md)

## Invariants

<!-- CLAUDE.md lists the things this codebase does not bend on. -->

- [ ] I read [CLAUDE.md](../CLAUDE.md)
- [ ] This does not touch `sessionTx`, time accounting, day rollover, or `state_io.rs`
- [ ] …or it does, and I read the matching doc in `docs/` and can explain why it is still correct

## Anything reviewers should look at closely

<!-- Optional: a tradeoff you made, something you were unsure about. -->
