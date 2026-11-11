"""Time-ordered identifiers.

UUID version 7 (RFC 9562) keeps primary keys roughly sorted by creation time, which is
kind to B-tree indexes and lets clients generate identifiers while offline.
"""

import secrets
import time
import uuid


def uuid7() -> uuid.UUID:
    timestamp_ms = time.time_ns() // 1_000_000
    value = (timestamp_ms & 0xFFFF_FFFF_FFFF) << 80
    value |= secrets.randbits(80)
    value &= ~(0xF << 76)
    value |= 0x7 << 76  # version 7
    value &= ~(0x3 << 62)
    value |= 0x2 << 62  # RFC variant
    return uuid.UUID(int=value)
