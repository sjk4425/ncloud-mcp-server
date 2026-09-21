import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerSensTools } from "./application-sens.js";
import { registerSensBrandMessageTools } from "./application-sens-brandmessage.js";

/**
 * SENS SMS / 알림톡 / 브랜드 메시지 도구 테스트 — 2026-09-21 공식 문서 전량 대조 후 재작성분.
 * 경로·메서드·본문 형태(배열 바디, DELETE+바디), 목록 조회 필수 조합, 시간 형식, 파괴적 게이트를 고정한다.
 * SDK가 하는 것처럼 inputSchema로 파싱한 뒤 핸들러를 부른다.
 */
function createMockClient(): NcloudClient {
  return new NcloudClient({ accessKey: "testAccessKey", secretKey: "testSecretKey", baseUrl: "https://sens.apigw.ntruss.com", regionCode: "KR" });
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
const SMS = "ncp:sms:kr:100000000001:proj";
const KKO = "ncp:kkobizmsg:kr:100000000002:proj";
const encSms = encodeURIComponent(SMS);
const encKko = encodeURIComponent(KKO);

const ENV_KEYS = ["NCLOUD_SENS_SERVICE_ID", "NCLOUD_SENS_SMS_SERVICE_ID", "NCLOUD_SENS_ALIMTALK_SERVICE_ID", "NCLOUD_SENS_BRANDMESSAGE_SERVICE_ID"];

describe("SENS — 도구 구성", () => {
  it("registers SMS 9 + Alim Talk 7 tools, no Push tool (Push is gone from the SENS API docs)", () => {
    const server = new McpServer({ name: "t", version: "1" });
    registerSensTools(server, createMockClient());
    const names = toolNames(server);
    expect(names).toHaveLength(16);
    expect(names.some((n) => /push/i.test(n))).toBe(false);
    expect(names).toContain("ncloud_sens_send_sms");
    expect(names).toContain("ncloud_sens_upload_sms_attachment");
    expect(names).toContain("ncloud_sens_list_alimtalk_channels");
    expect(names).toContain("ncloud_sens_cancel_alimtalk_reservation");
  });

  it("registers 7 Brand Message tools without an image-upload tool (multipart)", () => {
    const server = new McpServer({ name: "t", version: "1" });
    registerSensBrandMessageTools(server, createMockClient());
    const names = toolNames(server);
    expect(names).toHaveLength(7);
    expect(names.every((n) => n.includes("brandmessage"))).toBe(true);
    expect(names.some((n) => /upload|create_.*image/.test(n))).toBe(false);
  });
});

describe("SENS — serviceId 해석(env 우선순위)", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => { for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
  afterEach(() => { for (const k of ENV_KEYS) { if (saved[k] !== undefined) process.env[k] = saved[k]; else delete process.env[k]; } });

  it("errors without any API call when no serviceId is available", async () => {
    const server = new McpServer({ name: "t", version: "1" }); const client = createMockClient();
    registerSensTools(server, client);
    const spy = vi.spyOn(client, "requestRaw");
    const r = await getTool(server, "ncloud_sens_get_sms_status").call({ messageId: "M1" });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/NCLOUD_SENS_SMS_SERVICE_ID/);
    expect(spy).not.toHaveBeenCalled();
  });

  it("brand message falls back to the Alim Talk env (same kkobizmsg service), then the common env", async () => {
    process.env.NCLOUD_SENS_ALIMTALK_SERVICE_ID = KKO;
    const server = new McpServer({ name: "t", version: "1" }); const client = createMockClient();
    registerSensBrandMessageTools(server, client);
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ items: [] });
    await getTool(server, "ncloud_sens_list_brandmessage_images").call({});
    expect(spy.mock.calls[0][1]).toBe(`/brandmessage/v2/services/${encKko}/images`);
  });

  it("the serviceId parameter overrides the env and colons are percent-encoded", async () => {
    process.env.NCLOUD_SENS_SERVICE_ID = "ncp:sms:kr:1:env";
    const server = new McpServer({ name: "t", version: "1" }); const client = createMockClient();
    registerSensTools(server, client);
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({});
    await getTool(server, "ncloud_sens_get_sms_status").call({ serviceId: SMS, messageId: "M1" });
    expect(spy).toHaveBeenCalledWith("GET", `/sms/v2/services/${encSms}/messages/M1`);
    expect(encSms).not.toContain(":");
  });
});

