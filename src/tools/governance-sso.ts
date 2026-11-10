import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { L, requiredError } from "./_messages.js";
import { dryRunPreview } from "./_dryrun.js";

/**
 * Ncloud Single Sign-On API v2 (공공기관용 Government 존 전용, 2026-10-22 출시).
 *
 * Base URL `https://sso.apigw.gov-ntruss.com`, 모든 경로는 `/api/v2` 로 시작한다.
 * REST(JSON 본문) API 이며 생성 201, 삭제 204(본문 없음 → client 가 `{ success: true }` 로 처리).
 * 수정(PUT) 오퍼레이션은 **전체 교체** — 생략한 선택 필드는 서버에서 비워진다.
 *
 * 문서: https://api-gov.ncloud-docs.com/docs/gov-single-sign-on-v2-overview
 */

const SSO_BASE = "/api/v2";

const p = (id: string) => encodeURIComponent(id);

/** 이름 규칙(그룹·권한 세트·할당·IP ACL 공통): 영숫자로 시작, 영숫자/`_`/`-`, 2~30자. */
const NAME_PATTERN = /^[A-Za-z0-9]+[A-Za-z0-9_-]*$/;

function nameSchema(field: string) {
  return z
    .string({ required_error: requiredError(field) })
    .min(2)
    .max(30)
    .regex(NAME_PATTERN, {
      message: L({
        ko: `${field}은 영문/숫자로 시작하고 영문·숫자·_·- 만 사용할 수 있습니다(2~30자).`,
        en: `${field} must start with a letter or digit and contain only letters, digits, '_' or '-' (2-30 chars).`,
      }),
    });
}

const DESCRIPTION_SCHEMA = z.string().max(300).optional();

const TAGS_SCHEMA = z
  .record(z.string())
  .optional()
  .refine((t) => t === undefined || Object.keys(t).length <= 20, {
    message: L({ ko: "태그는 최대 20개입니다.", en: "At most 20 tags are allowed." }),
  })
  .describe('Tags as a key-value map, max 20. Example: {"env":"prod"}');

const PAGINATION = {
  pageNo: z.number().int().min(0).max(1000000).optional().describe("Page number (0-based, 0-1000000, default 0)"),
  pageSize: z.number().int().min(1).max(100).optional().describe("Page size (1-100, default 20)"),
};

function pageQuery(params: { pageNo?: number; pageSize?: number }): Record<string, number | undefined> {
  return { pageNo: params.pageNo, pageSize: params.pageSize };
}

function idList(field: string, max?: number) {
  let s = z.array(z.string().min(1)).min(1, {
    message: L({ ko: `${field}는 최소 1개 이상이어야 합니다.`, en: `${field} must contain at least one entry.` }),
  });
  if (max !== undefined) s = s.max(max);
  return s;
}

const USER_PROFILE_SCHEMA = z
  .object({
    firstName: z.string().max(200).optional(),
    lastName: z.string().max(200).optional(),
    email: z.string().max(200).optional(),
    employeeNo: z.string().max(200).optional(),
    phoneCountryCode: z
      .string()
      .regex(/^\d{0,4}$/, { message: "phoneCountryCode must be up to 4 digits (e.g. 82)" })
      .optional(),
    phoneNo: z
      .string()
      .regex(/^(\d{3}-\d{3,4}-\d{4}|\d{9,11})?$/, {
        message: "phoneNo must look like 010-1234-5678 or 9-11 digits",
      })
      .optional(),
    departmentName: z.string().max(200).optional(),
  })
  .optional()
  .describe("User profile: firstName, lastName, email, employeeNo, departmentName (each <=200 chars), phoneCountryCode (digits, <=4), phoneNo (010-1234-5678 or 9-11 digits)");

const ACCESS_RULES_SCHEMA = z
  .object({
    consoleAccessAllowed: z.boolean({ required_error: requiredError("accessRules.consoleAccessAllowed") }),
    apiAccessAllowed: z.boolean({ required_error: requiredError("accessRules.apiAccessAllowed") }),
  }, { required_error: requiredError("accessRules") })
  .describe("Access rules: { consoleAccessAllowed, apiAccessAllowed }");

const TARGET_TYPE = z.enum(["USER", "GROUP"]);

const DRY_RUN = z.boolean().optional().default(false).describe("If true, returns a preview of the request without calling the API");

const FULL_REPLACE_NOTE =
  "This is a FULL REPLACE: optional fields you omit are cleared on the server, so pass the current values (from the matching get tool) for anything you want to keep.";

