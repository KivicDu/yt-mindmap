from node_tree import (
    MAX_LABEL_CHARS,
    clean_label,
    count_nodes,
    find_node,
    iter_nodes,
    label_key,
    markdown_label,
    markdown_to_tree,
    merge_nodes,
    normalize_cached_nodes,
    normalize_nodes,
    resolve_time,
    tree_to_markdown,
)


class TestCleanLabel:
    def test_collapses_whitespace(self):
        assert clean_label("  Binary\n\tsearch   trees ") == "Binary search trees"

    def test_handles_none_and_numbers(self):
        assert clean_label(None) == ""
        assert clean_label(42) == "42"

    def test_truncates_very_long_labels(self):
        assert len(clean_label("x" * 500)) == MAX_LABEL_CHARS

    def test_label_key_is_case_and_space_insensitive(self):
        assert label_key("  Big  O Notation ") == label_key("big o notation")


class TestResolveTime:
    def test_accepts_numbers_and_numeric_strings_default(self):
        assert resolve_time(12.5) == 12.5
        assert resolve_time(0) == 0.0
        assert resolve_time(None, default=7) == 7.0

    def test_rejects_booleans_and_negative_values(self):
        assert resolve_time(True, default=5) == 5.0
        assert resolve_time(-3, default=5) == 5.0
        assert resolve_time("12", default=None) is None

    def test_returns_none_without_a_usable_value(self):
        assert resolve_time(None) is None


class TestMarkdownLabel:
    def test_timestamped_label_becomes_a_seek_link(self):
        assert markdown_label("Recursion", 12.34) == "[Recursion](#seek-12.3)"

    def test_label_without_time_stays_plain(self):
        assert markdown_label("Overview", None) == "Overview"

    def test_square_brackets_are_replaced(self):
        assert markdown_label("Array [index]", 1.0) == "[Array (index)](#seek-1.0)"

    def test_newlines_inside_labels_are_flattened(self):
        assert markdown_label("two\nlines", 2.0) == "[two lines](#seek-2.0)"


class TestNormalizeNodes:
    def test_assigns_unique_ids_and_links_parents(self):
        nodes = normalize_nodes(
            [
                {
                    "name": "Trees",
                    "time": 10,
                    "children": [{"name": "Binary tree", "children": [{"name": "Depth"}]}],
                }
            ],
            default_time=5.0,
        )

        parent = nodes[0]
        child = parent["children"][0]
        grandchild = child["children"][0]

        assert parent["parentId"] is None
        assert child["parentId"] == parent["id"]
        assert grandchild["parentId"] == child["id"]
        assert len({parent["id"], child["id"], grandchild["id"]}) == 3
        assert grandchild["time"] == 5.0

    def test_accepts_title_and_label_keys(self):
        nodes = normalize_nodes([{"title": "From title"}, {"label": "From label"}])
        assert [n["label"] for n in nodes] == ["From title", "From label"]

    def test_skips_invalid_entries_without_failing_the_chunk(self):
        nodes = normalize_nodes(
            ["a string", None, {"name": "   "}, {"name": "Kept", "children": ["junk"]}]
        )
        assert [n["label"] for n in nodes] == ["Kept"]
        assert nodes[0]["children"] == []

    def test_empty_input_is_safe(self):
        assert normalize_nodes([]) == []
        assert normalize_nodes(None) == []


class TestMergeNodes:
    def _tree(self):
        return normalize_nodes(
            [{"name": "Trees", "time": 10, "children": [{"name": "Binary tree", "time": 11}]}]
        )

    def test_new_branch_is_appended(self):
        merged = merge_nodes(self._tree(), normalize_nodes([{"name": "Graphs", "time": 30}]))
        assert [n["label"] for n in merged] == ["Trees", "Graphs"]

    def test_repeated_label_is_not_duplicated(self):
        merged = merge_nodes(self._tree(), normalize_nodes([{"name": "trees", "time": 99}]))
        assert len(merged) == 1
        assert merged[0]["label"] == "Trees"

    def test_repeat_keeps_original_id_and_time(self):
        tree = self._tree()
        original_id = tree[0]["id"]
        merged = merge_nodes(tree, normalize_nodes([{"name": "Trees", "time": 99}]))
        assert merged[0]["id"] == original_id
        assert merged[0]["time"] == 10.0

    def test_children_of_a_repeat_are_absorbed(self):
        merged = merge_nodes(
            self._tree(),
            normalize_nodes([{"name": "Trees", "children": [{"name": "AVL", "time": 44}]}]),
        )
        assert [c["label"] for c in merged[0]["children"]] == ["Binary tree", "AVL"]

    def test_duplicate_child_under_a_repeat_is_also_folded(self):
        merged = merge_nodes(
            self._tree(),
            normalize_nodes([{"name": "Trees", "children": [{"name": "binary TREE"}]}]),
        )
        assert len(merged[0]["children"]) == 1

    def test_input_tree_is_not_mutated(self):
        tree = self._tree()
        before = tree_to_markdown(tree)
        merge_nodes(tree, normalize_nodes([{"name": "Graphs", "time": 30}]))
        assert tree_to_markdown(tree) == before

    def test_new_nodes_get_the_right_parent_id_when_absorbed(self):
        tree = self._tree()
        merged = merge_nodes(tree, normalize_nodes([{"name": "Trees", "children": [{"name": "AVL"}]}]))
        assert merged[0]["children"][1]["parentId"] == tree[0]["id"]


