import unittest
import zipfile
from io import BytesIO

from core.integrations.obsidian.parser import (
    parse_assets_payload,
    parse_embed_links,
    parse_files_payload,
    parse_wikilinks,
    parse_zip_payload,
)


class ObsidianParserTestCase(unittest.TestCase):
    def test_parse_files_payload_keeps_markdown_only(self):
        files = parse_files_payload(
            [
                {"path": "notes/a.md", "content": "A"},
                {"path": "notes/b.txt", "content": "B"},
            ]
        )
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0].path, "notes/a.md")

    def test_parse_wikilinks_extracts_anchor_and_block(self):
        refs = parse_wikilinks("See [[Roadmap#Q1]] and [[Design^block-123|alias]].")
        self.assertEqual(len(refs), 2)
        self.assertEqual(refs[0].target_note, "Roadmap")
        self.assertEqual(refs[0].target_anchor, "Q1")
        self.assertEqual(refs[1].target_note, "Design")
        self.assertEqual(refs[1].target_block, "block-123")

    def test_parse_wikilinks_skips_embed_links(self):
        refs = parse_wikilinks("Use ![[assets/diagram.png]] and [[Roadmap]].")
        self.assertEqual(len(refs), 1)
        self.assertEqual(refs[0].target_note, "Roadmap")

    def test_parse_embed_links_extracts_targets(self):
        refs = parse_embed_links("Inline ![[Note#H1]] and ![[assets/diagram.png]].")
        self.assertEqual(len(refs), 2)
        self.assertEqual(refs[0].target_note, "Note")
        self.assertEqual(refs[0].target_anchor, "H1")
        self.assertEqual(refs[1].target_note, "assets/diagram.png")

    def test_parse_assets_payload_keeps_non_markdown(self):
        assets = parse_assets_payload(
            [
                {"path": "assets/a.png", "base64": "AA==", "contentType": "image/png"},
                {"path": "notes/b.md", "base64": "QQ=="},
            ]
        )
        self.assertEqual(len(assets), 1)
        self.assertEqual(assets[0].path, "assets/a.png")
        self.assertEqual(assets[0].content_type, "image/png")

    def test_parse_zip_payload_splits_docs_and_assets(self):
        stream = BytesIO()
        with zipfile.ZipFile(stream, "w") as archive:
            archive.writestr("notes/a.md", "# A")
            archive.writestr("assets/pic.png", b"\x89PNG\r\n")

        import base64

        zip_base64 = base64.b64encode(stream.getvalue()).decode("utf-8")
        docs, assets = parse_zip_payload(zip_base64)
        self.assertEqual(len(docs), 1)
        self.assertEqual(docs[0].path, "notes/a.md")
        self.assertEqual(len(assets), 1)
        self.assertEqual(assets[0].path, "assets/pic.png")


if __name__ == "__main__":
    unittest.main()