describe("SENS SMS", () => {
  let server: McpServer; let client: NcloudClient;
  beforeEach(() => { server = new McpServer({ name: "t", version: "1" }); client = createMockClient(); registerSensTools(server, client); });
  const send = (a: any) => getTool(server, "ncloud_sens_send_sms").call({ serviceId: SMS, ...a });
  const base = { type: "SMS", from: "0212345678", content: "hello", messages: [{ to: "01012345678" }] };

  it("send posts the documented body without serviceId/dryRun and drops undefined fields", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ requestId: "R1", statusCode: "202", statusName: "success" });
    await send({ ...base, contentType: "AD" });
    expect(spy).toHaveBeenCalledWith("POST", `/sms/v2/services/${encSms}/messages`, undefined, { ...base, contentType: "AD" });
  });

  it("send: dryRun previews; MMS without files gets a warning; files with non-MMS is refused; reserveTime format enforced", async () => {
    const spy = vi.spyOn(client, "requestRaw");
    const preview = await send({ ...base, type: "MMS", dryRun: true });
    expect(spy).not.toHaveBeenCalled();
    expect(text(preview)).toMatch(/Dry-Run Preview/);
    expect(text(preview)).toMatch(/LMS/);
    const refused = await send({ ...base, type: "LMS", files: [{ fileId: "f1" }] });
    expect(refused.isError).toBe(true);
    expect(() => getTool(server, "ncloud_sens_send_sms").parse({ serviceId: SMS, ...base, reserveTime: "2026-10-01 09:00:00" })).toThrow(/YYYY-MM-DD HH:mm/);
    expect(() => getTool(server, "ncloud_sens_send_sms").parse({ serviceId: SMS, ...base, from: "02-123-4567" })).toThrow(/digits only/);
  });

  it("list requires one of requestId / request window / complete window, sends the query, and validates the time format", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ messages: [] });
    const tool = getTool(server, "ncloud_sens_list_sms_requests");
    const none = await tool.call({ serviceId: SMS, type: "SMS" });
    expect(none.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    const half = await tool.call({ serviceId: SMS, requestStartTime: "2026-09-01 00:00:00" });
    expect(half.isError).toBe(true);
    expect(() => tool.parse({ serviceId: SMS, requestStartTime: "2026-09-01T00:00:00", requestEndTime: "2026-09-02 00:00:00" })).toThrow();
    await tool.call({ serviceId: SMS, requestStartTime: "2026-09-01 00:00:00", requestEndTime: "2026-09-02 00:00:00", contentType: "COMM", pageSize: 50 });
    const path = spy.mock.calls[0][1] as string;
    const qs = new URLSearchParams(path.split("?")[1]);
    expect(path.startsWith(`/sms/v2/services/${encSms}/messages?`)).toBe(true);
    expect(qs.get("requestStartTime")).toBe("2026-09-01 00:00:00");
    expect(qs.get("contentType")).toBe("COMM");
    expect(qs.has("serviceId")).toBe(false);
    expect(qs.has("responseFormatType")).toBe(false);
    await tool.call({ serviceId: SMS, requestId: "R1" });
    expect(spy.mock.calls[1][1]).toBe(`/sms/v2/services/${encSms}/messages?requestId=R1`);
  });

  it("reservation status GET and cancel (confirm-gated DELETE)", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ reserveStatus: "READY" });
    await getTool(server, "ncloud_sens_get_sms_reservation_status").call({ serviceId: SMS, reserveId: "RSSA-1" });
    expect(spy).toHaveBeenLastCalledWith("GET", `/sms/v2/services/${encSms}/reservations/RSSA-1/reserve-status`);
    const gate = await getTool(server, "ncloud_sens_cancel_sms_reservation").call({ serviceId: SMS, reserveId: "RSSA-1" });
    expect(text(gate)).toMatch(/confirm=true/);
    expect(spy).toHaveBeenCalledTimes(1);
    await getTool(server, "ncloud_sens_cancel_sms_reservation").call({ serviceId: SMS, reserveId: "RSSA-1", confirm: true });
    expect(spy).toHaveBeenLastCalledWith("DELETE", `/sms/v2/services/${encSms}/reservations/RSSA-1`);
  });

  it("unsubscribes: register/delete send a JSON array body [{clientTelNo}], list passes epoch-ms window", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue([]);
    await getTool(server, "ncloud_sens_register_sms_unsubscribes").call({ serviceId: SMS, clientTelNos: ["01011112222", "01033334444"] });
    expect(spy).toHaveBeenLastCalledWith("POST", `/sms/v2/services/${encSms}/unsubscribes`, undefined, [{ clientTelNo: "01011112222" }, { clientTelNo: "01033334444" }]);
    await getTool(server, "ncloud_sens_delete_sms_unsubscribes").call({ serviceId: SMS, clientTelNos: ["01011112222"], confirm: true });
    expect(spy).toHaveBeenLastCalledWith("DELETE", `/sms/v2/services/${encSms}/unsubscribes`, undefined, [{ clientTelNo: "01011112222" }]);
    await getTool(server, "ncloud_sens_list_sms_unsubscribes").call({ serviceId: SMS, startTime: 1756652400000, endTime: 1758466799000, pageSize: 10 });
    expect(spy).toHaveBeenLastCalledWith("GET", `/sms/v2/services/${encSms}/unsubscribes?startTime=1756652400000&endTime=1758466799000&pageSize=10`);
    expect(() => getTool(server, "ncloud_sens_register_sms_unsubscribes").parse({ serviceId: SMS, clientTelNos: [] })).toThrow();
  });

  it("attachment upload is JSON (not multipart), strips the data-URI prefix, requires .jpg/.jpeg and refuses >300 KB", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ fileId: "F1" });
    const tool = getTool(server, "ncloud_sens_upload_sms_attachment");
    const b64 = Buffer.from("fake-jpeg-bytes").toString("base64");
    await tool.call({ serviceId: SMS, fileName: "banner.jpg", fileBody: `data:image/jpeg;base64,${b64}` });
    expect(spy).toHaveBeenLastCalledWith("POST", `/sms/v2/services/${encSms}/files`, undefined, { fileName: "banner.jpg", fileBody: b64 });
    expect(() => tool.parse({ serviceId: SMS, fileName: "banner.png", fileBody: b64 })).toThrow(/jpg/);
    const big = Buffer.alloc(301 * 1024).toString("base64");
    const refused = await tool.call({ serviceId: SMS, fileName: "big.jpg", fileBody: big });
    expect(refused.isError).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("SENS 알림톡", () => {
  let server: McpServer; let client: NcloudClient;
  beforeEach(() => { server = new McpServer({ name: "t", version: "1" }); client = createMockClient(); registerSensTools(server, client); });
  const msg = { to: "01012345678", content: "주문이 완료되었습니다." };

  it("channels / templates hit the documented paths (templates requires channelId)", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue([]);
    await getTool(server, "ncloud_sens_list_alimtalk_channels").call({ serviceId: KKO });
    expect(spy).toHaveBeenLastCalledWith("GET", `/alimtalk/v2/services/${encKko}/channels`);
    expect(() => getTool(server, "ncloud_sens_list_alimtalk_templates").parse({ serviceId: KKO })).toThrow();
    await getTool(server, "ncloud_sens_list_alimtalk_templates").call({ serviceId: KKO, channelId: "@shop", templateCode: "T1" });
    expect(spy).toHaveBeenLastCalledWith("GET", `/alimtalk/v2/services/${encKko}/templates?channelId=%40shop&templateCode=T1`);
  });

  it("send posts item-list fields (headerContent/itemHighlight/item) and validates WL/AL button links", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ requestId: "R1" });
    const send = (a: any) => getTool(server, "ncloud_sens_send_alimtalk").call({ serviceId: KKO, plusFriendId: "@shop", templateCode: "T1", ...a });
    const rich = { ...msg, headerContent: "주문 안내", itemHighlight: { title: "배송 출발", description: "오늘" }, item: { list: [{ title: "상품", description: "운동화" }, { title: "수량", description: "1" }], summary: { title: "합계", description: "₩59,000" } }, buttons: [{ type: "WL", name: "주문 확인", linkMobile: "https://m.example.com", linkPc: "https://example.com" }] };
    await send({ messages: [rich] });
    expect(spy).toHaveBeenLastCalledWith("POST", `/alimtalk/v2/services/${encKko}/messages`, undefined, { plusFriendId: "@shop", templateCode: "T1", messages: [rich] });
    const bad = await send({ messages: [{ ...msg, buttons: [{ type: "WL", name: "링크", linkMobile: "https://m.example.com" }] }] });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toMatch(/linkPc/);
    const badAl = await send({ messages: [{ ...msg, buttons: [{ type: "AL", name: "앱" }] }] });
    expect(text(badAl)).toMatch(/schemeIos/);
    expect(() => getTool(server, "ncloud_sens_send_alimtalk").parse({ serviceId: KKO, plusFriendId: "@shop", templateCode: "T1", messages: [{ ...msg, item: { list: [{ title: "하나", description: "x" }] } }] })).toThrow();
    const preview = await send({ messages: [msg], reserveTime: "2026-10-01 09:00", dryRun: true });
    expect(text(preview)).toMatch(/Dry-Run Preview/);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("list requires plusFriendId unless requestId is given; get/reservation/cancel paths", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({});
    const list = getTool(server, "ncloud_sens_list_alimtalk_requests");
    const noChannel = await list.call({ serviceId: KKO, requestStartTime: "2026-09-01 00:00:00", requestEndTime: "2026-09-02 00:00:00" });
    expect(noChannel.isError).toBe(true);
    expect(text(noChannel)).toMatch(/plusFriendId/);
    await list.call({ serviceId: KKO, requestId: "R1" });
    expect(spy).toHaveBeenLastCalledWith("GET", `/alimtalk/v2/services/${encKko}/messages?requestId=R1`);
    await list.call({ serviceId: KKO, plusFriendId: "@shop", completeStartTime: "2026-09-01 00:00:00", completeEndTime: "2026-09-01 23:59:59", messageStatusName: "fail" });
    const qs = new URLSearchParams((spy.mock.calls[1][1] as string).split("?")[1]);
    expect(qs.get("plusFriendId")).toBe("@shop");
    expect(qs.get("messageStatusName")).toBe("fail");
    await getTool(server, "ncloud_sens_get_alimtalk_status").call({ serviceId: KKO, messageId: "M1" });
    expect(spy).toHaveBeenLastCalledWith("GET", `/alimtalk/v2/services/${encKko}/messages/M1`);
    await getTool(server, "ncloud_sens_get_alimtalk_reservation_status").call({ serviceId: KKO, reserveId: "RS1" });
    expect(spy).toHaveBeenLastCalledWith("GET", `/alimtalk/v2/services/${encKko}/reservations/RS1/reserve-status`);
    const gate = await getTool(server, "ncloud_sens_cancel_alimtalk_reservation").call({ serviceId: KKO, reserveId: "RS1" });
    expect(text(gate)).toMatch(/confirm=true/);
    await getTool(server, "ncloud_sens_cancel_alimtalk_reservation").call({ serviceId: KKO, reserveId: "RS1", confirm: true });
    expect(spy).toHaveBeenLastCalledWith("DELETE", `/alimtalk/v2/services/${encKko}/reservations/RS1`);
  });
});

