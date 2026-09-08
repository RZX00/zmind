import unittest

from core.search.ranker import compose_score, graph_affinity_score, recency_score, token_overlap_score


class RankerTestCase(unittest.TestCase):
    def test_token_overlap_score_matches_tokens(self):
        score = token_overlap_score("graph ranking", "This ranking uses graph proximity.")
        self.assertGreater(score, 0.9)

    def test_graph_affinity_is_normalized(self):
        score = graph_affinity_score(
            "item_a",
            inbound_count_by_item={"item_a": 3},
            outbound_count_by_item={"item_a": 2},
            max_degree=10,
        )
        self.assertGreater(score, 0.0)
        self.assertLessEqual(score, 1.0)
        self.assertEqual(round(score, 2), 0.5)

    def test_recency_score_decays_with_age(self):
        now = 1_000_000_000_000
        very_recent = recency_score(now, now_ts=now)
        old = recency_score(now - 1000 * 60 * 60 * 24 * 120, now_ts=now)
        self.assertGreater(very_recent, old)

    def test_compose_score_weighted_sum(self):
        score = compose_score(
            lexical_score=0.8,
            recency_score_value=0.5,
            graph_affinity_score_value=0.25,
            interaction_score=0.0,
        )
        self.assertGreaterEqual(score, 0.0)
        self.assertLessEqual(score, 1.0)
        self.assertEqual(round(score, 3), 0.55)


if __name__ == "__main__":
    unittest.main()
