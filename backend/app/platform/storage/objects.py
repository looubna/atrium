"""Bucket access behind a small async interface.

Deployed environments use Cloud Storage. Local development and tests use a
directory on disk, so the live gateway and pipeline run without Google Cloud.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import shutil
from pathlib import Path
from typing import Protocol

from google.api_core.exceptions import NotFound as GcsNotFound
from google.api_core.exceptions import PreconditionFailed as GcsPreconditionFailed

from app.core.settings import Env, get_settings
from app.platform.clients import clients

#: Recordings can be hundreds of megabytes; the client library's 60 s default is too short.
LARGE_TRANSFER_TIMEOUT_S = 900


class ObjectExists(Exception):
    """Raised when a create-only write finds an existing object."""


class ObjectStore(Protocol):
    bucket: str

    async def write(self, name: str, data: bytes, content_type: str, *, create_only: bool = False) -> None: ...

    async def read(self, name: str) -> bytes: ...

    async def exists(self, name: str) -> bool: ...

    async def list(self, prefix: str) -> list[str]: ...

    async def delete_prefix(self, prefix: str) -> int: ...

    async def delete(self, name: str) -> None:
        """Remove one object; one that is already gone is not an error."""
        ...

    async def size(self, name: str) -> int | None:
        """Object size in bytes, or None when it doesn't exist."""
        ...

    async def download_to(self, name: str, path: Path) -> None: ...

    async def upload_file(self, path: Path, name: str, content_type: str) -> None: ...


class GcsObjectStore:
    def __init__(self, bucket: str) -> None:
        self.bucket = bucket

    def _blob(self, name: str):  # type: ignore[no-untyped-def]
        return clients.storage().bucket(self.bucket).blob(name)

    async def write(self, name: str, data: bytes, content_type: str, *, create_only: bool = False) -> None:
        def upload() -> None:
            try:
                self._blob(name).upload_from_string(
                    data, content_type=content_type, if_generation_match=0 if create_only else None
                )
            except GcsPreconditionFailed as exc:
                raise ObjectExists(name) from exc

        await asyncio.to_thread(upload)

    async def read(self, name: str) -> bytes:
        def download() -> bytes:
            try:
                return bytes(self._blob(name).download_as_bytes())
            except GcsNotFound as exc:
                raise FileNotFoundError(name) from exc

        return await asyncio.to_thread(download)

    async def exists(self, name: str) -> bool:
        return bool(await asyncio.to_thread(self._blob(name).exists))

    async def list(self, prefix: str) -> list[str]:
        def names() -> list[str]:
            return sorted(b.name for b in clients.storage().list_blobs(self.bucket, prefix=prefix))

        return await asyncio.to_thread(names)

    async def delete_prefix(self, prefix: str) -> int:
        if not prefix.endswith("/") and "/" not in prefix:
            raise ValueError("refusing to delete an unscoped prefix")

        def delete() -> int:
            blobs = list(clients.storage().list_blobs(self.bucket, prefix=prefix))
            bucket = clients.storage().bucket(self.bucket)
            for start in range(0, len(blobs), 100):
                bucket.delete_blobs(blobs[start : start + 100], on_error=lambda _blob: None)
            return len(blobs)

        return await asyncio.to_thread(delete)

    async def delete(self, name: str) -> None:
        def remove() -> None:
            with contextlib.suppress(GcsNotFound):
                self._blob(name).delete()

        await asyncio.to_thread(remove)

    async def size(self, name: str) -> int | None:
        def stat() -> int | None:
            blob = clients.storage().bucket(self.bucket).get_blob(name)
            return None if blob is None else int(blob.size or 0)

        return await asyncio.to_thread(stat)

    async def download_to(self, name: str, path: Path) -> None:
        def download() -> None:
            try:
                self._blob(name).download_to_filename(str(path), timeout=LARGE_TRANSFER_TIMEOUT_S)
            except GcsNotFound as exc:
                raise FileNotFoundError(name) from exc

        await asyncio.to_thread(download)

    async def upload_file(self, path: Path, name: str, content_type: str) -> None:
        def upload() -> None:
            self._blob(name).upload_from_filename(
                str(path), content_type=content_type, timeout=LARGE_TRANSFER_TIMEOUT_S
            )

        await asyncio.to_thread(upload)


class LocalObjectStore:
    """Filesystem store for local development and tests. Rejects path traversal."""

    def __init__(self, bucket: str, root: Path) -> None:
        self.bucket = bucket
        self.root = (root / bucket).resolve()

    def _path(self, name: str) -> Path:
        path = (self.root / name).resolve()
        if self.root not in path.parents:
            raise ValueError("object name escapes the bucket")
        return path

    async def write(self, name: str, data: bytes, content_type: str, *, create_only: bool = False) -> None:
        path = self._path(name)

        def save() -> None:
            path.parent.mkdir(parents=True, exist_ok=True)
            flags = os.O_WRONLY | os.O_CREAT | (os.O_EXCL if create_only else os.O_TRUNC)
            try:
                fd = os.open(path, flags, 0o600)
            except FileExistsError as exc:
                raise ObjectExists(name) from exc
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)

        await asyncio.to_thread(save)

    async def read(self, name: str) -> bytes:
        return await asyncio.to_thread(self._path(name).read_bytes)

    async def exists(self, name: str) -> bool:
        return self._path(name).is_file()

    async def list(self, prefix: str) -> list[str]:
        def names() -> list[str]:
            if not self.root.exists():
                return []
            found = (str(p.relative_to(self.root)) for p in self.root.rglob("*") if p.is_file())
            return sorted(n for n in found if n.startswith(prefix))

        return await asyncio.to_thread(names)

    async def delete_prefix(self, prefix: str) -> int:
        names = await self.list(prefix)
        for name in names:
            self._path(name).unlink(missing_ok=True)
        return len(names)

    async def delete(self, name: str) -> None:
        self._path(name).unlink(missing_ok=True)

    async def size(self, name: str) -> int | None:
        path = self._path(name)

        def stat() -> int | None:
            return path.stat().st_size if path.is_file() else None

        return await asyncio.to_thread(stat)

    async def download_to(self, name: str, path: Path) -> None:
        await asyncio.to_thread(shutil.copyfile, self._path(name), path)

    async def upload_file(self, path: Path, name: str, content_type: str) -> None:
        target = self._path(name)

        def copy() -> None:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)

        await asyncio.to_thread(copy)

    def local_path(self, name: str) -> Path:
        """Filesystem path of an object (local development only)."""
        return self._path(name)


def object_store(bucket: str) -> ObjectStore:
    override = clients.overrides.get(f"objects:{bucket}")
    if override is not None:
        return override  # type: ignore[no-any-return]
    settings = get_settings()
    if settings.app_env in (Env.LOCAL, Env.TEST):
        root = Path(os.environ.get("LOCAL_OBJECTS_DIR", ".local-objects"))
        return LocalObjectStore(bucket, root)
    return GcsObjectStore(bucket)


def user_content() -> ObjectStore:
    return object_store(get_settings().user_content_bucket)


def processing() -> ObjectStore:
    return object_store(get_settings().processing_bucket)
