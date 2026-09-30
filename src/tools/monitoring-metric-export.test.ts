import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerCloudInsightMetricExportTools } from "./monitoring-cloud-insight-plugin.js";

/**
 * Cloud Insight Metric Export — 금융존 가이드에만 문서화된 오퍼레이션(management-cloudinsight-*metricexport*, 2026-09-30).
 * 경로 /cw_fea/real/cw/api/metric-export, 바디는 common-apidatatype-postmetricexport / putmetricexport.
 */
function setup() {
  const server = new McpServer({ name: "t", version: "1.0.0" });
  const client = new NcloudClient({ accessKey: "k", secretKey: "s", baseUrl: "https://cw.apigw.fin-ntruss.com", regionCode: "FKR" });
  registerCloudInsightMetricExportTools(server, client);
  const tools = (server as any)._registeredTools;
  const entry = (name: string) => (tools instanceof Map ? tools.get(name) : tools[name]);
  return { client, call: (name: string, args: any) => entry(name).handler(entry(name).inputSchema.parse(args), {} as any) };
}

describe("Cloud Insight Metric Export (fin)", () => {
  it("목록·상세·실패 이력은 GET metric-export/list, /{id}, /{id}/failed-status", async () => {
    const s = setup();
    const spy = vi.spyOn(s.client, "requestRaw").mockResolvedValue({});
    await s.call("ncloud_list_metric_exports", { keyword: "ci", pageNum: 1, pageSize: 100 });
    expect(spy).toHaveBeenCalledWith("GET", "/cw_fea/real/cw/api/metric-export/list", { keyword: "ci", pageNum: 1, pageSize: 100 });
    await s.call("ncloud_get_metric_export", { metricExportId: "111" });
    expect(spy).toHaveBeenCalledWith("GET", "/cw_fea/real/cw/api/metric-export/111");
    await s.call("ncloud_get_metric_export_failed_status", { metricExportId: "111", pageNum: 2 });
    expect(spy).toHaveBeenCalledWith("GET", "/cw_fea/real/cw/api/metric-export/111/failed-status", { pageNum: 2 });
  });
  it("생성은 POST 바디(name/productKey/interval/aggregation/destination + 선택 metrics/targets), 수정은 PUT /{id} (productKey 없음)", async () => {
    const s = setup();
    const post = vi.spyOn(s.client, "postRequest").mockResolvedValue(999 as any);
    const put = vi.spyOn(s.client, "putRequest").mockResolvedValue({} as any);
    const dest = { type: "OBS", regionCode: "FKR", resourceId: "my-bucket" };
    await s.call("ncloud_create_metric_export", { name: "n", productKey: "pk", interval: "Min1", aggregation: "AVG", metrics: ["avg_cpu_used_rto"], destination: dest });
    expect(post).toHaveBeenCalledWith("/cw_fea/real/cw/api/metric-export", { name: "n", productKey: "pk", interval: "Min1", aggregation: "AVG", metrics: ["avg_cpu_used_rto"], destination: dest });
    await s.call("ncloud_update_metric_export", { metricExportId: "111", name: "n2", interval: "Day1", aggregation: "SUM", destination: dest });
    expect(put).toHaveBeenCalledWith("/cw_fea/real/cw/api/metric-export/111", { name: "n2", interval: "Day1", aggregation: "SUM", destination: dest });
    expect(JSON.stringify(put.mock.calls[0][1])).not.toContain("productKey");
  });
  it("삭제는 confirm 게이트 뒤 DELETE /{id}", async () => {
    const s = setup();
    const spy = vi.spyOn(s.client, "requestRaw").mockResolvedValue({});
    const preview = await s.call("ncloud_delete_metric_export", { metricExportId: "999" });
    expect(JSON.stringify(preview)).toContain("confirm=true");
    expect(spy).not.toHaveBeenCalled();
    await s.call("ncloud_delete_metric_export", { metricExportId: "999", confirm: true });
    expect(spy).toHaveBeenCalledWith("DELETE", "/cw_fea/real/cw/api/metric-export/999");
  });
});
