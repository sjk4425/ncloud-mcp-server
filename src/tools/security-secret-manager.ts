import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { requiredError } from "./_messages.js";
import { dryRunPreview } from "./_dryrun.js";

/**
 * Secret Manager — 민간존 전용 (secretmanager-api-overview, 2026-10-02 대조; 공공·금융존 가이드에 없음).
 *
 * 호스트는 시크릿을 암호화한 KMS 키의 격리 타입에 따라 둘로 갈린다(개요 "API URL" 표):
 *   - KMS 전역 키 연동 시크릿  → https://secretmanager.apigw.ntruss.com          (`global`, 기본)
 *   - KMS 리전 격리 키 연동 시크릿 → https://ocapi-kr.ncloud.com/secretmanager       (`regional`; 일본 리전은 ocapi-jp 만 제공)
 * 경로는 두 호스트에서 같다. 모든 도구는 `keyIsolation` 으로 호스트를 고른다.
 *
 * 오퍼레이션: Secret Manager API 26종(`/api/v1/...`) + Secret Rotate Process Control 6종(`/action/v1/...`, 교체 함수가
 * 작업 토큰으로 호출하는 API — 도구 설명에 명시). REST JSON → requestRaw.
 */
export interface SecretManagerClients {
  /** KMS 전역 키 연동 시크릿용 호스트(secretmanager.apigw.ntruss.com). */
  global: NcloudClient;
  /** KMS 리전 격리 키 연동 시크릿용 호스트(ocapi-kr.ncloud.com/secretmanager). */
  regional: NcloudClient;
}

const STAGES = ["previous", "active", "pending"] as const;

/** regional(ocapi) 호스트는 경로 접두 `/secretmanager` 가 붙는다; global(apigw)은 그대로. */
export function secretPath(keyIsolation: "global" | "regional" | undefined, path: string): string {
  return keyIsolation === "regional" ? `/secretmanager${path}` : path;
}

