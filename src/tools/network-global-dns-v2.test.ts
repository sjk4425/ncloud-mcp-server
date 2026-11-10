import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerGlobalDnsV2Tools } from "./network-global-dns-v2.js";

/**
 * Global DNS v2(공공존) — 공식 가이드 22개 오퍼레이션의 메서드·경로·쿼리·본문, 비동기 폴링 안내,
 * dryRun·파괴적 게이트를 고정한다. SDK처럼 inputSchema로 파싱한 뒤 핸들러를 부른다.
 */
function createMockClient(): NcloudClient {
  return new NcloudClient({ accessKey: "a", secretKey: "s", baseUrl: "https://globaldns.apigw.gov-ntruss.com", regionCode: "KR" });
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
const json = (r: any) => JSON.parse(text(r));

const V2 = "/dns/v2";

describe("Global DNS v2 — 도구 구성", () => {
  it("registers 21 tools (22 ops; query statistics share one tool)", () => {
    const server = new McpServer({ name: "t", version: "1" });
    registerGlobalDnsV2Tools(server, createMockClient());
    const names = toolNames(server);
    for (const n of [
      "ncloud_dns_list_domains", "ncloud_dns_get_domain_detail", "ncloud_dns_create_domain", "ncloud_dns_update_domain",
      "ncloud_dns_delete_domain", "ncloud_dns_get_domain_operation", "ncloud_dns_list_domain_operations",
      "ncloud_dns_list_records", "ncloud_dns_get_record", "ncloud_dns_create_record", "ncloud_dns_create_records",
      "ncloud_dns_update_record", "ncloud_dns_update_records", "ncloud_dns_delete_record", "ncloud_dns_delete_records",
      "ncloud_dns_apply_domain", "ncloud_dns_rollback_domain", "ncloud_dns_get_record_operation", "ncloud_dns_list_record_operations",
      "ncloud_dns_list_lb_records", "ncloud_dns_get_query_count",
    ]) expect(names).toContain(n);
    expect(names).toHaveLength(21);
  });
});

describe("Global DNS v2 — 도메인", () => {
  let server: McpServer; let client: NcloudClient;
  beforeEach(() => { server = new McpServer({ name: "t", version: "1" }); client = createMockClient(); registerGlobalDnsV2Tools(server, client); });

  it("list_domains sends name/pageNo/pageSize and repeated sort", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ content: [] });
    await getTool(server, "ncloud_dns_list_domains").call({});
    expect(spy).toHaveBeenLastCalledWith("GET", `${V2}/domains`);
    await getTool(server, "ncloud_dns_list_domains").call({ name: "ex.com", pageNo: 1, pageSize: 50, sort: ["name,desc", "status"] });
    expect(spy).toHaveBeenLastCalledWith("GET", `${V2}/domains?name=ex.com&pageNo=1&pageSize=50&sort=name%2Cdesc&sort=status`);
  });

  it("rejects invalid sort and pageSize", () => {
    expect(() => getTool(server, "ncloud_dns_list_domains").parse({ sort: ["foo,asc"] })).toThrow();
    expect(() => getTool(server, "ncloud_dns_list_domains").parse({ pageSize: 1001 })).toThrow();
  });

  it("get_domain_detail / operations", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({});
    await getTool(server, "ncloud_dns_get_domain_detail").call({ domainNo: 12 });
    expect(spy).toHaveBeenLastCalledWith("GET", `${V2}/domains/12`);
    await getTool(server, "ncloud_dns_get_domain_operation").call({ operationId: "op/1" });
    expect(spy).toHaveBeenLastCalledWith("GET", `${V2}/domains/operations/op%2F1`);
    await getTool(server, "ncloud_dns_list_domain_operations").call({ pageNo: 0, sort: ["metadata.startDateTime,desc"] });
    expect(spy).toHaveBeenLastCalledWith("GET", `${V2}/domains/operations?pageNo=0&sort=metadata.startDateTime%2Cdesc`);
  });

  it("create_domain POSTs {name, dnssecEnabled, description} and adds a poll hint to the 202 Operation", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ id: "op-1", done: false, metadata: { operationType: "CREATE" } });
    const r = await getTool(server, "ncloud_dns_create_domain").call({ name: "ex.com", dnssecEnabled: false });
    expect(spy).toHaveBeenCalledWith("POST", `${V2}/domains`, undefined, { name: "ex.com", dnssecEnabled: false });
    const out = json(r);
    expect(out.id).toBe("op-1");
    expect(out.nextStep).toMatch(/ncloud_dns_get_domain_operation.*op-1/);
  });

  it("create_domain dryRun does not call the API", async () => {
    const spy = vi.spyOn(client, "requestRaw");
    const r = await getTool(server, "ncloud_dns_create_domain").call({ name: "ex.com", dnssecEnabled: true, description: "d", dryRun: true });
    expect(spy).not.toHaveBeenCalled();
    const out = json(r);
    expect(out.method).toBe("POST");
    expect(out.endpoint).toBe(`${V2}/domains`);
    expect(out.requestParams).toEqual({ name: "ex.com", dnssecEnabled: true, description: "d" });
  });

  it("dnssecEnabled is required on create/update", () => {
    expect(() => getTool(server, "ncloud_dns_create_domain").parse({ name: "ex.com" })).toThrow();
    expect(() => getTool(server, "ncloud_dns_update_domain").parse({ domainNo: 1 })).toThrow();
  });

  it("update_domain PUTs the full body", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ id: "op-2", done: false });
    await getTool(server, "ncloud_dns_update_domain").call({ domainNo: 7, dnssecEnabled: true });
    expect(spy).toHaveBeenCalledWith("PUT", `${V2}/domains/7`, undefined, { dnssecEnabled: true });
  });

  it("delete_domain is confirm-gated and DELETEs", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ id: "op-3", done: false });
    const gate = await getTool(server, "ncloud_dns_delete_domain").call({ domainNo: 7 });
    expect(text(gate)).toMatch(/confirm=true/);
    expect(spy).not.toHaveBeenCalled();
    await getTool(server, "ncloud_dns_delete_domain").call({ domainNo: 7, confirm: true });
    expect(spy).toHaveBeenCalledWith("DELETE", `${V2}/domains/7`);
  });
});

