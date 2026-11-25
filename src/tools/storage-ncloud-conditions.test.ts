/**
 * Ncloud Storage 2026-11-24 민간존 업데이트(ncloudstorage-releasenote):
 *  1. 조건부 쓰기 If-Match / If-None-Match (PutObject · CopyObject · CompleteMultipartUpload, DeleteObject 는 If-Match)
 *  2. 복사 원본 조건 x-amz-copy-source-if-* (CopyObject · UploadPartCopy)
 *  3. 버킷 소유자 확인 x-amz-expected-bucket-owner(공통) · x-amz-source-expected-bucket-owner(복사 원본)
 *  4. DeleteObjects Delete.Object.ETag
 * 실제 S3CompatibleClient 를 쓰고 fetch 만 stub 해서, 서명 직전에 붙는 헤더까지 확인한다.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { S3CompatibleClient } from "../client/s3-compatible-client.js";
import { registerStorageNcloudTools } from "./storage-ncloud.js";

type Sent = { url: string; method: string; headers: Record<string, string>; body?: string };

function setup(opts: { conditional?: boolean; respond?: (s: Sent) => { status?: number; body?: string; headers?: Record<string, string> } } = {}) {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: any) => {
    const s: Sent = { url: String(url), method: init?.method, headers: Object.fromEntries(Object.entries(init?.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)])), body: init?.body };
    sent.push(s);
    const r = opts.respond?.(s) ?? {};
    return new Response(r.body ?? "", { status: r.status ?? 200, headers: r.headers ?? { etag: "\"e1\"" } });
  }));
  const client = new S3CompatibleClient({ accessKey: "a", secretKey: "s", regionCode: "KR", storageType: "ncloud" });
  const server = new McpServer({ name: "t", version: "1" });
  registerStorageNcloudTools(server, client, { conditional: opts.conditional });
  const reg = (server as any)._registeredTools;
  const entry = (name: string) => (reg instanceof Map ? reg.get(name) : reg[name]);
  const call = (name: string, input: Record<string, unknown>) => {
    const e = entry(name);
    return e.handler(e.inputSchema.parse(input), {} as any);
  };
  const names = (): string[] => (reg instanceof Map ? [...reg.keys()] : Object.keys(reg));
  return { sent, call, entry, names };
}

const text = (r: any) => r.content.map((c: any) => c.text).join("\n");

afterEach(() => vi.unstubAllGlobals());

describe("3. x-amz-expected-bucket-owner — 모든 Ncloud Storage 도구 공통", () => {
  it("민간존: 모든 ncloud_ncs_* 도구 스키마에 expectedBucketOwner 가 있다", () => {
    const { names, entry } = setup();
    const ncs = names().filter((n) => n.startsWith("ncloud_ncs_"));
    expect(ncs.length).toBeGreaterThan(30);
    for (const n of ncs) expect(Object.keys(entry(n).inputSchema.shape), n).toContain("expectedBucketOwner");
  });

  it("지정하면 헤더로 전송되고, 핸들러에는 파라미터가 새지 않는다", async () => {
    const { sent, call } = setup();
    await call("ncloud_ncs_list_objects", { bucketName: "b", expectedBucketOwner: "acct-123" });
    expect(sent[0].headers["x-amz-expected-bucket-owner"]).toBe("acct-123");
    expect(sent[0].url).not.toContain("expectedBucketOwner");
  });

  it("지정하지 않으면 헤더가 없다", async () => {
    const { sent, call } = setup();
    await call("ncloud_ncs_list_objects", { bucketName: "b" });
    expect(sent[0].headers).not.toHaveProperty("x-amz-expected-bucket-owner");
  });

  it("공공존(conditional=false): 파라미터가 없다", () => {
    const { names, entry } = setup({ conditional: false });
    for (const n of names().filter((x) => x.startsWith("ncloud_ncs_"))) {
      expect(Object.keys(entry(n).inputSchema.shape), n).not.toContain("expectedBucketOwner");
    }
  });

  it("put_object dryRun 프리뷰에 소유자 헤더가 보인다", async () => {
    const { sent, call } = setup();
    const r = await call("ncloud_ncs_put_object", { bucketName: "b", key: "k", body: "x", expectedBucketOwner: "acct-1" });
    expect(sent).toHaveLength(0);
    expect(text(r)).toContain("x-amz-expected-bucket-owner");
  });
});

describe("1. 조건부 쓰기", () => {
  it("put_object ifNoneMatch='*' → If-None-Match 헤더", async () => {
    const { sent, call } = setup();
    await call("ncloud_ncs_put_object", { bucketName: "b", key: "k", body: "x", ifNoneMatch: "*", dryRun: false });
    expect(sent[0].method).toBe("PUT");
    expect(sent[0].headers["if-none-match"]).toBe("*");
  });

  it("put_object ifMatch → If-Match 헤더(따옴표 그대로)", async () => {
    const { sent, call } = setup();
    await call("ncloud_ncs_put_object", { bucketName: "b", key: "k", body: "x", ifMatch: "\"e1\"", dryRun: false });
    expect(sent[0].headers["if-match"]).toBe("\"e1\"");
  });

  it("ifMatch+ifNoneMatch 동시, ifMatch='*', ifNoneMatch 가 '*' 아님 → 호출 전 거부", async () => {
    const { sent, call, entry } = setup();
    const r1 = await call("ncloud_ncs_put_object", { bucketName: "b", key: "k", body: "x", ifMatch: "e", ifNoneMatch: "*", dryRun: false });
    expect(r1.isError).toBe(true);
    const r2 = await call("ncloud_ncs_put_object", { bucketName: "b", key: "k", body: "x", ifMatch: "*", dryRun: false });
    expect(r2.isError).toBe(true);
    expect(entry("ncloud_ncs_put_object").inputSchema.safeParse({ bucketName: "b", key: "k", body: "x", ifNoneMatch: "e1" }).success).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it("complete_multipart_upload ifNoneMatch → If-None-Match", async () => {
    const { sent, call } = setup();
    await call("ncloud_ncs_complete_multipart_upload", { bucketName: "b", key: "k", uploadId: "u", parts: [{ partNumber: 1, etag: "p1" }], ifNoneMatch: "*" });
    expect(sent[0].method).toBe("POST");
    expect(sent[0].headers["if-none-match"]).toBe("*");
  });

  it("delete_object ifMatch='*' 허용, versionId 와 함께면 거부", async () => {
    const { sent, call } = setup();
    await call("ncloud_ncs_delete_object", { bucketName: "b", key: "k", ifMatch: "*", confirm: true });
    expect(sent[0].method).toBe("DELETE");
    expect(sent[0].headers["if-match"]).toBe("*");
    const r = await call("ncloud_ncs_delete_object", { bucketName: "b", key: "k", versionId: "v1", ifMatch: "e", confirm: true });
    expect(r.isError).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("공공존: 조건 파라미터가 스키마에 없다", () => {
    const { entry } = setup({ conditional: false });
    for (const n of ["ncloud_ncs_put_object", "ncloud_ncs_copy_object", "ncloud_ncs_complete_multipart_upload", "ncloud_ncs_delete_object"]) {
      expect(Object.keys(entry(n).inputSchema.shape), n).not.toContain("ifMatch");
    }
    expect(Object.keys(entry("ncloud_ncs_upload_part_copy").inputSchema.shape)).not.toContain("copySourceIfMatch");
  });

  it("412 PreconditionFailed 에 원인 안내가 붙는다", async () => {
    const { call } = setup({ respond: () => ({ status: 412, body: "<Error><Code>PreconditionFailed</Code><Message>At least one of the pre-conditions you specified did not hold</Message></Error>" }) });
    const r = await call("ncloud_ncs_put_object", { bucketName: "b", key: "k", body: "x", ifNoneMatch: "*", dryRun: false });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("PreconditionFailed");
    expect(text(r)).toContain("if-none-match");
    expect(text(r)).toContain("head_object");
  });
});

describe("2. 복사 원본 조건 · 원본 버킷 소유자", () => {
  it("copy_object: 원본 조건 4종 + 원본 소유자 + 대상 If-None-Match, 날짜는 HTTP-date 로", async () => {
    const { sent, call } = setup({ respond: () => ({ body: "<CopyObjectResult><ETag>\"c\"</ETag></CopyObjectResult>" }) });
    await call("ncloud_ncs_copy_object", {
      bucketName: "dst", key: "k2", copySource: "src/k1",
      copySourceIfMatch: "\"e1\"", copySourceIfNoneMatch: "\"e0\"",
      copySourceIfModifiedSince: "2026-01-01T00:00:00Z", copySourceIfUnmodifiedSince: "2026-12-31T00:00:00Z",
      sourceExpectedBucketOwner: "acct-src", expectedBucketOwner: "acct-dst", ifNoneMatch: "*",
    });
    const h = sent[0].headers;
    expect(h["x-amz-copy-source"]).toBe("src/k1");
    expect(h["x-amz-copy-source-if-match"]).toBe("\"e1\"");
    expect(h["x-amz-copy-source-if-none-match"]).toBe("\"e0\"");
    expect(h["x-amz-copy-source-if-modified-since"]).toBe("Thu, 01 Jan 2026 00:00:00 GMT");
    expect(h["x-amz-copy-source-if-unmodified-since"]).toBe("Thu, 31 Dec 2026 00:00:00 GMT");
    expect(h["x-amz-source-expected-bucket-owner"]).toBe("acct-src");
    expect(h["x-amz-expected-bucket-owner"]).toBe("acct-dst");
    expect(h["if-none-match"]).toBe("*");
  });

  it("copy_object: 날짜가 아니면 스키마 오류", () => {
    const { entry } = setup();
    expect(entry("ncloud_ncs_copy_object").inputSchema.safeParse({ bucketName: "d", key: "k", copySource: "s/k", copySourceIfModifiedSince: "yesterday" }).success).toBe(false);
  });

  it("upload_part_copy: 원본 조건 + 원본 소유자, 대상 If-Match 파라미터는 없다", async () => {
    const { sent, call, entry } = setup({ respond: () => ({ body: "<CopyPartResult><ETag>\"p\"</ETag></CopyPartResult>" }) });
    await call("ncloud_ncs_upload_part_copy", { bucketName: "b", key: "k", uploadId: "u", partNumber: 1, copySource: "s/k", copySourceIfMatch: "e1", sourceExpectedBucketOwner: "acct-src" });
    expect(sent[0].headers["x-amz-copy-source-if-match"]).toBe("e1");
    expect(sent[0].headers["x-amz-source-expected-bucket-owner"]).toBe("acct-src");
    expect(Object.keys(entry("ncloud_ncs_upload_part_copy").inputSchema.shape)).not.toContain("ifMatch");
  });

  it("InvalidBucketOwnerAWSAccountID(라이브 응답 코드) → 숫자 계정 ID 안내", async () => {
    // 2026-11-25 라이브: list_buckets owner.id(UUID)를 넣으면 가이드 표기와 다른 코드로 400 이 왔다.
    const { call } = setup({ respond: () => ({ status: 400, body: "<Error><Code>InvalidBucketOwnerAWSAccountID</Code><Message>The value of the expected bucket owner parameter must be an account ID...</Message></Error>" }) });
    const r = await call("ncloud_ncs_list_objects", { bucketName: "b", expectedBucketOwner: "uuid-like-value" });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("숫자로 된 계정 ID");
  });

  it("AccessDenied + 소유자 헤더 → 소유자 확인 안내", async () => {
    const { call } = setup({ respond: () => ({ status: 403, body: "<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>" }) });
    const r = await call("ncloud_ncs_list_objects", { bucketName: "b", expectedBucketOwner: "acct-x" });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("expectedBucketOwner");
  });
});

describe("4. delete_objects Delete.Object.ETag", () => {
  const deleteResult = "<DeleteResult><Deleted><Key>a</Key></Deleted><Error><Key>b</Key><Code>PreconditionFailed</Code><Message>At least one of the pre-conditions you specified did not hold</Message></Error></DeleteResult>";

  it.each([true, false])("objects[].etag 를 <ETag> 로 보낸다 (conditional=%s, 공공존 가이드에도 있음)", async (conditional) => {
    const { sent, call } = setup({ conditional, respond: () => ({ body: deleteResult }) });
    const r = await call("ncloud_ncs_delete_objects", { bucketName: "b", objects: [{ key: "a", etag: "*" }, { key: "b", etag: "\"old\"" }], confirm: true });
    expect(sent[0].body).toContain("<Object><Key>a</Key><ETag>*</ETag></Object>");
    expect(sent[0].body).toContain("<Object><Key>b</Key><ETag>&quot;old&quot;</ETag></Object>");
    const data = JSON.parse(text(r));
    expect(data.errors[0].code).toBe("PreconditionFailed");
    expect(data.note).toContain("PreconditionFailed");
  });
});
