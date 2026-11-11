"""Security primitives: password hashing, tokens, secret encryption and TOTP.

Everything here is stateless and free of I/O, so it is easy to test in isolation.
"""

import asyncio
import hashlib
import hmac
import re
import secrets
from collections.abc import Iterable
from datetime import datetime

import pyotp
from argon2 import PasswordHasher, Type
from argon2.exceptions import InvalidHashError, VerificationError
from cryptography.fernet import Fernet, InvalidToken, MultiFernet

# --- Passwords ----------------------------------------------------------------


class PasswordService:
    """Argon2id hashing. Hashing is CPU-bound, so the async methods run in a worker thread."""

    def __init__(self, *, time_cost: int, memory_kib: int, parallelism: int) -> None:
        self._hasher = PasswordHasher(
            time_cost=time_cost,
            memory_cost=memory_kib,
            parallelism=parallelism,
            type=Type.ID,
        )
        # Verified against when the account does not exist, so that "unknown email" and
        # "wrong password" cost the same time.
        self._decoy = self._hasher.hash(secrets.token_urlsafe(24))

    def hash(self, password: str) -> str:
        return self._hasher.hash(password)

    def verify(self, stored_hash: str, password: str) -> bool:
        try:
            return self._hasher.verify(stored_hash, password)
        except (VerificationError, InvalidHashError):
            return False

    def needs_rehash(self, stored_hash: str) -> bool:
        return self._hasher.check_needs_rehash(stored_hash)

    async def hash_async(self, password: str) -> str:
        return await asyncio.to_thread(self.hash, password)

    async def verify_async(self, stored_hash: str | None, password: str) -> bool:
        """Verify ``password``; a missing hash is checked against the decoy and always fails."""
        if stored_hash is None:
            await asyncio.to_thread(self.verify, self._decoy, password)
            return False
        return await asyncio.to_thread(self.verify, stored_hash, password)


_COMMON_PASSWORDS = frozenset(
    {
        "password1234", "password12345", "123456789012", "qwertyuiop12", "qwerty123456",
        "administrator", "adminadmin12", "letmein12345", "welcome12345", "iloveyou1234",
        "changeme1234", "passw0rd1234", "p@ssword1234", "vyrion123456", "vyrncore12345",
    }
)  # fmt: skip


def password_problems(
    password: str, *, min_length: int, email: str = "", full_name: str = ""
) -> list[str]:
    """Reasons a password is refused; empty means acceptable.

    Length matters more than composition rules (NIST SP 800-63B): no mandatory symbols, but
    a minimum length, no trivial or personal values, and a bound that keeps hashing cheap
    to protect against oversized inputs.
    """
    problems: list[str] = []
    if len(password) < min_length:
        problems.append(f"must be at least {min_length} characters long")
    if len(password) > 128:
        problems.append("must be at most 128 characters long")
    lowered = password.lower()
    if lowered in _COMMON_PASSWORDS:
        problems.append("is too common")
    if len(set(password)) < 5:
        problems.append("is too repetitive")
    address = email.strip().lower()
    local_part = address.split("@", 1)[0]
    # The whole address is always forbidden; the local part only when long enough that
    # matching it is meaningful (a 3-letter name would flag far too many good passwords).
    if (address and address in lowered) or (len(local_part) >= 4 and local_part in lowered):
        problems.append("must not contain the email address")
    name_parts = [part for part in re.split(r"\W+", full_name.lower()) if len(part) >= 4]
    if any(part in lowered for part in name_parts):
        problems.append("must not contain the user's name")
    return problems


# --- Tokens -------------------------------------------------------------------


def new_token(prefix: str) -> str:
    """256 bits of randomness with a short human-recognisable prefix (e.g. ``vat_``)."""
    return f"{prefix}_{secrets.token_urlsafe(32)}"


def token_hash(token: str) -> str:
    """SHA-256 of a high-entropy token. Slow hashing is pointless for 256-bit secrets."""
    return hashlib.sha256(token.encode()).hexdigest()


def hash_identifier(value: str) -> str:
    """Stable hash for use inside cache keys, so raw emails never reach Redis."""
    return hashlib.sha256(value.strip().lower().encode()).hexdigest()[:32]


# --- Encryption of sensitive fields -------------------------------------------


class SecretBox:
    """Authenticated encryption (Fernet) with key rotation support."""

    def __init__(self, keys: Iterable[str]) -> None:
        fernets = [Fernet(key) for key in keys]
        self._primary = fernets[0]
        self._fernet = MultiFernet(fernets)

    def encrypt(self, plaintext: str) -> str:
        return self._fernet.encrypt(plaintext.encode()).decode()

    def decrypt(self, ciphertext: str) -> str:
        try:
            return self._fernet.decrypt(ciphertext.encode()).decode()
        except InvalidToken as exc:
            raise ValueError("cannot decrypt value: wrong or rotated-out key") from exc

    def needs_reencryption(self, ciphertext: str) -> bool:
        """True when the value is not readable with the current (first) key alone, i.e. it
        was sealed with an older key and should be re-encrypted before that key is dropped."""
        try:
            self._primary.decrypt(ciphertext.encode())
        except InvalidToken:
            return True
        return False


# --- TOTP (RFC 6238) and recovery codes ---------------------------------------

TOTP_PERIOD = 30
_TOTP_DIGITS = 6


def new_totp_secret() -> str:
    return pyotp.random_base32()


def totp_uri(secret: str, *, account: str, issuer: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=account, issuer_name=issuer)


def match_totp_step(secret: str, code: str, *, now: datetime, window: int = 1) -> int | None:
    """Time step whose code equals ``code`` (within ±``window`` steps), else ``None``.

    The caller stores the matched step and refuses anything not strictly newer, so a code
    cannot be used twice. All candidate steps are compared, in constant time each.
    """
    if len(code) != _TOTP_DIGITS or not code.isascii() or not code.isdigit():
        return None
    totp = pyotp.TOTP(secret, digits=_TOTP_DIGITS, interval=TOTP_PERIOD)
    current = int(now.timestamp()) // TOTP_PERIOD
    matched: int | None = None
    for step in range(current - window, current + window + 1):
        if step < 0:  # only possible within a minute of the Unix epoch
            continue
        if hmac.compare_digest(totp.generate_otp(step), code):
            matched = step
    return matched


def new_recovery_code() -> str:
    raw = secrets.token_hex(8)  # 64 bits
    return "-".join(raw[i : i + 4] for i in range(0, 16, 4))


def normalise_recovery_code(code: str) -> str:
    return re.sub(r"[\s-]", "", code).lower()


def recovery_code_hash(code: str) -> str:
    return hashlib.sha256(normalise_recovery_code(code).encode()).hexdigest()
