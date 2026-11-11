"""Semantic Versioning parsing and precedence (https://semver.org, rule 11).

Only the release channels used by Vyrion ERP are accepted:
``X.Y.Z`` (stable) and ``X.Y.Z-(alpha|beta|rc).N``.
"""

import re
from dataclasses import dataclass

_PATTERN = re.compile(
    r"^(?P<major>0|[1-9][0-9]*)\.(?P<minor>0|[1-9][0-9]*)\.(?P<patch>0|[1-9][0-9]*)"
    r"(?:-(?P<channel>alpha|beta|rc)\.(?P<number>0|[1-9][0-9]*))?$"
)

_PEP440_CHANNEL = {"alpha": "a", "beta": "b", "rc": "rc"}
_PEP440_PATTERN = re.compile(
    r"^(?P<core>[0-9]+\.[0-9]+\.[0-9]+)(?:(?P<channel>a|b|rc)(?P<number>[0-9]+))?$"
)
_FROM_PEP440_CHANNEL = {"a": "alpha", "b": "beta", "rc": "rc"}


@dataclass(frozen=True, slots=True)
class Version:
    major: int
    minor: int
    patch: int
    channel: str | None = None  # "alpha" | "beta" | "rc" | None for stable
    number: int = 0

    @property
    def is_prerelease(self) -> bool:
        return self.channel is not None

    def sort_key(self) -> tuple[int, int, int, int, str, int]:
        """Ascending order: alpha < beta < rc < stable, then by number.

        Within a pre-release the identifiers compare as SemVer rule 11 requires: the
        channel names compare lexically (alpha < beta < rc) and the number numerically.
        """
        stable = 1 if self.channel is None else 0
        return (self.major, self.minor, self.patch, stable, self.channel or "", self.number)

    def __str__(self) -> str:
        core = f"{self.major}.{self.minor}.{self.patch}"
        return core if self.channel is None else f"{core}-{self.channel}.{self.number}"

    def to_pep440(self) -> str:
        core = f"{self.major}.{self.minor}.{self.patch}"
        if self.channel is None:
            return core
        return f"{core}{_PEP440_CHANNEL[self.channel]}{self.number}"


def parse(text: str) -> Version:
    match = _PATTERN.fullmatch(text)
    if match is None:
        raise ValueError(f"not a valid Vyrion version: {text!r}")
    channel = match["channel"]
    return Version(
        int(match["major"]),
        int(match["minor"]),
        int(match["patch"]),
        channel,
        int(match["number"]) if channel else 0,
    )


def parse_tag(tag: str) -> Version:
    """``v1.2.3`` or ``v1.2.3-rc.1``. The leading ``v`` is mandatory."""
    if not tag.startswith("v"):
        raise ValueError(f"not a release tag: {tag!r}")
    return parse(tag[1:])


def is_release_tag(tag: str) -> bool:
    try:
        parse_tag(tag)
    except ValueError:
        return False
    return True


def from_pep440(text: str) -> Version:
    """Inverse of ``Version.to_pep440`` (the form ``uv`` writes in its lockfile)."""
    match = _PEP440_PATTERN.fullmatch(text)
    if match is None:
        raise ValueError(f"not a PEP 440 version produced by Vyrion tooling: {text!r}")
    channel = match["channel"]
    core = parse(match["core"])
    if channel is None:
        return core
    return Version(
        core.major, core.minor, core.patch, _FROM_PEP440_CHANNEL[channel], int(match["number"])
    )
