import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { L, requiredError } from "./_messages.js";
import { dryRunPreview } from "./_dryrun.js";
import { withQuery } from "./_query.js";

/**
 * Cloud DB Serverless (MySQL) API v1 — Base URL: https://clouddb-serverless.apigw.ntruss.com, 경로 접두 /mysql/v1
 * 문서: https://api.ncloud-docs.com/docs/pub-clouddb-serverless-v1-overview (op 페이지 `pub-clouddb-serverless-v1-<group>-<op>`)
 *
 * 2026-09-17 신규 출시. "Ncloud 표준 표현" REST — JSON 본문의 POST/PATCH/DELETE, `responseFormatType`·`{param}.{N}` 없음,
 * pageNo **0부터**, `sort=field,asc|desc` 반복 지정. 경로 식별자는 전부 name 문자열(clusterNo 는 표시용).
 *
 * 비동기: 쓰기 op 는 202 로 Operation 객체(`id`, `done`, `metadata{operationType,resourceType,...}`, `results`, `error`, `failures`)를
 * 최상위로 돌려주고, 폴링 경로는 resourceType 별로 8종으로 갈라진다 → `ncloud_serverless_get_operation`/`list_operations`
 * 두 도구가 resourceType 으로 라우팅한다. 유일한 동기 쓰기는 updateLogConfig(200).
 * 배치 op 는 검증 실패 시 400 `partialFailure` + `failures{index→Error}`(`error` 아님) — 클라이언트가 본문을 그대로 메시지에 싣는다.
 *
 * 2026-09-21 라이브(Sub Account admin 키): 실제 경로(`/mysql/v1/clusters`, `/engine-versions`)는 403 "sub account is not
 * supported yet", 가짜/camelCase 경로는 300 → 경로 실존(kebab-case) 확인, **API 가 Sub Account 키를 아직 지원하지 않음**.
 * 메인 계정 키로만 동작하므로 403 에 그 힌트를 덧붙인다. 응답 형식은 미검증(문서 기준).
 */

const V1 = "/mysql/v1";
const enc = encodeURIComponent;

// ─── 이름 규칙(문서) ─────────────────────────────────────────────────────────
const clusterNameSchema = z.string()
  .regex(/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/, "clusterName: 3-30 chars of lowercase letters, digits and '-', not starting or ending with '-'")
  .describe("Cluster name (3-30 chars, lowercase letters/digits/'-', no leading or trailing '-'; immutable after creation)");
const instanceNameSchema = z.string().regex(/^[a-z0-9-]{3,39}$/, "instanceName: 3-39 chars of lowercase letters, digits and '-'")
  .describe("Instance name ({clusterName}-{suffix}, from ncloud_serverless_list_instances)");
const backupNameSchema = z.string().regex(/^[a-z0-9-]{3,45}$/, "backupName: 3-45 chars of lowercase letters, digits and '-'");
const importedBackupNameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/, "name: 3-30 chars of lowercase letters, digits and '-', not starting or ending with '-'");
const userNameSchema = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{2,14}[A-Za-z0-9]$/, "userName: 4-16 chars, starts with a letter, letters/digits/'_'/'-', ends with a letter or digit");
const RESERVED_SCHEMAS = ["mysql", "information_schema", "performance_schema", "sys"];
const databaseNameSchema = z.string().regex(/^[A-Za-z0-9_]{1,64}$/, "databaseName: 1-64 chars of letters, digits and '_'")
  .refine((v) => !RESERVED_SCHEMAS.includes(v.toLowerCase()), { message: `databaseName must not be a reserved schema (${RESERVED_SCHEMAS.join(", ")})` });
const passwordSchema = z.string().min(8).max(20)
  .refine((v) => /[A-Za-z]/.test(v) && /[0-9]/.test(v) && /[^A-Za-z0-9]/.test(v), { message: "password needs at least one letter, one digit and one special character" })
  .refine((v) => !/[`&+\\"'/\s]/.test(v), { message: "password must not contain ` & + \\ \" ' / or whitespace" })
  .describe("8-20 chars with a letter, a digit and a special character; ` & + \\ \" ' / and spaces are not allowed. Never returned by the API");
const operationIdSchema = z.string().uuid("operationId must be a UUID").describe("Operation ID (the `id` of the 202 response)");

// ─── 공용 스키마 ─────────────────────────────────────────────────────────────
const pageParams = {
  pageNo: z.number().int().min(0).optional().describe("Page number, 0-based (default 0 — note: unlike the legacy Ncloud APIs)"),
  pageSize: z.number().int().min(1).max(100).optional().describe("Items per page (1-100, default 20)"),
  sort: z.array(z.string().regex(/^[A-Za-z]+,(asc|desc)$/, "sort item must be 'field,asc' or 'field,desc'")).optional().describe("Sort keys 'field,asc|desc' (repeatable; allowed fields per tool)"),
};

const unitRangeSchema = z.object({
  min: z.number().min(1).describe("Minimum unit (≥1, multiple of 0.5)"),
  max: z.number().min(1).describe("Maximum unit (≥1, multiple of 0.5, ≥ min). Without autoScale.scaleUp the cluster is pinned to max"),
}).refine((u) => u.min <= u.max, { message: "unit.min must be ≤ unit.max" })
  .refine((u) => Number.isInteger(u.min * 2) && Number.isInteger(u.max * 2), { message: "unit values must be multiples of 0.5" });

