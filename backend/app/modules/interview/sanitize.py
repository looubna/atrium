"""Cleaning untrusted text before it reaches a model prompt.

Resumes, job descriptions, web research and user edits can contain text that
looks like instructions. Everything passed to an agent is length-capped,
stripped of control characters and URLs, has instruction-like lines removed,
and is wrapped in labelled data tags that the instructions declare inert.
"""

from __future__ import annotations

import re
import unicodedata

_URL = re.compile(r"(?i)\b(?:https?://|www\.)\S+")
_INSTRUCTION_LIKE = re.compile(
    r"(?i)\b("
    r"ignore (all |any |the )?(previous|prior|above)|disregard (all |the )?(previous|prior|above)|"
    r"you are now|act as|new instructions?|system prompt|developer message|"
    r"reveal (the |your )?(prompt|instructions|rubric)|jailbreak|end_interview"
    r")\b"
)
_TAG = re.compile(r"</?\s*[a-zA-Z_][\w-]*\s*>")


def clean_text(value: str | None, max_chars: int) -> str:
    if not value:
        return ""
    text = unicodedata.normalize("NFKC", value)
    text = "".join(ch for ch in text if ch in "\n\t" or not unicodedata.category(ch).startswith("C"))
    text = _URL.sub("[link]", text)
    text = _TAG.sub(" ", text)
    lines = [line for line in text.splitlines() if not _INSTRUCTION_LIKE.search(line)]
    text = "\n".join(re.sub(r"[ \t]+", " ", line).strip() for line in lines)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text[:max_chars]


def clean_phrase(value: str | None, max_chars: int = 160) -> str:
    """Single-line field (titles, focus areas, question families)."""
    return " ".join(clean_text(value, max_chars * 2).split())[:max_chars]


def clean_list(values: list[str] | None, *, max_items: int, max_chars: int = 160) -> list[str]:
    out: list[str] = []
    for value in values or []:
        phrase = clean_phrase(value, max_chars)
        if phrase and phrase not in out:
            out.append(phrase)
        if len(out) >= max_items:
            break
    return out


def data_block(tag: str, content: str) -> str:
    if not re.fullmatch(r"[a-z_]{2,32}", tag):
        raise ValueError("invalid tag")
    return f"<{tag}>\n{content}\n</{tag}>" if content else ""
