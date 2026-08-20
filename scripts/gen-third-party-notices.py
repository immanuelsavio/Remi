#!/usr/bin/env python3
"""Regenerate THIRD-PARTY-NOTICES.md from the two dependency lock files.

Remi ships compiled Rust and a bundled JS/CSS payload, both of which embed
third-party code. Nearly all of it is MIT or Apache-2.0, and both of those
licences require the copyright notice and licence text to travel with any
distribution - so this file is a compliance artifact, not a courtesy.

Run it after changing dependencies:

    cargo fetch --manifest-path src-tauri/Cargo.toml   # populate the cache
    python3 scripts/gen-third-party-notices.py

Reads only local files: `Cargo.lock` plus the crate sources in the cargo
registry cache, and `package-lock.json` plus `node_modules`. No network.
"""

from __future__ import annotations

import collections
import glob
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "THIRD-PARTY-NOTICES.md"

# ---------------------------------------------------------------- cargo


def cargo_packages() -> list[tuple[str, str, str]]:
    """(name, version, licence) for every crate in Cargo.lock."""
    lock = (ROOT / "src-tauri" / "Cargo.lock").read_text()
    registry_roots = glob.glob(str(pathlib.Path.home() / ".cargo/registry/src/*/"))
    out: list[tuple[str, str, str]] = []

    for block in lock.split("[[package]]")[1:]:
        name = re.search(r'^name = "([^"]+)"', block, re.M)
        version = re.search(r'^version = "([^"]+)"', block, re.M)
        if not (name and version):
            continue
        name, version = name.group(1), version.group(1)
        # The workspace crate itself is not a third party.
        if name == "remi":
            continue

        licence = ""
        for registry in registry_roots:
            manifest = pathlib.Path(registry) / f"{name}-{version}" / "Cargo.toml"
            if not manifest.exists():
                continue
            text = manifest.read_text(errors="ignore")
            m = re.search(r'^license\s*=\s*"([^"]+)"', text, re.M)
            if m:
                licence = m.group(1)
            else:
                m = re.search(r'^license-file\s*=\s*"([^"]+)"', text, re.M)
                licence = f"see {m.group(1)} in the crate" if m else ""
            break
        out.append((name, version, licence or "UNKNOWN"))

    return sorted(out, key=lambda r: r[0].lower())


# ------------------------------------------------------------------ npm


def npm_packages() -> list[tuple[str, str, str]]:
    """(name, version, licence) for every npm package in package-lock.json.

    Includes dev dependencies: the build toolchain does not ship, but Svelte
    is a devDependency whose runtime IS compiled into the bundle, so the
    dev/prod split is not a reliable proxy for "does this reach the user".
    Over-attributing is harmless; under-attributing is a licence breach.
    """
    lock = json.loads((ROOT / "package-lock.json").read_text())
    out: list[tuple[str, str, str]] = []
    seen: set[tuple[str, str]] = set()

    for path, meta in (lock.get("packages") or {}).items():
        if not path:  # the root project itself
            continue
        name = meta.get("name") or path.split("node_modules/")[-1]
        version = meta.get("version", "")
        if (name, version) in seen:
            continue
        seen.add((name, version))

        licence = meta.get("license") or ""
        if not licence:
            pkg = ROOT / path / "package.json"
            if pkg.exists():
                try:
                    data = json.loads(pkg.read_text())
                    lic = data.get("license") or data.get("licenses")
                    if isinstance(lic, list):
                        licence = " OR ".join(
                            x.get("type", "") for x in lic if isinstance(x, dict)
                        )
                    elif isinstance(lic, dict):
                        licence = lic.get("type", "")
                    else:
                        licence = lic or ""
                except (json.JSONDecodeError, OSError):
                    pass
        out.append((name, version, licence or "UNKNOWN"))

    return sorted(out, key=lambda r: r[0].lower())


# ---------------------------------------------------------------- render


def table(rows: list[tuple[str, str, str]]) -> str:
    lines = ["| Package | Version | License |", "| --- | --- | --- |"]
    lines += [f"| `{n}` | {v} | {lic} |" for n, v, lic in rows]
    return "\n".join(lines)


def summary(rows: list[tuple[str, str, str]]) -> str:
    counts = collections.Counter(lic for _, _, lic in rows)
    return "\n".join(f"- {lic} — {n}" for lic, n in counts.most_common())


def main() -> int:
    cargo = cargo_packages()
    npm = npm_packages()
    unknown = [r for r in cargo + npm if r[2] == "UNKNOWN"]

    OUT.write_text(
        f"""# Third-party notices

Remi bundles third-party open-source software. Most of it is MIT or
Apache-2.0 licensed, and both require that the copyright notice and licence
text accompany any distribution — so this file ships with the app.

Each package remains under its own licence, held by its own authors. Nothing
here is covered by Remi's own [LICENSE](LICENSE); a restriction in Remi's
licence does not apply to these components, and their permissions do not
extend to Remi.

Full licence texts live with each package: Rust crates under
`~/.cargo/registry/src/`, npm packages under `node_modules/`. Canonical
copies are on [crates.io](https://crates.io) and
[npmjs.com](https://www.npmjs.com).

> Generated by `scripts/gen-third-party-notices.py`. Do not edit by hand —
> regenerate it after changing dependencies.

## Summary

**Rust crates ({len(cargo)})**

{summary(cargo)}

**npm packages ({len(npm)})**

{summary(npm)}

## Rust crates

`Cargo.lock` resolves dependencies for every supported target, so this list
includes crates that are only linked on Linux, Windows or Android and are
absent from a macOS build. Listing them costs nothing; omitting one that
does ship would be a licence breach.

{table(cargo)}

## npm packages

{table(npm)}
""",
        encoding="utf-8",
    )

    print(f"wrote {OUT.relative_to(ROOT)}")
    print(f"  {len(cargo)} rust crates, {len(npm)} npm packages")
    if unknown:
        print(f"  WARNING: {len(unknown)} package(s) with no detectable licence:")
        for n, v, _ in unknown[:20]:
            print(f"    {n} {v}")
        print("  Run `cargo fetch --manifest-path src-tauri/Cargo.toml` and retry.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
