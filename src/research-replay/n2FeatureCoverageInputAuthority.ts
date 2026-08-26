export function assertN2FeatureCoverageInputAuthority(input: {
  hasFileInput: boolean;
  fixture: boolean;
}): void {
  if (input.hasFileInput && !input.fixture) {
    throw new Error("N2_COVERAGE_FILE_INPUT_REQUIRES_FIXTURE");
  }
}
