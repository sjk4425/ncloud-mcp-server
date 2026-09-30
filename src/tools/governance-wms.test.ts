import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerWmsTools } from "./governance-wms.js";

/** WMS 5종 — management-wms-* 페이지(두 존 동일) 계약. */
describe("WMS", () => {
  let server: McpServer;
  let client: NcloudClient;
  const call = (name: string, args: any) => {
    const tools = (server as any)._registeredTools;
    const e = tools instanceof Map ? tools.get(name) : tools[name];
    return e.handler(e.inputSchema.parse(args), {} as any);
  };
  beforeEach(() => {
    server = new McpServer({ name: "t", version: "1.0.0" });
    client = new NcloudClient({ accessKey: "k", secretKey: "s", baseUrl: "https://wms.apigw.ntruss.com", regionCode: "KR" });
    registerWmsTools(server, client);
  });

  it("경로·메서드·쿼리가 가이드와 일치한다", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({});
    await call("ncloud_wms_list_monitors", {});
    await call("ncloud_wms_get_monitor", { scenarioId: 7 });
    await call("ncloud_wms_get_results", { scenarioId: 7, from: 1700000000, to: 1700003600, type: "MIN5", resultStatus: "ERROR", locationTypeCodes: "KR,JP" });
    await call("ncloud_wms_get_result_detail", { scenarioId: 7, resultId: 99, type: "RAW" });
    await call("ncloud_wms_set_status", { scenarioId: 7, serviceYn: false });
    expect(spy.mock.calls.map((c) => [c[0], c[1], c[2], c[3]])).toEqual([
      ["GET", "/api/v1/scenarios", undefined, undefined],
      ["GET", "/api/v1/scenarios/7", undefined, undefined],
      ["GET", "/api/v1/scenarios/7/results", { from: "1700000000", to: "1700003600", type: "MIN5", resultStatus: "ERROR", locationTypeCodes: "KR,JP" }, undefined],
      ["GET", "/api/v1/scenarios/7/results/99", { type: "RAW" }, undefined],
      ["PUT", "/api/v1/scenarios/7/settings", undefined, { serviceYn: false }],
    ]);
  });
  it("type 은 RAW|MIN5|MIN30|HOUR2|DAY1 만 허용", () => {
    expect(() => call("ncloud_wms_get_results", { scenarioId: 1, from: 1, to: 2, type: "MIN1" })).toThrow();
  });
});
