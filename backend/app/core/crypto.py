"""
Symmetric encryption helpers for sensitive tokens stored at rest.

Right now this is used for `users.github_access_token` — but the API is
generic so other secrets (Stripe customer access tokens, Slack bot tokens,
etc.) can use the same pair as we add them.

Why Fernet:
  - Already pulled in transitively via `python-jose[cryptography]`, so no
    new dependency.
  - Authenticated encryption (AES-128-CBC + HMAC-SHA256). A tampered
    ciphertext fails decryption rather than producing garbage output.
  - Built-in key rotation via MultiFernet — see `decrypt_token` notes.

Key management:
  - The key lives in settings.ENCRYPTION_KEY (env var).
  - Generate one with: `openssl rand -base64 32`
  - Production startup refuses to boot without it (see main.py).
  - Rotating: prepend a new key to ENCRYPTION_KEY_ROTATION (comma-separated)
    to decrypt old ciphertexts while encrypting new ones with the new key.
    Re-save records over time to migrate.

If you ever move to a managed KMS (AWS KMS, GCP KMS), swap the
implementation here — call sites won't change.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from app.core.config import settings

log = logging.getLogger("repoinsight.crypto")


@lru_cache(maxsize=1)
def _cipher() -> MultiFernet:
    """
    Build a MultiFernet from the primary key plus any rotation keys.
    Decryption tries each key in order; encryption uses the first.

    Cached for the lifetime of the process — Fernet instances are
    cheap but no point rebuilding them per call.
    """
    primary = settings.ENCRYPTION_KEY.strip()
    if not primary:
        # We're in dev with no key configured. Allow startup, but anyone
        # calling encrypt/decrypt will get a clear error.
        raise RuntimeError(
            "ENCRYPTION_KEY is not set. Generate one with: openssl rand -base64 32"
        )

    keys = [Fernet(primary.encode())]
    rotation = (settings.ENCRYPTION_KEY_ROTATION or "").strip()
    if rotation:
        for k in rotation.split(","):
            k = k.strip()
            if k:
                keys.append(Fernet(k.encode()))
    return MultiFernet(keys)


def encrypt_token(plain: Optional[str]) -> Optional[str]:
    """Encrypt a plaintext token for storage. Returns None for None/empty input."""
    if not plain:
        return None
    return _cipher().encrypt(plain.encode("utf-8")).decode("utf-8")


def decrypt_token(stored: Optional[str]) -> Optional[str]:
    """
    Decrypt a previously-encrypted token. Returns None for None/empty input.

    During the migration from plaintext storage to encrypted storage, the
    DB will contain a mix of formats. Encrypted Fernet tokens always start
    with "gAAAAA" (the version byte 0x80 base64-url encoded). Plain GitHub
    tokens start with "gho_", "ghp_", "github_pat_", etc. We detect this
    and pass plaintext through unchanged — old rows keep working until
    they're re-saved by a future OAuth refresh, which will encrypt them.

    Once you're confident all rows are encrypted (or after running the
    one-shot migration script), you can delete the fallback branch.
    """
    if not stored:
        return None
    # Heuristic: real Fernet ciphertext is base64-url and starts with the
    # version byte. GitHub PATs all use known prefixes that wouldn't collide.
    if not stored.startswith("gAAAAA"):
        # Looks like a legacy plaintext token. Log once per process so
        # we know migration is still in flight, then pass through.
        _log_legacy_token_once()
        return stored
    try:
        return _cipher().decrypt(stored.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        # Either the ciphertext was tampered with, or — more commonly —
        # the encryption key was rotated and the old key is no longer in
        # ENCRYPTION_KEY_ROTATION. Surface as None so callers can prompt
        # the user to re-authenticate instead of erroring out the request.
        log.warning("Failed to decrypt stored token — key rotation issue or tampered ciphertext")
        return None


_legacy_warned = False


def _log_legacy_token_once() -> None:
    global _legacy_warned
    if not _legacy_warned:
        log.info(
            "Found legacy plaintext token in DB — will encrypt on next OAuth refresh. "
            "Run scripts/migrate_encrypt_tokens.py to backfill all rows."
        )
        _legacy_warned = True


def get_github_token(user) -> Optional[str]:
    """
    Return the user's plaintext GitHub token, or None if they don't have one.

    Use this everywhere instead of accessing `user.github_access_token`
    directly. Centralizing the decrypt call here means:
      - One place to swap the encryption implementation later
      - One place to log access patterns if you ever want token-use auditing
      - No risk of a caller forgetting to decrypt and sending ciphertext to
        GitHub (which would 401)
    """
    return decrypt_token(getattr(user, "github_access_token", None))
