import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerComputeServerTools } from "./compute-server.js";

/** mcp-test-report-20260915 F-05: get_server_detail 이 list 와 동일 페이로드만 돌려주던 문제. */

function createMockClient(): NcloudClient {
  return new NcloudClient({ accessKey: "a", secretKey: "b", baseUrl: "https://ncloud.apigw.ntruss.com", regionCode: "KR" });
}

function getToolHandler(server: McpServer, toolName: string): any {
  const tools = (server as any)._registeredTools;
  const entry = tools instanceof Map ? tools.get(toolName) : tools[toolName];
  if (!entry) throw new Error(`Tool ${toolName} not found`);
  // SDK와 동일하게 inputSchema 파싱(기본값 includeRelated=true 적용) 후 호출한다.
  return (args: any, extra: any) => entry.handler(entry.inputSchema.parse(args), extra);
}

const DETAIL = { totalRows: 1, serverInstanceList: [{ serverInstanceNo: "145353154", serverName: "ksj-source-repo", serverProductCode: "SVR.VSVR.HICPU.C004.M008.G003" }] };
const BS = { blockStorageInstanceList: [{ blockStorageInstanceNo: "1", blockStorageName: "boot", blockStorageSize: 53687091200, blockStorageType: { code: "SVRBS" }, blockStorageVolumeType: { code: "CB1" }, blockStorageInstanceStatusName: "attached", deviceName: "/dev/xvda", blockStorageProductCode: "SPBSTBSTBS000005" }] };
const TAGS = { instanceTagList: [{ instanceNo: "145353154", tagKey: "env", tagValue: "dev" }] };

describe("ncloud_get_server_detail — 연결 리소스 요약 (F-05)", () => {
  let server: McpServer;
  let client: NcloudClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerComputeServerTools(server, client);
  });

  it("기본: 서버 본체 + 블록스토리지 요약(GB 환산·상품코드) + 태그를 함께 돌려준다", async () => {
    const spy = vi.spyOn(client, "request").mockImplementation(async (path: string) => {
      if (path.endsWith("getServerInstanceDetail")) return DETAIL;
      if (path.endsWith("getBlockStorageInstanceList")) return BS;
      if (path.endsWith("getInstanceTagList")) return TAGS;
      throw new Error("unexpected " + path);
    });
    const res = await getToolHandler(server, "ncloud_get_server_detail")({ serverInstanceNo: "145353154" }, {} as any);
    const out = JSON.parse(res.content[0].text);
    expect(out.serverInstance.serverInstanceNo).toBe("145353154");
    expect(out.blockStorages).toEqual([{
      blockStorageInstanceNo: "1", blockStorageName: "boot", sizeGB: 50, type: "SVRBS", volumeType: "CB1",
      status: "attached", deviceName: "/dev/xvda", blockStorageProductCode: "SPBSTBSTBS000005",
    }]);
    expect(out.tags).toEqual([{ key: "env", value: "dev" }]);
    expect(out.pricingHint).toContain("ncloud_get_product_price_list");
    expect(spy).toHaveBeenCalledWith("/vserver/v2/getBlockStorageInstanceList", { serverInstanceNo: "145353154" });
    expect(spy).toHaveBeenCalledWith("/vserver/v2/getInstanceTagList", { instanceNoList: ["145353154"] });
    spy.mockRestore();
  });

  it("관련 조회가 실패해도 본체 상세는 돌려주고 relatedErrors 로 알린다", async () => {
    vi.spyOn(client, "request").mockImplementation(async (path: string) => {
      if (path.endsWith("getServerInstanceDetail")) return DETAIL;
      if (path.endsWith("getBlockStorageInstanceList")) return BS;
      throw new Error("tag api down");
    });
    const res = await getToolHandler(server, "ncloud_get_server_detail")({ serverInstanceNo: "145353154" }, {} as any);
    const out = JSON.parse(res.content[0].text);
    expect(res.isError).toBeUndefined();
    expect(out.serverInstance.serverName).toBe("ksj-source-repo");
    expect(out.blockStorages).toHaveLength(1);
    expect(out.tags).toBeUndefined();
    expect(out.relatedErrors.tags).toContain("tag api down");
  });

  it("includeRelated=false 면 추가 호출 없이 원래 페이로드를 그대로 돌려준다", async () => {
    const spy = vi.spyOn(client, "request").mockResolvedValue(DETAIL);
    const res = await getToolHandler(server, "ncloud_get_server_detail")({ serverInstanceNo: "145353154", includeRelated: false }, {} as any);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(res.content[0].text)).toEqual(DETAIL);
    spy.mockRestore();
  });

  it("서버가 없으면(빈 목록) 추가 호출 없이 원래 응답을 돌려준다", async () => {
    const spy = vi.spyOn(client, "request").mockResolvedValue({ totalRows: 0, serverInstanceList: [] });
    await getToolHandler(server, "ncloud_get_server_detail")({ serverInstanceNo: "0" }, {} as any);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
