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
  it("pub: 2.0 경로 그대로", async () => {
    const t = cryptoSetup("pub");
    expect(t.has("ncloud_kms_create_key")).toBe(true);
    const spy = vi.spyOn(t.client, "requestRaw").mockResolvedValue({});
    await t.call("ncloud_kms_create_custom_key", { keyTag: "tag1" });
    expect(spy).toHaveBeenCalledWith("POST", "/kms/v1/keys/tag1/create-custom-key", undefined, {});
    await t.call("ncloud_kms_sign", { keyTag: "tag1", data: "QQ==" });
    expect(spy).toHaveBeenCalledWith("POST", "/kms/v1/keys/tag1/sign", undefined, { data: "QQ==" });
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
