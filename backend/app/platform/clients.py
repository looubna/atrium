"""Process-wide Google Cloud clients, created lazily and reused.

Tests replace these through `clients.overrides`. The Firestore and Auth
emulators are picked up automatically from FIRESTORE_EMULATOR_HOST and
FIREBASE_AUTH_EMULATOR_HOST.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any, cast

import firebase_admin
from google.cloud.firestore import AsyncClient as FirestoreClient
from google.cloud.storage import Client as StorageClient
from google.cloud.tasks_v2 import CloudTasksAsyncClient

from app.core.settings import get_settings


@dataclass
class Clients:
    overrides: dict[str, Any] = field(default_factory=dict)

    def firebase_app(self) -> firebase_admin.App:
        try:
            return firebase_admin.get_app()
        except ValueError:
            settings = get_settings()
            return firebase_admin.initialize_app(options={"projectId": settings.google_cloud_project})

    def firestore(self) -> FirestoreClient:
        if "firestore" in self.overrides:
            return cast(FirestoreClient, self.overrides["firestore"])
        return _firestore(get_settings().google_cloud_project)

    def storage(self) -> StorageClient:
        if "storage" in self.overrides:
            return cast(StorageClient, self.overrides["storage"])
        return _storage(get_settings().google_cloud_project)

    def tasks(self) -> CloudTasksAsyncClient:
        if "tasks" in self.overrides:
            return cast(CloudTasksAsyncClient, self.overrides["tasks"])
        return _tasks()


@lru_cache(maxsize=1)
def _firestore(project: str) -> FirestoreClient:
    return FirestoreClient(project=project)


@lru_cache(maxsize=1)
def _storage(project: str) -> StorageClient:
    return StorageClient(project=project)


@lru_cache(maxsize=1)
def _tasks() -> CloudTasksAsyncClient:
    return CloudTasksAsyncClient()


clients = Clients()
