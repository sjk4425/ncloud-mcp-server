import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { L, requiredError } from "./_messages.js";
import { dryRunPreview } from "./_dryrun.js";
import { withQuery } from "./_query.js";

/**
 * Sub Account API **v2** (공공존 전용, "Ncloud 표준 규격", 2026-10-22).
 *
 * 호스트는 v1과 같고(`https://subaccount.apigw.gov-ntruss.com`) 경로 접두만 `/api/v2`.
 * 공공존에서는 v1 모듈(governance-sub-account.ts)을 이 모듈로 대체한다 — 사용자가 보는
 * 도구 이름은 v1과 같게 유지하고 파라미터·경로만 v2 규격을 따른다.
 *
 * v1 대비 주요 차이(가이드 gov-iam-v2-* 페이지 기준):
 *  - 식별자는 전부 UUID(subAccountId·groupId·policyId·roleId). v1의 roleNo 대신 roleId.
 *  - 페이지네이션 pageNo(0~)/pageSize(1~100, 기본 20)/sort[]("property,(asc|desc)") — 검색어 필터 없음.
 *  - attach/detach 는 POST `.../attach-*` · `.../detach-*` + 바디 `{policyIds|groupIds|subAccountIds}` (원자 처리).
 *  - 액세스 키 상태 변경/삭제는 키가 경로에 들어간다(`/access-keys/{accessKey}`).
 *  - 정책 다건 삭제는 POST `/policies/batch-delete`, 검증은 POST `/policies/validate`.
 *  - 부분 수정은 PATCH(merge-patch) — null 은 "값 비우기".
 *  - 생성 비밀번호(generatedPassword)·시크릿 키(keySecret)는 응답에 1회만 실린다(v1과 동일하게 그대로 반환).
 */

const BASE = "/api/v2";

const enc = encodeURIComponent;

/** 태그 맵. 값 길이 1~256. */
const TAGS_SCHEMA = z
  .record(z.string())
  .optional()
  .describe('Tags as a key-value map (value 1-256 chars). Example: {"env":"dev","team":"a"}');

const PAGE_NO = z.number().int().min(0).optional().describe("Page number, 0-based (default 0)");
const PAGE_SIZE = z.number().int().min(1).max(100).optional().describe("Items per page, 1-100 (default 20)");
function sortSchema(props: string, dflt: string) {
  return z
    .array(z.string())
    .optional()
    .describe(`Sort conditions, each "property,(asc|desc)". Allowed properties: ${props}. Default: ${dflt}`);
}

/** 액세스 소스 제한 한 건(API Gateway 접근 허용 소스). */
const ALLOW_SOURCE_SCHEMA = z.object({
  type: z.enum(["IP", "VPC", "VPC_SERVER"]).describe("Source type — IP: IP address or CIDR, VPC: a VPC, VPC_SERVER: a VPC server instance"),
  source: z.string().describe("Source value — an IP/CIDR (e.g. 10.0.0.0/8) for IP, the VPC number for VPC, the server instance number for VPC_SERVER"),
});

/** 정책 권한 대상. */
const POLICY_TARGET_SCHEMA = z.object({
  product: z
    .string({ required_error: requiredError("product") })
    .describe("Service (product) code of the target service, e.g. IAM, Server, ObjectStorage"),
  actions: z
    .array(z.string())
    .min(1, { message: L({ ko: "actions는 최소 1개 이상이어야 합니다.", en: "actions must contain at least one entry." }) })
    .describe('Actions. Exact action names, "View*" (all read actions), "Change*" (all mutating actions) or "*"'),
  resourceNrns: z
    .array(z.string())
    .min(1, { message: L({ ko: "resourceNrns는 최소 1개 이상이어야 합니다.", en: "resourceNrns must contain at least one entry." }) })
    .describe('Target resource NRNs. Use ["*"] when not restricting to specific resources'),
});

/** 정책 권한(효과·대상·조건). v2는 Deny 를 지원한다. */
const POLICY_PERMISSION_SCHEMA = z.object({
  effect: z
    .enum(["Allow", "Deny"])
    .optional()
    .default("Allow")
    .describe('Permission effect: "Allow" or "Deny" (Deny wins when both apply to the same request). Defaults to "Allow" here; the API requires it, so it is always sent'),
  targets: z
    .array(POLICY_TARGET_SCHEMA)
    .min(1, { message: L({ ko: "targets는 최소 1개 이상이어야 합니다.", en: "targets must contain at least one entry." }) })
    .describe("Targets (product, actions, resource NRNs) this permission covers"),
  condition: z
    .record(z.record(z.union([z.string(), z.array(z.string())])))
    .optional()
    .describe('Optional condition as {operator: {conditionKey: value | [values]}}. Example: {"StringEquals": {"ncp:resourceTag/env": "beta"}, "DateGreaterThan": {"ncp:currentTime": "2026-01-01T00:00:00Z"}}. Unsupported operators are rejected with 400 iam.policy.invalidConditionSyntax'),
});

const PERMISSIONS_SCHEMA = z
  .array(POLICY_PERMISSION_SCHEMA)
  .min(1, { message: L({ ko: "permissions는 최소 1개 이상이어야 합니다.", en: "permissions must contain at least one entry." }) });

const SUB_ACCOUNT_ID = z.string({ required_error: requiredError("subAccountId") }).describe("Sub account ID (UUID, see ncloud_list_sub_accounts)");
const GROUP_ID = z.string({ required_error: requiredError("groupId") }).describe("Group ID (UUID, see ncloud_list_groups)");
const POLICY_ID = z.string({ required_error: requiredError("policyId") }).describe("Policy ID (UUID, see ncloud_list_policies)");
const ROLE_ID = z.string({ required_error: requiredError("roleId") }).describe("Role ID (UUID, see ncloud_list_roles)");
const ACCESS_KEY = z
  .string({ required_error: requiredError("accessKey") })
  .regex(/^(ncp_iam_[A-Za-z0-9_]{20}|[A-Za-z0-9]{20})$/, "accessKey must be a 28-char ncp_iam_ key or a legacy 20-char alphanumeric key")
  .describe("Access key (28-char ncp_iam_… or legacy 20-char alphanumeric; see ncloud_list_sub_account_access_keys)");

/** 실패 응답(isError) 텍스트. */
function errorText(ko: string, en: string) {
  return { content: [{ type: "text" as const, text: L({ ko, en }) }], isError: true };
}

