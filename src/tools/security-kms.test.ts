import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerKmsTools } from "./security-kms.js";

/** KMS 암·복호화 경로 — 2.0 `/kms/v1/keys/{keyTag}/{op}`, 금융존 v1 게이트웨이 `/keys/v2/{keyTag}/{op}` (security-kms-*, api-fin 2026-09-30). */
function cryptoSetup(zone: "pub" | "fin") {
  const server = new McpServer({ name: "t", version: "1.0.0" });
  const client = new NcloudClient({ accessKey: "k", secretKey: "s", baseUrl: zone === "fin" ? "https://kms.apigw.fin-ntruss.com" : "https://ocapi.ncloud.com", regionCode: zone === "fin" ? "FKR" : "KR" });
  registerKmsTools(server, client, { zone });
  const tools = (server as any)._registeredTools;
  const entry = (n: string) => (tools instanceof Map ? tools.get(n) : tools[n]);
  return { client, has: (n: string) => !!entry(n), call: (n: string, a: any) => entry(n).handler(entry(n).inputSchema.parse(a), {} as any) };
}

describe("KMS 암·복호화: 존별 경로와 도구 집합", () => {
  it("fin: 6종만 등록되고 /keys/v2/{keyTag}/… (createCustomKey 는 camelCase)", async () => {
    const t = cryptoSetup("fin");
    for (const n of ["ncloud_kms_create_key", "ncloud_kms_get_key_list", "ncloud_kms_add_acl_rule", "ncloud_kms_create_token_set"]) expect(t.has(n), n).toBe(false);
    const spy = vi.spyOn(t.client, "requestRaw").mockResolvedValue({});
    await t.call("ncloud_kms_encrypt", { keyTag: "tag1", plaintext: "QQ==" });
    expect(spy).toHaveBeenCalledWith("POST", "/keys/v2/tag1/encrypt", undefined, { plaintext: "QQ==" });
    await t.call("ncloud_kms_create_custom_key", { keyTag: "tag1", bits: 256 });
    expect(spy).toHaveBeenCalledWith("POST", "/keys/v2/tag1/createCustomKey", undefined, { bits: 256 });
    await t.call("ncloud_kms_verify", { keyTag: "tag1", data: "QQ==", signature: "s" });
    expect(spy).toHaveBeenCalledWith("POST", "/keys/v2/tag1/verify", undefined, { data: "QQ==", signature: "s" });
  });
  it("pub: 2.0 경로 그대로 (재암호화는 /re-encrypt)", async () => {
    const t = cryptoSetup("pub");
    expect(t.has("ncloud_kms_create_key")).toBe(true);
    const spy = vi.spyOn(t.client, "requestRaw").mockResolvedValue({});
    await t.call("ncloud_kms_create_custom_key", { keyTag: "tag1" });
    expect(spy).toHaveBeenCalledWith("POST", "/kms/v1/keys/tag1/create-custom-key", undefined, {});
    await t.call("ncloud_kms_sign", { keyTag: "tag1", data: "QQ==" });
    expect(spy).toHaveBeenCalledWith("POST", "/kms/v1/keys/tag1/sign", undefined, { data: "QQ==" });
    await t.call("ncloud_kms_reencrypt", { keyTag: "tag1", ciphertext: "c" });
    expect(spy).toHaveBeenCalledWith("POST", "/kms/v1/keys/tag1/re-encrypt", undefined, { ciphertext: "c" });
  });
  it("fin: 재암호화는 v1 게이트웨이 /reencrypt", async () => {
    const t = cryptoSetup("fin");
    const spy = vi.spyOn(t.client, "requestRaw").mockResolvedValue({});
    await t.call("ncloud_kms_reencrypt", { keyTag: "tag1", ciphertext: ["a", "b"] });
    expect(spy).toHaveBeenCalledWith("POST", "/keys/v2/tag1/reencrypt", undefined, { ciphertext: ["a", "b"] });
  });
});

