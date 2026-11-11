import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import make_latest_json as m

NOW = datetime(2026, 11, 11, 12, 0, 0, tzinfo=timezone.utc)


def put(folder: Path, name: str, text: str = "x") -> None:
    (folder / name).write_text(text, encoding="utf-8")


class ManifestTests(unittest.TestCase):
    def build(self, folder: Path, notes: str = "Novità"):
        return m.build_manifest(folder, "0.1.5", "v0.1.5", "o/r", notes, NOW)

    def test_nothing_is_written_without_signed_packages(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            folder = Path(d)
            put(folder, "Vyrion-ERP_0.1.5_Windows-x64-Setup.exe")  # no .sig next to it
            self.assertIsNone(self.build(folder))

    def test_both_platforms_with_signature_and_url(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            folder = Path(d)
            put(folder, "Vyrion-ERP_0.1.5_Windows-x64-Setup.exe")
            put(folder, "Vyrion-ERP_0.1.5_Windows-x64-Setup.exe.sig", "SIGWIN\n")
            put(folder, "Vyrion-ERP_0.1.5_macOS-AppleSilicon.app.tar.gz")
            put(folder, "Vyrion-ERP_0.1.5_macOS-AppleSilicon.app.tar.gz.sig", "SIGMAC")
            manifest = self.build(folder)
            assert manifest is not None
            self.assertEqual(manifest["version"], "0.1.5")
            self.assertEqual(manifest["pub_date"], "2026-11-11T12:00:00Z")
            win = manifest["platforms"]["windows-x86_64"]
            self.assertEqual(win["signature"], "SIGWIN")
            self.assertEqual(
                win["url"],
                "https://github.com/o/r/releases/download/v0.1.5/Vyrion-ERP_0.1.5_Windows-x64-Setup.exe",
            )
            self.assertEqual(manifest["platforms"]["darwin-aarch64"]["signature"], "SIGMAC")
            json.dumps(manifest)  # serialisable

    def test_a_single_platform_is_enough(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            folder = Path(d)
            put(folder, "Vyrion-ERP_0.1.5_macOS-AppleSilicon.app.tar.gz")
            put(folder, "Vyrion-ERP_0.1.5_macOS-AppleSilicon.app.tar.gz.sig")
            manifest = self.build(folder)
            assert manifest is not None
            self.assertEqual(list(manifest["platforms"]), ["darwin-aarch64"])

    def test_main_writes_the_file_only_when_there_is_something_to_publish(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            folder = Path(d)
            args = ["--dir", d, "--version", "0.1.5", "--tag", "v0.1.5", "--repo", "o/r"]
            self.assertEqual(m.main(args), 0)
            self.assertFalse((folder / "latest.json").exists())
            put(folder, "Vyrion-ERP_0.1.5_Windows-x64-Setup.exe")
            put(folder, "Vyrion-ERP_0.1.5_Windows-x64-Setup.exe.sig", "S")
            self.assertEqual(m.main(args + ["--notes", "ciao"]), 0)
            written = json.loads((folder / "latest.json").read_text(encoding="utf-8"))
            self.assertEqual(written["notes"], "ciao")


if __name__ == "__main__":
    unittest.main()
