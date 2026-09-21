import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerOutboundMailerTools } from "./application-outbound-mailer.js";

/**
 * Cloud Outbound Mailer v1(레거시) 도구 테스트 — 템플릿·주소록·수신거부.
 * 2026-09-17 SENS 통합 후 이관 프로젝트에서 12개월간만 동작하는 API라, 경로·메서드·본문 형태와
 * 파괴적 게이트를 고정하는 데 집중한다. SDK가 하는 것처럼 inputSchema로 파싱한 뒤 핸들러를 부른다.
 */
function createMockClient(region = "KR"): NcloudClient {
  return new NcloudClient({ accessKey: "testAccessKey", secretKey: "testSecretKey", baseUrl: "https://mail.apigw.ntruss.com", regionCode: region });
}

function getTool(server: McpServer, toolName: string) {
  const tools = (server as any)._registeredTools;
  const entry = tools instanceof Map ? tools.get(toolName) : tools[toolName];
  if (!entry) throw new Error(`Tool ${toolName} not found`);
  return {
    parse: (args: any) => entry.inputSchema.parse(args),
    call: (args: any) => entry.handler(entry.inputSchema.parse(args), {} as any),
    description: entry.description as string,
  };
}
const text = (r: any) => r.content[0].text as string;

describe("Outbound Mailer(legacy) — 리전 경로·태그", () => {
  it("uses /api/v1 for KR (default), /api/v1-sgn and /api/v1-jpn via the region parameter or the client region", async () => {
    const server = new McpServer({ name: "t", version: "1" });
    const client = createMockClient("KR");
    registerOutboundMailerTools(server, client);
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ contents: [] });
    const tool = getTool(server, "ncloud_mailer_get_template_structure");
    await tool.call({});
    await tool.call({ region: "SGN" });
    await tool.call({ isUse: true, region: "JPN" });
    expect(spy.mock.calls.map((c) => c[1])).toEqual(["/api/v1/template", "/api/v1-sgn/template", "/api/v1-jpn/template?isUse=true"]);
    spy.mockRestore();

    const server2 = new McpServer({ name: "t", version: "1" });
    const client2 = createMockClient("SGN");
    registerOutboundMailerTools(server2, client2);
    const spy2 = vi.spyOn(client2, "requestRaw").mockResolvedValue({});
    await getTool(server2, "ncloud_mailer_get_address_book").call({});
    expect(spy2.mock.calls[0][1]).toBe("/api/v1-sgn/address-book");
    // 매핑에 없는 서버 리전(예: DEN)은 KR로 폴백
    client2.setRegionCode("DEN");
    await getTool(server2, "ncloud_mailer_get_address_book").call({});
    expect(spy2.mock.calls[1][1]).toBe("/api/v1/address-book");
    spy2.mockRestore();
  });

  it("every tool description carries the legacy tag and points to the SENS v2 tools", () => {
    const server = new McpServer({ name: "t", version: "1" });
    registerOutboundMailerTools(server, createMockClient());
    const tools = (server as any)._registeredTools;
    const names = tools instanceof Map ? [...tools.keys()] : Object.keys(tools);
    expect(names.length).toBe(16);
    for (const n of names) {
      expect(n.startsWith("ncloud_mailer_")).toBe(true);
      const d = getTool(server, n).description;
      expect(d).toMatch(/Legacy Cloud Outbound Mailer/);
      expect(d).toMatch(/ncloud_sens_send_mail/);
    }
    // 메일 발송·조회 5 op와 파일 op는 의도적으로 없다(v2 대체 / multipart 불가)
    expect(names.some((n) => /send_mail|mail_request|create_file/.test(n))).toBe(false);
  });
});

