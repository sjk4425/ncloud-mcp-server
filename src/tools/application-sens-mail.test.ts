import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerSensMailTools } from "./application-sens-mail.js";

/**
 * SENS Mail(/mail/v2) + Project(/common/v2) 도구 테스트.
 * 2026-09-17 Cloud Outbound Mailer → SENS 통합으로 신설된 메일 API 5종 + 프로젝트 API 5종.
 * SDK가 하는 것처럼 inputSchema로 파싱한 뒤 핸들러를 부른다.
 */
function createMockClient(): NcloudClient {
  return new NcloudClient({
    accessKey: "testAccessKey",
    secretKey: "testSecretKey",
    baseUrl: "https://sens.apigw.ntruss.com",
    regionCode: "KR",
  });
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

const text = (r: any) => r.content[0].text as string;
const NRN = "ncp:mail:kr:100000000002:main";
const ENC = encodeURIComponent(NRN);
const TO = [{ address: "a@example.com" }];

describe("SENS Mail — serviceId 해석", () => {
  let server: McpServer;
  let client: NcloudClient;
  const saved = { mail: process.env.NCLOUD_SENS_MAIL_SERVICE_ID, all: process.env.NCLOUD_SENS_SERVICE_ID };

  beforeEach(() => {
    delete process.env.NCLOUD_SENS_MAIL_SERVICE_ID;
    delete process.env.NCLOUD_SENS_SERVICE_ID;
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
  });
  afterEach(() => {
    if (saved.mail !== undefined) process.env.NCLOUD_SENS_MAIL_SERVICE_ID = saved.mail;
    if (saved.all !== undefined) process.env.NCLOUD_SENS_SERVICE_ID = saved.all;
  });

  it("returns an error without calling the API when neither parameter nor env provides a serviceId", async () => {
    registerSensMailTools(server, client);
    const spy = vi.spyOn(client, "requestRaw");
    const result = await getTool(server, "ncloud_sens_get_mail_request").call({ requestId: "R1" });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/serviceId/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("uses NCLOUD_SENS_MAIL_SERVICE_ID from the environment and percent-encodes the NRN colons", async () => {
    process.env.NCLOUD_SENS_MAIL_SERVICE_ID = NRN;
    registerSensMailTools(server, client);
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ requestId: "R1", status: "COMPLETED" });
    await getTool(server, "ncloud_sens_get_mail_request").call({ requestId: "R1" });
    expect(spy).toHaveBeenCalledWith("GET", `/mail/v2/services/${ENC}/requests/R1`);
    expect(ENC).not.toContain(":");
    spy.mockRestore();
  });

  it("the serviceId parameter overrides the environment", async () => {
    process.env.NCLOUD_SENS_MAIL_SERVICE_ID = "ncp:mail:kr:1:env";
    registerSensMailTools(server, client);
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({});
    await getTool(server, "ncloud_sens_get_mail_request").call({ serviceId: NRN, requestId: "R1" });
    expect(spy.mock.calls[0][1]).toBe(`/mail/v2/services/${ENC}/requests/R1`);
    spy.mockRestore();
  });
});

describe("SENS Mail — 발송 요청 (POST /mail/v2/services/{serviceId}/requests)", () => {
  let server: McpServer;
  let client: NcloudClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerSensMailTools(server, client);
  });

  const send = (args: any) => getTool(server, "ncloud_sens_send_mail").call({ serviceId: NRN, ...args });

  it("posts the documented body (undefined fields dropped) and appends the 202 hint", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ requestId: "R1", requestCount: 1, createDateTime: "2026-09-21T10:00:00+09:00" });
    const result = await send({ senderAddress: "no-reply@example.com", title: "hi ${name}", body: "<p>hello</p>", recipients: TO, parameters: { name: "A" } });
    expect(spy).toHaveBeenCalledTimes(1);
    const [method, path, query, body] = spy.mock.calls[0];
    expect(method).toBe("POST");
    expect(path).toBe(`/mail/v2/services/${ENC}/requests`);
    expect(query).toBeUndefined();
    expect(body).toEqual({ senderAddress: "no-reply@example.com", title: "hi ${name}", body: "<p>hello</p>", recipients: TO, parameters: { name: "A" } });
    expect(text(result)).toMatch(/"requestId":\s*"R1"/);
    expect(text(result)).toMatch(/ncloud_sens_get_mail_request/);
    spy.mockRestore();
  });

  it("dryRun returns a preview with the endpoint and recipient count and does not call the API", async () => {
    const spy = vi.spyOn(client, "requestRaw");
    const result = await send({ senderAddress: "s@example.com", title: "t", body: "b", recipients: TO, dryRun: true });
    expect(spy).not.toHaveBeenCalled();
    const t = text(result);
    expect(t).toMatch(/Dry-Run Preview/);
    expect(t).toMatch(new RegExp(`/mail/v2/services/${ENC.replace(/[%]/g, "\\%")}/requests`));
    expect(t).toMatch(/"recipientCount":\s*1/);
    spy.mockRestore();
  });

  it("without templateNo, senderAddress/title/body are required — refused before the call", async () => {
    const spy = vi.spyOn(client, "requestRaw");
    const result = await send({ title: "t", recipients: TO });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/senderAddress/);
    expect(text(result)).toMatch(/body/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("with templateNo, sender/title/body may be omitted", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ requestId: "R2" });
    const result = await send({ templateNo: 12, recipients: TO });
    expect(result.isError).toBeUndefined();
    expect(spy.mock.calls[0][3]).toEqual({ templateNo: 12, recipients: TO });
    spy.mockRestore();
  });

  it("requires recipients or recipientGroupFilter", async () => {
    const spy = vi.spyOn(client, "requestRaw");
    const result = await send({ senderAddress: "s@example.com", title: "t", body: "b" });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/recipientGroupFilter/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("refuses CC/BCC with individual=true (default) and accepts them with individual=false", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ requestId: "R3" });
    const withCc = { senderAddress: "s@example.com", title: "t", body: "b", recipients: [...TO, { address: "c@example.com", type: "CC" }] };
    const refused = await send(withCc);
    expect(refused.isError).toBe(true);
    expect(text(refused)).toMatch(/CC\/BCC/);
    expect(spy).not.toHaveBeenCalled();
    const ok = await send({ ...withCc, individual: false });
    expect(ok.isError).toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("refuses a recipient list with no TO recipient", async () => {
    const result = await send({ senderAddress: "s@example.com", title: "t", body: "b", individual: false, recipients: [{ address: "c@example.com", type: "BCC" }] });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/TO/);
  });

  it("refuses recipientGroupFilter with individual=false and advertising with individual=false", async () => {
    const r1 = await send({ senderAddress: "s@example.com", title: "t", body: "b", individual: false, recipientGroupFilter: { groups: ["g1"] } });
    expect(r1.isError).toBe(true);
    expect(text(r1)).toMatch(/recipientGroupFilter/);
    const r2 = await send({ senderAddress: "s@example.com", title: "t", body: "b", individual: false, advertising: true, recipients: TO });
    expect(r2.isError).toBe(true);
    expect(text(r2)).toMatch(/advertising/);
  });
});

