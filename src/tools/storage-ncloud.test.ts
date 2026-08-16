/**
 * Ncloud Storage 스토리지 클래스 단위 테스트.
 *
 * 클래스는 STANDARD(기본) / ONEZONE_IA / DEEP_ARCHIVE 세 가지이며, 저장 시점에는
 * `x-amz-storage-class` 헤더로, 라이프사이클에서는 Transition 대상으로 지정한다.
 * 라이프사이클 전환 대상은 STANDARD 를 제외한 두 클래스뿐이다.
 * (AWS S3 의 STANDARD_IA/GLACIER 는 이 서비스에 없다)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { S3CompatibleClient } from "../client/s3-compatible-client.js";
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

function mockResponse(body = ""): any {
  return { status: 200, headers: new Headers(), body };
}

describe("Ncloud Storage: 스토리지 클래스 (ONEZONE_IA 추가)", () => {
  let server: McpServer;
  let client: S3CompatibleClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerStorageNcloudTools(server, client);
  });

  it("put_object: storageClass 를 x-amz-storage-class 헤더로 보낸다", async () => {
    const spy = vi.spyOn(client, "request").mockResolvedValue(mockResponse());
    const handler = getTool(server, "ncloud_ncs_put_object").handler;
    await handler(
      { bucketName: "b", key: "k.txt", body: "hello", storageClass: "ONEZONE_IA", dryRun: false },
      {} as any
    );

    const req = (spy.mock.calls[0] as any)[0];
    expect(req.method).toBe("PUT");
    expect(req.headers["x-amz-storage-class"]).toBe("ONEZONE_IA");
    spy.mockRestore();
  });

  it("put_object: storageClass 미지정이면 헤더를 보내지 않는다 (API 기본값 STANDARD)", async () => {
    const spy = vi.spyOn(client, "request").mockResolvedValue(mockResponse());
    const handler = getTool(server, "ncloud_ncs_put_object").handler;
    await handler({ bucketName: "b", key: "k.txt", body: "hello", dryRun: false }, {} as any);

    const req = (spy.mock.calls[0] as any)[0];
    expect(req.headers["x-amz-storage-class"]).toBeUndefined();
    spy.mockRestore();
  });

  it("put_object: dryRun 프리뷰에 적용될 클래스가 보인다", async () => {
    const spy = vi.spyOn(client, "request");
    const handler = getTool(server, "ncloud_ncs_put_object").handler;
    const result = await handler(
      { bucketName: "b", key: "k.txt", body: "hello", storageClass: "DEEP_ARCHIVE", dryRun: true },
      {} as any
    );

    expect(spy).not.toHaveBeenCalled();
    expect(JSON.parse(result.content[0].text).storageClass).toBe("DEEP_ARCHIVE");
    spy.mockRestore();
  });

  it("copy_object: copy-source 와 storageClass 를 함께 보낸다", async () => {
    const spy = vi.spyOn(client, "request").mockResolvedValue(mockResponse("<CopyObjectResult/>"));
    const handler = getTool(server, "ncloud_ncs_copy_object").handler;
    await handler(
      { bucketName: "dst", key: "k.txt", copySource: "/src/k.txt", storageClass: "ONEZONE_IA" },
      {} as any
    );

    const req = (spy.mock.calls[0] as any)[0];
    expect(req.headers["x-amz-copy-source"]).toBe("/src/k.txt");
    expect(req.headers["x-amz-storage-class"]).toBe("ONEZONE_IA");
    spy.mockRestore();
  });

  it("put_object / copy_object: 유효하지 않은 클래스는 스키마에서 거부된다", () => {
    for (const name of ["ncloud_ncs_put_object", "ncloud_ncs_copy_object"]) {
      const shape = getTool(server, name).inputSchema.shape;
      expect(shape.storageClass.safeParse("ONEZONE_IA").success).toBe(true);
      expect(shape.storageClass.safeParse("STANDARD").success).toBe(true);
      expect(shape.storageClass.safeParse("DEEP_ARCHIVE").success).toBe(true);
      // AWS S3 클래스명은 Ncloud Storage 에 없다
      expect(shape.storageClass.safeParse("STANDARD_IA").success).toBe(false);
      expect(shape.storageClass.safeParse("GLACIER").success).toBe(false);
    }
  });

  it("list_objects: 실제 응답 요소 순서(ETag가 Size보다 앞)를 파싱한다", async () => {
    // 이전 구현은 <Size> 다음 <ETag>를 요구해 전 항목이 조용히 누락됐다(라이브 실측).
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <Name>b</Name><Prefix>v1110/</Prefix><KeyCount>2</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>
  <Contents>
    <Key>v1110/onezone.txt</Key>
    <LastModified>2026-08-17T00:10:00.000Z</LastModified>
    <ETag>&quot;abc123&quot;</ETag>
    <Size>12</Size>
    <Owner><ID>owner-id</ID><DisplayName>owner</DisplayName></Owner>
    <StorageClass>ONEZONE_IA</StorageClass>
  </Contents>
  <Contents>
    <Key>v1110/standard.txt</Key>
    <LastModified>2026-08-17T00:11:00.000Z</LastModified>
    <ETag>&quot;def456&quot;</ETag>
    <Size>5</Size>
    <StorageClass>STANDARD</StorageClass>
  </Contents>
</ListBucketResult>`;
    const spy = vi.spyOn(client, "request").mockResolvedValue(mockResponse(xml));
    const handler = getTool(server, "ncloud_ncs_list_objects").handler;
    const result = await handler({ bucketName: "b", prefix: "v1110/" }, {} as any);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.contents).toHaveLength(2);
    expect(parsed.contents[0].key).toBe("v1110/onezone.txt");
    expect(parsed.contents[0].storageClass).toBe("ONEZONE_IA");
    expect(parsed.contents[0].size).toBe(12);
    expect(parsed.contents[0].etag).toContain("abc123");
    // Owner 블록이 없는 항목도 동일하게 파싱된다
    expect(parsed.contents[1].storageClass).toBe("STANDARD");
    spy.mockRestore();
  });

  it("list_buckets: 블록 분리 파싱으로 버킷 목록을 반환한다", async () => {
    const xml = `<ListAllMyBucketsResult><Buckets>
      <Bucket><Name>b1</Name><CreationDate>2026-01-01T00:00:00.000Z</CreationDate></Bucket>
      <Bucket><Name>b2</Name><CreationDate>2026-02-02T00:00:00.000Z</CreationDate></Bucket>
    </Buckets></ListAllMyBucketsResult>`;
    const spy = vi.spyOn(client, "request").mockResolvedValue(mockResponse(xml));
    const handler = getTool(server, "ncloud_ncs_list_buckets").handler;
    const result = await handler({}, {} as any);

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.buckets.map((b: any) => b.name)).toEqual(["b1", "b2"]);
    spy.mockRestore();
  });

  it("head_object: x-amz-storage-class 를 노출하고, 없으면 STANDARD 로 해석한다", async () => {
    const handler = getTool(server, "ncloud_ncs_head_object").handler;

    const withClass = { status: 200, headers: new Headers({ "x-amz-storage-class": "ONEZONE_IA" }), body: "" };
    let spy = vi.spyOn(client, "request").mockResolvedValue(withClass as any);
    let parsed = JSON.parse((await handler({ bucketName: "b", key: "k" }, {} as any)).content[0].text);
    expect(parsed.storageClass).toBe("ONEZONE_IA");
    spy.mockRestore();

    // STANDARD 는 헤더가 생략된다 — 해석 근거를 storageClassHeader 로 남긴다
    spy = vi.spyOn(client, "request").mockResolvedValue(mockResponse());
    parsed = JSON.parse((await handler({ bucketName: "b", key: "k" }, {} as any)).content[0].text);
    expect(parsed.storageClass).toBe("STANDARD");
    expect(parsed.storageClassHeader).toContain("absent");
    spy.mockRestore();
  });

  it("put_bucket_lifecycle: 전환 대상은 ONEZONE_IA / DEEP_ARCHIVE 뿐이다", async () => {
    const spy = vi.spyOn(client, "request").mockResolvedValue(mockResponse());
    const handler = getTool(server, "ncloud_put_bucket_lifecycle").handler;
    await handler(
      {
        bucketName: "b",
        rules: [{ id: "r1", status: "Enabled", prefix: "logs/", transitions: [{ days: 30, storageClass: "ONEZONE_IA" }] }],
        dryRun: false,
      },
      {} as any
    );

    const req = (spy.mock.calls[0] as any)[0];
    expect(req.body).toContain("<StorageClass>ONEZONE_IA</StorageClass>");
    spy.mockRestore();
  });

  it("put_bucket_lifecycle: STANDARD 로의 전환·AWS 클래스명은 스키마에서 거부된다", () => {
    const shape = getTool(server, "ncloud_put_bucket_lifecycle").inputSchema.shape;
    const transitionClass = shape.rules.element.shape.transitions.unwrap().element.shape.storageClass;
    expect(transitionClass.safeParse("ONEZONE_IA").success).toBe(true);
    expect(transitionClass.safeParse("DEEP_ARCHIVE").success).toBe(true);
    // 상위 클래스 복귀 전환은 없고, GLACIER/STANDARD_IA 는 서비스에 존재하지 않는다
    expect(transitionClass.safeParse("STANDARD").success).toBe(false);
    expect(transitionClass.safeParse("GLACIER").success).toBe(false);
  });
});
