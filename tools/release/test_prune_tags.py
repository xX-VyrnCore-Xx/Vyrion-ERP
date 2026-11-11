import io
import random
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest import mock

import prune_tags
from semver import from_pep440, is_release_tag, parse, parse_tag


class SemverTests(unittest.TestCase):
    def test_parse_and_format_roundtrip(self) -> None:
        for text in ["0.1.0", "1.2.3", "10.20.30", "0.1.0-alpha.1", "1.0.0-rc.12", "2.0.0-beta.0"]:
            self.assertEqual(str(parse(text)), text)

    def test_rejects_unsupported_shapes(self) -> None:
        for text in [
            "1.2", "1.2.3.4", "01.2.3", "1.2.3-alpha", "1.2.3-alpha.01", "1.2.3-dev.1",
            "1.2.3+build", "v1.2.3", "", " 1.2.3", "1.2.3-alpha.1.2",
        ]:
            with self.assertRaises(ValueError, msg=text):
                parse(text)

    def test_tag_needs_the_v_prefix(self) -> None:
        self.assertTrue(is_release_tag("v1.2.3"))
        self.assertTrue(is_release_tag("v1.2.3-rc.1"))
        for tag in ["1.2.3", "V1.2.3", "latest", "v1", "release-1.2.3", "v1.2.3-"]:
            self.assertFalse(is_release_tag(tag), tag)

    def test_precedence_follows_the_semver_spec(self) -> None:
        ascending = [
            "0.1.0-alpha.1", "0.1.0-alpha.2", "0.1.0-alpha.10", "0.1.0-beta.1",
            "0.1.0-rc.1", "0.1.0", "0.1.1-alpha.1", "0.1.1", "0.2.0-rc.1", "0.10.0", "1.0.0",
        ]
        shuffled = ascending[:]
        random.Random(7).shuffle(shuffled)
        ordered = sorted(shuffled, key=lambda text: parse(text).sort_key())
        self.assertEqual(ordered, ascending)

    def test_pep440_conversion(self) -> None:
        pairs = {
            "0.1.0-alpha.1": "0.1.0a1",
            "1.2.3-beta.4": "1.2.3b4",
            "1.0.0-rc.2": "1.0.0rc2",
            "1.0.0": "1.0.0",
        }
        for semver_text, pep in pairs.items():
            self.assertEqual(parse(semver_text).to_pep440(), pep)
            self.assertEqual(from_pep440(pep), parse(semver_text))
        with self.assertRaises(ValueError):
            from_pep440("1.0.0.dev1")
        self.assertEqual(parse_tag("v0.1.0-alpha.1"), parse("0.1.0-alpha.1"))


class PlanTests(unittest.TestCase):
    def test_keeps_the_newest_by_version_not_by_input_order(self) -> None:
        tags = ["v0.3.0", "v0.1.0-alpha.1", "v0.2.0", "v0.1.0", "v0.4.0-rc.1", "v0.4.0-beta.2"]
        kept, doomed = prune_tags.plan(tags, 3)
        self.assertEqual(kept, ["v0.4.0-rc.1", "v0.4.0-beta.2", "v0.3.0"])
        self.assertEqual(doomed, ["v0.2.0", "v0.1.0", "v0.1.0-alpha.1"])

    def test_three_or_fewer_tags_delete_nothing(self) -> None:
        for count in range(4):
            tags = [f"v0.{minor}.0" for minor in range(count)]
            self.assertEqual(prune_tags.plan(tags, 3)[1], [])

    def test_a_late_patch_on_an_old_line_does_not_evict_newer_tags(self) -> None:
        tags = ["v1.0.0", "v1.1.0", "v2.0.0", "v2.1.0", "v1.0.1"]
        kept, doomed = prune_tags.plan(tags, 3)
        self.assertEqual(kept, ["v2.1.0", "v2.0.0", "v1.1.0"])
        self.assertEqual(doomed, ["v1.0.1", "v1.0.0"])

    def test_foreign_tags_are_never_selected(self) -> None:
        tags = ["latest", "nightly", "v1", "backup-2026", "v0.1.0", "v0.2.0", "v0.3.0", "v0.4.0"]
        _, doomed = prune_tags.plan(tags, 3)
        self.assertEqual(doomed, ["v0.1.0"])

    def test_duplicates_count_once(self) -> None:
        kept, doomed = prune_tags.plan(["v0.1.0", "v0.1.0", "v0.2.0"], 2)
        self.assertEqual((kept, doomed), (["v0.2.0", "v0.1.0"], []))

    def test_keep_must_be_positive(self) -> None:
        with self.assertRaises(ValueError):
            prune_tags.plan(["v0.1.0"], 0)


def run_cli(stdin: str, *args: str) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    with (
        mock.patch("sys.stdin", io.StringIO(stdin)),
        redirect_stdout(out),
        redirect_stderr(err),
    ):
        code = prune_tags.main(list(args))
    return code, out.getvalue(), err.getvalue()


class CliTests(unittest.TestCase):
    TAGS = "v0.1.0\nv0.2.0\nv0.3.0\nv0.4.0\nv0.5.0\n"

    def test_prints_the_oldest_first(self) -> None:
        code, out, _ = run_cli(self.TAGS, "--keep", "3")
        self.assertEqual((code, out), (0, "v0.1.0\nv0.2.0\n"))

    def test_must_keep_passes_when_it_survives(self) -> None:
        code, out, _ = run_cli(self.TAGS, "--keep", "3", "--must-keep", "v0.5.0")
        self.assertEqual((code, out), (0, "v0.1.0\nv0.2.0\n"))

    def test_must_keep_evicted_deletes_nothing(self) -> None:
        code, out, err = run_cli(self.TAGS, "--keep", "3", "--must-keep", "v0.1.0")
        self.assertEqual((code, out), (3, ""))
        self.assertIn("refusing to prune", err)

    def test_must_keep_unknown_is_an_error(self) -> None:
        code, out, _ = run_cli(self.TAGS, "--keep", "3", "--must-keep", "v9.9.9")
        self.assertEqual((code, out), (2, ""))

    def test_invalid_keep_is_an_error(self) -> None:
        code, out, _ = run_cli(self.TAGS, "--keep", "0")
        self.assertEqual((code, out), (2, ""))

    def test_empty_input(self) -> None:
        self.assertEqual(run_cli("", "--keep", "3")[:2], (0, ""))

    def test_ignored_tags_are_reported_on_stderr_only(self) -> None:
        code, out, err = run_cli("latest\nv0.1.0\n", "--keep", "3")
        self.assertEqual((code, out), (0, ""))
        self.assertIn("ignoring non-release tags: latest", err)


if __name__ == "__main__":
    unittest.main()
