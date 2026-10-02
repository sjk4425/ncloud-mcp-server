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

// ─── Certificate Manager API 2.0 (opts.v2, 민간존 전용, 메인 계정 키 전용) ─────────────────────────────

function v2Setup(withSts = true) {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  const client = createMockClient();
  const stsClient = new NcloudClient({ accessKey: "a", secretKey: "s", baseUrl: "https://sts.apigw.ntruss.com", regionCode: "KR" });
  registerCertificateManagerTools(server, client, { v2: true, stsClient: withSts ? stsClient : undefined });
  const names = (): string[] => {
    const tools = (server as any)._registeredTools;
    return tools instanceof Map ? [...tools.keys()] : Object.keys(tools);
  };
  return { server, client, stsClient, names };
}

describe("Certificate Manager 2.0 — 등록 게이트와 경로 (security-certificatemanager-* 2.0 표, 2026-10-02)", () => {
  it("v2 미지정이면 ncloud_cm2_* 도구가 하나도 등록되지 않고 1.0 도구만 있다", () => {
    const server = new McpServer({ name: "test", version: "1.0.0" });
    registerCertificateManagerTools(server, createMockClient());
    const tools = (server as any)._registeredTools;
    const names: string[] = tools instanceof Map ? [...tools.keys()] : Object.keys(tools);
    expect(names.some((n) => n.startsWith("ncloud_cm2_"))).toBe(false);
    expect(names).toContain("ncloud_list_certificates");
  });

  it("v2: 23 종 등록(가이드 24 op 중 삭제는 1.0 과 동일해 제외), 1.0 도구는 그대로", () => {
    const t = v2Setup();
    const cm2 = t.names().filter((n) => n.startsWith("ncloud_cm2_"));
    expect(cm2).toHaveLength(23);
    expect(cm2).not.toContain("ncloud_cm2_delete_certificate");
    for (const n of ["ncloud_list_certificates", "ncloud_register_external_certificate", "ncloud_delete_certificate"]) expect(t.names()).toContain(n);
  });

  it("조회 경로: certificateTypes / certificates?page / getCertificates / getPaidCertificates / getVerificationInfo / recentChanges / domains / acme accounts", async () => {
    const t = v2Setup();
    const spy = vi.spyOn(t.client, "requestRaw").mockResolvedValue({ returnCode: "0" });
    await getTool(t.server, "ncloud_cm2_list_certificate_types").call({});
    expect(spy).toHaveBeenLastCalledWith("GET", "/api/v2/certificate/certificateTypes");
    await getTool(t.server, "ncloud_cm2_list_certificates").call({ page: 2, pageSize: 20 });
    expect(spy).toHaveBeenLastCalledWith("GET", "/api/v2/certificate/certificates", { page: 2, pageSize: 20 });
    await getTool(t.server, "ncloud_cm2_list_cloud_certificates").call({});
    expect(spy).toHaveBeenLastCalledWith("GET", "/api/v2/certificate/getCertificates", undefined);
    await getTool(t.server, "ncloud_cm2_list_advanced_certificates").call({ certificateName: "x" });
    expect(spy).toHaveBeenLastCalledWith("GET", "/api/v2/certificate/getPaidCertificates", { certificateName: "x" });
    await getTool(t.server, "ncloud_cm2_get_dcv_status").call({ certificateNo: 55332, domainAddress: "ncloud.com" });
    expect(spy).toHaveBeenLastCalledWith("GET", "/api/v2/certificate/getVerificationInfo/55332", { domainAddress: "ncloud.com" });
    await getTool(t.server, "ncloud_cm2_list_recent_changes").call({ minutes: 60 });
    expect(spy).toHaveBeenLastCalledWith("GET", "/api/v2/certificate/recentChanges", { minutes: 60 });
    await getTool(t.server, "ncloud_cm2_get_certificate_chain").call({ certificateNo: 12345 });
    expect(spy).toHaveBeenLastCalledWith("GET", "/api/v2/certificate/exportCertificate/12345/chain");
    await getTool(t.server, "ncloud_cm2_list_domains").call({ page: 1, pageSize: 10, validState: "VALID" });
    expect(spy).toHaveBeenLastCalledWith("GET", "/api/v2/domain/domains", { page: 1, pageSize: 10, validState: "VALID" });
    await getTool(t.server, "ncloud_cm2_list_eab_credentials").call({});
    expect(spy).toHaveBeenLastCalledWith("GET", "/api/v2/acme/accounts");
    spy.mockRestore();
  });

  it("recentChanges: 창(minutes|seconds|start+end)을 정확히 하나만 받는다", async () => {
    const t = v2Setup();
    const spy = vi.spyOn(t.client, "requestRaw").mockResolvedValue({ returnCode: "0" });
    const none = await getTool(t.server, "ncloud_cm2_list_recent_changes").call({});
    expect(none.isError).toBe(true);
    const both = await getTool(t.server, "ncloud_cm2_list_recent_changes").call({ minutes: 1, seconds: 1 });
    expect(both.isError).toBe(true);
    const half = await getTool(t.server, "ncloud_cm2_list_recent_changes").call({ startDateTime: "2026-10-01T00:00:00" });
    expect(half.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("신청·관리 바디: requestCertificateIssuance / requestPaidCertificateIssuance / {no}/reissue / withExternal(+certificateNo) / revoke / setCertificateRenewal / registPrivateKey / subscription/extend / domains / acme/account / deactivate", async () => {
    const t = v2Setup();
    const spy = vi.spyOn(t.client, "requestRaw").mockResolvedValue({ returnCode: "0" });
    await getTool(t.server, "ncloud_cm2_request_cloud_basic_certificate").call({ certificateName: "c1", commonName: "*.ncloud.com", dnsName: ["ncloud.com"] });
    expect(spy).toHaveBeenLastCalledWith("POST", "/api/v2/certificate/requestCertificateIssuance", undefined, { certificateName: "c1", commonName: "*.ncloud.com", validationMethod: "D", dnsName: ["ncloud.com"] });
    await getTool(t.server, "ncloud_cm2_request_advanced_certificate").call({ csr: "CSR", certificateType: "NCP_PAID_OV_01", certificateName: "c2", commonName: "a.com", validationMethod: "PD", organizationNo: 34 });
    expect(spy).toHaveBeenLastCalledWith("POST", "/api/v2/certificate/requestPaidCertificateIssuance", undefined, { csr: "CSR", certificateType: "NCP_PAID_OV_01", certificateName: "c2", commonName: "a.com", validationMethod: "PD", organizationNo: 34 });
    const ovMissingOrg = await getTool(t.server, "ncloud_cm2_request_advanced_certificate").call({ csr: "CSR", certificateType: "NCP_PAID_OV_01", certificateName: "c2", commonName: "a.com", validationMethod: "D" });
    expect(ovMissingOrg.isError).toBe(true);
    await getTool(t.server, "ncloud_cm2_request_global_edge_certificate").call({ certificateName: "ge", commonName: "ncloud.com" });
    expect(spy).toHaveBeenLastCalledWith("POST", "/api/v2/certificate/requestGedCertificateIssuance", undefined, { certificateName: "ge", commonName: "ncloud.com" });
    await getTool(t.server, "ncloud_cm2_reissue_certificate").call({ certificateNo: 55882, csr: "CSR", certificateName: "c1", commonName: "*.ncloud.com" });
    expect(spy).toHaveBeenLastCalledWith("POST", "/api/v2/certificate/55882/reissue", undefined, { csr: "CSR", certificateName: "c1", commonName: "*.ncloud.com", validationMethod: "D" });
    await getTool(t.server, "ncloud_cm2_register_external_certificate").call({ certificateName: "ext", certificateNo: 9, privateKey: PEM, certificateBody: PEM, certificateChain: PEM });
    expect(spy).toHaveBeenLastCalledWith("POST", "/api/v2/certificate/withExternal", undefined, { certificateName: "ext", privateKey: PEM, certificateBody: PEM, certificateChain: PEM, certificateNo: 9 });
    await getTool(t.server, "ncloud_cm2_revoke_certificate").call({ orderId: "1", certificateNo: 0, revokeType: "superseded", confirm: true });
    expect(spy).toHaveBeenLastCalledWith("POST", "/api/v2/certificate/revoke", undefined, { orderId: "1", certificateNo: 0, revokeType: "superseded" });
    await getTool(t.server, "ncloud_cm2_set_renewal_status").call({ certificateNo: 12345, renewalYn: "Y" });
    expect(spy).toHaveBeenLastCalledWith("POST", "/api/v2/certificate/setCertificateRenewal", undefined, { certificateNo: 12345, renewalYn: "Y" });
    await getTool(t.server, "ncloud_cm2_register_private_key").call({ certificateNo: 1234, privateKey: PEM });
    expect(spy).toHaveBeenLastCalledWith("POST", "/api/v2/certificate/registPrivateKey", undefined, { certificateNo: 1234, privateKey: PEM });
    await getTool(t.server, "ncloud_cm2_extend_subscription").call({ orderId: "1", subscriptionPeriod: "2Y" });
    expect(spy).toHaveBeenLastCalledWith("POST", "/api/v2/certificate/subscription/extend", undefined, { orderId: "1", subscriptionPeriod: "2Y" });
    await getTool(t.server, "ncloud_cm2_register_domain").call({ dmnAddr: "test.ncp-cm.com", dcvType: "PTXT", issueType: "CONSOLE" });
    expect(spy).toHaveBeenLastCalledWith("POST", "/api/v2/domain/domains", undefined, { dmnAddr: "test.ncp-cm.com", dcvType: "PTXT", issueType: "CONSOLE" });
    await getTool(t.server, "ncloud_cm2_delete_domain").call({ dmnId: 573, confirm: true });
    expect(spy).toHaveBeenLastCalledWith("DELETE", "/api/v2/domain/domains/573");
    await getTool(t.server, "ncloud_cm2_create_eab_credential").call({ validationMode: "PRE", certificateTypeCode: "NPD_01", validityDays: 198, alias: "my-acme" });
    expect(spy).toHaveBeenLastCalledWith("POST", "/api/v2/acme/account", undefined, { validationMode: "PRE", certificateTypeCode: "NPD_01", validityDays: 198, alias: "my-acme" });
    await getTool(t.server, "ncloud_cm2_deactivate_eab_credential").call({ accountId: 59723, confirm: true });
    expect(spy).toHaveBeenLastCalledWith("POST", "/api/v2/acme/account/59723/deactivate");
    spy.mockRestore();
  });

  it("dryRun 은 API 를 부르지 않고 미리보기를 돌려준다; 파괴적 도구는 confirm 없이는 호출하지 않는다", async () => {
    const t = v2Setup();
    const spy = vi.spyOn(t.client, "requestRaw").mockResolvedValue({ returnCode: "0" });
    const preview = await getTool(t.server, "ncloud_cm2_request_cloud_basic_certificate").call({ certificateName: "c1", commonName: "a.com", dryRun: true });
    expect(text(preview)).toMatch(/requestCertificateIssuance/);
    const gate = await getTool(t.server, "ncloud_cm2_revoke_certificate").call({ orderId: "1", certificateNo: 1, revokeType: "unspecified" });
    expect(text(gate)).toMatch(/confirm=true/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("다운로드는 requestBinary(POST exportCertificate/{no}, body {certificateNo,type}) + savePath", async () => {
    const t = v2Setup();
    const spy = vi.spyOn(t.client, "requestBinary").mockResolvedValue({ contentType: "application/zip", bytes: 3, savedTo: "/tmp/c.zip" });
    const r = await getTool(t.server, "ncloud_cm2_download_certificate").call({ certificateNo: 12345, savePath: "/tmp/c.zip" });
    expect(spy).toHaveBeenCalledWith("POST", "/api/v2/certificate/exportCertificate/12345", undefined, { certificateNo: 12345, type: "PEM" }, { savePath: "/tmp/c.zip" });
    expect(text(r)).toMatch(/c\.zip/);
    spy.mockRestore();
  });
});

describe("Certificate Manager 2.0 — HTTP 403 (Sub Account 키) 안내", () => {
  it("빈 403 이면 메인 계정 안내 + STS 호출 주체 + (겹치는 op) 1.0 도구 이름을 isError 로 돌려준다", async () => {
    const t = v2Setup();
    const spy = vi.spyOn(t.client, "requestRaw").mockRejectedValue(new Error("API 호출 실패: HTTP 403 (빈 응답)\n  진단 헤더: x-ncp-trace-id: abc"));
    const sts = vi.spyOn(t.stsClient, "requestRaw").mockResolvedValue({ id: "x", loginAlias: "nsupport", userType: "Sub" });
    const r = await getTool(t.server, "ncloud_cm2_list_certificates").call({});
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/main-account/);
    expect(text(r)).toMatch(/userType=Sub, loginAlias=nsupport/);
    expect(text(r)).toMatch(/ncloud_list_certificates/);
    expect(sts).toHaveBeenCalledWith("GET", "/api/v1/caller-identity");
    const r2 = await getTool(t.server, "ncloud_cm2_register_external_certificate").call({ certificateName: "e", privateKey: PEM, certificateBody: PEM, certificateChain: PEM });
    expect(text(r2)).toMatch(/ncloud_register_external_certificate/);
    const r3 = await getTool(t.server, "ncloud_cm2_set_renewal_status").call({ certificateNo: 1, renewalYn: "N" });
    expect(text(r3)).toMatch(/exists only in the 2\.0 API/);
    expect(text(r3)).not.toMatch(/ncloud_list_certificates/);
    spy.mockRestore(); sts.mockRestore();
  });

  it("stsClient 가 없거나 STS 가 실패해도 안내문은 나온다; 403 이 아닌 에러는 그대로 전파", async () => {
    const noSts = v2Setup(false);
    const spy1 = vi.spyOn(noSts.client, "requestRaw").mockRejectedValue(new Error("API call failed: HTTP 403 (empty response)"));
    const r1 = await getTool(noSts.server, "ncloud_cm2_list_certificate_types").call({});
    expect(r1.isError).toBe(true);
    expect(text(r1)).toMatch(/Sub Account keys are rejected/);
    expect(text(r1)).not.toMatch(/Caller identity/);
    spy1.mockRestore();
    const t = v2Setup();
    const spy2 = vi.spyOn(t.client, "requestRaw").mockRejectedValue(new Error("API 호출 실패: HTTP 403 (빈 응답)"));
    const sts = vi.spyOn(t.stsClient, "requestRaw").mockRejectedValue(new Error("boom"));
    const r2 = await getTool(t.server, "ncloud_cm2_list_certificate_types").call({});
    expect(r2.isError).toBe(true);
    expect(text(r2)).not.toMatch(/Caller identity/);
    const spy3 = spy2.mockRejectedValue(new Error("API 호출 실패: HTTP 400\n\n응답: bad"));
    const r3 = await getTool(t.server, "ncloud_cm2_list_certificate_types").call({});
    expect(r3.isError).toBe(true);
    expect(text(r3)).toMatch(/HTTP 400/);
    expect(text(r3)).not.toMatch(/main-account/);
    spy3.mockRestore(); sts.mockRestore();
  });
});
