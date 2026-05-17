import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";

export function registerSubAccountTools(server: McpServer, client: NcloudClient): void {
  // ─── Sub Account Query Tools ───────────────────────────────────────────────

  server.tool(
    "ncloud_list_sub_accounts",
    "List all sub accounts (IAM users) in the organization",
    {
      page: z.number().optional().describe("Page number (0-based, default: 0)"),
      size: z.number().optional().describe("Page output count (default: 10)"),
      searchColumn: z.enum(["loginId", "name", "subAccountNo"]).optional().describe("Search column"),
      searchWord: z.string().optional().describe("Search keyword"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {};
        if (params.page !== undefined) queryParams.page = String(params.page);
        if (params.size !== undefined) queryParams.size = String(params.size);
        if (params.searchColumn) queryParams.searchColumn = params.searchColumn;
        if (params.searchWord) queryParams.searchWord = params.searchWord;
        const result = await client.requestRaw("GET", "/api/v1/sub-accounts", queryParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_get_sub_account_detail",
    "Get detailed information about a specific sub account",
    {
      subAccountId: z.string({ required_error: "필수 파라미터 'subAccountId'가 누락되었습니다." }).describe("Sub account ID to query"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw("GET", `/api/v1/sub-accounts/${encodeURIComponent(params.subAccountId)}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Sub Account Create Tool ───────────────────────────────────────────────

  server.tool(
    "ncloud_create_sub_account",
    "Create a new sub account (IAM user). Use dryRun=true to preview without creating.",
    {
      loginId: z.string({ required_error: "필수 파라미터 'loginId'가 누락되었습니다." }).describe("Login ID (3-60 chars, English letters/numbers/special chars . @ - _, must start with letter)"),
      name: z.string({ required_error: "필수 파라미터 'name'이 누락되었습니다." }).describe("Sub account username (2-30 chars)"),
      canAPIGatewayAccess: z.boolean({ required_error: "필수 파라미터 'canAPIGatewayAccess'가 누락되었습니다." }).describe("Whether to enable API Gateway access (creates access key)"),
      canConsoleAccess: z.boolean({ required_error: "필수 파라미터 'canConsoleAccess'가 누락되었습니다." }).describe("Whether to enable console access"),
      needPasswordReset: z.boolean({ required_error: "필수 파라미터 'needPasswordReset'이 누락되었습니다." }).describe("Whether to notify password change on first login"),
      needPasswordGenerate: z.boolean().optional().describe("If true, auto-generate password. If false, must provide password manually."),
      password: z.string().optional().describe("Login password (8-16 chars, required if needPasswordGenerate is false)"),
      email: z.string().optional().describe("Email address (6-100 chars)"),
      memo: z.string().optional().describe("Description (0-300 bytes)"),
      isMfaMandatory: z.boolean().optional().describe("Whether two-factor authentication is required"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the sub account"),
    },
    async (params) => {
      try {
        if (params.dryRun) {
          const preview = {
            label: "🔍 Dry-Run Preview: Sub Account Creation",
            loginId: params.loginId,
            name: params.name,
            email: params.email ?? "(none)",
            canAPIGatewayAccess: params.canAPIGatewayAccess,
            canConsoleAccess: params.canConsoleAccess,
            needPasswordReset: params.needPasswordReset,
            message: "이 요청은 실제 서브 계정을 생성하지 않습니다. dryRun=false로 호출하면 서브 계정이 생성됩니다.",
          };
          return { content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }] };
        }

        const { dryRun, ...bodyParams } = params;
        const result = await client.requestRaw("POST", "/api/v1/sub-accounts", undefined, bodyParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Sub Account Delete Tool ───────────────────────────────────────────────

  server.tool(
    "ncloud_delete_sub_account",
    "⚠️ Destructive: Permanently delete a sub account. All associated permissions and access will be revoked. Set confirm=true to execute.",
    {
      subAccountId: z.string({ required_error: "필수 파라미터 'subAccountId'가 누락되었습니다." }).describe("Sub account ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete Sub Account [${params.subAccountId}]. All associated permissions and access will be revoked.\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const result = await client.requestRaw("DELETE", `/api/v1/sub-accounts/${encodeURIComponent(params.subAccountId)}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Group Query Tools ─────────────────────────────────────────────────────

  server.tool(
    "ncloud_list_groups",
    "List all IAM groups for managing sub account permissions",
    {
      page: z.number().optional().describe("Page number (0-based, default: 0)"),
      size: z.number().optional().describe("Page output count (default: 10)"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {};
        if (params.page !== undefined) queryParams.page = String(params.page);
        if (params.size !== undefined) queryParams.size = String(params.size);
        const result = await client.requestRaw("GET", "/api/v1/groups", queryParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Group Create Tool ─────────────────────────────────────────────────────

  server.tool(
    "ncloud_create_group",
    "Create a new IAM group. Use dryRun=true to preview without creating.",
    {
      groupName: z.string({ required_error: "필수 파라미터 'groupName'이 누락되었습니다." }).describe("Name for the new group"),
      groupDescription: z.string().optional().describe("Description of the group"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the group"),
    },
    async (params) => {
      try {
        if (params.dryRun) {
          const preview = {
            label: "🔍 Dry-Run Preview: IAM Group Creation",
            groupName: params.groupName,
            groupDescription: params.groupDescription ?? "(none)",
            message: "이 요청은 실제 그룹을 생성하지 않습니다. dryRun=false로 호출하면 그룹이 생성됩니다.",
          };
          return { content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }] };
        }

        const { dryRun, ...bodyParams } = params;
        const result = await client.requestRaw("POST", "/api/v1/groups", undefined, bodyParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Group Delete Tool ─────────────────────────────────────────────────────

  server.tool(
    "ncloud_delete_group",
    "⚠️ Destructive: Permanently delete an IAM group. Set confirm=true to execute.",
    {
      groupId: z.string({ required_error: "필수 파라미터 'groupId'가 누락되었습니다." }).describe("Group ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete IAM Group [${params.groupId}]. All members will lose group-based permissions.\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const result = await client.requestRaw("DELETE", `/api/v1/groups/${encodeURIComponent(params.groupId)}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Policy Query Tools ────────────────────────────────────────────────────

  server.tool(
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
      try {
        const queryParams: Record<string, string> = {};
        if (params.page !== undefined) queryParams.page = String(params.page);
        if (params.size !== undefined) queryParams.size = String(params.size);
        if (params.type) queryParams.type = params.type;
        if (params.searchColumn) queryParams.searchColumn = params.searchColumn;
        if (params.searchWord) queryParams.searchWord = params.searchWord;
        const result = await client.requestRaw("GET", "/api/v1/policies", queryParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Policy Attach Tool (Sub Account) ──────────────────────────────────────

  server.tool(
    "ncloud_attach_policy_to_sub_account",
    "Assign IAM policies to a sub account",
    {
      subAccountId: z.string({ required_error: "필수 파라미터 'subAccountId'가 누락되었습니다." }).describe("Sub account ID to assign policies to"),
      policyIdList: z.array(z.string()).min(1, { message: "policyIdList는 최소 1개 이상의 정책 ID를 포함해야 합니다." }).describe("List of policy IDs to assign"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw(
          "POST",
          `/api/v1/sub-accounts/${encodeURIComponent(params.subAccountId)}/policies`,
          undefined,
          { policyIdList: params.policyIdList }
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Policy Detach Tool (Sub Account) ──────────────────────────────────────

  server.tool(
    "ncloud_detach_policy_from_sub_account",
    "⚠️ Destructive: Remove an IAM policy from a sub account. Set confirm=true to execute.",
    {
      subAccountId: z.string({ required_error: "필수 파라미터 'subAccountId'가 누락되었습니다." }).describe("Sub account ID"),
      policyId: z.string({ required_error: "필수 파라미터 'policyId'가 누락되었습니다." }).describe("Policy ID to detach"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will detach policy [${params.policyId}] from sub account [${params.subAccountId}].\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const result = await client.requestRaw(
          "DELETE",
          `/api/v1/sub-accounts/${encodeURIComponent(params.subAccountId)}/policies/${encodeURIComponent(params.policyId)}`
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Policy Attach Tool (Group) ────────────────────────────────────────────

  server.tool(
    "ncloud_attach_policy_to_group",
    "Assign IAM policies to a group",
    {
      groupId: z.string({ required_error: "필수 파라미터 'groupId'가 누락되었습니다." }).describe("Group ID to assign policies to"),
      policyIdList: z.array(z.string()).min(1, { message: "policyIdList는 최소 1개 이상의 정책 ID를 포함해야 합니다." }).describe("List of policy IDs to assign"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw(
          "POST",
          `/api/v1/groups/${encodeURIComponent(params.groupId)}/policies`,
          undefined,
          { policyIdList: params.policyIdList }
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Policy Detach Tool (Group) ────────────────────────────────────────────

  server.tool(
    "ncloud_detach_policy_from_group",
    "⚠️ Destructive: Remove an IAM policy from a group. Set confirm=true to execute.",
    {
      groupId: z.string({ required_error: "필수 파라미터 'groupId'가 누락되었습니다." }).describe("Group ID"),
      policyId: z.string({ required_error: "필수 파라미터 'policyId'가 누락되었습니다." }).describe("Policy ID to detach"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will detach policy [${params.policyId}] from group [${params.groupId}].\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const result = await client.requestRaw(
          "DELETE",
          `/api/v1/groups/${encodeURIComponent(params.groupId)}/policies/${encodeURIComponent(params.policyId)}`
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Role Query Tools ──────────────────────────────────────────────────────

  server.tool(
    "ncloud_list_roles",
    "List all IAM roles",
    {
      page: z.number().optional().describe("Page number (0-based, default: 0)"),
      size: z.number().optional().describe("Page output count (default: 10)"),
      searchColumn: z.enum(["roleName", "roleType", "nrn"]).optional().describe("Search column"),
      searchWord: z.string().optional().describe("Search keyword"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string> = {};
        if (params.page !== undefined) queryParams.page = String(params.page);
        if (params.size !== undefined) queryParams.size = String(params.size);
        if (params.searchColumn) queryParams.searchColumn = params.searchColumn;
        if (params.searchWord) queryParams.searchWord = params.searchWord;
        const result = await client.requestRaw("GET", "/api/v1/roles", queryParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Role Create Tool ──────────────────────────────────────────────────────

  server.tool(
    "ncloud_create_role",
    "Create a new IAM role. Use dryRun=true to preview without creating.",
    {
      roleName: z.string({ required_error: "필수 파라미터 'roleName'이 누락되었습니다." }).describe("Role name (3-100 chars, letters/numbers/special chars . _ -, must start with letter)"),
      roleType: z.enum(["Server", "Account", "Service"]).describe("Role type: Server (VPC server), Account (console/portal access), Service (inter-service access)"),
      isMyAccount: z.boolean({ required_error: "필수 파라미터 'isMyAccount'가 누락되었습니다." }).describe("Whether the role applies to the current account"),
      sessionExpirationSec: z.number().optional().describe("Session expiration time in seconds (600, 1800, 3600, or 10800). Not allowed for Server type."),
      descCont: z.string().optional().describe("Description of the role"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the role"),
    },
    async (params) => {
      try {
        if (params.dryRun) {
          const preview = {
            label: "🔍 Dry-Run Preview: IAM Role Creation",
            roleName: params.roleName,
            roleType: params.roleType,
            isMyAccount: params.isMyAccount,
            sessionExpirationSec: params.sessionExpirationSec ?? "(default)",
            descCont: params.descCont ?? "(none)",
            message: "이 요청은 실제 역할을 생성하지 않습니다. dryRun=false로 호출하면 역할이 생성됩니다.",
          };
          return { content: [{ type: "text" as const, text: JSON.stringify(preview, null, 2) }] };
        }

        const { dryRun, ...bodyParams } = params;
        const result = await client.requestRaw("POST", "/api/v1/roles", undefined, bodyParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Role Delete Tool ──────────────────────────────────────────────────────

  server.tool(
    "ncloud_delete_role",
    "⚠️ Destructive: Permanently delete an IAM role. Set confirm=true to execute.",
    {
      roleNo: z.string({ required_error: "필수 파라미터 'roleNo'가 누락되었습니다." }).describe("Role ID (roleNo) to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete IAM Role [${params.roleNo}].\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const result = await client.requestRaw("DELETE", `/api/v1/roles/${encodeURIComponent(params.roleNo)}`);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
