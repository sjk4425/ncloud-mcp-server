import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerGlobalEdgeTools } from "./cdn-global-edge.js";

/**
 * Global Edge — 2026-10-02 공식 가이드(edge-*, profile-*, purge-*) 전량 대조 후 재작성분.
 * 경로·메서드·바디 형태(엣지 ID 배열 바디, DELETE+바디), 프로필 단건 조회의 목록 필터링,
 * 파괴적 게이트를 고정한다. SDK가 하는 것처럼 inputSchema로 파싱한 뒤 핸들러를 부른다.
 */
function createMockClient(): NcloudClient {
  return new NcloudClient({ accessKey: "a", secretKey: "s", baseUrl: "https://edge.apigw.ntruss.com", regionCode: "KR" });
}
function getTool(server: McpServer, toolName: string) {
  const tools = (server as any)._registeredTools;
  const entry = tools instanceof Map ? tools.get(toolName) : tools[toolName];
  if (!entry) throw new Error(`Tool ${toolName} not found`);
  return {
    parse: (args: any) => entry.inputSchema.parse(args),
    call: (args: any) => entry.handler(entry.inputSchema.parse(args), {} as any),
  };
}
function toolNames(server: McpServer): string[] {
  const tools = (server as any)._registeredTools;
  return tools instanceof Map ? [...tools.keys()] : Object.keys(tools);
}
const text = (r: any) => r.content[0].text as string;

describe("Global Edge — 도구 구성", () => {
  it("registers the guide's operation set; purge-history is replaced by purge-request lookup", () => {
    const server = new McpServer({ name: "t", version: "1" });
    registerGlobalEdgeTools(server, createMockClient());
    const names = toolNames(server);
    expect(names).not.toContain("ncloud_edge_get_purge_history");
    for (const n of [
      "ncloud_edge_list_profiles", "ncloud_edge_get_profile", "ncloud_edge_check_profile_name", "ncloud_edge_create_profile",
      "ncloud_edge_rename_profile", "ncloud_edge_delete_profile",
      "ncloud_edge_list_edges", "ncloud_edge_get_edge", "ncloud_edge_create_edge", "ncloud_edge_edit_edge", "ncloud_edge_delete_edge",
      "ncloud_edge_purge", "ncloud_edge_get_purge_request", "ncloud_edge_start_edge", "ncloud_edge_stop_edge",
      "ncloud_edge_get_edge_status", "ncloud_edge_get_edge_stats",
      "ncloud_edge_list_certificates", "ncloud_edge_provision_certificate", "ncloud_edge_get_certificate",
      "ncloud_edge_add_certificate_to_slot", "ncloud_edge_update_certificate_tls", "ncloud_edge_remove_certificates_from_slot",
      "ncloud_edge_delete_certificate",
    ]) expect(names).toContain(n);
    expect(names).toHaveLength(24);
  });
});

describe("Global Edge — 프로필", () => {
  let server: McpServer; let client: NcloudClient;
  beforeEach(() => { server = new McpServer({ name: "t", version: "1" }); client = createMockClient(); registerGlobalEdgeTools(server, client); });

  it("list GET /api/v1/profiles without query noise", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue([]);
    await getTool(server, "ncloud_edge_list_profiles").call({});
    expect(spy).toHaveBeenCalledWith("GET", "/api/v1/profiles");
  });

  it("get_profile filters the list (no single-profile endpoint) and errors when missing", async () => {
    vi.spyOn(client, "requestRaw").mockResolvedValue({ result: [{ profileId: 1, name: "a" }, { profileId: 2, name: "b" }] });
    const r = await getTool(server, "ncloud_edge_get_profile").call({ profileId: 2 });
    expect(JSON.parse(text(r))).toEqual({ profileId: 2, name: "b" });
    const miss = await getTool(server, "ncloud_edge_get_profile").call({ profileId: 9 });
    expect(miss.isError).toBe(true);
  });

  it("validation / create / rename / delete use the guide paths and {name} body", async () => {
    const get = vi.spyOn(client, "requestRaw").mockResolvedValue({});
    await getTool(server, "ncloud_edge_check_profile_name").call({ name: "p-1" });
    expect(get).toHaveBeenCalledWith("GET", "/api/v1/profiles/validation", { name: "p-1" });

    const post = vi.spyOn(client, "postRequest").mockResolvedValue({});
    await getTool(server, "ncloud_edge_create_profile").call({ name: "p-1" });
    expect(post).toHaveBeenCalledWith("/api/v1/profile", { name: "p-1" });

    const put = vi.spyOn(client, "putRequest").mockResolvedValue({});
    await getTool(server, "ncloud_edge_rename_profile").call({ profileId: 1836, name: "p-2" });
    expect(put).toHaveBeenCalledWith("/api/v1/profiles/1836", { name: "p-2" });

    const del = vi.spyOn(client, "deleteRequest").mockResolvedValue({});
    const gate = await getTool(server, "ncloud_edge_delete_profile").call({ profileId: 1836 });
    expect(text(gate)).toMatch(/confirm=true/);
    expect(del).not.toHaveBeenCalled();
    await getTool(server, "ncloud_edge_delete_profile").call({ profileId: 1836, confirm: true });
    expect(del).toHaveBeenCalledWith("/api/v1/profiles/1836");
  });
});

