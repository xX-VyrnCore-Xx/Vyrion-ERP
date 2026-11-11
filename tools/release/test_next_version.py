import unittest

import next_version as nv
from semver import parse


def run(current: str, *tags: str) -> str | None:
    result = nv.next_version(parse(current), list(tags))
    return None if result is None else str(result)


class NextVersionTests(unittest.TestCase):
    def test_an_untagged_version_is_released_as_it_is(self) -> None:
        self.assertEqual(run("0.1.0-alpha.2"), "0.1.0-alpha.2")
        self.assertEqual(run("0.1.0-alpha.2", "v0.1.0-alpha.1"), "0.1.0-alpha.2")

    def test_a_tagged_version_moves_the_counter_up(self) -> None:
        self.assertEqual(run("0.1.0-alpha.2", "v0.1.0-alpha.2"), "0.1.0-alpha.3")

    def test_it_is_always_above_every_existing_tag_of_the_line(self) -> None:
        tags = ("v0.1.0-alpha.2", "v0.1.0-alpha.7", "v0.1.0-alpha.4")
        self.assertEqual(run("0.1.0-alpha.2", *tags), "0.1.0-alpha.8")

    def test_old_tags_that_were_pruned_never_bring_a_number_back(self) -> None:
        # alpha.2 was pruned; the highest remaining tag decides, not the version in the files
        self.assertEqual(run("0.1.0-alpha.2", "v0.1.0-alpha.5"), "0.1.0-alpha.6")

    def test_a_higher_version_in_the_files_wins(self) -> None:
        self.assertEqual(run("0.1.0-alpha.9", "v0.1.0-alpha.5"), "0.1.0-alpha.9")

    def test_other_lines_and_channels_do_not_interfere(self) -> None:
        tags = ("v0.1.0-beta.3", "v0.0.9-alpha.40", "v0.2.0-alpha.1")
        self.assertEqual(run("0.1.0-alpha.2", *tags), "0.1.0-alpha.2")

    def test_a_stable_version_is_released_once(self) -> None:
        self.assertEqual(run("1.0.0"), "1.0.0")
        self.assertIsNone(run("1.0.0", "v1.0.0"))

    def test_no_prerelease_is_made_once_the_stable_release_of_the_line_exists(self) -> None:
        self.assertIsNone(run("1.0.0-rc.1", "v1.0.0"))

    def test_foreign_tags_are_ignored(self) -> None:
        self.assertEqual(run("0.1.0-alpha.2", "latest", "backup-1", "v0.1"), "0.1.0-alpha.2")

    def test_the_command_prints_nothing_when_there_is_nothing_to_release(self) -> None:
        self.assertEqual(nv.main(["1.0.0", "v1.0.0"]), 0)


if __name__ == "__main__":
    unittest.main()
