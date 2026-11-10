import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerSubAccountV2Tools } from "./governance-sub-account-v2.js";

const SA = "4e066e50-9c3a-11e7-8a66-1e5021fa7c80";
const G = "5e066e50-9c3a-11e7-8a66-1e5021fa7c81";
const P1 = "6e066e50-9c3a-11e7-8a66-1e5021fa7c82";
const P2 = "7e066e50-9c3a-11e7-8a66-1e5021fa7c83";
const R = "8e066e50-9c3a-11e7-8a66-1e5021fa7c84";
const AK = "ncp_iam_" + "BPASKRxmpl" + "0123456789";

function harness() {
  const server = new McpServer({ name: "t", version: "1.0.0" });
  const client = new NcloudClient({ accessKey: "k", secretKey: "s", baseUrl: "https://subaccount.apigw.gov-ntruss.com", regionCode: "KR" });
  registerSubAccountV2Tools(server, client);
  const tools = (server as any)._registeredTools;
  const entry = (n: string) => (tools instanceof Map ? tools.get(n) : tools[n]);
  const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ success: true });
  return {
    spy,
    names: (): string[] => (tools instanceof Map ? [...tools.keys()] : Object.keys(tools)),
    entry,
    call: (n: string, a: any) => entry(n).handler(entry(n).inputSchema.parse(a), {} as any),
  };
}

