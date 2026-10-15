"""Delete the camera videos recorded before a date (by default: all of them so far).

    cd backend
    uv run --env-file .env.local python -m scripts.delete_old_videos               # dry run: counts only
    uv run --env-file .env.local python -m scripts.delete_old_videos --apply       # deletes
    # The cloud project: the same, with GOOGLE_CLOUD_PROJECT set and no FIRESTORE_EMULATOR_HOST.

Only the video goes: the `video-*` objects under each session, and the session's `media.video`
(so the feedback player falls back to audio only). Audio, transcripts, feedback and face or body
numbers stay. The bucket's soft delete keeps deleted objects recoverable for 7 days.
"""

from __future__ import annotations

import argparse
import asyncio
from datetime import UTC, datetime

from app.platform.clients import clients
from app.platform.storage.objects import user_content
from app.platform.storage.paths import StoragePaths


async def main(before: datetime, apply: bool) -> None:
    db, store = clients.firestore(), user_content()
    sessions = objects = 0
    async for user in db.collection("users").stream():
        async for snap in user.reference.collection("sessions").stream():
            data = snap.to_dict() or {}
            created = data.get("createdAt")
            if not (data.get("media") or {}).get("video") or (created and created >= before):
                continue
            names = [n for n in await store.list(StoragePaths(user.id).session_prefix(snap.id)) if "/video-" in n]
            sessions += 1
            objects += len(names)
            if apply:
                for name in names:
                    await store.delete(name)
                await snap.reference.update({"media.video": None, "media.videoDeletedAt": datetime.now(UTC)})
    verb = "Deleted" if apply else "Would delete"
    print(f"{verb} {objects} video files from {sessions} sessions recorded before {before.isoformat()}.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--before", type=datetime.fromisoformat, default=datetime.now(UTC),
                        help="ISO date-time; sessions created before it lose their video (default: now)")
    parser.add_argument("--apply", action="store_true", help="delete; without it, only count")
    args = parser.parse_args()
    before = args.before if args.before.tzinfo else args.before.replace(tzinfo=UTC)
    asyncio.run(main(before, args.apply))
