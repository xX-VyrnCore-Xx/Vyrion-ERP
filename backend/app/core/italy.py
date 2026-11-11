"""Validation of Italian fiscal identifiers."""

import re

_ELEVEN_DIGITS = re.compile(r"^[0-9]{11}$")
# Personal codice fiscale, including the letters used for omocodia in numeric positions.
_PERSONAL_FISCAL_CODE = re.compile(
    r"^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-EHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$"
)


def is_valid_partita_iva(value: str) -> bool:
    """Eleven digits whose last one is the Luhn-style check digit."""
    if not _ELEVEN_DIGITS.fullmatch(value) or value == "0" * 11:
        return False
    digits = [int(char) for char in value]
    total = 0
    for index, digit in enumerate(digits[:10]):
        if index % 2 == 1:  # even positions, counting from one
            digit *= 2
            if digit > 9:
                digit -= 9
        total += digit
    return (10 - total % 10) % 10 == digits[10]


def is_personal_fiscal_code_format(value: str) -> bool:
    """Structure of a 16-character personal code.

    Only the format is checked: the final control character is not verified here.
    """
    return _PERSONAL_FISCAL_CODE.fullmatch(value) is not None
