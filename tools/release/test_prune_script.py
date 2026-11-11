"""End-to-end test of prune.sh against a real git remote and a fake ``gh``.

Nothing here touches GitHub: the fake ``gh`` records its calls in a log and pretends that
a chosen set of tags has a release.
"""

import os
import shutil
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "prune.sh"

FAKE_GH = """#!/usr/bin/env bash
# usage: gh release view TAG | gh release delete TAG --cleanup-tag --yes
echo "gh $*" >> "$GH_LOG"
[ "$1" = "release" ] || exit 64
tag="$3"
case "$2" in
  view)
    if [ -n "${GH_FAIL_VIEW:-}" ]; then echo "HTTP 502: Bad Gateway" >&2; exit 1; fi
    if grep -qx "$tag" "$GH_RELEASES"; then echo "title: $tag"; exit 0; fi
    echo "release not found" >&2; exit 1 ;;
  delete)
    grep -qx "$tag" "$GH_RELEASES" || { echo "release not found" >&2; exit 1; }
    git push --quiet origin --delete "refs/tags/$tag" ;;
  *) exit 64 ;;
esac
"""


def git(cwd: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=cwd, check=True, capture_output=True, text=True,
        env={**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid",
             "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.invalid"},
    )
    return result.stdout


@unittest.skipUnless(shutil.which("git") and shutil.which("bash"), "needs git and bash")
class PruneScriptTests(unittest.TestCase):
    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        base = Path(self._dir.name)
        self.origin = base / "origin.git"
        self.clone = base / "clone"
        self.bin = base / "bin"
        self.log = base / "gh.log"
        self.releases = base / "releases.txt"
        self.bin.mkdir()
        self.log.write_text("")

        git(base, "init", "--quiet", "--bare", str(self.origin))
        git(base, "clone", "--quiet", str(self.origin), str(self.clone))
        (self.clone / "f").write_text("x")
        git(self.clone, "add", "f")
        git(self.clone, "commit", "--quiet", "-m", "init")

        gh = self.bin / "gh"
        gh.write_text(FAKE_GH)
        gh.chmod(gh.stat().st_mode | stat.S_IEXEC)

    def make_tags(self, tags: list[str], *, with_release: list[str] | None = None) -> None:
        for tag in tags:
            git(self.clone, "tag", tag)
        git(self.clone, "push", "--quiet", "origin", "--tags")
        releases = tags if with_release is None else with_release
        self.releases.write_text("".join(f"{tag}\n" for tag in releases))

    def run_script(self, **env: str) -> subprocess.CompletedProcess[str]:
        full_env = {
            **os.environ,
            "PATH": f"{self.bin}{os.pathsep}{os.environ['PATH']}",
            "GH_LOG": str(self.log),
            "GH_RELEASES": str(self.releases),
            **env,
        }
        return subprocess.run(
            ["bash", str(SCRIPT)], cwd=self.clone, env=full_env, capture_output=True, text=True,
        )

    def remote_tags(self) -> list[str]:
        return sorted(git(self.origin, "tag", "--list").split())

    TAGS = ["v0.1.0-alpha.1", "v0.1.0-alpha.2", "v0.1.0", "v0.2.0", "v0.3.0-rc.1", "v0.3.0"]

    def test_keeps_the_three_newest_and_deletes_the_rest(self) -> None:
        self.make_tags(self.TAGS)
        result = self.run_script(DRY_RUN="false", KEEP="3", CURRENT_TAG="v0.3.0")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.remote_tags(), ["v0.2.0", "v0.3.0", "v0.3.0-rc.1"])
        deleted = [line for line in self.log.read_text().splitlines() if " delete " in line]
        self.assertEqual(
            deleted,
            [f"gh release delete {tag} --cleanup-tag --yes"
             for tag in ["v0.1.0-alpha.1", "v0.1.0-alpha.2", "v0.1.0"]],
        )

    def test_dry_run_changes_nothing(self) -> None:
        self.make_tags(self.TAGS)
        result = self.run_script(DRY_RUN="true", KEEP="3", CURRENT_TAG="v0.3.0")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.remote_tags(), sorted(self.TAGS))
        self.assertEqual(self.log.read_text(), "")
        self.assertIn("[dry-run] would delete release and tag v0.1.0-alpha.1", result.stdout)

    def test_three_tags_or_fewer_are_left_alone(self) -> None:
        self.make_tags(["v0.1.0", "v0.2.0", "v0.3.0"])
        result = self.run_script(DRY_RUN="false", KEEP="3", CURRENT_TAG="v0.3.0")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(self.remote_tags()), 3)
        self.assertIn("Nothing to prune", result.stdout)

    def test_tag_without_a_release_is_deleted_as_a_plain_tag(self) -> None:
        self.make_tags(self.TAGS, with_release=["v0.2.0", "v0.3.0", "v0.3.0-rc.1"])
        result = self.run_script(DRY_RUN="false", KEEP="3", CURRENT_TAG="v0.3.0")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.remote_tags(), ["v0.2.0", "v0.3.0", "v0.3.0-rc.1"])
        self.assertIn("No release for v0.1.0: deleting the tag only", result.stdout)

    def test_an_old_tag_being_released_deletes_nothing(self) -> None:
        self.make_tags(self.TAGS + ["v0.0.9"])
        result = self.run_script(DRY_RUN="false", KEEP="3", CURRENT_TAG="v0.0.9")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.remote_tags(), sorted(self.TAGS + ["v0.0.9"]))
        self.assertIn("pruning skipped", result.stdout)

    def test_foreign_tags_survive(self) -> None:
        self.make_tags(self.TAGS + ["latest", "backup-2026"])
        result = self.run_script(DRY_RUN="false", KEEP="3", CURRENT_TAG="v0.3.0")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            self.remote_tags(),
            ["backup-2026", "latest", "v0.2.0", "v0.3.0", "v0.3.0-rc.1"],
        )

    def test_an_unexpected_gh_failure_aborts_without_deleting(self) -> None:
        self.make_tags(self.TAGS)
        result = self.run_script(DRY_RUN="false", KEEP="3", CURRENT_TAG="v0.3.0", GH_FAIL_VIEW="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.remote_tags(), sorted(self.TAGS))
        self.assertIn("cannot inspect release", result.stdout)

    def test_keep_can_be_changed(self) -> None:
        self.make_tags(self.TAGS)
        result = self.run_script(DRY_RUN="false", KEEP="1", CURRENT_TAG="v0.3.0")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.remote_tags(), ["v0.3.0"])

    def test_invalid_keep_fails(self) -> None:
        self.make_tags(self.TAGS)
        result = self.run_script(DRY_RUN="false", KEEP="0")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.remote_tags(), sorted(self.TAGS))


if __name__ == "__main__":
    unittest.main()
