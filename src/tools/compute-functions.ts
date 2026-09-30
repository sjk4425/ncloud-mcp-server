import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { toolText } from "./_response.js";
import { defineTool } from "./_tool.js";
import { dryRunPreview } from "./_dryrun.js";
import { L } from "./_messages.js";
import { redactAtPath, redactSecrets } from "./_secrets.js";

/**
 * Cloud Functions API — 존별로 버전이 다르다.
 *
 * - **민간존: v2.1** (`/ncf/api/v2/...`, mcp-test-report-20260915 F-01). v2.0 경로는 `/api/v2/...`이며
 *   Base URL은 같다. 이 파일은 한때 v2.0 경로에 v2.0/v2.1 어느 쪽과도 맞지 않는 본문을 실어 보내고
 *   있었다(`raw_http`/`custom_options` 밑줄 표기, `vpc_no`/`subnet_no` 최상위 필드, 트리거 본문의
 *   `trigger` 래퍼, `/link` + `actionName`). 읽기 API는 본문이 없어 v2.0 경로에서도 동작했고
 *   쓰기만 전부 실패한 것이 그래서다. 스펙: https://api.ncloud-docs.com/docs/compute-cloudfunctions
 *   (개별 op 페이지는 `compute-cloudfunctions-v2-*`).
 * - **공공존: v2.0만 제공** (`/api/v2/...`, Classic 전용). 스펙: https://api-gov.ncloud-docs.com/docs/compute-cloudfunctions
 *   (개별 op 페이지는 `compute-cloudfunctions-*`, 2026-08-20 판). v2.1과의 차이:
 *     · `platform` 쿼리 없음(Classic 고정), 액션 `vpc` 배열 없음, Custom Image 런타임 없음
 *     · 액션 유형은 `type` 쿼리가 아니라 본문 `web`(true=웹 액션) — sequence는 `exec.kind="sequence"`
 *     · 트리거 본문은 `{ trigger: {...}, link? }` 래퍼, 유형은 `cron`·`github`뿐,
 *       GitHub 자격증명 키는 `credentials`(v2.1은 `credential`), link는 `productId`(v2.1은 `productName`)
 *     · activations 의 `start`/`end`는 밀리초가 아니라 `yyyy-MM-ddTHH:mm:ss`(KST) 문자열
 *   레지스트리가 `zone === "gov"`일 때 `{ apiVersion: "2.0" }`으로 등록한다.
 */
export type CloudFunctionsApiVersion = "2.1" | "2.0";
export interface CloudFunctionsOptions {
  /** 기본 `"2.1"`(민간존). 공공존은 `"2.0"`. */
  apiVersion?: CloudFunctionsApiVersion;
}

const CF_V21 = "/ncf/api/v2";
const CF_V20 = "/api/v2";

/** 문서상 명시된 런타임(guide: cloudfunctions-spec-runtime, 2026-07 기준). */
const SUPPORTED_RUNTIMES = ["nodejs:22", "python:3.13", "java", "java:21", "swift:3.1.1", "php:7.3", "go:1.19", "dotnet:2.2", "custom image"];
/** 2025-09-18 지원 종료 — 종료 후 **신규 액션 생성이 금지**된다(기존 액션은 동작). */
const DEPRECATED_RUNTIMES = ["nodejs:6", "nodejs:8", "nodejs:12", "nodejs:16", "python:3.6", "python:3.7", "python:3.11", "php:7.1", "go:1.11"];