describe("SENS Mail — 조회 (GET)", () => {
  let server: McpServer;
  let client: NcloudClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerSensMailTools(server, client);
  });

  it("list_mail_requests requires fromDateTime/toDateTime and sends filters as query (serviceId excluded)", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ requests: [], totalElements: 0 });
    const tool = getTool(server, "ncloud_sens_list_mail_requests");
    expect(() => tool.parse({ serviceId: NRN, fromDateTime: "2026-09-01T00:00:00+09:00" })).toThrow();
    await tool.call({ serviceId: NRN, fromDateTime: "2026-09-01T00:00:00+09:00", toDateTime: "2026-09-21T23:59:59+09:00", status: "COMPLETED", pageSize: 50 });
    const path = spy.mock.calls[0][1] as string;
    expect(path.startsWith(`/mail/v2/services/${ENC}/requests?`)).toBe(true);
    const qs = new URLSearchParams(path.split("?")[1]);
    expect(qs.get("fromDateTime")).toBe("2026-09-01T00:00:00+09:00");
    expect(qs.get("status")).toBe("COMPLETED");
    expect(qs.get("pageSize")).toBe("50");
    expect(qs.has("serviceId")).toBe(false);
    spy.mockRestore();
  });

  it("list_mails repeats the status key for each value and excludes requestId from the query", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ mails: [] });
    await getTool(server, "ncloud_sens_list_mails").call({ serviceId: NRN, requestId: "R1", status: ["FAILED", "PARTIAL_FAILED"] });
    const path = spy.mock.calls[0][1] as string;
    expect(path.startsWith(`/mail/v2/services/${ENC}/requests/R1/mails?`)).toBe(true);
    const qs = new URLSearchParams(path.split("?")[1]);
    expect(qs.getAll("status")).toEqual(["FAILED", "PARTIAL_FAILED"]);
    expect(qs.has("requestId")).toBe(false);
    spy.mockRestore();
  });

  it("get_mail hits the mail detail path", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ mailId: "M1", recipients: [] });
    await getTool(server, "ncloud_sens_get_mail").call({ serviceId: NRN, requestId: "R1", mailId: "M1" });
    expect(spy).toHaveBeenCalledWith("GET", `/mail/v2/services/${ENC}/requests/R1/mails/M1`);
    spy.mockRestore();
  });
});

