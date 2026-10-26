from chunking import (
    MAX_CHUNK_ENTRIES,
    MAX_CHUNK_SECONDS,
    chunk_time_range,
    is_seek_backward,
    select_chunk,
)


def entry(start: float, duration: float = 1.0, text: str = "x") -> dict:
    return {"start": start, "duration": duration, "text": text}


def test_skips_already_consumed_entries():
    transcript = [entry(0), entry(5), entry(10), entry(15)]
    chunk = select_chunk(transcript, last_time=20, consumed_until=12)
    assert [c["start"] for c in chunk] == [15]


def test_lookahead_includes_entry_just_after_playhead():
    transcript = [entry(10, text="a"), entry(13, text="b"), entry(16, text="c")]
    chunk = select_chunk(transcript, last_time=12, consumed_until=0)
    # lookahead is 2s, so 13s is still inside the window but 16s is not.
    assert [c["text"] for c in chunk] == ["a", "b"]


def test_forward_seek_is_capped_to_max_chunk_seconds():
    transcript = [entry(10, text="near"), entry(170, text="edge"), entry(200, text="far"), entry(900)]
    chunk = select_chunk(transcript, last_time=900, consumed_until=0)
    starts = [c["start"] for c in chunk]
    assert starts == [10, 170]
    assert all(start <= MAX_CHUNK_SECONDS for start in starts)


def test_chunk_entry_count_is_capped():
    # 0.4s spacing keeps 400 entries inside the 180s window.
    transcript = [entry(0.4 * (i + 1)) for i in range(400)]
    chunk = select_chunk(transcript, last_time=400, consumed_until=0)
    assert len(chunk) == MAX_CHUNK_ENTRIES


def test_entries_starting_exactly_at_pointer_are_not_reprocessed():
    transcript = [entry(10), entry(10.05), entry(10.2)]
    chunk = select_chunk(transcript, last_time=30, consumed_until=10)
    assert [c["start"] for c in chunk] == [10.2]


def test_no_new_chunk_when_playhead_is_behind_pointer():
    assert select_chunk([entry(1), entry(2)], last_time=1, consumed_until=5) == []


def test_empty_transcript():
    assert select_chunk([], last_time=10, consumed_until=0) == []


def test_seek_backward_boundaries():
    assert is_seek_backward(last_time=10, consumed_until=13.0) is False
    assert is_seek_backward(last_time=10, consumed_until=13.1) is True
    assert is_seek_backward(last_time=100, consumed_until=100) is False


def test_chunk_time_range_uses_start_and_end():
    chunk = [entry(10, duration=2.5), entry(20, duration=1)]
    assert chunk_time_range(chunk) == (10.0, 21.0)


def test_entries_with_missing_fields_are_tolerated():
    chunk = [{"text": "no timing"}, entry(2, duration=None)]
    assert select_chunk(chunk, last_time=5, consumed_until=0) == [entry(2, duration=None)]
    assert chunk_time_range([entry(2, duration=None)]) == (2.0, 2.0)
