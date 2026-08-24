export type UnexpectedAdditionsRawEligibility = {
  integrityStatus: string;
  securityScanStatus: string;
  parserReplayEligible: number;
};

export function isUnexpectedAdditionsRawEligible(row: UnexpectedAdditionsRawEligibility): boolean {
  return row.integrityStatus === "verified"
    && row.securityScanStatus === "passed"
    && row.parserReplayEligible === 1;
}
