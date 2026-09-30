import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerKmsTools } from "./security-kms.js";

/** KMS v2 Create Key — protectionType 은 민간존 문서에만 있다(security-kms2-create-key, 2026-09-30). */
function setup(zone?: "public" | "gov") {
  const server = new McpServer({ name: "t", version: "1.0.0" });
  const client = new NcloudClient({ accessKey: "k", secretKey: "s", baseUrl: zone === "gov" ? "https://ocapi.gov-ncloud.com" : "https://ocapi.ncloud.com", regionCode: "KR" });
  registerKmsTools(server, client, zone ? { zone } : {});
  const tools = (server as any)._registeredTools;
  const e = tools instanceof Map ? tools.get("ncloud_kms_create_key") : tools["ncloud_kms_create_key"];
  return { client, call: (a: any) => e.handler(e.inputSchema.parse(a), {} as any), required: !e.inputSchema.shape.protectionType.isOptional() };
}

describe("KMS create_key: protectionType 존 분기", () => {
  it("public: 필수이며 본문에 실린다", async () => {
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
