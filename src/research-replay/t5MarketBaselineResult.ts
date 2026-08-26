export function isCanonicalT5TrifectaResult(value: string): boolean {
  const parts = value.split("-");
  if (parts.length !== 3 || parts.some((part) => !/^[1-6]$/.test(part))) return false;
  return new Set(parts).size === 3;
}
