"""Study material files: type detection by content, bounded text extraction.

Whatever the professor handed out is untrusted input. The file type is decided
by the bytes (never the name or the declared content type), extraction is capped
in pages, slides and characters, encrypted PDFs are refused, and only plain text
leaves this module. Images are kept as they are: the analyst reads them itself.
"""

from __future__ import annotations

import io
import re
import xml.etree.ElementTree as ET
import zipfile
from typing import Literal

MaterialKind = Literal["pdf", "docx", "pptx", "txt", "md", "png", "jpeg", "webp"]

#: Page/slide caps. A textbook chapter or a term's slides is the realistic upper end.
MAX_PAGES = 120
MAX_SLIDES = 300
MAX_TEXT_CHARS = 120_000
#: Below this a document carries no usable content (a scan, or an empty export).
MIN_TEXT_CHARS = 120

CONTENT_TYPES: dict[str, str] = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "txt": "text/plain",
    "md": "text/markdown",
    "png": "image/png",
    "jpeg": "image/jpeg",
    "webp": "image/webp",
}

IMAGE_KINDS: frozenset[str] = frozenset({"png", "jpeg", "webp"})
#: Extensions used for stored objects; the kind is the extension except for JPEG.
EXTENSIONS: dict[str, str] = {**{k: k for k in CONTENT_TYPES}, "jpeg": "jpg"}

_OOXML_MARKERS: list[tuple[str, MaterialKind]] = [
    ("word/document.xml", "docx"),
    ("ppt/presentation.xml", "pptx"),
]
_DRAWING_TEXT = "{http://schemas.openxmlformats.org/drawingml/2006/main}t"
_SLIDE_NAME = re.compile(r"^ppt/slides/slide(\d+)\.xml$")


class UnsupportedMaterial(ValueError):
    """The file isn't a readable document or a supported image."""


def detect_kind(filename: str, data: bytes) -> MaterialKind:
    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if data.startswith(b"%PDF-"):
        return "pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data.startswith(b"PK\x03\x04"):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                names = set(archive.namelist())
        except zipfile.BadZipFile:
            raise UnsupportedMaterial("unsupported archive") from None
        for marker, kind in _OOXML_MARKERS:
            if marker in names:
                return kind
        raise UnsupportedMaterial("unsupported Office file")
    if b"\x00" in data[:4096]:
        raise UnsupportedMaterial("binary file")
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        raise UnsupportedMaterial("text must be UTF-8") from None
    return "md" if extension == "md" else "txt"


def normalize(text: str, max_chars: int = MAX_TEXT_CHARS) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t\f\v]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()[:max_chars]


def _pdf_text(data: bytes) -> str:
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise UnsupportedMaterial("encrypted PDF")
        parts: list[str] = []
        for number, page in enumerate(reader.pages[:MAX_PAGES], start=1):
            parts.append(f"\n[page {number}]\n{page.extract_text() or ''}")
            if sum(len(p) for p in parts) > MAX_TEXT_CHARS:
                break
    except PdfReadError as exc:
        raise UnsupportedMaterial("unreadable PDF") from exc
    return "".join(parts)


def _docx_text(data: bytes) -> str:
    import docx

    try:
        document = docx.Document(io.BytesIO(data))
    except Exception as exc:  # python-docx raises several unrelated types for corrupt files
        raise UnsupportedMaterial("unreadable DOCX") from exc
    lines = [p.text for p in document.paragraphs]
    for table in document.tables:
        for row in table.rows:
            lines.append(" | ".join(cell.text for cell in row.cells))
    return "\n".join(lines)


def _pptx_text(data: bytes) -> str:
    """Slide text straight from the OOXML, so no extra dependency is needed for decks."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            slides = sorted(
                (name for name in archive.namelist() if _SLIDE_NAME.match(name)),
                key=lambda name: int(_SLIDE_NAME.match(name).group(1)),  # type: ignore[union-attr]
            )[:MAX_SLIDES]
            parts: list[str] = []
            for number, name in enumerate(slides, start=1):
                try:
                    root = ET.fromstring(archive.read(name))  # noqa: S314 - OOXML from the user's own upload
                except ET.ParseError:
                    continue
                runs = [node.text or "" for node in root.iter(_DRAWING_TEXT)]
                parts.append(f"\n[slide {number}]\n" + "\n".join(r for r in runs if r.strip()))
                if sum(len(p) for p in parts) > MAX_TEXT_CHARS:
                    break
    except zipfile.BadZipFile as exc:
        raise UnsupportedMaterial("unreadable PPTX") from exc
    return "".join(parts)


def extract_text(kind: MaterialKind, data: bytes) -> str:
    """Readable text, or `UnsupportedMaterial` when there is none (images have no text here)."""
    if kind in IMAGE_KINDS:
        raise UnsupportedMaterial("image")
    if kind == "pdf":
        text = _pdf_text(data)
    elif kind == "docx":
        text = _docx_text(data)
    elif kind == "pptx":
        text = _pptx_text(data)
    else:
        text = data.decode("utf-8")

    text = normalize(text)
    if len(text) < MIN_TEXT_CHARS:
        raise UnsupportedMaterial("no readable text (scanned pages are read as images instead)")
    return text


#: Cheap, deterministic signals, used only for the "what you added" line shown the moment a file
#: finishes reading. The analyst replaces every guess with its own reading of the content.
_SIGNALS: list[tuple[str, tuple[str, ...]]] = [
    ("syllabus", ("syllabus", "course outline", "module handbook", "course description", "learning outcomes")),
    ("past_exam", ("past exam", "previous exam", "exam paper", "examination paper", "past paper", "final exam",
                   "midterm", "mock exam", "klausur", "examen")),
    ("problem_set", ("problem set", "exercise sheet", "exercises", "tutorial sheet", "homework", "worksheet")),
    ("lecture_slides", ("lecture", "slides", "deck", "week ", "vorlesung", "cours ")),
    ("textbook", ("chapter", "textbook", "section 1.", "isbn")),
    ("personal_notes", ("my notes", "notes", "summary", "cheat sheet", "zusammenfassung")),
]


def guess_type(file_name: str, text: str) -> str:
    """A first, provisional guess at what a material is, from its name and opening text."""
    # File names separate words with underscores and dashes as often as spaces.
    name = re.sub(r"[^a-z0-9]+", " ", file_name.lower())
    haystack = f"{name}\n{text[:2_000].lower()}"
    for material_type, words in _SIGNALS:
        if any(word in name for word in words):
            return material_type
    for material_type, words in _SIGNALS:
        if any(word in haystack for word in words):
            return material_type
    # A deck's extracted text is slide-marked; that alone identifies it.
    return "lecture_slides" if "[slide 1]" in text[:400].lower() else "other"
