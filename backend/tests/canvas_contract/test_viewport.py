"""Canvas read contract — viewport camera bbox filter (WS2-7).

The frontend supplies the camera; the pure filter keeps nodes whose box intersects the
visible canvas rect. (canvas_read's scope='viewport' wiring + the camera source are
method-level and exercised by the full suite; here we pin the geometry.)
"""

from __future__ import annotations

from core.canvas.read_projection import nodes_in_viewport


def test_filters_to_visible_rect():
    cam = {"x": 0, "y": 0, "zoom": 1, "vw": 1000, "vh": 1000}  # visible rect 0..1000
    nodes = [
        {"id": "in", "x": 100, "y": 100, "width": 50, "height": 50},
        {"id": "edge", "x": -10, "y": 0, "width": 30, "height": 30},  # straddles the left edge
        {"id": "far", "x": 5000, "y": 5000, "width": 50, "height": 50},
    ]
    assert {n["id"] for n in nodes_in_viewport(nodes, cam)} == {"in", "edge"}


def test_zoom_shrinks_visible_rect():
    cam = {"x": 0, "y": 0, "zoom": 2, "vw": 1000, "vh": 1000}  # visible width = vw/zoom = 500
    nodes = [
        {"id": "a", "x": 100, "y": 100, "width": 10, "height": 10},
        {"id": "b", "x": 700, "y": 100, "width": 10, "height": 10},  # x=700 > 500 → outside
    ]
    assert {n["id"] for n in nodes_in_viewport(nodes, cam)} == {"a"}


def test_pan_offset():
    cam = {"x": 1000, "y": 1000, "zoom": 1, "vw": 500, "vh": 500}  # rect 1000..1500
    nodes = [
        {"id": "a", "x": 100, "y": 100, "width": 10, "height": 10},  # left of pan → outside
        {"id": "b", "x": 1200, "y": 1200, "width": 10, "height": 10},
    ]
    assert {n["id"] for n in nodes_in_viewport(nodes, cam)} == {"b"}


def test_invalid_camera_returns_all():
    nodes = [{"id": "a", "x": 0, "y": 0, "width": 10, "height": 10}]
    assert nodes_in_viewport(nodes, {}) == nodes      # dict missing keys → unchanged
    assert nodes_in_viewport(nodes, None) == nodes    # not a dict → unchanged


def test_nonnumeric_coords_are_kept_not_hidden():
    cam = {"x": 0, "y": 0, "zoom": 1, "vw": 100, "vh": 100}
    nodes = [{"id": "bad", "x": "oops", "y": 0, "width": 10, "height": 10}]
    assert [n["id"] for n in nodes_in_viewport(nodes, cam)] == ["bad"]
