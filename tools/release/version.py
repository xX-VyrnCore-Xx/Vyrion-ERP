#!/usr/bin/env python3
"""Keep the product version identical everywhere and tie it to the release tag.

  version.py get                  print the version
  version.py check [--tag vX.Y.Z] fail unless every file carries the same version
                                  (and, with --tag, unless it equals the tag)
  version.py set X.Y.Z[-pre.N]    write the version into every file
  version.py notes X.Y.Z[-pre.N]  print that version's CHANGELOG section

The version lives in seven places. ``cargo build --locked`` rejects a Cargo.lock that
disagrees with Cargo.toml, so both lockfiles are part of the set.
"""

import argparse
import json
import re
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from semver import Version, from_pep440, parse, parse_tag

ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Location:
    path: str
    pattern: re.Pattern[str]  # group 1 = text before the version, group 2 = the version
    pep440: bool = False  # the file stores the Python-normalised form


def _line(prefix: str) -> re.Pattern[str]:
    return re.compile(rf"(?m)^({prefix})([^\"\n]+)(?=\")")


def _locked_package(name: str) -> re.Pattern[str]:
    return re.compile(rf'(?m)(^name = "{re.escape(name)}"\nversion = ")([^"\n]+)(?=")')


LOCATIONS: tuple[Location, ...] = (
    Location("apps/desktop/package.json", re.compile(r'(?m)^(  "version": ")([^"\n]+)(?=")')),
    Location("apps/desktop/src-tauri/tauri.conf.json", re.compile(r'(?m)^(  "version": ")([^"\n]+)(?=")')),
    Location("apps/desktop/src-tauri/Cargo.toml", _line('version = "')),
    Location("apps/desktop/src-tauri/Cargo.lock", _locked_package("vyrion-desktop")),
    Location("backend/pyproject.toml", _line('version = "')),
    Location("backend/app/__init__.py", _line('__version__ = "')),
    Location("backend/uv.lock", _locked_package("vyrion-backend"), pep440=True),
)


def _read(root: Path, location: Location) -> Version:
    text = (root / location.path).read_text(encoding="utf-8")
    match = location.pattern.search(text)
    if match is None:
        raise ValueError(f"{location.path}: version not found")
    raw = match.group(2)
    try:
        if location.pep440 or location.path.endswith("pyproject.toml"):
            # pyproject may hold either spelling; both name the same version.
            try:
                return parse(raw)
            except ValueError:
                return from_pep440(raw)
        return parse(raw)
    except ValueError as error:
        raise ValueError(f"{location.path}: {error}") from error


def read_all(root: Path = ROOT) -> dict[str, Version]:
    return {location.path: _read(root, location) for location in LOCATIONS}


def check(root: Path = ROOT, tag: str | None = None) -> list[str]:
    """Return human-readable problems; empty means everything agrees."""
    problems: list[str] = []
    versions: dict[str, Version] = {}
    for location in LOCATIONS:
        try:
            versions[location.path] = _read(root, location)
        except (ValueError, OSError) as error:
            problems.append(str(error))
    if len(set(versions.values())) > 1:
        width = max(len(path) for path in versions)
        problems.append("versions differ:")
        problems.extend(f"  {path.ljust(width)}  {version}" for path, version in versions.items())
    if tag is not None:
        try:
            expected = parse_tag(tag)
        except ValueError as error:
            problems.append(str(error))
        else:
            for path, version in versions.items():
                if version != expected:
                    problems.append(f"{path} is {version}, the tag says {expected}")
    return problems


def set_version(root: Path, version: Version) -> None:
    for location in LOCATIONS:
        file = root / location.path
        text = file.read_text(encoding="utf-8")
        value = version.to_pep440() if location.pep440 else str(version)
        updated, count = location.pattern.subn(lambda m, v=value: m.group(1) + v, text, count=1)
        if count != 1:
            raise ValueError(f"{location.path}: version not found")
        file.write_text(updated, encoding="utf-8")
    # JSON files must stay valid after a textual edit.
    for location in LOCATIONS:
        if location.path.endswith(".json"):
            json.loads((root / location.path).read_text(encoding="utf-8"))


def changelog_section(changelog: str, version: Version) -> str:
    """Body of ``## [version]`` up to the next ``## `` heading; empty when absent."""
    heading = re.compile(rf"(?m)^## \[{re.escape(str(version))}\][^\n]*\n")
    start = heading.search(changelog)
    if start is None:
        return ""
    rest = changelog[start.end() :]
    following = re.search(r"(?m)^## ", rest)
    body = rest[: following.start()] if following else rest
    # Drop the link-reference definitions that Keep a Changelog puts at the very end.
    body = re.sub(r"(?m)^\[[^\]]+\]: \S+\s*$", "", body)
    return body.strip()


def _cmd_get(_: argparse.Namespace) -> int:
    print(next(iter(read_all().values())))
    return 0


def _cmd_check(args: argparse.Namespace) -> int:
    problems = check(ROOT, args.tag)
    if problems:
        print("\n".join(problems), file=sys.stderr)
        return 1
    print(f"OK: {next(iter(read_all().values()))}")
    return 0


def _cmd_set(args: argparse.Namespace) -> int:
    version = parse(args.version)
    set_version(ROOT, version)
    print(f"Version set to {version}")
    return 0


def _cmd_notes(args: argparse.Namespace) -> int:
    version = parse(args.version)
    print(changelog_section((ROOT / "CHANGELOG.md").read_text(encoding="utf-8"), version))
    return 0


COMMANDS: dict[str, Callable[[argparse.Namespace], int]] = {
    "get": _cmd_get,
    "check": _cmd_check,
    "set": _cmd_set,
    "notes": _cmd_notes,
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("get")
    check_parser = commands.add_parser("check")
    check_parser.add_argument("--tag", help="release tag the files must match, e.g. v0.2.0")
    commands.add_parser("set").add_argument("version")
    commands.add_parser("notes").add_argument("version")
    args = parser.parse_args(argv)
    try:
        return COMMANDS[args.command](args)
    except ValueError as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