/**
 * ID 목록 입력 정규화. v2 필드명(primary) + v1 하위호환 별칭(policyIdList/policyId 등)을 합치고
 * 공백 제거·중복 제거한다. 결과가 비었거나 max 초과면 에러 응답을 돌려준다.
 */
function resolveIds(
  field: string,
  max: number,
  ...sources: Array<string[] | string | undefined>
): { ids: string[] } | { error: ReturnType<typeof errorText> } {
  const merged: string[] = [];
  for (const s of sources) {
    if (s === undefined) continue;
    if (Array.isArray(s)) merged.push(...s);
    else merged.push(s);
  }
  const ids = [...new Set(merged.map((x) => x.trim()).filter((x) => x !== ""))];
  if (ids.length === 0) {
    return { error: errorText(`${field}는 최소 1개 이상이어야 합니다.`, `${field} must contain at least one ID.`) };
  }
  if (ids.length > max) {
    return { error: errorText(`${field}는 최대 ${max}개까지 지정할 수 있습니다(현재 ${ids.length}개).`, `${field} accepts at most ${max} IDs (got ${ids.length}).`) };
  }
  return { ids };
}

/** 정책 ID 입력(v2 policyIds + v1 별칭). */
const POLICY_IDS_INPUT = {
  policyIds: z.array(z.string()).optional().describe("Policy IDs (UUIDs), 1-10, no duplicates"),
  policyIdList: z.array(z.string()).optional().describe("Alias of policyIds kept for v1 compatibility; merged into policyIds"),
  policyId: z.string().optional().describe("Single policy ID; merged into policyIds (v1 compatibility)"),
};