describe("Global DNS v2 — 레코드", () => {
  let server: McpServer; let client: NcloudClient;
  beforeEach(() => { server = new McpServer({ name: "t", version: "1" }); client = createMockClient(); registerGlobalDnsV2Tools(server, client); });

  it("list_records / get_record", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ content: [] });
    await getTool(server, "ncloud_dns_list_records").call({ domainNo: 5, type: "A", searchContent: "1.2", pageSize: 100, sort: ["recordNo,asc"] });
    expect(spy).toHaveBeenLastCalledWith("GET", `${V2}/domains/5/records?type=A&searchContent=1.2&pageSize=100&sort=recordNo%2Casc`);
    await getTool(server, "ncloud_dns_get_record").call({ domainNo: 5, recordNo: 9 });
    expect(spy).toHaveBeenLastCalledWith("GET", `${V2}/domains/5/records/9`);
  });

  it("create_record POSTs the RecordSpec (v2 field names)", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ recordNo: 1 });
    await getTool(server, "ncloud_dns_create_record").call({ domainNo: 5, host: "www", type: "A", content: "1.1.1.1", ttl: 300 });
    expect(spy).toHaveBeenCalledWith("POST", `${V2}/domains/5/records`, undefined, { host: "www", type: "A", content: "1.1.1.1", ttl: 300 });
  });

  it("loadBalancerNo requires loadBalancerRegionCode", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({});
    const r = await getTool(server, "ncloud_dns_create_record").call({ domainNo: 5, type: "A", content: "x", ttl: 300, loadBalancerNo: 3 });
    expect(r.isError).toBe(true);
    const b = await getTool(server, "ncloud_dns_create_records").call({ domainNo: 5, records: [{ type: "A", content: "x", ttl: 1 }, { type: "A", content: "y", ttl: 1, loadBalancerNo: 3 }] });
    expect(b.isError).toBe(true);
    expect(text(b)).toMatch(/#2/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects bad type / ttl", () => {
    expect(() => getTool(server, "ncloud_dns_create_record").parse({ domainNo: 5, type: "SOA", content: "x", ttl: 1 })).toThrow();
    expect(() => getTool(server, "ncloud_dns_create_record").parse({ domainNo: 5, type: "A", content: "x", ttl: -1 })).toThrow();
  });

  it("batch create / update / delete use POST batch-* paths", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({});
    await getTool(server, "ncloud_dns_create_records").call({ domainNo: 5, records: [{ type: "TXT", content: "a\nb", ttl: 60 }] });
    expect(spy).toHaveBeenLastCalledWith("POST", `${V2}/domains/5/records/batch-create`, undefined, { records: [{ type: "TXT", content: "a\nb", ttl: 60 }] });

    await getTool(server, "ncloud_dns_update_records").call({ domainNo: 5, records: [{ recordNo: 9, host: "@", type: "A", content: "2.2.2.2", ttl: 60 }] });
    expect(spy).toHaveBeenLastCalledWith("POST", `${V2}/domains/5/records/batch-update`, undefined, { records: [{ recordNo: 9, host: "@", type: "A", content: "2.2.2.2", ttl: 60 }] });

    const gate = await getTool(server, "ncloud_dns_delete_records").call({ domainNo: 5, recordNos: [9, 10] });
    expect(text(gate)).toMatch(/confirm=true/);
    await getTool(server, "ncloud_dns_delete_records").call({ domainNo: 5, recordNos: [9, 10], confirm: true });
    expect(spy).toHaveBeenLastCalledWith("POST", `${V2}/domains/5/records/batch-delete`, undefined, { recordNos: [9, 10] });
  });

  it("batch limits are 1..500", () => {
    expect(() => getTool(server, "ncloud_dns_create_records").parse({ domainNo: 5, records: [] })).toThrow();
    expect(() => getTool(server, "ncloud_dns_delete_records").parse({ domainNo: 5, recordNos: Array.from({ length: 501 }, (_, i) => i) })).toThrow();
  });

  it("update_record PUTs; delete_record is gated and DELETEs", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({});
    await getTool(server, "ncloud_dns_update_record").call({ domainNo: 5, recordNo: 9, type: "CNAME", content: "a.ex.com.", ttl: 60, dryRun: false });
    expect(spy).toHaveBeenLastCalledWith("PUT", `${V2}/domains/5/records/9`, undefined, { type: "CNAME", content: "a.ex.com.", ttl: 60 });
    const gate = await getTool(server, "ncloud_dns_delete_record").call({ domainNo: 5, recordNo: 9 });
    expect(text(gate)).toMatch(/confirm=true/);
    await getTool(server, "ncloud_dns_delete_record").call({ domainNo: 5, recordNo: 9, confirm: true });
    expect(spy).toHaveBeenLastCalledWith("DELETE", `${V2}/domains/5/records/9`);
  });

  it("apply POSTs without body and hints the record operation tool; rollback is gated", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ id: "op-9", done: false });
    const r = await getTool(server, "ncloud_dns_apply_domain").call({ domainNo: 5 });
    expect(spy).toHaveBeenLastCalledWith("POST", `${V2}/domains/5/records/apply`);
    expect(json(r).nextStep).toMatch(/ncloud_dns_get_record_operation.*op-9.*domainNo=5/);

    const dry = await getTool(server, "ncloud_dns_apply_domain").call({ domainNo: 5, dryRun: true });
    expect(json(dry).endpoint).toBe(`${V2}/domains/5/records/apply`);
    expect(spy).toHaveBeenCalledTimes(1);

    const gate = await getTool(server, "ncloud_dns_rollback_domain").call({ domainNo: 5 });
    expect(text(gate)).toMatch(/confirm=true/);
    await getTool(server, "ncloud_dns_rollback_domain").call({ domainNo: 5, confirm: true });
    expect(spy).toHaveBeenLastCalledWith("POST", `${V2}/domains/5/records/rollback`);
  });

  it("record operations", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({});
    await getTool(server, "ncloud_dns_get_record_operation").call({ domainNo: 5, operationId: "op-9" });
    expect(spy).toHaveBeenLastCalledWith("GET", `${V2}/domains/5/records/operations/op-9`);
    await getTool(server, "ncloud_dns_list_record_operations").call({ domainNo: 5, pageSize: 10 });
    expect(spy).toHaveBeenLastCalledWith("GET", `${V2}/domains/5/records/operations?pageSize=10`);
  });
});

