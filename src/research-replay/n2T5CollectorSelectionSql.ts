export function n2CanonicalT5SelectionSql(column: string): string {
  if (!/^(?:[A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*$/.test(column)) {
    throw new Error(`N2_T5_COLLECTOR_SELECTION_COLUMN_INVALID:${column}`);
  }
  return `(
    ${column} GLOB '[1-6]-[1-6]-[1-6]'
    AND substr(${column}, 1, 1) <> substr(${column}, 3, 1)
    AND substr(${column}, 1, 1) <> substr(${column}, 5, 1)
    AND substr(${column}, 3, 1) <> substr(${column}, 5, 1)
  )`;
}
