"""The script that deletes old camera videos: dry run by default, video only, older sessions only."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from google.cloud import firestore

from app.platform.storage.objects import user_content
from app.platform.storage.paths import StoragePaths
from scripts.delete_old_videos import main


async def test_old_videos_go_and_everything_else_stays(
    db: firestore.AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("LOCAL_OBJECTS_DIR", str(tmp_path))
    store, paths, now = user_content(), StoragePaths("dora"), datetime.now(UTC)
    await db.document("users/dora").set({"plan": "free"})
    for sid, age in (("sessold00001", timedelta(days=3)), ("sessnew00001", timedelta(days=-1))):
        await db.document(f"users/dora/sessions/{sid}").set(
            {"createdAt": now - age, "media": {"video": {"state": "ready"}, "audioPath": "a"}})
        await store.write(f"{paths.session_prefix(sid)}video-1.mp4", b"v", "video/mp4")
        await store.write(f"{paths.session_prefix(sid)}audio.m4a", b"a", "audio/mp4")

    await main(now, apply=False)
    assert "Would delete 1 video files from 1 sessions" in capsys.readouterr().out
    assert len(await store.list(paths.session_prefix("sessold00001"))) == 2

    await main(now, apply=True)
    old_prefix = paths.session_prefix("sessold00001")
    assert await store.list(old_prefix) == [f"{old_prefix}audio.m4a"]
    assert len(await store.list(paths.session_prefix("sessnew00001"))) == 2
    old = (await db.document("users/dora/sessions/sessold00001").get()).to_dict() or {}
    assert old["media"]["video"] is None and old["media"]["audioPath"] == "a"
    new = (await db.document("users/dora/sessions/sessnew00001").get()).to_dict() or {}
    assert new["media"]["video"] == {"state": "ready"}
