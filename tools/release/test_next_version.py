import unittest

import next_version as nv
from semver import parse


def run(current: str, *tags: str) -> str:
    return str(nv.next_version(parse(current), list(tags)))


class NextVersionTests(unittest.TestCase):
    def test_the_first_release_of_a_line_uses_the_files_version(self) -> None:
        self.assertEqual(run("0.1.0"), "0.1.0")
        self.assertEqual(run("1.4.0"), "1.4.0")

    def test_a_tagged_version_moves_the_patch_up(self) -> None:
        self.assertEqual(run("0.1.0", "v0.1.0"), "0.1.1")

    def test_it_is_always_above_every_stable_tag_of_the_line(self) -> None:
        self.assertEqual(run("0.1.0", "v0.1.0", "v0.1.1", "v0.1.7", "v0.1.3"), "0.1.8")

    def test_the_pruning_of_old_tags_never_brings_a_number_back(self) -> None:
        self.assertEqual(run("0.1.0", "v0.1.5"), "0.1.6")

    def test_a_higher_patch_in_the_files_wins(self) -> None:
        self.assertEqual(run("0.1.9", "v0.1.5"), "0.1.9")

    def test_a_new_line_starts_at_the_files_number(self) -> None:
        self.assertEqual(run("0.2.0", "v0.1.5", "v0.1.6"), "0.2.0")
        self.assertEqual(run("1.0.0", "v0.9.9"), "1.0.0")

    def test_a_prerelease_in_the_files_is_dropped(self) -> None:
        self.assertEqual(run("0.1.0-alpha.2"), "0.1.0")
        self.assertEqual(run("0.1.0-rc.1", "v0.1.0"), "0.1.1")

    def test_prerelease_tags_do_not_count(self) -> None:
        self.assertEqual(run("0.1.0", "v0.1.0-alpha.1", "v0.1.0-alpha.3", "v0.1.0-rc.2"), "0.1.0")

    def test_foreign_tags_are_ignored(self) -> None:
        self.assertEqual(run("0.1.0", "latest", "backup-1", "v0.1"), "0.1.0")

    def test_the_command_prints_the_version(self) -> None:
        self.assertEqual(nv.main(["0.1.0", "v0.1.0"]), 0)
        self.assertEqual(nv.main([]), 2)


if __name__ == "__main__":
    unittest.main()