describe("SENS 브랜드 메시지", () => {
  let server: McpServer; let client: NcloudClient;
  beforeEach(() => { server = new McpServer({ name: "t", version: "1" }); client = createMockClient(); registerSensBrandMessageTools(server, client); });
  const send = (a: any) => getTool(server, "ncloud_sens_send_brandmessage").call({ serviceId: KKO, plusFriendId: "@shop", ...a });

  it("free-form TEXT send posts the body; AC button refused in free-form, BC/BT refused with a template", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ requestId: "R1" });
    const m = { to: "01012345678", content: "가을 세일 안내", buttons: [{ type: "WL", name: "보기", linkMobile: "https://m.example.com" }] };
    await send({ messageType: "TEXT", messages: [m] });
    expect(spy).toHaveBeenLastCalledWith("POST", `/brandmessage/v2/services/${encKko}/messages`, undefined, { plusFriendId: "@shop", messageType: "TEXT", messages: [m] });
    const ac = await send({ messageType: "TEXT", messages: [{ to: "01012345678", content: "x", buttons: [{ type: "AC", name: "채널 추가" }] }] });
    expect(ac.isError).toBe(true);
    expect(text(ac)).toMatch(/AC/);
    const bt = await send({ messageType: "TEXT", templateCode: "BT1", messages: [{ to: "01012345678", templateParameters: { 이름: "홍길동" }, buttons: [{ type: "BT", name: "챗봇" }] }] });
    expect(bt.isError).toBe(true);
    expect(text(bt)).toMatch(/BT/);
    expect(() => getTool(server, "ncloud_sens_send_brandmessage").parse({ serviceId: KKO, plusFriendId: "@shop", messageType: "TEXT", messages: [{ to: "01012345678", content: "x", buttons: [{ type: "WL", name: "열다섯글자가넘는버튼이름입니다" }] }] })).toThrow();
  });

  it("type-specific required objects are checked before the call (COMMERCE needs commerce, WIDE_ITEM_LIST needs headerContent)", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({});
    const c = await send({ messageType: "COMMERCE", messages: [{ to: "01012345678" }] });
    expect(c.isError).toBe(true);
    expect(text(c)).toMatch(/commerce/);
    const w = await send({ messageType: "WIDE_ITEM_LIST", messages: [{ to: "01012345678", item: { list: [] } }] });
    expect(text(w)).toMatch(/headerContent/);
    expect(spy).not.toHaveBeenCalled();
    const preview = await send({ messageType: "COMMERCE", messages: [{ to: "01012345678", commerce: { title: "운동화", regularPrice: "59000" }, buttons: [{ type: "WL", name: "구매", linkMobile: "https://m.example.com" }] }], dryRun: true });
    expect(text(preview)).toMatch(/free-form/);
    expect(text(preview)).toMatch(/3022/);
  });

  it("list/get/templates/images paths; templates use plusFriendId; image delete is confirm-gated", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ items: [] });
    const list = getTool(server, "ncloud_sens_list_brandmessage_requests");
    const noChannel = await list.call({ serviceId: KKO, requestStartTime: "2026-09-01 00:00:00", requestEndTime: "2026-09-02 00:00:00" });
    expect(noChannel.isError).toBe(true);
    await list.call({ serviceId: KKO, plusFriendId: "@shop", requestStartTime: "2026-09-01 00:00:00", requestEndTime: "2026-09-02 00:00:00" });
    expect((spy.mock.calls[0][1] as string).startsWith(`/brandmessage/v2/services/${encKko}/messages?`)).toBe(true);
    await getTool(server, "ncloud_sens_get_brandmessage_status").call({ serviceId: KKO, messageId: "M1" });
    expect(spy).toHaveBeenLastCalledWith("GET", `/brandmessage/v2/services/${encKko}/messages/M1`);
    expect(() => getTool(server, "ncloud_sens_list_brandmessage_templates").parse({ serviceId: KKO })).toThrow();
    await getTool(server, "ncloud_sens_list_brandmessage_templates").call({ serviceId: KKO, plusFriendId: "@shop", messageType: "IMAGE" });
    expect(spy).toHaveBeenLastCalledWith("GET", `/brandmessage/v2/services/${encKko}/templates?plusFriendId=%40shop&messageType=IMAGE`);
    await getTool(server, "ncloud_sens_list_brandmessage_images").call({ serviceId: KKO, pageSize: 200 });
    expect(spy).toHaveBeenLastCalledWith("GET", `/brandmessage/v2/services/${encKko}/images?pageSize=200`);
    expect(() => getTool(server, "ncloud_sens_list_brandmessage_images").parse({ serviceId: KKO, pageSize: 201 })).toThrow();
    await getTool(server, "ncloud_sens_get_brandmessage_image").call({ serviceId: KKO, imageId: "I1" });
    expect(spy).toHaveBeenLastCalledWith("GET", `/brandmessage/v2/services/${encKko}/images/I1`);
    const gate = await getTool(server, "ncloud_sens_delete_brandmessage_image").call({ serviceId: KKO, imageId: "I1" });
    expect(text(gate)).toMatch(/confirm=true/);
    await getTool(server, "ncloud_sens_delete_brandmessage_image").call({ serviceId: KKO, imageId: "I1", confirm: true });
    expect(spy).toHaveBeenLastCalledWith("DELETE", `/brandmessage/v2/services/${encKko}/images/I1`);
  });
});
