export function n2CanonicalT10CollectorTimingSql(column: string): string {
  return `typeof(${column}) = 'integer' AND ${column} BETWEEN 10 AND 15`;
}
