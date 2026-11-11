#!/usr/bin/env python3
"""Decide the version of the release that a push to main produces.

  next_version.py CURRENT [TAG ...]   print the version to release, or nothing to skip

CURRENT is the version written in the repository files. Every push to main that changes
the app releases it; when CURRENT is already tagged, the pre-release counter moves up so the
tag is always new and always higher than any existing tag of the same line:

  files 0.1.0-alpha.2, tags v0.1.0-alpha.2 v0.1.0-alpha.3  ->  0.1.0-alpha.4
  files 0.1.0-alpha.2, no tag                              ->  0.1.0-alpha.2
  files 0.1.0 (stable), v0.1.0 already tagged              ->  (nothing: bump the version)
"""

import sys
from dataclasses import replace

from semver import Version, is_release_tag, parse, parse_tag


def next_version(current: Version, tags: list[str]) -> Version | None:
    existing = [parse_tag(tag) for tag in tags if is_release_tag(tag)]
    same_core = [v for v in existing if _core(v) == _core(current)]
    if current.channel is None:
        # A stable version is released once. Re-releasing it would move a published number.
        return None if any(v.channel is None for v in same_core) else current

    if any(v.channel is None for v in same_core):
        # The stable release of this line is out; a pre-release of it would sort below it.
        return None
    same_line = [v for v in same_core if v.channel == current.channel]
    highest = max((v.number for v in same_line), default=None)
    number = current.number if highest is None else max(current.number, highest + 1)
    return replace(current, number=number)


def _core(version: Version) -> tuple[int, int, int]:
    return (version.major, version.minor, version.patch)


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__, file=sys.stderr)
        return 2
    result = next_version(parse(argv[0]), argv[1:])
    if result is not None:
        print(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