describe("SENS Project (/common/v2/projects)", () => {
  let server: McpServer;
  let client: NcloudClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerSensMailTools(server, client);
  });

  it("list_projects issues GET /common/v2/projects with optional filters", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue([]);
    await getTool(server, "ncloud_sens_list_projects").call({});
    expect(spy).toHaveBeenCalledWith("GET", "/common/v2/projects");
    await getTool(server, "ncloud_sens_list_projects").call({ projectName: "mail-", pageSize: 10 });
    expect(spy.mock.calls[1][1]).toBe("/common/v2/projects?projectName=mail-&pageSize=10");
    spy.mockRestore();
  });

  it("create_project validates projectName and posts the body; dryRun does not call", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ projectId: "p1" });
    const tool = getTool(server, "ncloud_sens_create_project");
    expect(() => tool.parse({ projectName: "Has Upper" })).toThrow();
    expect(() => tool.parse({ projectName: "a".repeat(25) })).toThrow();
    const preview = await tool.call({ projectName: "mail-ops", useSms: true, dryRun: true });
    expect(spy).not.toHaveBeenCalled();
    expect(text(preview)).toMatch(/Dry-Run Preview/);
    await tool.call({ projectName: "mail-ops", useSms: true });
    expect(spy).toHaveBeenCalledWith("POST", "/common/v2/projects", undefined, { projectName: "mail-ops", useSms: true });
    spy.mockRestore();
  });

  it("update_project refuses an empty change set and PUTs otherwise", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ projectId: "p1" });
    const tool = getTool(server, "ncloud_sens_update_project");
    const empty = await tool.call({ projectId: "p1" });
    expect(empty.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    await tool.call({ projectId: "p1", useKkoBizMsg: false });
    expect(spy).toHaveBeenCalledWith("PUT", "/common/v2/projects/p1", undefined, { useKkoBizMsg: false });
    spy.mockRestore();
  });

  it("delete_project is confirm-gated and issues DELETE when confirmed", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ success: true });
    const tool = getTool(server, "ncloud_sens_delete_project");
    const gate = await tool.call({ projectId: "p1" });
    expect(text(gate)).toMatch(/confirm=true/);
    expect(spy).not.toHaveBeenCalled();
    await tool.call({ projectId: "p1", confirm: true });
    expect(spy).toHaveBeenCalledWith("DELETE", "/common/v2/projects/p1");
    spy.mockRestore();
  });
});
