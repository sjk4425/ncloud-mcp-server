import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { L, dryRunMessage, requiredError } from "./_messages.js";

/** 태그 맵(리소스당 최대 20개). Sub Account API는 tags를 `{key: value}` Map으로 받는다. */
const TAGS_SCHEMA = z
  .record(z.string())
  .optional()
  .describe('Tags as a key-value map, max 20 per resource. Example: {"env":"dev","team":"a"}');

/**
 * 사용자 정의 정책의 허용 대상(targets) 한 건.
 * 서비스 코드(product)·액션·리소스 NRN 조합이 실제 권한을 결정한다.
 */
const POLICY_TARGET_SCHEMA = z.object({
  product: z
    .string({ required_error: requiredError("product") })
    .describe("Service code of the target service (e.g. Server, DataQuery, ObjectStorage). See the Ncloud per-service permission reference for valid codes"),
  actions: z
    .array(z.string())
    .min(1, { message: L({ ko: "actions는 최소 1개 이상이어야 합니다.", en: "actions must contain at least one entry." }) })
    .describe('Allowed actions. Use an exact action name for fine-grained control, "View*" for all read actions, "Change*" for all mutating actions, or "*" for the whole service'),
  resourceNrns: z
    .array(z.string())
    .min(1, { message: L({ ko: "resourceNrns는 최소 1개 이상이어야 합니다.", en: "resourceNrns must contain at least one entry." }) })
    .describe('Target resource NRNs (e.g. "nrn:PUB:DataQuery:KR:123456:DataSource/2942"). Use ["*"] for every resource of the product — note the server rewrites that into a product-scoped NRN (["*"] on product Server comes back as ["nrn:*:Server:*::*"]), so a read-back through ncloud_get_policy_detail will not equal the string you sent'),
});

/** 사용자 정의 정책의 허용 권한(permissions) 한 건. */
const POLICY_PERMISSION_SCHEMA = z.object({
  effect: z
    .enum(["Allow"])
    .optional()
    .default("Allow")
    .describe('Whether the permission is allowed. "Allow" is the only valid value'),
  targets: z
    .array(POLICY_TARGET_SCHEMA)
    .min(1, { message: L({ ko: "targets는 최소 1개 이상이어야 합니다.", en: "targets must contain at least one entry." }) })
    .describe("Permission targets: which service, actions and resources this permission covers"),
  condition: z
    .record(z.any())
    .optional()
    .describe('Optional policy condition, shaped as {operator: {conditionKey: [values]}}. Example: {"StringEquals": {"ncp:RequestRegion": ["KR"]}}'),
});

/**
 * detach 계열 도구의 정책 ID 입력을 API 바디용 `policyIdList`로 정규화한다.
 *
 * Ncloud의 detachPolicyFrom{SubAccount,Group} 은 정책 ID를 **바디의 policyIdList 배열**로
 * 받는다(경로에 정책 ID가 없다). 예전 스키마의 단수 `policyId` 는 하위호환으로 남겨두고
 * 전송 시점에 배열로 합친다. 유효한 ID가 없으면 null.
 */
function resolvePolicyIdList(params: { policyIdList?: string[]; policyId?: string }): string[] | null {
  const merged = [...(params.policyIdList ?? []), ...(params.policyId ? [params.policyId] : [])];
  const unique = [...new Set(merged.filter((id) => id && id.trim() !== ""))];
  return unique.length > 0 ? unique : null;
}

/** `policyIdList`/`policyId` 둘 다 비었을 때의 검증 에러 응답. */
function policyIdListRequiredError() {
  return {
    content: [
      {
        type: "text" as const,
        text: L({
          ko: "policyIdList 또는 policyId 중 하나는 필수입니다.",
          en: "One of policyIdList or policyId is required.",
        }),
      },
    ],
    isError: true,
  };
}

