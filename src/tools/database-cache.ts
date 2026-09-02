import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { L, maxLenMessage, requiredError } from "./_messages.js";
import { dryRunPreview } from "./_dryrun.js";

export function registerDatabaseCacheTools(server: McpServer, client: NcloudClient): void {
  // ─── Query Tools ───────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_cache_instances",
    "List all Cloud DB for Cache (Redis/Valkey) instances in the current region",
    {
      cloudCacheInstanceNoList: z.array(z.string()).optional().describe("Filter by Cache instance numbers"),
      cloudCacheServiceName: z.string().optional().describe("Filter by Cache service name"),
      cloudCacheServerName: z.string().optional().describe("Filter by Cache server name"),
      cloudCacheServerInstanceNoList: z.array(z.string()).optional().describe("Filter by Cache server instance numbers"),
      cloudCacheDbmsCode: z.enum(["Redis", "Valkey"]).optional().describe("Filter by DBMS type: Redis | Valkey"),
      generationCode: z.enum(["G2", "G3"]).optional().describe("Filter by server generation: G2 | G3"),
      zoneCode: z.string().optional().describe("Filter by zone code (e.g. KR-1, KR-2)"),
      vpcNo: z.string().optional().describe("Filter by VPC number"),
      subnetNo: z.string().optional().describe("Filter by subnet number"),
      regionCode: z.string().optional().describe("Region code (e.g., KR, JPN, SGN)"),
      pageNo: z.number().min(0).optional().describe("Page number (0-based). Requires pageSize"),
      pageSize: z.number().min(1).optional().describe("Page size (min 1). Required when pageNo is given"),
    },
    async (params) => {
      // pageSize는 pageNo를 줄 때 조건부 필수다 — 빼먹으면 API가 거절한다.
      if (params.pageNo !== undefined && params.pageSize === undefined) {
        return {
          content: [{
            type: "text" as const,
            text: L({
              ko: "pageNo를 지정하면 pageSize도 함께 지정해야 합니다.",
              en: "pageSize is required when pageNo is specified.",
            }),
          }],
          isError: true,
        };
      }
      return client.request("/vcache/v2/getCloudCacheInstanceList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_cache_instance_detail",
    "Get detailed information about a specific Cloud DB for Cache (Redis/Valkey) instance",
    {
      cloudCacheInstanceNo: z.string().describe("Cloud Cache instance number to query"),
    },
    async (params) => {
      return client.request("/vcache/v2/getCloudCacheInstanceDetail", params);
    }
  );

  defineTool(
    server,
    "ncloud_list_cache_backups",
    "List system backups for Cloud DB for Cache in the region. This API takes no instance filter — " +
      "use ncloud_list_cache_backup_details for one instance's backups.",
    {
      // getCloudCacheBackupList의 파라미터는 regionCode 뿐이다. 예전 스키마의
      // cloudCacheInstanceNo는 전송돼도 서버가 무시하는 유령 필수값이었다.
      regionCode: z.string().optional().describe("Region code (e.g., KR, JPN, SGN)"),
    },
    async (params) => {
      return client.request("/vcache/v2/getCloudCacheBackupList", params);
    }
  );

  // ─── Config Group Tools ────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_cache_config_groups",
    "List all Cloud Cache config groups, optionally filtered",
    {
      // getCloudCacheConfigGroupList는 페이지네이션을 지원하지 않는다 —
      // 예전 스키마의 pageNo/pageSize는 유령 파라미터였고, 실제 필터 7개가 빠져 있었다.
      cloudCacheInstanceNo: z.string().optional().describe("Filter by the Cache instance the group is applied to"),
      cloudCacheServiceName: z.string().optional().describe("Filter by Cache service name"),
      configGroupNo: z.string().optional().describe("Filter by config group number"),
      configGroupName: z.string().optional().describe("Filter by config group name"),
      cloudCacheImageProductCode: z.string().optional().describe("Filter by Cache image product code"),
      cloudCacheModeCode: z.enum(["SIMPLE", "CLUSTER"]).optional().describe("Filter by mode: SIMPLE | CLUSTER"),
      cloudCacheDbmsCode: z.enum(["Redis", "Valkey"]).optional().describe("Filter by DBMS type: Redis | Valkey"),
      regionCode: z.string().optional().describe("Region code (e.g., KR, JPN, SGN)"),
    },
    async (params) => {
      return client.request("/vcache/v2/getCloudCacheConfigGroupList", params);
    }
  );

  defineTool(
    server,
    "ncloud_create_cache_config_group",
    "Create a new Cloud Cache config group. cloudCacheVersion combines engine version and mode " +
      "(e.g. '8.1.6-simple' = Standalone, '7.2.11-cluster' = Cluster) — list valid values with " +
      "ncloud_list_cache_config_group_versions. Use dryRun=true to preview without creating.",
    {
      configGroupName: z.string({
        required_error: requiredError("configGroupName"),
      }).max(15, { message: maxLenMessage("configGroupName", 15) })
        .describe("Config group name (3-15 chars: lowercase letters, numbers, hyphen; must start with a letter and end with a letter or number)"),
      cloudCacheVersion: z.string({
        required_error: requiredError("cloudCacheVersion"),
      }).describe("Engine version + mode, e.g. '8.1.6-simple' | '7.2.11-cluster' (use ncloud_list_cache_config_group_versions)"),
      cloudCacheDbmsCode: z.enum(["Redis", "Valkey"]).optional().describe("DBMS type: Redis (default) | Valkey"),
      configGroupDescription: z.string().max(255, {
        message: maxLenMessage("configGroupDescription", 255),
      }).optional().describe("Config group description (max 255 chars)"),
      regionCode: z.string().optional().describe("Region code (e.g., KR, JPN, SGN)"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the config group"),
    },
    async (params) => {
      const { dryRun, ...apiParams } = params;

      if (dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: Cache Config Group Creation",
          endpoint: "/vcache/v2/createCloudCacheConfigGroup",
          requestParams: apiParams,
          noun: { ko: "Config Group", en: "Config Group" },
        });
      }

      const result = await client.request("/vcache/v2/createCloudCacheConfigGroup", apiParams);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_delete_cache_config_group",
    "⚠️ Destructive: Permanently delete a Cloud Cache config group. A group still applied to an instance " +
      "cannot be deleted — delete the instance first. Set confirm=true to execute.",
    {
      // create_cache_instance(B-1)와 문자 그대로 같은 결함이 여기 남아 있었다:
      // 스키마가 cloudCacheConfigGroupNo를 받아 그대로 쿼리에 실어 보내
      // 900 "location : configGroupNo"로 항상 실패했다. 이름 정정은 리소스의
      // create/delete/get 전체를 함께 훑어야 한다는 교훈.
      configGroupNo: z.string({
        required_error: requiredError("configGroupNo"),
      }).describe("Config group number to delete (from ncloud_list_cache_config_groups)"),
      regionCode: z.string().optional().describe("Region code (e.g., KR, JPN, SGN)"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vcache/v2/deleteCloudCacheConfigGroup", apiParams);
      return result;
    },
    { destructive: { noun: "Cache config group", describe: (params) => params.configGroupNo } }
  );

  // ─── Create Tools ──────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_create_cache_instance",
    "Create a new Cloud DB for Cache (Redis/Valkey) instance. Requires a config group — create one with " +
      "ncloud_create_cache_config_group or pick an existing configGroupNo from ncloud_list_cache_config_groups. " +
      "Use dryRun=true to preview without creating.",
    {
      cloudCacheServiceName: z.string({
        required_error: requiredError("cloudCacheServiceName"),
      }).max(15, { message: maxLenMessage("cloudCacheServiceName", 15) })
        .describe("Cache service name (3-15 chars: letters, numbers, Korean, hyphen)"),
      cloudCacheServerNamePrefix: z.string({
        required_error: requiredError("cloudCacheServerNamePrefix"),
      }).max(15, { message: maxLenMessage("cloudCacheServerNamePrefix", 15) })
        .describe("Server name prefix (3-15 chars: lowercase letters, numbers, hyphen)"),
      vpcNo: z.string({
        required_error: requiredError("vpcNo"),
      }).describe("VPC number"),
      subnetNo: z.string({
        required_error: requiredError("subnetNo"),
      }).describe("Private subnet number to create the instance in"),
      // API 파라미터명은 configGroupNo다. 예전 스키마의 cloudCacheConfigGroupNo는
      // 쿼리스트링에 그대로 실려 나가 서버가 필수값 누락으로 거절했다(B-1).
      configGroupNo: z.string({
        required_error: requiredError("configGroupNo"),
      }).describe("Config group number (from ncloud_list_cache_config_groups or ncloud_create_cache_config_group)"),
      cloudCacheModeCode: z.enum(["SIMPLE", "CLUSTER"], {
        required_error: requiredError("cloudCacheModeCode"),
      }).describe("Cache mode: SIMPLE (standalone) | CLUSTER. Must match the config group version suffix (-simple / -cluster)"),
      cloudCacheDbmsCode: z.enum(["Redis", "Valkey"]).optional().describe("DBMS type: Redis (default) | Valkey"),
      cloudCacheImageProductCode: z.string().optional().describe("Cache image product code. Default: auto-selected"),
      cloudCacheProductCode: z.string().optional().describe("Cache server spec code. Default: minimum spec"),
      engineVersionCode: z.string().optional().describe("Cache engine version code. Default: latest"),
      generationCode: z.enum(["G2", "G3"]).optional().describe("Server generation: G2 | G3"),
      cloudCachePort: z.number().optional().describe("Cache TCP port. Default: 6379; a custom port must be in 10000-20000"),
      isHa: z.boolean().optional().describe("High availability (default: false)"),
      isBackup: z.boolean().optional().describe("Enable backup (default: false)"),
      isAutomaticBackup: z.boolean().optional().describe("Let the server pick the backup time (default: true). If false, backupTime is required"),
      backupTime: z.string().optional().describe("Backup time in HH:mm format (e.g. '01:15'). Required when isBackup=true and isAutomaticBackup=false"),
      backupFileRetentionPeriod: z.number().min(1).max(7).optional().describe("Backup retention period in days (1-7, default: 1)"),
      shardCount: z.number().min(3).max(10).optional().describe("Master node count, CLUSTER mode only (3-10, default: 3)"),
      shardCopyCount: z.number().min(0).max(4).optional().describe("Replica count per shard, CLUSTER mode only (0-4, default: 0)"),
      regionCode: z.string().optional().describe("Region code (e.g., KR, JPN, SGN)"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the instance"),
    },
    async (params) => {
      // isBackup=true + isAutomaticBackup=false 조합에서만 backupTime이 필수다.
      if (params.isBackup === true && params.isAutomaticBackup === false && !params.backupTime) {
        return {
          content: [{
            type: "text" as const,
            text: L({
              ko: "backupTime은 isBackup=true이고 isAutomaticBackup=false일 때 필수입니다 (예: '01:15').",
              en: "backupTime is required when isBackup=true and isAutomaticBackup=false (e.g. '01:15').",
            }),
          }],
          isError: true,
        };
      }

      const { dryRun, ...apiParams } = params;

      // ─── cloudCacheModeCode ↔ config group 모드 사전 검증 (라이브 리포트 R-1) ───
      // Config Group의 버전에는 모드가 접미사로 박혀 있고(`7.2.11-simple`), 인스턴스
      // 생성은 cloudCacheModeCode를 따로 받는다. 두 값이 어긋날 때 서버가 어떻게
      // 반응하는지는 문서에 없다 — 조용히 통과할 가능성이 있어 호출 전에 걸러낸다.
      //
      // 응답 필드명에 의존하지 않고 **문서화된 필터만** 쓴다: configGroupNo +
      // cloudCacheModeCode로 조회해 0건이고, configGroupNo 단독으로는 1건 이상이면
      // 모드가 어긋난 것이다. 진단이 실패하면 그냥 통과시킨다 —
      // 사전 검증이 정상 생성을 막아서는 안 된다(Resource Manager 진단 프로브와 같은 규칙).
      if (!dryRun) {
        try {
          const matched = await client.request("/vcache/v2/getCloudCacheConfigGroupList", {
            configGroupNo: params.configGroupNo,
            cloudCacheModeCode: params.cloudCacheModeCode,
            regionCode: params.regionCode,
          });
          if ((matched?.cloudCacheConfigGroupList?.length ?? 0) === 0) {
            const anyMode = await client.request("/vcache/v2/getCloudCacheConfigGroupList", {
              configGroupNo: params.configGroupNo,
              regionCode: params.regionCode,
            });
            const found = anyMode?.cloudCacheConfigGroupList?.[0];
            if (found) {
              const actual = found.cloudCacheVersion ?? found.cloudCacheModeCode ?? "unknown";
              return {
                content: [{
                  type: "text" as const,
                  text: L({
                    ko: `config group [${params.configGroupNo}]의 모드가 cloudCacheModeCode='${params.cloudCacheModeCode}'와 일치하지 않습니다(그룹 버전: ${actual}). ` +
                        `버전 접미사 '-simple'은 SIMPLE, '-cluster'는 CLUSTER에 대응합니다. 모드를 맞추거나 해당 모드의 config group을 사용하세요.`,
                    en: `Config group [${params.configGroupNo}] does not match cloudCacheModeCode='${params.cloudCacheModeCode}' (group version: ${actual}). ` +
                        `The version suffix '-simple' maps to SIMPLE and '-cluster' to CLUSTER. Change the mode, or use a config group of that mode.`,
                  }),
                }],
                isError: true,
              };
            }
          }
        } catch {
          // 진단 실패는 무시하고 원래 호출을 진행한다.
        }
      }

      if (dryRun) {
        // 생략된 값은 서버 기본값이 적용된다 — 프리뷰가 임의의 기본값을 채워 보여주면
        // 실제 프로비저닝 결과와 조용히 어긋난다(B-3). 전송 객체만 그대로 노출한다.
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: Cache Instance Creation",
          endpoint: "/vcache/v2/createCloudCacheInstance",
          requestParams: apiParams,
          noun: { ko: "Cache 인스턴스", en: "Cache instance" },
          notes: {
            note_defaults: L({
              ko: "위에 없는 항목은 전송되지 않으며 서버 기본값이 적용됩니다(포트 6379, isBackup=false, isHa=false 등).",
              en: "Anything not listed above is not sent and the server default applies (port 6379, isBackup=false, isHa=false, etc.).",
            }),
          },
        });
      }

      const result = await client.request("/vcache/v2/createCloudCacheInstance", apiParams);
      const instance = result.cloudCacheInstanceList?.[0];
      const serverDefault = L({ ko: "(서버 기본값)", en: "(server default)" });
      const summary = {
        리소스타입: "Cache (Redis/Valkey)",
        리소스ID: instance?.cloudCacheInstanceNo ?? "unknown",
        서비스명: params.cloudCacheServiceName,
        상태: instance?.cloudCacheInstanceStatus?.codeName ?? "creating",
        생성시각: instance?.createDate ?? new Date().toISOString(),
        VPC: params.vpcNo,
        서브넷: params.subnetNo,
        모드: params.cloudCacheModeCode,
        // 보내지 않은 값을 기본값으로 단정하지 않는다(B-3) — 응답에 있으면 그 값을 쓴다.
        포트: instance?.cloudCachePort ?? params.cloudCachePort ?? serverDefault,
      };
      return summary;
    }
  );

  // ─── Operation Tools ───────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_reboot_cache_server",
    "Reboot a Cloud DB for Cache server instance",
    {
      cloudCacheServerInstanceNo: z.string().describe("Cloud Cache server instance number to reboot"),
    },
    async (params) => {
      return client.request("/vcache/v2/rebootCloudCacheServerInstance", params);
    }
  );

  // ─── Manual Backup Tools ─────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_cache_manual_backups",
    "List manual backups for Cloud DB for Cache in the region. This API takes no instance filter or " +
      "pagination — use ncloud_list_cache_manual_backup_details for one instance's backups.",
    {
      // getCloudCacheManualBackupList의 파라미터는 regionCode 뿐이다.
      // cloudCacheInstanceNo/pageNo/pageSize는 전송돼도 무시되는 유령 필터였다.
      regionCode: z.string().optional().describe("Region code (e.g., KR, JPN, SGN)"),
    },
    async (params) => {
      return client.request("/vcache/v2/getCloudCacheManualBackupList", params);
    }
  );

  defineTool(
    server,
    "ncloud_list_cache_manual_backup_details",
    "List manual backup details (file names, sizes) for one Cloud DB for Cache instance",
    {
      // 이 API는 백업 번호가 아니라 **인스턴스 번호**를 받는다. 예전 스키마의
      // cloudCacheManualBackupNo는 API에 존재하지 않는 파라미터였고, 필수값
      // cloudCacheInstanceNo가 없어 항상 실패했다.
      cloudCacheInstanceNo: z.string({
        required_error: requiredError("cloudCacheInstanceNo"),
      }).describe("Cloud Cache instance number"),
      regionCode: z.string().optional().describe("Region code (e.g., KR, JPN, SGN)"),
    },
    async (params) => {
      return client.request("/vcache/v2/getCloudCacheManualBackupDetailList", params);
    }
  );

  defineTool(
    server,
    "ncloud_create_cache_manual_backup",
    "Create a manual backup for a Cloud DB for Cache instance. The backup file name is assigned by the " +
      "server — read it back with ncloud_list_cache_manual_backup_details.",
    {
      cloudCacheInstanceNo: z.string({
        required_error: requiredError("cloudCacheInstanceNo"),
      }).describe("Cloud Cache instance number"),
      // createCloudCacheManualBackup은 이름을 받지 않는다 — 예전 스키마의
      // cloudCacheManualBackupName은 사용자에게 무의미한 값을 강제하던 유령 필수값이었다.
      regionCode: z.string().optional().describe("Region code (e.g., KR, JPN, SGN)"),
    },
    async (params) => {
      return client.request("/vcache/v2/createCloudCacheManualBackup", params);
    }
  );

  defineTool(
    server,
    "ncloud_delete_cache_manual_backup",
    "⚠️ Destructive: Permanently delete one or more Cloud Cache manual backup files. Backups are identified " +
      "by instance number plus file name (from ncloud_list_cache_manual_backup_details), not by a backup ID. " +
      "Set confirm=true to execute.",
    {
      // 이 API는 백업 번호를 받지 않는다 — 인스턴스 번호 + 파일 이름 리스트(fileNameList.N)다.
      // 예전 스키마의 cloudCacheManualBackupNo는 존재하지 않는 파라미터였고,
      // 필수값 둘이 모두 빠져 이 파괴적 도구는 한 번도 동작한 적이 없다.
      cloudCacheInstanceNo: z.string({
        required_error: requiredError("cloudCacheInstanceNo"),
      }).describe("Cloud Cache instance number the backups belong to"),
      fileNameList: z.array(z.string()).min(1, {
        message: L({
          ko: "fileNameList는 최소 1개 이상이어야 합니다.",
          en: "fileNameList must contain at least one file name.",
        }),
      }).describe("Backup file names to delete (e.g. ['20220315', '20220322']) — from ncloud_list_cache_manual_backup_details"),
      regionCode: z.string().optional().describe("Region code (e.g., KR, JPN, SGN)"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vcache/v2/deleteCloudCacheManualBackup", apiParams);
      return result;
    },
    {
      destructive: {
        noun: "Cache manual backup file(s)",
        describe: (params) => `${params.cloudCacheInstanceNo}: ${(params.fileNameList ?? []).join(", ")}`,
      },
    }
  );

  // ─── Operation Tools (P2) ──────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_flush_cache_server",
    "⚠️ Destructive: Permanently deletes ALL data from a Cloud Cache server (FlushAll). Set confirm=true to execute.",
    {
      cloudCacheServerInstanceNo: z.string({
        required_error: requiredError("cloudCacheServerInstanceNo"),
      }).describe("Cloud Cache server instance number to flush"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vcache/v2/flushAllCloudCacheServerInstance", apiParams);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete ALL data from Cache server [${params.cloudCacheServerInstanceNo}]. This action cannot be undone. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.` } }
  );

  defineTool(
    server,
    "ncloud_export_cache_backup",
    "Export one Cloud Cache backup file to an Object Storage bucket. Get fileName from " +
      "ncloud_list_cache_backup_details (SYSTEM) or ncloud_list_cache_manual_backup_details (MANUAL), " +
      "and the bucket from ncloud_list_cache_buckets.",
    {
      // 이 API는 단일 파일 export다: fileName + backupTypeMode + bucketName + cloudCacheInstanceNo.
      // 예전 스키마의 cloudCacheServerInstanceNo·folderPath·cloudCacheExportObjectList[].fullObjectName은
      // 전부 API에 없는 파라미터였고, 필수값 fileName·backupTypeMode가 빠져 항상 실패했다.
      cloudCacheInstanceNo: z.string({
        required_error: requiredError("cloudCacheInstanceNo"),
      }).describe("Cloud Cache instance number"),
      fileName: z.string({
        required_error: requiredError("fileName"),
      }).describe("Backup file name to export (e.g. '20210315')"),
      backupTypeMode: z.enum(["SYSTEM", "MANUAL"], {
        required_error: requiredError("backupTypeMode"),
      }).describe("Which backup family the file belongs to: SYSTEM | MANUAL"),
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Destination Object Storage bucket name"),
      regionCode: z.string().optional().describe("Region code (e.g., KR, JPN, SGN)"),
    },
    async (params) => {
      const result = await client.request("/vcache/v2/exportBackupToObjectStorage", params);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_list_cache_backup_details",
    "List system backup details (file names, sizes) for one Cloud DB for Cache instance",
    {
      cloudCacheInstanceNo: z.string({
        required_error: requiredError("cloudCacheInstanceNo"),
      }).describe("Cloud Cache instance number"),
      // getCloudCacheBackupDetailList는 서버 인스턴스 번호를 받지 않는다 —
      // 예전 스키마의 cloudCacheServerInstanceNo는 유령 필수값이었다.
      regionCode: z.string().optional().describe("Region code (e.g., KR, JPN, SGN)"),
    },
    async (params) => {
      return client.request("/vcache/v2/getCloudCacheBackupDetailList", params);
    }
  );

  // ─── Reference Tools (P3) ─────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_get_cache_image_products",
    "List available Cloud Cache image product codes (Redis/Valkey versions)",
    {
      productCode: z.string().optional().describe("Filter by a specific image product code"),
      exclusionProductCode: z.string().optional().describe("Exclude a specific image product code"),
      generationCode: z.enum(["G2", "G3"]).optional().describe("Filter by server generation: G2 | G3"),
      regionCode: z.string().optional().describe("Region code (e.g., KR, JPN, SGN)"),
    },
    async (params) => {
      return client.request("/vcache/v2/getCloudCacheImageProductList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_cache_products",
    "List available Cloud Cache server spec product codes for a given image",
    {
      cloudCacheImageProductCode: z.string({
        required_error: requiredError("cloudCacheImageProductCode"),
      }).describe("Cloud Cache image product code"),
      productCode: z.string().optional().describe("Filter by a specific server spec product code"),
      exclusionProductCode: z.string().optional().describe("Exclude a specific server spec product code"),
      zoneCode: z.string().optional().describe("Filter by zone code (e.g. KR-1, KR-2)"),
      regionCode: z.string().optional().describe("Region code (e.g., KR, JPN, SGN)"),
    },
    async (params) => {
      return client.request("/vcache/v2/getCloudCacheProductList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_cache_target_vpcs",
    "List VPCs available for Cloud DB for Cache",
    {
      regionCode: z.string().optional().describe("Region code (e.g., KR, JPN, SGN)"),
    },
    async (params) => {
      return client.request("/vcache/v2/getCloudCacheTargetVpcList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_cache_target_subnets",
    "List subnets available for creating a Cloud DB for Cache instance in a VPC",
    {
      // 이 API는 인스턴스 번호가 아니라 vpcNo + cloudCacheImageProductCode를 받는다(둘 다 필수).
      // 예전 스키마의 cloudCacheInstanceNo는 존재하지 않는 파라미터였고 필수값 둘이 모두 빠져 있었다.
      vpcNo: z.string({
        required_error: requiredError("vpcNo"),
      }).describe("VPC number (from ncloud_get_cache_target_vpcs)"),
      cloudCacheImageProductCode: z.string({
        required_error: requiredError("cloudCacheImageProductCode"),
      }).describe("Cache image product code (from ncloud_get_cache_image_products)"),
      isPublic: z.boolean().optional().describe("true: public subnets only, false: private subnets only"),
      regionCode: z.string().optional().describe("Region code (e.g., KR, JPN, SGN)"),
    },
    async (params) => {
      return client.request("/vcache/v2/getCloudCacheTargetSubnetList", params);
    }
  );

  defineTool(
    server,
    "ncloud_list_cache_config_group_versions",
    "List available Cloud Cache config group versions. The suffix is the mode: '-simple' = Standalone, " +
      "'-cluster' = Cluster — it must match the cloudCacheModeCode used at instance creation.",
    {
      cloudCacheDbmsCode: z.enum(["Redis", "Valkey"]).optional().describe("Filter by DBMS type: Redis | Valkey"),
      regionCode: z.string().optional().describe("Region code (e.g., KR, JPN, SGN)"),
    },
    async (params) => {
      return client.request("/vcache/v2/getCloudCacheConfigGroupVersionList", params);
    }
  );

  defineTool(
    server,
    "ncloud_list_cache_buckets",
    "List Object Storage buckets available for Cloud DB for Cache backup export",
    {
      // cloudCacheInstanceNo는 이 API의 필수값이다 — 빠져 있어 항상 실패했다.
      cloudCacheInstanceNo: z.string({
        required_error: requiredError("cloudCacheInstanceNo"),
      }).describe("Cloud Cache instance number the export will run from"),
      regionCode: z.string().optional().describe("Region code (e.g., KR, JPN, SGN)"),
    },
    async (params) => {
      return client.request("/vcache/v2/getCloudCacheBucketList", params);
    }
  );

  // ─── Destructive Tools (with confirm gate) ─────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_cache_instance",
    "⚠️ Destructive: Permanently delete a Cloud DB for Cache (Redis/Valkey) instance. Set confirm=true to execute.",
    {
      cloudCacheInstanceNo: z.string().describe("Cloud Cache instance number to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vcache/v2/deleteCloudCacheInstance", apiParams);
      return result;
    },
    { destructive: { noun: "Cache instance", describe: (params) => params.cloudCacheInstanceNo } }
  );
}