const backupConfigSchema = z.object({
  backupAuto: z.boolean().optional().describe("true (default) = service-chosen time (backupTime ignored); false = use backupTime"),
  backupTime: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "backupTime must be HH:MM (UTC)").optional().describe("Backup time HH:MM in UTC (required when backupAuto=false)"),
  retentionDays: z.number().int().min(1).max(30).describe("Retention days (1-30)"),
}).refine((b) => b.backupAuto !== false || b.backupTime !== undefined, { message: "backupTime is required when backupAuto=false" });

const autoScaleSchema = z.object({
  scaleOut: z.object({
    enabled: z.boolean().optional().describe("Horizontal scaling of replicas (default false)"),
    thresholdConnection: z.number().int().min(500).max(30000).optional().describe("Scale-out trigger by connections (500-30,000; mutually exclusive with thresholdCpu)"),
    thresholdCpu: z.number().int().min(30).max(99).optional().describe("Scale-out trigger by CPU % (30-99; mutually exclusive with thresholdConnection)"),
    replica: z.object({ min: z.number().int().optional(), max: z.number().int().optional() }).optional().describe("Replica count range"),
  }).optional(),
  scaleUp: z.object({
    enabled: z.boolean().optional().describe("Vertical scaling between unit.min and unit.max (default false = pinned to unit.max)"),
  }).optional(),
}).refine((a) => !(a.scaleOut?.thresholdConnection !== undefined && a.scaleOut?.thresholdCpu !== undefined), { message: "scaleOut.thresholdConnection and thresholdCpu are mutually exclusive" })
  .refine((a) => !a.scaleOut?.enabled || ((a.scaleOut.thresholdConnection !== undefined || a.scaleOut.thresholdCpu !== undefined) && a.scaleOut.replica?.min !== undefined && a.scaleOut.replica?.max !== undefined),
    { message: "scaleOut.enabled=true requires one threshold (connection or cpu) and replica.min/max" });

const networkSchema = z.object({
  vpcNo: z.number().int().describe("VPC number"),
  subnetNo: z.number().int().describe("Subnet number"),
  port: z.number().int().min(1).max(65535).describe("DB port (e.g. 3306)"),
});

const LOG_TYPES = ["BIN", "SLOW_QUERY", "ERROR", "GENERAL"] as const;
const PERMISSIONS = ["READ", "CRUD", "DDL"] as const;
const OPERATION_TYPES = ["CREATE", "UPDATE", "DELETE"] as const;
const RESOURCE_TYPES = ["clusters", "imported-backups", "backups", "users", "databases", "config", "logs", "processes"] as const;
type ResourceType = (typeof RESOURCE_TYPES)[number];

/** resourceType → Operation 조회 경로. 리소스에 따라 clusterName / instanceName 이 필요하다. */
function operationBasePath(resourceType: ResourceType, clusterName?: string, instanceName?: string): { path?: string; problem?: string } {
  switch (resourceType) {
    case "clusters": return { path: `${V1}/clusters/operations` };
    case "imported-backups": return { path: `${V1}/imported-backups/operations` };
    case "backups": case "users": case "databases": case "config":
      if (!clusterName) return { problem: `clusterName is required for resourceType=${resourceType}` };
      return { path: `${V1}/clusters/${enc(clusterName)}/${resourceType}/operations` };
    case "logs": case "processes":
      if (!clusterName || !instanceName) return { problem: `clusterName and instanceName are required for resourceType=${resourceType}` };
      return { path: `${V1}/clusters/${enc(clusterName)}/instances/${enc(instanceName)}/${resourceType}/operations` };
  }
}

function problem(text: string) {
  return { content: [{ type: "text" as const, text: `❌ ${text}` }], isError: true };
}