describe("Global DNS v2 — LB·통계", () => {
  let server: McpServer; let client: NcloudClient;
  beforeEach(() => { server = new McpServer({ name: "t", version: "1" }); client = createMockClient(); registerGlobalDnsV2Tools(server, client); });

  it("list_lb_records sends platformType/recordType as query (defaults VPC/A)", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue([]);
    await getTool(server, "ncloud_dns_list_lb_records").call({});
    expect(spy).toHaveBeenLastCalledWith("GET", `${V2}/record-linkable-load-balancers?platformType=VPC&recordType=A`);
    await getTool(server, "ncloud_dns_list_lb_records").call({ platformType: "BOTH", loadBalancerRegionCode: "KR", searchContent: "lb" });
    expect(spy).toHaveBeenLastCalledWith("GET", `${V2}/record-linkable-load-balancers?platformType=BOTH&recordType=A&loadBalancerRegionCode=KR&searchContent=lb`);
  });

  it("get_query_count routes to member or domain statistics", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue([]);
    await getTool(server, "ncloud_dns_get_query_count").call({ baseTimeUnit: "DAY_1" });
    expect(spy).toHaveBeenLastCalledWith("GET", `${V2}/query-statistics?baseTimeUnit=DAY_1`);
    await getTool(server, "ncloud_dns_get_query_count").call({ baseTimeUnit: "HOUR_3", domainNo: 5, filter: "baseTimestamp >= 1 AND baseTimestamp < 2" });
    expect(spy).toHaveBeenLastCalledWith("GET", `${V2}/domains/5/query-statistics?baseTimeUnit=HOUR_3&filter=baseTimestamp+%3E%3D+1+AND+baseTimestamp+%3C+2`);
  });
});