/** KMS 2.0 키 관리·ACL·토큰·로그 — 경로/메서드를 공식 가이드(security-kms2-*, 2026-10-02 대조)에 맞춘다. */
describe("KMS 2.0 관리 도구: 가이드 경로·메서드", () => {
  const t = cryptoSetup("pub");
  const spy = vi.spyOn(t.client, "requestRaw").mockResolvedValue({});
  const last = () => spy.mock.calls[spy.mock.calls.length - 1];

  it("public key: POST get-pub-key (keyVersion 선택)", async () => {
    await t.call("ncloud_kms_get_public_key", { keyTag: "k" });
    expect(last()).toEqual(["POST", "/kms/v1/keys/k/get-pub-key", undefined, {}]);
    await t.call("ncloud_kms_get_public_key", { keyTag: "k", keyVersion: 2 });
    expect(last()).toEqual(["POST", "/kms/v1/keys/k/get-pub-key", undefined, { keyVersion: 2 }]);
  });
  it("name / memo / rotation-period 는 PUT", async () => {
    await t.call("ncloud_kms_update_key_name", { keyTag: "k", keyName: "n2" });
    expect(last()).toEqual(["PUT", "/kms/v1/keys/k/name", undefined, { keyName: "n2" }]);
    await t.call("ncloud_kms_update_memo", { keyTag: "k", memo: "m" });
    expect(last()).toEqual(["PUT", "/kms/v1/keys/k/memo", undefined, { memo: "m" }]);
    await t.call("ncloud_kms_update_rotation_period", { keyTag: "k", rotationPeriod: 30 });
    expect(last()).toEqual(["PUT", "/kms/v1/keys/k/rotation-period", undefined, { rotationPeriod: 30 }]);
  });
  it("IP ACL: /acl 계열, ipList 본문, DELETE 는 confirm 게이트", async () => {
    await t.call("ncloud_kms_enable_ip_acl", { keyTag: "k" });
    expect(last()[0]).toBe("POST"); expect(last()[1]).toBe("/kms/v1/keys/k/acl/enable");
    await t.call("ncloud_kms_disable_ip_acl", { keyTag: "k" });
    expect(last()[1]).toBe("/kms/v1/keys/k/acl/disable");
    await t.call("ncloud_kms_get_acl_rule_list", { keyTag: "k" });
    expect(last()[0]).toBe("GET"); expect(last()[1]).toBe("/kms/v1/keys/k/acl");
    await t.call("ncloud_kms_add_acl_rule", { keyTag: "k", ipList: ["10.0.0.1"] });
    expect(last()).toEqual(["POST", "/kms/v1/keys/k/acl", undefined, { ipList: ["10.0.0.1"] }]);
    spy.mockClear();
    const refused = await t.call("ncloud_kms_delete_acl_rule", { keyTag: "k", ipList: ["10.0.0.1"] });
    expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(refused)).toContain("confirm=true");
    await t.call("ncloud_kms_delete_acl_rule", { keyTag: "k", ipList: ["10.0.0.1"], confirm: true });
    expect(last()).toEqual(["DELETE", "/kms/v1/keys/k/acl", undefined, { ipList: ["10.0.0.1"] }]);
  });
  it("token generator PUT, token-set POST(유효시간 선택)", async () => {
    await t.call("ncloud_kms_update_token_generator", { keyTag: "k" });
    expect(last()[0]).toBe("PUT"); expect(last()[1]).toBe("/kms/v1/keys/k/token-generator");
    await t.call("ncloud_kms_create_token_set", { keyTag: "k" });
    expect(last()).toEqual(["POST", "/kms/v1/keys/k/token-set", undefined, {}]);
    await t.call("ncloud_kms_create_token_set", { keyTag: "k", accessTokenHours: 24, refreshTokenHours: "UL" });
    expect(last()).toEqual(["POST", "/kms/v1/keys/k/token-set", undefined, { accessTokenHours: 24, refreshTokenHours: "UL" }]);
  });
  it("activities / last-use-info", async () => {
    await t.call("ncloud_kms_get_key_activity_logs", { keyTag: "k", keyword: "enc", timestampFrom: 1, pageSize: 10 });
    expect(last()[0]).toBe("GET"); expect(last()[1]).toBe("/kms/v1/keys/k/activities");
    expect(last()[2]).toEqual({ keyword: "enc", timestampFrom: 1, pageSize: 10 });
    await t.call("ncloud_kms_get_latest_use_info", { keyTag: "k" });
    expect(last()[1]).toBe("/kms/v1/keys/k/last-use-info");
  });
});

/** KMS v2 Create Key — protectionType 은 민간존 문서에만 있다(security-kms2-create-key, 2026-09-30). */
function setup(zone?: "pub" | "gov") {
  const server = new McpServer({ name: "t", version: "1.0.0" });
  const client = new NcloudClient({ accessKey: "k", secretKey: "s", baseUrl: zone === "gov" ? "https://ocapi.gov-ncloud.com" : "https://ocapi.ncloud.com", regionCode: "KR" });
  registerKmsTools(server, client, zone ? { zone } : {});
  const tools = (server as any)._registeredTools;
  const e = tools instanceof Map ? tools.get("ncloud_kms_create_key") : tools["ncloud_kms_create_key"];
  return { client, call: (a: any) => e.handler(e.inputSchema.parse(a), {} as any), required: !e.inputSchema.shape.protectionType.isOptional() };
}

describe("KMS create_key: protectionType 존 분기", () => {
  it("pub: 필수이며 본문에 실린다", async () => {
    const t = setup();
    expect(t.required).toBe(true);
    const spy = vi.spyOn(t.client, "requestRaw").mockResolvedValue({});
    await t.call({ keyName: "k1", keyType: "AES256", protectionType: "BASIC" });
    expect(spy).toHaveBeenCalledWith("POST", "/kms/v1/keys", undefined, { keyName: "k1", keyType: "AES256", protectionType: "BASIC", isAutoRotation: false });
  });
  it("gov: 선택이며 보내지 않고, 주면 API 호출 없이 거절", async () => {
    const t = setup("gov");
    expect(t.required).toBe(false);
    const spy = vi.spyOn(t.client, "requestRaw").mockResolvedValue({});
    await t.call({ keyName: "k1", keyType: "AES256" });
    expect(spy).toHaveBeenCalledWith("POST", "/kms/v1/keys", undefined, { keyName: "k1", keyType: "AES256", isAutoRotation: false });
    spy.mockClear();
    const res = await t.call({ keyName: "k1", keyType: "AES256", protectionType: "BASIC" });
    expect(res.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});