/** 바디에서 undefined 값을 제거한다(JSON 직렬화 결과를 깔끔하게, 테스트 비교 용이). */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
}

export function registerSsoTools(server: McpServer, client: NcloudClient): void {
  /** 생성/수정 공통: dryRun 이면 프리뷰, 아니면 호출. */
  async function send(
    method: "POST" | "PUT",
    path: string,
    body: Record<string, unknown>,
    dryRun: boolean | undefined,
    noun: { ko: string; en: string },
    label: string,
    verb?: "create" | "apply"
  ) {
    if (dryRun) {
      return dryRunPreview({ label: `🔍 Dry-Run Preview: ${label}`, endpoint: path, method, requestParams: body, noun, verb });
    }
    return client.requestRaw(method, path, undefined, body);
  }

  // ─── Tenant ───────────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_sso_get_tenant",
    "Get the Single Sign-On tenant (Government zone only): tenant ID, status, sign-in URL and identity source.",
    {},
    async () => client.requestRaw("GET", `${SSO_BASE}/tenant`)
  );

  defineTool(
    server,
    "ncloud_sso_get_login_setting",
    "Get the Single Sign-On tenant login settings (Government zone only), such as session and MFA settings.",
    {},
    async () => client.requestRaw("GET", `${SSO_BASE}/tenant/login-setting`)
  );

  // ─── Users ────────────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_sso_list_users",
    "List Single Sign-On users (Government zone only), paginated.",
    { ...PAGINATION },
    async (params) => client.requestRaw("GET", `${SSO_BASE}/users`, pageQuery(params))
  );

  defineTool(
    server,
    "ncloud_sso_get_user",
    "Get a Single Sign-On user by user ID (Government zone only).",
    { userId: z.string({ required_error: requiredError("userId") }).describe("SSO user ID (UUID)") },
    async (params) => client.requestRaw("GET", `${SSO_BASE}/users/${p(params.userId)}`)
  );

  defineTool(
    server,
    "ncloud_sso_create_user",
    "Create a Single Sign-On user (Government zone only). loginId must be an email address and cannot be changed later. Use dryRun=true to preview.",
    {
      loginId: z
        .string({ required_error: requiredError("loginId") })
        .min(3)
        .max(60)
        .email()
        .describe("Login ID — an email address, 3-60 chars, immutable after creation"),
      description: DESCRIPTION_SCHEMA.describe("Description (<=300 chars)"),
      userProfile: USER_PROFILE_SCHEMA,
      accessRules: ACCESS_RULES_SCHEMA,
      tags: TAGS_SCHEMA,
      dryRun: DRY_RUN,
    },
    async (params) => {
      const { dryRun, ...rest } = params;
      const body = compact(rest);
      return send("POST", `${SSO_BASE}/users`, body, dryRun, { ko: "SSO 사용자", en: "SSO user" }, "SSO User Creation");
    }
  );

  defineTool(
    server,
    "ncloud_sso_update_user",
    `Update a Single Sign-On user's description, profile and access rules (Government zone only). ${FULL_REPLACE_NOTE} loginId cannot be changed. Use dryRun=true to preview.`,
    {
      userId: z.string({ required_error: requiredError("userId") }).describe("SSO user ID (UUID)"),
      description: DESCRIPTION_SCHEMA.describe("Description (<=300 chars). Omit to clear"),
      userProfile: USER_PROFILE_SCHEMA,
      accessRules: ACCESS_RULES_SCHEMA,
      dryRun: DRY_RUN,
    },
    async (params) => {
      const { dryRun, userId, ...rest } = params;
      return send("PUT", `${SSO_BASE}/users/${p(userId)}`, compact(rest), dryRun, { ko: "SSO 사용자 변경", en: "SSO user change" }, "SSO User Update", "apply");
    }
  );

  defineTool(
    server,
    "ncloud_sso_delete_user",
    "⚠️ Destructive: Permanently delete a Single Sign-On user (Government zone only). The user loses access to every assigned account. Set confirm=true to execute.",
    { userId: z.string({ required_error: requiredError("userId") }).describe("SSO user ID (UUID) to delete") },
    async (params) => client.requestRaw("DELETE", `${SSO_BASE}/users/${p(params.userId)}`),
    { destructive: { noun: "SSO User", describe: (x) => x.userId } }
  );

  defineTool(
    server,
    "ncloud_sso_update_user_access_rule",
    "Set whether a Single Sign-On user may access the console and/or the API (Government zone only). Both flags are required.",
    {
      userId: z.string({ required_error: requiredError("userId") }).describe("SSO user ID (UUID)"),
      consoleAccessAllowed: z.boolean({ required_error: requiredError("consoleAccessAllowed") }).describe("Allow console access"),
      apiAccessAllowed: z.boolean({ required_error: requiredError("apiAccessAllowed") }).describe("Allow API access"),
    },
    async (params) =>
      client.requestRaw("PUT", `${SSO_BASE}/users/${p(params.userId)}/access-rule`, undefined, {
        consoleAccessAllowed: params.consoleAccessAllowed,
        apiAccessAllowed: params.apiAccessAllowed,
      })
  );

  defineTool(
    server,
    "ncloud_sso_list_user_groups",
    "List the groups a Single Sign-On user belongs to (Government zone only), paginated.",
    { userId: z.string({ required_error: requiredError("userId") }).describe("SSO user ID (UUID)"), ...PAGINATION },
    async (params) => client.requestRaw("GET", `${SSO_BASE}/users/${p(params.userId)}/groups`, pageQuery(params))
  );

  defineTool(
    server,
    "ncloud_sso_list_user_assignments",
    "List the assignments (account + permission set) that apply to a Single Sign-On user (Government zone only), paginated.",
    { userId: z.string({ required_error: requiredError("userId") }).describe("SSO user ID (UUID)"), ...PAGINATION },
    async (params) => client.requestRaw("GET", `${SSO_BASE}/users/${p(params.userId)}/assignments`, pageQuery(params))
  );

  defineTool(
    server,
    "ncloud_sso_add_groups_to_user",
    "Add a Single Sign-On user to one or more groups (Government zone only).",
    {
      userId: z.string({ required_error: requiredError("userId") }).describe("SSO user ID (UUID)"),
      groupIds: idList("groupIds").describe("Group IDs (UUID) to add the user to, at least 1"),
    },
    async (params) =>
      client.requestRaw("POST", `${SSO_BASE}/users/${p(params.userId)}/add-groups`, undefined, { groupIds: params.groupIds })
  );

  defineTool(
    server,
    "ncloud_sso_remove_groups_from_user",
    "⚠️ Destructive: Remove a Single Sign-On user from one or more groups (Government zone only). The user loses access granted through those groups. Set confirm=true to execute.",
    {
      userId: z.string({ required_error: requiredError("userId") }).describe("SSO user ID (UUID)"),
      groupIds: idList("groupIds").describe("Group IDs (UUID) to remove the user from, at least 1"),
    },
    async (params) =>
      client.requestRaw("POST", `${SSO_BASE}/users/${p(params.userId)}/remove-groups`, undefined, { groupIds: params.groupIds }),
    { destructive: { message: (x) => `⚠️ This will remove SSO User [${x.userId}] from group(s) [${(x.groupIds ?? []).join(", ")}].\n\nTo execute, call this tool again with confirm=true.` } }
  );

  defineTool(
    server,
    "ncloud_sso_enable_users",
    "Enable up to 100 Single Sign-On users in one call (Government zone only). The response has a `results` map keyed by input index; per-item failures come back as `failures` in a 4xx error body.",
    { userIds: idList("userIds", 100).describe("SSO user IDs (UUID), 1-100") },
    async (params) => client.requestRaw("POST", `${SSO_BASE}/users/batch-enable`, undefined, { userIds: params.userIds })
  );

  defineTool(
    server,
    "ncloud_sso_disable_users",
    "Disable up to 100 Single Sign-On users in one call (Government zone only) — disabled users cannot sign in until re-enabled. The response has a `results` map keyed by input index; per-item failures come back as `failures` in a 4xx error body.",
    { userIds: idList("userIds", 100).describe("SSO user IDs (UUID), 1-100") },
    async (params) => client.requestRaw("POST", `${SSO_BASE}/users/batch-disable`, undefined, { userIds: params.userIds })
  );

  // ─── Groups ───────────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_sso_list_groups",
    "List Single Sign-On groups (Government zone only), paginated.",
    { ...PAGINATION },
    async (params) => client.requestRaw("GET", `${SSO_BASE}/groups`, pageQuery(params))
  );

  defineTool(
    server,
    "ncloud_sso_get_group",
    "Get a Single Sign-On group by group ID (Government zone only).",
    { groupId: z.string({ required_error: requiredError("groupId") }).describe("Group ID (UUID)") },
    async (params) => client.requestRaw("GET", `${SSO_BASE}/groups/${p(params.groupId)}`)
  );

  defineTool(
    server,
    "ncloud_sso_create_group",
    "Create a Single Sign-On group (Government zone only). groupName cannot be changed later. Use dryRun=true to preview.",
    {
      groupName: nameSchema("groupName").describe("Group name: 2-30 chars, starts with a letter/digit, then letters, digits, '_' or '-'. Immutable"),
      description: DESCRIPTION_SCHEMA.describe("Description (<=300 chars)"),
      tags: TAGS_SCHEMA,
      dryRun: DRY_RUN,
    },
    async (params) => {
      const { dryRun, ...rest } = params;
      return send("POST", `${SSO_BASE}/groups`, compact(rest), dryRun, { ko: "SSO 그룹", en: "SSO group" }, "SSO Group Creation");
    }
  );

  defineTool(
    server,
    "ncloud_sso_update_group",
    "Update a Single Sign-On group's description (Government zone only). The description is the only mutable field and is required; pass an empty string to clear it.",
    {
      groupId: z.string({ required_error: requiredError("groupId") }).describe("Group ID (UUID)"),
      description: z.string({ required_error: requiredError("description") }).max(300).describe('New description (<=300 chars); "" clears it'),
    },
    async (params) =>
      client.requestRaw("PUT", `${SSO_BASE}/groups/${p(params.groupId)}`, undefined, { description: params.description })
  );

  defineTool(
    server,
    "ncloud_sso_delete_group",
    "⚠️ Destructive: Permanently delete a Single Sign-On group (Government zone only). Members lose access granted through this group. Set confirm=true to execute.",
    { groupId: z.string({ required_error: requiredError("groupId") }).describe("Group ID (UUID) to delete") },
    async (params) => client.requestRaw("DELETE", `${SSO_BASE}/groups/${p(params.groupId)}`),
    { destructive: { noun: "SSO Group", describe: (x) => x.groupId } }
  );

  defineTool(
    server,
    "ncloud_sso_list_group_users",
    "List the users in a Single Sign-On group (Government zone only), paginated.",
    { groupId: z.string({ required_error: requiredError("groupId") }).describe("Group ID (UUID)"), ...PAGINATION },
    async (params) => client.requestRaw("GET", `${SSO_BASE}/groups/${p(params.groupId)}/users`, pageQuery(params))
  );

  defineTool(
    server,
    "ncloud_sso_add_users_to_group",
    "Add one or more Single Sign-On users to a group (Government zone only).",
    {
      groupId: z.string({ required_error: requiredError("groupId") }).describe("Group ID (UUID)"),
      userIds: idList("userIds").describe("SSO user IDs (UUID) to add, at least 1"),
    },
    async (params) =>
      client.requestRaw("POST", `${SSO_BASE}/groups/${p(params.groupId)}/add-users`, undefined, { userIds: params.userIds })
  );

  defineTool(
    server,
    "ncloud_sso_remove_users_from_group",
    "⚠️ Destructive: Remove one or more Single Sign-On users from a group (Government zone only). They lose access granted through this group. Set confirm=true to execute.",
    {
      groupId: z.string({ required_error: requiredError("groupId") }).describe("Group ID (UUID)"),
      userIds: idList("userIds").describe("SSO user IDs (UUID) to remove, at least 1"),
    },
    async (params) =>
      client.requestRaw("POST", `${SSO_BASE}/groups/${p(params.groupId)}/remove-users`, undefined, { userIds: params.userIds }),
    { destructive: { message: (x) => `⚠️ This will remove user(s) [${(x.userIds ?? []).join(", ")}] from SSO Group [${x.groupId}].\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Permission Sets ──────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_sso_list_permission_sets",
    "List Single Sign-On permission sets (Government zone only), paginated.",
    { ...PAGINATION },
    async (params) => client.requestRaw("GET", `${SSO_BASE}/permission-sets`, pageQuery(params))
  );

  defineTool(
    server,
    "ncloud_sso_get_permission_set",
    "Get a Single Sign-On permission set, including its attached policies (Government zone only).",
    { permissionSetId: z.string({ required_error: requiredError("permissionSetId") }).describe("Permission set ID (UUID)") },
    async (params) => client.requestRaw("GET", `${SSO_BASE}/permission-sets/${p(params.permissionSetId)}`)
  );

  defineTool(
    server,
    "ncloud_sso_create_permission_set",
    "Create a Single Sign-On permission set (Government zone only) from system-managed policies (IDs from ncloud_sso_list_managed_policies) and/or user-created Sub Account policy names. permissionSetName cannot be changed later. Use dryRun=true to preview.",
    {
      permissionSetName: nameSchema("permissionSetName").describe("Permission set name: 2-30 chars, starts with a letter/digit, then letters, digits, '_' or '-'. Immutable"),
      description: DESCRIPTION_SCHEMA.describe("Description (<=300 chars)"),
      systemManagedPolicyIds: z.array(z.string()).optional().describe("System-managed policy IDs (UUID) — see ncloud_sso_list_managed_policies"),
      userCreatedPolicyNames: z.array(z.string()).optional().describe("Names of user-created policies to attach"),
      tags: TAGS_SCHEMA,
      dryRun: DRY_RUN,
    },
    async (params) => {
      const { dryRun, ...rest } = params;
      return send("POST", `${SSO_BASE}/permission-sets`, compact(rest), dryRun, { ko: "SSO 권한 세트", en: "SSO permission set" }, "SSO Permission Set Creation");
    }
  );

  defineTool(
    server,
    "ncloud_sso_update_permission_set",
    `Update a Single Sign-On permission set's description and policies (Government zone only). ${FULL_REPLACE_NOTE} Policies not included in systemManagedPolicyIds/userCreatedPolicyNames are DETACHED, which changes the permissions of every assignment using this set. Use dryRun=true to preview.`,
    {
      permissionSetId: z.string({ required_error: requiredError("permissionSetId") }).describe("Permission set ID (UUID)"),
      description: DESCRIPTION_SCHEMA.describe("Description (<=300 chars). Omit to clear"),
      systemManagedPolicyIds: z.array(z.string()).optional().describe("Complete list of system-managed policy IDs to keep attached"),
      userCreatedPolicyNames: z.array(z.string()).optional().describe("Complete list of user-created policy names to keep attached"),
      dryRun: DRY_RUN,
    },
    async (params) => {
      const { dryRun, permissionSetId, ...rest } = params;
      return send("PUT", `${SSO_BASE}/permission-sets/${p(permissionSetId)}`, compact(rest), dryRun, { ko: "SSO 권한 세트 변경", en: "SSO permission set change" }, "SSO Permission Set Update", "apply");
    }
  );

  defineTool(
    server,
    "ncloud_sso_delete_permission_set",
    "⚠️ Destructive: Permanently delete a Single Sign-On permission set (Government zone only). Set confirm=true to execute.",
    { permissionSetId: z.string({ required_error: requiredError("permissionSetId") }).describe("Permission set ID (UUID) to delete") },
    async (params) => client.requestRaw("DELETE", `${SSO_BASE}/permission-sets/${p(params.permissionSetId)}`),
    { destructive: { noun: "SSO Permission Set", describe: (x) => x.permissionSetId } }
  );

  defineTool(
    server,
    "ncloud_sso_list_managed_policies",
    "List the system-managed policies available for Single Sign-On permission sets (Government zone only), paginated.",
    { ...PAGINATION },
    async (params) => client.requestRaw("GET", `${SSO_BASE}/managed-policies`, pageQuery(params))
  );

  // ─── Assignments ──────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_sso_list_assignments",
    "List Single Sign-On assignments (an organization member account + a permission set) (Government zone only), paginated.",
    { ...PAGINATION },
    async (params) => client.requestRaw("GET", `${SSO_BASE}/assignments`, pageQuery(params))
  );

  defineTool(
    server,
    "ncloud_sso_get_assignment",
    "Get a Single Sign-On assignment by assignment ID (Government zone only).",
    { assignmentId: z.string({ required_error: requiredError("assignmentId") }).describe("Assignment ID (UUID)") },
    async (params) => client.requestRaw("GET", `${SSO_BASE}/assignments/${p(params.assignmentId)}`)
  );

  defineTool(
    server,
    "ncloud_sso_create_assignment",
    "Create a Single Sign-On assignment that grants a permission set on an organization member account (Government zone only). Add users/groups afterwards with ncloud_sso_add_targets_to_assignment. assignmentName cannot be changed later. Use dryRun=true to preview.",
    {
      assignmentName: nameSchema("assignmentName").describe("Assignment name: 2-30 chars, starts with a letter/digit, then letters, digits, '_' or '-'. Immutable"),
      accountMemberNo: z
        .number({ required_error: requiredError("accountMemberNo") })
        .int()
        .describe("Organization member account number — see ncloud_sso_list_organization_accounts"),
      permissionSetId: z.string({ required_error: requiredError("permissionSetId") }).describe("Permission set ID (UUID)"),
      description: DESCRIPTION_SCHEMA.describe("Description (<=300 chars)"),
      consoleAccessAllowed: z.boolean({ required_error: requiredError("consoleAccessAllowed") }).describe("Allow console access through this assignment"),
      apiAccessAllowed: z.boolean({ required_error: requiredError("apiAccessAllowed") }).describe("Allow API access through this assignment"),
      tags: TAGS_SCHEMA,
      dryRun: DRY_RUN,
    },
    async (params) => {
      const { dryRun, ...rest } = params;
      return send("POST", `${SSO_BASE}/assignments`, compact(rest), dryRun, { ko: "SSO 할당", en: "SSO assignment" }, "SSO Assignment Creation");
    }
  );

  defineTool(
    server,
    "ncloud_sso_update_assignment",
    `Update a Single Sign-On assignment's description and access types (Government zone only). ${FULL_REPLACE_NOTE} Setting consoleAccessAllowed or apiAccessAllowed to false also DETACHES the IP ACLs of that access type. Use dryRun=true to preview.`,
    {
      assignmentId: z.string({ required_error: requiredError("assignmentId") }).describe("Assignment ID (UUID)"),
      description: DESCRIPTION_SCHEMA.describe("Description (<=300 chars). Omit to clear"),
      consoleAccessAllowed: z.boolean({ required_error: requiredError("consoleAccessAllowed") }).describe("Allow console access"),
      apiAccessAllowed: z.boolean({ required_error: requiredError("apiAccessAllowed") }).describe("Allow API access"),
      dryRun: DRY_RUN,
    },
    async (params) => {
      const { dryRun, assignmentId, ...rest } = params;
      return send("PUT", `${SSO_BASE}/assignments/${p(assignmentId)}`, compact(rest), dryRun, { ko: "SSO 할당 변경", en: "SSO assignment change" }, "SSO Assignment Update", "apply");
    }
  );

  defineTool(
    server,
    "ncloud_sso_delete_assignment",
    "⚠️ Destructive: Permanently delete a Single Sign-On assignment (Government zone only). All users and groups targeted by it lose that account access. Set confirm=true to execute.",
    { assignmentId: z.string({ required_error: requiredError("assignmentId") }).describe("Assignment ID (UUID) to delete") },
    async (params) => client.requestRaw("DELETE", `${SSO_BASE}/assignments/${p(params.assignmentId)}`),
    { destructive: { noun: "SSO Assignment", describe: (x) => x.assignmentId } }
  );

  defineTool(
    server,
    "ncloud_sso_list_assignment_targets",
    "List the users or groups targeted by a Single Sign-On assignment (Government zone only), paginated. targetType is required.",
    {
      assignmentId: z.string({ required_error: requiredError("assignmentId") }).describe("Assignment ID (UUID)"),
      targetType: TARGET_TYPE.describe("USER or GROUP"),
      ...PAGINATION,
    },
    async (params) =>
      client.requestRaw("GET", `${SSO_BASE}/assignments/${p(params.assignmentId)}/targets`, {
        targetType: params.targetType,
        ...pageQuery(params),
      })
  );

  defineTool(
    server,
    "ncloud_sso_add_targets_to_assignment",
    "Add users or groups as targets of a Single Sign-On assignment (Government zone only), granting them the assignment's account access.",
    {
      assignmentId: z.string({ required_error: requiredError("assignmentId") }).describe("Assignment ID (UUID)"),
      targetType: TARGET_TYPE.describe("USER or GROUP — the kind of every ID in targetIds"),
      targetIds: idList("targetIds").describe("User IDs or group IDs (UUID), at least 1"),
    },
    async (params) =>
      client.requestRaw("POST", `${SSO_BASE}/assignments/${p(params.assignmentId)}/add-targets`, undefined, {
        targetType: params.targetType,
        targetIds: params.targetIds,
      })
  );

  defineTool(
    server,
    "ncloud_sso_remove_targets_from_assignment",
    "⚠️ Destructive: Remove users or groups from a Single Sign-On assignment (Government zone only); they lose the assignment's account access. Set confirm=true to execute.",
    {
      assignmentId: z.string({ required_error: requiredError("assignmentId") }).describe("Assignment ID (UUID)"),
      targetType: TARGET_TYPE.describe("USER or GROUP — the kind of every ID in targetIds"),
      targetIds: idList("targetIds").describe("User IDs or group IDs (UUID), at least 1"),
    },
    async (params) =>
      client.requestRaw("POST", `${SSO_BASE}/assignments/${p(params.assignmentId)}/remove-targets`, undefined, {
        targetType: params.targetType,
        targetIds: params.targetIds,
      }),
    { destructive: { message: (x) => `⚠️ This will remove ${x.targetType} target(s) [${(x.targetIds ?? []).join(", ")}] from SSO Assignment [${x.assignmentId}].\n\nTo execute, call this tool again with confirm=true.` } }
  );

  defineTool(
    server,
    "ncloud_sso_change_assignment_status",
    "Activate or deactivate a Single Sign-On assignment (Government zone only). A deactivated assignment grants no access but keeps its targets and settings.",
    {
      assignmentId: z.string({ required_error: requiredError("assignmentId") }).describe("Assignment ID (UUID)"),
      active: z.boolean({ required_error: requiredError("active") }).describe("true: activate, false: deactivate"),
    },
    async (params) =>
      client.requestRaw("POST", `${SSO_BASE}/assignments/${p(params.assignmentId)}/change-status`, undefined, { active: params.active })
  );

  defineTool(
    server,
    "ncloud_sso_list_organization_accounts",
    "List the organization member accounts that Single Sign-On assignments can target (Government zone only), paginated. Use the account member number as accountMemberNo in ncloud_sso_create_assignment.",
    { ...PAGINATION },
    async (params) => client.requestRaw("GET", `${SSO_BASE}/organization-accounts`, pageQuery(params))
  );

  defineTool(
    server,
    "ncloud_sso_list_assignment_ip_acls",
    "List the IP ACLs attached to a Single Sign-On assignment, per access type (console/API) (Government zone only).",
    {
      assignmentId: z.string({ required_error: requiredError("assignmentId") }).describe("Assignment ID (UUID)"),
      ...PAGINATION,
    },
    async (params) => client.requestRaw("GET", `${SSO_BASE}/assignments/${p(params.assignmentId)}/ip-acls`, pageQuery(params))
  );

  defineTool(
    server,
    "ncloud_sso_add_ip_acls_to_assignment",
    "Attach IP ACLs to a Single Sign-On assignment to restrict console and/or API access by source IP (Government zone only). At most 5 IP ACLs per assignment. consoleAccessAllowed/apiAccessAllowed are required and should match the assignment's current access types; the *Restricted flags turn IP restriction on/off for that access type.",
    {
      assignmentId: z.string({ required_error: requiredError("assignmentId") }).describe("Assignment ID (UUID)"),
      consoleAccessAllowed: z.boolean({ required_error: requiredError("consoleAccessAllowed") }).describe("Console access allowed for this assignment"),
      consoleAccessRestricted: z.boolean().nullable().optional().describe("Restrict console access to the attached IP ACLs (true/false, or null to leave unset)"),
      consoleAccessIpAclIds: z.array(z.string()).max(5).optional().describe("IP ACL IDs (UUID) to attach for console access"),
      apiAccessAllowed: z.boolean({ required_error: requiredError("apiAccessAllowed") }).describe("API access allowed for this assignment"),
      apiAccessRestricted: z.boolean().nullable().optional().describe("Restrict API access to the attached IP ACLs (true/false, or null to leave unset)"),
      apiAccessIpAclIds: z.array(z.string()).max(5).optional().describe("IP ACL IDs (UUID) to attach for API access"),
    },
    async (params) => {
      const { assignmentId, ...rest } = params;
      return client.requestRaw("POST", `${SSO_BASE}/assignments/${p(assignmentId)}/add-ip-acls`, undefined, compact(rest));
    }
  );

  defineTool(
    server,
    "ncloud_sso_remove_ip_acls_from_assignment",
    "⚠️ Destructive: Detach IP ACLs from a Single Sign-On assignment (Government zone only). Removing restrictions can widen the source IPs allowed to use the assignment. Set confirm=true to execute.",
    {
      assignmentId: z.string({ required_error: requiredError("assignmentId") }).describe("Assignment ID (UUID)"),
      consoleAccessIpAclIds: z.array(z.string()).optional().describe("IP ACL IDs (UUID) to detach from console access"),
      apiAccessIpAclIds: z.array(z.string()).optional().describe("IP ACL IDs (UUID) to detach from API access"),
    },
    async (params) => {
      const { assignmentId, ...rest } = params;
      if (!rest.consoleAccessIpAclIds?.length && !rest.apiAccessIpAclIds?.length) {
        return {
          content: [
            {
              type: "text" as const,
              text: L({
                ko: "consoleAccessIpAclIds 또는 apiAccessIpAclIds 중 하나 이상은 필수입니다.",
                en: "At least one of consoleAccessIpAclIds or apiAccessIpAclIds is required.",
              }),
            },
          ],
          isError: true,
        };
      }
      return client.requestRaw("POST", `${SSO_BASE}/assignments/${p(assignmentId)}/remove-ip-acls`, undefined, compact(rest));
    },
    { destructive: { message: (x) => `⚠️ This will detach IP ACL(s) [${[...(x.consoleAccessIpAclIds ?? []), ...(x.apiAccessIpAclIds ?? [])].join(", ")}] from SSO Assignment [${x.assignmentId}].\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── IP ACLs ──────────────────────────────────────────────────────────────

  const ACCESS_IPS = z
    .array(z.string().min(1), { required_error: requiredError("accessIps") })
    .min(1)
    .max(20)
    .describe('Allowed source IPs: 1-20 IPv4/IPv6 addresses or CIDR ranges, e.g. ["203.0.113.10", "198.51.100.0/24"]');

  defineTool(
    server,
    "ncloud_sso_list_ip_acls",
    "List Single Sign-On IP ACLs (Government zone only), paginated.",
    { ...PAGINATION },
    async (params) => client.requestRaw("GET", `${SSO_BASE}/ip-acls`, pageQuery(params))
  );

  defineTool(
    server,
    "ncloud_sso_get_ip_acl",
    "Get a Single Sign-On IP ACL by ID (Government zone only).",
    { ipAclId: z.string({ required_error: requiredError("ipAclId") }).describe("IP ACL ID (UUID)") },
    async (params) => client.requestRaw("GET", `${SSO_BASE}/ip-acls/${p(params.ipAclId)}`)
  );

  defineTool(
    server,
    "ncloud_sso_create_ip_acl",
    "Create a Single Sign-On IP ACL — a named list of allowed source IPs that can be attached to assignments (Government zone only). Use dryRun=true to preview.",
    {
      ipAclName: nameSchema("ipAclName").describe("IP ACL name: 2-30 chars, starts with a letter/digit, then letters, digits, '_' or '-'"),
      description: DESCRIPTION_SCHEMA.describe("Description (<=300 chars)"),
      accessIps: ACCESS_IPS,
      tags: TAGS_SCHEMA,
      dryRun: DRY_RUN,
    },
    async (params) => {
      const { dryRun, ...rest } = params;
      return send("POST", `${SSO_BASE}/ip-acls`, compact(rest), dryRun, { ko: "SSO IP ACL", en: "SSO IP ACL" }, "SSO IP ACL Creation");
    }
  );

  defineTool(
    server,
    "ncloud_sso_update_ip_acl",
    `Update a Single Sign-On IP ACL's name, description and IP list (Government zone only). ${FULL_REPLACE_NOTE} accessIps replaces the whole list and takes effect on every assignment the ACL is attached to. Use dryRun=true to preview.`,
    {
      ipAclId: z.string({ required_error: requiredError("ipAclId") }).describe("IP ACL ID (UUID)"),
      ipAclName: nameSchema("ipAclName").describe("IP ACL name (required; pass the current name to keep it)"),
      description: DESCRIPTION_SCHEMA.describe("Description (<=300 chars). Omit to clear"),
      accessIps: ACCESS_IPS,
      dryRun: DRY_RUN,
    },
    async (params) => {
      const { dryRun, ipAclId, ...rest } = params;
      return send("PUT", `${SSO_BASE}/ip-acls/${p(ipAclId)}`, compact(rest), dryRun, { ko: "SSO IP ACL 변경", en: "SSO IP ACL change" }, "SSO IP ACL Update", "apply");
    }
  );

  defineTool(
    server,
    "ncloud_sso_delete_ip_acl",
    "⚠️ Destructive: Permanently delete a Single Sign-On IP ACL (Government zone only). Fails with 409 ResourceInUse while it is attached to an assignment — detach it first with ncloud_sso_remove_ip_acls_from_assignment. Set confirm=true to execute.",
    { ipAclId: z.string({ required_error: requiredError("ipAclId") }).describe("IP ACL ID (UUID) to delete") },
    async (params) => client.requestRaw("DELETE", `${SSO_BASE}/ip-acls/${p(params.ipAclId)}`),
    { destructive: { noun: "SSO IP ACL", describe: (x) => x.ipAclId } }
  );
}
