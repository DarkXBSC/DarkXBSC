// The production database is provisioned before either service starts.
export const hostedLedger = "/var/lib/darkwork-settlement";
export const signerStatus = "/run/darkwork-signer/ready.json";
export function givingPath(path) {
  return /^\/api\/giving\/(?:capabilities$|nominations(?:\/|$)|x\/)/.test(path);
}
