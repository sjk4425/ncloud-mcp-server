import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerOutboundMailerTools } from "./application-outbound-mailer.js";
import { registerSensMailTools } from "./application-sens-mail.js";

/**
 * application 그룹 존 차이 — 민간존은 Mailer 가 SENS 로 흡수(메일 = SENS /mail/v2), 공공존은 SENS(메일 채널 없음)와
 * Cloud Outbound Mailer(정식, 발송·조회 포함)가 별개. 공공존 Mailer 5 op 스펙: api-gov …-createmailrequest 등(2026-09-30).
 */
function setup(reg: (s: McpServer, c: NcloudClient, o: any) => void, zone?: "public" | "gov" | "fin") {
  const server = new McpServer({ name: "t", version: "1.0.0" });
  const client = new NcloudClient({ accessKey: "k", secretKey: "s", baseUrl: "https://x", regionCode: zone === "fin" ? "FKR" : "KR" });
  reg(server, client, zone ? { zone } : {});
  const tools = (server as any)._registeredTools;
  const e = (n: string) => (tools instanceof Map ? tools.get(n) : tools[n]);
  return { client, has: (n: string) => !!e(n), desc: (n: string) => e(n).description as string, call: (n: string, a: any) => e(n).handler(e(n).inputSchema.parse(a), {} as any) };
}

describe("Outbound Mailer: 존별 도구 집합과 레거시 태그", () => {
  it("public: 레거시 태그 붙음, 발송·조회 5종 없음", () => {
    const t = setup(registerOutboundMailerTools);
    expect(t.desc("ncloud_mailer_get_template")).toContain("[Legacy Cloud Outbound Mailer API");
    expect(t.has("ncloud_mailer_send_mail")).toBe(false);
    expect(t.has("ncloud_mailer_list_requests")).toBe(false);
  });
  it("gov: 레거시 태그 없음, 발송·조회 5종 등록되고 가이드 경로로 호출한다", async () => {
    const t = setup(registerOutboundMailerTools, "gov");
    expect(t.desc("ncloud_mailer_get_template")).not.toContain("[Legacy");
    const spy = vi.spyOn(t.client, "requestRaw").mockResolvedValue({});
    await t.call("ncloud_mailer_send_mail", { senderAddress: "a@b.kr", title: "t", body: "b", recipients: [{ address: "c@d.kr", type: "R" }] });
    await t.call("ncloud_mailer_list_requests", { startUtc: 1, endUtc: 2, sendStatus: "S,F", page: 0 });
    await t.call("ncloud_mailer_get_request_status", { requestId: "req1" });
    await t.call("ncloud_mailer_list_mails", { requestId: "req1", size: 5 });
    await t.call("ncloud_mailer_get_mail", { mailId: "m1", region: "SGN" });
    expect(spy.mock.calls.map((c) => [c[0], c[1], c[2], c[3]])).toEqual([
      ["POST", "/api/v1/mails", undefined, { senderAddress: "a@b.kr", title: "t", body: "b", recipients: [{ address: "c@d.kr", type: "R" }] }],
      ["GET", "/api/v1/mails/requests", { startUtc: 1, endUtc: 2, sendStatus: "S,F", page: 0 }, undefined],
      ["GET", "/api/v1/mails/requests/req1/status", undefined, undefined],
      ["GET", "/api/v1/mails/requests/req1/mails", { size: 5 }, undefined],
      ["GET", "/api/v1-sgn/mails/m1", undefined, undefined],
    ]);
  });
  it("gov send_mail: 필수 조합 검증 — templateSid 도 sender/title/body 도 없거나 수신자 없으면 거절", async () => {
    const t = setup(registerOutboundMailerTools, "gov");
    const spy = vi.spyOn(t.client, "requestRaw");
    expect((await t.call("ncloud_mailer_send_mail", { recipients: [{ address: "c@d.kr" }] })).isError).toBe(true);
    expect((await t.call("ncloud_mailer_send_mail", { templateSid: 1 })).isError).toBe(true);
    expect((await t.call("ncloud_mailer_list_requests", { startUtc: 1 })).isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("Outbound Mailer / SENS mail: 금융존은 공공존과 같다 (api-fin, 2026-09-30)", () => {
  it("fin: 레거시 태그 없음, 발송·조회 5종 등록, FKR 은 /api/v1 경로", async () => {
    const t = setup(registerOutboundMailerTools, "fin");
    expect(t.desc("ncloud_mailer_get_template")).not.toContain("[Legacy");
    for (const n of ["ncloud_mailer_send_mail", "ncloud_mailer_list_requests", "ncloud_mailer_get_mail"]) expect(t.has(n), n).toBe(true);
    const spy = vi.spyOn(t.client, "requestRaw").mockResolvedValue({});
    await t.call("ncloud_mailer_get_template", { templateSid: 7 });
    expect(spy).toHaveBeenCalledWith("GET", "/api/v1/template/7");
  });
  it("fin: SENS 메일 5종 미등록", () => {
    const t = setup(registerSensMailTools, "fin");
    expect(t.has("ncloud_sens_send_mail")).toBe(false);
    expect(t.has("ncloud_sens_list_projects")).toBe(true);
  });
});

describe("SENS mail: 공공존은 메일 채널 없이 프로젝트 도구만", () => {
  it("public 은 메일 5종 + 프로젝트, gov 는 프로젝트만", () => {
    const pub = setup(registerSensMailTools);
    const gov = setup(registerSensMailTools, "gov");
    for (const n of ["ncloud_sens_send_mail", "ncloud_sens_list_mail_requests", "ncloud_sens_get_mail_request", "ncloud_sens_list_mails", "ncloud_sens_get_mail"]) {
      expect(pub.has(n), n).toBe(true);
      expect(gov.has(n), n).toBe(false);
    }
    expect(gov.has("ncloud_sens_list_projects")).toBe(true);
    expect(gov.has("ncloud_sens_create_project")).toBe(true);
  });
});
