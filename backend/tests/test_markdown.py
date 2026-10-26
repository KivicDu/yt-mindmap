from ai_engine import nodes_to_markdown


def test_nested_nodes_become_indented_markdown():
    nodes = [
        {
            "name": "Parent",
            "time": 12.34,
            "children": [{"name": "Child", "time": 15, "children": [{"name": "Leaf"}]}],
        }
    ]
    assert nodes_to_markdown(nodes, default_time=5.0) == (
        "- [Parent](#seek-12.3)\n"
        "  - [Child](#seek-15.0)\n"
        "    - [Leaf](#seek-5.0)"
    )


def test_default_time_is_used_when_node_has_none():
    nodes = [{"name": "Only", "children": [{"name": "Sub"}]}]
    assert nodes_to_markdown(nodes, default_time=42.0) == (
        "- [Only](#seek-42.0)\n  - [Sub](#seek-42.0)"
    )


def test_without_any_time_labels_stay_plain():
    assert nodes_to_markdown([{"name": "Plain"}]) == "- Plain"


def test_square_brackets_are_escaped_for_markdown_links():
    nodes = [{"name": "Array [index]", "time": 1}]
    assert nodes_to_markdown(nodes) == "- [Array (index)](#seek-1.0)"


def test_empty_or_invalid_children_are_skipped():
    nodes = [
        {"name": ""},
        {"title": "From title", "time": 2},
        "not a dict",
        {"name": "Parent", "children": [{"name": ""}, None]},
    ]
    assert nodes_to_markdown(nodes) == (
        "- [From title](#seek-2.0)\n- Parent"
    )


def test_title_field_is_accepted_as_fallback():
    assert nodes_to_markdown([{"title": "Fallback", "time": 3}]) == (
        "- [Fallback](#seek-3.0)"
    )
