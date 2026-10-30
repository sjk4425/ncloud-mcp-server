/**
 * Object Storage 도구 단위 테스트 — 금융존 E-07 후속 실호출(2026-10-30)에서 나온 수정.
 *
 * - copy_object: 한글 키 원본이 x-amz-copy-source 헤더에 그대로 실려 fetch 가 ByteString 오류로 실패 → 세그먼트별 URL 인코딩
 * - put_object / upload_part: 크기를 글자 수가 아니라 UTF-8 바이트 수로 표시
 * - delete_multiple_objects: 실제로 5개가 지워졌는데 "0개 삭제"로 표시 → 블록 단위 파싱, 요청 키 XML 이스케이프
 * - versioning 도구 3개 제거 (Object Storage 가이드에 없고 pub·fin 모두 403)
 */

import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { S3CompatibleClient } from "../client/s3-compatible-client.js";
import { registerStorageObjectTools } from "./storage-object.js";

function setup() {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const client = new S3CompatibleClient({
    accessKey: "testAccessKey",
    secretKey: "testSecretKey",
    regionCode: "FKR",
    storageType: "object",
  } as any);
  registerStorageObjectTools(server, client);
  return { server, client };
}

async function call(server: McpServer, toolName: string, input: Record<string, unknown>): Promise<any> {
  const tools = (server as any)._registeredTools;
  const tool = tools instanceof Map ? tools.get(toolName) : tools[toolName];
  return tool.handler(tool.inputSchema.parse(input), {} as any);
}

function mockResponse(body = "", headers: Record<string, string> = {}): any {
  return { status: 200, headers: new Headers(headers), body };
}

const COPY_RESULT =
  "<CopyObjectResult><LastModified>2026-10-30T08:48:45.733Z</LastModified><ETag>&quot;abc&quot;</ETag></CopyObjectResult>";

describe("ncloud_copy_object — x-amz-copy-source 인코딩", () => {
  it("한글·공백 키는 세그먼트별로 URL 인코딩한다 (슬래시는 유지)", async () => {
    const { server, client } = setup();
    const spy = vi.spyOn(client, "request").mockResolvedValueOnce(mockResponse(COPY_RESULT));
    await call(server, "ncloud_copy_object", {
      bucketName: "dst",
      objectName: "copy.txt",
      copySource: "/src-bucket/dir/hello 한글.txt",
    });
    const header = spy.mock.calls[0][0].headers!["x-amz-copy-source"];
    expect(header).toBe("/src-bucket/dir/hello%20%ED%95%9C%EA%B8%80.txt");
    expect(/^[\x00-\xff]*$/.test(header)).toBe(true);
  });

  it("ASCII 키는 그대로 보낸다", async () => {
    const { server, client } = setup();
    const spy = vi.spyOn(client, "request").mockResolvedValueOnce(mockResponse(COPY_RESULT));
    await call(server, "ncloud_copy_object", { bucketName: "dst", objectName: "a", copySource: "/src/dir/ascii.txt" });
    expect(spy.mock.calls[0][0].headers!["x-amz-copy-source"]).toBe("/src/dir/ascii.txt");
  });

  it("이미 %XX 로 인코딩된 원본은 이중 인코딩하지 않는다", async () => {
    const { server, client } = setup();
    const spy = vi.spyOn(client, "request").mockResolvedValueOnce(mockResponse(COPY_RESULT));
    await call(server, "ncloud_copy_object", { bucketName: "dst", objectName: "a", copySource: "/src/hello%20x.txt" });
    expect(spy.mock.calls[0][0].headers!["x-amz-copy-source"]).toBe("/src/hello%20x.txt");
  });
});

describe("ncloud_copy_object — 결과 ETag", () => {
  it("&quot; 엔티티를 풀어 돌려준다", async () => {
    const { server, client } = setup();
    vi.spyOn(client, "request").mockResolvedValueOnce(mockResponse(COPY_RESULT));
    const result = await call(server, "ncloud_copy_object", { bucketName: "dst", objectName: "a", copySource: "/src/a" });
    expect(JSON.parse(result.content[0].text).etag).toBe('"abc"');
  });
});

