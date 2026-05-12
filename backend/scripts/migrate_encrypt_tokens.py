"""
One-shot migration: encrypt any legacy plaintext github_access_token
values in the users table.

Run once after deploying the encryption-at-rest change. Safe to run again —
already-encrypted tokens are skipped (they start with the Fernet version
byte and won't match the plaintext-token heuristic).

Usage:
    docker compose exec api python -m scripts.migrate_encrypt_tokens
"""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy import select

from app.core.crypto import encrypt_token
from app.core.database import async_session_maker
from app.models.user import User

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("migrate")


async def main() -> None:
    encrypted = 0
    skipped = 0
    async with async_session_maker() as db:
        result = await db.execute(select(User).where(User.github_access_token.is_not(None)))
        users = result.scalars().all()
        log.info("Found %d users with stored GitHub tokens", len(users))

        for user in users:
            token = user.github_access_token or ""
            if token.startswith("gAAAAA"):
                # Already encrypted (Fernet version byte → "gAAAAA" prefix)
                skipped += 1
                continue
            user.github_access_token = encrypt_token(token)
            encrypted += 1

        await db.commit()

    log.info("Done. Encrypted=%d  Skipped (already encrypted)=%d", encrypted, skipped)


if __name__ == "__main__":
    asyncio.run(main())
