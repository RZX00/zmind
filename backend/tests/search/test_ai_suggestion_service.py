import unittest

from core.search.ai_suggestion_service import build_link_suggestions


class AiSuggestionServiceTestCase(unittest.TestCase):
    def test_build_link_suggestions_skips_context_item(self):
        suggestions = build_link_suggestions(
            candidates=[
                {
                    "id": "doc:current",
                    "resultType": "doc",
                    "itemId": "current",
                    "title": "Current doc",
                    "snippet": "current",
                    "score": 0.8,
                    "debug": {"lexicalScore": 0.9, "graphScore": 0.1, "finalScore": 0.8},
                },
                {
                    "id": "doc:target",
                    "resultType": "doc",
                    "itemId": "target",
                    "title": "Target doc",
                    "snippet": "shared context",
                    "score": 0.6,
                    "debug": {"lexicalScore": 0.7, "graphScore": 0.3, "finalScore": 0.6},
                },
            ],
            context_item_id="current",
            limit=5,
        )
        self.assertEqual(len(suggestions), 1)
        self.assertEqual(suggestions[0]["targetItemId"], "target")

    def test_build_link_suggestions_prefers_unique_targets(self):
        suggestions = build_link_suggestions(
            candidates=[
                {
                    "id": "ref-1",
                    "resultType": "reference",
                    "itemId": "doc-1",
                    "targetItemId": "doc-1",
                    "snippet": "match one",
                    "score": 0.9,
                    "debug": {"lexicalScore": 0.8, "graphScore": 0.6, "finalScore": 0.9},
                },
                {
                    "id": "ref-2",
                    "resultType": "reference",
                    "itemId": "doc-1",
                    "targetItemId": "doc-1",
                    "snippet": "duplicate",
                    "score": 0.8,
                    "debug": {"lexicalScore": 0.7, "graphScore": 0.5, "finalScore": 0.8},
                },
                {
                    "id": "node-1",
                    "resultType": "canvas_node",
                    "itemId": "canvas-item-1",
                    "canvasId": "canvas-1",
                    "nodeId": "node-1",
                    "snippet": "match two",
                    "score": 0.7,
                    "debug": {"lexicalScore": 0.6, "graphScore": 0.4, "finalScore": 0.7},
                },
            ],
            context_item_id=None,
            limit=5,
        )
        target_ids = [row["targetItemId"] for row in suggestions]
        self.assertEqual(target_ids, ["doc-1", "canvas-item-1"])


if __name__ == "__main__":
    unittest.main()
