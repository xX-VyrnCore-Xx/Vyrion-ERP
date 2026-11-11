/** Italian fiscal identifiers. Checksums only: they catch typos, not unregistered numbers. */

export function isValidPartitaIva(value: string): boolean {
  if (!/^\d{11}$/.test(value)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let digit = Number(value[i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return (10 - (sum % 10)) % 10 === Number(value[10]);
}

const ODD = [
  1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23,
];

function charValue(ch: string, odd: boolean): number {
  const isDigit = ch >= "0" && ch <= "9";
  const index = isDigit ? ch.charCodeAt(0) - 48 : ch.charCodeAt(0) - 65;
  return odd ? (ODD[index] as number) : index;
}

/** 16-character personal code (omocodia letters are accepted by the checksum). */
export function isValidCodiceFiscalePersona(value: string): boolean {
  const code = value.toUpperCase();
  if (!/^[A-Z0-9]{16}$/.test(code)) return false;
  if (
    !/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(
      code,
    )
  ) {
    return false;
  }
  let sum = 0;
  for (let i = 0; i < 15; i++) sum += charValue(code[i] as string, i % 2 === 0);
  return String.fromCharCode(65 + (sum % 26)) === code[15];
}

/** Companies use the 11-digit VAT number as tax code; people use the 16-character one. */
export function isValidCodiceFiscale(value: string): boolean {
  const code = value.trim().toUpperCase();
  return code.length === 11 ? isValidPartitaIva(code) : isValidCodiceFiscalePersona(code);
}

/** Italian IBAN: IT + 2 check digits + CIN + ABI + CAB + account, mod-97 verified. */
export function isValidIban(value: string): boolean {
  const iban = value.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  if (iban.startsWith("IT") && iban.length !== 27) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const chunk = ch >= "A" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of chunk) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}
