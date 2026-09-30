import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerSearchEngineServiceTools } from "./analytics-ses.js";
import { registerCloudDataStreamingTools } from "./analytics-cdss.js";
import { sesPathPrefix, cdssPathPrefix } from "../client/endpoints.js";
import { excludingTools } from "./_tool.js";

/**
 * SES / CDSS 존·리전별 경로 접두 — analytics-vpcsearchengine-cluster-getclusterinfolist,
 * analytics-clouddatastreamingservice-cluster-getclusterinfolist (두 존 원문, 2026-09-30).
 */
function setup(reg: (s: McpServer, c: NcloudClient, o: any) => void, regionCode: string, zone?: "pub" | "gov" | "fin") {
  const server = new McpServer({ name: "t", version: "1.0.0" });
  const client = new NcloudClient({ accessKey: "k", secretKey: "s", baseUrl: "https://x.apigw.ntruss.com", regionCode });
  reg(server, client, zone ? { zone } : {});
  const tools = (server as any)._registeredTools;
  const entry = (name: string) => (tools instanceof Map ? tools.get(name) : tools[name]);
  return { client, has: (n: string) => !!entry(n), call: (n: string, a: any) => entry(n).handler(entry(n).inputSchema.parse(a), {} as any) };
}

describe("endpoints: SES/CDSS 경로 접두", () => {
  it("민간존 KR/SGN/JPN, 공공존 KR/KRS", () => {
    expect(sesPathPrefix("pub", "KR")).toBe("/api/v2");
    expect(sesPathPrefix("pub", "SGN")).toBe("/api/sgn-v2");
    expect(sesPathPrefix("pub", "JPN")).toBe("/api/jpn-v2");
    expect(sesPathPrefix("gov", "KRS")).toBe("/api/krs-v2");
    expect(sesPathPrefix("gov", "SGN")).toBe("/api/v2"); // 공공존에 없는 리전은 기본
    expect(cdssPathPrefix("pub", "JPN")).toBe("/api/jpn-v1");
    expect(cdssPathPrefix("gov", "KR")).toBe("/api/v1");
    expect(cdssPathPrefix("gov", "KRS")).toBe("/api/krs-v1");
  });
});

describe("excludingTools", () => {
  it("지정 이름만 등록을 건너뛰고 나머지는 위임한다", () => {
    const server = new McpServer({ name: "t", version: "1.0.0" });
    const s = excludingTools(server, ["skip_me"]);
    (s as any).registerTool("skip_me", { description: "d", inputSchema: {} }, async () => ({ content: [] }));
    (s as any).registerTool("keep_me", { description: "d", inputSchema: {} }, async () => ({ content: [] }));
    const tools = (server as any)._registeredTools;
    const has = (n: string) => (tools instanceof Map ? tools.has(n) : n in tools);
    expect(has("skip_me")).toBe(false);
    expect(has("keep_me")).toBe(true);
  });
});

describe("SES: 존별 접두와 도구 집합", () => {
  it("public SGN: /api/sgn-v2, G3 도구 있음", async () => {
    const t = setup(registerSearchEngineServiceTools, "SGN");
    const spy = vi.spyOn(t.client, "requestRaw").mockResolvedValue({});
    await t.call("ncloud_ses_list_clusters", {});
    expect(String(spy.mock.calls[0][1])).toBe("/api/sgn-v2/cluster/getClusterInfoList");
    expect(t.has("ncloud_ses_create_cluster_g3")).toBe(true);
  });
  it("gov KRS: /api/krs-v2, 민간존 전용 8종 미등록", async () => {
    const t = setup(registerSearchEngineServiceTools, "KRS", "gov");
    const spy = vi.spyOn(t.client, "requestRaw").mockResolvedValue({});
    await t.call("ncloud_ses_list_clusters", {});
    expect(String(spy.mock.calls[0][1])).toBe("/api/krs-v2/cluster/getClusterInfoList");
    for (const n of ["ncloud_ses_get_cluster_detail", "ncloud_ses_create_cluster_g3", "ncloud_ses_change_disk_size", "ncloud_ses_get_server_specs"]) expect(t.has(n), n).toBe(false);
    expect(t.has("ncloud_ses_get_node_list")).toBe(true);
  });
  it("fin FKR: /api/v2 (리전 세그먼트 없음), 민간존 전용 8종 미등록", async () => {
    expect(sesPathPrefix("fin", "FKR")).toBe("/api/v2");
    expect(cdssPathPrefix("fin", "FKR")).toBe("/api/v1");
    const t = setup(registerSearchEngineServiceTools, "FKR", "fin");
    const spy = vi.spyOn(t.client, "requestRaw").mockResolvedValue({});
    await t.call("ncloud_ses_list_clusters", {});
    expect(String(spy.mock.calls[0][1])).toBe("/api/v2/cluster/getClusterInfoList");
    for (const n of ["ncloud_ses_get_cluster_detail", "ncloud_ses_create_cluster_g3", "ncloud_ses_get_subnet_list_g3"]) expect(t.has(n), n).toBe(false);
    expect(t.has("ncloud_ses_get_node_list")).toBe(true);
  });
});

describe("CDSS: 존별 접두와 도구 집합", () => {
  it("gov KRS: /api/krs-v1, 민간존 전용 6종 미등록", async () => {
    const t = setup(registerCloudDataStreamingTools, "KRS", "gov");
    const spy = vi.spyOn(t.client, "postRequest").mockResolvedValue({});
    const spy2 = vi.spyOn(t.client, "requestRaw").mockResolvedValue({});
    await t.call("ncloud_cdss_list_clusters", {});
    const path = String((spy.mock.calls[0] ?? spy2.mock.calls[0])[0] === "POST" ? spy2.mock.calls[0][1] : spy.mock.calls[0]?.[0] ?? spy2.mock.calls[0]?.[1]);
    expect(path).toContain("/api/krs-v1/cluster/getClusterInfoList");
    for (const n of ["ncloud_cdss_create_cluster_g3", "ncloud_cdss_get_server_spec_list", "ncloud_cdss_get_cluster_server_images"]) expect(t.has(n), n).toBe(false);
    expect(t.has("ncloud_cdss_get_kafka_versions")).toBe(true);
  });
  it("fin FKR: /api/v1, 민간존 전용 6종 미등록", async () => {
    const t = setup(registerCloudDataStreamingTools, "FKR", "fin");
    const spy = vi.spyOn(t.client, "postRequest").mockResolvedValue({});
    const spy2 = vi.spyOn(t.client, "requestRaw").mockResolvedValue({});
    await t.call("ncloud_cdss_list_clusters", {});
    const path = String(spy.mock.calls[0]?.[0] ?? spy2.mock.calls[0]?.[1]);
    expect(path).toContain("/api/v1/cluster/getClusterInfoList");
    for (const n of ["ncloud_cdss_create_cluster_g3", "ncloud_cdss_get_subnet_list_g3", "ncloud_cdss_get_server_generations"]) expect(t.has(n), n).toBe(false);
    expect(t.has("ncloud_cdss_get_kafka_versions")).toBe(true);
  });
});