describe("ncloud_delete_multiple_objects", () => {
  // xmlns·줄바꿈·VersionId 가 끼어도 키를 놓치지 않아야 한다 (금융존 실호출에서 5개 삭제가 "0개"로 표시됨)
  const DELETE_RESULT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <Deleted>
    <Key>dir/hello 한글.txt</Key>
  </Deleted>
  <Deleted><Key>a&amp;b.txt</Key><VersionId>null</VersionId></Deleted>
  <Error><Key>locked.txt</Key><Code>AccessDenied</Code><Message>Access Denied</Message></Error>
</DeleteResult>`;

  it("삭제·실패 항목을 블록 단위로 파싱하고 키 엔티티를 푼다", async () => {
    const { server, client } = setup();
    vi.spyOn(client, "request").mockResolvedValueOnce(mockResponse(DELETE_RESULT));
    const result = await call(server, "ncloud_delete_multiple_objects", {
      bucketName: "b",
      objectKeys: ["dir/hello 한글.txt", "a&b.txt", "locked.txt"],
      confirm: true,
    });
    const data = JSON.parse(result.content[0].text);
    expect(data.deleted).toEqual(["dir/hello 한글.txt", "a&b.txt"]);
    expect(data.errors).toEqual([{ key: "locked.txt", code: "AccessDenied", message: "Access Denied" }]);
  });

  it("빈 <DeleteResult/> 응답(금융존 실응답)이면 오류 없는 요청 키를 삭제된 것으로 표시한다", async () => {
    const { server, client } = setup();
    vi.spyOn(client, "request").mockResolvedValueOnce(
      mockResponse(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"/>`),
    );
    const result = await call(server, "ncloud_delete_multiple_objects", { bucketName: "b", objectKeys: ["a", "b"], confirm: true });
    const data = JSON.parse(result.content[0].text);
    expect(data.deleted).toEqual(["a", "b"]);
    expect(data.errors).toBeUndefined();
    expect(data.message).toContain("2");
  });

  it("빈 결과에 Error 만 있으면 그 키는 삭제 목록에서 뺀다", async () => {
    const { server, client } = setup();
    vi.spyOn(client, "request").mockResolvedValueOnce(
      mockResponse(`<DeleteResult><Error><Key>b</Key><Code>AccessDenied</Code><Message>Access Denied</Message></Error></DeleteResult>`),
    );
    const result = await call(server, "ncloud_delete_multiple_objects", { bucketName: "b", objectKeys: ["a", "b"], confirm: true });
    const data = JSON.parse(result.content[0].text);
    expect(data.deleted).toEqual(["a"]);
    expect(data.errors).toHaveLength(1);
  });

  it("요청 본문의 키를 XML 이스케이프한다", async () => {
    const { server, client } = setup();
    const spy = vi.spyOn(client, "request").mockResolvedValueOnce(mockResponse("<DeleteResult></DeleteResult>"));
    await call(server, "ncloud_delete_multiple_objects", { bucketName: "b", objectKeys: ["a&b<c>.txt"], confirm: true });
    expect(spy.mock.calls[0][0].body).toContain("<Key>a&amp;b&lt;c&gt;.txt</Key>");
  });
});

describe("ncloud_list_objects — 키 엔티티 복원", () => {
  it("a&amp;b.txt 를 a&b.txt 로 돌려준다 (Contents·CommonPrefixes)", async () => {
    const { server, client } = setup();
    vi.spyOn(client, "request").mockResolvedValueOnce(
      mockResponse(
        `<ListBucketResult><Name>b</Name><Prefix></Prefix><IsTruncated>false</IsTruncated>` +
          `<Contents><Key>dir/a&amp;b.txt</Key><LastModified>2026-10-30T09:09:23.280Z</LastModified><ETag>&quot;x&quot;</ETag><Size>3</Size><StorageClass>STANDARD</StorageClass></Contents>` +
          `<CommonPrefixes><Prefix>r&amp;d/</Prefix></CommonPrefixes></ListBucketResult>`,
      ),
    );
    const result = await call(server, "ncloud_list_objects", { bucketName: "b" });
    const data = JSON.parse(result.content[0].text);
    expect(data.contents[0].key).toBe("dir/a&b.txt");
    expect(data.commonPrefixes).toEqual(["r&d/"]);
  });
});

describe("Object Storage versioning 도구 제거 (가이드에 없음, pub·fin 403)", () => {
  it.each(["ncloud_get_bucket_versioning", "ncloud_put_bucket_versioning", "ncloud_list_object_versions"])(
    "%s 는 등록되지 않는다",
    (name) => {
      const { server } = setup();
      const tools = (server as any)._registeredTools;
      expect(tools instanceof Map ? tools.has(name) : Boolean(tools[name])).toBe(false);
    },
  );
});

describe("업로드 크기 표시 — UTF-8 바이트 수", () => {
  const body = "hello fin zone 금융존 테스트"; // 22 글자, 34 바이트

  it("put_object 결과 크기", async () => {
    const { server, client } = setup();
    vi.spyOn(client, "request").mockResolvedValueOnce(mockResponse());
    const result = await call(server, "ncloud_put_object", { bucketName: "b", key: "k", body });
    expect(result.content[0].text).toContain("34 bytes");
  });

  it("put_object dryRun 프리뷰 크기", async () => {
    const { server, client } = setup();
    const spy = vi.spyOn(client, "request");
    const result = await call(server, "ncloud_put_object", { bucketName: "b", key: "k", body, dryRun: true });
    expect(spy).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("34 bytes");
  });
});
