#!/usr/bin/env python3
"""Decide the version of the release that a push to main produces. Releases are final.

  next_version.py CURRENT [TAG ...]   print the version to release

CURRENT is the version written in the repository files. Automatic releases are always
**stable** (``X.Y.Z``, a normal GitHub release marked "latest"): a pre-release suffix in the
files is ignored. The patch number moves up by itself so every release has a new tag that is
higher than any existing one of the same X.Y line:

  files 0.1.0, no stable tag of 0.1.x            ->  0.1.0
  files 0.1.0, tags v0.1.0 v0.1.1                ->  0.1.2
  files 0.2.0, tags v0.1.5                       ->  0.2.0   (a new line starts at the file's number)
  files 0.1.0-alpha.2, no stable tag of 0.1.x    ->  0.1.0   (the suffix is dropped)

Pre-release tags (``-alpha.N`` ...) never count: they sort below the stable version anyway.
"""

import sys

from semver import Version, is_release_tag, parse, parse_tag


def next_version(current: Version, tags: list[str]) -> Version:
    stable = [parse_tag(tag) for tag in tags if is_release_tag(tag)]
    same_line = [
        v
        for v in stable
        if v.channel is None and (v.major, v.minor) == (current.major, current.minor)
    ]
    highest = max((v.patch for v in same_line), default=None)
    patch = current.patch if highest is None else max(current.patch, highest + 1)
    return Version(current.major, current.minor, patch)


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__, file=sys.stderr)
        return 2
    print(next_version(parse(argv[0]), argv[1:]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
