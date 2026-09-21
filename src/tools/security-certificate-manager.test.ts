import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerCertificateManagerTools } from "./security-certificate-manager.js";

/**
 * Certificate Manager API 1.0 도구 테스트.
 *
 * 2026-09-17 릴리스 노트: createExternalCertificate의 certificateName 제약이 3~30자 → 3~20자로
 * 바뀌었다. 2026-09-21 라이브 실측(Sub Account admin 키)에서는 서버 규칙이 문서보다 한 가지 더
 * 엄격했다 — "must start with an alphabetic character"(HTTP 400, returnCode 2000). 이 테스트는
 * 그 규칙을 호출 전에 걸러내는지와, v1 경로·메서드가 그대로인지 고정한다.
 *
 * SDK가 하는 것처럼 inputSchema로 파싱한 뒤 핸들러를 부른다.
 */
function createMockClient(): NcloudClient {
  return new NcloudClient({
    accessKey: "testAccessKey",
    secretKey: "testSecretKey",
    baseUrl: "https://certificatemanager.apigw.ntruss.com",
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

const PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";
const validBody = { privateKey: PEM, publicKeyCertificate: PEM, certificateChain: PEM };
const text = (r: any) => r.content[0].text as string;

describe("Certificate Manager — certificateName 3~20자 규칙 (2026-09-17)", () => {
  let server: McpServer;
  let client: NcloudClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerCertificateManagerTools(server, client);
  });

  it("accepts a 20-char name that starts with a letter and posts it to the v1 endpoint", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ returnCode: "0", returnMessage: "Success", totalRows: 1 });
    const name = "a" + "b".repeat(19);
    expect(name).toHaveLength(20);
    await getTool(server, "ncloud_register_external_certificate").call({ certificateName: name, ...validBody });
    expect(spy).toHaveBeenCalledWith("POST", "/api/v1/certificate/withExternal", undefined, { certificateName: name, ...validBody });
    spy.mockRestore();
  });

  it("accepts a 3-char name (lower bound)", () => {
    expect(() => getTool(server, "ncloud_register_external_certificate").parse({ certificateName: "a-1", ...validBody })).not.toThrow();
  });

  it("rejects a 21-char name before any API call (the old 30-char limit no longer applies)", async () => {
    const spy = vi.spyOn(client, "requestRaw");
    const name = "a" + "b".repeat(20);
    expect(name).toHaveLength(21);
    expect(() => getTool(server, "ncloud_register_external_certificate").parse({ certificateName: name, ...validBody })).toThrow(/3-20/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("rejects a 2-char name", () => {
    expect(() => getTool(server, "ncloud_register_external_certificate").parse({ certificateName: "ab", ...validBody })).toThrow(/3-20/);
  });

  it("rejects a name that starts with a digit or hyphen (live server rule, not in the docs)", () => {
    const tool = getTool(server, "ncloud_register_external_certificate");
    expect(() => tool.parse({ certificateName: "1abc", ...validBody })).toThrow(/start with a letter/);
    expect(() => tool.parse({ certificateName: "-abc", ...validBody })).toThrow(/start with a letter/);
  });

  it("rejects characters other than letters, digits and '-'", () => {
    const tool = getTool(server, "ncloud_register_external_certificate");
    expect(() => tool.parse({ certificateName: "my_cert", ...validBody })).toThrow();
    expect(() => tool.parse({ certificateName: "my.cert", ...validBody })).toThrow();
    expect(() => tool.parse({ certificateName: "한글이름", ...validBody })).toThrow();
  });

  it("does NOT apply the 20-char limit to delete's verification name (older 21~30-char certificates still exist)", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ returnCode: "0", returnMessage: "Success", totalRows: 0 });
    const legacyName = "STAR-example-com-2026-legacy";
    expect(legacyName.length).toBeGreaterThan(20);
    await getTool(server, "ncloud_delete_certificate").call({ certificateNo: 1, certificateName: legacyName, confirm: true });
    expect(spy).toHaveBeenCalledWith("DELETE", "/api/v1/certificate/1", { certificateName: legacyName });
    spy.mockRestore();
  });
});

describe("Certificate Manager — v1 경로·응답 처리", () => {
  let server: McpServer;
  let client: NcloudClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerCertificateManagerTools(server, client);
  });

  it("list issues GET /api/v1/certificates without query when no filter is given", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ returnCode: "0", returnMessage: "Success", totalRows: 0, sslCertificateList: [] });
    await getTool(server, "ncloud_list_certificates").call({});
    expect(spy).toHaveBeenCalledWith("GET", "/api/v1/certificates", undefined);
    spy.mockRestore();
  });

  it("list forwards filters as query parameters", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ returnCode: "0", returnMessage: "Success", totalRows: 0, sslCertificateList: [] });
    await getTool(server, "ncloud_list_certificates").call({ certificateName: "abc", instanceNo: 42 });
    expect(spy).toHaveBeenCalledWith("GET", "/api/v1/certificates", { certificateName: "abc", instanceNo: 42 });
    spy.mockRestore();
  });

  it("delete without confirm returns the warning and does not call the API", async () => {
    const spy = vi.spyOn(client, "requestRaw");
    const result = await getTool(server, "ncloud_delete_certificate").call({ certificateNo: 7, certificateName: "abc" });
    expect(text(result)).toMatch(/confirm=true/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("surfaces an HTTP 200 body whose returnCode is not '0' as a failure (e.g. 1006 No certificate exists)", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ returnCode: "1006", returnMessage: "No certificate exists.", totalRows: 0 });
    const result = await getTool(server, "ncloud_delete_certificate").call({ certificateNo: 7, certificateName: "abc", confirm: true });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/1006/);
    expect(text(result)).toMatch(/No certificate exists/);
    spy.mockRestore();
  });
});