describe("Global Edge — 엣지", () => {
  let server: McpServer; let client: NcloudClient;
  beforeEach(() => { server = new McpServer({ name: "t", version: "1" }); client = createMockClient(); registerGlobalEdgeTools(server, client); });

  it("list is nested under the profile; detail/status use the guide paths", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({});
    await getTool(server, "ncloud_edge_list_edges").call({ profileId: 1599 });
    expect(spy).toHaveBeenCalledWith("GET", "/api/v1/profiles/1599/cdn-edges");
    await getTool(server, "ncloud_edge_get_edge").call({ edgeId: 123 });
    expect(spy).toHaveBeenCalledWith("GET", "/api/v1/cdn-edge/123");
    await getTool(server, "ncloud_edge_get_edge_status").call({ edgeId: 5707 });
    expect(spy).toHaveBeenCalledWith("GET", "/api/v1/cdn-edges/5707/status");
    await getTool(server, "ncloud_edge_get_edge_stats").call({ profileId: 4210, edgeId: 11207, dateFrom: "2025-07-17T07:00:00Z", dateTo: "2025-07-17T08:00:00Z" });
    expect(spy).toHaveBeenCalledWith("GET", "/api/v1/statistics/4210/11207", { dateFrom: "2025-07-17T07:00:00Z", dateTo: "2025-07-17T08:00:00Z" });
  });

  it("create POSTs /api/v1/cdn-edge with the documented top-level objects; dryRun skips the call; protocolType HTTP is rejected", async () => {
    const post = vi.spyOn(client, "postRequest").mockResolvedValue({ result: { edgeId: 77 } });
    const base = { profileId: 4210, edgeName: "edge001", protocolType: "ALL", regionType: "KOREA", serviceDomainType: "NCP_DOMAIN_AUTO", originType: "OBJECT_STORAGE", originRegion: "KR", originBucketName: "mybucket" };
    const preview = await getTool(server, "ncloud_edge_create_edge").call({ ...base, dryRun: true });
    expect(text(preview)).toMatch(/Dry-Run/);
    expect(post).not.toHaveBeenCalled();

    const r = await getTool(server, "ncloud_edge_create_edge").call(base);
    expect(post.mock.calls[0][0]).toBe("/api/v1/cdn-edge");
    const body: any = post.mock.calls[0][1];
    expect(Object.keys(body).sort()).toEqual(["accessControl", "cachingConfig", "distributionConfig", "edgeName", "headerPolicies", "managedRule", "optimizationConfig", "originalCopyConfig", "profileId"]);
    expect(body.distributionConfig.edgeLogging).toEqual({ enabled: false });
    expect(body.originalCopyConfig.originalCopyLocation).toEqual({ type: "OBJECT_STORAGE", region: "KR", bucketName: "mybucket", customLocation: null });
    expect(body.cachingConfig.defaultCaching.cacheRevalidateConfig).toEqual({ type: "IF_POSSIBLE", ageType: "DAYS", age: 7 });
    expect(body.accessControl).toEqual({ type: "WHITELIST", ipPolicies: [], geoPolicies: [], refererPolicies: [] });
    expect(JSON.parse(text(r)).edgeId).toBe(77);

    expect(() => getTool(server, "ncloud_edge_create_edge").parse({ ...base, protocolType: "HTTP" })).toThrow();
  });

  it("edit PUTs the parsed configuration; invalid JSON is refused without a call", async () => {
    const put = vi.spyOn(client, "putRequest").mockResolvedValue({});
    const bad = await getTool(server, "ncloud_edge_edit_edge").call({ edgeId: 5, configuration: "{nope" });
    expect(bad.isError).toBe(true);
    expect(put).not.toHaveBeenCalled();
    await getTool(server, "ncloud_edge_edit_edge").call({ edgeId: 5, configuration: JSON.stringify({ profileId: 1, edgeName: "e" }) });
    expect(put).toHaveBeenCalledWith("/api/v1/cdn-edges/5", { profileId: 1, edgeName: "e" });
  });

  it("activate/stop/delete send {edges:[...]} bodies to the collection endpoints; delete is gated", async () => {
    const post = vi.spyOn(client, "postRequest").mockResolvedValue({});
    await getTool(server, "ncloud_edge_start_edge").call({ edgeIds: [5707] });
    expect(post).toHaveBeenCalledWith("/api/v1/cdn-edges/activate", { edges: [5707] });
    await getTool(server, "ncloud_edge_stop_edge").call({ edgeIds: [5707, 5708] });
    expect(post).toHaveBeenCalledWith("/api/v1/cdn-edges/stop", { edges: [5707, 5708] });

    const del = vi.spyOn(client, "deleteRequest").mockResolvedValue({});
    const gate = await getTool(server, "ncloud_edge_delete_edge").call({ edgeIds: [5707] });
    expect(text(gate)).toMatch(/5707/);
    expect(del).not.toHaveBeenCalled();
    await getTool(server, "ncloud_edge_delete_edge").call({ edgeIds: [5707], confirm: true });
    expect(del).toHaveBeenCalledWith("/api/v1/cdn-edges", { edges: [5707] });
    expect(() => getTool(server, "ncloud_edge_delete_edge").parse({ edgeIds: [] })).toThrow();
  });

  it("purge omits purgeTarget for ALL, requires it otherwise; purge request lookup by id", async () => {
    const post = vi.spyOn(client, "postRequest").mockResolvedValue({});
    await getTool(server, "ncloud_edge_purge").call({ edgeId: 11197, purgeType: "ALL", purgeTarget: ["/x/*"] });
    expect(post).toHaveBeenCalledWith("/api/v1/purge", { edgeId: 11197, purgeType: "ALL" });
    await getTool(server, "ncloud_edge_purge").call({ edgeId: 11197, purgeType: "DIRECTORY", purgeTarget: ["/src/images/*"] });
    expect(post).toHaveBeenCalledWith("/api/v1/purge", { edgeId: 11197, purgeType: "DIRECTORY", purgeTarget: ["/src/images/*"] });
    const missing = await getTool(server, "ncloud_edge_purge").call({ edgeId: 11197, purgeType: "URL" });
    expect(missing.isError).toBe(true);

    const get = vi.spyOn(client, "requestRaw").mockResolvedValue({});
    await getTool(server, "ncloud_edge_get_purge_request").call({ purgeRequestId: 372 });
    expect(get).toHaveBeenCalledWith("GET", "/api/v1/purge/372");
  });
});

