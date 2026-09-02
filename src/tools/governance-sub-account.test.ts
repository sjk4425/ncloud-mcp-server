import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerSubAccountTools } from "./governance-sub-account.js";

function createMockClient(): NcloudClient {
  return new NcloudClient({
    accessKey: "testAccessKey",
    secretKey: "testSecretKey",
    baseUrl: "https://subaccount.apigw.ntruss.com",
    regionCode: "KR",
  });
}

function getToolHandler(server: McpServer, toolName: string): any {
  const tools = (server as any)._registeredTools;
  if (!tools) throw new Error("No registered tools found on server");
  const entry = tools instanceof Map ? tools.get(toolName) : tools[toolName];
  if (!entry) throw new Error(`Tool ${toolName} not found`);
  return entry.handler;
}

/** 도구 응답(JSON 텍스트)에서 원본 객체를 되돌린다. */
function parsed(result: any): any {
  return JSON.parse(result.content[0].text);
}

describe("Sub Account tools — Ncloud Sub Account API 대조 수정분", () => {
  let server: McpServer;
  let client: NcloudClient;
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerSubAccountTools(server, client);
    spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ success: true });
  });

  describe("detach policy — 정책 ID는 경로가 아니라 바디의 policyIdList", () => {
    it("sub account: DELETEs /sub-accounts/{id}/policies with a policyIdList body", async () => {
      const handler = getToolHandler(server, "ncloud_detach_policy_from_sub_account");
      await handler({ subAccountId: "sa-1", policyIdList: ["p-1", "p-2"], confirm: true }, {} as any);

      expect(spy).toHaveBeenCalledWith(
        "DELETE",
        "/api/v1/sub-accounts/sa-1/policies",
        undefined,
        { policyIdList: ["p-1", "p-2"] }
      );
    });

    it("sub account: accepts the legacy single policyId and merges it into policyIdList", async () => {
      const handler = getToolHandler(server, "ncloud_detach_policy_from_sub_account");
      await handler({ subAccountId: "sa-1", policyId: "p-1", confirm: true }, {} as any);

      expect(spy).toHaveBeenCalledWith(
        "DELETE",
        "/api/v1/sub-accounts/sa-1/policies",
        undefined,
        { policyIdList: ["p-1"] }
      );
    });

    it("sub account: dedupes policyId already present in policyIdList", async () => {
      const handler = getToolHandler(server, "ncloud_detach_policy_from_sub_account");
      await handler({ subAccountId: "sa-1", policyIdList: ["p-1"], policyId: "p-1", confirm: true }, {} as any);

      const [, , , body] = spy.mock.calls[0] as any[];
      expect(body).toEqual({ policyIdList: ["p-1"] });
    });

    it("sub account: errors without calling the API when no policy ID is given", async () => {
      const handler = getToolHandler(server, "ncloud_detach_policy_from_sub_account");
      const result = await handler({ subAccountId: "sa-1", confirm: true }, {} as any);

      expect(result.isError).toBe(true);
      expect(spy).not.toHaveBeenCalled();
    });

    it("sub account: confirm gate blocks the call", async () => {
      const handler = getToolHandler(server, "ncloud_detach_policy_from_sub_account");
      const result = await handler({ subAccountId: "sa-1", policyIdList: ["p-1"] }, {} as any);

      expect(result.content[0].text).toContain("confirm=true");
      expect(spy).not.toHaveBeenCalled();
    });

    it("group: DELETEs /groups/{id}/policies with a policyIdList body", async () => {
      const handler = getToolHandler(server, "ncloud_detach_policy_from_group");
      await handler({ groupId: "g-1", policyId: "p-9", confirm: true }, {} as any);

      expect(spy).toHaveBeenCalledWith(
        "DELETE",
        "/api/v1/groups/g-1/policies",
        undefined,
        { policyIdList: ["p-9"] }
      );
    });
  });

  describe("create_role — isMyAccount는 createRole 필드가 아니다", () => {
    it("does not send isMyAccount, and sends only documented createRole fields", async () => {
      const handler = getToolHandler(server, "ncloud_create_role");
      await handler(
        { roleName: "role000", roleType: "Account", sessionExpirationSec: 600, descCont: "d", tags: { env: "dev" }, isMyAccount: true },
        {} as any
      );

      expect(spy).toHaveBeenCalledWith("POST", "/api/v1/roles", undefined, {
        roleName: "role000",
        roleType: "Account",
        sessionExpirationSec: 600,
        descCont: "d",
        tags: { env: "dev" },
      });
    });

    it("requires sessionExpirationSec for Account roles", async () => {
      const handler = getToolHandler(server, "ncloud_create_role");
      const result = await handler({ roleName: "role000", roleType: "Account" }, {} as any);

      expect(result.isError).toBe(true);
      expect(spy).not.toHaveBeenCalled();
    });

    it("omits sessionExpirationSec for Server roles", async () => {
      const handler = getToolHandler(server, "ncloud_create_role");
      await handler({ roleName: "role000", roleType: "Server" }, {} as any);

      expect(spy).toHaveBeenCalledWith("POST", "/api/v1/roles", undefined, {
        roleName: "role000",
        roleType: "Server",
      });
    });

    it("reports isMyAccount as ignored in the dryRun preview", async () => {
      const handler = getToolHandler(server, "ncloud_create_role");
      const result = await handler({ roleName: "r", roleType: "Server", isMyAccount: true, dryRun: true }, {} as any);

      expect(spy).not.toHaveBeenCalled();
      expect(parsed(result).ignoredParams).toHaveProperty("isMyAccount");
      expect(parsed(result).requestParams).not.toHaveProperty("isMyAccount");
    });
  });

  describe("create_group — 그룹에는 description 필드가 없다", () => {
    it("sends only groupName and tags, never groupDescription", async () => {
      const handler = getToolHandler(server, "ncloud_create_group");
      await handler({ groupName: "group000", groupDescription: "ignored", tags: { team: "a" } }, {} as any);

      expect(spy).toHaveBeenCalledWith("POST", "/api/v1/groups", undefined, {
        groupName: "group000",
        tags: { team: "a" },
      });
    });
  });

  describe("create_sub_account — API/콘솔 접근 소스 제한 필드", () => {
    it("forwards useApiAllowSource/apiAllowSources and console IP restrictions", async () => {
      const handler = getToolHandler(server, "ncloud_create_sub_account");
      await handler(
        {
          loginId: "poc-user",
          name: "poc",
          canAPIGatewayAccess: true,
          canConsoleAccess: false,
          needPasswordReset: false,
          useApiAllowSource: true,
          apiAllowSources: [{ type: "IP", source: "10.0.0.0/24" }],
          useConsolePermitIp: true,
          consolePermitIps: ["1.2.3.4"],
          tags: { env: "dev" },
        },
        {} as any
      );

      const [method, path, query, body] = spy.mock.calls[0] as any[];
      expect([method, path, query]).toEqual(["POST", "/api/v1/sub-accounts", undefined]);
      expect(body.useApiAllowSource).toBe(true);
      expect(body.apiAllowSources).toEqual([{ type: "IP", source: "10.0.0.0/24" }]);
      expect(body.consolePermitIps).toEqual(["1.2.3.4"]);
      expect(body.tags).toEqual({ env: "dev" });
      expect("dryRun" in body).toBe(false);
    });
  });

  describe("access key 도구", () => {
    it("lists access keys", async () => {
      const handler = getToolHandler(server, "ncloud_list_sub_account_access_keys");
      await handler({ subAccountId: "sa-1" }, {} as any);

      expect(spy).toHaveBeenCalledWith("GET", "/api/v1/sub-accounts/sa-1/access-keys");
    });

    it("creates an access key with no request body", async () => {
      const handler = getToolHandler(server, "ncloud_create_sub_account_access_key");
      await handler({ subAccountId: "sa-1" }, {} as any);

      expect(spy).toHaveBeenCalledWith("POST", "/api/v1/sub-accounts/sa-1/access-keys");
    });

    it("sets the access key status via PUT body", async () => {
      const handler = getToolHandler(server, "ncloud_set_sub_account_access_key_status");
      await handler({ subAccountId: "sa-1", accessKey: "ncp_iam_key", active: false }, {} as any);

      expect(spy).toHaveBeenCalledWith(
        "PUT",
        "/api/v1/sub-accounts/sa-1/access-keys",
        undefined,
        { accessKey: "ncp_iam_key", active: false }
      );
    });

    it("deletes the access key via DELETE body, behind the confirm gate", async () => {
      const handler = getToolHandler(server, "ncloud_delete_sub_account_access_key");
      const blocked = await handler({ subAccountId: "sa-1", accessKey: "ncp_iam_key" }, {} as any);
      expect(blocked.content[0].text).toContain("confirm=true");
      expect(spy).not.toHaveBeenCalled();

      await handler({ subAccountId: "sa-1", accessKey: "ncp_iam_key", confirm: true }, {} as any);
      expect(spy).toHaveBeenCalledWith(
        "DELETE",
        "/api/v1/sub-accounts/sa-1/access-keys",
        undefined,
        { accessKey: "ncp_iam_key" }
      );
    });
  });

  describe("policy CRUD 도구", () => {
    const permissions = [
      { effect: "Allow", targets: [{ product: "DataQuery", actions: ["View*"], resourceNrns: ["nrn:PUB:DataQuery:KR:879496:DataSource/2942"] }] },
    ];

    it("creates a policy with permissions/description/tags", async () => {
      const handler = getToolHandler(server, "ncloud_create_policy");
      await handler({ policyName: "poc-viewer", permissions, description: "d", tags: { env: "dev" } }, {} as any);

      expect(spy).toHaveBeenCalledWith("POST", "/api/v1/policies", undefined, {
        policyName: "poc-viewer",
        permissions,
        description: "d",
        tags: { env: "dev" },
      });
    });

    it("dryRun previews the policy without calling the API and points to the validation tool", async () => {
      const handler = getToolHandler(server, "ncloud_create_policy");
      const result = await handler({ policyName: "poc-viewer", permissions, dryRun: true }, {} as any);

      expect(spy).not.toHaveBeenCalled();
      expect(parsed(result).requestParams.policyName).toBe("poc-viewer");
      expect(parsed(result).hint).toContain("ncloud_validate_policy");
    });

    it("validates a policy against the server-side validation endpoint", async () => {
      const handler = getToolHandler(server, "ncloud_validate_policy");
      await handler({ policyName: "poc-viewer", permissions }, {} as any);

      expect(spy).toHaveBeenCalledWith("POST", "/api/v1/policy/validation", undefined, {
        policyName: "poc-viewer",
        permissions,
      });
    });

    it("gets policy detail with the permission statements", async () => {
      const handler = getToolHandler(server, "ncloud_get_policy_detail");
      await handler({ policyId: "p-1", withPermissions: true }, {} as any);

      expect(spy).toHaveBeenCalledWith("GET", "/api/v1/policies/p-1", { withPermissions: true });
    });

    it("gets the resources a policy is assigned to", async () => {
      const handler = getToolHandler(server, "ncloud_get_policy_resources");
      await handler({ policyId: "p-1" }, {} as any);

      expect(spy).toHaveBeenCalledWith("GET", "/api/v1/policies/p-1/resources");
    });

    it("updates a policy without sending policyName", async () => {
      const handler = getToolHandler(server, "ncloud_update_policy");
      await handler({ policyId: "p-1", permissions, description: "d2" }, {} as any);

      expect(spy).toHaveBeenCalledWith("PUT", "/api/v1/policies/p-1", undefined, {
        permissions,
        description: "d2",
      });
    });

    it("deletes a single policy behind the confirm gate", async () => {
      const handler = getToolHandler(server, "ncloud_delete_policy");
      const blocked = await handler({ policyId: "p-1" }, {} as any);
      expect(blocked.content[0].text).toContain("confirm=true");
      expect(spy).not.toHaveBeenCalled();

      await handler({ policyId: "p-1", confirm: true }, {} as any);
      expect(spy).toHaveBeenCalledWith("DELETE", "/api/v1/policies/p-1");
    });

    it("deletes multiple policies with a bare array body", async () => {
      const handler = getToolHandler(server, "ncloud_delete_policies");
      await handler({ policyIdList: ["p-1", "p-2"], confirm: true }, {} as any);

      expect(spy).toHaveBeenCalledWith("DELETE", "/api/v1/policies", undefined, ["p-1", "p-2"]);
    });
  });
});
