/** NPI check digit: Luhn over the constant prefix 80840 + first nine digits. */
function luhnSum(digits: string, doubleFirst: boolean): number {
  let sum = 0;
  let dbl = doubleFirst;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum;
}

export function makeNpi(base9: string): string {
  const payload = "80840" + base9;
  const check = (10 - (luhnSum(payload, true) % 10)) % 10;
  return base9 + check;
}

export function isValidNpi(npi: string | null | undefined): boolean {
  if (!npi || !/^\d{10}$/.test(npi)) return false;
  return luhnSum("80840" + npi, false) % 10 === 0;
}
