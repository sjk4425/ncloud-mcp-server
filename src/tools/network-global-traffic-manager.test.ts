import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerGlobalTrafficManagerTools, GTM_LB_TYPES } from "./network-global-traffic-manager.js";

/**
 * Global Traffic Manager — Traffic Policy 요청 값(2026-11-18 민간존 버그 리포트).
 * lbType 은 가이드 policy-request / policy-load-balancer-typeview 의 값(ROUND_ROBIN | WEIGHTED_ROUND_ROBIN |
 * GEOLOCATION | CIDR)이어야 한다. ≤2.2.0 의 GEO·WEIGHTED_RR 는 API 가 05X002 로 거부했다 → 별칭으로 변환.
 * Resource.type 은 PUBLIC_IP | EXTERNAL_DOMAIN (CNAME 아님). SDK 처럼 inputSchema 로 파싱한 뒤 핸들러를 부른다.
 */
function setup() {
  const client = new NcloudClient({ accessKey: "a", secretKey: "s", baseUrl: "https://globaltrafficmanager.apigw.ntruss.com", regionCode: "KR" });
  const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ success: true } as any);
  const server = new McpServer({ name: "t", version: "1" });
  registerGlobalTrafficManagerTools(server, client);
  const tools = (server as any)._registeredTools;
  const tool = (name: string) => {
    const entry = tools instanceof Map ? tools.get(name) : tools[name];
    if (!entry) throw new Error(`Tool ${name} not found`);
    return {
      parse: (args: any) => entry.inputSchema.parse(args),
      safeParse: (args: any) => entry.inputSchema.safeParse(args),
      call: (args: any) => entry.handler(entry.inputSchema.parse(args), {} as any),
    };
  };
  return { spy, tool };
}

const resource = { content: "203.0.113.10", healthCheckRegionId: 1, type: "PUBLIC_IP" };

describe("GTM Traffic Policy — lbType", () => {
  it("API 값(lb-types 응답과 동일)을 그대로 받는다", () => {
    expect([...GTM_LB_TYPES]).toEqual(["ROUND_ROBIN", "WEIGHTED_ROUND_ROBIN", "GEOLOCATION", "CIDR"]);
  });

  it("create: GEOLOCATION 정책을 geoMapId·geoMapDetailId 와 함께 POST /gtm/v1/policies 로 보낸다", async () => {
    const { spy, tool } = setup();
    await tool("ncloud_gtm_create_policy").call({
      name: "geo-policy",
      lbType: "GEOLOCATION",
      geoMapId: 10,
      resourceGroups: [{ geoMapDetailId: 10, active: [resource], standby: [] }],
    });
    expect(spy).toHaveBeenCalledWith("POST", "/gtm/v1/policies", undefined, {
      name: "geo-policy",
      lbType: "GEOLOCATION",
      geoMapId: 10,
      resourceGroups: [{ geoMapDetailId: 10, active: [resource], standby: [] }],
    });
  });

  it("create: 과거 별칭 GEO·WEIGHTED_RR 는 API 값으로 변환해 보낸다", async () => {
    const { spy, tool } = setup();
    await tool("ncloud_gtm_create_policy").call({ name: "p1", lbType: "GEO", geoMapId: 1 });
    expect((spy.mock.calls[0][3] as any).lbType).toBe("GEOLOCATION");
    await tool("ncloud_gtm_create_policy").call({ name: "p2", lbType: "WEIGHTED_RR" });
    expect((spy.mock.calls[1][3] as any).lbType).toBe("WEIGHTED_ROUND_ROBIN");
  });

  it("create: FAILOVER 등 API 에 없는 값과 누락은 스키마에서 거부한다", () => {
    const { tool } = setup();
    expect(tool("ncloud_gtm_create_policy").safeParse({ name: "p", lbType: "FAILOVER" }).success).toBe(false);
    const missing = tool("ncloud_gtm_create_policy").safeParse({ name: "p" });
    expect(missing.success).toBe(false);
    expect(JSON.stringify(missing.error?.issues)).toContain("Required parameter 'lbType' is missing.");
  });

  it("update: lbType 은 선택 — 생략 시 본문에 넣지 않고, 별칭은 변환한다", async () => {
    const { spy, tool } = setup();
    await tool("ncloud_gtm_update_policy").call({ policyId: 100, name: "renamed" });
    expect(spy).toHaveBeenCalledWith("PUT", "/gtm/v1/policies/100", undefined, { name: "renamed" });
    await tool("ncloud_gtm_update_policy").call({ policyId: 100, lbType: "WEIGHTED_RR" });
    expect(spy.mock.calls[1][3]).toEqual({ lbType: "WEIGHTED_ROUND_ROBIN" });
    await tool("ncloud_gtm_update_policy").call({ policyId: 100, lbType: "GEOLOCATION", geoMapId: 10 });
    expect(spy.mock.calls[2][3]).toEqual({ lbType: "GEOLOCATION", geoMapId: 10 });
  });
});

describe("GTM Traffic Policy — Resource.type", () => {
  it("PUBLIC_IP / EXTERNAL_DOMAIN 만 허용하고 CNAME 은 거부한다 (create·update·resources 전부)", () => {
    const { tool } = setup();
    const ext = { content: "origin.example.com", healthCheckRegionId: 1, type: "EXTERNAL_DOMAIN" };
    const cname = { ...ext, type: "CNAME" };
    expect(tool("ncloud_gtm_create_policy").safeParse({ name: "p", lbType: "ROUND_ROBIN", resourceGroups: [{ active: [ext] }] }).success).toBe(true);
    expect(tool("ncloud_gtm_create_policy").safeParse({ name: "p", lbType: "ROUND_ROBIN", resourceGroups: [{ active: [cname] }] }).success).toBe(false);
    expect(tool("ncloud_gtm_update_policy").safeParse({ policyId: 1, resourceGroups: [{ active: [cname] }] }).success).toBe(false);
    expect(tool("ncloud_gtm_update_policy_resources").safeParse({ policyId: 1, resourceGroups: [{ active: [cname] }] }).success).toBe(false);
    expect(tool("ncloud_gtm_update_policy_resource").safeParse({ policyId: 1, resourceGroupSid: 2, active: [cname] }).success).toBe(false);
    expect(tool("ncloud_gtm_update_policy_resource").safeParse({ policyId: 1, resourceGroupSid: 2, standby: [ext] }).success).toBe(true);
  });

  it("update_policy_resources 는 배열 본문을 PUT /resources 로 보낸다", async () => {
    const { spy, tool } = setup();
    await tool("ncloud_gtm_update_policy_resources").call({ policyId: 5, resourceGroups: [{ sid: 9, geoMapDetailId: null, active: [resource] }] });
    expect(spy).toHaveBeenCalledWith("PUT", "/gtm/v1/policies/5/resources", undefined, [{ sid: 9, geoMapDetailId: null, active: [resource] }]);
  });
});
