export type BeaconErrorCode =
  | "NOT_SHOPIFY"
  | "ENDPOINT_DISABLED"
  | "RATE_LIMITED"
  | "ROBOTS_DISALLOWED"
  | "NOT_IMPLEMENTED"
  | "INVALID_INPUT"
  | "FIXTURE_MISSING";

export class BeaconError extends Error {
  readonly code: BeaconErrorCode;
  readonly hint: string;

  constructor(code: BeaconErrorCode, message: string, hint: string) {
    super(message);
    this.name = "BeaconError";
    this.code = code;
    this.hint = hint;
  }
}
