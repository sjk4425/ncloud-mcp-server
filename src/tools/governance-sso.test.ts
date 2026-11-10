import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerSsoTools } from "./governance-sso.js";

function createMockClient(): NcloudClient {
  return new NcloudClient({
    accessKey: "testAccessKey",
    secretKey: "testSecretKey",
    baseUrl: "https://sso.apigw.gov-ntruss.com",
    regionCode: "KR",
  });
}

/** SDK 처럼 inputSchema 로 파싱한 뒤 핸들러를 부른다(.default() 반영). */
function tool(server: McpServer, name: string) {
  const tools = (server as any)._registeredTools;
  const entry = tools instanceof Map ? tools.get(name) : tools[name];
  if (!entry) throw new Error(`Tool ${name} not found`);
  return (args: any) => entry.handler(entry.inputSchema.parse(args), {} as any);
}

function schema(server: McpServer, name: string): any {
  const tools = (server as any)._registeredTools;
  const entry = tools instanceof Map ? tools.get(name) : tools[name];
  return entry.inputSchema;
}

const text = (r: any) => r.content[0].text as string;

const U = "11111111-1111-1111-1111-111111111111";
const G = "22222222-2222-2222-2222-222222222222";
const A = "33333333-3333-3333-3333-333333333333";

describe("Single Sign-On v2 (Government zone)", () => {
  let server: McpServer;
  let client: NcloudClient;
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerSsoTools(server, client);
    spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ success: true });
  });

  it("registers the expected tool set, all with the ncloud_sso_ prefix", () => {
    const tools = (server as any)._registeredTools;
    const names = Object.keys(tools instanceof Map ? Object.fromEntries(tools) : tools);
    expect(names.length).toBe(46);
    expect(names.every((n) => n.startsWith("ncloud_sso_"))).toBe(true);
  });

  describe("read tools — GET paths and pagination query", () => {
    const cases: Array<[string, any, string, any?]> = [
      ["ncloud_sso_get_tenant", {}, "/api/v2/tenant"],
      ["ncloud_sso_get_login_setting", {}, "/api/v2/tenant/login-setting"],
      ["ncloud_sso_get_user", { userId: U }, `/api/v2/users/${U}`],
      ["ncloud_sso_get_group", { groupId: G }, `/api/v2/groups/${G}`],
      ["ncloud_sso_get_permission_set", { permissionSetId: "ps-1" }, "/api/v2/permission-sets/ps-1"],
      ["ncloud_sso_get_assignment", { assignmentId: A }, `/api/v2/assignments/${A}`],
      ["ncloud_sso_get_ip_acl", { ipAclId: "acl-1" }, "/api/v2/ip-acls/acl-1"],
    ];
    for (const [name, args, path] of cases) {
      it(`${name} → GET ${path}`, async () => {
        await tool(server, name)(args);
        expect(spy).toHaveBeenCalledWith("GET", path);
      });
    }

    const lists: Array<[string, any, string]> = [
      ["ncloud_sso_list_users", {}, "/api/v2/users"],
      ["ncloud_sso_list_groups", {}, "/api/v2/groups"],
      ["ncloud_sso_list_permission_sets", {}, "/api/v2/permission-sets"],
      ["ncloud_sso_list_managed_policies", {}, "/api/v2/managed-policies"],
      ["ncloud_sso_list_assignments", {}, "/api/v2/assignments"],
      ["ncloud_sso_list_organization_accounts", {}, "/api/v2/organization-accounts"],
      ["ncloud_sso_list_ip_acls", {}, "/api/v2/ip-acls"],
      ["ncloud_sso_list_user_groups", { userId: U }, `/api/v2/users/${U}/groups`],
      ["ncloud_sso_list_user_assignments", { userId: U }, `/api/v2/users/${U}/assignments`],
      ["ncloud_sso_list_group_users", { groupId: G }, `/api/v2/groups/${G}/users`],
      ["ncloud_sso_list_assignment_ip_acls", { assignmentId: A }, `/api/v2/assignments/${A}/ip-acls`],
    ];
    for (const [name, args, path] of lists) {
      it(`${name} → GET ${path} with pageNo/pageSize`, async () => {
        await tool(server, name)({ ...args, pageNo: 2, pageSize: 50 });
        expect(spy).toHaveBeenCalledWith("GET", path, { pageNo: 2, pageSize: 50 });
      });
    }

    it("rejects pageSize above 100", () => {
      expect(() => schema(server, "ncloud_sso_list_users").parse({ pageSize: 101 })).toThrow();
    });

    it("list_assignment_targets sends required targetType in the query", async () => {
      await tool(server, "ncloud_sso_list_assignment_targets")({ assignmentId: A, targetType: "GROUP" });
      expect(spy).toHaveBeenCalledWith("GET", `/api/v2/assignments/${A}/targets`, {
        targetType: "GROUP",
        pageNo: undefined,
        pageSize: undefined,
      });
      expect(() => schema(server, "ncloud_sso_list_assignment_targets").parse({ assignmentId: A })).toThrow();
    });

    it("encodes path IDs", async () => {
      await tool(server, "ncloud_sso_get_user")({ userId: "a/b" });
      expect(spy).toHaveBeenCalledWith("GET", "/api/v2/users/a%2Fb");
    });
  });

  describe("users", () => {
    it("create_user POSTs the body without dryRun", async () => {
      await tool(server, "ncloud_sso_create_user")({
        loginId: "kim@example.go.kr",
        userProfile: { firstName: "Gil", lastName: "Kim", phoneCountryCode: "82", phoneNo: "010-1234-5678" },
        accessRules: { consoleAccessAllowed: true, apiAccessAllowed: false },
        tags: { env: "prod" },
      });
      expect(spy).toHaveBeenCalledWith("POST", "/api/v2/users", undefined, {
        loginId: "kim@example.go.kr",
        userProfile: { firstName: "Gil", lastName: "Kim", phoneCountryCode: "82", phoneNo: "010-1234-5678" },
        accessRules: { consoleAccessAllowed: true, apiAccessAllowed: false },
        tags: { env: "prod" },
      });
    });

    it("create_user dryRun does not call the API and previews the body", async () => {
      const r = await tool(server, "ncloud_sso_create_user")({
        loginId: "kim@example.go.kr",
        accessRules: { consoleAccessAllowed: true, apiAccessAllowed: true },
        dryRun: true,
      });
      expect(spy).not.toHaveBeenCalled();
      const preview = JSON.parse(text(r));
      expect(preview.endpoint).toBe("/api/v2/users");
      expect(preview.method).toBe("POST");
      expect(preview.requestParams.loginId).toBe("kim@example.go.kr");
    });

    it("create_user validates loginId email, accessRules and phoneNo", () => {
      const s = schema(server, "ncloud_sso_create_user");
      const ok = { loginId: "a@b.kr", accessRules: { consoleAccessAllowed: true, apiAccessAllowed: true } };
      expect(() => s.parse(ok)).not.toThrow();
      expect(() => s.parse({ ...ok, loginId: "notanemail" })).toThrow();
      expect(() => s.parse({ loginId: "a@b.kr" })).toThrow();
      expect(() => s.parse({ ...ok, userProfile: { phoneNo: "12-34" } })).toThrow();
      expect(() => s.parse({ ...ok, userProfile: { phoneNo: "01012345678" } })).not.toThrow();
      const tooMany = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, "v"]));
      expect(() => s.parse({ ...ok, tags: tooMany })).toThrow();
    });

    it("update_user PUTs description/profile/accessRules", async () => {
      await tool(server, "ncloud_sso_update_user")({
        userId: U,
        description: "d",
        accessRules: { consoleAccessAllowed: false, apiAccessAllowed: true },
      });
      expect(spy).toHaveBeenCalledWith("PUT", `/api/v2/users/${U}`, undefined, {
        description: "d",
        accessRules: { consoleAccessAllowed: false, apiAccessAllowed: true },
      });
    });

    it("delete_user requires confirm", async () => {
      const r = await tool(server, "ncloud_sso_delete_user")({ userId: U });
      expect(spy).not.toHaveBeenCalled();
      expect(text(r)).toContain("confirm=true");
      await tool(server, "ncloud_sso_delete_user")({ userId: U, confirm: true });
      expect(spy).toHaveBeenCalledWith("DELETE", `/api/v2/users/${U}`);
    });

    it("update_user_access_rule PUTs both flags", async () => {
      await tool(server, "ncloud_sso_update_user_access_rule")({ userId: U, consoleAccessAllowed: true, apiAccessAllowed: false });
      expect(spy).toHaveBeenCalledWith("PUT", `/api/v2/users/${U}/access-rule`, undefined, {
        consoleAccessAllowed: true,
        apiAccessAllowed: false,
      });
    });

    it("add/remove groups for a user", async () => {
      await tool(server, "ncloud_sso_add_groups_to_user")({ userId: U, groupIds: [G] });
      expect(spy).toHaveBeenCalledWith("POST", `/api/v2/users/${U}/add-groups`, undefined, { groupIds: [G] });
      await tool(server, "ncloud_sso_remove_groups_from_user")({ userId: U, groupIds: [G], confirm: true });
      expect(spy).toHaveBeenCalledWith("POST", `/api/v2/users/${U}/remove-groups`, undefined, { groupIds: [G] });
      expect(() => schema(server, "ncloud_sso_add_groups_to_user").parse({ userId: U, groupIds: [] })).toThrow();
    });

    it("batch enable/disable users (1-100)", async () => {
      await tool(server, "ncloud_sso_enable_users")({ userIds: [U] });
      expect(spy).toHaveBeenCalledWith("POST", "/api/v2/users/batch-enable", undefined, { userIds: [U] });
      await tool(server, "ncloud_sso_disable_users")({ userIds: [U] });
      expect(spy).toHaveBeenCalledWith("POST", "/api/v2/users/batch-disable", undefined, { userIds: [U] });
      const many = Array.from({ length: 101 }, (_, i) => `u${i}`);
      expect(() => schema(server, "ncloud_sso_enable_users").parse({ userIds: many })).toThrow();
    });
  });

  describe("groups", () => {
    it("create_group validates the name pattern and POSTs", async () => {
      const s = schema(server, "ncloud_sso_create_group");
      expect(() => s.parse({ groupName: "_bad" })).toThrow();
      expect(() => s.parse({ groupName: "a" })).toThrow();
      await tool(server, "ncloud_sso_create_group")({ groupName: "dev-team_1", description: "x" });
      expect(spy).toHaveBeenCalledWith("POST", "/api/v2/groups", undefined, { groupName: "dev-team_1", description: "x" });
    });

    it("update_group sends description, empty string allowed", async () => {
      await tool(server, "ncloud_sso_update_group")({ groupId: G, description: "" });
      expect(spy).toHaveBeenCalledWith("PUT", `/api/v2/groups/${G}`, undefined, { description: "" });
      expect(() => schema(server, "ncloud_sso_update_group").parse({ groupId: G })).toThrow();
    });

    it("delete_group and member changes", async () => {
      await tool(server, "ncloud_sso_delete_group")({ groupId: G, confirm: true });
      expect(spy).toHaveBeenCalledWith("DELETE", `/api/v2/groups/${G}`);
      await tool(server, "ncloud_sso_add_users_to_group")({ groupId: G, userIds: [U] });
      expect(spy).toHaveBeenCalledWith("POST", `/api/v2/groups/${G}/add-users`, undefined, { userIds: [U] });
      await tool(server, "ncloud_sso_remove_users_from_group")({ groupId: G, userIds: [U], confirm: true });
      expect(spy).toHaveBeenCalledWith("POST", `/api/v2/groups/${G}/remove-users`, undefined, { userIds: [U] });
    });
  });

  describe("permission sets", () => {
    it("create/update/delete", async () => {
      await tool(server, "ncloud_sso_create_permission_set")({
        permissionSetName: "ReadOnly",
        systemManagedPolicyIds: ["p1"],
        userCreatedPolicyNames: ["myPolicy"],
      });
      expect(spy).toHaveBeenCalledWith("POST", "/api/v2/permission-sets", undefined, {
        permissionSetName: "ReadOnly",
        systemManagedPolicyIds: ["p1"],
        userCreatedPolicyNames: ["myPolicy"],
      });
      await tool(server, "ncloud_sso_update_permission_set")({ permissionSetId: "ps-1", systemManagedPolicyIds: [] });
      expect(spy).toHaveBeenCalledWith("PUT", "/api/v2/permission-sets/ps-1", undefined, { systemManagedPolicyIds: [] });
      await tool(server, "ncloud_sso_delete_permission_set")({ permissionSetId: "ps-1", confirm: true });
      expect(spy).toHaveBeenCalledWith("DELETE", "/api/v2/permission-sets/ps-1");
    });
  });

  describe("assignments", () => {
    it("create_assignment POSTs required fields", async () => {
      await tool(server, "ncloud_sso_create_assignment")({
        assignmentName: "prod-admin",
        accountMemberNo: 1234567,
        permissionSetId: "ps-1",
        consoleAccessAllowed: true,
        apiAccessAllowed: false,
      });
      expect(spy).toHaveBeenCalledWith("POST", "/api/v2/assignments", undefined, {
        assignmentName: "prod-admin",
        accountMemberNo: 1234567,
        permissionSetId: "ps-1",
        consoleAccessAllowed: true,
        apiAccessAllowed: false,
      });
    });

    it("update/delete/change-status", async () => {
      await tool(server, "ncloud_sso_update_assignment")({ assignmentId: A, consoleAccessAllowed: true, apiAccessAllowed: true });
      expect(spy).toHaveBeenCalledWith("PUT", `/api/v2/assignments/${A}`, undefined, {
        consoleAccessAllowed: true,
        apiAccessAllowed: true,
      });
      await tool(server, "ncloud_sso_delete_assignment")({ assignmentId: A, confirm: true });
      expect(spy).toHaveBeenCalledWith("DELETE", `/api/v2/assignments/${A}`);
      await tool(server, "ncloud_sso_change_assignment_status")({ assignmentId: A, active: false });
      expect(spy).toHaveBeenCalledWith("POST", `/api/v2/assignments/${A}/change-status`, undefined, { active: false });
    });

    it("add/remove targets", async () => {
      await tool(server, "ncloud_sso_add_targets_to_assignment")({ assignmentId: A, targetType: "USER", targetIds: [U] });
      expect(spy).toHaveBeenCalledWith("POST", `/api/v2/assignments/${A}/add-targets`, undefined, { targetType: "USER", targetIds: [U] });
      await tool(server, "ncloud_sso_remove_targets_from_assignment")({ assignmentId: A, targetType: "GROUP", targetIds: [G], confirm: true });
      expect(spy).toHaveBeenCalledWith("POST", `/api/v2/assignments/${A}/remove-targets`, undefined, { targetType: "GROUP", targetIds: [G] });
    });

    it("add/remove IP ACLs", async () => {
      await tool(server, "ncloud_sso_add_ip_acls_to_assignment")({
        assignmentId: A,
        consoleAccessAllowed: true,
        consoleAccessRestricted: true,
        consoleAccessIpAclIds: ["acl-1"],
        apiAccessAllowed: false,
        apiAccessRestricted: null,
      });
      expect(spy).toHaveBeenCalledWith("POST", `/api/v2/assignments/${A}/add-ip-acls`, undefined, {
        consoleAccessAllowed: true,
        consoleAccessRestricted: true,
        consoleAccessIpAclIds: ["acl-1"],
        apiAccessAllowed: false,
        apiAccessRestricted: null,
      });

      const empty = await tool(server, "ncloud_sso_remove_ip_acls_from_assignment")({ assignmentId: A, confirm: true });
      expect(empty.isError).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);

      await tool(server, "ncloud_sso_remove_ip_acls_from_assignment")({ assignmentId: A, apiAccessIpAclIds: ["acl-2"], confirm: true });
      expect(spy).toHaveBeenCalledWith("POST", `/api/v2/assignments/${A}/remove-ip-acls`, undefined, { apiAccessIpAclIds: ["acl-2"] });
    });
  });

  describe("IP ACLs", () => {
    it("create/update/delete", async () => {
      await tool(server, "ncloud_sso_create_ip_acl")({ ipAclName: "office", accessIps: ["203.0.113.0/24"] });
      expect(spy).toHaveBeenCalledWith("POST", "/api/v2/ip-acls", undefined, { ipAclName: "office", accessIps: ["203.0.113.0/24"] });
      await tool(server, "ncloud_sso_update_ip_acl")({ ipAclId: "acl-1", ipAclName: "office", accessIps: ["2001:db8::/32"] });
      expect(spy).toHaveBeenCalledWith("PUT", "/api/v2/ip-acls/acl-1", undefined, { ipAclName: "office", accessIps: ["2001:db8::/32"] });
      await tool(server, "ncloud_sso_delete_ip_acl")({ ipAclId: "acl-1", confirm: true });
      expect(spy).toHaveBeenCalledWith("DELETE", "/api/v2/ip-acls/acl-1");
    });

    it("accessIps must have 1-20 entries", () => {
      const s = schema(server, "ncloud_sso_create_ip_acl");
      expect(() => s.parse({ ipAclName: "office", accessIps: [] })).toThrow();
      expect(() => s.parse({ ipAclName: "office", accessIps: Array.from({ length: 21 }, (_, i) => `10.0.0.${i}`) })).toThrow();
    });
  });
});
