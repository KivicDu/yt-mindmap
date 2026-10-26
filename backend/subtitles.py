"""Subtitle file parsing for the upload fallback (.srt / .vtt)."""

from typing import Any


def _to_seconds(timestamp: str) -> float:
    """Parse `hh:mm:ss.mmm`, `mm:ss.mmm` or a bare number into seconds."""
    components = timestamp.split(":")
    if len(components) == 3:
        hours, minutes, seconds = components
    elif len(components) == 2:
        hours, minutes, seconds = 0, components[0], components[1]
    else:
        return float(timestamp)
    return float(hours) * 3600 + float(minutes) * 60 + float(seconds)


def parse_vtt_or_srt(content: str) -> list[dict[str, Any]]:
    """Convert WebVTT or SubRip text into transcript entries.

    Only cue headers (`start --> end`) and their text lines matter; numeric
    indices, `WEBVTT` headers, `NOTE` blocks and styling tags are skipped.
    """
    lines = content.splitlines()
    entries: list[dict[str, Any]] = []
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if "-->" in line:
            try:
                parts = line.split("-->")
                start = parts[0].strip().replace(",", ".")
                end = (
                    parts[1].strip().split()[0].replace(",", ".")
                    if len(parts) > 1
                    else start
                )
                start_seconds = _to_seconds(start)
                end_seconds = _to_seconds(end)
                i += 1
                text_parts = []
                while i < len(lines) and lines[i].strip():
                    text_parts.append(lines[i].strip())
                    i += 1
                text = " ".join(text_parts)
                if text:
                    entries.append(
                        {
                            "start": start_seconds,
                            "duration": max(0.0, end_seconds - start_seconds),
                            "text": text,
                        }
                    )
            except (ValueError, IndexError):
                # Malformed cue: skip it instead of failing the whole upload.
                pass
        i += 1
    return entries
