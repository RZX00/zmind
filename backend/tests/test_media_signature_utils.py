from urllib.parse import parse_qs, urlparse

from core.media.signature_utils import (
    build_signed_doc_media_url,
    generate_doc_media_signature,
    verify_doc_media_signature,
)
from core.utils.config import config


def test_doc_media_signature_round_trip(monkeypatch) -> None:
    monkeypatch.setattr(config, "SUPABASE_JWT_SECRET", "test-secret", raising=False)

    path = "acct/doc-media/example.png"
    doc_item_id = "item_123"
    sig, ts = generate_doc_media_signature(path, doc_item_id, ttl=3600)

    assert verify_doc_media_signature(path, doc_item_id, sig, ts, 3600) is True
    assert verify_doc_media_signature(path, "item_other", sig, ts, 3600) is False


def test_build_signed_doc_media_url_includes_doc_scope(monkeypatch) -> None:
    monkeypatch.setattr(config, "SUPABASE_JWT_SECRET", "test-secret", raising=False)

    url = build_signed_doc_media_url(
        "acct/doc-media/example.png",
        "item_777",
        ttl=7200,
        base="/api/media/file-uploads",
    )
    parsed = urlparse(url)
    query = parse_qs(parsed.query)

    assert parsed.path.endswith("/acct/doc-media/example.png")
    assert query["doc_item_id"][0] == "item_777"
    assert query["ttl"][0] == "7200"
    assert "sig" in query
    assert "ts" in query
