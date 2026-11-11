#!/usr/bin/env python3
"""Decide which release tags to delete so that only the newest ``--keep`` remain.

Reads tag names (one per line) on stdin and prints the tags to delete, oldest first.
It never deletes anything itself.

Only tags shaped like ``vX.Y.Z`` or ``vX.Y.Z-(alpha|beta|rc).N`` take part; every other
tag is ignored and therefore can never be selected. Order is Semantic Versioning
precedence, not creation date, so a late hotfix on an old line cannot evict a newer one.

Exit codes:
  0  success (the plan may be empty)
  2  invalid usage, or ``--must-keep`` is not among the tags
  3  ``--must-keep`` would NOT survive: nothing is selected for deletion
"""

import argparse
import sys
from collections.abc import Iterable

from semver import is_release_tag, parse_tag

EXIT_BAD_USAGE = 2
EXIT_MUST_KEEP_EVICTED = 3


def plan(tags: Iterable[str], keep: int) -> tuple[list[str], list[str]]:
    """Return ``(kept, to_delete)``, both ordered newest first."""
    if keep < 1:
        raise ValueError("keep must be at least 1")
    releases = sorted(
        {tag for tag in tags if is_release_tag(tag)},
        key=lambda tag: parse_tag(tag).sort_key(),
        reverse=True,
    )
    return releases[:keep], releases[keep:]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--keep", type=int, default=3, help="how many releases to keep")
    parser.add_argument(
        "--must-keep",
        metavar="TAG",
        help="abort (exit 3) unless this tag is among the ones kept; use the tag just released",
    )
    args = parser.parse_args(argv)

    all_tags = [line.strip() for line in sys.stdin if line.strip()]
    ignored = sorted({tag for tag in all_tags if not is_release_tag(tag)})
    if ignored:
        print(f"ignoring non-release tags: {', '.join(ignored)}", file=sys.stderr)

    try:
        kept, to_delete = plan(all_tags, args.keep)
    except ValueError as error:
        print(f"error: {error}", file=sys.stderr)
        return EXIT_BAD_USAGE

    if args.must_keep is not None:
        if args.must_keep not in all_tags:
            print(f"error: {args.must_keep} is not among the tags", file=sys.stderr)
            return EXIT_BAD_USAGE
        if args.must_keep not in kept:
            print(
                f"{args.must_keep} is older than the {args.keep} newest releases "
                f"({', '.join(kept)}); refusing to prune",
                file=sys.stderr,
            )
            return EXIT_MUST_KEEP_EVICTED

    print(f"keeping: {', '.join(kept) or '(none)'}", file=sys.stderr)
    for tag in reversed(to_delete):
        print(tag)
    return 0


if __name__ == "__main__":
    sys.exit(main())
