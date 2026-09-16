/**
 * Ncloud Storage 도구 단위 테스트 (v1.15.0 스펙 대조 반영).
 *
 * - 도구명 `ncloud_ncs_*` 통일(lifecycle/cors/encryption 9개 rename) — 접두 없는 이전 이름은 등록되지 않는다
 * - 라이프사이클: xmlns·NoncurrentVersion*·검증·merge/replace 동작·미설정 정규화
 * - 신규 op: versioning / location / object lock / versions / attributes / retention / legal hold / restore / multipart
 * - 스토리지 클래스: STANDARD(기본) / ONEZONE_IA / DEEP_ARCHIVE — 전환 대상은 STANDARD 제외
 *
 * 핸들러는 등록된 zod `inputSchema.parse` 를 거쳐 호출한다(SDK 와 동일하게 기본값이 적용된다).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { S3CompatibleClient, S3CompatibleError } from "../client/s3-compatible-client.js";
import { registerStorageNcloudTools } from "./storage-ncloud.js";

function createMockClient(): S3CompatibleClient {
  return new S3CompatibleClient({
    accessKey: "testAccessKey",
    secretKey: "testSecretKey",
    regionCode: "KR",
    storageType: "ncloud",
  });
}

function getTool(server: McpServer, toolName: string): any {
  const tools = (server as any)._registeredTools;
  if (!tools) throw new Error("No registered tools found on server");
  const entry = tools instanceof Map ? tools.get(toolName) : tools[toolName];
  if (!entry) throw new Error(`Tool ${toolName} not found`);
  return entry;
}

function hasTool(server: McpServer, toolName: string): boolean {
  const tools = (server as any)._registeredTools;
  return tools instanceof Map ? tools.has(toolName) : Boolean(tools[toolName]);
}

/** inputSchema.parse → handler. SDK 가 하는 것과 같은 경로. */
async function call(server: McpServer, toolName: string, input: Record<string, unknown>): Promise<any> {
  const tool = getTool(server, toolName);
  const parsed = tool.inputSchema.parse(input);
  return tool.handler(parsed, {} as any);
}

function mockResponse(body = "", status = 200, headers: Record<string, string> = {}): any {
  return { status, headers: new Headers(headers), body };
}

function s3Error(code: string, status: number): S3CompatibleError {
  return new S3CompatibleError({ message: `Ncloud Storage 호출 실패\n\n에러 코드: ${code}`, status, code, serviceName: "Ncloud Storage" });
}

function textOf(result: any): string {
  return result.content[0].text;
}
function dataOf(result: any): any {
  return JSON.parse(textOf(result));
}

let server: McpServer;
let client: S3CompatibleClient;

beforeEach(() => {
  server = new McpServer({ name: "test", version: "1.0.0" });
  client = createMockClient();
  registerStorageNcloudTools(server, client);
});

describe("Ncloud Storage: 도구명 통일 (ncloud_ncs_*)", () => {
  it("lifecycle/cors/encryption 도구는 ncloud_ncs_ 접두로만 등록된다 (Object Storage 도구와 이름 체계 분리)", () => {
    for (const suffix of ["get_bucket_lifecycle", "put_bucket_lifecycle", "delete_bucket_lifecycle", "get_bucket_cors", "put_bucket_cors", "delete_bucket_cors", "get_bucket_encryption", "put_bucket_encryption", "delete_bucket_encryption"]) {
      expect(hasTool(server, `ncloud_ncs_${suffix}`)).toBe(true);
      expect(hasTool(server, `ncloud_${suffix}`)).toBe(false);
    }
  });

  it("공식 문서의 op 40개가 모두 ncloud_ncs_* 도구로 존재한다", () => {
    const expected = [
      // Bucket
      "list_buckets", "create_bucket", "delete_bucket", "head_bucket", "get_bucket_location",
      "get_bucket_versioning", "put_bucket_versioning",
      "get_bucket_cors", "put_bucket_cors", "delete_bucket_cors",
      "get_bucket_encryption", "put_bucket_encryption", "delete_bucket_encryption",
      "get_bucket_lifecycle", "put_bucket_lifecycle", "delete_bucket_lifecycle",
      "get_object_lock_configuration", "put_object_lock_configuration",
      // Object
      "put_object", "get_object", "copy_object", "delete_object", "delete_objects", "head_object",
      "list_objects", "list_object_versions", "get_object_attributes",
      "get_object_retention", "put_object_retention", "get_object_legal_hold", "put_object_legal_hold", "restore_object",
      // Multipart
      "create_multipart_upload", "upload_part", "upload_part_copy", "list_parts", "list_multipart_uploads",
      "complete_multipart_upload", "abort_multipart_upload",
    ];
    for (const name of expected) expect(hasTool(server, `ncloud_ncs_${name}`), name).toBe(true);
    const registry = (server as any)._registeredTools;
    const all: string[] = registry instanceof Map ? [...registry.keys()] : Object.keys(registry);
    expect(all.length).toBe(expected.length);
    expect(all.every((n) => n.startsWith("ncloud_ncs_"))).toBe(true);
  });
});