function stripUndefined<T extends Record<string, unknown>>(o: T): T {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

export function registerDatabaseServerlessTools(server: McpServer, client: NcloudClient): void {
  /** 요청 실행 + 403(Sub Account 미지원) 힌트. */
  async function call(method: string, path: string, body?: unknown): Promise<any> {
    try {
      return body === undefined ? await client.requestRaw(method, path) : await client.requestRaw(method, path, undefined, body);
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (/sub account is not supported/i.test(msg) || /HTTP 상태: 403|HTTP status: 403|\b403\b/.test(msg)) {
        throw new Error(msg + "\n\n" + L({
          ko: "💡 Cloud DB Serverless API 는 Sub Account 키를 아직 지원하지 않습니다(2026-09-21 실측: 403 \"sub account is not supported yet\"). 메인 계정의 Access Key 로 실행하세요.",
          en: "💡 The Cloud DB Serverless API does not support Sub Account keys yet (live 2026-09-21: 403 \"sub account is not supported yet\"). Use a main-account Access Key.",
        }));
      }
      throw e;
    }
  }

  /** 202 Operation 응답에 폴링 안내를 덧붙인다. */
  function withOperationHint(result: any, resourceType: ResourceType, clusterName?: string, instanceName?: string): any {
    if (!result || typeof result !== "object" || typeof result.id !== "string") return result;
    const poll: Record<string, unknown> = { tool: "ncloud_serverless_get_operation", resourceType, operationId: result.id };
    if (clusterName && resourceType !== "clusters" && resourceType !== "imported-backups") poll.clusterName = clusterName;
    if (instanceName && (resourceType === "logs" || resourceType === "processes")) poll.instanceName = instanceName;
    return {
      ...result,
      hint: L({
        ko: result.done ? "작업이 이미 완료되었습니다(done=true). error 가 없으면 성공입니다." : "202 Accepted — 비동기 작업입니다. done=true 가 될 때까지 아래 pollWith 로 상태를 조회하세요(권장 간격 5초).",
        en: result.done ? "The operation is already done (done=true); success unless `error` is set." : "202 Accepted — asynchronous. Poll with `pollWith` below until done=true (suggested interval 5 s).",
      }),
      pollWith: poll,
    };
  }

  const clusterPath = (c: string) => `${V1}/clusters/${enc(c)}`;
  const instancePath = (c: string, i: string) => `${clusterPath(c)}/instances/${enc(i)}`;

  // ═══════════════════════════════════════════════════════════════════════════
  // Cluster
  // ═══════════════════════════════════════════════════════════════════════════

  defineTool(
    server,
    "ncloud_serverless_list_clusters",
    "List Cloud DB Serverless (MySQL) clusters (GET /mysql/v1/clusters). Sort fields: name, createdDateTime (default createdDateTime,desc). pageNo is 0-based.",
    { ...pageParams },
    async (params) => call("GET", withQuery(`${V1}/clusters`, params))
  );

  defineTool(
    server,
    "ncloud_serverless_get_cluster",
    "Get a Cloud DB Serverless cluster (GET /mysql/v1/clusters/{clusterName}): status (CREATING|RUNNING|MODIFYING|PAUSED|DELETING|FAILED), endpoints, unit, replica counts, autoScale, backupConfig, engineVersion.",
    { clusterName: clusterNameSchema },
    async (params) => call("GET", clusterPath(params.clusterName))
  );

  defineTool(
    server,
    "ncloud_serverless_create_cluster",
    "Create a Cloud DB Serverless (MySQL) cluster (POST /mysql/v1/clusters → 202 Operation). Without autoScale the cluster is pinned to unit.max. engineVersion from ncloud_serverless_list_engine_versions. Use dryRun=true to preview (password is masked).",
    {
      name: clusterNameSchema,
      storageType: z.literal("CB2").optional().default("CB2").describe("Storage type (only CB2)"),
      network: networkSchema,
      multiZone: z.boolean().describe("true = place replicas in the backup zone"),
      unit: unitRangeSchema,
      initialDatabase: z.object({
        databaseName: databaseNameSchema.describe("Initial database name"),
        adminUserName: userNameSchema.describe("Admin user name (reserved words such as admin/root/agent are rejected)"),
        adminPassword: passwordSchema,
      }),
      backupConfig: backupConfigSchema,
      autoScale: autoScaleSchema.optional(),
      highAvailability: z.boolean().describe("Automatic failover"),
      engineVersion: z.string({ required_error: requiredError("engineVersion") }).describe("Engine version (e.g. 8.4.5)"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without creating"),
    },
    async (params) => {
      const { dryRun, ...body } = params;
      stripUndefined(body);
      if (dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: Cloud DB Serverless Cluster Creation", endpoint: `${V1}/clusters`, method: "POST",
          requestParams: body, noun: { ko: "서버리스 클러스터", en: "serverless cluster" },
          notes: params.autoScale ? {} : { note: L({ ko: "autoScale 미지정 → 스케일링 전부 비활성, unit 은 unit.max 로 고정됩니다.", en: "No autoScale → all scaling disabled; the cluster is pinned to unit.max." }) },
        });
      }
      return withOperationHint(await call("POST", `${V1}/clusters`, body), "clusters");
    }
  );

  defineTool(
    server,
    "ncloud_serverless_update_cluster",
    "Update a Cloud DB Serverless cluster (PATCH /mysql/v1/clusters/{clusterName}, merge-patch → 202 Operation). Only the given fields change: unit (min+max), multiZone, autoScale, backupConfig (retentionDays required when given). Setting scaleOut.enabled=false resets the replica range. Use dryRun=true to preview.",
    {
      clusterName: clusterNameSchema,
      unit: unitRangeSchema.optional(),
      multiZone: z.boolean().optional().describe("Enable/disable backup-zone replicas (enabling provisions and syncs replicas)"),
      autoScale: autoScaleSchema.optional(),
      backupConfig: backupConfigSchema.optional(),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without changing"),
    },
    async (params) => {
      const { clusterName, dryRun, ...body } = params;
      stripUndefined(body);
      if (Object.keys(body).length === 0) return problem(L({ ko: "변경할 필드가 없습니다(unit, multiZone, autoScale, backupConfig 중 하나 이상).", en: "Nothing to update — give at least one of unit, multiZone, autoScale, backupConfig." }));
      if (dryRun) {
        return dryRunPreview({ label: "🔍 Dry-Run Preview: Cloud DB Serverless Cluster Update", endpoint: clusterPath(clusterName), method: "PATCH", requestParams: body, noun: { ko: "클러스터 변경", en: "cluster update" }, verb: "apply" });
      }
      return withOperationHint(await call("PATCH", clusterPath(clusterName), body), "clusters");
    }
  );

  defineTool(
    server,
    "ncloud_serverless_delete_cluster",
    "⚠️ Destructive: Delete a Cloud DB Serverless cluster (DELETE /mysql/v1/clusters/{clusterName} → 202 Operation). With cascading=false (default) the call fails with 409 while users/databases remain; cascading=true deletes them too. 409 ResourceInUse while a restore is running. Set confirm=true to execute.",
    {
      clusterName: clusterNameSchema,
      cascading: z.boolean().optional().describe("true = also delete the cluster's users and databases (default false)"),
    },
    async (params) => withOperationHint(await call("DELETE", withQuery(clusterPath(params.clusterName), { cascading: params.cascading })), "clusters"),
    { destructive: { noun: "Cloud DB Serverless cluster (all data)", describe: (p) => `${p.clusterName}${p.cascading ? " with all users and databases" : ""}` } }
  );

  defineTool(
    server,
    "ncloud_serverless_restore_cluster",
    "Create a NEW Cloud DB Serverless cluster from a backup (POST /mysql/v1/clusters/restore → 202 Operation). source.type BACKUP needs originalClusterName + backupName (from ncloud_serverless_list_backups); IMPORTED_BACKUP needs backupName (imported backup name) + adminUserName + adminPassword. No point-in-time restore. Use dryRun=true to preview.",
    {
      name: clusterNameSchema.describe("Name of the cluster to create"),
      source: z.object({
        type: z.enum(["BACKUP", "IMPORTED_BACKUP"]),
        originalClusterName: clusterNameSchema.optional().describe("Source cluster (required for BACKUP)"),
        backupName: backupNameSchema.describe("Cluster backup name (BACKUP) or imported backup name (IMPORTED_BACKUP)"),
        adminUserName: userNameSchema.optional().describe("Admin user (required for IMPORTED_BACKUP)"),
        adminPassword: passwordSchema.optional(),
        storageType: z.literal("CB2").optional(),
      }),
      network: networkSchema,
      multiZone: z.boolean(),
      unit: unitRangeSchema,
      backupConfig: backupConfigSchema,
      autoScale: autoScaleSchema.optional(),
      highAvailability: z.boolean(),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without restoring"),
    },
    async (params) => {
      const s = params.source;
      if (s.type === "BACKUP" && !s.originalClusterName) return problem("source.originalClusterName is required when source.type=BACKUP");
      if (s.type === "IMPORTED_BACKUP" && (!s.adminUserName || !s.adminPassword)) return problem("source.adminUserName and source.adminPassword are required when source.type=IMPORTED_BACKUP");
      const { dryRun, ...body } = params;
      stripUndefined(body);
      stripUndefined(body.source as Record<string, unknown>);
      if (dryRun) {
        return dryRunPreview({ label: "🔍 Dry-Run Preview: Cloud DB Serverless Cluster Restore", endpoint: `${V1}/clusters/restore`, method: "POST", requestParams: body, noun: { ko: "복원 클러스터", en: "restored cluster" } });
      }
      return withOperationHint(await call("POST", `${V1}/clusters/restore`, body), "clusters");
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Instance / Process
  // ═══════════════════════════════════════════════════════════════════════════

  defineTool(
    server,
    "ncloud_serverless_list_instances",
    "List the instances of a Cloud DB Serverless cluster (GET /mysql/v1/clusters/{clusterName}/instances): role PRIMARY|REPLICA, unit, memoryGb, storageUsage, zoneCode, status. Sort fields: name, role, zoneCode, createdDateTime.",
    { clusterName: clusterNameSchema, ...pageParams },
    async (params) => { const { clusterName, ...q } = params; return call("GET", withQuery(`${clusterPath(clusterName)}/instances`, q)); }
  );

  defineTool(
    server,
    "ncloud_serverless_get_instance",
    "Get one instance of a Cloud DB Serverless cluster (GET /mysql/v1/clusters/{clusterName}/instances/{instanceName}).",
    { clusterName: clusterNameSchema, instanceName: instanceNameSchema },
    async (params) => call("GET", instancePath(params.clusterName, params.instanceName))
  );

  defineTool(
    server,
    "ncloud_serverless_list_processes",
    "List DB sessions of an instance, like SHOW PROCESSLIST (GET /mysql/v1/clusters/{clusterName}/instances/{instanceName}/processes): sessionNo, command, state, elapsedSeconds, userName, databaseName. Sort fields: sessionNo, elapsedSeconds, userName, databaseName.",
    { clusterName: clusterNameSchema, instanceName: instanceNameSchema, ...pageParams },
    async (params) => { const { clusterName, instanceName, ...q } = params; return call("GET", withQuery(`${instancePath(clusterName, instanceName)}/processes`, q)); }
  );

  defineTool(
    server,
    "ncloud_serverless_kill_processes",
    "⚠️ Destructive: Kill DB sessions on an instance (POST …/processes/batch-kill → 202 Operation). 1-49 sessionNos from ncloud_serverless_list_processes; application connections are cut. Unknown session numbers come back as 400 partialFailure with per-index failures. Set confirm=true to execute.",
    {
      clusterName: clusterNameSchema,
      instanceName: instanceNameSchema,
      sessionNos: z.array(z.number().int()).min(1).max(49).describe("Session numbers to kill (1-49)"),
    },
    async (params) => withOperationHint(await call("POST", `${instancePath(params.clusterName, params.instanceName)}/processes/batch-kill`, { sessionNos: params.sessionNos }), "processes", params.clusterName, params.instanceName),
    { destructive: { action: "kill", noun: "DB sessions", describe: (p) => `${p.sessionNos.length} session(s) on ${p.clusterName}/${p.instanceName}` } }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Backup / Imported backup
  // ═══════════════════════════════════════════════════════════════════════════

  defineTool(
    server,
    "ncloud_serverless_list_backups",
    "List automatic backups of a Cloud DB Serverless cluster (GET /mysql/v1/clusters/{clusterName}/backups): name, zoneCode, status (CREATING|AVAILABLE|IN_USE|DELETING), size. Backups are created automatically only — there is no manual create/delete. Sort fields: name, createdDateTime, size.",
    { clusterName: clusterNameSchema, ...pageParams },
    async (params) => { const { clusterName, ...q } = params; return call("GET", withQuery(`${clusterPath(clusterName)}/backups`, q)); }
  );

  defineTool(
    server,
    "ncloud_serverless_get_backup",
    "Get one automatic backup (GET /mysql/v1/clusters/{clusterName}/backups/{backupName}).",
    { clusterName: clusterNameSchema, backupName: backupNameSchema.describe("Backup name (from ncloud_serverless_list_backups)") },
    async (params) => call("GET", `${clusterPath(params.clusterName)}/backups/${enc(params.backupName)}`)
  );

  defineTool(
    server,
    "ncloud_serverless_export_backup",
    "Export a cluster backup to Object Storage (POST …/backups/{backupName}/export → 202 Operation). Requires an Object Storage subscription. 409 if the same backup is already being exported or is IN_USE.",
    {
      clusterName: clusterNameSchema,
      backupName: backupNameSchema.describe("Backup name (from ncloud_serverless_list_backups)"),
      bucketName: z.string({ required_error: requiredError("bucketName") }).describe("Destination Object Storage bucket"),
      uploadPath: z.string().optional().describe("Path inside the bucket (default root, e.g. backups/2026)"),
    },
    async (params) => {
      const body: Record<string, unknown> = { bucketName: params.bucketName };
      if (params.uploadPath !== undefined) body.uploadPath = params.uploadPath;
      return withOperationHint(await call("POST", `${clusterPath(params.clusterName)}/backups/${enc(params.backupName)}/export`, body), "backups", params.clusterName);
    },
    { annotations: { destructiveHint: false } }
  );

  defineTool(
    server,
    "ncloud_serverless_list_imported_backups",
    "List imported backups — backup files brought in from Object Storage, account-level (GET /mysql/v1/imported-backups): name, zoneCode, size, status (IMPORTING|AVAILABLE|FAILED), engineVersion. Sort fields: name, importedDateTime, size.",
    { ...pageParams },
    async (params) => call("GET", withQuery(`${V1}/imported-backups`, params))
  );

  defineTool(
    server,
    "ncloud_serverless_get_imported_backup",
    "Get one imported backup with import progress (GET /mysql/v1/imported-backups/{backupName}): importProgress.steps DOWNLOAD→EXTRACT→VERIFY→CREATE_BACKUP→FINALIZE, error when FAILED.",
    { backupName: importedBackupNameSchema.describe("Imported backup name (the `name` given at creation)") },
    async (params) => call("GET", `${V1}/imported-backups/${enc(params.backupName)}`)
  );

  defineTool(
    server,
    "ncloud_serverless_create_imported_backup",
    "Import a backup file from Object Storage as an imported backup (POST /mysql/v1/imported-backups → 202 Operation; up to 16 TiB). Then restore it with ncloud_serverless_restore_cluster (source.type=IMPORTED_BACKUP). Use dryRun=true to preview.",
    {
      name: importedBackupNameSchema.describe("Imported backup name (3-30 chars, unique)"),
      bucketName: z.string({ required_error: requiredError("bucketName") }).describe("Source Object Storage bucket"),
      objectPath: z.string().regex(/^[a-zA-Z0-9._/\-]+$/, "objectPath may contain letters, digits, '.', '_', '/' and '-'").describe("Backup file path inside the bucket (e.g. exports/backup.tar.gz)"),
      zoneCode: z.string().optional().describe("Zone to store it in (default: first available zone, e.g. KR-2)"),
      engineVersion: z.string({ required_error: requiredError("engineVersion") }).describe("Engine version the backup was created with"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without importing"),
    },
    async (params) => {
      const { dryRun, ...body } = params;
      stripUndefined(body);
      if (dryRun) return dryRunPreview({ label: "🔍 Dry-Run Preview: Imported Backup Creation", endpoint: `${V1}/imported-backups`, method: "POST", requestParams: body, noun: { ko: "가져온 백업", en: "imported backup" } });
      return withOperationHint(await call("POST", `${V1}/imported-backups`, body), "imported-backups");
    }
  );

  defineTool(
    server,
    "ncloud_serverless_delete_imported_backup",
    "⚠️ Destructive: Delete an imported backup (DELETE /mysql/v1/imported-backups/{backupName} → 202 Operation). 409 while a restore is using it. Set confirm=true to execute.",
    { backupName: importedBackupNameSchema.describe("Imported backup name") },
    async (params) => withOperationHint(await call("DELETE", `${V1}/imported-backups/${enc(params.backupName)}`), "imported-backups"),
    { destructive: { noun: "imported backup", describe: (p) => p.backupName } }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // User
  // ═══════════════════════════════════════════════════════════════════════════

  const userEntry = z.object({
    name: userNameSchema,
    password: passwordSchema,
    permission: z.enum(PERMISSIONS).describe("READ (select) | CRUD (select/insert/update/delete) | DDL (CRUD + schema changes)"),
  });

  defineTool(
    server,
    "ncloud_serverless_list_users",
    "List DB users of a Cloud DB Serverless cluster (GET /mysql/v1/clusters/{clusterName}/users): name, permission. Passwords are never returned.",
    { clusterName: clusterNameSchema, ...pageParams },
    async (params) => { const { clusterName, ...q } = params; return call("GET", withQuery(`${clusterPath(clusterName)}/users`, q)); }
  );

  defineTool(
    server,
    "ncloud_serverless_get_user",
    "Get one DB user (GET /mysql/v1/clusters/{clusterName}/users/{userName}).",
    { clusterName: clusterNameSchema, userName: userNameSchema },
    async (params) => call("GET", `${clusterPath(params.clusterName)}/users/${enc(params.userName)}`)
  );

  defineTool(
    server,
    "ncloud_serverless_create_user",
    "Create a DB user (POST /mysql/v1/clusters/{clusterName}/users → 202 Operation). 409 if the name exists.",
    { clusterName: clusterNameSchema, ...userEntry.shape },
    async (params) => {
      const { clusterName, ...body } = params;
      return withOperationHint(await call("POST", `${clusterPath(clusterName)}/users`, body), "users", clusterName);
    }
  );

  defineTool(
    server,
    "ncloud_serverless_update_user",
    "Change a DB user's password and/or permission (PATCH /mysql/v1/clusters/{clusterName}/users/{userName}, merge-patch → 202 Operation). The name cannot be changed.",
    {
      clusterName: clusterNameSchema,
      userName: userNameSchema,
      password: passwordSchema.optional(),
      permission: z.enum(PERMISSIONS).optional(),
    },
    async (params) => {
      const { clusterName, userName, ...body } = params;
      stripUndefined(body);
      if (Object.keys(body).length === 0) return problem(L({ ko: "password 또는 permission 중 하나 이상을 지정하세요.", en: "Give password and/or permission." }));
      return withOperationHint(await call("PATCH", `${clusterPath(clusterName)}/users/${enc(userName)}`, body), "users", clusterName);
    }
  );

  defineTool(
    server,
    "ncloud_serverless_delete_user",
    "⚠️ Destructive: Delete a DB user (DELETE /mysql/v1/clusters/{clusterName}/users/{userName} → 202 Operation). The reserved admin user cannot be deleted (400). Set confirm=true to execute.",
    { clusterName: clusterNameSchema, userName: userNameSchema },
    async (params) => withOperationHint(await call("DELETE", `${clusterPath(params.clusterName)}/users/${enc(params.userName)}`), "users", params.clusterName),
    { destructive: { noun: "DB user", describe: (p) => `${p.userName} on ${p.clusterName}` } }
  );

  defineTool(
    server,
    "ncloud_serverless_batch_create_users",
    "Create 1-10 DB users atomically (POST /mysql/v1/clusters/{clusterName}/users/batch-create → 202 Operation). Validation failures come back as 400 partialFailure with per-index failures; an existing name fails the whole batch (409). Use dryRun=true to preview (passwords masked).",
    {
      clusterName: clusterNameSchema,
      users: z.array(userEntry).min(1).max(10).describe("Users to create (1-10)"),
      dryRun: z.boolean().optional().default(false),
    },
    async (params) => {
      const body = { users: params.users };
      const endpoint = `${clusterPath(params.clusterName)}/users/batch-create`;
      if (params.dryRun) return dryRunPreview({ label: "🔍 Dry-Run Preview: Batch User Creation", endpoint, method: "POST", requestParams: body, noun: { ko: "DB 사용자", en: "DB users" } });
      return withOperationHint(await call("POST", endpoint, body), "users", params.clusterName);
    }
  );

  defineTool(
    server,
    "ncloud_serverless_batch_delete_users",
    "⚠️ Destructive: Delete 1-10 DB users atomically (POST /mysql/v1/clusters/{clusterName}/users/batch-delete → 202 Operation). Set confirm=true to execute.",
    { clusterName: clusterNameSchema, names: z.array(userNameSchema).min(1).max(10).describe("User names to delete (1-10)") },
    async (params) => withOperationHint(await call("POST", `${clusterPath(params.clusterName)}/users/batch-delete`, { names: params.names }), "users", params.clusterName),
    { destructive: { noun: "DB users", describe: (p) => `${p.names.join(", ")} on ${p.clusterName}` } }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Database
  // ═══════════════════════════════════════════════════════════════════════════

  defineTool(
    server,
    "ncloud_serverless_list_databases",
    "List databases of a Cloud DB Serverless cluster (GET /mysql/v1/clusters/{clusterName}/databases). Up to 1,000 databases per cluster.",
    { clusterName: clusterNameSchema, ...pageParams },
    async (params) => { const { clusterName, ...q } = params; return call("GET", withQuery(`${clusterPath(clusterName)}/databases`, q)); }
  );

  defineTool(
    server,
    "ncloud_serverless_get_database",
    "Check that a database exists (GET /mysql/v1/clusters/{clusterName}/databases/{databaseName}; 404 if not).",
    { clusterName: clusterNameSchema, databaseName: databaseNameSchema },
    async (params) => call("GET", `${clusterPath(params.clusterName)}/databases/${enc(params.databaseName)}`)
  );

  defineTool(
    server,
    "ncloud_serverless_create_database",
    "Create a database (POST /mysql/v1/clusters/{clusterName}/databases → 202 Operation). Reserved schema names are rejected.",
    { clusterName: clusterNameSchema, name: databaseNameSchema.describe("Database name") },
    async (params) => withOperationHint(await call("POST", `${clusterPath(params.clusterName)}/databases`, { name: params.name }), "databases", params.clusterName)
  );

  defineTool(
    server,
    "ncloud_serverless_delete_database",
    "⚠️ Destructive: Drop a database and ALL its data (DELETE /mysql/v1/clusters/{clusterName}/databases/{databaseName} → 202 Operation). Set confirm=true to execute.",
    { clusterName: clusterNameSchema, databaseName: databaseNameSchema },
    async (params) => withOperationHint(await call("DELETE", `${clusterPath(params.clusterName)}/databases/${enc(params.databaseName)}`), "databases", params.clusterName),
    { destructive: { action: "drop", noun: "database and all its data", describe: (p) => `${p.databaseName} on ${p.clusterName}` } }
  );

  defineTool(
    server,
    "ncloud_serverless_batch_create_databases",
    "Create 1-10 databases atomically (POST /mysql/v1/clusters/{clusterName}/databases/batch-create → 202 Operation).",
    { clusterName: clusterNameSchema, names: z.array(databaseNameSchema).min(1).max(10).describe("Database names (1-10)") },
    async (params) => withOperationHint(await call("POST", `${clusterPath(params.clusterName)}/databases/batch-create`, { databases: params.names.map((name) => ({ name })) }), "databases", params.clusterName)
  );

  defineTool(
    server,
    "ncloud_serverless_batch_delete_databases",
    "⚠️ Destructive: Drop 1-10 databases and all their data atomically (POST /mysql/v1/clusters/{clusterName}/databases/batch-delete → 202 Operation). Set confirm=true to execute.",
    { clusterName: clusterNameSchema, names: z.array(databaseNameSchema).min(1).max(10).describe("Database names to drop (1-10)") },
    async (params) => withOperationHint(await call("POST", `${clusterPath(params.clusterName)}/databases/batch-delete`, { names: params.names }), "databases", params.clusterName),
    { destructive: { action: "drop", noun: "databases and all their data", describe: (p) => `${p.names.join(", ")} on ${p.clusterName}` } }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Config (DB parameters)
  // ═══════════════════════════════════════════════════════════════════════════

  defineTool(
    server,
    "ncloud_serverless_get_config",
    "Get the DB parameters a user has changed on a cluster (GET /mysql/v1/clusters/{clusterName}/config) — only overrides, as strings. For every parameter with defaults and current values use ncloud_serverless_list_config_parameters.",
    { clusterName: clusterNameSchema },
    async (params) => call("GET", `${clusterPath(params.clusterName)}/config`)
  );

  defineTool(
    server,
    "ncloud_serverless_list_config_parameters",
    "List DB parameters with defaultValue, currentValue (null = unchanged), allowed range/list and whether they are dynamic — changeable without restart (GET /mysql/v1/clusters/{clusterName}/config/parameters).",
    { clusterName: clusterNameSchema, name: z.string().optional().describe("Only this parameter"), ...pageParams },
    async (params) => { const { clusterName, ...q } = params; return call("GET", withQuery(`${clusterPath(clusterName)}/config/parameters`, q)); }
  );

  defineTool(
    server,
    "ncloud_serverless_update_config",
    "Change DB parameters (PATCH /mysql/v1/clusters/{clusterName}/config, merge-patch → 202 Operation). applyWithoutRestart defaults to TRUE here (the API default is false = DB restart); with true, non-dynamic parameters are rejected with 400 — set applyWithoutRestart=false to accept a restart. Use dryRun=true to preview.",
    {
      clusterName: clusterNameSchema,
      parameters: z.record(z.string()).refine((p) => Object.keys(p).length > 0, { message: "parameters must not be empty" }).describe("Parameter name → value (strings)"),
      applyWithoutRestart: z.boolean().optional().default(true).describe("true (tool default) = only dynamic parameters, no restart; false = allow non-dynamic parameters, the DB restarts"),
      dryRun: z.boolean().optional().default(false),
    },
    async (params) => {
      const endpoint = withQuery(`${clusterPath(params.clusterName)}/config`, { applyWithoutRestart: params.applyWithoutRestart });
      const body = { parameters: params.parameters };
      if (params.dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: DB Parameter Update", endpoint, method: "PATCH", requestParams: body, noun: { ko: "DB 파라미터", en: "DB parameters" }, verb: "apply",
          notes: params.applyWithoutRestart ? {} : { warning: L({ ko: "applyWithoutRestart=false — 적용 시 DB 가 재시작됩니다.", en: "applyWithoutRestart=false — the DB restarts when applied." }) },
        });
      }
      return withOperationHint(await call("PATCH", endpoint, body), "config", params.clusterName);
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Log
  // ═══════════════════════════════════════════════════════════════════════════

  const rotationSchema = z.object({
    rotationType: z.enum(["DAILY", "SIZE"]),
    fileCount: z.number().int().min(3).max(10).describe("Files to keep (3-10)"),
    megaBytes: z.number().int().min(10).max(100).optional().describe("Rotate at N MB (SIZE only; 10-100, multiple of 10)"),
  }).refine((r) => r.rotationType !== "SIZE" || (r.megaBytes !== undefined && r.megaBytes % 10 === 0), { message: "megaBytes (multiple of 10) is required for rotationType=SIZE" });

  defineTool(
    server,
    "ncloud_serverless_get_log_config",
    "Get log rotation settings per log type (GET /mysql/v1/clusters/{clusterName}/log-config): rotations[BIN|SLOW_QUERY|ERROR|GENERAL] → rotationType DAILY|SIZE, fileCount, megaBytes.",
    { clusterName: clusterNameSchema },
    async (params) => call("GET", `${clusterPath(params.clusterName)}/log-config`)
  );

  defineTool(
    server,
    "ncloud_serverless_update_log_config",
    "Change log rotation for the given log types (PATCH /mysql/v1/clusters/{clusterName}/log-config, merge-patch; the only synchronous write — returns 200 with the new settings).",
    {
      clusterName: clusterNameSchema,
      rotations: z.record(z.enum(LOG_TYPES), rotationSchema).refine((r) => Object.keys(r).length > 0, { message: "rotations must not be empty" }).describe("logType → rotation settings (only the given types change)"),
    },
    async (params) => call("PATCH", `${clusterPath(params.clusterName)}/log-config`, { rotations: params.rotations }),
    { annotations: { destructiveHint: false, idempotentHint: true } }
  );

  defineTool(
    server,
    "ncloud_serverless_list_logs",
    "List log files of an instance (GET /mysql/v1/clusters/{clusterName}/instances/{instanceName}/logs): name, logType, fileSize, lastModifiedDateTime, lastFile (currently written). Sort fields: name, lastModifiedDateTime, fileSize.",
    { clusterName: clusterNameSchema, instanceName: instanceNameSchema, logType: z.enum(LOG_TYPES).optional().describe("Filter by log type"), ...pageParams },
    async (params) => { const { clusterName, instanceName, ...q } = params; return call("GET", withQuery(`${instancePath(clusterName, instanceName)}/logs`, q)); }
  );

  const logRef = z.object({ name: z.string().describe("Log file name (e.g. slow-query.log.1)"), logType: z.enum(LOG_TYPES) });

  defineTool(
    server,
    "ncloud_serverless_batch_delete_logs",
    "⚠️ Destructive: Delete 1-10 log files of an instance atomically (POST …/logs/batch-delete → 202 Operation). BIN logs cannot be deleted. Set confirm=true to execute.",
    { clusterName: clusterNameSchema, instanceName: instanceNameSchema, logs: z.array(logRef).min(1).max(10).describe("Log files to delete (1-10)") },
    async (params) => {
      if (params.logs.some((l) => l.logType === "BIN")) return problem(L({ ko: "BIN 로그는 삭제할 수 없습니다.", en: "BIN logs cannot be deleted." }));
      return withOperationHint(await call("POST", `${instancePath(params.clusterName, params.instanceName)}/logs/batch-delete`, { logs: params.logs }), "logs", params.clusterName, params.instanceName);
    },
    { destructive: { noun: "log files", describe: (p) => `${p.logs.map((l: any) => l.name).join(", ")} on ${p.clusterName}/${p.instanceName}` } }
  );

  defineTool(
    server,
    "ncloud_serverless_export_logs",
    "Export 1-10 log files of an instance to Object Storage (POST …/logs/export → 202 Operation). Requires an Object Storage subscription.",
    {
      clusterName: clusterNameSchema,
      instanceName: instanceNameSchema,
      logs: z.array(logRef).min(1).max(10).describe("Log files to export (1-10)"),
      bucketName: z.string({ required_error: requiredError("bucketName") }).describe("Destination bucket"),
      uploadPath: z.string().optional().describe("Path inside the bucket (default root, e.g. logs/2026)"),
    },
    async (params) => {
      const body: Record<string, unknown> = { logs: params.logs, bucketName: params.bucketName };
      if (params.uploadPath !== undefined) body.uploadPath = params.uploadPath;
      return withOperationHint(await call("POST", `${instancePath(params.clusterName, params.instanceName)}/logs/export`, body), "logs", params.clusterName, params.instanceName);
    },
    { annotations: { destructiveHint: false } }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Event / Engine version
  // ═══════════════════════════════════════════════════════════════════════════

  defineTool(
    server,
    "ncloud_serverless_list_events",
    "List cluster events (GET /mysql/v1/clusters/{clusterName}/events). filter: AND-only expressions (≤10 conditions, no parentheses/OR) over eventType (=), clusterDeleted (=), createdDateTime (>=, <=), e.g. eventType = \"BACKUP\" AND createdDateTime >= \"2026-07-01T00:00:00Z\". eventType: CLUSTER|DB|BACKUP|FAILOVER|ACCOUNT|SCALING_IN_OUT|SCALING_UP_DOWN.",
    { clusterName: clusterNameSchema, filter: z.string().max(1024).optional().describe("Filter expression (see description)"), ...pageParams },
    async (params) => { const { clusterName, ...q } = params; return call("GET", withQuery(`${clusterPath(clusterName)}/events`, q)); }
  );

  defineTool(
    server,
    "ncloud_serverless_list_engine_versions",
    "List MySQL engine versions available for Cloud DB Serverless (GET /mysql/v1/engine-versions), ascending.",
    {},
    async () => call("GET", `${V1}/engine-versions`)
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Operation (16 documented endpoints → 2 tools routed by resourceType)
  // ═══════════════════════════════════════════════════════════════════════════

  const resourceTypeParam = z.enum(RESOURCE_TYPES).describe("metadata.resourceType of the operation: clusters | imported-backups (no clusterName) | backups | users | databases | config (clusterName) | logs | processes (clusterName + instanceName)");

  defineTool(
    server,
    "ncloud_serverless_get_operation",
    "Get an asynchronous operation (the 16 documented get*Operation endpoints, routed by resourceType): done, metadata.operationType/resourceType/progress, results (cluster operations only), error, failures (batch). Poll until done=true; success = done and no error.",
    {
      resourceType: resourceTypeParam,
      operationId: operationIdSchema,
      clusterName: clusterNameSchema.optional().describe("Required for backups/users/databases/config/logs/processes"),
      instanceName: instanceNameSchema.optional().describe("Required for logs/processes"),
    },
    async (params) => {
      const r = operationBasePath(params.resourceType, params.clusterName, params.instanceName);
      if (!r.path) return problem(r.problem!);
      return call("GET", `${r.path}/${enc(params.operationId)}`);
    }
  );

  defineTool(
    server,
    "ncloud_serverless_list_operations",
    "List asynchronous operations of a resource type (the 16 documented list*Operations endpoints, routed by resourceType). clusters and imported-backups are account-wide (filter cluster operations client-side by results[\"0\"].name). Sort fields: startDateTime, endDateTime, operationType.",
    {
      resourceType: resourceTypeParam,
      clusterName: clusterNameSchema.optional().describe("Required for backups/users/databases/config/logs/processes"),
      instanceName: instanceNameSchema.optional().describe("Required for logs/processes"),
      operationType: z.enum(OPERATION_TYPES).optional().describe("Filter by CREATE | UPDATE | DELETE"),
      ...pageParams,
    },
    async (params) => {
      const { resourceType, clusterName, instanceName, ...q } = params;
      const r = operationBasePath(resourceType, clusterName, instanceName);
      if (!r.path) return problem(r.problem!);
      return call("GET", withQuery(r.path, q));
    }
  );
}
