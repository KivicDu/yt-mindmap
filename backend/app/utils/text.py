"""Text helpers shared by search and tag handling.

Vietnamese users routinely type without diacritics ("tong quan" for "tổng
quan"), so every searchable string is stored accent-stripped. The same helper
is used when normalizing the query, which keeps the comparison symmetric.
"""

import unicodedata


def strip_accents(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value)
    without_marks = "".join(
        char for char in decomposed if unicodedata.category(char) != "Mn"
    )
    # Vietnamese đ/Đ does not decompose into d + mark.
    return without_marks.replace("đ", "d").replace("Đ", "D")


def normalize_search_text(value: str) -> str:
    return " ".join(strip_accents(value).lower().split())


def normalize_tag(value: str) -> str | None:
    """Tags are lower-case, single-line and bounded; empty input is dropped."""
    tag = normalize_search_text(value)[:32].strip()
    return tag or None
