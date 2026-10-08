export function photoMayOmitCredit(license) {
  return /^(?:CC0(?:\s+\d+(?:\.\d+)?)?(?:\s+Universal)?|Public domain|PD-[\w-]+)$/i.test(String(license || '').trim());
}
