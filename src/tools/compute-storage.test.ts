/**
 * Block Storage / Snapshot 도구 단위 테스트.
 *
 * MCP-BUG-REPORT #1: `ncloud_create_snapshot` 이 원본 볼륨을 도구 입력명
 * `blockStorageInstanceNo` 그대로 전송해 NCP 가 필수 필드 누락(900)을 반환하던 버그.
 * API 파라미터명은 `originalBlockStorageInstanceNo` 다.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerComputeStorageTools } from "./compute-storage.js";

function createMockClient(): NcloudClient {
  return new NcloudClient({
    accessKey: "testAccessKey",
    secretKey: "testSecretKey",
    baseUrl: "https://ncloud.apigw.ntruss.com",
    regionCode: "KR",
  });
}

function getToolHandler(server: McpServer, toolName: string): any {
  const tools = (server as any)._registeredTools;
  if (!tools) throw new Error("No registered tools found on server");
  const entry = tools instanceof Map ? tools.get(toolName) : tools[toolName];
  if (!entry) throw new Error(`Tool ${toolName} not found`);
  return entry.handler;
}

describe("ncloud_create_snapshot: 원본 볼륨 파라미터 매핑 (BUG-REPORT #1)", () => {
  let server: McpServer;
  let client: NcloudClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerComputeStorageTools(server, client);
  });

  it("blockStorageInstanceNo 를 originalBlockStorageInstanceNo 로 변환해 전송한다", async () => {
    const spy = vi.spyOn(client, "request").mockResolvedValue({ returnCode: "0" });
    const handler = getToolHandler(server, "ncloud_create_snapshot");
    await handler(
      {
        blockStorageInstanceNo: "10000001",
        blockStorageSnapshotName: "data-volume-snapshot",
        blockStorageSnapshotDescription: "zone=KR-1",
        dryRun: false,
      },
      {} as any
    );

    expect(spy).toHaveBeenCalledTimes(1);
    const [path, params] = spy.mock.calls[0] as [string, any];
    expect(path).toBe("/vserver/v2/createBlockStorageSnapshotInstance");
    expect(params.originalBlockStorageInstanceNo).toBe("10000001");
    // 잘못된 이름은 더 이상 전송되지 않아야 한다(NCP 900 원인).
    expect(params.blockStorageInstanceNo).toBeUndefined();
    expect(params.blockStorageSnapshotName).toBe("data-volume-snapshot");
    expect(params.blockStorageSnapshotDescription).toBe("zone=KR-1");
    spy.mockRestore();
  });

  it("API 이름(originalBlockStorageInstanceNo)으로도 호출할 수 있고, 둘 다 주면 그쪽이 우선한다", async () => {
    const spy = vi.spyOn(client, "request").mockResolvedValue({ returnCode: "0" });
    const handler = getToolHandler(server, "ncloud_create_snapshot");

    await handler({ originalBlockStorageInstanceNo: "111", dryRun: false }, {} as any);
    expect((spy.mock.calls[0] as any)[1].originalBlockStorageInstanceNo).toBe("111");

    await handler(
      { originalBlockStorageInstanceNo: "111", blockStorageInstanceNo: "222", dryRun: false },
      {} as any
    );
    expect((spy.mock.calls[1] as any)[1].originalBlockStorageInstanceNo).toBe("111");
    spy.mockRestore();
  });

  it("원본 볼륨 번호가 없으면 API 를 호출하지 않고 에러를 반환한다", async () => {
    const spy = vi.spyOn(client, "request");
    const handler = getToolHandler(server, "ncloud_create_snapshot");
    const result = await handler({ blockStorageSnapshotName: "no-source" }, {} as any);

    expect(spy).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("originalBlockStorageInstanceNo");
    spy.mockRestore();
  });

  it("snapshotTypeCode / regionCode 는 지정 시에만 전송된다", async () => {
    const spy = vi.spyOn(client, "request").mockResolvedValue({ returnCode: "0" });
    const handler = getToolHandler(server, "ncloud_create_snapshot");

    await handler({ blockStorageInstanceNo: "1", dryRun: false }, {} as any);
    const bare = (spy.mock.calls[0] as any)[1];
    expect(bare.snapshotTypeCode).toBeUndefined();
    expect(bare.regionCode).toBeUndefined();

    await handler(
      { blockStorageInstanceNo: "1", snapshotTypeCode: "INCREMENTAL", regionCode: "SGN", dryRun: false },
      {} as any
    );
    const full = (spy.mock.calls[1] as any)[1];
    expect(full.snapshotTypeCode).toBe("INCREMENTAL");
    expect(full.regionCode).toBe("SGN");
    spy.mockRestore();
  });

  it("dryRun: snapshotTypeCode 지정 시 KVM 무시 경고를 띄운다 (라이브 실측 T-A7)", async () => {
    const handler = getToolHandler(server, "ncloud_create_snapshot");

    const withType = await handler(
      { blockStorageInstanceNo: "1", snapshotTypeCode: "INCREMENTAL", dryRun: true },
      {} as any
    );
    expect(JSON.parse(withType.content[0].text).warning_snapshotTypeCode).toContain("XEN");

    // 미지정이면 불필요한 경고를 띄우지 않는다
    const without = await handler({ blockStorageInstanceNo: "1", dryRun: true }, {} as any);
    expect(JSON.parse(without.content[0].text).warning_snapshotTypeCode).toBeUndefined();
  });

  it("dryRun 은 API 를 호출하지 않고 실제 전송 파라미터명을 프리뷰로 보여준다", async () => {
    const spy = vi.spyOn(client, "request");
    const handler = getToolHandler(server, "ncloud_create_snapshot");
    const result = await handler({ blockStorageInstanceNo: "10000001", dryRun: true }, {} as any);

    expect(spy).not.toHaveBeenCalled();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.label).toContain("Dry-Run");
    expect(parsed.requestParams.originalBlockStorageInstanceNo).toBe("10000001");
    // BUG-REPORT #2: 서버측 검증을 하지 않는다는 한계가 문구에 있어야 한다.
    expect(parsed.message).toContain("서버측 유효성은 검증하지 않");
    spy.mockRestore();
  });
});
