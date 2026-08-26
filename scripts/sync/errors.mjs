export class ExternalSyncTrustError extends Error {
  constructor(message) {
    super(message);
    this.name = "ExternalSyncTrustError";
  }
}

export class ExternalSyncSourceUnavailableError extends Error {
  constructor(message, { status = null, attempts = 0, cause } = {}) {
    super(message);
    this.name = "ExternalSyncSourceUnavailableError";
    this.status = status;
    this.attempts = attempts;
    this.cause = cause;
  }
}
