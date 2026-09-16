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
import { S3CompatibleClient, S3CompatibleError } from "./s3-compatible-client.js";

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

/** fetch 에 전달된 URL. */
function sentUrl(spy: any): string {
  return spy.mock.calls[0][0] as string;
}

describe("S3CompatibleClient: Ncloud Storage 주소 방식 (공식 문서 = virtual-hosted, KR 단일 리전)", () => {
  it("버킷 요청은 {bucket}.kr.ncloudstorage.com 으로 나가고 경로에 버킷이 없다", async () => {
    const spy = stubOkFetch();
    await createClient().request({ method: "GET", bucket: "my-bucket", queryParams: { lifecycle: "" } });

    expect(sentUrl(spy)).toBe("https://my-bucket.kr.ncloudstorage.com/?lifecycle=");
  });

  it("오브젝트 요청은 /{key} 경로만 쓴다 (버킷은 Host)", async () => {
    const spy = stubOkFetch();
    await createClient().request({ method: "GET", bucket: "my-bucket", key: "dir/file name.txt" });

    expect(sentUrl(spy)).toBe("https://my-bucket.kr.ncloudstorage.com/dir/file%20name.txt");
  });

  it("버킷 없는 ListBuckets 는 kr.ncloudstorage.com 루트로 나간다", async () => {
    const spy = stubOkFetch();
    await createClient().request({ method: "GET" });

    expect(sentUrl(spy)).toBe("https://kr.ncloudstorage.com/");
  });

  it("서명 리전은 'kr' 이다 (credential scope)", async () => {
    const spy = stubOkFetch();
    await createClient().request({ method: "GET", bucket: "b" });

    const auth = sentHeaders(spy)["authorization"];
    expect(auth).toMatch(/Credential=testKey\/\d{8}\/kr\/s3\/aws4_request/);
  });

  it("NCLOUD_REGION 이 KR 이 아니어도 Ncloud Storage 는 문서에 있는 kr 엔드포인트만 쓴다 (존재하지 않는 us/sg 호스트를 만들지 않는다)", async () => {
    const spy = stubOkFetch();
    const client = new S3CompatibleClient({ accessKey: "k", secretKey: "s", regionCode: "SGN", storageType: "ncloud" });
    await client.request({ method: "GET", bucket: "b" });

    expect(sentUrl(spy)).toBe("https://b.kr.ncloudstorage.com/");
    expect(sentHeaders(spy)["authorization"]).toMatch(/\/kr\/s3\/aws4_request/);
    expect(client.getServiceRegion()).toBe("kr");
  });

  it("addressing='path' 오버라이드(NCLOUD_STORAGE_ADDRESSING=path)면 이전 path 방식으로 되돌아간다", async () => {
    const spy = stubOkFetch();
    const client = new S3CompatibleClient({ accessKey: "k", secretKey: "s", regionCode: "KR", storageType: "ncloud", addressing: "path" });
    await client.request({ method: "GET", bucket: "b", key: "k.txt" });

    expect(sentUrl(spy)).toBe("https://kr.ncloudstorage.com/b/k.txt");
  });

  it("Object Storage(storageType=object)는 기본 path 방식·kr-standard 서명을 유지한다 (회귀 없음)", async () => {
    const spy = stubOkFetch();
    const client = new S3CompatibleClient({ accessKey: "k", secretKey: "s", regionCode: "KR", storageType: "object" });
    await client.request({ method: "GET", bucket: "b", key: "k.txt" });

    expect(sentUrl(spy)).toBe("https://kr.object.ncloudstorage.com/b/k.txt");
    expect(sentHeaders(spy)["authorization"]).toMatch(/\/kr-standard\/s3\/aws4_request/);
  });

  it("키의 !'()* 는 RFC 3986 으로 인코딩한다 (서명 문자열과 전송 URL 일치)", async () => {
    const spy = stubOkFetch();
    await createClient().request({ method: "GET", bucket: "b", key: "a(1)!*'.txt" });

    expect(sentUrl(spy)).toBe("https://b.kr.ncloudstorage.com/a%281%29%21%2A%27.txt");
  });
});