/** 5필드 UNIX cron(분 시 일 월 요일). 이름(MON/JAN)·`*`·범위·스텝·목록 허용. */
const CRON_5_FIELDS = /^\s*(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*$/;
const CRON_FIELD = /^[A-Za-z0-9*,\-/?]+$/;

function fail(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

/** 경로용 이름 인코딩. 패키지 없음 표기 `-`는 그대로 둔다. */
const enc = (s: string) => encodeURIComponent(s);

/** 밀리초 epoch → v2.0 activations 가 요구하는 `yyyy-MM-ddTHH:mm:ss`(KST, UTC+9). */
export function toKstDateTime(ms: number): string {
  return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 19);
}

export function registerCloudFunctionsTools(server: McpServer, client: NcloudClient, opts: CloudFunctionsOptions = {}): void {
  const apiVersion: CloudFunctionsApiVersion = opts.apiVersion ?? "2.1";
  const v20 = apiVersion === "2.0";
  const CF = v20 ? CF_V20 : CF_V21;
  const VER = v20 ? `API v2.0 (${CF}, Government zone — Classic only)` : `API v2.1 (${CF})`;
  const CRON_GUIDE = v20 ? "guide-gov.ncloud-docs.com/docs/cloudfunctions-cron-classic" : "guide.ncloud-docs.com/docs/cloudfunctions-cron-vpc";
  const CRON_NOTE_EN =
    `cronOption is a 5-field UNIX cron expression: 'minute hour day-of-month month day-of-week' (e.g. '0 8 * * *' = 08:00 daily, '*/5 * * * *' = every 5 minutes). The expression is evaluated in KST (Asia/Seoul, UTC+9) — live-verified on 2026-09-15 in the KR region (public zone): a trigger set to '41 22 * * *' fired at 22:41:00 KST. The official guide (${CRON_GUIDE}) does not document the time zone, so re-verify with a probe trigger before relying on it in another region.`;

  // v2.0(공공존)은 Classic 전용이라 platform 쿼리 자체가 없다 — 스키마 키는 유지하되 classic 만 받고 전송하지 않는다.
  const platformSchema = z
    .enum((v20 ? ["classic"] : ["vpc", "classic"]) as unknown as ["vpc", "classic"])
    .optional()
    .default(v20 ? "classic" : "vpc")
    .describe(
      v20
        ? "Platform. Government-zone Cloud Functions (API v2.0) is Classic-only; 'classic' is the only value and it is not sent as a query parameter."
        : "Platform (default: vpc). Singapore/Japan regions support vpc only."
    );
  /** 공통 쿼리: v2.1 은 `platform`, v2.0 은 없음. */
  const pq = (platform: string, extra: Record<string, string> = {}): Record<string, string> =>
    v20 ? extra : { platform, ...extra };

  // ─── Package Management Tools ──────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_functions_list_packages",
    `List all Cloud Functions packages (${VER})`,
    { platform: platformSchema },
    async (params) => client.requestRaw("GET", `${CF}/packages`, pq(params.platform))
  );

  defineTool(
    server,
    "ncloud_functions_get_package",
    "Get a Cloud Functions package: description, default parameters, platform and the actions it contains",
    {
      packageName: z.string().describe("Name of the package to retrieve"),
      platform: platformSchema,
    },
    async (params) => client.requestRaw("GET", `${CF}/packages/${enc(params.packageName)}`, pq(params.platform))
  );

  defineTool(
    server,
    "ncloud_functions_create_package",
    "Create or update a Cloud Functions package (PUT — idempotent). Name: 1-50 chars of letters, digits, '-' and '_', must not start with '-', and must be unique across packages/actions/triggers.",
    {
      packageName: z.string().min(1).max(50).describe("Name of the package to create or update"),
      platform: platformSchema,
      description: z.string().max(3000).optional().describe("Description (0-3000 bytes)"),
      parameters: z.record(z.unknown()).optional().describe("Default parameters as a {key: value} JSON object. Lowest precedence: runtime params > trigger params > action params > package params."),
      dryRun: z.boolean().optional().default(false).describe("Preview the request without calling the API"),
    },
    async (params) => {
      const queryParams = pq(params.platform);
      // 본문에 필드가 없어도 `{}`를 보내야 한다(스펙 명시).
      const body: Record<string, unknown> = {};
      if (params.description !== undefined) body.description = params.description;
      if (params.parameters !== undefined) body.parameters = params.parameters;
      const endpoint = `${CF}/packages/${enc(params.packageName)}`;
      if (params.dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: Cloud Functions Package (PUT)",
          endpoint,
          method: "PUT",
          requestParams: { query: queryParams, body },
          noun: { ko: "패키지", en: "package" },
        });
      }
      return client.requestRaw("PUT", endpoint, queryParams, body);
    }
  );

  defineTool(
    server,
    "ncloud_functions_delete_package",
    "⚠️ Destructive: Permanently delete a Cloud Functions package. Fails with 409 PACKAGE_NOT_EMPTY while the package still contains actions — delete those first. Set confirm=true to execute.",
    {
      packageName: z.string().describe("Name of the package to delete"),
      platform: platformSchema,
      confirm: z.boolean().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const result = await client.requestRaw("DELETE", `${CF}/packages/${enc(params.packageName)}`, pq(params.platform));
      return result ? toolText(result) : { content: [{ type: "text" as const, text: "Package deleted successfully (204 No Content)" }] };
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete Cloud Functions package [${params.packageName}]. The API refuses if the package still contains actions.\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Action Management Tools ───────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_functions_list_actions",
    "List actions in a package: name, type (basic/web/sequence/sequence-web), runtime, description. Use '-' for actions that belong to no package.",
    {
      packageName: z.string().default("-").describe("Package name ('-' = unpackaged actions)"),
      platform: platformSchema,
    },
    async (params) => client.requestRaw("GET", `${CF}/packages/${enc(params.packageName)}/actions`, pq(params.platform))
  );

  defineTool(
    server,
    "ncloud_functions_get_action",
    "Get an action's full definition including its source code. Secrets found in the code (hard-coded access/secret keys, passwords, tokens, PEM keys) are REDACTED by default and the response carries secretsRedacted=true with the count; pass includeSecrets=true only if you genuinely need the raw values.",
    {
      packageName: z.string().default("-").describe("Package name ('-' = unpackaged action)"),
      actionName: z.string().describe("Name of the action to retrieve"),
      platform: platformSchema,
      includeSecrets: z.boolean().optional().default(false).describe("Return source code unredacted (default false). Even when true, the response still reports how many secret-like values were detected."),
    },
    async (params) => {
      const result = await client.requestRaw(
        "GET",
        `${CF}/packages/${enc(params.packageName)}/actions/${enc(params.actionName)}`,
        pq(params.platform)
      );
      return annotateActionSecrets(result, params.includeSecrets);
    }
  );

  defineTool(
    server,
    "ncloud_functions_create_action",
    [
      `Create or update a Cloud Functions action (PUT, ${VER} — idempotent; the same call updates an existing action).`,
      v20
        ? "type selects the action kind and CANNOT be changed after creation: basic (default) | web | sequence | sequence-web. In API v2.0 the kind is sent as the body field `web` (true for web/sequence-web); there is no `type` query parameter."
        : "type selects the action kind and CANNOT be changed after creation: basic (default) | web | sequence | sequence-web.",
      v20
        ? "basic/web: exec_kind, exec_code and exec_main are required; limits_timeout/limits_memory default to 60000 ms / 128 MB. Government-zone Cloud Functions is Classic-only: vpc_no/subnet_no are not accepted and 'custom image' is not available."
        : "basic/web: exec_kind, exec_code and exec_main are required; limits_timeout/limits_memory default to 60000 ms / 128 MB; on platform=vpc the action MUST be attached to a VPC + Subnet (vpc_no, subnet_no).",
      "sequence/sequence-web: pass exec_components as ['{packageName}/{actionName}', ...] (use '-' for unpackaged actions); exec_kind is forced to 'sequence'.",
      `Runtimes (exec_kind): ${SUPPORTED_RUNTIMES.join(", ")}. Deprecated since 2025-09-18 and refused for NEW actions: ${DEPRECATED_RUNTIMES.join(", ")}. java/dotnet accept only base64 binaries (.jar / .zip) with exec_binary=true.${v20 ? "" : " 'custom image' requires exec_imageUri ('{registryName}/{imageName}:{tag}')."}`,
      "Use dryRun=true to see the exact request without calling the API.",
    ].join(" "),
    {
      packageName: z.string().default("-").describe("Package name ('-' = unpackaged action)"),
      actionName: z.string().min(1).max(50).describe("Action name: 1-50 chars of letters, digits, '-' and '_'; must not start with '-'; unique across packages/actions/triggers"),
      platform: platformSchema,
      type: z.enum(["basic", "web", "sequence", "sequence-web"]).optional().default("basic").describe(v20 ? "Action type (sent as body field `web` in API v2.0). Cannot be changed once created." : "Action type (query parameter). Cannot be changed once created."),
      exec_kind: z.string().optional().describe(`Runtime, e.g. 'python:3.13', 'nodejs:22', 'java:21'${v20 ? "" : ", 'custom image'"}. Ignored for sequence types (forced to 'sequence'). Supported: ${SUPPORTED_RUNTIMES.join(", ")}`),
      exec_code: z.string().optional().describe("Source code (exec_binary=false) or base64-encoded file (exec_binary=true). Required for basic/web unless exec_kind is 'custom image'."),
      exec_binary: z.boolean().optional().default(false).describe("true if exec_code is a base64-encoded file (required for java/dotnet: .jar / .zip)"),
      exec_main: z.string().optional().describe("Entry function name, e.g. 'main'. Required for basic/web."),
      exec_imageUri: z.string().optional().describe(v20 ? "Not available in API v2.0 (Custom Image runtime is v2.1 only)" : "Custom Image runtime only: '{registryName}/{imageName}:{tag}' (tag defaults to latest)"),
      exec_components: z.array(z.string()).optional().describe("sequence/sequence-web only: actions to run in order, each '{packageName}/{actionName}'"),
      limits_timeout: z.number().int().min(500).max(300000).optional().default(60000).describe("Max execution time in ms, 500-300000 (default 60000). basic/web only."),
      limits_memory: z.union([z.literal(128), z.literal(256), z.literal(512), z.literal(1024)]).optional().default(128).describe("Memory in MB: 128 | 256 | 512 | 1024 (default 128). basic/web only."),
      description: z.string().max(3000).optional().describe("Description (0-3000 bytes)"),
      parameters: z.record(z.unknown()).optional().describe("Default parameters as a {key: value} JSON object (basic/web only). Precedence: runtime params > trigger params > action params > package params."),
      raw_http: z.boolean().optional().describe("web types only: pass the raw HTTP request to the action (sent as 'raw-http')"),
      custom_options: z.boolean().optional().describe("web types only: let the action set HTTP response headers (sent as 'custom-options')"),
      vpc_no: z.number().int().optional().describe(v20 ? "Not accepted in API v2.0 (Government-zone Cloud Functions is Classic-only)" : "VPC number to attach (REQUIRED for basic/web on platform=vpc; see ncloud_list_vpcs)"),
      subnet_no: z.number().int().optional().describe(v20 ? "Not accepted in API v2.0 (Government-zone Cloud Functions is Classic-only)" : "Subnet number to attach (REQUIRED for basic/web on platform=vpc; see ncloud_list_subnets)"),
      allowDeprecatedRuntime: z.boolean().optional().default(false).describe("Send a deprecated exec_kind anyway (the API is documented to refuse new actions on them)"),
      dryRun: z.boolean().optional().default(false).describe("Preview the request without calling the API"),
    },
    async (params) => {
      const isSequence = params.type === "sequence" || params.type === "sequence-web";
      const isWeb = params.type === "web" || params.type === "sequence-web";
      const queryParams = v20 ? {} : { platform: params.platform, type: params.type };
      const body: Record<string, unknown> = {};
      if (params.description !== undefined) body.description = params.description;
      // v2.0: 액션 유형은 본문 `web`. 생성 시 기본 false / 수정 시 기본 true 라 항상 명시해 보낸다.
      if (v20) body.web = isWeb;

      if (v20 && (params.vpc_no !== undefined || params.subnet_no !== undefined)) {
        return fail("Government-zone Cloud Functions (API v2.0) is Classic-only — vpc_no/subnet_no are not accepted. Remove them.");
      }

      if (isSequence) {
        if (!params.exec_components || params.exec_components.length === 0) {
          return fail(`type=${params.type} requires exec_components (['{packageName}/{actionName}', ...]).`);
        }
        const bad = params.exec_components.filter((c) => !/^[^/\s]+\/[^/\s]+$/.test(c));
        if (bad.length > 0) {
          return fail(`exec_components entries must be '{packageName}/{actionName}' (use '-' for unpackaged actions). Invalid: ${bad.join(", ")}`);
        }
        body.exec = { kind: "sequence", components: params.exec_components };
      } else {
        if (!params.exec_kind) return fail(`type=${params.type} requires exec_kind (one of: ${SUPPORTED_RUNTIMES.join(", ")}).`);
        const kind = params.exec_kind.trim();
        if (DEPRECATED_RUNTIMES.includes(kind) && !params.allowDeprecatedRuntime) {
          return fail(
            `exec_kind '${kind}' reached end of support on 2025-09-18 — the API refuses NEW actions on it (existing actions keep running). ` +
              `Use a supported runtime (${SUPPORTED_RUNTIMES.join(", ")}) or pass allowDeprecatedRuntime=true to send it anyway.`
          );
        }
        const isCustomImage = kind.toLowerCase() === "custom image";
        if (isCustomImage && v20) return fail("exec_kind 'custom image' is available in API v2.1 only — Government-zone Cloud Functions (v2.0) does not support it.");
        if (isCustomImage && !params.exec_imageUri) return fail("exec_kind 'custom image' requires exec_imageUri ('{registryName}/{imageName}:{tag}').");
        if (!isCustomImage && (params.exec_code === undefined || !params.exec_main)) {
          return fail(`type=${params.type} requires exec_code and exec_main.`);
        }
        if (/^(java|dotnet)/.test(kind) && !params.exec_binary) {
          return fail(`exec_kind '${kind}' accepts only a base64-encoded archive (.jar / .zip): set exec_binary=true and put the base64 in exec_code.`);
        }
        if (!v20 && params.platform === "vpc" && (params.vpc_no === undefined || params.subnet_no === undefined)) {
          return fail("platform=vpc basic/web actions must be attached to a network: vpc_no and subnet_no are both required (ncloud_list_vpcs / ncloud_list_subnets).");
        }
        if (params.platform === "classic" && (params.vpc_no !== undefined || params.subnet_no !== undefined)) {
          return fail("vpc_no/subnet_no apply to platform=vpc only — remove them for a classic action.");
        }

        const exec: Record<string, unknown> = { kind, binary: params.exec_binary };
        if (params.exec_code !== undefined) exec.code = params.exec_code;
        if (params.exec_main !== undefined) exec.main = params.exec_main;
        if (params.exec_imageUri !== undefined) exec.imageUri = params.exec_imageUri;
        body.exec = exec;
        body.limits = { timeout: params.limits_timeout, memory: params.limits_memory };
        if (params.parameters !== undefined) body.parameters = params.parameters;
        if (!v20 && params.platform === "vpc") body.vpc = [{ vpcNo: params.vpc_no, subnetNo: params.subnet_no }];
      }

      if (params.raw_http !== undefined || params.custom_options !== undefined) {
        if (!isWeb) return fail(`raw_http / custom_options are valid for web and sequence-web actions only (type=${params.type}).`);
        // 스펙 필드명은 하이픈 표기다 — 밑줄(`raw_http`)로 보내면 무시된다.
        if (params.raw_http !== undefined) body["raw-http"] = params.raw_http;
        if (params.custom_options !== undefined) body["custom-options"] = params.custom_options;
      }

      const endpoint = `${CF}/packages/${enc(params.packageName)}/actions/${enc(params.actionName)}`;
      if (params.dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: Cloud Functions Action (PUT)",
          endpoint,
          method: "PUT",
          requestParams: { query: queryParams, body },
          noun: { ko: "액션", en: "action" },
          notes: {
            note: L({
              ko: "PUT은 생성·수정 공용입니다. 같은 이름의 액션이 있으면 수정되며, type은 변경할 수 없습니다.",
              en: "PUT creates or updates. An existing action with this name is updated; its type cannot change.",
            }),
          },
        });
      }
      const result = await client.requestRaw("PUT", endpoint, queryParams, body);
      // 응답이 코드를 다시 실어 준다 — 호출자가 방금 보낸 것이므로 시크릿은 가린 채 돌려준다.
      return annotateActionSecrets(result, false);
    }
  );

  defineTool(
    server,
    "ncloud_functions_delete_action",
    "⚠️ Destructive: Permanently delete a Cloud Functions action. Set confirm=true to execute.",
    {
      packageName: z.string().default("-").describe("Package name ('-' = unpackaged action)"),
      actionName: z.string().describe("Name of the action to delete"),
      platform: platformSchema,
      confirm: z.boolean().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const result = await client.requestRaw(
        "DELETE",
        `${CF}/packages/${enc(params.packageName)}/actions/${enc(params.actionName)}`,
        pq(params.platform)
      );
      return result ? toolText(result) : { content: [{ type: "text" as const, text: "Action deleted successfully (204 No Content)" }] };
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete Cloud Functions action [${params.actionName}] from package [${params.packageName}].\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Action Invocation Tools ───────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_functions_invoke_action",
    "Invoke an action synchronously and return its result (activationId, duration, response.result). If the action runs longer than `timeout`, only the activationId is returned — fetch the outcome later with ncloud_functions_get_action_activation_detail. web/sequence-web actions cannot handle raw HTTP here; use an API Gateway trigger for that.",
    {
      packageName: z.string().default("-").describe("Package name ('-' = unpackaged action)"),
      actionName: z.string().describe("Name of the action to invoke"),
      platform: platformSchema,
      timeout: z.number().int().min(0).max(60000).optional().default(60000).describe("Max time to wait for the response in ms (0-60000, default 60000)"),
      params: z.record(z.unknown()).optional().describe("Runtime parameters passed to the action (highest precedence)"),
    },
    async (params) =>
      client.requestRaw(
        "POST",
        `${CF}/packages/${enc(params.packageName)}/actions/${enc(params.actionName)}`,
        pq(params.platform, { timeout: String(params.timeout) }),
        params.params ?? {}
      )
  );

  // ─── Trigger Management Tools ──────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_functions_list_triggers",
    "List all Cloud Functions triggers (name + type)",
    { platform: platformSchema },
    async (params) => client.requestRaw("GET", `${CF}/triggers`, pq(params.platform))
  );

  defineTool(
    server,
    "ncloud_functions_get_trigger",
    "Get a trigger: type, description, linked actions and execOption (for cron triggers the 5-field cron expression). The API returns NO time-zone field; cron expressions are evaluated in KST (UTC+9, live-verified 2026-09-15 on KR) — the response includes a cronFormat note for cron triggers.",
    {
      triggerName: z.string().describe("Name of the trigger to retrieve"),
      platform: platformSchema,
    },
    async (params) => {
      const result = await client.requestRaw("GET", `${CF}/triggers/${enc(params.triggerName)}`, pq(params.platform));
      const type = result?.content?.type ?? result?.content?.triggerType;
      if (type === "cron") return { ...result, cronFormat: CRON_NOTE_EN };
      return result;
    }
  );

  const TRIGGER_TYPES_V21 = ["cron", "github", "insight", "object_storage", "source_commit", "secret_manager"] as const;
  const TRIGGER_TYPES_V20 = ["cron", "github"] as const;

  defineTool(
    server,
    "ncloud_functions_create_trigger",
    [
      `Create or update a Cloud Functions trigger (PUT, ${VER} — idempotent). \`type\` is a query parameter and cannot change after creation.`,
      v20
        ? "API v2.0 supports only cron and github triggers. The body is wrapped: { trigger: { description?, parameters?, ...type fields }, link? }."
        : "Body fields are FLAT (no wrapper) and depend on type:",
      "cron → cronOption (required). " + CRON_NOTE_EN,
      v20
        ? "github → credential {username, accessToken, repository} + events [...] (required; sent as `trigger.credentials`); link {productId, apiName, stageName} is required on first creation (API Gateway must be subscribed)."
        : "github → credential {username, accessToken, repository} + events [...] (required); link {productName, apiName, stageName} is required on first creation (API Gateway must be subscribed).",
      ...(v20
        ? []
        : [
            "insight → insightLink [{prodKey, ruleGrpId, reminderTime?, enableNotiWhenEventClose?}] (optional).",
            "object_storage → objectStorageLink [{bucketName, eventRuleName}] (required). Beware of recursion if the linked action writes to the same bucket.",
            "source_commit → sourceCommitLink [{repositoryName, webhookName, enable?}] (required; KR VPC only).",
            "secret_manager → secretManagerLink [{secretName}] (required; KR VPC only; one secret can be linked to one trigger).",
          ]),
      "Link actions afterwards with ncloud_functions_link_trigger_action. Use dryRun=true to preview.",
    ].join(" "),
    {
      triggerName: z.string().min(1).max(50).describe("Trigger name: 1-50 chars of letters, digits, '-' and '_'; must not start with '-'; unique across packages/actions/triggers"),
      platform: platformSchema,
      type: z.enum(TRIGGER_TYPES_V21).describe(v20 ? "Trigger type (query parameter; immutable after creation). API v2.0: cron | github only." : "Trigger type (query parameter; immutable after creation)"),
      description: z.string().max(3000).optional().describe("Description (0-3000 bytes)"),
      parameters: z.record(z.unknown()).optional().describe("Default parameters as a {key: value} JSON object, merged into every invocation (precedence: runtime > trigger > action > package)"),
      cronOption: z.string().optional().describe("cron only. 5-field UNIX cron 'min hour dom mon dow', e.g. '0 8 * * *'. Evaluated in KST (UTC+9) — live-verified 2026-09-15 on KR; the time zone is not documented by Ncloud."),
      credential: z.object({
        username: z.string().describe("GitHub user name"),
        accessToken: z.string().describe("GitHub access token"),
        repository: z.string().describe("Repository name or 'Organization/repository'"),
      }).optional().describe(v20 ? "github only: GitHub credentials (sent as trigger.credentials in API v2.0)" : "github only: GitHub credentials"),
      events: z.array(z.string()).optional().describe("github only: events to trigger on, e.g. ['push'] or ['*']"),
      link: z.object({
        productName: z.string().optional().describe("API Gateway product name (API v2.1)"),
        productId: z.string().optional().describe("API Gateway product ID (API v2.0 / Government zone)"),
        apiName: z.string().describe("API Gateway API name"),
        stageName: z.string().describe("API Gateway stage name"),
      }).optional().describe(v20 ? "github only: API Gateway endpoint to create the webhook on — productId + apiName + stageName (required when creating; ignored on update)" : "github only: API Gateway endpoint to create the webhook on — productName + apiName + stageName (required when creating; ignored on update)"),
      insightLink: z.array(z.object({
        prodKey: z.string().describe("Cloud Insight event rule prodKey"),
        ruleGrpId: z.string().describe("Cloud Insight event rule ruleGrpId"),
        reminderTime: z.number().int().min(5).max(720).optional().describe("Reminder interval in minutes (5-720)"),
        enableNotiWhenEventClose: z.boolean().optional().describe("Also invoke when the event closes (default false)"),
      })).optional().describe("insight only: Cloud Insight event rules to link"),
      objectStorageLink: z.array(z.object({
        bucketName: z.string().describe("Object Storage bucket name"),
        eventRuleName: z.string().describe("Object Storage event rule name"),
      })).optional().describe("object_storage only: bucket event rules to link"),
      sourceCommitLink: z.array(z.object({
        repositoryName: z.string().describe("SourceCommit repository name"),
        webhookName: z.string().describe("SourceCommit webhook name"),
        enable: z.boolean().optional().describe("Webhook enabled (default true)"),
      })).optional().describe("source_commit only: repository webhooks to link"),
      secretManagerLink: z.array(z.object({
        secretName: z.string().describe("Secret Manager secret name"),
      })).optional().describe("secret_manager only: secrets to link"),
      dryRun: z.boolean().optional().default(false).describe("Preview the request without calling the API"),
    },
    async (params) => {
      if (v20 && !(TRIGGER_TYPES_V20 as readonly string[]).includes(params.type)) {
        return fail(`type=${params.type} is not available in Government-zone Cloud Functions (API v2.0). Supported trigger types: ${TRIGGER_TYPES_V20.join(", ")}.`);
      }
      const queryParams = pq(params.platform, { type: params.type });
      // v2.1: 최상위 평면 본문. v2.0: `{ trigger: {...}, link? }` 래퍼.
      const inner: Record<string, unknown> = {};
      let link: Record<string, unknown> | undefined;
      if (params.description !== undefined) inner.description = params.description;
      if (params.parameters !== undefined) inner.parameters = params.parameters;

      // 타입별로 유효한 필드만 싣고, 다른 타입의 필드가 섞여 오면 조용히 버리지 않고 거절한다.
      const TYPE_FIELDS: Record<string, string[]> = {
        cron: ["cronOption"],
        github: ["credential", "events", "link"],
        insight: ["insightLink"],
        object_storage: ["objectStorageLink"],
        source_commit: ["sourceCommitLink"],
        secret_manager: ["secretManagerLink"],
      };
      const allTyped = Object.values(TYPE_FIELDS).flat();
      const allowed = TYPE_FIELDS[params.type];
      const p = params as unknown as Record<string, unknown>;
      const foreign = allTyped.filter((f) => !allowed.includes(f) && p[f] !== undefined);
      if (foreign.length > 0) {
        return fail(`type=${params.type} does not accept: ${foreign.join(", ")}. Valid for this type: ${allowed.join(", ")}.`);
      }

      switch (params.type) {
        case "cron": {
          if (!params.cronOption) return fail("type=cron requires cronOption (5-field UNIX cron, e.g. '0 8 * * *').");
          const m = CRON_5_FIELDS.exec(params.cronOption);
          if (!m || m.slice(1).some((f) => !CRON_FIELD.test(f))) {
            return fail(`cronOption must be a 5-field cron expression 'minute hour day-of-month month day-of-week' (got '${params.cronOption}'). Seconds and year fields are not supported.`);
          }
          inner.cronOption = params.cronOption.trim();
          break;
        }
        case "github": {
          if (!params.credential || !params.events || params.events.length === 0) {
            return fail("type=github requires credential {username, accessToken, repository} and a non-empty events list.");
          }
          // v2.0 키는 `credentials`, v2.1 은 `credential`.
          inner[v20 ? "credentials" : "credential"] = params.credential;
          inner.events = params.events;
          if (params.link) {
            if (v20) {
              if (!params.link.productId) return fail("github link in API v2.0 requires productId (API Gateway product ID) + apiName + stageName.");
              link = { productId: params.link.productId, apiName: params.link.apiName, stageName: params.link.stageName };
            } else {
              if (!params.link.productName) return fail("github link in API v2.1 requires productName (API Gateway product name) + apiName + stageName.");
              link = { productName: params.link.productName, apiName: params.link.apiName, stageName: params.link.stageName };
            }
          }
          break;
        }
        case "insight":
          if (params.insightLink) inner.insightLink = params.insightLink;
          break;
        case "object_storage":
          if (!params.objectStorageLink || params.objectStorageLink.length === 0) return fail("type=object_storage requires a non-empty objectStorageLink list.");
          inner.objectStorageLink = params.objectStorageLink;
          break;
        case "source_commit":
          if (!params.sourceCommitLink || params.sourceCommitLink.length === 0) return fail("type=source_commit requires a non-empty sourceCommitLink list.");
          inner.sourceCommitLink = params.sourceCommitLink;
          break;
        case "secret_manager":
          if (!params.secretManagerLink || params.secretManagerLink.length === 0) return fail("type=secret_manager requires a non-empty secretManagerLink list.");
          inner.secretManagerLink = params.secretManagerLink;
          break;
      }

      const body: Record<string, unknown> = v20 ? { trigger: inner, ...(link ? { link } : {}) } : { ...inner, ...(link ? { link } : {}) };

      const endpoint = `${CF}/triggers/${enc(params.triggerName)}`;
      if (params.dryRun) {
        const notes: Record<string, unknown> = {
          note: L({
            ko: "PUT은 생성·수정 공용입니다. 같은 이름의 트리거가 있으면 수정되며, type은 변경할 수 없습니다.",
            en: "PUT creates or updates. An existing trigger with this name is updated; its type cannot change.",
          }),
        };
        if (params.type === "cron") notes.cronFormat = CRON_NOTE_EN;
        if (params.type === "github" && !params.link) {
          notes.warning = v20
            ? "github: `link` {productId, apiName, stageName} is required when the trigger is being CREATED (only optional on update)."
            : "github: `link` {productName, apiName, stageName} is required when the trigger is being CREATED (only optional on update).";
        }
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: Cloud Functions Trigger (PUT)",
          endpoint,
          method: "PUT",
          requestParams: { query: queryParams, body },
          noun: { ko: "트리거", en: "trigger" },
          notes,
        });
      }
      const result = await client.requestRaw("PUT", endpoint, queryParams, body);
      let out = redactTriggerToken(result);
      if (params.type === "cron") out = { ...out, cronFormat: CRON_NOTE_EN };
      return out;
    }
  );

  defineTool(
    server,
    "ncloud_functions_invoke_trigger",
    "Manually fire a trigger so its linked actions run; returns the activationId. Fails with 80512 TRIGGER_INVOKE_FAIL if no action is linked.",
    {
      triggerName: z.string().describe("Name of the trigger to invoke"),
      platform: platformSchema,
      params: z.record(z.unknown()).optional().describe("Runtime parameters passed to the linked actions"),
    },
    async (params) => client.requestRaw("POST", `${CF}/triggers/${enc(params.triggerName)}`, pq(params.platform), params.params ?? {})
  );

  defineTool(
    server,
    "ncloud_functions_delete_trigger",
    "⚠️ Destructive: Permanently delete a Cloud Functions trigger. Set confirm=true to execute.",
    {
      triggerName: z.string().describe("Name of the trigger to delete"),
      platform: platformSchema,
      confirm: z.boolean().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const result = await client.requestRaw("DELETE", `${CF}/triggers/${enc(params.triggerName)}`, pq(params.platform));
      return result ? toolText(result) : { content: [{ type: "text" as const, text: "Trigger deleted successfully (204 No Content)" }] };
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete Cloud Functions trigger [${params.triggerName}].\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Trigger-Action Linking Tools ──────────────────────────────────────────

  /**
   * link/unlink 본문은 v2.0·v2.1 모두 `{ action, package }`다(`package` 기본 `-`).
   * 공식 예시는 `"action": "hsh/act-01", "package": "-"`처럼 액션 값에 패키지를 겹쳐 쓰고 있어,
   * 호출자가 `pkg/action` 한 덩어리로 넘겨도 받아서 분리한다.
   */
  function linkBody(actionName: string, packageName: string | undefined): { action: string; package: string } {
    const slash = actionName.indexOf("/");
    if (slash > 0 && packageName === undefined) {
      return { action: actionName.slice(slash + 1), package: actionName.slice(0, slash) };
    }
    return { action: actionName, package: packageName ?? "-" };
  }

  defineTool(
    server,
    "ncloud_functions_link_trigger_action",
    `Link an action to a trigger so the trigger's events invoke it (POST ${CF}/triggers/{name}/link-action). Fails with 80901 DUPLICATED_RULE if already linked, 80324/80519 when a link limit is exceeded.`,
    {
      triggerName: z.string().describe("Name of the trigger"),
      platform: platformSchema,
      actionName: z.string().describe("Action name. '{packageName}/{actionName}' is also accepted and split automatically."),
      packageName: z.string().optional().describe("Package of the action (default '-' = unpackaged)"),
    },
    async (params) =>
      client.requestRaw(
        "POST",
        `${CF}/triggers/${enc(params.triggerName)}/link-action`,
        pq(params.platform),
        linkBody(params.actionName, params.packageName)
      )
  );

  defineTool(
    server,
    "ncloud_functions_unlink_trigger_action",
    `⚠️ Destructive: Unlink an action from a trigger (DELETE ${CF}/triggers/{name}/link-action). The trigger stops invoking the action; neither resource is deleted. Set confirm=true to execute.`,
    {
      triggerName: z.string().describe("Name of the trigger"),
      platform: platformSchema,
      actionName: z.string().describe("Action name. '{packageName}/{actionName}' is also accepted and split automatically."),
      packageName: z.string().optional().describe("Package of the action (default '-' = unpackaged)"),
      confirm: z.boolean().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const result = await client.requestRaw(
        "DELETE",
        `${CF}/triggers/${enc(params.triggerName)}/link-action`,
        pq(params.platform),
        linkBody(params.actionName, params.packageName)
      );
      return result ? toolText(result) : { content: [{ type: "text" as const, text: "Action unlinked from trigger successfully (204 No Content)" }] };
    },
    { destructive: { message: (params) => `⚠️ This will unlink action [${params.packageName ?? "-"}/${params.actionName}] from trigger [${params.triggerName}].\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Activation (Execution History) Tools ──────────────────────────────────

  // v2.1: start/end는 **밀리초 Unix timestamp(정수)**다 — 이전 스키마의 `yyyy-MM-ddTHH:mm:ss` 문자열은 스펙에 없다.
  // v2.0(공공존): 반대로 `yyyy-MM-ddTHH:mm:ss`(KST) 문자열만 받는다 — 입력은 동일하게 밀리초로 받고 전송 시 변환한다.
  const windowNote = v20
    ? "Sent to the API as a 'yyyy-MM-ddTHH:mm:ss' KST (UTC+9) string, which is what API v2.0 expects."
    : "";
  const activationQuerySchema = {
    platform: platformSchema,
    pageNo: z.number().int().min(1).optional().describe("Page number (default 1)"),
    pageSize: z.number().int().min(1).optional().describe("Page size (default 20)"),
    start: z.number().int().optional().describe(`Start of the window as a Unix timestamp in MILLISECONDS (default: one month before now). Only the last month is queryable. ${windowNote}`.trim()),
    end: z.number().int().optional().describe(`End of the window as a Unix timestamp in MILLISECONDS (default: now). ${windowNote}`.trim()),
  };
  function activationQuery(params: { platform: string; pageNo?: number; pageSize?: number; start?: number; end?: number }) {
    const q: Record<string, string> = pq(params.platform);
    if (params.pageNo !== undefined) q.pageNo = String(params.pageNo);
    if (params.pageSize !== undefined) q.pageSize = String(params.pageSize);
    if (params.start !== undefined) q.start = v20 ? toKstDateTime(params.start) : String(params.start);
    if (params.end !== undefined) q.end = v20 ? toKstDateTime(params.end) : String(params.end);
    return q;
  }

  defineTool(
    server,
    "ncloud_functions_get_action_activations",
    "List an action's activations (executions) from the last month: activationId, duration, status, plus totalCount",
    {
      packageName: z.string().default("-").describe("Package name ('-' = unpackaged action)"),
      actionName: z.string().describe("Name of the action"),
      ...activationQuerySchema,
    },
    async (params) =>
      client.requestRaw(
        "GET",
        `${CF}/packages/${enc(params.packageName)}/actions/${enc(params.actionName)}/activations`,
        activationQuery(params)
      )
  );

  defineTool(
    server,
    "ncloud_functions_get_action_activation_detail",
    "Get one action activation: result payload, status, success flag, logs, start/end/duration. Right after an invocation the detail can return 80322 ACTION_ACTIVATION_NOT_FOUND for ~30-40 s even though the id is already in the activation list — retry after a short wait.",
    {
      packageName: z.string().default("-").describe("Package name ('-' = unpackaged action)"),
      actionName: z.string().describe("Name of the action"),
      activationId: z.string().describe("Activation ID"),
      platform: platformSchema,
    },
    async (params) =>
      client.requestRaw(
        "GET",
        `${CF}/packages/${enc(params.packageName)}/actions/${enc(params.actionName)}/activations/${enc(params.activationId)}`,
        pq(params.platform)
      )
  );

  defineTool(
    server,
    "ncloud_functions_get_trigger_activations",
    "List a trigger's activations from the last month: activationId, duration, status, plus totalCount",
    {
      triggerName: z.string().describe("Name of the trigger"),
      ...activationQuerySchema,
    },
    async (params) => client.requestRaw("GET", `${CF}/triggers/${enc(params.triggerName)}/activations`, activationQuery(params))
  );

  defineTool(
    server,
    "ncloud_functions_get_trigger_activation_detail",
    "Get one trigger activation: result, status, success flag, logs, start time. Right after an invocation the detail can return 80518 TRIGGER_ACTIVATION_NOT_FOUND for ~30-40 s even though the id is already in the activation list (observed live 2026-09-15) — retry after a short wait.",
    {
      triggerName: z.string().describe("Name of the trigger"),
      activationId: z.string().describe("Activation ID"),
      platform: platformSchema,
    },
    async (params) =>
      client.requestRaw("GET", `${CF}/triggers/${enc(params.triggerName)}/activations/${enc(params.activationId)}`, pq(params.platform))
  );

  defineTool(
    server,
    "ncloud_functions_get_activations",
    "List all action activations across the account from the last month: activationId, duration, status, plus totalCount",
    activationQuerySchema,
    async (params) => client.requestRaw("GET", `${CF}/activations`, activationQuery(params))
  );
}

/**
 * 트리거 응답에 GitHub 액세스 토큰이 그대로 실린다 — 값 형식과 무관하게 필드 자체를 가린다.
 * v2.1 은 `content.credential`, v2.0 은 `content.credentials` 또는 `content.trigger.credentials`.
 */
function redactTriggerToken(result: any): any {
  if (!result || typeof result !== "object") return result;
  const paths: Array<[string[], string]> = [
    [["content", "credential"], "accessToken"],
    [["content", "credentials"], "accessToken"],
    [["content", "trigger", "credentials"], "accessToken"],
  ];
  for (const [holderPath, key] of paths) {
    let holder: any = result;
    for (const seg of holderPath) holder = holder?.[seg];
    const token = holder?.[key];
    if (typeof token === "string" && token.length > 0) {
      const redacted = `<REDACTED:${token.length} chars>`;
      // 경로를 따라 얕은 복사로 다시 만든다(원본 객체 불변).
      const rebuild = (obj: any, i: number): any => {
        if (i === holderPath.length) return { ...obj, [key]: redacted };
        const seg = holderPath[i];
        return { ...obj, [seg]: rebuild(obj[seg], i + 1) };
      };
      return { ...rebuild(result, 0), secretsRedacted: true };
    }
  }
  return result;
}

/**
 * 액션 응답의 `content.exec.code`에서 시크릿을 가리고 플래그를 붙인다 (F-03).
 *  - 기본(includeSecrets=false): 가린 뒤 `secretsRedacted: true`, `redactedCount`.
 *  - includeSecrets=true: 원문 유지, 대신 `secretsDetected` 경고를 붙여 최소한 알린다.
 *  - `exec.binary === true`면 base64 파일이라 스캔하지 않고 그 사실을 적는다.
 */
function annotateActionSecrets(result: any, includeSecrets: boolean): any {
  const exec = result?.content?.exec;
  if (!exec || typeof exec.code !== "string") return result;
  if (exec.binary === true) {
    return { ...result, secretsScan: "skipped — exec.binary=true (base64-encoded archive is not scanned for secrets)" };
  }
  if (includeSecrets) {
    const { count } = redactSecrets(exec.code);
    if (count === 0) return result;
    return {
      ...result,
      secretsDetected: count,
      warning: `The source code contains ${count} secret-like value(s) (hard-coded credentials). They are returned UNREDACTED because includeSecrets=true — do not paste this output into shared logs; rotate the keys and move them to Secret Manager or action parameters.`,
    };
  }
  const { value, count } = redactAtPath(result, "content.exec.code");
  if (count === 0) return result;
  return {
    ...value,
    secretsRedacted: true,
    redactedCount: count,
    note: `${count} secret-like value(s) in the source code were replaced with <REDACTED:n chars> (the code is otherwise complete). Pass includeSecrets=true to retrieve them; consider rotating these keys.`,
  };
}
