"""Reading a JSON object while a model is still writing it.

Structured output streams as JSON text. These helpers pull out the parts that
are already complete — a top-level string, or the finished objects of a
top-level array — from any prefix of that text, so progress can be shown before
the whole response (and its validation) is done. Anything incomplete is simply
not returned yet; nothing here is trusted as final output.
"""

from __future__ import annotations

import json
from typing import Any

_WHITESPACE = " \t\r\n"


def _skip_whitespace(text: str, index: int) -> int:
    while index < len(text) and text[index] in _WHITESPACE:
        index += 1
    return index


def _string_end(text: str, start: int) -> int | None:
    """Index of the closing quote of the string opening at `start`, or None if it isn't finished."""
    escaped = False
    for index in range(start + 1, len(text)):
        char = text[index]
        if escaped:
            escaped = False
        elif char == "\\":
            escaped = True
        elif char == '"':
            return index
    return None


def _top_level_value_start(text: str, key: str) -> int | None:
    """Where the value of `key` in the outermost object begins, once that much has been written."""
    depth = 0
    index = 0
    while index < len(text):
        char = text[index]
        if char == '"':
            end = _string_end(text, index)
            if end is None:
                return None
            if depth == 1:
                after = _skip_whitespace(text, end + 1)
                if after < len(text) and text[after] == ":" and json.loads(text[index : end + 1]) == key:
                    value = _skip_whitespace(text, after + 1)
                    return value if value < len(text) else None
            index = end + 1
            continue
        if char in "{[":
            depth += 1
        elif char in "}]":
            depth -= 1
        index += 1
    return None


def completed_string(text: str, key: str) -> str | None:
    """The top-level string value of `key`, once its closing quote has arrived."""
    start = _top_level_value_start(text, key)
    if start is None or text[start] != '"':
        return None
    end = _string_end(text, start)
    if end is None:
        return None
    value = json.loads(text[start : end + 1])
    return value if isinstance(value, str) else None


def completed_array_objects(text: str, key: str) -> list[dict[str, Any]]:
    """The objects of the top-level array `key` that are completely written, in order."""
    start = _top_level_value_start(text, key)
    if start is None or text[start] != "[":
        return []
    items: list[dict[str, Any]] = []
    depth = 0
    item_start: int | None = None
    index = start + 1
    while index < len(text):
        char = text[index]
        if char == '"':
            end = _string_end(text, index)
            if end is None:
                break
            index = end + 1
            continue
        if char in "{[":
            if depth == 0 and char == "{":
                item_start = index
            depth += 1
        elif char in "}]":
            if depth == 0:
                break  # the array itself closed
            depth -= 1
            if depth == 0 and item_start is not None:
                try:
                    item = json.loads(text[item_start : index + 1])
                except json.JSONDecodeError:
                    item = None
                if isinstance(item, dict):
                    items.append(item)
                item_start = None
        index += 1
    return items
