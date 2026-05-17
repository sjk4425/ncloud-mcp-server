import crypto from "node:crypto";

export interface SignatureInput {
  method: string;
  url: string;
  timestamp: string;
  accessKey: string;
  secretKey: string;
}

/**
 * Creates the signing message in the format:
 * "{METHOD} {URL}\n{TIMESTAMP}\n{ACCESS_KEY}"
 */
export function makeSignatureMessage(
  input: Omit<SignatureInput, "secretKey">
): string {
  return `${input.method} ${input.url}\n${input.timestamp}\n${input.accessKey}`;
}

/**
 * Generates HMAC-SHA256 signature encoded in Base64.
 */
export function generateSignature(input: SignatureInput): string {
  const message = makeSignatureMessage(input);
  const hmac = crypto.createHmac("sha256", input.secretKey);
  hmac.update(message);
  return hmac.digest("base64");
}
