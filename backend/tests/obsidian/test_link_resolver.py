import unittest

from core.integrations.obsidian.link_resolver import resolve_asset_target, resolve_note_target


class ObsidianLinkResolverTestCase(unittest.TestCase):
    def test_resolve_note_target_by_direct_path(self):
        target = resolve_note_target(
            source_doc_path="notes/a.md",
            target_note="notes/b.md",
            path_to_item_id={"notes/b.md": "item_b"},
        )
        self.assertEqual(target, "notes/b.md")

    def test_resolve_note_target_by_same_dir(self):
        target = resolve_note_target(
            source_doc_path="projects/a.md",
            target_note="b",
            path_to_item_id={"projects/b.md": "item_b"},
        )
        self.assertEqual(target, "projects/b.md")

    def test_resolve_asset_target_by_same_dir(self):
        target = resolve_asset_target(
            source_doc_path="projects/notes/a.md",
            target_asset="images/pic.png",
            asset_path_to_file={"projects/notes/images/pic.png": {"fileId": "f1"}},
        )
        self.assertEqual(target, "projects/notes/images/pic.png")

    def test_resolve_asset_target_by_unique_basename(self):
        target = resolve_asset_target(
            source_doc_path="projects/notes/a.md",
            target_asset="pic.png",
            asset_path_to_file={"assets/pic.png": {"fileId": "f1"}},
        )
        self.assertEqual(target, "assets/pic.png")


if __name__ == "__main__":
    unittest.main()
