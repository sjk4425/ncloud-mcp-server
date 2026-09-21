import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerCloudDataStreamingTools } from "./analytics-cdss.js";

/**
 * 2026-09-17 Ncloud 릴리스 노트: "클러스터 CMAK 재시작 API 제공 종료", 조회 응답의 cmakPort/cmakVersion/
 * result.cmakStatus Deprecated. 도구 제거와 deprecated 안내 문구를 고정한다.
 */
function registered(): Map<string, any> {
  const server = new McpServer({ name: "t", version: "1" });
  const client = new NcloudClient({ accessKey: "a", secretKey: "b", baseUrl: "https://clouddatastreamingservice.apigw.ntruss.com", regionCode: "KR" });
  registerCloudDataStreamingTools(server, client);
  const tools = (server as any)._registeredTools;
  return tools instanceof Map ? tools : new Map(Object.entries(tools));
}

describe("CDSS — CMAK 폐기 반영 (2026-09-17)", () => {
  it("ncloud_cdss_restart_cmak is no longer registered; restart_all_services remains as the replacement", () => {
    const tools = registered();
    expect(tools.has("ncloud_cdss_restart_cmak")).toBe(false);
    expect(tools.has("ncloud_cdss_restart_all_services")).toBe(true);
    expect(tools.has("ncloud_cdss_restart_kafka")).toBe(true);
  });

  it("read tools whose responses carry cmak* fields say they are deprecated", () => {
    const tools = registered();
    for (const name of ["ncloud_cdss_list_clusters", "ncloud_cdss_get_cluster_status", "ncloud_cdss_rolling_restart_status", "ncloud_cdss_upgrade_status"]) {
      expect(tools.get(name)?.description, name).toMatch(/deprecated/i);
      expect(tools.get(name)?.description, name).toMatch(/cmak/i);
    }
  });

  it("remaining CMAK write tools are kept but flagged as phasing out", () => {
    const tools = registered();
    for (const name of ["ncloud_cdss_enable_public_domain", "ncloud_cdss_disable_public_domain", "ncloud_cdss_reset_cmak_password"]) {
      expect(tools.has(name), name).toBe(true);
      expect(tools.get(name)?.description, name).toMatch(/phased out/);
    }
  });
});