describe("Global Edge — 인증서", () => {
  let server: McpServer; let client: NcloudClient;
  beforeEach(() => { server = new McpServer({ name: "t", version: "1" }); client = createMockClient(); registerGlobalEdgeTools(server, client); });

  it("list/get use pageNo+offset; provision/add/tls/remove/delete use the slot paths", async () => {
    const get = vi.spyOn(client, "requestRaw").mockResolvedValue({});
    await getTool(server, "ncloud_edge_list_certificates").call({ pageNo: 2, offset: 10 });
    expect(get).toHaveBeenCalledWith("GET", "/api/v1/certificate/provisioning", { pageNo: 2, offset: 10 });
    await getTool(server, "ncloud_edge_get_certificate").call({ slotId: 68 });
    expect(get).toHaveBeenCalledWith("GET", "/api/v1/certificate/provisioning/68", { pageNo: undefined, offset: undefined });

    const post = vi.spyOn(client, "postRequest").mockResolvedValue({});
    await getTool(server, "ncloud_edge_provision_certificate").call({ serviceRegion: "KR_JP_GLOBAL", cmCertificateIds: [1, 2], tlsVersion: "TLS_MIN_VERSION_1_2", cipherProfile: "STRICT" });
    expect(post).toHaveBeenCalledWith("/api/v1/certificate/provisioning", { serviceRegion: "KR_JP_GLOBAL", cmCertificateIds: [1, 2], tlsVersion: "TLS_MIN_VERSION_1_2", cipherProfile: "STRICT" });
    await getTool(server, "ncloud_edge_add_certificate_to_slot").call({ slotId: 69, cmCertificateId: 9 });
    expect(post).toHaveBeenCalledWith("/api/v1/certificate/provisioning/69", { cmCertificateId: 9 });

    const put = vi.spyOn(client, "putRequest").mockResolvedValue({});
    await getTool(server, "ncloud_edge_update_certificate_tls").call({ slotId: 69, tlsVersion: "TLS_MIN_VERSION_1_2", cipherProfile: "GENERAL" });
    expect(put).toHaveBeenCalledWith("/api/v1/certificate/provisioning/69/certificates/tls", { tlsVersion: "TLS_MIN_VERSION_1_2", cipherProfile: "GENERAL" });

    const del = vi.spyOn(client, "deleteRequest").mockResolvedValue({});
    await getTool(server, "ncloud_edge_remove_certificates_from_slot").call({ slotId: 68, certificateItemIds: [8], confirm: true });
    expect(del).toHaveBeenCalledWith("/api/v1/certificate/provisioning/68/certificates", { certificateItemIds: [8] });
    await getTool(server, "ncloud_edge_delete_certificate").call({ slotId: 68, confirm: true });
    expect(del).toHaveBeenCalledWith("/api/v1/certificate/provisioning/68");
    const gate = await getTool(server, "ncloud_edge_delete_certificate").call({ slotId: 68 });
    expect(text(gate)).toMatch(/confirm=true/);
    expect(() => getTool(server, "ncloud_edge_provision_certificate").parse({ serviceRegion: "GLOBAL", cmCertificateIds: [1], tlsVersion: "TLS_MIN_VERSION_1_2", cipherProfile: "DEFAULT" })).toThrow();
  });
});
