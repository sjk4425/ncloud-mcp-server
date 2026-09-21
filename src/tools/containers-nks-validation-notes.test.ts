import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerContainersNksTools } from "./containers-nks.js";

/**
 * 2026-09-17 NKS 릴리스 노트: Regional 클러스터 Node Pool Zone·Subnet 불일치 검증, Audit Log CLA 구독 검증, Istio Add-on.
 * 파라미터 변경은 없고 서버측 검증만 강화됐으므로, 도구 안내 문구와 dryRun 대조 자료 노출을 고정한다.
 */
function setup() {
  const server = new McpServer({ name: "t", version: "1" });
  const client = new NcloudClient({ accessKey: "a", secretKey: "b", baseUrl: "https://nks.apigw.ntruss.com", regionCode: "KR" });
  registerContainersNksTools(server, client);
  const tools = (server as any)._registeredTools;
  const map: Map<string, any> = tools instanceof Map ? tools : new Map(Object.entries(tools));
  return { client, map, call: (name: string, args: any) => map.get(name).handler(map.get(name).inputSchema.parse(args), {} as any) };
}
const text = (r: any) => r.content[0].text as string;

const base = {
  name: "demo", clusterType: "SVR.VNKS.STAND.C004.M016.G002", loginKeyName: "key", regionCode: "KR",
  vpcNo: 1, subnetNoList: [11, 12], lbPublicSubnetNo: 21, k8sVersion: "1.36.0-nks.1",
};

describe("NKS — 2026-09-17 서버측 검증 안내", () => {
  it("descriptions mention the new validations and the Istio add-on", () => {
    const { map } = setup();
    expect(map.get("ncloud_nks_create_cluster").description).toMatch(/Cloud Log Analytics/);
    expect(map.get("ncloud_nks_create_cluster").description).toMatch(/zoneCode must match the zone of the subnets/);
    expect(map.get("ncloud_nks_set_audit_log").description).toMatch(/CLA subscription/);
    expect(map.get("ncloud_nks_create_node_pool").description).toMatch(/Regional/);
    expect(map.get("ncloud_nks_list_available_addons").description).toMatch(/Istio/);
  });

  it("create_cluster dryRun on a Regional cluster exposes node pool zones + cluster subnets and the audit-log check, without calling the API", async () => {
    const { client, call } = setup();
    const spy = vi.spyOn(client, "requestRaw");
    const r = await call("ncloud_nks_create_cluster", {
      ...base, isRegional: true, log: { audit: true },
      nodePool: [{ name: "pool-a", nodeCount: 1, zoneCode: "KR-1" }, { name: "pool-b", nodeCount: 1 }],
      dryRun: true,
    });
    expect(spy).not.toHaveBeenCalled();
    const t = text(r);
    expect(t).toMatch(/regionalZoneCheck/);
    expect(t).toMatch(/"nodePoolZones"/);
    expect(t).toMatch(/"pool-a".*"KR-1"/);
    expect(t).toMatch(/"pool-b".*null/);
    expect(t).toMatch(/"clusterSubnetNoList":\s*\[\s*11,\s*12\s*\]/);
    expect(t).toMatch(/auditLogCheck/);
  });

  it("a single-zone cluster without audit does not get the extra notes", async () => {
    const { client, call } = setup();
    vi.spyOn(client, "requestRaw");
    const r = await call("ncloud_nks_create_cluster", { ...base, zoneCode: "KR-1", dryRun: true });
    const t = text(r);
    expect(t).not.toMatch(/regionalZoneCheck/);
    expect(t).not.toMatch(/auditLogCheck/);
    expect(t).toMatch(/Dry-Run Preview/);
  });
});
