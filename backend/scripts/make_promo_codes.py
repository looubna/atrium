"""Create one-time promo codes that unlock a paid plan for some days (for the Shipaton judges).

    cd backend
    uv run --env-file .env.local python -m scripts.make_promo_codes --count 10   # local emulator
    # The cloud project: the same, with GOOGLE_CLOUD_PROJECT=atrium-coach-dev and no FIRESTORE_EMULATOR_HOST.

Each code is a `promoCodes/{code}` document: {plan, days, redeemBy, createdAt}; `POST /billing/redeem`
marks it used by the first account that enters it, until `redeemBy` (--valid-days from now). The codes are printed, one per line, to paste into Devpost.
"""

from __future__ import annotations

import argparse
import asyncio
import secrets
from datetime import UTC, datetime, timedelta

from google.cloud import firestore

from app.platform.billing import PROMO_COLLECTION
from app.platform.clients import clients
from app.platform.plans import PAID_PLANS

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O or 1/I to misread


async def main(count: int, plan: str, days: int, prefix: str, valid_days: int) -> None:
    db = clients.firestore()
    redeem_by = datetime.now(UTC) + timedelta(days=valid_days)
    for _ in range(count):
        code = f"{prefix}-{''.join(secrets.choice(ALPHABET) for _ in range(6))}"
        await db.collection(PROMO_COLLECTION).document(code).create(
            {"plan": plan, "days": days, "redeemBy": redeem_by, "createdAt": firestore.SERVER_TIMESTAMP})
        print(code)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--count", type=int, default=10)
    parser.add_argument("--plan", choices=[p.value for p in PAID_PLANS], default="pro")
    parser.add_argument("--days", type=int, default=14)
    parser.add_argument("--prefix", default="SHIPATON")
    parser.add_argument("--valid-days", type=int, default=60, help="days the code can still be entered")
    args = parser.parse_args()
    asyncio.run(main(args.count, args.plan, args.days, args.prefix, args.valid_days))
