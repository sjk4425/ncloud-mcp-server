import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerDataFlowTools } from "./analytics-dataflow.js";

function setup() {
  const server = new McpServer({ name: "t", version: "1.0.0" });
  const client = new NcloudClient({ accessKey: "k", secretKey: "s", baseUrl: "https://dataflow.apigw.ntruss.com", regionCode: "KR" });
  registerDataFlowTools(server, client);
  const tools = (server as any)._registeredTools;
  const entry = (n: string) => (tools instanceof Map ? tools.get(n) : tools[n]);
  return { client, call: (n: string, a: any) => entry(n).handler(entry(n).inputSchema.parse(a), {} as any) };
}

describe("Data Flow — 가이드 대조 경로 (2026-10-02)", () => {
  it("통계 3종: /api/v1/stats/executions-interval | executions | execution-times + startDate/endDate", async () => {
    const t = setup();
    const spy = vi.spyOn(t.client, "requestRaw").mockResolvedValue({});
    const range = { startDate: "2026-09-25T00:00:00", endDate: "2026-10-02T00:00:00" };
    await t.call("ncloud_dataflow_get_execution_interval", range);
    expect(spy).toHaveBeenLastCalledWith("GET", "/api/v1/stats/executions-interval", range);
    await t.call("ncloud_dataflow_get_execution_result", range);
    expect(spy).toHaveBeenLastCalledWith("GET", "/api/v1/stats/executions", range);
    await t.call("ncloud_dataflow_get_execution_times", range);
    expect(spy).toHaveBeenLastCalledWith("GET", "/api/v1/stats/execution-times", range);
  });
  it("executeWorkflow (가이드 슬러그 executeworkflow): POST /api/v1/workflows/{id}/executions", async () => {
    const t = setup();
    const spy = vi.spyOn(t.client, "requestRaw").mockResolvedValue({});
    await t.call("ncloud_dataflow_execute_workflow", { workflowId: "wf1" });
    expect(spy).toHaveBeenCalledWith("POST", "/api/v1/workflows/wf1/executions");
  });
});
