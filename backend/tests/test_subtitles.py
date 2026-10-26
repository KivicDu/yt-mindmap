from subtitles import parse_vtt_or_srt

SRT = """1
00:00:01,500 --> 00:00:03,000
Hello world

2
00:00:03,000 --> 00:00:05,250
Second line
continues here
"""

VTT = """WEBVTT

00:01.000 --> 00:02.500 align:start position:0%
Hello from VTT

00:00:05.000 --> 00:00:06.000
Second cue
"""


def test_parses_srt_with_comma_milliseconds():
    entries = parse_vtt_or_srt(SRT)
    assert entries == [
        {"start": 1.5, "duration": 1.5, "text": "Hello world"},
        {"start": 3.0, "duration": 2.25, "text": "Second line continues here"},
    ]


def test_parses_vtt_header_cue_settings_and_short_timestamps():
    entries = parse_vtt_or_srt(VTT)
    assert entries == [
        {"start": 1.0, "duration": 1.5, "text": "Hello from VTT"},
        {"start": 5.0, "duration": 1.0, "text": "Second cue"},
    ]


def test_parses_hour_timestamps():
    content = "00:01:02,000 --> 00:01:05,500\nLong lecture\n"
    entries = parse_vtt_or_srt(content)
    assert entries[0]["start"] == 62.0
    assert entries[0]["duration"] == 3.5


def test_skips_note_and_style_blocks():
    content = """WEBVTT

NOTE this is a comment

STYLE
::cue { color: gold }

00:00:01.000 --> 00:00:02.000
Real cue
"""
    assert parse_vtt_or_srt(content) == [
        {"start": 1.0, "duration": 1.0, "text": "Real cue"}
    ]


def test_malformed_cue_is_skipped_without_failing_upload():
    content = """00:00:bad --> 00:00:02.000
Garbage timing

00:00:03.000 --> 00:00:04.000
Valid cue
"""
    assert parse_vtt_or_srt(content) == [
        {"start": 3.0, "duration": 1.0, "text": "Valid cue"}
    ]


def test_empty_and_cue_only_text_is_ignored():
    assert parse_vtt_or_srt("") == []
    assert parse_vtt_or_srt("00:00:01.000 --> 00:00:02.000\n\n") == []


def test_negative_duration_is_clamped_to_zero():
    content = "00:00:05,000 --> 00:00:04,000\nOut of order\n"
    assert parse_vtt_or_srt(content)[0]["duration"] == 0.0