class TestProjection:
    def test_tree_is_projected_to_indented_markdown(self):
        tree = normalize_nodes(
            [{"name": "Root", "time": 1, "children": [{"name": "Child", "time": 2}]}]
        )
        assert tree_to_markdown(tree) == "- [Root](#seek-1.0)\n  - [Child](#seek-2.0)"

    def test_labels_without_time_are_plain(self):
        assert tree_to_markdown(normalize_nodes([{"name": "Only"}])) == "- Only"

    def test_empty_tree_is_an_empty_string(self):
        assert tree_to_markdown([]) == ""

    def test_roundtrip_preserves_structure_and_time(self):
        original = normalize_nodes(
            [
                {
                    "name": "Neural networks",
                    "time": 10.7,
                    "children": [
                        {"name": "Layers", "time": 20, "children": [{"name": "Weights", "time": 25}]},
                        {"name": "Backprop", "time": 40},
                    ],
                }
            ]
        )
        restored = markdown_to_tree(tree_to_markdown(original))

        assert [n["label"] for n in restored] == ["Neural networks"]
        assert [c["label"] for c in restored[0]["children"]] == ["Layers", "Backprop"]
        assert restored[0]["children"][0]["children"][0]["label"] == "Weights"
        assert restored[0]["children"][0]["time"] == 20.0
        assert restored[0]["children"][1]["parentId"] == restored[0]["id"]


class TestMarkdownToTree:
    def test_parses_plain_bullets_and_deeper_indent(self):
        tree = markdown_to_tree("- A\n    - B\n- C")
        assert [n["label"] for n in tree] == ["A", "C"]
        assert tree[0]["children"][0]["label"] == "B"

    def test_ignores_titles_headings_and_blank_lines(self):
        tree = markdown_to_tree("# Title\n\n- A\n\n## Section\n- B")
        assert [n["label"] for n in tree] == ["A", "B"]

    def test_handles_an_over_indented_first_bullet(self):
        tree = markdown_to_tree("      - Deep")
        assert len(tree) == 1
        assert tree[0]["parentId"] is None

    def test_empty_markdown_gives_an_empty_tree(self):
        assert markdown_to_tree("") == []
        assert markdown_to_tree("# only a heading") == []


class TestLookup:
    def _tree(self):
        return normalize_nodes(
            [{"name": "A", "children": [{"name": "A1"}, {"name": "A2"}]}, {"name": "B"}]
        )

    def test_iter_nodes_is_pre_order(self):
        assert [n["label"] for n in iter_nodes(self._tree())] == ["A", "A1", "A2", "B"]

    def test_count_nodes(self):
        assert count_nodes(self._tree()) == 4
        assert count_nodes([]) == 0

    def test_find_node_by_id(self):
        tree = self._tree()
        target = tree[0]["children"][1]
        assert find_node(tree, target["id"]) is target
        assert find_node(tree, "missing") is None


class TestCachedNodes:
    def test_missing_ids_are_regenerated(self):
        repaired = normalize_cached_nodes(
            [{"label": "A", "children": [{"label": "B"}]}]
        )
        assert repaired[0]["id"]
        assert repaired[0]["children"][0]["parentId"] == repaired[0]["id"]

    def test_existing_ids_are_kept(self):
        repaired = normalize_cached_nodes([{"id": "keep-me", "label": "A"}])
        assert repaired[0]["id"] == "keep-me"

    def test_garbage_is_dropped(self):
        assert normalize_cached_nodes(None) == []
        assert normalize_cached_nodes([1, "x", {"label": ""}]) == []
