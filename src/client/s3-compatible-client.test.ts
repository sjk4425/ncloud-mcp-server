/**
 * S3CompatibleClient 서명/헤더 단위 테스트.
 *
 * content-md5 자동 주입: Ncloud Storage 의 XML 본문 API 는 무결성 헤더가 없으면
 * `InvalidRequest: Missing required header for this request: Content-MD5 OR
 * x-amz-checksum-*` 로 거부된다(v1.11.0 라이브 테스트 T-C8 에서 실측).
 * 도구가 아니라 클라이언트에서 붙이므로 여기서 검증한다.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import crypto from "node:crypto";
import { S3CompatibleClient } from "./s3-compatible-client.js";

function stubOkFetch(): any {
  const spy = vi.fn(async () => new Response("<Ok/>", { status: 200 }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

function createClient(): S3CompatibleClient {
  return new S3CompatibleClient({
    accessKey: "testKey",
    secretKey: "testSecret",
    regionCode: "KR",
    storageType: "ncloud",
  });
}

/** fetch 호출에 실제로 전달된 헤더를 소문자 키로 정규화해 돌려준다. */
function sentHeaders(spy: any): Record<string, string> {
  const init = spy.mock.calls[0][1];
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
    out[k.toLowerCase()] = v;
  }
  return out;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("S3CompatibleClient: content-md5 자동 주입", () => {
  const xmlBody = "<LifecycleConfiguration><Rule><ID>r1</ID></Rule></LifecycleConfiguration>";

  it("본문이 있으면 content-md5 를 붙인다 (base64 MD5)", async () => {
    const spy = stubOkFetch();
    await createClient().request({
      method: "PUT",
      bucket: "b",
      queryParams: { lifecycle: "" },
      headers: { "content-type": "application/xml" },
      body: xmlBody,
    });

    const expected = crypto.createHash("md5").update(xmlBody).digest("base64");
    expect(sentHeaders(spy)["content-md5"]).toBe(expected);
  });

  it("주입된 content-md5 는 SignedHeaders 에 포함된다 (서명 대상)", async () => {
    const spy = stubOkFetch();
    await createClient().request({ method: "PUT", bucket: "b", queryParams: { cors: "" }, body: xmlBody });

    const auth = sentHeaders(spy)["authorization"];
    const signedHeaders = auth.match(/SignedHeaders=([^,]+)/)?.[1] ?? "";
    expect(signedHeaders.split(";")).toContain("content-md5");
  });

  it("본문이 없으면 붙이지 않는다 (조회 요청)", async () => {
    const spy = stubOkFetch();
    await createClient().request({ method: "GET", bucket: "b", queryParams: { lifecycle: "" } });

    expect(sentHeaders(spy)["content-md5"]).toBeUndefined();
  });

  it("호출자가 content-md5 를 직접 지정하면 그 값을 유지한다 (대소문자 무관, 중복 없음)", async () => {
    const spy = stubOkFetch();
    await createClient().request({
      method: "POST",
      bucket: "b",
      queryParams: { delete: "" },
      headers: { "Content-MD5": "caller-supplied" },
      body: xmlBody,
    });

    const headers = sentHeaders(spy);
    expect(headers["content-md5"]).toBe("caller-supplied");
    // 대소문자만 다른 중복 헤더가 생기면 canonical headers 가 깨져 서명이 실패한다
    const rawKeys = Object.keys(spy.mock.calls[0][1].headers).filter((k) => k.toLowerCase() === "content-md5");
    expect(rawKeys.length).toBe(1);
  });

  it("호출자가 x-amz-checksum-* 를 지정하면 content-md5 를 주입하지 않는다", async () => {
    const spy = stubOkFetch();
    await createClient().request({
      method: "PUT",
      bucket: "b",
      key: "k.txt",
      headers: { "x-amz-checksum-sha256": "abc123" },
      body: "hello",
    });

    const headers = sentHeaders(spy);
    expect(headers["content-md5"]).toBeUndefined();
    expect(headers["x-amz-checksum-sha256"]).toBe("abc123");
  });
});
