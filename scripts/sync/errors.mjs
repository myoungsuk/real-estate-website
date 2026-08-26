export class ExternalSyncTrustError extends Error {
  constructor(message) {
    super(message);
    this.name = "ExternalSyncTrustError";
  }
}
