import json
import shutil
import tempfile
import unittest
from pathlib import Path

import version
from semver import parse

REAL_ROOT = Path(__file__).resolve().parents[2]


def make_tree(root: Path, semver_text: str = "0.1.0-alpha.1", pep440: str = "0.1.0a1") -> None:
    files = {
        "apps/desktop/package.json": json.dumps({"name": "x", "version": semver_text}, indent=2),
        "apps/desktop/src-tauri/tauri.conf.json": json.dumps(
            {"productName": "X", "version": semver_text}, indent=2
        ),
        "apps/desktop/src-tauri/Cargo.toml": (
            f'[package]\nname = "vyrion-desktop"\nversion = "{semver_text}"\nedition = "2021"\n'
            '\n[dependencies]\nserde = { version = "1" }\n'
        ),
        "apps/desktop/src-tauri/Cargo.lock": (
            '[[package]]\nname = "serde"\nversion = "1.0.0"\n\n'
            f'[[package]]\nname = "vyrion-desktop"\nversion = "{semver_text}"\n'
        ),
        "backend/pyproject.toml": f'[project]\nname = "vyrion-backend"\nversion = "{semver_text}"\n',
        "backend/app/__init__.py": f'"""Backend."""\n\n__version__ = "{semver_text}"\n',
        "backend/uv.lock": (
            '[[package]]\nname = "fastapi"\nversion = "0.1.0"\n\n'
            f'[[package]]\nname = "vyrion-backend"\nversion = "{pep440}"\n'
        ),
    }
    for relative, content in files.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")


class VersionToolTests(unittest.TestCase):
    def setUp(self) -> None:
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.root = Path(self._dir.name)
        make_tree(self.root)

    def test_consistent_tree_passes(self) -> None:
        self.assertEqual(version.check(self.root), [])

    def test_matching_tag_passes_and_other_tags_fail(self) -> None:
        self.assertEqual(version.check(self.root, "v0.1.0-alpha.1"), [])
        problems = version.check(self.root, "v0.1.0")
        self.assertEqual(len(problems), 7)
        self.assertTrue(all("the tag says 0.1.0" in problem for problem in problems))

    def test_invalid_tag_is_reported(self) -> None:
        self.assertTrue(any("not a release tag" in p for p in version.check(self.root, "0.1.0")))

    def test_drift_in_one_file_is_detected(self) -> None:
        path = self.root / "apps/desktop/src-tauri/Cargo.toml"
        path.write_text(path.read_text().replace("0.1.0-alpha.1", "0.1.0-alpha.2"), encoding="utf-8")
        problems = version.check(self.root)
        self.assertEqual(problems[0], "versions differ:")
        self.assertTrue(any("Cargo.toml" in p and "0.1.0-alpha.2" in p for p in problems))

    def test_stale_lockfile_is_detected(self) -> None:
        path = self.root / "backend/uv.lock"
        path.write_text(path.read_text().replace("0.1.0a1", "0.0.9"), encoding="utf-8")
        self.assertEqual(version.check(self.root)[0], "versions differ:")

    def test_set_updates_every_location_and_nothing_else(self) -> None:
        version.set_version(self.root, parse("1.2.3-rc.4"))
        self.assertEqual(version.check(self.root, "v1.2.3-rc.4"), [])
        self.assertEqual(
            (self.root / "backend/uv.lock").read_text(),
            '[[package]]\nname = "fastapi"\nversion = "0.1.0"\n\n'
            '[[package]]\nname = "vyrion-backend"\nversion = "1.2.3rc4"\n',
        )
        cargo = (self.root / "apps/desktop/src-tauri/Cargo.toml").read_text()
        self.assertIn('serde = { version = "1" }', cargo)  # dependency versions untouched
        self.assertIn('version = "1.0.0"', (self.root / "apps/desktop/src-tauri/Cargo.lock").read_text())

    def test_set_to_stable_and_back(self) -> None:
        version.set_version(self.root, parse("2.0.0"))
        self.assertEqual(version.check(self.root, "v2.0.0"), [])
        version.set_version(self.root, parse("2.1.0-beta.1"))
        self.assertEqual(version.check(self.root, "v2.1.0-beta.1"), [])

    def test_missing_file_is_a_problem_not_a_crash(self) -> None:
        (self.root / "backend/uv.lock").unlink()
        self.assertTrue(any("uv.lock" in problem for problem in version.check(self.root)))


class ChangelogTests(unittest.TestCase):
    CHANGELOG = """# Changelog

## [Unreleased]

Next.

## [0.2.0] - 2026-12-01

### Added

- Two.

## [0.1.0-alpha.1] - 2026-11-11

### Added

- One.

[Unreleased]: https://example.invalid/compare
[0.1.0-alpha.1]: https://example.invalid/release
"""

    def test_extracts_only_the_requested_section(self) -> None:
        text = version.changelog_section(self.CHANGELOG, parse("0.2.0"))
        self.assertEqual(text, "### Added\n\n- Two.")

    def test_last_section_drops_link_definitions(self) -> None:
        text = version.changelog_section(self.CHANGELOG, parse("0.1.0-alpha.1"))
        self.assertEqual(text, "### Added\n\n- One.")

    def test_unknown_version_is_empty(self) -> None:
        self.assertEqual(version.changelog_section(self.CHANGELOG, parse("9.9.9")), "")

    def test_a_prefix_of_another_version_does_not_match(self) -> None:
        self.assertEqual(version.changelog_section("## [0.1.0-alpha.10]\n\nx\n", parse("0.1.0-alpha.1")), "")


class RealRepositoryTests(unittest.TestCase):
    def test_the_repository_versions_agree(self) -> None:
        self.assertEqual(version.check(REAL_ROOT), [])

    def test_set_then_check_works_on_a_copy_of_the_real_files(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            copy = Path(temp)
            for location in version.LOCATIONS:
                destination = copy / location.path
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy(REAL_ROOT / location.path, destination)
            version.set_version(copy, parse("9.8.7-beta.6"))
            self.assertEqual(version.check(copy, "v9.8.7-beta.6"), [])


if __name__ == "__main__":
    unittest.main()