describe("Sub Account v2 (gov) tools", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  it("registers the v1 tool names that have v2 equivalents", () => {
    const names = h.names();
    for (const n of [
      "ncloud_list_sub_accounts", "ncloud_get_sub_account_detail", "ncloud_create_sub_account", "ncloud_delete_sub_account",
      "ncloud_list_sub_account_access_keys", "ncloud_create_sub_account_access_key", "ncloud_set_sub_account_access_key_status",
      "ncloud_delete_sub_account_access_key", "ncloud_list_groups", "ncloud_create_group", "ncloud_delete_group",
      "ncloud_list_policies", "ncloud_get_policy_detail", "ncloud_get_policy_resources", "ncloud_validate_policy",
      "ncloud_create_policy", "ncloud_update_policy", "ncloud_delete_policy", "ncloud_delete_policies",
      "ncloud_attach_policy_to_sub_account", "ncloud_detach_policy_from_sub_account", "ncloud_attach_policy_to_group",
      "ncloud_detach_policy_from_group", "ncloud_list_roles", "ncloud_create_role", "ncloud_delete_role",
      "ncloud_get_login_alias", "ncloud_set_login_alias",
    ]) expect(names).toContain(n);
    expect(names.every((n) => n.startsWith("ncloud_"))).toBe(true);
  });

  it("every destructive tool carries the ⚠️ Destructive warning and a confirm gate", () => {
    for (const n of h.names()) {
      if (!/_(delete|detach)_/.test(n)) continue;
      const e = h.entry(n);
      expect(e.description, n).toContain("⚠️ Destructive");
      expect(e.inputSchema.shape, n).toHaveProperty("confirm");
    }
  });

  describe("sub accounts", () => {
    it("list: GET /api/v2/sub-accounts with pageNo/pageSize and repeated sort", async () => {
      await h.call("ncloud_list_sub_accounts", { pageNo: 1, pageSize: 50, sort: ["loginId,asc", "createdDateTime,desc"] });
      expect(h.spy).toHaveBeenCalledWith(
        "GET",
        "/api/v2/sub-accounts?pageNo=1&pageSize=50&sort=loginId%2Casc&sort=createdDateTime%2Cdesc"
      );
    });
    it("list without params has no query string", async () => {
      await h.call("ncloud_list_sub_accounts", {});
      expect(h.spy).toHaveBeenCalledWith("GET", "/api/v2/sub-accounts");
    });
    it("get: GET /sub-accounts/{id}", async () => {
      await h.call("ncloud_get_sub_account_detail", { subAccountId: SA });
      expect(h.spy).toHaveBeenCalledWith("GET", `/api/v2/sub-accounts/${SA}`);
    });
    it("create: POST /sub-accounts with v2 body, no dryRun", async () => {
      await h.call("ncloud_create_sub_account", {
        loginId: "myloginid01", name: "hong", apiGatewayAccessible: true, consoleAccessible: false,
        passwordGenerationRequired: true, apiAllowSourceEnabled: true, apiAllowSources: [{ type: "IP", source: "10.0.0.0/8" }],
        tags: { env: "dev" },
      });
      expect(h.spy).toHaveBeenCalledWith("POST", "/api/v2/sub-accounts", undefined, {
        loginId: "myloginid01", name: "hong", apiGatewayAccessible: true, consoleAccessible: false,
        passwordGenerationRequired: true, apiAllowSourceEnabled: true, apiAllowSources: [{ type: "IP", source: "10.0.0.0/8" }],
        tags: { env: "dev" },
      });
    });
    it("create: requires password unless generation requested", async () => {
      const r = await h.call("ncloud_create_sub_account", { loginId: "abc", name: "ab", apiGatewayAccessible: false, consoleAccessible: true });
      expect(r.isError).toBe(true);
      expect(h.spy).not.toHaveBeenCalled();
    });
    it("create: consolePermitIpEnabled requires addresses", async () => {
      const r = await h.call("ncloud_create_sub_account", {
        loginId: "abc", name: "ab", apiGatewayAccessible: false, consoleAccessible: true, passwordGenerationRequired: true, consolePermitIpEnabled: true,
      });
      expect(r.isError).toBe(true);
      expect(h.spy).not.toHaveBeenCalled();
    });
    it("create: dryRun masks the password and does not call the API", async () => {
      const r = await h.call("ncloud_create_sub_account", {
        loginId: "abc", name: "ab", apiGatewayAccessible: false, consoleAccessible: true, password: "P@ssw0rd!23", dryRun: true,
      });
      expect(h.spy).not.toHaveBeenCalled();
      expect(r.content[0].text).not.toContain("P@ssw0rd!23");
      expect(r.content[0].text).toContain("/api/v2/sub-accounts");
    });
    it("update: PATCH with only provided fields, null clears", async () => {
      await h.call("ncloud_update_sub_account", { subAccountId: SA, memo: null, active: false });
      expect(h.spy).toHaveBeenCalledWith("PATCH", `/api/v2/sub-accounts/${SA}`, undefined, { memo: null, active: false });
    });
    it("update: errors with no fields", async () => {
      const r = await h.call("ncloud_update_sub_account", { subAccountId: SA });
      expect(r.isError).toBe(true);
    });
    it("delete: confirm gate, then DELETE with cascading query", async () => {
      const gated = await h.call("ncloud_delete_sub_account", { subAccountId: SA });
      expect(gated.content[0].text).toContain("confirm=true");
      expect(h.spy).not.toHaveBeenCalled();
      await h.call("ncloud_delete_sub_account", { subAccountId: SA, cascading: true, confirm: true });
      expect(h.spy).toHaveBeenCalledWith("DELETE", `/api/v2/sub-accounts/${SA}?cascading=true`);
    });
    it("delete without cascading sends no query", async () => {
      await h.call("ncloud_delete_sub_account", { subAccountId: SA, confirm: true });
      expect(h.spy).toHaveBeenCalledWith("DELETE", `/api/v2/sub-accounts/${SA}`);
    });
    it("reset password: POST reset-password", async () => {
      await h.call("ncloud_reset_sub_account_password", { subAccountId: SA, passwordGenerationRequired: true });
      expect(h.spy).toHaveBeenCalledWith("POST", `/api/v2/sub-accounts/${SA}/reset-password`, undefined, { passwordGenerationRequired: true });
      const r = await h.call("ncloud_reset_sub_account_password", { subAccountId: SA });
      expect(r.isError).toBe(true);
    });
  });

  describe("access rules", () => {
    it("api access rule get/put", async () => {
      await h.call("ncloud_get_sub_account_api_access_rule", { subAccountId: SA });
      expect(h.spy).toHaveBeenCalledWith("GET", `/api/v2/sub-accounts/${SA}/api-access-rule`);
      await h.call("ncloud_update_sub_account_api_access_rule", { subAccountId: SA, apiAllowSourceEnabled: true, apiAllowSources: [{ type: "VPC", source: "123" }] });
      expect(h.spy).toHaveBeenLastCalledWith("PUT", `/api/v2/sub-accounts/${SA}/api-access-rule`, undefined, {
        apiAllowSourceEnabled: true, apiAllowSources: [{ type: "VPC", source: "123" }],
      });
    });
    it("api access rule: enabled without sources is rejected", async () => {
      const r = await h.call("ncloud_update_sub_account_api_access_rule", { subAccountId: SA, apiAllowSourceEnabled: true });
      expect(r.isError).toBe(true);
      expect(h.spy).not.toHaveBeenCalled();
    });
    it("console access rule get/put", async () => {
      await h.call("ncloud_get_sub_account_console_access_rule", { subAccountId: SA });
      expect(h.spy).toHaveBeenCalledWith("GET", `/api/v2/sub-accounts/${SA}/console-access-rule`);
      await h.call("ncloud_update_sub_account_console_access_rule", { subAccountId: SA, consolePermitIpEnabled: false });
      expect(h.spy).toHaveBeenLastCalledWith("PUT", `/api/v2/sub-accounts/${SA}/console-access-rule`, undefined, { consolePermitIpEnabled: false });
    });
  });

  describe("access keys", () => {
    it("list/create", async () => {
      await h.call("ncloud_list_sub_account_access_keys", { subAccountId: SA });
      expect(h.spy).toHaveBeenCalledWith("GET", `/api/v2/sub-accounts/${SA}/access-keys`);
      await h.call("ncloud_create_sub_account_access_key", { subAccountId: SA });
      expect(h.spy).toHaveBeenLastCalledWith("POST", `/api/v2/sub-accounts/${SA}/access-keys`);
    });
    it("status: POST /access-keys/{key}/change-status { active }", async () => {
      await h.call("ncloud_set_sub_account_access_key_status", { subAccountId: SA, accessKey: AK, active: false });
      expect(h.spy).toHaveBeenCalledWith("POST", `/api/v2/sub-accounts/${SA}/access-keys/${AK}/change-status`, undefined, { active: false });
    });
    it("delete: DELETE /access-keys/{key} (key in the path, no body)", async () => {
      await h.call("ncloud_delete_sub_account_access_key", { subAccountId: SA, accessKey: AK, confirm: true });
      expect(h.spy).toHaveBeenCalledWith("DELETE", `/api/v2/sub-accounts/${SA}/access-keys/${AK}`);
    });
    it("rejects a malformed access key", () => {
      expect(() => h.entry("ncloud_delete_sub_account_access_key").inputSchema.parse({ subAccountId: SA, accessKey: "bad" })).toThrow();
    });
  });

  describe("sub account ↔ policies / groups", () => {
    it("attach policies: POST attach-policies { policyIds }, merging v1 aliases and deduping", async () => {
      await h.call("ncloud_attach_policy_to_sub_account", { subAccountId: SA, policyIds: [P1], policyIdList: [P2, P1], policyId: P2 });
      expect(h.spy).toHaveBeenCalledWith("POST", `/api/v2/sub-accounts/${SA}/attach-policies`, undefined, { policyIds: [P1, P2] });
    });
    it("attach policies: errors when none given or more than 10", async () => {
      expect((await h.call("ncloud_attach_policy_to_sub_account", { subAccountId: SA })).isError).toBe(true);
      const many = Array.from({ length: 11 }, (_, i) => `p-${i}`);
      expect((await h.call("ncloud_attach_policy_to_sub_account", { subAccountId: SA, policyIds: many })).isError).toBe(true);
      expect(h.spy).not.toHaveBeenCalled();
    });
    it("detach policies: confirm gate then POST detach-policies", async () => {
      const gated = await h.call("ncloud_detach_policy_from_sub_account", { subAccountId: SA, policyIds: [P1] });
      expect(gated.content[0].text).toContain("confirm=true");
      expect(h.spy).not.toHaveBeenCalled();
      await h.call("ncloud_detach_policy_from_sub_account", { subAccountId: SA, policyIds: [P1], confirm: true });
      expect(h.spy).toHaveBeenCalledWith("POST", `/api/v2/sub-accounts/${SA}/detach-policies`, undefined, { policyIds: [P1] });
    });
    it("attach/detach groups", async () => {
      await h.call("ncloud_attach_groups_to_sub_account", { subAccountId: SA, groupIds: [G] });
      expect(h.spy).toHaveBeenCalledWith("POST", `/api/v2/sub-accounts/${SA}/attach-groups`, undefined, { groupIds: [G] });
      await h.call("ncloud_detach_groups_from_sub_account", { subAccountId: SA, groupIds: [G], confirm: true });
      expect(h.spy).toHaveBeenLastCalledWith("POST", `/api/v2/sub-accounts/${SA}/detach-groups`, undefined, { groupIds: [G] });
    });
  });

  describe("login alias", () => {
    it("get: GET /api/v2/login-alias", async () => {
      await h.call("ncloud_get_login_alias", {});
      expect(h.spy).toHaveBeenCalledWith("GET", "/api/v2/login-alias");
    });
    it("set: PATCH /api/v2/login-alias, null deletes", async () => {
      await h.call("ncloud_set_login_alias", { loginAlias: "myteam01" });
      expect(h.spy).toHaveBeenCalledWith("PATCH", "/api/v2/login-alias", undefined, { loginAlias: "myteam01" });
      await h.call("ncloud_set_login_alias", { loginAlias: null });
      expect(h.spy).toHaveBeenLastCalledWith("PATCH", "/api/v2/login-alias", undefined, { loginAlias: null });
    });
    it("set: rejects uppercase", () => {
      expect(() => h.entry("ncloud_set_login_alias").inputSchema.parse({ loginAlias: "MyTeam" })).toThrow();
    });
  });

  describe("groups", () => {
    it("list/get/create/update/delete", async () => {
      await h.call("ncloud_list_groups", { pageSize: 10 });
      expect(h.spy).toHaveBeenCalledWith("GET", "/api/v2/groups?pageSize=10");
      await h.call("ncloud_get_group_detail", { groupId: G });
      expect(h.spy).toHaveBeenLastCalledWith("GET", `/api/v2/groups/${G}`);
      await h.call("ncloud_create_group", { groupName: "my-group", tags: { team: "a" } });
      expect(h.spy).toHaveBeenLastCalledWith("POST", "/api/v2/groups", undefined, { groupName: "my-group", tags: { team: "a" } });
      await h.call("ncloud_update_group", { groupId: G, groupName: "new-group" });
      expect(h.spy).toHaveBeenLastCalledWith("PATCH", `/api/v2/groups/${G}`, undefined, { groupName: "new-group" });
      await h.call("ncloud_delete_group", { groupId: G, confirm: true });
      expect(h.spy).toHaveBeenLastCalledWith("DELETE", `/api/v2/groups/${G}`);
    });
    it("policies and members", async () => {
      await h.call("ncloud_attach_policy_to_group", { groupId: G, policyIds: [P1] });
      expect(h.spy).toHaveBeenLastCalledWith("POST", `/api/v2/groups/${G}/attach-policies`, undefined, { policyIds: [P1] });
      await h.call("ncloud_detach_policy_from_group", { groupId: G, policyId: P1, confirm: true });
      expect(h.spy).toHaveBeenLastCalledWith("POST", `/api/v2/groups/${G}/detach-policies`, undefined, { policyIds: [P1] });
      await h.call("ncloud_attach_sub_accounts_to_group", { groupId: G, subAccountIds: [SA] });
      expect(h.spy).toHaveBeenLastCalledWith("POST", `/api/v2/groups/${G}/attach-sub-accounts`, undefined, { subAccountIds: [SA] });
      await h.call("ncloud_detach_sub_accounts_from_group", { groupId: G, subAccountIds: [SA], confirm: true });
      expect(h.spy).toHaveBeenLastCalledWith("POST", `/api/v2/groups/${G}/detach-sub-accounts`, undefined, { subAccountIds: [SA] });
    });
  });

  describe("policies", () => {
    const permissions = [{ targets: [{ product: "IAM", actions: ["View*"], resourceNrns: ["*"] }] }];
    const sent = [{ effect: "Allow", targets: [{ product: "IAM", actions: ["View*"], resourceNrns: ["*"] }] }];

    it("list with policyType filter", async () => {
      await h.call("ncloud_list_policies", { policyType: "USER_CREATED", pageNo: 0 });
      expect(h.spy).toHaveBeenCalledWith("GET", "/api/v2/policies?pageNo=0&policyType=USER_CREATED");
    });
    it("get defaults withPermissions=true; resources paged", async () => {
      await h.call("ncloud_get_policy_detail", { policyId: P1 });
      expect(h.spy).toHaveBeenCalledWith("GET", `/api/v2/policies/${P1}?withPermissions=true`);
      await h.call("ncloud_get_policy_resources", { policyId: P1, sort: ["resourceType,asc"] });
      expect(h.spy).toHaveBeenLastCalledWith("GET", `/api/v2/policies/${P1}/resources?sort=resourceType%2Casc`);
    });
    it("validate: POST /policies/validate, effect defaulted to Allow", async () => {
      await h.call("ncloud_validate_policy", { policyName: "my-policy", permissions });
      expect(h.spy).toHaveBeenCalledWith("POST", "/api/v2/policies/validate", undefined, { policyName: "my-policy", permissions: sent });
    });
    it("create supports Deny and conditions", async () => {
      const perms = [{ effect: "Deny", targets: [{ product: "Server", actions: ["Change*"], resourceNrns: ["*"] }], condition: { StringEquals: { "ncp:resourceTag/env": ["prod"] } } }];
      await h.call("ncloud_create_policy", { policyName: "deny-prod", permissions: perms, description: "d" });
      expect(h.spy).toHaveBeenCalledWith("POST", "/api/v2/policies", undefined, { policyName: "deny-prod", permissions: perms, description: "d" });
    });
    it("update: PUT /policies/{id}", async () => {
      await h.call("ncloud_update_policy", { policyId: P1, permissions });
      expect(h.spy).toHaveBeenCalledWith("PUT", `/api/v2/policies/${P1}`, undefined, { permissions: sent });
    });
    it("delete single and batch", async () => {
      await h.call("ncloud_delete_policy", { policyId: P1, confirm: true });
      expect(h.spy).toHaveBeenCalledWith("DELETE", `/api/v2/policies/${P1}`);
      await h.call("ncloud_delete_policies", { policyIds: [P1, P2], confirm: true });
      expect(h.spy).toHaveBeenLastCalledWith("POST", "/api/v2/policies/batch-delete", undefined, { policyIds: [P1, P2] });
    });
  });

  describe("roles", () => {
    it("list/get", async () => {
      await h.call("ncloud_list_roles", {});
      expect(h.spy).toHaveBeenCalledWith("GET", "/api/v2/roles");
      await h.call("ncloud_get_role_detail", { roleId: R });
      expect(h.spy).toHaveBeenLastCalledWith("GET", `/api/v2/roles/${R}`);
    });
    it("create Account role sends sessionExpirationSeconds/description", async () => {
      await h.call("ncloud_create_role", { roleName: "my-role", roleType: "Account", sessionExpirationSeconds: 1800, description: "d" });
      expect(h.spy).toHaveBeenCalledWith("POST", "/api/v2/roles", undefined, {
        roleName: "my-role", roleType: "Account", sessionExpirationSeconds: 1800, description: "d",
      });
    });
    it("create validates sessionExpirationSeconds against roleType", async () => {
      expect((await h.call("ncloud_create_role", { roleName: "my-role", roleType: "Account" })).isError).toBe(true);
      expect((await h.call("ncloud_create_role", { roleName: "my-role", roleType: "Server", sessionExpirationSeconds: 600 })).isError).toBe(true);
      expect(h.spy).not.toHaveBeenCalled();
      expect(() => h.entry("ncloud_create_role").inputSchema.parse({ roleName: "my-role", roleType: "Account", sessionExpirationSeconds: 3600 })).toThrow();
    });
    it("update/status/delete", async () => {
      await h.call("ncloud_update_role", { roleId: R, description: null });
      expect(h.spy).toHaveBeenCalledWith("PATCH", `/api/v2/roles/${R}`, undefined, { description: null });
      await h.call("ncloud_set_role_status", { roleId: R, active: false });
      expect(h.spy).toHaveBeenLastCalledWith("POST", `/api/v2/roles/${R}/change-status`, undefined, { active: false });
      await h.call("ncloud_delete_role", { roleId: R, confirm: true });
      expect(h.spy).toHaveBeenLastCalledWith("DELETE", `/api/v2/roles/${R}`);
    });
    it("policies", async () => {
      await h.call("ncloud_attach_policy_to_role", { roleId: R, policyIds: [P1] });
      expect(h.spy).toHaveBeenLastCalledWith("POST", `/api/v2/roles/${R}/attach-policies`, undefined, { policyIds: [P1] });
      await h.call("ncloud_detach_policy_from_role", { roleId: R, policyIds: [P1], confirm: true });
      expect(h.spy).toHaveBeenLastCalledWith("POST", `/api/v2/roles/${R}/detach-policies`, undefined, { policyIds: [P1] });
    });
    it("entities", async () => {
      await h.call("ncloud_attach_role_entities", { roleId: R, roleEntities: [{ id: "12345", type: "Server" }] });
      expect(h.spy).toHaveBeenLastCalledWith("POST", `/api/v2/roles/${R}/attach-entities`, undefined, { roleEntities: [{ id: "12345", type: "Server" }] });
      await h.call("ncloud_detach_role_entities", { roleId: R, roleEntityIds: ["12345"], confirm: true });
      expect(h.spy).toHaveBeenLastCalledWith("POST", `/api/v2/roles/${R}/detach-entities`, undefined, { roleEntityIds: ["12345"] });
    });
    it("account target", async () => {
      await h.call("ncloud_attach_role_account", { roleId: R, ownAccount: true, accountName: "ignored" });
      expect(h.spy).toHaveBeenLastCalledWith("POST", `/api/v2/roles/${R}/attach-account`, undefined, { ownAccount: true });
      await h.call("ncloud_attach_role_account", { roleId: R, ownAccount: false, accountName: "hong", loginId: "user@example.com" });
      expect(h.spy).toHaveBeenLastCalledWith("POST", `/api/v2/roles/${R}/attach-account`, undefined, {
        ownAccount: false, accountName: "hong", loginId: "user@example.com",
      });
      const r = await h.call("ncloud_attach_role_account", { roleId: R, ownAccount: false });
      expect(r.isError).toBe(true);
      await h.call("ncloud_detach_role_account", { roleId: R, confirm: true });
      expect(h.spy).toHaveBeenLastCalledWith("POST", `/api/v2/roles/${R}/detach-account`);
    });
  });
});
