import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerLogAnalyticsTools } from "./monitoring-log-analytics.js";

/**
 * Cloud Log Analytics — 경로의 리전 세그먼트(`/api/{region}-v1/...`).
 * 두 존 개요 페이지(analytics-cloudloganalytics)는 "사용 중인 플랫폼과 리전 환경에 맞게" 리전 코드를 넣으라고 한다.
 * 기본값은 클라이언트 활성 리전(이전엔 항상 kr), 명시하면 그 값을 쓴다.
 */
function setup(regionCode: string, zone?: "pub" | "gov" | "fin") {
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

describe("Log Analytics: 존별 플랫폼·수집 설정/해제 (금융존 가이드 대조 2026-09-30)", () => {
  const get = (s: any, n: string) => { const t = s._registeredTools; return t instanceof Map ? t.get(n) : t[n]; };
  it("금융존은 vpc 플랫폼만 받고(classic 페이지 없음) 기본 리전 fkr 로 호출한다", async () => {
    const fin = setup("FKR", "fin");
    const spy = vi.spyOn(fin.client, "requestRaw").mockResolvedValue({});
    await fin.call("ncloud_list_log_servers", {});
    expect(spy).toHaveBeenCalledWith("GET", "/api/fkr-v1/vpc/servers", {});
    expect(() => get(fin.server, "ncloud_list_log_servers").inputSchema.parse({ platform: "classic" })).toThrow();
    expect(get(setup("KR").server, "ncloud_list_log_servers").inputSchema.parse({ platform: "classic" }).platform).toBe("classic");
  });
  it("서버 로그 수집 설정은 세 존 공통 — POST /vpc/servers/collecting-infos 에 collectingInfos 바디", async () => {
    const s = setup("KR");
    const spy = vi.spyOn(s.client, "requestRaw").mockResolvedValue({});
    const info = { logPath: "/var/log/messages", logTemplate: "SYSLOG", logType: "SYSLOG", servername: "s1", osType: "centos-7.3-64", instanceNo: 1, macAddr: "aa:bb" };
    await s.call("ncloud_set_server_log_collection", { collectingInfos: [info] });
    expect(spy).toHaveBeenCalledWith("POST", "/api/kr-v1/vpc/servers/collecting-infos", undefined, { collectingInfos: [info] });
    expect(get(setup("KR", "gov").server, "ncloud_set_server_log_collection")).toBeTruthy();
  });
  it("수집 해제는 금융존에만 등록되고 confirm 게이트 뒤 DELETE /vpc/servers/collecting-infos/{instanceNo}", async () => {
    expect(get(setup("KR").server, "ncloud_delete_server_log_collection")).toBeUndefined();
    expect(get(setup("KR", "gov").server, "ncloud_delete_server_log_collection")).toBeUndefined();
    const fin = setup("FKR", "fin");
    const spy = vi.spyOn(fin.client, "requestRaw").mockResolvedValue({});
    const preview = await fin.call("ncloud_delete_server_log_collection", { instanceNo: 27056413 });
    expect(JSON.stringify(preview)).toContain("confirm=true");
    expect(spy).not.toHaveBeenCalled();
    await fin.call("ncloud_delete_server_log_collection", { instanceNo: 27056413, confirm: true });
    expect(spy).toHaveBeenCalledWith("DELETE", "/api/fkr-v1/vpc/servers/collecting-infos/27056413");
  });
});