describe("Outbound Mailer(legacy) — 템플릿·카테고리", () => {
  let server: McpServer;
  let client: NcloudClient;
  beforeEach(() => {
    server = new McpServer({ name: "t", version: "1" });
    client = createMockClient();
    registerOutboundMailerTools(server, client);
  });

  it("create_template posts the documented body (dryRun does not call) and validates the name rule", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ sid: 1 });
    const tool = getTool(server, "ncloud_mailer_create_template");
    const base = { templateName: "회원가입_안내-v1.0", title: "Welcome", body: "<p>hi</p>", senderAddress: "no-reply@example.com" };
    expect(() => tool.parse({ ...base, templateName: "bad name with spaces" })).toThrow(/templateName/);
    expect(() => tool.parse({ ...base, senderAddress: "not-an-email" })).toThrow();
    const preview = await tool.call({ ...base, dryRun: true });
    expect(spy).not.toHaveBeenCalled();
    expect(text(preview)).toMatch(/Dry-Run Preview/);
    await tool.call({ ...base, categorySid: 252, isUse: true });
    expect(spy).toHaveBeenCalledWith("POST", "/api/v1/template", undefined, { ...base, categorySid: 252, isUse: true });
    spy.mockRestore();
  });

  it("update_template PUTs a full body without templateSid/region; restore_template PUTs …/restoration with no body", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ sid: 7 });
    const body = { templateName: "t1", title: "T", body: "B", senderAddress: "a@example.com", senderName: "A" };
    await getTool(server, "ncloud_mailer_update_template").call({ templateSid: 7, ...body });
    expect(spy).toHaveBeenCalledWith("PUT", "/api/v1/template/7", undefined, body);
    await getTool(server, "ncloud_mailer_restore_template").call({ templateSid: 7 });
    expect(spy).toHaveBeenLastCalledWith("PUT", "/api/v1/template/7/restoration");
    spy.mockRestore();
  });

  it("delete_template / delete_category are confirm-gated and DELETE the right paths", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ sid: 7, isUse: false });
    const gate = await getTool(server, "ncloud_mailer_delete_template").call({ templateSid: 7 });
    expect(text(gate)).toMatch(/confirm=true/);
    expect(spy).not.toHaveBeenCalled();
    await getTool(server, "ncloud_mailer_delete_template").call({ templateSid: 7, confirm: true });
    expect(spy).toHaveBeenLastCalledWith("DELETE", "/api/v1/template/7");
    await getTool(server, "ncloud_mailer_delete_category").call({ categorySid: 252, confirm: true });
    expect(spy).toHaveBeenLastCalledWith("DELETE", "/api/v1/category/252");
    spy.mockRestore();
  });

  it("create_category posts categoryName and optional parentSid", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ sid: 1 });
    await getTool(server, "ncloud_mailer_create_category").call({ categoryName: "AD" });
    expect(spy).toHaveBeenLastCalledWith("POST", "/api/v1/category", undefined, { categoryName: "AD" });
    await getTool(server, "ncloud_mailer_create_category").call({ categoryName: "AD-sub", parentSid: 261 });
    expect(spy).toHaveBeenLastCalledWith("POST", "/api/v1/category", undefined, { categoryName: "AD-sub", parentSid: 261 });
    spy.mockRestore();
  });
});

describe("Outbound Mailer(legacy) — 주소록·수신거부", () => {
  let server: McpServer;
  let client: NcloudClient;
  beforeEach(() => {
    server = new McpServer({ name: "t", version: "1" });
    client = createMockClient();
    registerOutboundMailerTools(server, client);
  });

  it("create_address_book posts groups[] and reports counts in dryRun", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ totalAddressCount: 0, groups: [] });
    const groups = [{ groupName: "10대", emailAddresses: ["a@example.com", "b@example.com"] }, { groupName: "빈그룹" }];
    const preview = await getTool(server, "ncloud_mailer_create_address_book").call({ groups, dryRun: true });
    expect(spy).not.toHaveBeenCalled();
    expect(text(preview)).toMatch(/"groupCount":\s*2/);
    expect(text(preview)).toMatch(/"addressCount":\s*2/);
    await getTool(server, "ncloud_mailer_create_address_book").call({ groups });
    expect(spy).toHaveBeenCalledWith("POST", "/api/v1/address-book", undefined, { groups });
    spy.mockRestore();
  });

  it("delete_address_book wipes everything only with confirm and warns loudly", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ deletedAddressCount: 3 });
    const gate = await getTool(server, "ncloud_mailer_delete_address_book").call({});
    expect(text(gate)).toMatch(/ENTIRE/);
    expect(text(gate)).toMatch(/cannot be undone/);
    expect(spy).not.toHaveBeenCalled();
    await getTool(server, "ncloud_mailer_delete_address_book").call({ confirm: true });
    expect(spy).toHaveBeenCalledWith("DELETE", "/api/v1/address-book");
    spy.mockRestore();
  });

  it("delete_addresses and delete_unsubscribers send DELETE with a JSON body; delete_recipient_group uses the groupName query", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({});
    await getTool(server, "ncloud_mailer_delete_addresses").call({ emailAddresses: ["a@example.com"], confirm: true });
    expect(spy).toHaveBeenLastCalledWith("DELETE", "/api/v1/address-book/address", undefined, { emailAddresses: ["a@example.com"] });
    await getTool(server, "ncloud_mailer_delete_unsubscribers").call({ blockedReceivers: ["a@example.com"], confirm: true });
    expect(spy).toHaveBeenLastCalledWith("DELETE", "/api/v1/unsubscribers", undefined, { blockedReceivers: ["a@example.com"] });
    await getTool(server, "ncloud_mailer_delete_recipient_group").call({ groupName: "10대", confirm: true });
    expect(spy).toHaveBeenLastCalledWith("DELETE", "/api/v1/address-book/recipient-groups", { groupName: "10대" });
    expect(() => getTool(server, "ncloud_mailer_delete_addresses").parse({ emailAddresses: [] })).toThrow();
    spy.mockRestore();
  });

  it("get_send_block_list requires targetAddress and passes paging as query; register_unsubscribers posts blockedReceivers", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ content: [], registerStatus: "Not blocked" });
    const tool = getTool(server, "ncloud_mailer_get_send_block_list");
    expect(() => tool.parse({})).toThrow();
    await tool.call({ targetAddress: "x@example.com", size: 5, page: 0 });
    expect(spy).toHaveBeenLastCalledWith("GET", "/api/v1/send-block", { targetAddress: "x@example.com", size: 5, page: 0 });
    await getTool(server, "ncloud_mailer_register_unsubscribers").call({ blockedReceivers: ["x@example.com"] });
    expect(spy).toHaveBeenLastCalledWith("POST", "/api/v1/unsubscribers", undefined, { blockedReceivers: ["x@example.com"] });
    spy.mockRestore();
  });
});
