import { describe, test, expect } from "vitest";
import fc from "fast-check";
import crypto from "node:crypto";
import { makeSignatureMessage, generateSignature } from "./signature.js";

describe("Feature: ncloud-mcp-server, Property 1: 서명 메시지 포맷 일관성", () => {
  test("makeSignatureMessage produces correct format for any valid inputs", () => {
    const methodArb = fc.constantFrom("GET", "POST");
    const pathArb = fc.stringMatching(/^\/[a-z0-9/]+$/);
    const queryArb = fc.stringMatching(/^[a-zA-Z0-9=&_]+$/).map((q) => `?${q}`);
    const urlArb = fc.tuple(pathArb, fc.oneof(fc.constant(""), queryArb)).map(
      ([p, q]) => p + q
    );
    const timestampArb = fc
      .integer({ min: 1000000000000, max: 9999999999999 })
      .map(String);
    const accessKeyArb = fc.stringMatching(/^[A-Za-z0-9]{10,30}$/);

    fc.assert(
      fc.property(
        methodArb,
        urlArb,
        timestampArb,
        accessKeyArb,
        (method, url, timestamp, accessKey) => {
          const message = makeSignatureMessage({ method, url, timestamp, accessKey });
          const lines = message.split("\n");

          // Must have exactly 3 lines
          expect(lines).toHaveLength(3);

          // First line: "{METHOD} {URL}"
          expect(lines[0]).toBe(`${method} ${url}`);

          // Second line: timestamp
          expect(lines[1]).toBe(timestamp);

          // Third line: access key
          expect(lines[2]).toBe(accessKey);

          // URL with query string must be included in the message
          if (url.includes("?")) {
            expect(message).toContain(url);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Feature: ncloud-mcp-server, Property 2: 서명 생성 멱등성 및 유효성", () => {
  test("generateSignature is idempotent and produces valid Base64", () => {
    const methodArb = fc.constantFrom("GET", "POST");
    const urlArb = fc.stringMatching(/^\/[a-z0-9/]+(\?[a-zA-Z0-9=&_]+)?$/);
    const timestampArb = fc
      .integer({ min: 1000000000000, max: 9999999999999 })
      .map(String);
    const keyArb = fc.stringMatching(/^[A-Za-z0-9]{10,40}$/);

    fc.assert(
      fc.property(
        methodArb,
        urlArb,
        timestampArb,
        keyArb,
        keyArb,
        (method, url, timestamp, accessKey, secretKey) => {
          const input = { method, url, timestamp, accessKey, secretKey };

          // Idempotency: same input → same output
          const sig1 = generateSignature(input);
          const sig2 = generateSignature(input);
          expect(sig1).toBe(sig2);

          // Valid Base64: must match Base64 pattern
          expect(sig1).toMatch(/^[A-Za-z0-9+/]+=*$/);

          // Non-empty
          expect(sig1.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe("Unit: 서명 정확성 검증 (알려진 입력/출력 쌍)", () => {
  const knownInput = {
    method: "GET",
    url: "/vserver/v2/getServerInstanceList?responseFormatType=json",
    timestamp: "1234567890123",
    accessKey: "TestAccessKey",
    secretKey: "TestSecretKey",
  };

  test("makeSignatureMessage produces expected message format", () => {
    const message = makeSignatureMessage(knownInput);
    expect(message).toBe(
      "GET /vserver/v2/getServerInstanceList?responseFormatType=json\n1234567890123\nTestAccessKey"
    );
  });

  test("generateSignature produces expected HMAC-SHA256 Base64 value", () => {
    const signature = generateSignature(knownInput);
    // Pre-computed expected value
    expect(signature).toBe("FPsYYX8fuMAgi+cue3eACOW0dNtIwu1LYWfg/megA2M=");
  });

  test("generateSignature matches manual crypto computation", () => {
    const message = `${knownInput.method} ${knownInput.url}\n${knownInput.timestamp}\n${knownInput.accessKey}`;
    const hmac = crypto.createHmac("sha256", knownInput.secretKey);
    hmac.update(message);
    const expected = hmac.digest("base64");

    const actual = generateSignature(knownInput);
    expect(actual).toBe(expected);
  });

  test("different secret keys produce different signatures", () => {
    const sig1 = generateSignature(knownInput);
    const sig2 = generateSignature({ ...knownInput, secretKey: "DifferentKey" });
    expect(sig1).not.toBe(sig2);
  });

  test("POST method produces different signature than GET", () => {
    const sigGet = generateSignature(knownInput);
    const sigPost = generateSignature({ ...knownInput, method: "POST" });
    expect(sigGet).not.toBe(sigPost);
  });
});