describe("S3CompatibleClient: 구조화된 에러", () => {
  function stubErrorFetch(status: number, body: string, headers: Record<string, string> = {}): any {
    const spy = vi.fn(async () => new Response(body, { status, headers }));
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  it("XML 에러는 code/status/requestId 를 가진 S3CompatibleError 로 던진다", async () => {
    stubErrorFetch(404,
      `<?xml version="1.0"?><Error><Code>NoSuchLifecycleConfiguration</Code><Message>The lifecycle configuration does not exist</Message></Error>`,
      { "x-amz-request-id": "req-123" });
    const err = await createClient().request({ method: "GET", bucket: "b", queryParams: { lifecycle: "" } }).catch((e) => e);

    expect(err).toBeInstanceOf(S3CompatibleError);
    expect(err.status).toBe(404);
    expect(err.code).toBe("NoSuchLifecycleConfiguration");
    expect(err.requestId).toBe("req-123");
    expect(err.message).toContain("Ncloud Storage 호출 실패");
    expect(err.message).toContain("x-amz-request-id: req-123");
  });

  it("본문 없는 404(HEAD)는 code=HTTP_404 로 정규화한다", async () => {
    stubErrorFetch(404, "");
    const err = await createClient().request({ method: "HEAD", bucket: "b" }).catch((e) => e);

    expect(err).toBeInstanceOf(S3CompatibleError);
    expect(err.status).toBe(404);
    expect(err.code).toBe("HTTP_404");
    expect(err.message).toContain("HTTP 404");
  });

  it("NoSuchBucket 에는 다른 서비스(Object Storage ↔ Ncloud Storage) 안내 힌트를 붙인다", async () => {
    stubErrorFetch(404, `<Error><Code>NoSuchBucket</Code><Message>The specified bucket does not exist</Message></Error>`);
    const err = await createClient().request({ method: "GET", bucket: "legacy-bucket" }).catch((e) => e);

    expect(err.code).toBe("NoSuchBucket");
    expect(err.message).toContain("legacy-bucket");
    expect(err.message).toContain("Object Storage");
    expect(err.message).toContain("ncloud_list_buckets");
  });

  it("Object Storage 쪽 NoSuchBucket 힌트는 ncloud_ncs_* 도구를 가리킨다", async () => {
    stubErrorFetch(404, `<Error><Code>NoSuchBucket</Code><Message>nope</Message></Error>`);
    const client = new S3CompatibleClient({ accessKey: "k", secretKey: "s", regionCode: "KR", storageType: "object" });
    const err = await client.request({ method: "GET", bucket: "new-bucket" }).catch((e) => e);

    expect(err.serviceName).toBe("Object Storage");
    expect(err.message).toContain("ncloud_ncs_*");
  });

  it("본문 없는 404 는 버킷 요청일 때만 교차 서비스 힌트를 붙이고, 키 요청(HEAD /{key})에는 NoSuchKey/delete marker 힌트를 붙인다", async () => {
    stubErrorFetch(404, "");
    const bucketErr = await createClient().request({ method: "HEAD", bucket: "b" }).catch((e) => e);
    expect(bucketErr.message).toContain("버킷 네임스페이스");

    stubErrorFetch(404, "");
    const keyErr = await createClient().request({ method: "HEAD", bucket: "b", key: "v/a.txt" }).catch((e) => e);
    expect(keyErr.status).toBe(404);
    expect(keyErr.code).toBe("HTTP_404");
    expect(keyErr.message).toContain("오브젝트 'v/a.txt'");
    expect(keyErr.message).toContain("delete marker");
    expect(keyErr.message).not.toContain("버킷 네임스페이스");
  });
});