/** confirm 경고 문구에 표시할 정책 ID 목록 문자열. */
function describePolicyIds(params: { policyIdList?: string[]; policyId?: string }): string {
  return (resolvePolicyIdList(params) ?? []).join(", ");
}

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
      useApiAllowSource: z.boolean().optional().describe("Restrict API access to specific sources. true: only apiAllowSources may call the API, false: any source"),
      apiAllowSources: z
        .array(
          z.object({
            type: z.enum(["IP", "VPC", "VPC_SERVER"]).describe("Access source type — IP: single IP or CIDR range, VPC: a VPC in use, VPC_SERVER: a server in a VPC"),
            source: z.string().describe("Access source value — an IP address/range for type IP, or an instance number for VPC/VPC_SERVER"),
          })
        )
        .optional()
        .describe("Allowed API access sources. Only applied when useApiAllowSource is true"),
      useConsolePermitIp: z.boolean().optional().describe("Restrict console access to specific IP ranges. true: only consolePermitIps may sign in, false: any IP"),
      consolePermitIps: z.array(z.string()).optional().describe("Allowed console access IP ranges. Only applied when useConsolePermitIp is true"),
      tags: TAGS_SCHEMA,
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

  // ─── Sub Account Access Key Tools ──────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_sub_account_access_keys",
    "List the API access keys of a sub account, with each key's active state and creation time. Secret keys are never returned here — a secret key is only shown once, in the ncloud_create_sub_account_access_key response.",
    {
      subAccountId: z.string({ required_error: requiredError("subAccountId") }).describe("Sub account ID (see ncloud_list_sub_accounts)"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/v1/sub-accounts/${encodeURIComponent(params.subAccountId)}/access-keys`);
    }
  );

  defineTool(
    server,
    "ncloud_create_sub_account_access_key",
    "Issue a new API access key (access key + secret key) for a sub account, so that account can call the Ncloud API. The response contains the secret key (keySecret) and it CANNOT be retrieved again afterwards — store it securely and do not paste it into shared logs or chats. The sub account must have API Gateway access enabled (canAPIGatewayAccess). A sub account holds at most TWO access keys: a third issue attempt fails with 409 '최대 허용값을 초과하였습니다' (verified against the live API; the limit is not in the API docs), so delete an unused key first, or deactivate one with ncloud_set_sub_account_access_key_status when rotating.",
    {
      subAccountId: z.string({ required_error: requiredError("subAccountId") }).describe("Sub account ID to issue the access key for (see ncloud_list_sub_accounts)"),
    },
    async (params) => {
      return client.requestRaw("POST", `/api/v1/sub-accounts/${encodeURIComponent(params.subAccountId)}/access-keys`);
    }
  );

  defineTool(
    server,
    "ncloud_set_sub_account_access_key_status",
    "Activate or deactivate a sub account's API access key. A deactivated key cannot call the API but is not deleted, so it can be re-activated later.",
    {
      subAccountId: z.string({ required_error: requiredError("subAccountId") }).describe("Sub account ID"),
      accessKey: z.string({ required_error: requiredError("accessKey") }).describe("Access key to change (see ncloud_list_sub_account_access_keys)"),
      active: z.boolean({ required_error: requiredError("active") }).describe("true: activate, false: deactivate"),
    },
    async (params) => {
      return client.requestRaw(
        "PUT",
        `/api/v1/sub-accounts/${encodeURIComponent(params.subAccountId)}/access-keys`,
        undefined,
        { accessKey: params.accessKey, active: params.active }
      );
    }
  );

  defineTool(
    server,
    "ncloud_delete_sub_account_access_key",
    "⚠️ Destructive: Permanently delete a sub account's API access key. Any client still using this key will start failing immediately and the key cannot be restored — to disable a key temporarily use ncloud_set_sub_account_access_key_status instead. Set confirm=true to execute.",
    {
      subAccountId: z.string({ required_error: requiredError("subAccountId") }).describe("Sub account ID"),
      accessKey: z.string({ required_error: requiredError("accessKey") }).describe("Access key to delete (see ncloud_list_sub_account_access_keys)"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      return client.requestRaw(
        "DELETE",
        `/api/v1/sub-accounts/${encodeURIComponent(params.subAccountId)}/access-keys`,
        undefined,
        { accessKey: params.accessKey }
      );
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete access key [${params.accessKey}] of sub account [${params.subAccountId}]. Clients using this key will fail immediately and the key cannot be restored.\n\nTo execute, call this tool again with confirm=true.` } }
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
    "Create a new IAM group. Groups have no description field in the Ncloud API — use tags instead. Use dryRun=true to preview without creating.",
    {
      groupName: z.string({ required_error: requiredError("groupName") }).describe("Name for the new group (3-30 chars: Korean/Japanese/English letters, digits, '.', '_', '-'; must start with a letter)"),
      tags: TAGS_SCHEMA,
      groupDescription: z.string().optional().describe("⚠️ Ignored — the Ncloud createGroup API has no description field, so this value is NOT sent. Kept only for backward compatibility; use tags to annotate a group"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the group"),
    },
    async (params) => {
      // createGroup 의 요청 바디는 groupName·tags 뿐이다. 예전 스키마의 groupDescription 은
      // API에 존재하지 않는 필드였으므로 입력은 받되 전송하지 않는다(MCP-BUG-REPORT #7 A-4).
      const bodyParams: Record<string, unknown> = { groupName: params.groupName };
      if (params.tags !== undefined) bodyParams.tags = params.tags;

      if (params.dryRun) {
        const preview = {
          label: "🔍 Dry-Run Preview: IAM Group Creation",
          request: bodyParams,
          ...(params.groupDescription !== undefined
            ? {
                ignoredParams: {
                  groupDescription: L({
                    ko: "Ncloud createGroup API에 description 필드가 없어 전송되지 않습니다. 대신 tags를 사용하세요.",
                    en: "Not sent — the Ncloud createGroup API has no description field. Use tags instead.",
                  }),
                },
              }
            : {}),
          message: dryRunMessage({ ko: "그룹", en: "group" }),
        };
        return preview;
      }

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

  defineTool(
    server,
    "ncloud_get_policy_detail",
    "Get a policy's details including its permission statements (which service, actions and resource NRNs it allows). Use this to inspect what a policy actually grants — ncloud_list_policies only returns names and descriptions.",
    {
      policyId: z.string({ required_error: requiredError("policyId") }).describe("Policy ID to query (see ncloud_list_policies)"),
      withPermissions: z.boolean().optional().default(true).describe("Include the permission statements. Defaults to true here (the API itself defaults to false)"),
    },
    async (params) => {
      return client.requestRaw(
        "GET",
        `/api/v1/policies/${encodeURIComponent(params.policyId)}`,
        { withPermissions: params.withPermissions }
      );
    }
  );

  defineTool(
    server,
    "ncloud_get_policy_resources",
    "List the resources (sub accounts, groups, roles) a policy is currently assigned to. Use this before deleting or editing a policy to see who is affected.",
    {
      policyId: z.string({ required_error: requiredError("policyId") }).describe("Policy ID to query (see ncloud_list_policies)"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/v1/policies/${encodeURIComponent(params.policyId)}/resources`);
    }
  );

  // ─── Policy Validate Tool ──────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_validate_policy",
    "Validate a user-created policy definition on the SERVER before creating it. Unlike a dryRun preview, this actually calls the Ncloud validation API and returns success plus INFO/WARNING/ERROR details (an ERROR entry means the definition would be rejected). No policy is created.",
    {
      policyName: z.string({ required_error: requiredError("policyName") }).describe("Policy name to validate (3-30 chars: Korean/Japanese/English letters, digits, '.', '_', '-'; must start with a letter)"),
      permissions: z
        .array(POLICY_PERMISSION_SCHEMA)
        .min(1, { message: L({ ko: "permissions는 최소 1개 이상이어야 합니다.", en: "permissions must contain at least one entry." }) })
        .describe("Permission statements to validate"),
      description: z.string().optional().describe("Description of the policy (0-300 bytes)"),
    },
    async (params) => {
      const bodyParams: Record<string, unknown> = {
        policyName: params.policyName,
        permissions: params.permissions,
      };
      if (params.description !== undefined) bodyParams.description = params.description;
      return client.requestRaw("POST", "/api/v1/policy/validation", undefined, bodyParams);
    },
    { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } }
  );

  // ─── Policy Create Tool ────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_create_policy",
    "Create a user-created (custom) IAM policy with explicit permission statements — the way to scope a sub account to specific actions and resources instead of using a broad system-managed policy. Max 500 policies per account. Use ncloud_validate_policy first for real server-side validation; dryRun=true only echoes the request shape.",
    {
      policyName: z.string({ required_error: requiredError("policyName") }).describe("Policy name (3-30 chars: Korean/Japanese/English letters, digits, '.', '_', '-'; must start with a letter)"),
      permissions: z
        .array(POLICY_PERMISSION_SCHEMA)
        .min(1, { message: L({ ko: "permissions는 최소 1개 이상이어야 합니다.", en: "permissions must contain at least one entry." }) })
        .describe("Permission statements. Each entry allows a set of actions on a set of resource NRNs for one service"),
      description: z.string().optional().describe("Description of the policy (0-300 bytes)"),
      tags: TAGS_SCHEMA,
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the policy"),
    },
    async (params) => {
      const bodyParams: Record<string, unknown> = {
        policyName: params.policyName,
        permissions: params.permissions,
      };
      if (params.description !== undefined) bodyParams.description = params.description;
      if (params.tags !== undefined) bodyParams.tags = params.tags;

      if (params.dryRun) {
        return {
          label: "🔍 Dry-Run Preview: IAM Policy Creation",
          request: bodyParams,
          hint: L({
            ko: "서버측 유효성 검증이 필요하면 ncloud_validate_policy를 호출하세요(실제 검증 API).",
            en: "For real server-side validation, call ncloud_validate_policy (the actual validation API).",
          }),
          message: dryRunMessage({ ko: "정책", en: "policy" }),
        };
      }

      return client.requestRaw("POST", "/api/v1/policies", undefined, bodyParams);
    }
  );

  // ─── Policy Update Tool ────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_update_policy",
    "Update a user-created (custom) IAM policy. The permissions array REPLACES the policy's existing statements, so send the complete desired set — read the current ones with ncloud_get_policy_detail first. System-managed policies cannot be updated, and the policy name cannot be changed.",
    {
      policyId: z.string({ required_error: requiredError("policyId") }).describe("Policy ID to update (see ncloud_list_policies)"),
      permissions: z
        .array(POLICY_PERMISSION_SCHEMA)
        .min(1, { message: L({ ko: "permissions는 최소 1개 이상이어야 합니다.", en: "permissions must contain at least one entry." }) })
        .describe("Full replacement set of permission statements"),
      description: z.string().optional().describe("Description of the policy (0-300 bytes)"),
    },
    async (params) => {
      const bodyParams: Record<string, unknown> = { permissions: params.permissions };
      if (params.description !== undefined) bodyParams.description = params.description;
      return client.requestRaw(
        "PUT",
        `/api/v1/policies/${encodeURIComponent(params.policyId)}`,
        undefined,
        bodyParams
      );
    }
  );

  // ─── Policy Delete Tools ───────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_policy",
    "⚠️ Destructive: Permanently delete a user-created (custom) IAM policy. Every sub account, group and role it is assigned to loses those permissions immediately — check ncloud_get_policy_resources first. System-managed policies cannot be deleted. Set confirm=true to execute.",
    {
      policyId: z.string({ required_error: requiredError("policyId") }).describe("Policy ID to delete (see ncloud_list_policies)"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      return client.requestRaw("DELETE", `/api/v1/policies/${encodeURIComponent(params.policyId)}`);
    },
    { destructive: { noun: "IAM Policy", describe: (params) => params.policyId } }
  );

  defineTool(
    server,
    "ncloud_delete_policies",
    "⚠️ Destructive: Permanently delete two or more user-created (custom) IAM policies at once. Every sub account, group and role they are assigned to loses those permissions immediately. System-managed policies cannot be deleted. Set confirm=true to execute.",
    {
      policyIdList: z
        .array(z.string())
        .min(2, { message: L({ ko: "policyIdList는 2개 이상의 정책 ID를 포함해야 합니다. 1개만 삭제하려면 ncloud_delete_policy를 사용하세요.", en: "policyIdList must contain at least two policy IDs. Use ncloud_delete_policy for a single policy." }) })
        .describe("Policy IDs to delete (2 or more). For a single policy use ncloud_delete_policy"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      // deletePolicyMulti 의 요청 바디는 키 없는 **배열** 그대로다(`["id1","id2"]`).
      return client.requestRaw("DELETE", "/api/v1/policies", undefined, params.policyIdList);
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete ${params.policyIdList?.length ?? 0} IAM policies [${(params.policyIdList ?? []).join(", ")}]. Every sub account, group and role they are assigned to loses those permissions.\n\nTo execute, call this tool again with confirm=true.` } }
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
    "⚠️ Destructive: Remove one or more IAM policies from a sub account. Policy IDs are sent in the request body as policyIdList (the API takes no policy ID in the path). Set confirm=true to execute.",
    {
      subAccountId: z.string({ required_error: requiredError("subAccountId") }).describe("Sub account ID"),
      policyIdList: z.array(z.string()).min(1, { message: L({ ko: "policyIdList는 최소 1개 이상의 정책 ID를 포함해야 합니다.", en: "policyIdList must contain at least one policy ID." }) }).optional().describe("List of policy IDs to detach. Provide this or policyId"),
      policyId: z.string().optional().describe("Single policy ID to detach. Merged into policyIdList when sent; kept for backward compatibility"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute"),
    },
    async (params) => {
      const policyIdList = resolvePolicyIdList(params);
      if (!policyIdList) return policyIdListRequiredError();
      // detachPolicyFromSubAccount 는 DELETE /sub-accounts/{id}/policies + body policyIdList 다.
      // 예전 구현은 정책 ID를 경로에 붙여 항상 실패했다(MCP-BUG-REPORT #7 A-1).
      const result = await client.requestRaw(
        "DELETE",
        `/api/v1/sub-accounts/${encodeURIComponent(params.subAccountId)}/policies`,
        undefined,
        { policyIdList }
      );
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will detach policies [${describePolicyIds(params)}] from sub account [${params.subAccountId}].\n\nTo execute, call this tool again with confirm=true.` } }
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
    "⚠️ Destructive: Remove one or more IAM policies from a group. Policy IDs are sent in the request body as policyIdList (the API takes no policy ID in the path). Set confirm=true to execute.",
    {
      groupId: z.string({ required_error: requiredError("groupId") }).describe("Group ID"),
      policyIdList: z.array(z.string()).min(1, { message: L({ ko: "policyIdList는 최소 1개 이상의 정책 ID를 포함해야 합니다.", en: "policyIdList must contain at least one policy ID." }) }).optional().describe("List of policy IDs to detach. Provide this or policyId"),
      policyId: z.string().optional().describe("Single policy ID to detach. Merged into policyIdList when sent; kept for backward compatibility"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute"),
    },
    async (params) => {
      const policyIdList = resolvePolicyIdList(params);
      if (!policyIdList) return policyIdListRequiredError();
      // detachPolicyFromGroup 도 DELETE /groups/{id}/policies + body policyIdList 다(#7 A-2).
      const result = await client.requestRaw(
        "DELETE",
        `/api/v1/groups/${encodeURIComponent(params.groupId)}/policies`,
        undefined,
        { policyIdList }
      );
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will detach policies [${describePolicyIds(params)}] from group [${params.groupId}].\n\nTo execute, call this tool again with confirm=true.` } }
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
    "Create a new IAM role. A role is only a container for policies: creating it grants nothing until policies are attached (POST /api/v1/roles/{roleNo}/policies) and a role target is set (POST /api/v1/roles/{roleNo}/entities/account for Account roles, /entities for Server and Service roles) — those endpoints have no MCP tool yet. Use dryRun=true to preview without creating.",
    {
      roleName: z.string({ required_error: requiredError("roleName") }).describe("Role name (3-100 chars: Korean/Japanese/English letters, digits, '.', '_', '-'; must start with a letter)"),
      roleType: z.enum(["Server", "Account", "Service"]).describe("Role type: Server (VPC server resource, no access key needed), Account (grants the main account's console/portal access to a sub account via role switching), Service (inter-service access)"),
      sessionExpirationSec: z.union([z.literal(600), z.literal(1800), z.literal(3600), z.literal(10800)]).optional().describe("Session expiration time in seconds: 600, 1800, 3600, or 10800. REQUIRED when roleType is Account"),
      descCont: z.string().optional().describe("Description of the role (0-300 bytes)"),
      tags: TAGS_SCHEMA,
      isMyAccount: z.boolean().optional().describe("⚠️ Ignored — createRole has no isMyAccount field, so this value is NOT sent. It belongs to the separate 'add Account role target' API (POST /api/v1/roles/{roleNo}/entities/account). Kept only for backward compatibility"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the role"),
    },
    async (params) => {
      // createRole 의 요청 바디는 roleName·roleType·sessionExpirationSec·descCont·tags 뿐이다.
      // 예전 스키마의 isMyAccount 는 attachEntityToRole(POST /roles/{roleNo}/entities/account)의
      // 필드이지 createRole 의 필드가 아니다 — 입력은 받되 전송하지 않는다(#7 A-3).
      if (params.roleType === "Account" && params.sessionExpirationSec === undefined) {
        return {
          content: [{
            type: "text" as const,
            text: L({
              ko: "roleType이 Account인 경우 sessionExpirationSec(600 | 1800 | 3600 | 10800)은 필수입니다.",
              en: "sessionExpirationSec (600 | 1800 | 3600 | 10800) is required when roleType is Account.",
            }),
          }],
          isError: true,
        };
      }

      const bodyParams: Record<string, unknown> = { roleName: params.roleName, roleType: params.roleType };
      if (params.sessionExpirationSec !== undefined) bodyParams.sessionExpirationSec = params.sessionExpirationSec;
      if (params.descCont !== undefined) bodyParams.descCont = params.descCont;
      if (params.tags !== undefined) bodyParams.tags = params.tags;

      if (params.dryRun) {
        const preview = {
          label: "🔍 Dry-Run Preview: IAM Role Creation",
          request: bodyParams,
          ...(params.isMyAccount !== undefined
            ? {
                ignoredParams: {
                  isMyAccount: L({
                    ko: "createRole API의 필드가 아니라 전송되지 않습니다. 역할 적용 대상 지정은 POST /api/v1/roles/{roleNo}/entities/account 입니다.",
                    en: "Not sent — not a createRole field. Role targets are set via POST /api/v1/roles/{roleNo}/entities/account.",
                  }),
                },
              }
            : {}),
          message: dryRunMessage({ ko: "역할", en: "role" }),
        };
        return preview;
      }

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