describe("Ncloud Storage: 라이프사이클 (PutBucketLifecycleConfiguration 스펙)", () => {
  const noConfig = () => vi.spyOn(client, "request").mockRejectedValueOnce(s3Error("NoSuchLifecycleConfiguration", 404));

  it("XML 루트에 S3 네임스페이스가 붙고 Transition/Expiration/Filter.Prefix 가 스펙 요소명으로 나간다", async () => {
    const spy = noConfig().mockResolvedValueOnce(mockResponse());
    await call(server, "ncloud_ncs_put_bucket_lifecycle", {
      bucketName: "b",
      rules: [{ id: "r1", prefix: "logs/", transitions: [{ days: 30, storageClass: "ONEZONE_IA" }], expiration: { days: 365 } }],
    });

    const put = (spy.mock.calls[1] as any)[0];
    expect(put.method).toBe("PUT");
    expect(put.queryParams).toEqual({ lifecycle: "" });
    expect(put.body).toContain('<LifecycleConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">');
    expect(put.body).toContain("<Rule><ID>r1</ID><Status>Enabled</Status><Filter><Prefix>logs/</Prefix></Filter>");
    expect(put.body).toContain("<Transition><Days>30</Days><StorageClass>ONEZONE_IA</StorageClass></Transition>");
    expect(put.body).toContain("<Expiration><Days>365</Days></Expiration>");
    // Date 미지정이면 요소 자체를 생략한다 (빈 <Date/> 는 MalformedXML)
    expect(put.body).not.toContain("<Date>");
  });

  it("NoncurrentVersionTransition / NoncurrentVersionExpiration 을 지원한다 (이전 버전 누락)", async () => {
    const spy = noConfig().mockResolvedValueOnce(mockResponse());
    await call(server, "ncloud_ncs_put_bucket_lifecycle", {
      bucketName: "b",
      rules: [{
        id: "versions",
        noncurrentVersionTransitions: [{ noncurrentDays: 7, newerNoncurrentVersions: 3, storageClass: "DEEP_ARCHIVE" }],
        noncurrentVersionExpiration: { noncurrentDays: 90 },
      }],
    });

    const body = (spy.mock.calls[1] as any)[0].body as string;
    expect(body).toContain("<NoncurrentVersionTransition><NoncurrentDays>7</NoncurrentDays><NewerNoncurrentVersions>3</NewerNoncurrentVersions><StorageClass>DEEP_ARCHIVE</StorageClass></NoncurrentVersionTransition>");
    expect(body).toContain("<NoncurrentVersionExpiration><NoncurrentDays>90</NoncurrentDays></NoncurrentVersionExpiration>");
  });

  it("전환 대상은 ONEZONE_IA / DEEP_ARCHIVE 뿐 — STANDARD·AWS 클래스명은 스키마에서 거부된다", () => {
    const shape = getTool(server, "ncloud_ncs_put_bucket_lifecycle").inputSchema.shape;
    const ok = (sc: string) => shape.rules.safeParse([{ id: "r", transitions: [{ days: 1, storageClass: sc }] }]).success;
    expect(ok("ONEZONE_IA")).toBe(true);
    expect(ok("DEEP_ARCHIVE")).toBe(true);
    expect(ok("STANDARD")).toBe(false);
    expect(ok("STANDARD_IA")).toBe(false);
    expect(ok("GLACIER")).toBe(false);
  });

  it("Days 는 양의 정수만 허용한다 (0·음수·소수는 스키마 거부)", () => {
    const shape = getTool(server, "ncloud_ncs_put_bucket_lifecycle").inputSchema.shape;
    const ok = (days: number) => shape.rules.safeParse([{ id: "r", expiration: { days } }]).success;
    expect(ok(1)).toBe(true);
    expect(ok(0)).toBe(false);
    expect(ok(-5)).toBe(false);
    expect(ok(1.5)).toBe(false);
  });

  it("days 와 date 를 함께/둘 다 없이 주면 API 호출 전에 거부한다", async () => {
    const spy = vi.spyOn(client, "request");
    const both = await call(server, "ncloud_ncs_put_bucket_lifecycle", {
      bucketName: "b", rules: [{ id: "r", expiration: { days: 1, date: "2027-01-01T00:00:00Z" } }],
    });
    expect(both.isError).toBe(true);
    expect(textOf(both)).toContain("days");

    const neither = await call(server, "ncloud_ncs_put_bucket_lifecycle", {
      bucketName: "b", rules: [{ id: "r", transitions: [{ storageClass: "ONEZONE_IA" }] }],
    });
    expect(neither.isError).toBe(true);

    const noAction = await call(server, "ncloud_ncs_put_bucket_lifecycle", { bucketName: "b", rules: [{ id: "r", prefix: "x/" }] });
    expect(noAction.isError).toBe(true);

    expect(spy).not.toHaveBeenCalled();
  });

  it("규칙 ID 중복은 거부한다", async () => {
    const result = await call(server, "ncloud_ncs_put_bucket_lifecycle", {
      bucketName: "b", rules: [{ id: "dup", expiration: { days: 1 } }, { id: "dup", expiration: { days: 2 } }],
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("dup");
  });

  const existingXml = `<?xml version="1.0" encoding="UTF-8"?>
<LifecycleConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Rule><ID>keep-me</ID><Status>Enabled</Status><Filter><Prefix>logs/</Prefix></Filter><Expiration><Days>30</Days></Expiration></Rule>
  <Rule><ID>r1</ID><Status>Disabled</Status><Filter><Prefix></Prefix></Filter><Transition><Days>10</Days><StorageClass>ONEZONE_IA</StorageClass></Transition></Rule>
</LifecycleConfiguration>`;

  it("replace(기본): 기존 규칙을 덮어쓰며, 사라지는 규칙 ID 를 응답 warning 으로 알린다 (조용한 유실 방지)", async () => {
    const spy = vi.spyOn(client, "request")
      .mockResolvedValueOnce(mockResponse(existingXml))
      .mockResolvedValueOnce(mockResponse());
    const result = await call(server, "ncloud_ncs_put_bucket_lifecycle", {
      bucketName: "b", rules: [{ id: "r1", expiration: { days: 5 } }],
    });

    const data = dataOf(result);
    expect(data.change.mode).toBe("replace");
    expect(data.change.rulesRemoved).toEqual(["keep-me"]);
    expect(data.change.rulesReplacedById).toEqual(["r1"]);
    expect(data.warning).toContain("keep-me");
    const body = (spy.mock.calls[1] as any)[0].body as string;
    expect(body).not.toContain("keep-me");
    expect(body).toContain("<ID>r1</ID>");
  });

  it("mergeWithExisting=true: 기존 규칙을 유지하고 같은 ID 만 교체한다 (기존 규칙이 먼저, 새 규칙이 뒤)", async () => {
    const spy = vi.spyOn(client, "request")
      .mockResolvedValueOnce(mockResponse(existingXml))
      .mockResolvedValueOnce(mockResponse());
    const result = await call(server, "ncloud_ncs_put_bucket_lifecycle", {
      bucketName: "b", mergeWithExisting: true, rules: [{ id: "r1", expiration: { days: 5 } }, { id: "new", expiration: { days: 7 } }],
    });

    const data = dataOf(result);
    expect(data.change.mode).toBe("merge");
    expect(data.change.rulesKeptFromExisting).toEqual(["keep-me"]);
    expect(data.change.rulesRemoved).toEqual([]);
    expect(data.change.resultingRuleCount).toBe(3);
    const body = (spy.mock.calls[1] as any)[0].body as string;
    // 유지된 규칙은 파싱→재직렬화를 거쳐 원래 내용대로 나간다
    expect(body).toContain("<Rule><ID>keep-me</ID><Status>Enabled</Status><Filter><Prefix>logs/</Prefix></Filter><Expiration><Days>30</Days></Expiration></Rule>");
    expect(body).toContain("<ID>r1</ID><Status>Enabled</Status><Filter><Prefix></Prefix></Filter><Expiration><Days>5</Days></Expiration>");
    expect(body).not.toContain("<Days>10</Days>");
    expect(body).toContain("<ID>new</ID>");
  });

  it("dryRun: 실제 전송 XML 과 변경 요약을 보여주고 PUT 은 하지 않는다", async () => {
    const spy = vi.spyOn(client, "request").mockResolvedValueOnce(mockResponse(existingXml));
    const result = await call(server, "ncloud_ncs_put_bucket_lifecycle", {
      bucketName: "b", dryRun: true, rules: [{ id: "x", transitions: [{ days: 30, storageClass: "DEEP_ARCHIVE" }] }],
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect((spy.mock.calls[0] as any)[0].method).toBe("GET");
    const data = dataOf(result);
    expect(data.method).toBe("PUT");
    expect(data.endpoint).toBe("https://b.kr.ncloudstorage.com/?lifecycle");
    expect(data.requestParams.body).toContain("<StorageClass>DEEP_ARCHIVE</StorageClass>");
    expect(data.change.rulesRemoved).toEqual(["keep-me", "r1"]);
  });

  it("get_bucket_lifecycle: 미설정(NoSuchLifecycleConfiguration)은 에러가 아니라 configured=false 로 돌려준다", async () => {
    noConfig();
    const data = dataOf(await call(server, "ncloud_ncs_get_bucket_lifecycle", { bucketName: "b" }));
    expect(data.configured).toBe(false);
    expect(data.rules).toEqual([]);
  });

  it("get_bucket_lifecycle: NoncurrentVersion* 과 요약을 파싱한다", async () => {
    const xml = `<LifecycleConfiguration><Rule><ID>v</ID><Status>Enabled</Status><Filter><Prefix></Prefix></Filter>
      <NoncurrentVersionTransition><NoncurrentDays>7</NoncurrentDays><StorageClass>ONEZONE_IA</StorageClass></NoncurrentVersionTransition>
      <NoncurrentVersionExpiration><NoncurrentDays>30</NoncurrentDays><NewerNoncurrentVersions>2</NewerNoncurrentVersions></NoncurrentVersionExpiration>
    </Rule></LifecycleConfiguration>`;
    vi.spyOn(client, "request").mockResolvedValueOnce(mockResponse(xml));
    const data = dataOf(await call(server, "ncloud_ncs_get_bucket_lifecycle", { bucketName: "b" }));

    expect(data.configured).toBe(true);
    expect(data.rules[0].noncurrentVersionTransitions).toEqual([{ noncurrentDays: 7, storageClass: "ONEZONE_IA" }]);
    expect(data.rules[0].noncurrentVersionExpiration).toEqual({ noncurrentDays: 30, newerNoncurrentVersions: 2 });
    expect(data.summary[0].actions).toHaveLength(2);
  });

  it("다른 에러(예: AccessDenied)는 정규화하지 않고 에러 응답으로 전파된다", async () => {
    vi.spyOn(client, "request").mockRejectedValueOnce(s3Error("AccessDenied", 403));
    const result = await call(server, "ncloud_ncs_get_bucket_lifecycle", { bucketName: "b" });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("AccessDenied");
  });
});

describe("Ncloud Storage: 버전 관리 / 위치 / Object Lock", () => {
  it("get_bucket_versioning: 빈 본문(미설정)은 NotConfigured 로 정규화한다", async () => {
    vi.spyOn(client, "request").mockResolvedValueOnce(mockResponse(""));
    const data = dataOf(await call(server, "ncloud_ncs_get_bucket_versioning", { bucketName: "b" }));
    expect(data.status).toBe("NotConfigured");
    expect(data.versioningEnabled).toBe(false);
  });

  it("put_bucket_versioning: PUT ?versioning + VersioningConfiguration 본문", async () => {
    const spy = vi.spyOn(client, "request").mockResolvedValueOnce(mockResponse());
    await call(server, "ncloud_ncs_put_bucket_versioning", { bucketName: "b", status: "Enabled" });
    const req = (spy.mock.calls[0] as any)[0];
    expect(req.method).toBe("PUT");
    expect(req.queryParams).toEqual({ versioning: "" });
    expect(req.body).toContain("<VersioningConfiguration xmlns=");
    expect(req.body).toContain("<Status>Enabled</Status>");
  });

  it("get_bucket_location: ?location → LocationConstraint", async () => {
    const spy = vi.spyOn(client, "request").mockResolvedValueOnce(mockResponse("<LocationConstraint>kr</LocationConstraint>"));
    const data = dataOf(await call(server, "ncloud_ncs_get_bucket_location", { bucketName: "b" }));
    expect((spy.mock.calls[0] as any)[0].queryParams).toEqual({ location: "" });
    expect(data.locationConstraint).toBe("kr");
  });

  it("put_object_lock_configuration: COMPLIANCE 는 confirm 없이는 실행하지 않는다", async () => {
    const spy = vi.spyOn(client, "request").mockResolvedValue(mockResponse());
    const warn = await call(server, "ncloud_ncs_put_object_lock_configuration", { bucketName: "b", mode: "COMPLIANCE", days: 30 });
    expect(textOf(warn)).toContain("confirm=true");
    expect(spy).not.toHaveBeenCalled();

    await call(server, "ncloud_ncs_put_object_lock_configuration", { bucketName: "b", mode: "COMPLIANCE", days: 30, confirm: true });
    const req = (spy.mock.calls[0] as any)[0];
    expect(req.queryParams).toEqual({ "object-lock": "" });
    expect(req.body).toContain("<ObjectLockEnabled>Enabled</ObjectLockEnabled><Rule><DefaultRetention><Mode>COMPLIANCE</Mode><Days>30</Days></DefaultRetention></Rule>");
  });

  it("put_object_lock_configuration: days/years 는 정확히 하나", async () => {
    const spy = vi.spyOn(client, "request");
    const r = await call(server, "ncloud_ncs_put_object_lock_configuration", { bucketName: "b", mode: "GOVERNANCE", days: 1, years: 1 });
    expect(r.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("create_bucket: objectLockEnabled 는 x-amz-bucket-object-lock-enabled 헤더로, 이름 규칙은 스키마로 검사한다", async () => {
    const spy = vi.spyOn(client, "request").mockResolvedValueOnce(mockResponse());
    await call(server, "ncloud_ncs_create_bucket", { bucketName: "my-bucket-01", objectLockEnabled: true, dryRun: false });
    expect((spy.mock.calls[0] as any)[0].headers["x-amz-bucket-object-lock-enabled"]).toBe("true");

    const shape = getTool(server, "ncloud_ncs_create_bucket").inputSchema.shape;
    expect(shape.bucketName.safeParse("Has.Dots").success).toBe(false);
    expect(shape.bucketName.safeParse("ab").success).toBe(false);
    expect(shape.bucketName.safeParse("-leading").success).toBe(false);
    expect(shape.bucketName.safeParse("valid-name-123").success).toBe(true);
  });

  it("head_bucket: 404 는 exists=false + 다른 서비스 힌트", async () => {
    vi.spyOn(client, "request").mockRejectedValueOnce(s3Error("NoSuchBucket", 404));
    const data = dataOf(await call(server, "ncloud_ncs_head_bucket", { bucketName: "b" }));
    expect(data.exists).toBe(false);
    expect(data.hint).toContain("ncloud_head_bucket");
  });
});

describe("Ncloud Storage: 오브젝트", () => {
  it("put_object: storageClass·SSE·Object Lock 헤더를 보낸다", async () => {
    const spy = vi.spyOn(client, "request").mockResolvedValueOnce(mockResponse("", 200, { etag: '"e1"', "x-amz-version-id": "v1" }));
    const data = dataOf(await call(server, "ncloud_ncs_put_object", {
      bucketName: "b", key: "k.txt", body: "hello", storageClass: "ONEZONE_IA", serverSideEncryption: "aws:kms",
      objectLockMode: "GOVERNANCE", objectLockRetainUntilDate: "2027-01-01T00:00:00Z", dryRun: false,
    }));
    const req = (spy.mock.calls[0] as any)[0];
    expect(req.method).toBe("PUT");
    expect(req.headers["x-amz-storage-class"]).toBe("ONEZONE_IA");
    expect(req.headers["x-amz-server-side-encryption"]).toBe("aws:kms");
    expect(req.headers["x-amz-object-lock-mode"]).toBe("GOVERNANCE");
    expect(req.headers["x-amz-object-lock-retain-until-date"]).toBe("2027-01-01T00:00:00Z");
    expect(data.etag).toBe('"e1"');
    expect(data.versionId).toBe("v1");
  });

  it("put_object: storageClass 미지정이면 헤더를 보내지 않고, dryRun(기본)은 호출하지 않는다", async () => {
    const spy = vi.spyOn(client, "request").mockResolvedValue(mockResponse());
    const preview = dataOf(await call(server, "ncloud_ncs_put_object", { bucketName: "b", key: "k.txt", body: "hello" }));
    expect(spy).not.toHaveBeenCalled();
    expect(preview.endpoint).toBe("https://b.kr.ncloudstorage.com/k.txt");

    await call(server, "ncloud_ncs_put_object", { bucketName: "b", key: "k.txt", body: "hello", dryRun: false });
    expect((spy.mock.calls[0] as any)[0].headers["x-amz-storage-class"]).toBeUndefined();
  });

  it("copy_object: 소스는 문서 형식 {bucket}/{key}(앞 슬래시 제거) + versionId, 결과 XML 파싱", async () => {
    const spy = vi.spyOn(client, "request").mockResolvedValueOnce(mockResponse("<CopyObjectResult><LastModified>2026-01-01T00:00:00Z</LastModified><ETag>\"abc\"</ETag></CopyObjectResult>"));
    const data = dataOf(await call(server, "ncloud_ncs_copy_object", {
      bucketName: "dst", key: "k.txt", copySource: "/src/k.txt", copySourceVersionId: "v9", storageClass: "DEEP_ARCHIVE", metadataDirective: "REPLACE", contentType: "text/plain",
    }));
    const req = (spy.mock.calls[0] as any)[0];
    expect(req.headers["x-amz-copy-source"]).toBe("src/k.txt?versionId=v9");
    expect(req.headers["x-amz-storage-class"]).toBe("DEEP_ARCHIVE");
    expect(req.headers["x-amz-metadata-directive"]).toBe("REPLACE");
    expect(data.etag).toBe('"abc"');
    expect(data.lastModified).toBe("2026-01-01T00:00:00Z");
  });

  it("get_object / head_object: versionId 쿼리와 Object Lock·restore·버전 헤더를 노출한다", async () => {
    const headers = {
      "content-length": "5", "content-type": "text/plain", etag: '"e"', "x-amz-version-id": "v2",
      "x-amz-storage-class": "DEEP_ARCHIVE", "x-amz-restore": 'ongoing-request="true"',
      "x-amz-object-lock-mode": "COMPLIANCE", "x-amz-object-lock-legal-hold": "ON",
    };
    const spy = vi.spyOn(client, "request").mockResolvedValue(mockResponse("hello", 200, headers));
    const head = dataOf(await call(server, "ncloud_ncs_head_object", { bucketName: "b", key: "k", versionId: "v2" }));
    expect((spy.mock.calls[0] as any)[0].queryParams).toEqual({ versionId: "v2" });
    expect(head.storageClass).toBe("DEEP_ARCHIVE");
    expect(head.restore).toBe('ongoing-request="true"');
    expect(head.objectLockMode).toBe("COMPLIANCE");
    expect(head.objectLockLegalHold).toBe("ON");
    expect(head.versionId).toBe("v2");

    const got = dataOf(await call(server, "ncloud_ncs_get_object", { bucketName: "b", key: "k", range: "bytes=0-4" }));
    expect((spy.mock.calls[1] as any)[0].headers["range"]).toBe("bytes=0-4");
    expect(got.body).toBe("hello");
  });

  it("head_object: x-amz-storage-class 가 없으면 STANDARD 로 해석하고 근거를 남긴다", async () => {
    vi.spyOn(client, "request").mockResolvedValueOnce(mockResponse("", 200, { etag: '"e"' }));
    const data = dataOf(await call(server, "ncloud_ncs_head_object", { bucketName: "b", key: "k" }));
    expect(data.storageClass).toBe("STANDARD");
    expect(data.storageClassHeader).toContain("absent");
  });

  it("head_object: 404 는 오브젝트 부재(exists:false) 로 정규화하고 버킷 부재로 오안내하지 않는다 (2026-09-17 라이브: delete marker 키)", async () => {
    vi.spyOn(client, "request").mockRejectedValueOnce(
      new S3CompatibleError({ message: "Ncloud Storage 호출 실패: HTTP 404", status: 404, code: "HTTP_404", serviceName: "Ncloud Storage", requestId: "req-dm" })
    );
    const data = dataOf(await call(server, "ncloud_ncs_head_object", { bucketName: "b", key: "v/a.txt" }));
    expect(data.exists).toBe(false);
    expect(data.statusCode).toBe(404);
    expect(data.requestId).toBe("req-dm");
    expect(data.hint).toContain("delete marker");
    expect(data.hint).toContain("ncloud_ncs_list_object_versions");
    expect(data.hint).not.toContain("Object Storage");
  });

  it("xmlUnescape: 유니코드 범위를 벗어난 문자 참조는 예외 없이 원문을 남긴다", async () => {
    const xml = `<ListBucketResult><Name>b</Name><Contents><Key>&#99999999999;x&#x110000;y</Key><Size>1</Size></Contents></ListBucketResult>`;
    vi.spyOn(client, "request").mockResolvedValueOnce(mockResponse(xml));
    const list = dataOf(await call(server, "ncloud_ncs_list_objects", { bucketName: "b" }));
    expect(list.contents[0].key).toBe("&#99999999999;x&#x110000;y");
  });

  it("list_objects / list_object_versions: 숫자 엔티티 ETag(&#34;) 를 따옴표로 복원한다 (2026-09-17 라이브 응답 형식)", async () => {
    const listXml = `<ListBucketResult><Name>b</Name><KeyCount>1</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>
  <Contents><Key>v1150/hello.txt</Key><LastModified>2026-09-16T16:20:05Z</LastModified><ETag>&#34;5d41402abc4b2a76b9719d911017c592&#34;</ETag><Size>5</Size><StorageClass>STANDARD</StorageClass></Contents></ListBucketResult>`;
    const versionsXml = `<ListVersionsResult><Name>b</Name><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>
  <Version><Key>v/a.txt</Key><VersionId>a9d1</VersionId><IsLatest>true</IsLatest><LastModified>2026-09-16T16:42:53Z</LastModified><ETag>&#x22;1b26&#x22;</ETag><Size>2</Size><StorageClass>STANDARD</StorageClass></Version></ListVersionsResult>`;
    vi.spyOn(client, "request").mockResolvedValueOnce(mockResponse(listXml)).mockResolvedValueOnce(mockResponse(versionsXml));
    const list = dataOf(await call(server, "ncloud_ncs_list_objects", { bucketName: "b" }));
    expect(list.contents[0].etag).toBe('"5d41402abc4b2a76b9719d911017c592"');
    const versions = dataOf(await call(server, "ncloud_ncs_list_object_versions", { bucketName: "b" }));
    expect(versions.versions[0].etag).toBe('"1b26"');
  });

  it("list_objects: 실제 응답 요소 순서(ETag 가 Size 보다 앞)·start-after 를 처리한다", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <Name>b</Name><Prefix>v/</Prefix><StartAfter>v/a.txt</StartAfter><KeyCount>1</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>
  <Contents><Key>v/b &amp; c.txt</Key><LastModified>2026-08-17T00:10:00.000Z</LastModified><ETag>&quot;abc123&quot;</ETag><Size>12</Size><Owner><ID>o</ID></Owner><StorageClass>ONEZONE_IA</StorageClass></Contents>
  <CommonPrefixes><Prefix>v/sub/</Prefix></CommonPrefixes>
</ListBucketResult>`;
    const spy = vi.spyOn(client, "request").mockResolvedValueOnce(mockResponse(xml));
    const data = dataOf(await call(server, "ncloud_ncs_list_objects", { bucketName: "b", prefix: "v/", startAfter: "v/a.txt", maxKeys: 5 }));
    const q = (spy.mock.calls[0] as any)[0].queryParams;
    expect(q).toEqual({ "list-type": "2", prefix: "v/", "start-after": "v/a.txt", "max-keys": "5" });
    expect(data.prefix).toBe("v/");
    expect(data.contents).toEqual([{ key: "v/b & c.txt", lastModified: "2026-08-17T00:10:00.000Z", size: 12, etag: '"abc123"', storageClass: "ONEZONE_IA" }]);
    expect(data.commonPrefixes).toEqual(["v/sub/"]);
  });

  it("list_object_versions: ?versions + Version/DeleteMarker 블록 파싱", async () => {
    const xml = `<ListBucketResult><Name>b</Name><Prefix></Prefix><MaxKeys>1000</MaxKeys><IsTruncated>true</IsTruncated><NextKeyMarker>k2</NextKeyMarker><NextVersionIdMarker>v3</NextVersionIdMarker>
      <Version><Key>k1</Key><VersionId>v1</VersionId><IsLatest>true</IsLatest><LastModified>2026-01-01T00:00:00Z</LastModified><ETag>"e"</ETag><Size>3</Size><StorageClass>STANDARD</StorageClass></Version>
      <DeleteMarker><Key>k0</Key><VersionId>d1</VersionId><IsLatest>true</IsLatest><LastModified>2026-01-02T00:00:00Z</LastModified></DeleteMarker>
    </ListBucketResult>`;
    const spy = vi.spyOn(client, "request").mockResolvedValueOnce(mockResponse(xml));
    const data = dataOf(await call(server, "ncloud_ncs_list_object_versions", { bucketName: "b", keyMarker: "k", versionIdMarker: "v" }));
    expect((spy.mock.calls[0] as any)[0].queryParams).toEqual({ versions: "", "key-marker": "k", "version-id-marker": "v" });
    expect(data.versions).toHaveLength(1);
    expect(data.versions[0]).toMatchObject({ key: "k1", versionId: "v1", isLatest: true, size: 3 });
    expect(data.deleteMarkers[0]).toMatchObject({ key: "k0", versionId: "d1" });
    expect(data.nextKeyMarker).toBe("k2");
    expect(data.isTruncated).toBe(true);
  });

  it("get_object_attributes: x-amz-object-attributes 헤더 + ?attributes, 본문 파싱", async () => {
    const xml = `<GetObjectAttributesResponse><ETag>e</ETag><ObjectSize>10</ObjectSize><StorageClass>DEEP_ARCHIVE</StorageClass><Checksum><ChecksumCRC64NVME>x</ChecksumCRC64NVME><ChecksumType>FULL_OBJECT</ChecksumType></Checksum></GetObjectAttributesResponse>`;
    const spy = vi.spyOn(client, "request").mockResolvedValueOnce(mockResponse(xml));
    const data = dataOf(await call(server, "ncloud_ncs_get_object_attributes", { bucketName: "b", key: "k" }));
    const req = (spy.mock.calls[0] as any)[0];
    expect(req.queryParams).toEqual({ attributes: "" });
    expect(req.headers["x-amz-object-attributes"]).toBe("ETag,ObjectSize,StorageClass,Checksum");
    expect(data.objectSize).toBe(10);
    expect(data.checksum.crc64nvme).toBe("x");
  });

  it("delete_object: versionId 쿼리·bypass 헤더, 삭제 마커 응답 안내", async () => {
    const spy = vi.spyOn(client, "request").mockResolvedValueOnce(mockResponse("", 204, { "x-amz-delete-marker": "true", "x-amz-version-id": "dm1" }));
    const data = dataOf(await call(server, "ncloud_ncs_delete_object", { bucketName: "b", key: "k", bypassGovernanceRetention: true, confirm: true }));
    const req = (spy.mock.calls[0] as any)[0];
    expect(req.method).toBe("DELETE");
    expect(req.headers["x-amz-bypass-governance-retention"]).toBe("true");
    expect(data.deleteMarker).toBe("true");
    expect(data.note).toContain("versionId");

    await call(server, "ncloud_ncs_delete_object", { bucketName: "b", key: "k", versionId: "v1", confirm: true });
    expect((spy.mock.calls[1] as any)[0].queryParams).toEqual({ versionId: "v1" });
  });

  it("delete_object: confirm 없이는 실행하지 않는다", async () => {
    const spy = vi.spyOn(client, "request");
    const r = await call(server, "ncloud_ncs_delete_object", { bucketName: "b", key: "k" });
    expect(textOf(r)).toContain("confirm=true");
    expect(spy).not.toHaveBeenCalled();
  });

  it("delete_objects: keys + objects(versionId) 를 합쳐 POST ?delete, 키를 XML 이스케이프, DeleteResult 파싱", async () => {
    const xml = `<DeleteResult><Deleted><Key>a</Key></Deleted><Deleted><Key>b &amp; c</Key><VersionId>v1</VersionId></Deleted><Error><Key>z</Key><Code>AccessDenied</Code><Message>locked</Message></Error></DeleteResult>`;
    const spy = vi.spyOn(client, "request").mockResolvedValueOnce(mockResponse(xml));
    const data = dataOf(await call(server, "ncloud_ncs_delete_objects", {
      bucketName: "b", keys: ["a"], objects: [{ key: "b & c", versionId: "v1" }, { key: "z" }], confirm: true,
    }));
    const req = (spy.mock.calls[0] as any)[0];
    expect(req.method).toBe("POST");
    expect(req.queryParams).toEqual({ delete: "" });
    expect(req.body).toContain("<Object><Key>a</Key></Object><Object><Key>b &amp; c</Key><VersionId>v1</VersionId></Object><Object><Key>z</Key></Object><Quiet>false</Quiet>");
    expect(data.requested).toBe(3);
    expect(data.deleted).toHaveLength(2);
    expect(data.deleted[1].key).toBe("b & c");
    expect(data.errors).toEqual([{ key: "z", code: "AccessDenied", message: "locked" }]);
    expect(data.message).toContain("⚠️");
  });

  it("delete_objects: 대상이 없으면 거부한다", async () => {
    const r = await call(server, "ncloud_ncs_delete_objects", { bucketName: "b", confirm: true });
    expect(r.isError).toBe(true);
  });

  it("restore_object: POST ?restore + RestoreRequest.Days, 202 를 시작으로 해석", async () => {
    const spy = vi.spyOn(client, "request").mockResolvedValueOnce(mockResponse("", 202));
    const data = dataOf(await call(server, "ncloud_ncs_restore_object", { bucketName: "b", key: "k", days: 3, versionId: "v1" }));
    const req = (spy.mock.calls[0] as any)[0];
    expect(req.method).toBe("POST");
    expect(req.queryParams).toEqual({ restore: "", versionId: "v1" });
    expect(req.body).toContain("<RestoreRequest xmlns=");
    expect(req.body).toContain("<Days>3</Days>");
    expect(data.statusCode).toBe(202);
    expect(data.message).toContain("✅");
  });

  it("retention: GET ?retention 파싱 / 미설정 정규화 / PUT COMPLIANCE confirm 게이트 / clear", async () => {
    const spy = vi.spyOn(client, "request")
      .mockResolvedValueOnce(mockResponse(`<Retention xmlns="x"><Mode>GOVERNANCE</Mode><RetainUntilDate>2027-01-01T00:00:00.000Z</RetainUntilDate></Retention>`))
      .mockRejectedValueOnce(s3Error("NoSuchObjectLockConfiguration", 404))
      .mockResolvedValue(mockResponse());
    const got = dataOf(await call(server, "ncloud_ncs_get_object_retention", { bucketName: "b", key: "k" }));
    expect(got).toMatchObject({ configured: true, mode: "GOVERNANCE", retainUntilDate: "2027-01-01T00:00:00.000Z" });
    const none = dataOf(await call(server, "ncloud_ncs_get_object_retention", { bucketName: "b", key: "k" }));
    expect(none.configured).toBe(false);

    const warn = await call(server, "ncloud_ncs_put_object_retention", { bucketName: "b", key: "k", mode: "COMPLIANCE", retainUntilDate: "2027-01-01T00:00:00Z" });
    expect(textOf(warn)).toContain("confirm=true");
    expect(spy).toHaveBeenCalledTimes(2);

    await call(server, "ncloud_ncs_put_object_retention", { bucketName: "b", key: "k", mode: "GOVERNANCE", retainUntilDate: "2027-01-01T00:00:00Z" });
    const put = (spy.mock.calls[2] as any)[0];
    expect(put.method).toBe("PUT");
    expect(put.queryParams).toEqual({ retention: "" });
    expect(put.body).toContain("<Mode>GOVERNANCE</Mode><RetainUntilDate>2027-01-01T00:00:00Z</RetainUntilDate>");

    await call(server, "ncloud_ncs_put_object_retention", { bucketName: "b", key: "k", clear: true, bypassGovernanceRetention: true });
    const clr = (spy.mock.calls[3] as any)[0];
    expect(clr.headers["x-amz-bypass-governance-retention"]).toBe("true");
    expect(clr.body).toMatch(/<Retention xmlns="[^"]+"><\/Retention>$/);

    const bad = await call(server, "ncloud_ncs_put_object_retention", { bucketName: "b", key: "k", mode: "GOVERNANCE" });
    expect(bad.isError).toBe(true);
  });

  it("legal hold: GET/PUT ?legal-hold", async () => {
    const spy = vi.spyOn(client, "request")
      .mockResolvedValueOnce(mockResponse(`<LegalHold><Status>ON</Status></LegalHold>`))
      .mockResolvedValueOnce(mockResponse());
    const got = dataOf(await call(server, "ncloud_ncs_get_object_legal_hold", { bucketName: "b", key: "k" }));
    expect(got.status).toBe("ON");
    await call(server, "ncloud_ncs_put_object_legal_hold", { bucketName: "b", key: "k", status: "OFF", versionId: "v1" });
    const put = (spy.mock.calls[1] as any)[0];
    expect(put.queryParams).toEqual({ "legal-hold": "", versionId: "v1" });
    expect(put.body).toContain("<LegalHold xmlns=");
    expect(put.body).toContain("<Status>OFF</Status>");
  });
});

describe("Ncloud Storage: CORS / 암호화", () => {
  it("put_bucket_cors: xmlns + ID + 요소 순서, 최대 100개", async () => {
    const spy = vi.spyOn(client, "request").mockResolvedValueOnce(mockResponse());
    await call(server, "ncloud_ncs_put_bucket_cors", {
      bucketName: "b",
      corsRules: [{ id: "web", allowedOrigins: ["https://example.com"], allowedMethods: ["GET", "PUT"], allowedHeaders: ["*"], exposeHeaders: ["ETag"], maxAgeSeconds: 3600 }],
    });
    const body = (spy.mock.calls[0] as any)[0].body as string;
    expect(body).toContain('<CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">');
    expect(body).toContain("<CORSRule><ID>web</ID><AllowedOrigin>https://example.com</AllowedOrigin><AllowedMethod>GET</AllowedMethod><AllowedMethod>PUT</AllowedMethod><AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader><MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule>");

    const shape = getTool(server, "ncloud_ncs_put_bucket_cors").inputSchema.shape;
    const tooMany = Array.from({ length: 101 }, (_, i) => ({ allowedOrigins: ["*"], allowedMethods: ["GET"], id: `r${i}` }));
    expect(shape.corsRules.safeParse(tooMany).success).toBe(false);
  });

  it("get_bucket_cors: 미설정(NoSuchCORSConfiguration)은 configured=false", async () => {
    vi.spyOn(client, "request").mockRejectedValueOnce(s3Error("NoSuchCORSConfiguration", 404));
    const data = dataOf(await call(server, "ncloud_ncs_get_bucket_cors", { bucketName: "b" }));
    expect(data.configured).toBe(false);
  });

  it("put_bucket_encryption: AES256 과 aws:kms 를 허용하고 스펙 형태의 본문을 보낸다", async () => {
    const spy = vi.spyOn(client, "request").mockResolvedValueOnce(mockResponse());
    await call(server, "ncloud_ncs_put_bucket_encryption", { bucketName: "b", sseAlgorithm: "aws:kms" });
    const body = (spy.mock.calls[0] as any)[0].body as string;
    expect(body).toContain('<ServerSideEncryptionConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Rule><ApplyServerSideEncryptionByDefault><SSEAlgorithm>aws:kms</SSEAlgorithm></ApplyServerSideEncryptionByDefault></Rule></ServerSideEncryptionConfiguration>');
    const shape = getTool(server, "ncloud_ncs_put_bucket_encryption").inputSchema.shape;
    expect(shape.sseAlgorithm.safeParse("aws:kms:dsse").success).toBe(false);
  });
});

describe("Ncloud Storage: 멀티파트", () => {
  it("create_multipart_upload: POST /{key}?uploads + 클래스 헤더, InitiateMultipartUploadResult 파싱", async () => {
    const spy = vi.spyOn(client, "request").mockResolvedValueOnce(mockResponse(`<InitiateMultipartUploadResult><Bucket>b</Bucket><Key>big.bin</Key><UploadId>u-1</UploadId></InitiateMultipartUploadResult>`));
    const data = dataOf(await call(server, "ncloud_ncs_create_multipart_upload", { bucketName: "b", key: "big.bin", storageClass: "DEEP_ARCHIVE" }));
    const req = (spy.mock.calls[0] as any)[0];
    expect(req.method).toBe("POST");
    expect(req.queryParams).toEqual({ uploads: "" });
    expect(req.headers["x-amz-storage-class"]).toBe("DEEP_ARCHIVE");
    expect(data.uploadId).toBe("u-1");
  });

  it("upload_part / upload_part_copy: partNumber·uploadId 쿼리, copy-source range", async () => {
    const spy = vi.spyOn(client, "request")
      .mockResolvedValueOnce(mockResponse("", 200, { etag: '"p1"' }))
      .mockResolvedValueOnce(mockResponse(`<CopyPartResult><LastModified>2026-01-01T00:00:00Z</LastModified><ETag>"p2"</ETag></CopyPartResult>`));
    const p1 = dataOf(await call(server, "ncloud_ncs_upload_part", { bucketName: "b", key: "k", uploadId: "u", partNumber: 1, body: "data" }));
    expect((spy.mock.calls[0] as any)[0].queryParams).toEqual({ partNumber: "1", uploadId: "u" });
    expect(p1.etag).toBe('"p1"');

    const p2 = dataOf(await call(server, "ncloud_ncs_upload_part_copy", { bucketName: "b", key: "k", uploadId: "u", partNumber: 2, copySource: "/src/big.bin", copySourceRange: "bytes=0-5242879" }));
    const req = (spy.mock.calls[1] as any)[0];
    expect(req.headers["x-amz-copy-source"]).toBe("src/big.bin");
    expect(req.headers["x-amz-copy-source-range"]).toBe("bytes=0-5242879");
    expect(p2.etag).toBe('"p2"');
  });

  it("complete_multipart_upload: 파트를 번호순으로 정렬해 xmlns 본문으로 POST ?uploadId", async () => {
    const spy = vi.spyOn(client, "request").mockResolvedValueOnce(mockResponse(`<CompleteMultipartUploadResult><Location>https://b.kr.ncloudstorage.com/k</Location><Bucket>b</Bucket><Key>k</Key><ETag>"final-2"</ETag></CompleteMultipartUploadResult>`));
    const data = dataOf(await call(server, "ncloud_ncs_complete_multipart_upload", {
      bucketName: "b", key: "k", uploadId: "u", parts: [{ partNumber: 2, etag: '"p2"' }, { partNumber: 1, etag: '"p1"' }],
    }));
    const req = (spy.mock.calls[0] as any)[0];
    expect(req.method).toBe("POST");
    expect(req.queryParams).toEqual({ uploadId: "u" });
    expect(req.body).toContain('<CompleteMultipartUpload xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Part><PartNumber>1</PartNumber><ETag>&quot;p1&quot;</ETag></Part><Part><PartNumber>2</PartNumber><ETag>&quot;p2&quot;</ETag></Part></CompleteMultipartUpload>');
    expect(data.etag).toBe('"final-2"');
    expect(data.partsAssembled).toBe(2);
  });

  it("list_parts / list_multipart_uploads: 쿼리와 파싱", async () => {
    const spy = vi.spyOn(client, "request")
      .mockResolvedValueOnce(mockResponse(`<ListPartsResult><Bucket>b</Bucket><Key>k</Key><UploadId>u</UploadId><IsTruncated>false</IsTruncated><Part><PartNumber>1</PartNumber><LastModified>2026-01-01T00:00:00Z</LastModified><ETag>"p1"</ETag><Size>5</Size></Part></ListPartsResult>`))
      .mockResolvedValueOnce(mockResponse(`<ListMultipartUploadsResult><Bucket>b</Bucket><IsTruncated>false</IsTruncated><Upload><Key>k</Key><UploadId>u</UploadId><StorageClass>STANDARD</StorageClass><Initiated>2026-01-01T00:00:00Z</Initiated></Upload></ListMultipartUploadsResult>`));
    const parts = dataOf(await call(server, "ncloud_ncs_list_parts", { bucketName: "b", key: "k", uploadId: "u", maxParts: 10 }));
    expect((spy.mock.calls[0] as any)[0].queryParams).toEqual({ uploadId: "u", "max-parts": "10" });
    expect(parts.parts).toEqual([{ partNumber: 1, lastModified: "2026-01-01T00:00:00Z", etag: '"p1"', size: 5 }]);

    const uploads = dataOf(await call(server, "ncloud_ncs_list_multipart_uploads", { bucketName: "b", prefix: "k" }));
    expect((spy.mock.calls[1] as any)[0].queryParams).toEqual({ uploads: "", prefix: "k" });
    expect(uploads.uploads[0]).toMatchObject({ key: "k", uploadId: "u" });
  });

  it("abort_multipart_upload: confirm 게이트 + DELETE ?uploadId", async () => {
    const spy = vi.spyOn(client, "request").mockResolvedValue(mockResponse("", 204));
    const warn = await call(server, "ncloud_ncs_abort_multipart_upload", { bucketName: "b", key: "k", uploadId: "u" });
    expect(textOf(warn)).toContain("confirm=true");
    expect(spy).not.toHaveBeenCalled();
    await call(server, "ncloud_ncs_abort_multipart_upload", { bucketName: "b", key: "k", uploadId: "u", confirm: true });
    const req = (spy.mock.calls[0] as any)[0];
    expect(req.method).toBe("DELETE");
    expect(req.queryParams).toEqual({ uploadId: "u" });
  });
});