export function registerSubAccountV2Tools(server: McpServer, client: NcloudClient): void {
  // ─── Sub Account ───────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_sub_accounts",
    "List sub accounts (IAM users) — summary fields only (ID, loginId, name, console/API access, active, created/last login, NRN). Use ncloud_get_sub_account_detail for email, memo, access rules, groups and policies.",
    {
      pageNo: PAGE_NO,
      pageSize: PAGE_SIZE,
      sort: sortSchema("loginId, name, createdDateTime", '["createdDateTime,desc"]'),
    },
    async (params) => {
      return client.requestRaw("GET", withQuery(`${BASE}/sub-accounts`, { pageNo: params.pageNo, pageSize: params.pageSize, sort: params.sort }));
    }
  );

  defineTool(
    server,
    "ncloud_get_sub_account_detail",
    "Get a sub account's details, including its assigned groups and policies, access settings and memo.",
    { subAccountId: SUB_ACCOUNT_ID },
    async (params) => client.requestRaw("GET", `${BASE}/sub-accounts/${enc(params.subAccountId)}`)
  );

  defineTool(
    server,
    "ncloud_create_sub_account",
    "Create a new sub account (IAM user). Either give password, or set passwordGenerationRequired=true to have one generated — a generated password (generatedPassword) is returned ONLY in this response and cannot be retrieved later, so store it securely and do not paste it into shared logs. In the government zone the user is always asked to change the password at first login. Use dryRun=true to preview without creating.",
    {
      loginId: z.string({ required_error: requiredError("loginId") }).min(3).max(60).describe("Login ID, unique in the account (3-60 chars)"),
      name: z.string({ required_error: requiredError("name") }).describe("Display name (2-30 chars after trimming)"),
      apiGatewayAccessible: z.boolean({ required_error: requiredError("apiGatewayAccessible") }).describe("Allow API Gateway access (needed to issue access keys)"),
      consoleAccessible: z.boolean({ required_error: requiredError("consoleAccessible") }).describe("Allow management console access"),
      email: z.string().optional().describe("Email address"),
      password: z.string().optional().describe("Initial password. Required unless passwordGenerationRequired=true (ignored when it is true)"),
      passwordGenerationRequired: z.boolean().optional().describe("true: generate a random password, returned once in the response (default false)"),
      consolePermitIpEnabled: z.boolean().optional().describe("Restrict console access to consolePermitIpAddresses (default false)"),
      consolePermitIpAddresses: z.array(z.string()).max(100).optional().describe("Allowed console IPs/CIDRs (IPv4/IPv6), 0-100. Required when consolePermitIpEnabled=true"),
      apiAllowSourceEnabled: z.boolean().optional().describe("Restrict access-key API calls to apiAllowSources (default false)"),
      apiAllowSources: z.array(ALLOW_SOURCE_SCHEMA).optional().describe("Allowed API sources. Required when apiAllowSourceEnabled=true"),
      memo: z.string().max(300).optional().describe("Memo (0-300 chars)"),
      tags: TAGS_SCHEMA,
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the sub account"),
    },
    async (params) => {
      const { dryRun, ...body } = params;
      if (!body.passwordGenerationRequired && !body.password) {
        return errorText(
          "passwordGenerationRequired가 true가 아니면 password는 필수입니다.",
          "password is required unless passwordGenerationRequired is true."
        );
      }
      if (body.consolePermitIpEnabled && !(body.consolePermitIpAddresses && body.consolePermitIpAddresses.length > 0)) {
        return errorText(
          "consolePermitIpEnabled가 true이면 consolePermitIpAddresses를 1개 이상 지정해야 합니다.",
          "consolePermitIpAddresses must list at least one entry when consolePermitIpEnabled is true."
        );
      }
      if (body.apiAllowSourceEnabled && !(body.apiAllowSources && body.apiAllowSources.length > 0)) {
        return errorText(
          "apiAllowSourceEnabled가 true이면 apiAllowSources를 1개 이상 지정해야 합니다.",
          "apiAllowSources must list at least one entry when apiAllowSourceEnabled is true."
        );
      }
      const endpoint = `${BASE}/sub-accounts`;
      if (dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: Sub Account Creation",
          endpoint,
          method: "POST",
          requestParams: body,
          noun: { ko: "서브 계정", en: "sub account" },
        });
      }
      return client.requestRaw("POST", endpoint, undefined, body);
    }
  );

  defineTool(
    server,
    "ncloud_update_sub_account",
    "Partially update a sub account (PATCH, merge-patch): only the fields you pass change. Pass null for email or memo to clear it (clearing email also resets its verification state). Use active=false to disable the account without deleting it. Access rules are changed with ncloud_update_sub_account_api_access_rule / ncloud_update_sub_account_console_access_rule.",
    {
      subAccountId: SUB_ACCOUNT_ID,
      name: z.string().optional().describe("Display name (2-30 chars after trimming)"),
      email: z.string().nullable().optional().describe("Email address; null clears it"),
      apiGatewayAccessible: z.boolean().optional().describe("Allow API Gateway access"),
      consoleAccessible: z.boolean().optional().describe("Allow management console access"),
      passwordResetRequired: z.boolean().optional().describe("Ask the user to change the password at next login"),
      memo: z.string().max(300).nullable().optional().describe("Memo (0-300 chars); null clears it"),
      active: z.boolean().optional().describe("true: activate, false: deactivate (deactivated accounts cannot sign in or call the API)"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without updating"),
    },
    async (params) => {
      const { subAccountId, dryRun, ...rest } = params;
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) if (v !== undefined) body[k] = v;
      if (Object.keys(body).length === 0) {
        return errorText("변경할 필드를 1개 이상 지정하세요.", "Specify at least one field to update.");
      }
      const endpoint = `${BASE}/sub-accounts/${enc(subAccountId)}`;
      if (dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: Sub Account Update",
          endpoint,
          method: "PATCH",
          requestParams: body,
          noun: { ko: "서브 계정", en: "sub account" },
          verb: "apply",
        });
      }
      return client.requestRaw("PATCH", endpoint, undefined, body);
    }
  );

  defineTool(
    server,
    "ncloud_delete_sub_account",
    "⚠️ Destructive: Permanently delete a sub account. All its permissions and access are revoked. If the account still has access keys the API returns 409 unless cascading=true, which deletes those keys too. Set confirm=true to execute.",
    {
      subAccountId: SUB_ACCOUNT_ID,
      cascading: z.boolean().optional().describe("true: also delete the account's remaining access keys. false/omitted: fail with 409 if any access key remains"),
    },
    async (params) => {
      const q: Record<string, boolean | undefined> = {};
      if (params.cascading !== undefined) q.cascading = params.cascading;
      return client.requestRaw("DELETE", withQuery(`${BASE}/sub-accounts/${enc(params.subAccountId)}`, q));
    },
    {
      destructive: {
        message: (p) =>
          `⚠️ This will permanently delete Sub Account [${p.subAccountId}]${p.cascading ? " together with its remaining access keys" : ""}. All associated permissions and access will be revoked.\n\nTo execute, call this tool again with confirm=true.`,
      },
    }
  );

  defineTool(
    server,
    "ncloud_reset_sub_account_password",
    "Reset a sub account's console password. Either give newPassword, or set passwordGenerationRequired=true to have one generated — a generated password (generatedPassword) is returned ONLY in this response, so store it securely and do not paste it into shared logs.",
    {
      subAccountId: SUB_ACCOUNT_ID,
      newPassword: z.string().optional().describe("New password. Required unless passwordGenerationRequired=true"),
      passwordGenerationRequired: z.boolean().optional().describe("true: generate a random password, returned once in the response (default false)"),
    },
    async (params) => {
      if (!params.passwordGenerationRequired && !params.newPassword) {
        return errorText(
          "passwordGenerationRequired가 true가 아니면 newPassword는 필수입니다.",
          "newPassword is required unless passwordGenerationRequired is true."
        );
      }
      const body: Record<string, unknown> = {};
      if (params.newPassword !== undefined) body.newPassword = params.newPassword;
      if (params.passwordGenerationRequired !== undefined) body.passwordGenerationRequired = params.passwordGenerationRequired;
      return client.requestRaw("POST", `${BASE}/sub-accounts/${enc(params.subAccountId)}/reset-password`, undefined, body);
    },
    { annotations: { destructiveHint: false, idempotentHint: false } }
  );

  // ─── Sub Account access rules ──────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_get_sub_account_api_access_rule",
    "Get a sub account's API access-source restriction (apiAllowSourceEnabled and the allowed IP/VPC/VPC_SERVER sources).",
    { subAccountId: SUB_ACCOUNT_ID },
    async (params) => client.requestRaw("GET", `${BASE}/sub-accounts/${enc(params.subAccountId)}/api-access-rule`)
  );

  defineTool(
    server,
    "ncloud_update_sub_account_api_access_rule",
    "Replace a sub account's API access-source restriction. apiAllowSources REPLACES the whole existing list — read the current one with ncloud_get_sub_account_api_access_rule first. Use dryRun=true to preview.",
    {
      subAccountId: SUB_ACCOUNT_ID,
      apiAllowSourceEnabled: z.boolean({ required_error: requiredError("apiAllowSourceEnabled") }).describe("true: only apiAllowSources may use this account's access keys; false: no restriction"),
      apiAllowSources: z.array(ALLOW_SOURCE_SCHEMA).optional().describe("Full replacement list of allowed sources. Required when apiAllowSourceEnabled=true"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without updating"),
    },
    async (params) => {
      if (params.apiAllowSourceEnabled && !(params.apiAllowSources && params.apiAllowSources.length > 0)) {
        return errorText(
          "apiAllowSourceEnabled가 true이면 apiAllowSources를 1개 이상 지정해야 합니다.",
          "apiAllowSources must list at least one entry when apiAllowSourceEnabled is true."
        );
      }
      const body: Record<string, unknown> = { apiAllowSourceEnabled: params.apiAllowSourceEnabled };
      if (params.apiAllowSources !== undefined) body.apiAllowSources = params.apiAllowSources;
      const endpoint = `${BASE}/sub-accounts/${enc(params.subAccountId)}/api-access-rule`;
      if (params.dryRun) {
        return dryRunPreview({ label: "🔍 Dry-Run Preview: API Access Rule Update", endpoint, method: "PUT", requestParams: body, noun: { ko: "API 접근 규칙", en: "API access rule" }, verb: "apply" });
      }
      return client.requestRaw("PUT", endpoint, undefined, body);
    }
  );

  defineTool(
    server,
    "ncloud_get_sub_account_console_access_rule",
    "Get a sub account's console IP restriction (consolePermitIpEnabled and the allowed IP ranges).",
    { subAccountId: SUB_ACCOUNT_ID },
    async (params) => client.requestRaw("GET", `${BASE}/sub-accounts/${enc(params.subAccountId)}/console-access-rule`)
  );

  defineTool(
    server,
    "ncloud_update_sub_account_console_access_rule",
    "Replace a sub account's console IP restriction. consolePermitIpAddresses REPLACES the whole existing list — read the current one with ncloud_get_sub_account_console_access_rule first. Use dryRun=true to preview.",
    {
      subAccountId: SUB_ACCOUNT_ID,
      consolePermitIpEnabled: z.boolean({ required_error: requiredError("consolePermitIpEnabled") }).describe("true: console sign-in only from consolePermitIpAddresses; false: no restriction"),
      consolePermitIpAddresses: z.array(z.string()).max(100).optional().describe("Full replacement list of allowed IPs/CIDRs (IPv4/IPv6), 0-100. Required when consolePermitIpEnabled=true"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without updating"),
    },
    async (params) => {
      if (params.consolePermitIpEnabled && !(params.consolePermitIpAddresses && params.consolePermitIpAddresses.length > 0)) {
        return errorText(
          "consolePermitIpEnabled가 true이면 consolePermitIpAddresses를 1개 이상 지정해야 합니다.",
          "consolePermitIpAddresses must list at least one entry when consolePermitIpEnabled is true."
        );
      }
      const body: Record<string, unknown> = { consolePermitIpEnabled: params.consolePermitIpEnabled };
      if (params.consolePermitIpAddresses !== undefined) body.consolePermitIpAddresses = params.consolePermitIpAddresses;
      const endpoint = `${BASE}/sub-accounts/${enc(params.subAccountId)}/console-access-rule`;
      if (params.dryRun) {
        return dryRunPreview({ label: "🔍 Dry-Run Preview: Console Access Rule Update", endpoint, method: "PUT", requestParams: body, noun: { ko: "콘솔 접근 규칙", en: "console access rule" }, verb: "apply" });
      }
      return client.requestRaw("PUT", endpoint, undefined, body);
    }
  );

  // ─── Sub Account access keys ───────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_sub_account_access_keys",
    "List the API access keys of a sub account with each key's active state and creation time. Secret keys are never returned here — a secret is only shown once, in the ncloud_create_sub_account_access_key response.",
    { subAccountId: SUB_ACCOUNT_ID },
    async (params) => client.requestRaw("GET", `${BASE}/sub-accounts/${enc(params.subAccountId)}/access-keys`)
  );

  defineTool(
    server,
    "ncloud_create_sub_account_access_key",
    "Issue a new API access key for a sub account. The response contains the secret key (keySecret) and it CANNOT be retrieved again — store it securely and do not paste it into shared logs or chats. Requires apiGatewayAccessible=true on the sub account (otherwise 409). At most TWO active keys per sub account (a third fails with 400 LimitExceeded) — delete or deactivate one first when rotating.",
    { subAccountId: SUB_ACCOUNT_ID },
    async (params) => client.requestRaw("POST", `${BASE}/sub-accounts/${enc(params.subAccountId)}/access-keys`)
  );

  defineTool(
    server,
    "ncloud_set_sub_account_access_key_status",
    "Activate or deactivate a sub account's API access key. A deactivated key cannot call the API but is kept and can be re-activated.",
    {
      subAccountId: SUB_ACCOUNT_ID,
      accessKey: ACCESS_KEY,
      active: z.boolean({ required_error: requiredError("active") }).describe("true: activate, false: deactivate"),
    },
    async (params) =>
      client.requestRaw(
        "POST",
        `${BASE}/sub-accounts/${enc(params.subAccountId)}/access-keys/${enc(params.accessKey)}/change-status`,
        undefined,
        { active: params.active }
      )
  );

  defineTool(
    server,
    "ncloud_delete_sub_account_access_key",
    "⚠️ Destructive: Permanently delete a sub account's API access key. Clients still using it fail immediately and it cannot be restored — to disable temporarily use ncloud_set_sub_account_access_key_status. Set confirm=true to execute.",
    { subAccountId: SUB_ACCOUNT_ID, accessKey: ACCESS_KEY },
    async (params) =>
      client.requestRaw("DELETE", `${BASE}/sub-accounts/${enc(params.subAccountId)}/access-keys/${enc(params.accessKey)}`),
    {
      destructive: {
        message: (p) =>
          `⚠️ This will permanently delete access key [${p.accessKey}] of sub account [${p.subAccountId}]. Clients using this key will fail immediately and the key cannot be restored.\n\nTo execute, call this tool again with confirm=true.`,
      },
    }
  );

  // ─── Sub Account ↔ policies / groups ───────────────────────────────────────

  defineTool(
    server,
    "ncloud_attach_policy_to_sub_account",
    "Attach IAM policies (1-10) to a sub account. Atomic: if any policy fails, nothing is attached and per-item reasons are returned.",
    { subAccountId: SUB_ACCOUNT_ID, ...POLICY_IDS_INPUT },
    async (params) => {
      const r = resolveIds("policyIds", 10, params.policyIds, params.policyIdList, params.policyId);
      if ("error" in r) return r.error;
      return client.requestRaw("POST", `${BASE}/sub-accounts/${enc(params.subAccountId)}/attach-policies`, undefined, { policyIds: r.ids });
    }
  );

  defineTool(
    server,
    "ncloud_detach_policy_from_sub_account",
    "⚠️ Destructive: Detach IAM policies (1-10) from a sub account; it loses those permissions immediately. Atomic. Set confirm=true to execute.",
    { subAccountId: SUB_ACCOUNT_ID, ...POLICY_IDS_INPUT },
    async (params) => {
      const r = resolveIds("policyIds", 10, params.policyIds, params.policyIdList, params.policyId);
      if ("error" in r) return r.error;
      return client.requestRaw("POST", `${BASE}/sub-accounts/${enc(params.subAccountId)}/detach-policies`, undefined, { policyIds: r.ids });
    },
    {
      destructive: {
        message: (p) =>
          `⚠️ This will detach policies [${[...(p.policyIds ?? []), ...(p.policyIdList ?? []), ...(p.policyId ? [p.policyId] : [])].join(", ")}] from sub account [${p.subAccountId}].\n\nTo execute, call this tool again with confirm=true.`,
      },
    }
  );

  defineTool(
    server,
    "ncloud_attach_groups_to_sub_account",
    "Add a sub account to IAM groups (1-10). Atomic: if any group fails, nothing changes and per-item reasons are returned.",
    {
      subAccountId: SUB_ACCOUNT_ID,
      groupIds: z.array(z.string()).describe("Group IDs (UUIDs), 1-10, no duplicates"),
    },
    async (params) => {
      const r = resolveIds("groupIds", 10, params.groupIds);
      if ("error" in r) return r.error;
      return client.requestRaw("POST", `${BASE}/sub-accounts/${enc(params.subAccountId)}/attach-groups`, undefined, { groupIds: r.ids });
    }
  );

  defineTool(
    server,
    "ncloud_detach_groups_from_sub_account",
    "⚠️ Destructive: Remove a sub account from IAM groups (1-10); it loses the group-based permissions immediately. Atomic. Set confirm=true to execute.",
    {
      subAccountId: SUB_ACCOUNT_ID,
      groupIds: z.array(z.string()).describe("Group IDs (UUIDs), 1-10, no duplicates"),
    },
    async (params) => {
      const r = resolveIds("groupIds", 10, params.groupIds);
      if ("error" in r) return r.error;
      return client.requestRaw("POST", `${BASE}/sub-accounts/${enc(params.subAccountId)}/detach-groups`, undefined, { groupIds: r.ids });
    },
    {
      destructive: {
        message: (p) =>
          `⚠️ This will remove sub account [${p.subAccountId}] from groups [${(p.groupIds ?? []).join(", ")}].\n\nTo execute, call this tool again with confirm=true.`,
      },
    }
  );

  // ─── Login alias ───────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_get_login_alias",
    "Get the sub-account login alias (the account-level alias used in the sub-account console sign-in URL).",
    {},
    async () => client.requestRaw("GET", `${BASE}/login-alias`)
  );

  defineTool(
    server,
    "ncloud_set_login_alias",
    "Set the sub-account login alias (3-20 chars of lowercase letters and digits, unique across tenants). Sub accounts sign in through this alias. Pass null to delete the alias.",
    {
      loginAlias: z
        .string()
        .regex(/^[a-z0-9]{3,20}$/, "loginAlias must be 3-20 chars of lowercase letters and digits")
        .nullable()
        .describe("Login alias (3-20 chars, lowercase letters and digits), or null to delete it"),
    },
    async (params) => client.requestRaw("PATCH", `${BASE}/login-alias`, undefined, { loginAlias: params.loginAlias })
  );

  // ─── Group ─────────────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_groups",
    "List IAM groups used to manage sub account permissions.",
    {
      pageNo: PAGE_NO,
      pageSize: PAGE_SIZE,
      sort: sortSchema("groupName, createdDateTime, updatedDateTime", '["createdDateTime,desc"]'),
    },
    async (params) =>
      client.requestRaw("GET", withQuery(`${BASE}/groups`, { pageNo: params.pageNo, pageSize: params.pageSize, sort: params.sort }))
  );

  defineTool(
    server,
    "ncloud_get_group_detail",
    "Get an IAM group's details, including its member sub accounts and attached policies.",
    { groupId: GROUP_ID },
    async (params) => client.requestRaw("GET", `${BASE}/groups/${enc(params.groupId)}`)
  );

  defineTool(
    server,
    "ncloud_create_group",
    "Create a new IAM group. Groups have no description field — use tags to annotate. Use dryRun=true to preview without creating.",
    {
      groupName: z.string({ required_error: requiredError("groupName") }).min(3).max(30).describe("Group name (3-30 chars)"),
      tags: TAGS_SCHEMA,
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the group"),
    },
    async (params) => {
      const body: Record<string, unknown> = { groupName: params.groupName };
      if (params.tags !== undefined) body.tags = params.tags;
      const endpoint = `${BASE}/groups`;
      if (params.dryRun) {
        return dryRunPreview({ label: "🔍 Dry-Run Preview: IAM Group Creation", endpoint, method: "POST", requestParams: body, noun: { ko: "그룹", en: "group" } });
      }
      return client.requestRaw("POST", endpoint, undefined, body);
    }
  );

  defineTool(
    server,
    "ncloud_update_group",
    "Rename an IAM group (PATCH).",
    {
      groupId: GROUP_ID,
      groupName: z.string({ required_error: requiredError("groupName") }).min(3).max(30).describe("New group name (3-30 chars)"),
    },
    async (params) => client.requestRaw("PATCH", `${BASE}/groups/${enc(params.groupId)}`, undefined, { groupName: params.groupName })
  );

  defineTool(
    server,
    "ncloud_delete_group",
    "⚠️ Destructive: Permanently delete an IAM group. Its members lose the group-based permissions. Set confirm=true to execute.",
    { groupId: GROUP_ID },
    async (params) => client.requestRaw("DELETE", `${BASE}/groups/${enc(params.groupId)}`),
    {
      destructive: {
        message: (p) => `⚠️ This will permanently delete IAM Group [${p.groupId}]. All members will lose group-based permissions.\n\nTo execute, call this tool again with confirm=true.`,
      },
    }
  );

  defineTool(
    server,
    "ncloud_attach_policy_to_group",
    "Attach IAM policies (1-10) to a group. Atomic: if any policy fails, nothing is attached.",
    { groupId: GROUP_ID, ...POLICY_IDS_INPUT },
    async (params) => {
      const r = resolveIds("policyIds", 10, params.policyIds, params.policyIdList, params.policyId);
      if ("error" in r) return r.error;
      return client.requestRaw("POST", `${BASE}/groups/${enc(params.groupId)}/attach-policies`, undefined, { policyIds: r.ids });
    }
  );

  defineTool(
    server,
    "ncloud_detach_policy_from_group",
    "⚠️ Destructive: Detach IAM policies (1-10) from a group; its members lose those permissions immediately. Atomic. Set confirm=true to execute.",
    { groupId: GROUP_ID, ...POLICY_IDS_INPUT },
    async (params) => {
      const r = resolveIds("policyIds", 10, params.policyIds, params.policyIdList, params.policyId);
      if ("error" in r) return r.error;
      return client.requestRaw("POST", `${BASE}/groups/${enc(params.groupId)}/detach-policies`, undefined, { policyIds: r.ids });
    },
    {
      destructive: {
        message: (p) =>
          `⚠️ This will detach policies [${[...(p.policyIds ?? []), ...(p.policyIdList ?? []), ...(p.policyId ? [p.policyId] : [])].join(", ")}] from group [${p.groupId}].\n\nTo execute, call this tool again with confirm=true.`,
      },
    }
  );

  defineTool(
    server,
    "ncloud_attach_sub_accounts_to_group",
    "Add sub accounts (1-100) to an IAM group. Atomic: if any sub account fails, nothing changes.",
    {
      groupId: GROUP_ID,
      subAccountIds: z.array(z.string()).describe("Sub account IDs (UUIDs), 1-100, no duplicates"),
    },
    async (params) => {
      const r = resolveIds("subAccountIds", 100, params.subAccountIds);
      if ("error" in r) return r.error;
      return client.requestRaw("POST", `${BASE}/groups/${enc(params.groupId)}/attach-sub-accounts`, undefined, { subAccountIds: r.ids });
    }
  );

  defineTool(
    server,
    "ncloud_detach_sub_accounts_from_group",
    "⚠️ Destructive: Remove sub accounts (1-100) from an IAM group; they lose the group-based permissions immediately. Atomic. Set confirm=true to execute.",
    {
      groupId: GROUP_ID,
      subAccountIds: z.array(z.string()).describe("Sub account IDs (UUIDs), 1-100, no duplicates"),
    },
    async (params) => {
      const r = resolveIds("subAccountIds", 100, params.subAccountIds);
      if ("error" in r) return r.error;
      return client.requestRaw("POST", `${BASE}/groups/${enc(params.groupId)}/detach-sub-accounts`, undefined, { subAccountIds: r.ids });
    },
    {
      destructive: {
        message: (p) =>
          `⚠️ This will remove sub accounts [${(p.subAccountIds ?? []).join(", ")}] from group [${p.groupId}].\n\nTo execute, call this tool again with confirm=true.`,
      },
    }
  );

  // ─── Policy ────────────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_policies",
    "List IAM policies (system-managed and user-created).",
    {
      pageNo: PAGE_NO,
      pageSize: PAGE_SIZE,
      policyType: z.enum(["SYSTEM_MANAGED", "USER_CREATED"]).optional().describe("Filter by policy type"),
      sort: sortSchema("policyName, createdDateTime, updatedDateTime", '["createdDateTime,desc"]'),
    },
    async (params) =>
      client.requestRaw(
        "GET",
        withQuery(`${BASE}/policies`, { pageNo: params.pageNo, pageSize: params.pageSize, policyType: params.policyType, sort: params.sort })
      )
  );

  defineTool(
    server,
    "ncloud_get_policy_detail",
    "Get a policy's details including its permission statements (effect, product, actions, resource NRNs, conditions).",
    {
      policyId: POLICY_ID,
      withPermissions: z.boolean().optional().default(true).describe("Include the permission statements. Defaults to true here (the API itself defaults to false)"),
    },
    async (params) =>
      client.requestRaw("GET", withQuery(`${BASE}/policies/${enc(params.policyId)}`, { withPermissions: params.withPermissions }))
  );

  defineTool(
    server,
    "ncloud_get_policy_resources",
    "List the resources (sub accounts, groups, roles) a policy is attached to. Use before deleting or editing a policy to see who is affected.",
    {
      policyId: POLICY_ID,
      pageNo: PAGE_NO,
      pageSize: PAGE_SIZE,
      sort: sortSchema("resourceName, resourceType", '["resourceName,asc"]'),
    },
    async (params) =>
      client.requestRaw(
        "GET",
        withQuery(`${BASE}/policies/${enc(params.policyId)}/resources`, { pageNo: params.pageNo, pageSize: params.pageSize, sort: params.sort })
      )
  );

  defineTool(
    server,
    "ncloud_validate_policy",
    "Validate a user-created policy definition on the SERVER before creating it (calls the real validation API; nothing is created). Unlike dryRun, this catches invalid products, actions, NRNs and conditions.",
    {
      policyName: z.string({ required_error: requiredError("policyName") }).min(3).max(30).describe("Policy name (3-30 chars)"),
      permissions: PERMISSIONS_SCHEMA.describe("Permission statements to validate"),
      description: z.string().max(300).optional().describe("Description (up to 300 chars)"),
      tags: TAGS_SCHEMA,
    },
    async (params) => {
      const body: Record<string, unknown> = { policyName: params.policyName, permissions: params.permissions };
      if (params.description !== undefined) body.description = params.description;
      if (params.tags !== undefined) body.tags = params.tags;
      return client.requestRaw("POST", `${BASE}/policies/validate`, undefined, body);
    },
    { annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } }
  );

  defineTool(
    server,
    "ncloud_create_policy",
    "Create a user-created (custom) IAM policy with explicit Allow/Deny permission statements, to scope access to specific actions and resources. Use ncloud_validate_policy first for real server-side validation; dryRun=true only echoes the request.",
    {
      policyName: z.string({ required_error: requiredError("policyName") }).min(3).max(30).describe("Policy name (3-30 chars)"),
      permissions: PERMISSIONS_SCHEMA.describe("Permission statements: each allows or denies a set of actions on resource NRNs of one or more services"),
      description: z.string().max(300).optional().describe("Description (up to 300 chars)"),
      tags: TAGS_SCHEMA,
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the policy"),
    },
    async (params) => {
      const body: Record<string, unknown> = { policyName: params.policyName, permissions: params.permissions };
      if (params.description !== undefined) body.description = params.description;
      if (params.tags !== undefined) body.tags = params.tags;
      const endpoint = `${BASE}/policies`;
      if (params.dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: IAM Policy Creation",
          endpoint,
          method: "POST",
          requestParams: body,
          noun: { ko: "정책", en: "policy" },
          notes: {
            hint: L({
              ko: "서버측 유효성 검증이 필요하면 ncloud_validate_policy를 호출하세요(실제 검증 API).",
              en: "For real server-side validation, call ncloud_validate_policy (the actual validation API).",
            }),
          },
        });
      }
      return client.requestRaw("POST", endpoint, undefined, body);
    }
  );

  defineTool(
    server,
    "ncloud_update_policy",
    "Update a user-created IAM policy (PUT, full replacement). permissions REPLACES all existing statements, and an omitted description CLEARS the current description — read the policy with ncloud_get_policy_detail first and send the complete desired state. The policy name cannot be changed; system-managed policies cannot be updated.",
    {
      policyId: POLICY_ID,
      permissions: PERMISSIONS_SCHEMA.describe("Full replacement set of permission statements"),
      description: z.string().max(300).optional().describe("Description (up to 300 chars). If omitted, the existing description is cleared"),
    },
    async (params) => {
      const body: Record<string, unknown> = { permissions: params.permissions };
      if (params.description !== undefined) body.description = params.description;
      return client.requestRaw("PUT", `${BASE}/policies/${enc(params.policyId)}`, undefined, body);
    }
  );

  defineTool(
    server,
    "ncloud_delete_policy",
    "⚠️ Destructive: Permanently delete a user-created IAM policy. Every sub account, group and role it is attached to loses those permissions immediately — check ncloud_get_policy_resources first. System-managed policies cannot be deleted. Set confirm=true to execute.",
    { policyId: POLICY_ID },
    async (params) => client.requestRaw("DELETE", `${BASE}/policies/${enc(params.policyId)}`),
    { destructive: { noun: "IAM Policy", describe: (p) => p.policyId } }
  );

  defineTool(
    server,
    "ncloud_delete_policies",
    "⚠️ Destructive: Permanently delete several user-created IAM policies (1-100) at once. Atomic: if any policy cannot be deleted, none are and per-item reasons are returned. Every sub account, group and role they are attached to loses those permissions. Set confirm=true to execute.",
    {
      policyIds: z.array(z.string()).optional().describe("Policy IDs (UUIDs) to delete, 1-100, no duplicates"),
      policyIdList: z.array(z.string()).optional().describe("Alias of policyIds kept for v1 compatibility; merged into policyIds"),
    },
    async (params) => {
      const r = resolveIds("policyIds", 100, params.policyIds, params.policyIdList);
      if ("error" in r) return r.error;
      return client.requestRaw("POST", `${BASE}/policies/batch-delete`, undefined, { policyIds: r.ids });
    },
    {
      destructive: {
        message: (p) => {
          const ids = [...(p.policyIds ?? []), ...(p.policyIdList ?? [])];
          return `⚠️ This will permanently delete ${ids.length} IAM policies [${ids.join(", ")}]. Every sub account, group and role they are attached to loses those permissions.\n\nTo execute, call this tool again with confirm=true.`;
        },
      },
    }
  );

  // ─── Role ──────────────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_roles",
    "List IAM roles.",
    {
      pageNo: PAGE_NO,
      pageSize: PAGE_SIZE,
      sort: sortSchema("roleType, roleName, createdDateTime, updatedDateTime, lastUsedDateTime", '["createdDateTime,desc", "roleName,asc", "roleType,asc"]'),
    },
    async (params) =>
      client.requestRaw("GET", withQuery(`${BASE}/roles`, { pageNo: params.pageNo, pageSize: params.pageSize, sort: params.sort }))
  );

  defineTool(
    server,
    "ncloud_get_role_detail",
    "Get an IAM role's details, including its attached policies and entities.",
    { roleId: ROLE_ID },
    async (params) => client.requestRaw("GET", `${BASE}/roles/${enc(params.roleId)}`)
  );

  defineTool(
    server,
    "ncloud_create_role",
    "Create a new IAM role. A role grants nothing until policies are attached (ncloud_attach_policy_to_role) and a target is set — ncloud_attach_role_entities for Server/Service roles, ncloud_attach_role_account for Account roles. sessionExpirationSeconds is required for Account roles and rejected for other types. Use dryRun=true to preview without creating.",
    {
      roleName: z.string({ required_error: requiredError("roleName") }).min(3).max(100).describe("Role name (3-100 chars)"),
      roleType: z
        .enum(["Server", "Account", "Service"], { required_error: requiredError("roleType") })
        .describe("Role type: Server (granted to server instances), Account (assumed by another account via role switching), Service (granted to a service product)"),
      sessionExpirationSeconds: z
        .union([z.literal(600), z.literal(1800)])
        .optional()
        .describe("Session expiration in seconds: 600 or 1800. REQUIRED for Account roles; must be omitted for other types (400)"),
      description: z.string().max(300).optional().describe("Description (0-300 chars)"),
      tags: TAGS_SCHEMA,
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the role"),
    },
    async (params) => {
      if (params.roleType === "Account" && params.sessionExpirationSeconds === undefined) {
        return errorText(
          "roleType이 Account인 경우 sessionExpirationSeconds(600 | 1800)는 필수입니다.",
          "sessionExpirationSeconds (600 | 1800) is required when roleType is Account."
        );
      }
      if (params.roleType !== "Account" && params.sessionExpirationSeconds !== undefined) {
        return errorText(
          "sessionExpirationSeconds는 roleType이 Account인 경우에만 지정할 수 있습니다.",
          "sessionExpirationSeconds can only be set when roleType is Account."
        );
      }
      const body: Record<string, unknown> = { roleName: params.roleName, roleType: params.roleType };
      if (params.sessionExpirationSeconds !== undefined) body.sessionExpirationSeconds = params.sessionExpirationSeconds;
      if (params.description !== undefined) body.description = params.description;
      if (params.tags !== undefined) body.tags = params.tags;
      const endpoint = `${BASE}/roles`;
      if (params.dryRun) {
        return dryRunPreview({ label: "🔍 Dry-Run Preview: IAM Role Creation", endpoint, method: "POST", requestParams: body, noun: { ko: "역할", en: "role" } });
      }
      return client.requestRaw("POST", endpoint, undefined, body);
    }
  );

  defineTool(
    server,
    "ncloud_update_role",
    "Partially update an IAM role (PATCH): only passed fields change. roleType cannot be changed. Pass description=null to clear it. sessionExpirationSeconds applies to Account roles only (400 otherwise).",
    {
      roleId: ROLE_ID,
      roleName: z.string().min(3).max(100).optional().describe("New role name (3-100 chars)"),
      description: z.string().max(300).nullable().optional().describe("Description (0-300 chars); null clears it"),
      sessionExpirationSeconds: z.union([z.literal(600), z.literal(1800)]).optional().describe("Session expiration in seconds (600 or 1800). Account roles only"),
    },
    async (params) => {
      const { roleId, ...rest } = params;
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) if (v !== undefined) body[k] = v;
      if (Object.keys(body).length === 0) {
        return errorText("변경할 필드를 1개 이상 지정하세요.", "Specify at least one field to update.");
      }
      return client.requestRaw("PATCH", `${BASE}/roles/${enc(roleId)}`, undefined, body);
    }
  );

  defineTool(
    server,
    "ncloud_set_role_status",
    "Activate or deactivate an IAM role. A deactivated role is kept but cannot be used.",
    {
      roleId: ROLE_ID,
      active: z.boolean({ required_error: requiredError("active") }).describe("true: activate, false: deactivate"),
    },
    async (params) => client.requestRaw("POST", `${BASE}/roles/${enc(params.roleId)}/change-status`, undefined, { active: params.active })
  );

  defineTool(
    server,
    "ncloud_delete_role",
    "⚠️ Destructive: Permanently delete an IAM role. Servers, services or accounts using it lose its permissions. Set confirm=true to execute.",
    { roleId: ROLE_ID },
    async (params) => client.requestRaw("DELETE", `${BASE}/roles/${enc(params.roleId)}`),
    {
      destructive: {
        message: (p) => `⚠️ This will permanently delete IAM Role [${p.roleId}].\n\nTo execute, call this tool again with confirm=true.`,
      },
    }
  );

  defineTool(
    server,
    "ncloud_attach_policy_to_role",
    "Attach IAM policies (1-10) to a role. Atomic: if any policy fails, nothing is attached.",
    { roleId: ROLE_ID, ...POLICY_IDS_INPUT },
    async (params) => {
      const r = resolveIds("policyIds", 10, params.policyIds, params.policyIdList, params.policyId);
      if ("error" in r) return r.error;
      return client.requestRaw("POST", `${BASE}/roles/${enc(params.roleId)}/attach-policies`, undefined, { policyIds: r.ids });
    }
  );

  defineTool(
    server,
    "ncloud_detach_policy_from_role",
    "⚠️ Destructive: Detach IAM policies (1-10) from a role; its users lose those permissions immediately. Atomic. Set confirm=true to execute.",
    { roleId: ROLE_ID, ...POLICY_IDS_INPUT },
    async (params) => {
      const r = resolveIds("policyIds", 10, params.policyIds, params.policyIdList, params.policyId);
      if ("error" in r) return r.error;
      return client.requestRaw("POST", `${BASE}/roles/${enc(params.roleId)}/detach-policies`, undefined, { policyIds: r.ids });
    },
    {
      destructive: {
        message: (p) =>
          `⚠️ This will detach policies [${[...(p.policyIds ?? []), ...(p.policyIdList ?? []), ...(p.policyId ? [p.policyId] : [])].join(", ")}] from role [${p.roleId}].\n\nTo execute, call this tool again with confirm=true.`,
      },
    }
  );

  defineTool(
    server,
    "ncloud_attach_role_entities",
    "Attach entities (1-100) to a Server or Service role: server instance numbers for a Server role, service names for a Service role. The entity type must match the role type. Account roles use ncloud_attach_role_account instead.",
    {
      roleId: ROLE_ID,
      roleEntities: z
        .array(
          z.object({
            id: z.string().describe("Entity ID — the server instance number (Server) or the service name (Service)"),
            type: z.enum(["Server", "Service"]).describe("Entity type; must equal the role's type"),
          })
        )
        .min(1)
        .max(100)
        .describe("Entities to attach, 1-100, no duplicates"),
    },
    async (params) =>
      client.requestRaw("POST", `${BASE}/roles/${enc(params.roleId)}/attach-entities`, undefined, { roleEntities: params.roleEntities })
  );

  defineTool(
    server,
    "ncloud_detach_role_entities",
    "⚠️ Destructive: Detach entities (1-100) from a Server or Service role — the servers/services lose the role's permissions immediately. Give the same IDs used when attaching (server instance numbers or service names). Set confirm=true to execute.",
    {
      roleId: ROLE_ID,
      roleEntityIds: z.array(z.string()).describe("Entity IDs to detach, 1-100, no duplicates"),
    },
    async (params) => {
      const r = resolveIds("roleEntityIds", 100, params.roleEntityIds);
      if ("error" in r) return r.error;
      return client.requestRaw("POST", `${BASE}/roles/${enc(params.roleId)}/detach-entities`, undefined, { roleEntityIds: r.ids });
    },
    {
      destructive: {
        message: (p) =>
          `⚠️ This will detach entities [${(p.roleEntityIds ?? []).join(", ")}] from role [${p.roleId}].\n\nTo execute, call this tool again with confirm=true.`,
      },
    }
  );

  defineTool(
    server,
    "ncloud_attach_role_account",
    "Set the target account of an Account role (the account allowed to switch into this role). ownAccount=true targets your own account; otherwise give accountName and loginId of the other account (400 if no account matches both).",
    {
      roleId: ROLE_ID,
      ownAccount: z.boolean({ required_error: requiredError("ownAccount") }).describe("true: target the caller's own account (accountName/loginId ignored); false: target the account given by accountName + loginId"),
      accountName: z.string().optional().describe("Owner name of the target account. Required when ownAccount=false"),
      loginId: z.string().max(100).optional().describe("Login ID (usually an email) of the target account owner. Required when ownAccount=false"),
    },
    async (params) => {
      if (!params.ownAccount && (!params.accountName || !params.loginId)) {
        return errorText(
          "ownAccount가 false이면 accountName과 loginId는 필수입니다.",
          "accountName and loginId are required when ownAccount is false."
        );
      }
      const body: Record<string, unknown> = { ownAccount: params.ownAccount };
      if (!params.ownAccount) {
        body.accountName = params.accountName;
        body.loginId = params.loginId;
      }
      return client.requestRaw("POST", `${BASE}/roles/${enc(params.roleId)}/attach-account`, undefined, body);
    }
  );

  defineTool(
    server,
    "ncloud_detach_role_account",
    "⚠️ Destructive: Remove the target account from an Account role, so that account can no longer switch into it. Set confirm=true to execute.",
    { roleId: ROLE_ID },
    async (params) => client.requestRaw("POST", `${BASE}/roles/${enc(params.roleId)}/detach-account`),
    {
      destructive: {
        message: (p) => `⚠️ This will detach the target account from role [${p.roleId}]; it can no longer switch into this role.\n\nTo execute, call this tool again with confirm=true.`,
      },
    }
  );
}
