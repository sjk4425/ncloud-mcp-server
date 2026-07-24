import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { L, dryRunMessage, requiredError } from "./_messages.js";

export function registerSubAccountTools(server: McpServer, client: NcloudClient): void {
  // ─── Sub Account Query Tools ───────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_sub_accounts",
    "List all sub accounts (IAM users) in the organization",
    {
      page: z.number().optional().describe("Page number (0-based, default: 0)"),
      size: z.number().optional().describe("Page output count (default: 10)"),
      searchColumn: z.enum(["loginId", "name", "subAccountNo"]).optional().describe("Search column"),
      searchWord: z.string().optional().describe("Search keyword"),
    },
    async (params) => {
      const queryParams: Record<string, string> = {};
      if (params.page !== undefined) queryParams.page = String(params.page);
      if (params.size !== undefined) queryParams.size = String(params.size);
      if (params.searchColumn) queryParams.searchColumn = params.searchColumn;
      if (params.searchWord) queryParams.searchWord = params.searchWord;
      const result = await client.requestRaw("GET", "/api/v1/sub-accounts", queryParams);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_get_sub_account_detail",
    "Get detailed information about a specific sub account",
    {
      subAccountId: z.string({ required_error: requiredError("subAccountId") }).describe("Sub account ID to query"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/v1/sub-accounts/${encodeURIComponent(params.subAccountId)}`);
    }
  );

  // ─── Sub Account Create Tool ───────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_create_sub_account",
    "Create a new sub account (IAM user). Use dryRun=true to preview without creating.",
    {
      loginId: z.string({ required_error: requiredError("loginId") }).describe("Login ID (3-60 chars, English letters/numbers/special chars . @ - _, must start with letter)"),
      name: z.string({ required_error: requiredError("name") }).describe("Sub account username (2-30 chars)"),
      canAPIGatewayAccess: z.boolean({ required_error: requiredError("canAPIGatewayAccess") }).describe("Whether to enable API Gateway access (creates access key)"),
      canConsoleAccess: z.boolean({ required_error: requiredError("canConsoleAccess") }).describe("Whether to enable console access"),
      needPasswordReset: z.boolean({ required_error: requiredError("needPasswordReset") }).describe("Whether to notify password change on first login"),
      needPasswordGenerate: z.boolean().optional().describe("If true, auto-generate password. If false, must provide password manually."),
      password: z.string().optional().describe("Login password (8-16 chars, required if needPasswordGenerate is false)"),
      email: z.string().optional().describe("Email address (6-100 chars)"),
      memo: z.string().optional().describe("Description (0-300 bytes)"),
      isMfaMandatory: z.boolean().optional().describe("Whether two-factor authentication is required"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the sub account"),
    },
    async (params) => {
      if (params.dryRun) {
        const preview = {
          label: "🔍 Dry-Run Preview: Sub Account Creation",
          loginId: params.loginId,
          name: params.name,
          email: params.email ?? "(none)",
          canAPIGatewayAccess: params.canAPIGatewayAccess,
          canConsoleAccess: params.canConsoleAccess,
          needPasswordReset: params.needPasswordReset,
          message: dryRunMessage({ ko: "서브 계정", en: "sub account" }),
        };
        return preview;
      }

      const { dryRun, ...bodyParams } = params;
      const result = await client.requestRaw("POST", "/api/v1/sub-accounts", undefined, bodyParams);
      return result;
    }
  );

  // ─── Sub Account Delete Tool ───────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_sub_account",
    "⚠️ Destructive: Permanently delete a sub account. All associated permissions and access will be revoked. Set confirm=true to execute.",
    {
      subAccountId: z.string({ required_error: requiredError("subAccountId") }).describe("Sub account ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const result = await client.requestRaw("DELETE", `/api/v1/sub-accounts/${encodeURIComponent(params.subAccountId)}`);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete Sub Account [${params.subAccountId}]. All associated permissions and access will be revoked.\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Group Query Tools ─────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_groups",
    "List all IAM groups for managing sub account permissions",
    {
      page: z.number().optional().describe("Page number (0-based, default: 0)"),
      size: z.number().optional().describe("Page output count (default: 10)"),
    },
    async (params) => {
      const queryParams: Record<string, string> = {};
      if (params.page !== undefined) queryParams.page = String(params.page);
      if (params.size !== undefined) queryParams.size = String(params.size);
      const result = await client.requestRaw("GET", "/api/v1/groups", queryParams);
      return result;
    }
  );

  // ─── Group Create Tool ─────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_create_group",
    "Create a new IAM group. Use dryRun=true to preview without creating.",
    {
      groupName: z.string({ required_error: requiredError("groupName") }).describe("Name for the new group"),
      groupDescription: z.string().optional().describe("Description of the group"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the group"),
    },
    async (params) => {
      if (params.dryRun) {
        const preview = {
          label: "🔍 Dry-Run Preview: IAM Group Creation",
          groupName: params.groupName,
          groupDescription: params.groupDescription ?? "(none)",
          message: dryRunMessage({ ko: "그룹", en: "group" }),
        };
        return preview;
      }

      const { dryRun, ...bodyParams } = params;
      const result = await client.requestRaw("POST", "/api/v1/groups", undefined, bodyParams);
      return result;
    }
  );

  // ─── Group Delete Tool ─────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_group",
    "⚠️ Destructive: Permanently delete an IAM group. Set confirm=true to execute.",
    {
      groupId: z.string({ required_error: requiredError("groupId") }).describe("Group ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const result = await client.requestRaw("DELETE", `/api/v1/groups/${encodeURIComponent(params.groupId)}`);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete IAM Group [${params.groupId}]. All members will lose group-based permissions.\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Policy Query Tools ────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_policies",
    "List all available IAM policies",
    {
      page: z.number().optional().describe("Page number (0-based, default: 0)"),
      size: z.number().optional().describe("Page output count (default: 10)"),
      type: z.enum(["SYSTEM_MANAGED", "USER_CREATED"]).optional().describe("Filter by policy type"),
      searchColumn: z.string().optional().describe("Search column (policyName)"),
      searchWord: z.string().optional().describe("Search keyword"),
    },
    async (params) => {
      const queryParams: Record<string, string> = {};
      if (params.page !== undefined) queryParams.page = String(params.page);
      if (params.size !== undefined) queryParams.size = String(params.size);
      if (params.type) queryParams.type = params.type;
      if (params.searchColumn) queryParams.searchColumn = params.searchColumn;
      if (params.searchWord) queryParams.searchWord = params.searchWord;
      const result = await client.requestRaw("GET", "/api/v1/policies", queryParams);
      return result;
    }
  );

  // ─── Policy Attach Tool (Sub Account) ──────────────────────────────────────

  defineTool(
    server,
    "ncloud_attach_policy_to_sub_account",
    "Assign IAM policies to a sub account",
    {
      subAccountId: z.string({ required_error: requiredError("subAccountId") }).describe("Sub account ID to assign policies to"),
      policyIdList: z.array(z.string()).min(1, { message: L({ ko: "policyIdList는 최소 1개 이상의 정책 ID를 포함해야 합니다.", en: "policyIdList must contain at least one policy ID." }) }).describe("List of policy IDs to assign"),
    },
    async (params) => {
      return client.requestRaw(
          "POST",
          `/api/v1/sub-accounts/${encodeURIComponent(params.subAccountId)}/policies`,
          undefined,
          { policyIdList: params.policyIdList }
        );
    }
  );

  // ─── Policy Detach Tool (Sub Account) ──────────────────────────────────────

  defineTool(
    server,
    "ncloud_detach_policy_from_sub_account",
    "⚠️ Destructive: Remove an IAM policy from a sub account. Set confirm=true to execute.",
    {
      subAccountId: z.string({ required_error: requiredError("subAccountId") }).describe("Sub account ID"),
      policyId: z.string({ required_error: requiredError("policyId") }).describe("Policy ID to detach"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute"),
    },
    async (params) => {
      const result = await client.requestRaw(
        "DELETE",
        `/api/v1/sub-accounts/${encodeURIComponent(params.subAccountId)}/policies/${encodeURIComponent(params.policyId)}`
      );
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will detach policy [${params.policyId}] from sub account [${params.subAccountId}].\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Policy Attach Tool (Group) ────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_attach_policy_to_group",
    "Assign IAM policies to a group",
    {
      groupId: z.string({ required_error: requiredError("groupId") }).describe("Group ID to assign policies to"),
      policyIdList: z.array(z.string()).min(1, { message: L({ ko: "policyIdList는 최소 1개 이상의 정책 ID를 포함해야 합니다.", en: "policyIdList must contain at least one policy ID." }) }).describe("List of policy IDs to assign"),
    },
    async (params) => {
      return client.requestRaw(
          "POST",
          `/api/v1/groups/${encodeURIComponent(params.groupId)}/policies`,
          undefined,
          { policyIdList: params.policyIdList }
        );
    }
  );

  // ─── Policy Detach Tool (Group) ────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_detach_policy_from_group",
    "⚠️ Destructive: Remove an IAM policy from a group. Set confirm=true to execute.",
    {
      groupId: z.string({ required_error: requiredError("groupId") }).describe("Group ID"),
      policyId: z.string({ required_error: requiredError("policyId") }).describe("Policy ID to detach"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute"),
    },
    async (params) => {
      const result = await client.requestRaw(
        "DELETE",
        `/api/v1/groups/${encodeURIComponent(params.groupId)}/policies/${encodeURIComponent(params.policyId)}`
      );
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will detach policy [${params.policyId}] from group [${params.groupId}].\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Role Query Tools ──────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_roles",
    "List all IAM roles",
    {
      page: z.number().optional().describe("Page number (0-based, default: 0)"),
      size: z.number().optional().describe("Page output count (default: 10)"),
      searchColumn: z.enum(["roleName", "roleType", "nrn"]).optional().describe("Search column"),
      searchWord: z.string().optional().describe("Search keyword"),
    },
    async (params) => {
      const queryParams: Record<string, string> = {};
      if (params.page !== undefined) queryParams.page = String(params.page);
      if (params.size !== undefined) queryParams.size = String(params.size);
      if (params.searchColumn) queryParams.searchColumn = params.searchColumn;
      if (params.searchWord) queryParams.searchWord = params.searchWord;
      const result = await client.requestRaw("GET", "/api/v1/roles", queryParams);
      return result;
    }
  );

  // ─── Role Create Tool ──────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_create_role",
    "Create a new IAM role. Use dryRun=true to preview without creating.",
    {
      roleName: z.string({ required_error: requiredError("roleName") }).describe("Role name (3-100 chars, letters/numbers/special chars . _ -, must start with letter)"),
      roleType: z.enum(["Server", "Account", "Service"]).describe("Role type: Server (VPC server), Account (console/portal access), Service (inter-service access)"),
      isMyAccount: z.boolean({ required_error: requiredError("isMyAccount") }).describe("Whether the role applies to the current account"),
      sessionExpirationSec: z.number().optional().describe("Session expiration time in seconds (600, 1800, 3600, or 10800). Not allowed for Server type."),
      descCont: z.string().optional().describe("Description of the role"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the role"),
    },
    async (params) => {
      if (params.dryRun) {
        const preview = {
          label: "🔍 Dry-Run Preview: IAM Role Creation",
          roleName: params.roleName,
          roleType: params.roleType,
          isMyAccount: params.isMyAccount,
          sessionExpirationSec: params.sessionExpirationSec ?? "(default)",
          descCont: params.descCont ?? "(none)",
          message: dryRunMessage({ ko: "역할", en: "role" }),
        };
        return preview;
      }

      const { dryRun, ...bodyParams } = params;
      const result = await client.requestRaw("POST", "/api/v1/roles", undefined, bodyParams);
      return result;
    }
  );

  // ─── Role Delete Tool ──────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_role",
    "⚠️ Destructive: Permanently delete an IAM role. Set confirm=true to execute.",
    {
      roleNo: z.string({ required_error: requiredError("roleNo") }).describe("Role ID (roleNo) to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const result = await client.requestRaw("DELETE", `/api/v1/roles/${encodeURIComponent(params.roleNo)}`);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete IAM Role [${params.roleNo}].\n\nTo execute, call this tool again with confirm=true.` } }
  );
}