export function registerSecretManagerTools(server: McpServer, clients: SecretManagerClients): void {
  const keyIsolation = z
    .enum(["global", "regional"])
    .optional()
    .default("global")
    .describe("Which Secret Manager host to call: 'global' (default) for secrets encrypted with a KMS global key (secretmanager.apigw.ntruss.com); 'regional' for secrets encrypted with a KMS region-isolated key (ocapi-kr.ncloud.com/secretmanager — the only option in the JPN region)");
  /**
   * 호스트 선택 + 경로 접두. NcloudClient 는 baseUrl + path 로 URL 을 만들고 path 만 서명하므로 regional 클라이언트는
   * 호스트(ocapi-kr/ocapi-jp.ncloud.com)에만 묶고, 경로 접두 `/secretmanager` 는 여기서 붙인다(개요 API URL 표의 `.../secretmanager`).
   */
  const call = (
    k: "global" | "regional" | undefined,
    method: string,
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
    body?: unknown
  ) => (k === "regional" ? clients.regional : clients.global).requestRaw(method, secretPath(k, path), query, body);
  const secretId = z.string({ required_error: requiredError("secretId") }).describe("Secret ID (see ncloud_secret_list_secrets)");
  const jobToken = z.string({ required_error: requiredError("jobToken") }).describe("Rotation job token (injected into the rotation function's environment; also in ncloud_secret_get_secret_logs)");
  const PLAIN = "⚠️ The response contains the secret value in plain text.";

  // ─── Lookup ────────────────────────────────────────────────────────────────

  // secretmanager-getsecretlist: GET /api/v1/secrets?pageNo
  defineTool(
    server,
    "ncloud_secret_list_secrets",
    "List Secret Manager secrets (name, id, type, status, rotation settings).",
    { pageNo: z.number().int().min(1).optional().describe("Page number (1-N, default 1)"), keyIsolation },
    async (params) => call(params.keyIsolation, "GET", "/api/v1/secrets", params.pageNo !== undefined ? { pageNo: params.pageNo } : undefined)
  );

  // secretmanager-getsecretdetail: GET /api/v1/secrets/{secretId}
  defineTool(
    server,
    "ncloud_secret_get_secret",
    "Get the details of a secret (metadata, rotation settings, protection key) — not the value.",
    { secretId, keyIsolation },
    async (params) => call(params.keyIsolation, "GET", `/api/v1/secrets/${encodeURIComponent(params.secretId)}`)
  );

  // secretmanager-getsecretvalue: GET /api/v1/secrets/{secretId}/values
  defineTool(
    server,
    "ncloud_secret_get_secret_value",
    `Get the secret values of every stage (previous / active / pending). ${PLAIN}`,
    { secretId, keyIsolation },
    async (params) => call(params.keyIsolation, "GET", `/api/v1/secrets/${encodeURIComponent(params.secretId)}/values`)
  );

  // secretmanager-getsecretstagevalue: GET /api/v1/secrets/{secretId}/{secret-value-stage}
  defineTool(
    server,
    "ncloud_secret_get_secret_stage_value",
    `Get the secret value of one stage: previous (value used before the current one), active (value in use) or pending (new value awaiting rotation completion). ${PLAIN}`,
    { secretId, stage: z.enum(STAGES, { required_error: requiredError("stage") }).describe("Secret value stage: previous | active | pending"), keyIsolation },
    async (params) => call(params.keyIsolation, "GET", `/api/v1/secrets/${encodeURIComponent(params.secretId)}/${params.stage}`)
  );

  // secretmanager-getsecretlogs: GET /api/v1/secrets/{secretId}/logs?keyword&pageNo&pageSize&timestampFrom&timestampTo
  defineTool(
    server,
    "ncloud_secret_get_secret_logs",
    "Get the usage / rotation logs of a secret (includes rotation job tokens).",
    {
      secretId,
      keyword: z.string().optional().describe("Search keyword"),
      pageNo: z.number().int().min(1).optional().describe("Page number (1-N, default 1)"),
      pageSize: z.number().int().min(1).optional().describe("Page size (default 100)"),
      timestampFrom: z.number().int().optional().describe("Start of the range (Unix timestamp, ms)"),
      timestampTo: z.number().int().optional().describe("End of the range (Unix timestamp, ms)"),
      keyIsolation,
    },
    async (params) => {
      const { secretId: id, keyIsolation: k, ...q } = params;
      const query: Record<string, string | number | undefined> = {};
      for (const [key, v] of Object.entries(q)) if (v !== undefined) query[key] = v as string | number;
      return call(k, "GET", `/api/v1/secrets/${encodeURIComponent(id)}/logs`, Object.keys(query).length > 0 ? query : undefined);
    }
  );

  // secretmanager-getprotectionkeylist: GET /api/v1/keys
  defineTool(
    server,
    "ncloud_secret_list_protection_keys",
    "List the KMS keys that can protect (encrypt) secrets (kmsKeyTag values for USER_MANAGED_KEY).",
    { keyIsolation },
    async (params) => call(params.keyIsolation, "GET", "/api/v1/keys")
  );

  // secretmanager-gettriggerlist: GET /api/v1/triggers
  defineTool(
    server,
    "ncloud_secret_list_triggers",
    "List the rotation triggers (Cloud Functions triggers) that can run automatic secret rotation.",
    { keyIsolation },
    async (params) => call(params.keyIsolation, "GET", "/api/v1/triggers")
  );

  // ─── Create / update ────────────────────────────────────────────────────────

  // secretmanager-createsecret: POST /api/v1/secrets
  defineTool(
    server,
    "ncloud_secret_create_secret",
    "Create a secret. secretValue is a JSON object string of 1-100 key/value pairs (≤10,000 bytes); rotationTargets names the keys that rotation replaces. Use dryRun=true to preview.",
    {
      secretName: z.string({ required_error: requiredError("secretName") }).regex(/^[A-Za-z][A-Za-z0-9_-]{2,14}$/, "secretName: 3-15 chars of letters, digits, '-' or '_', starting with a letter").describe("Secret name (3-15 chars: letters, digits, '-', '_'; starts with a letter)"),
      memo: z.string().max(1000).optional().describe("Description (0-1000 bytes)"),
      secretValue: z.string({ required_error: requiredError("secretValue") }).describe("Secret value as a JSON object string, e.g. '{\"password\":\"...\"}' (1-100 key/value pairs, ≤10,000 bytes)"),
      rotationTargets: z.array(z.string()).min(1).describe("Keys of secretValue that rotation replaces (at least one)"),
      secretType: z.enum(["BASIC"]).optional().default("BASIC").describe("Secret type (BASIC is the only valid value)"),
      autoRotationYN: z.enum(["Y", "N"]).optional().default("N").describe("Enable automatic rotation (Y) or not (N, default)"),
      autoRotationPeriod: z.number().int().min(1).max(730).optional().describe("Rotation period in days (1-730, default 90) — required when autoRotationYN=Y"),
      triggerId: z.string().optional().describe("Rotation trigger ID (see ncloud_secret_list_triggers) — required when autoRotationYN=Y"),
      protectionKeyType: z.enum(["DEFAULT", "USER_MANAGED_KEY"]).optional().default("DEFAULT").describe("Protection key: DEFAULT (service key) or USER_MANAGED_KEY (your KMS key)"),
      kmsKeyTag: z.string().optional().describe("KMS key tag (see ncloud_secret_list_protection_keys) — required when protectionKeyType=USER_MANAGED_KEY"),
      kmsBoundaryType: z.enum(["GLOBAL", "ISOLATED"]).optional().describe("KMS key isolation: GLOBAL or ISOLATED (new keys support ISOLATED only)"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without creating"),
      keyIsolation,
    },
    async (params) => {
      if (params.autoRotationYN === "Y" && (!params.triggerId || params.autoRotationPeriod === undefined)) {
        return { content: [{ type: "text" as const, text: "autoRotationYN=Y requires both autoRotationPeriod (1-730 days) and triggerId." }], isError: true };
      }
      if (params.protectionKeyType === "USER_MANAGED_KEY" && !params.kmsKeyTag) {
        return { content: [{ type: "text" as const, text: "protectionKeyType=USER_MANAGED_KEY requires kmsKeyTag (see ncloud_secret_list_protection_keys)." }], isError: true };
      }
      const body: Record<string, unknown> = {
        secretName: params.secretName,
        secretValue: { value: params.secretValue, rotationTargets: params.rotationTargets },
        secretType: params.secretType,
        autoRotationYN: params.autoRotationYN,
        protectionKeyType: params.protectionKeyType,
      };
      if (params.memo !== undefined) body.memo = params.memo;
      if (params.autoRotationPeriod !== undefined) body.autoRotationPeriod = params.autoRotationPeriod;
      if (params.triggerId !== undefined) body.triggerId = params.triggerId;
      if (params.kmsKeyTag !== undefined) body.kmsKeyTag = params.kmsKeyTag;
      if (params.kmsBoundaryType !== undefined) body.kmsBoundaryType = params.kmsBoundaryType;
      if (params.dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: Secret Creation",
          endpoint: "/api/v1/secrets",
          method: "POST",
          requestParams: { ...body, secretValue: { value: "<redacted>", rotationTargets: params.rotationTargets } },
          noun: { ko: "시크릿", en: "secret" },
        });
      }
      return call(params.keyIsolation, "POST", "/api/v1/secrets", undefined, body);
    }
  );

  // secretmanager-updatesecretvalue: PUT /api/v1/secrets/{secretId}/values { previous?, active?, pending? }
  defineTool(
    server,
    "ncloud_secret_update_secret_value",
    "Replace the secret values of the stages you pass (previous / active / pending), each a JSON object string. At least one stage is required.",
    {
      secretId,
      previous: z.string().optional().describe("New PREVIOUS stage value (JSON object string)"),
      active: z.string().optional().describe("New ACTIVE stage value (JSON object string)"),
      pending: z.string().optional().describe("New PENDING stage value (JSON object string)"),
      keyIsolation,
    },
    async (params) => {
      const body: Record<string, string> = {};
      for (const s of STAGES) if (params[s] !== undefined) body[s] = params[s] as string;
      if (Object.keys(body).length === 0) {
        return { content: [{ type: "text" as const, text: "Provide at least one of previous / active / pending." }], isError: true };
      }
      return call(params.keyIsolation, "PUT", `/api/v1/secrets/${encodeURIComponent(params.secretId)}/values`, undefined, body);
    }
  );

  // secretmanager-update-secret-stage-value: PUT /api/v1/secrets/{secretId}/values/{secret-value-stage} { value }
  defineTool(
    server,
    "ncloud_secret_update_secret_stage_value",
    "Replace the secret value of one stage (previous / active / pending) with a JSON object string (1-100 key/value pairs, ≤10,000 bytes).",
    {
      secretId,
      stage: z.enum(STAGES, { required_error: requiredError("stage") }).describe("Secret value stage: previous | active | pending"),
      value: z.string({ required_error: requiredError("value") }).describe("New value as a JSON object string"),
      keyIsolation,
    },
    async (params) => call(params.keyIsolation, "PUT", `/api/v1/secrets/${encodeURIComponent(params.secretId)}/values/${params.stage}`, undefined, { value: params.value })
  );

  // secretmanager-updatesecretmemo: PUT /api/v1/secrets/{secretId}/memo { memo }
  defineTool(
    server,
    "ncloud_secret_update_memo",
    "Update the description (memo) of a secret.",
    { secretId, memo: z.string({ required_error: requiredError("memo") }).max(1000).describe("New description (0-1000 bytes)"), keyIsolation },
    async (params) => call(params.keyIsolation, "PUT", `/api/v1/secrets/${encodeURIComponent(params.secretId)}/memo`, undefined, { memo: params.memo })
  );

  // secretmanager-updateprotectionkey: PUT /api/v1/secrets/{secretId}/protection-key
  defineTool(
    server,
    "ncloud_secret_update_protection_key",
    "Change the KMS protection key of a secret (DEFAULT service key or a USER_MANAGED_KEY by kmsKeyTag). kmsBoundaryType is required in the KR region (JPN is always ISOLATED).",
    {
      secretId,
      protectionKeyType: z.enum(["DEFAULT", "USER_MANAGED_KEY"], { required_error: requiredError("protectionKeyType") }).describe("DEFAULT or USER_MANAGED_KEY"),
      kmsKeyTag: z.string().optional().describe("KMS key tag — required when protectionKeyType=USER_MANAGED_KEY"),
      kmsBoundaryType: z.enum(["GLOBAL", "ISOLATED"]).optional().describe("KMS key isolation: GLOBAL or ISOLATED (required in KR)"),
      keyIsolation,
    },
    async (params) => {
      if (params.protectionKeyType === "USER_MANAGED_KEY" && !params.kmsKeyTag) {
        return { content: [{ type: "text" as const, text: "protectionKeyType=USER_MANAGED_KEY requires kmsKeyTag." }], isError: true };
      }
      const body: Record<string, unknown> = { protectionKeyType: params.protectionKeyType };
      if (params.kmsKeyTag !== undefined) body.kmsKeyTag = params.kmsKeyTag;
      if (params.kmsBoundaryType !== undefined) body.kmsBoundaryType = params.kmsBoundaryType;
      return call(params.keyIsolation, "PUT", `/api/v1/secrets/${encodeURIComponent(params.secretId)}/protection-key`, undefined, body);
    }
  );

  // ─── Enable / disable / deletion ────────────────────────────────────────────

  // secretmanager-enablesecret: POST /api/v1/secrets/{secretId}/enable
  defineTool(
    server,
    "ncloud_secret_enable_secret",
    "Enable a disabled secret.",
    { secretId, keyIsolation },
    async (params) => call(params.keyIsolation, "POST", `/api/v1/secrets/${encodeURIComponent(params.secretId)}/enable`)
  );

  // secretmanager-disablesecret: POST /api/v1/secrets/{secretId}/disable
  defineTool(
    server,
    "ncloud_secret_disable_secret",
    "⚠️ Destructive: Disable a secret — applications can no longer read its value until it is enabled again. Set confirm=true to execute.",
    { secretId, keyIsolation },
    async (params) => call(params.keyIsolation, "POST", `/api/v1/secrets/${encodeURIComponent(params.secretId)}/disable`),
    { destructive: { noun: "Secret", action: "disable", describe: (p) => p.secretId } }
  );

  // secretmanager-requestsecretdeletion: POST /api/v1/secrets/{secretId}/request-deletion
  defineTool(
    server,
    "ncloud_secret_request_deletion",
    "⚠️ Destructive: Request deletion of a secret (it is scheduled for deletion; cancel with ncloud_secret_cancel_deletion before it is removed). Set confirm=true to execute.",
    { secretId, keyIsolation },
    async (params) => call(params.keyIsolation, "POST", `/api/v1/secrets/${encodeURIComponent(params.secretId)}/request-deletion`),
    { destructive: { noun: "Secret", action: "schedule deletion of", describe: (p) => p.secretId } }
  );

  // secretmanager-cancelsecretdeletion: POST /api/v1/secrets/{secretId}/cancel-deletion
  defineTool(
    server,
    "ncloud_secret_cancel_deletion",
    "Cancel a pending deletion request of a secret.",
    { secretId, keyIsolation },
    async (params) => call(params.keyIsolation, "POST", `/api/v1/secrets/${encodeURIComponent(params.secretId)}/cancel-deletion`)
  );

  // secretmanager-deletesecret: DELETE /api/v1/secrets/{secretId}
  defineTool(
    server,
    "ncloud_secret_delete_secret",
    "⚠️ Destructive: Permanently delete a secret. Set confirm=true to execute.",
    { secretId, keyIsolation },
    async (params) => call(params.keyIsolation, "DELETE", `/api/v1/secrets/${encodeURIComponent(params.secretId)}`),
    { destructive: { noun: "Secret", describe: (p) => p.secretId } }
  );

  // ─── Rotation settings ──────────────────────────────────────────────────────

  // secretmanager-enable-auto-rotation: POST /api/v1/secrets/{secretId}/enable-auto-rotation { rotationPeriod?, triggerId? }
  defineTool(
    server,
    "ncloud_secret_enable_auto_rotation",
    "Enable automatic rotation of a secret. triggerId is required when the secret has no trigger yet or you want to change it.",
    {
      secretId,
      rotationPeriod: z.number().int().min(1).max(730).optional().describe("Rotation period in days (1-730, default 90)"),
      triggerId: z.string().optional().describe("Rotation trigger ID (see ncloud_secret_list_triggers)"),
      keyIsolation,
    },
    async (params) => {
      const body: Record<string, unknown> = {};
      if (params.rotationPeriod !== undefined) body.rotationPeriod = params.rotationPeriod;
      if (params.triggerId !== undefined) body.triggerId = params.triggerId;
      return call(params.keyIsolation, "POST", `/api/v1/secrets/${encodeURIComponent(params.secretId)}/enable-auto-rotation`, undefined, body);
    }
  );

  // secretmanager-disable-auto-rotation: POST /api/v1/secrets/{secretId}/disable-auto-rotation
  defineTool(
    server,
    "ncloud_secret_disable_auto_rotation",
    "Disable automatic rotation of a secret.",
    { secretId, keyIsolation },
    async (params) => call(params.keyIsolation, "POST", `/api/v1/secrets/${encodeURIComponent(params.secretId)}/disable-auto-rotation`)
  );

  // secretmanager-update-rotation-period: PUT /api/v1/secrets/{secretId}/rotation-period { rotationPeriod }
  defineTool(
    server,
    "ncloud_secret_update_rotation_period",
    "Change the automatic rotation period (days) of a secret.",
    { secretId, rotationPeriod: z.number({ required_error: requiredError("rotationPeriod") }).int().min(1).max(730).describe("Rotation period in days (1-730)"), keyIsolation },
    async (params) => call(params.keyIsolation, "PUT", `/api/v1/secrets/${encodeURIComponent(params.secretId)}/rotation-period`, undefined, { rotationPeriod: params.rotationPeriod })
  );

  // secretmanager-update-rotation-trigger: PUT /api/v1/secrets/{secretId}/triggers { triggerId }
  defineTool(
    server,
    "ncloud_secret_update_rotation_trigger",
    "Set or change the rotation trigger of a secret.",
    { secretId, triggerId: z.string({ required_error: requiredError("triggerId") }).describe("Rotation trigger ID (see ncloud_secret_list_triggers)"), keyIsolation },
    async (params) => call(params.keyIsolation, "PUT", `/api/v1/secrets/${encodeURIComponent(params.secretId)}/triggers`, undefined, { triggerId: params.triggerId })
  );

  // secretmanager-delete-rotation-trigger: DELETE /api/v1/secrets/{secretId}/triggers
  defineTool(
    server,
    "ncloud_secret_delete_rotation_trigger",
    "⚠️ Destructive: Remove the rotation trigger from a secret (automatic rotation can no longer run). Set confirm=true to execute.",
    { secretId, keyIsolation },
    async (params) => call(params.keyIsolation, "DELETE", `/api/v1/secrets/${encodeURIComponent(params.secretId)}/triggers`),
    { destructive: { noun: "Secret rotation trigger of", action: "remove", describe: (p) => p.secretId } }
  );

  // ─── Rotation jobs ──────────────────────────────────────────────────────────

  // secretmanager-execute-rotation-job: POST /api/v1/secrets/{secretId}/rotation
  defineTool(
    server,
    "ncloud_secret_execute_rotation",
    "Start a rotation job for a secret now (runs the rotation trigger).",
    { secretId, keyIsolation },
    async (params) => call(params.keyIsolation, "POST", `/api/v1/secrets/${encodeURIComponent(params.secretId)}/rotation`)
  );

  // secretmanager-retry-rotation-job: POST /api/v1/secrets/{secretId}/retry-rotation
  defineTool(
    server,
    "ncloud_secret_retry_rotation",
    "Retry a failed rotation job of a secret.",
    { secretId, keyIsolation },
    async (params) => call(params.keyIsolation, "POST", `/api/v1/secrets/${encodeURIComponent(params.secretId)}/retry-rotation`)
  );

  // secretmanager-cancel-rotation-job: POST /api/v1/secrets/{secretId}/cancel-rotation
  defineTool(
    server,
    "ncloud_secret_cancel_rotation",
    "Cancel the rotation job that is currently running for a secret.",
    { secretId, keyIsolation },
    async (params) => call(params.keyIsolation, "POST", `/api/v1/secrets/${encodeURIComponent(params.secretId)}/cancel-rotation`)
  );

  // secretmanager-rollback-rotation-job: POST /api/v1/secrets/{secretId}/rollback-rotation
  defineTool(
    server,
    "ncloud_secret_rollback_rotation",
    "⚠️ Destructive: Roll back the last rotation of a secret (the previous value becomes active again). Set confirm=true to execute.",
    { secretId, keyIsolation },
    async (params) => call(params.keyIsolation, "POST", `/api/v1/secrets/${encodeURIComponent(params.secretId)}/rollback-rotation`),
    { destructive: { noun: "rotation of Secret", action: "roll back the", describe: (p) => p.secretId } }
  );

  // ─── Secret Rotate Process Control (called by the rotation function with the job token) ───
  const ROTATE_NOTE = "Rotation-function API (Secret Rotate Process Control): meant to be called by the rotation trigger's function with the job token it receives, not during normal administration.";

  // secretmanager-start-rotation-job: POST /action/v1/secrets/{secretId}/jobs/{jobToken}/start
  defineTool(
    server,
    "ncloud_secret_job_start",
    `Report the start of a rotation job. ${ROTATE_NOTE}`,
    { secretId, jobToken, keyIsolation },
    async (params) => call(params.keyIsolation, "POST", `/action/v1/secrets/${encodeURIComponent(params.secretId)}/jobs/${encodeURIComponent(params.jobToken)}/start`)
  );

  // secretmanager-add-pending-stage: POST /action/v1/secrets/{secretId}/jobs/{jobToken}/pending
  defineTool(
    server,
    "ncloud_secret_job_add_pending_stage",
    `Create the PENDING stage for a rotation job. ${ROTATE_NOTE}`,
    { secretId, jobToken, keyIsolation },
    async (params) => call(params.keyIsolation, "POST", `/action/v1/secrets/${encodeURIComponent(params.secretId)}/jobs/${encodeURIComponent(params.jobToken)}/pending`)
  );

  // secretmanager-update-pending-stage: PUT /action/v1/secrets/{secretId}/jobs/{jobToken}/pending { value }
  defineTool(
    server,
    "ncloud_secret_job_update_pending_stage",
    `Set the PENDING stage value (JSON object string) of a rotation job. ${ROTATE_NOTE}`,
    { secretId, jobToken, value: z.string({ required_error: requiredError("value") }).describe("New pending value as a JSON object string"), keyIsolation },
    async (params) => call(params.keyIsolation, "PUT", `/action/v1/secrets/${encodeURIComponent(params.secretId)}/jobs/${encodeURIComponent(params.jobToken)}/pending`, undefined, { value: params.value })
  );

  // secretmanager-generate-random-secret: POST /action/v1/secrets/{secretId}/jobs/{jobToken}/generate-random-secret
  defineTool(
    server,
    "ncloud_secret_job_generate_random_secret",
    `Generate a random secret string for a rotation job. ${ROTATE_NOTE} ${PLAIN}`,
    {
      secretId,
      jobToken,
      length: z.number({ required_error: requiredError("length") }).int().min(5).max(32).describe("Length of the random string (5-32, default 12)"),
      excludeCharacters: z.string().optional().describe("Characters to exclude (one string, no separator)"),
      excludeNumbers: z.boolean().optional().describe("Exclude digits (default false)"),
      excludePunctuation: z.boolean().optional().describe("Exclude punctuation (default false)"),
      excludeUppercase: z.boolean().optional().describe("Exclude uppercase letters (default false)"),
      excludeLowercase: z.boolean().optional().describe("Exclude lowercase letters (default false)"),
      includeSpace: z.boolean().optional().describe("Include spaces (default true)"),
      requireEachIncludedType: z.boolean().optional().describe("Require every non-excluded character type to appear (default true)"),
      keyIsolation,
    },
    async (params) => {
      const { secretId: id, jobToken: token, keyIsolation: k, ...rest } = params;
      const body: Record<string, unknown> = {};
      for (const [key, v] of Object.entries(rest)) if (v !== undefined) body[key] = v;
      return call(k, "POST", `/action/v1/secrets/${encodeURIComponent(id)}/jobs/${encodeURIComponent(token)}/generate-random-secret`, undefined, body);
    }
  );

  // secretmanager-complete-rotation-job: POST /action/v1/secrets/{secretId}/jobs/{jobToken}/complete
  defineTool(
    server,
    "ncloud_secret_job_complete",
    `Report a rotation job as completed (the PENDING value becomes ACTIVE). ${ROTATE_NOTE}`,
    { secretId, jobToken, keyIsolation },
    async (params) => call(params.keyIsolation, "POST", `/action/v1/secrets/${encodeURIComponent(params.secretId)}/jobs/${encodeURIComponent(params.jobToken)}/complete`)
  );

  // secretmanager-fail-rotation-job: POST /action/v1/secrets/{secretId}/jobs/{jobToken}/fail
  defineTool(
    server,
    "ncloud_secret_job_fail",
    `Report a rotation job as failed. ${ROTATE_NOTE}`,
    { secretId, jobToken, keyIsolation },
    async (params) => call(params.keyIsolation, "POST", `/action/v1/secrets/${encodeURIComponent(params.secretId)}/jobs/${encodeURIComponent(params.jobToken)}/fail`)
  );
}
