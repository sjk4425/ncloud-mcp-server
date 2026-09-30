import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerLogAnalyticsTools } from "./monitoring-log-analytics.js";

/**
 * Cloud Log Analytics — 경로의 리전 세그먼트(`/api/{region}-v1/...`).
 * 두 존 개요 페이지(analytics-cloudloganalytics)는 "사용 중인 플랫폼과 리전 환경에 맞게" 리전 코드를 넣으라고 한다.
 * 기본값은 클라이언트 활성 리전(이전엔 항상 kr), 명시하면 그 값을 쓴다.
 */
function setup(regionCode: string, zone?: "public" | "gov") {
  const server = new McpServer({ name: "t", version: "1.0.0" });
  const client = new NcloudClient({ accessKey: "k", secretKey: "s", baseUrl: "https://cloudloganalytics.apigw.ntruss.com", regionCode });
  registerLogAnalyticsTools(server, client, zone ? { zone } : {});
  const tools = (server as any)._registeredTools;
  const entry = (name: string) => (tools instanceof Map ? tools.get(name) : tools[name]);
  return { server, client, call: (name: string, args: any) => entry(name).handler(entry(name).inputSchema.parse(args), {} as any), desc: (name: string) => entry(name).description as string };
}

describe("Log Analytics: 리전 경로 세그먼트", () => {
  it("regionCode 생략 시 클라이언트 활성 리전을 소문자로 쓴다 (KR → kr-v1, KRS → krs-v1)", async () => {
    const kr = setup("KR");
    const spy = vi.spyOn(kr.client, "requestRaw").mockResolvedValue({});
    await kr.call("ncloud_get_log_count_total", {});
    expect(spy).toHaveBeenCalledWith("GET", "/api/kr-v1/logs/count/total");

    const krs = setup("KRS", "gov");
    const spy2 = vi.spyOn(krs.client, "requestRaw").mockResolvedValue({});
    await krs.call("ncloud_get_log_count_total", {});
    expect(spy2).toHaveBeenCalledWith("GET", "/api/krs-v1/logs/count/total");
  });
  it("regionCode 를 명시하면 그 값을 쓰고, 리전 변경 후 호출 시점에 반영된다", async () => {
    const s = setup("KR");
    const spy = vi.spyOn(s.client, "requestRaw").mockResolvedValue({});
    await s.call("ncloud_get_log_count_total", { regionCode: "SGN" });
    expect(spy.mock.calls[0][1]).toBe("/api/sgn-v1/logs/count/total");
    s.client.setRegionCode("JPN");
    await s.call("ncloud_get_log_count_total", {});
    expect(spy.mock.calls[1][1]).toBe("/api/jpn-v1/logs/count/total");
  });
  it("regionCode 설명은 존의 리전 목록을 안내한다", () => {
    expect(setup("KR").desc("ncloud_search_logs")).toBeTruthy();
    const pubTools = (setup("KR").server as any)._registeredTools;
    const govTools = (setup("KR", "gov").server as any)._registeredTools;
    const get = (t: any, n: string) => (t instanceof Map ? t.get(n) : t[n]);
    expect(get(pubTools, "ncloud_search_logs").inputSchema.shape.regionCode.description).toContain("kr, jpn, sgn, uswn, den");
    expect(get(govTools, "ncloud_search_logs").inputSchema.shape.regionCode.description).toContain("kr, krs");
  });
});
