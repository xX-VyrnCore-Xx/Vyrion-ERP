#!/usr/bin/env python3
"""Writes latest.json, the manifest the in-app updater reads from the latest GitHub release.

For every platform whose signed package is in the folder (the package and its `.sig` file,
both produced by the build when the signing key is configured) the manifest lists the download
URL and the signature. With no signed package nothing is written and the release simply has no
in-app update (people install the new version by hand).

    make_latest_json.py --dir assets --version 0.1.5 --tag v0.1.5 --repo OWNER/REPO --notes "..."
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

# platform key used by the updater -> package file name with {v} for the version
PLATFORMS = {
    "windows-x86_64": "Vyrion-ERP_{v}_Windows-x64-Setup.exe",
    "darwin-aarch64": "Vyrion-ERP_{v}_macOS-AppleSilicon.app.tar.gz",
}


def build_manifest(
    folder: Path, version: str, tag: str, repo: str, notes: str, now: datetime | None = None
) -> dict | None:
    platforms: dict[str, dict[str, str]] = {}
    for key, pattern in PLATFORMS.items():
        name = pattern.format(v=version)
        package, signature = folder / name, folder / f"{name}.sig"
        if package.is_file() and signature.is_file():
            platforms[key] = {
                "signature": signature.read_text(encoding="utf-8").strip(),
                "url": f"https://github.com/{repo}/releases/download/{tag}/{quote(name)}",
            }
    if not platforms:
        return None
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        "version": version,
        "notes": notes.strip(),
        "pub_date": stamp,
        "platforms": platforms,
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", required=True, type=Path)
    parser.add_argument("--version", required=True)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--notes", default="")
    args = parser.parse_args(argv)
    manifest = build_manifest(args.dir, args.version, args.tag, args.repo, args.notes)
    if manifest is None:
        print("::notice::no signed update package: latest.json not written")
        return 0
    (args.dir / "latest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"latest.json written for {', '.join(manifest['platforms'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
