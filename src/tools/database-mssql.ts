import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { L, requiredError } from "./_messages.js";
import { dryRunPreview } from "./_dryrun.js";

export function registerDatabaseMssqlTools(server: McpServer, client: NcloudClient): void {
  // ─── Query Tools ───────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_mssql_instances",
    "List all Cloud DB for MSSQL instances in the current region",
    {
      cloudMssqlInstanceNoList: z.array(z.string()).optional().describe("Filter by MSSQL instance numbers"),
      cloudMssqlServiceName: z.string().optional().describe("Filter by MSSQL service name"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      return client.request("/vmssql/v2/getCloudMssqlInstanceList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_mssql_instance_detail",
    "Get detailed information about a specific Cloud DB for MSSQL instance",
    {
      cloudMssqlInstanceNo: z.string().describe("Cloud MSSQL instance number to query"),
    },
    async (params) => {
      return client.request("/vmssql/v2/getCloudMssqlInstanceDetail", params);
    }
  );

  defineTool(
    server,
    "ncloud_list_mssql_backups",
    "List backups for a Cloud DB for MSSQL instance",
    {
      cloudMssqlInstanceNo: z.string().describe("Cloud MSSQL instance number"),
    },
    async (params) => {
      return client.request("/vmssql/v2/getCloudMssqlBackupList", params);
    }
  );

  defineTool(
    server,
    "ncloud_list_mssql_backup_details",
    "List detailed backup information for a Cloud DB for MSSQL instance including file paths",
    {
      cloudMssqlInstanceNo: z.string().describe("Cloud MSSQL instance number"),
      cloudMssqlServerInstanceNo: z.string().describe("Cloud MSSQL server instance number"),
    },
    async (params) => {
      return client.request("/vmssql/v2/getCloudMssqlBackupDetailList", params);
    }
  );

  defineTool(
    server,
    "ncloud_list_mssql_log_backup_files",
    "List transaction log backup files of one database in one backup set for a Cloud DB for MSSQL instance",
    {
      cloudMssqlInstanceNo: z.string().describe("Cloud MSSQL instance number"),
      // 가이드에는 없지만 기존 호출과의 호환을 위해 선택값으로 남긴다(보내도 200 확인, 금융존 테스트).
      cloudMssqlServerInstanceNo: z.string().optional().describe("Cloud MSSQL server instance number (optional)"),
      // databaseName·backupSetId 는 API 필수(금융존 테스트 E-14, 가이드 동일).
      databaseName: z.string().describe("Database name (from ncloud_list_mssql_backup_details)"),
      backupSetId: z.string().describe("Backup set ID (backupSetId in ncloud_list_mssql_backup_details)"),
    },
    async (params) => {
      return client.request("/vmssql/v2/getCloudMssqlLogBackupFileList", params);
    }
  );

  defineTool(
    server,
    "ncloud_list_mssql_log_files",
    "List log files of one type for a Cloud DB for MSSQL server instance",
    {
      // 가이드 database-vmssql-getcloudmssqllogfilelist: cloudMssqlInstanceNo·cloudMssqlServerInstanceNo·fileType Required(세 존 동일).
      cloudMssqlInstanceNo: z.string().describe("Cloud MSSQL instance number"),
      cloudMssqlServerInstanceNo: z.string().describe("Cloud MSSQL server instance number"),
      fileType: z.enum(["errorLog", "agentLog", "traceLog", "auditLog", "xeBaselineLog"]).describe("Log file type"),
    },
    async (params) => {
      return client.request("/vmssql/v2/getCloudMssqlLogFileList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_mssql_image_products",
    "List available Cloud DB for MSSQL image product codes (engine versions)",
    {
      regionCode: z.string().optional().describe("Region code (see ncloud_get_regions). Defaults to current region."),
    },
    async (params) => {
      return client.request("/vmssql/v2/getCloudMssqlImageProductList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_mssql_products",
    "List available Cloud DB for MSSQL server spec product codes",
    {
      cloudMssqlImageProductCode: z.string().describe("MSSQL image product code (from ncloud_get_mssql_image_products)"),
    },
    async (params) => {
      return client.request("/vmssql/v2/getCloudMssqlProductList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_mssql_target_vpcs",
    "List VPCs available for Cloud DB for MSSQL",
    {
      regionCode: z.string().optional().describe("Region code (see ncloud_get_regions). Defaults to current region."),
    },
    async (params) => {
      return client.request("/vmssql/v2/getCloudMssqlTargetVpcList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_mssql_target_subnets",
    "List subnets in a VPC that can host a new Cloud DB for MSSQL instance of the given image",
    {
      // 가이드 database-vmssql-getcloudmssqltargetsubnetlist: vpcNo·cloudMssqlImageProductCode Required(세 존 동일).
      vpcNo: z.string().describe("VPC number"),
      cloudMssqlImageProductCode: z.string().describe("MSSQL image product code"),
      isPublic: z.boolean().optional().describe("true = public subnets only (API default), false = private subnets only"),
      regionCode: z.string().optional().describe("Region code (see ncloud_get_regions). Defaults to current region."),
    },
    async (params) => {
      return client.request("/vmssql/v2/getCloudMssqlTargetSubnetList", params);
    }
  );

  defineTool(
    server,
    "ncloud_list_mssql_character_sets",
    "List available character sets for Cloud DB for MSSQL",
    {
      regionCode: z.string().optional().describe("Region code (see ncloud_get_regions). Defaults to current region."),
    },
    async (params) => {
      return client.request("/vmssql/v2/getCloudMssqlCharacterSetList", params);
    }
  );

  defineTool(
    server,
    "ncloud_list_mssql_config_groups",
    "List available Config Groups for Cloud DB for MSSQL",
    {
      regionCode: z.string().optional().describe("Region code (see ncloud_get_regions). Defaults to current region."),
    },
    async (params) => {
      return client.request("/vmssql/v2/getCloudMssqlConfigGroupList", params);
    }
  );

  defineTool(
    server,
    "ncloud_list_mssql_buckets",
    "List Object Storage buckets available for Cloud DB for MSSQL backup export",
    {
      // cloudMssqlInstanceNo·cloudMssqlServerName 은 API 필수(금융존 테스트 E-14).
      cloudMssqlInstanceNo: z.string().describe("Cloud MSSQL instance number"),
      cloudMssqlServerName: z.string().describe("MSSQL server name, e.g. m-<instanceNo>-001 (see ncloud_get_mssql_instance_detail)"),
      regionCode: z.string().optional().describe("Region code (see ncloud_get_regions). Defaults to current region."),
    },
    async (params) => {
      return client.request("/vmssql/v2/getCloudMssqlBucketList", params);
    }
  );

  defineTool(
    server,
    "ncloud_list_mssql_folders",
    "List folders within an Object Storage bucket for Cloud DB for MSSQL",
    {
      bucketName: z.string().describe("Object Storage bucket name"),
    },
    async (params) => {
      return client.request("/vmssql/v2/getCloudMssqlFolderList", params);
    }
  );

  // ─── Create Tools ──────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_create_mssql_instance",
    "Create a new Cloud DB for MSSQL instance. Server names are assigned automatically (m-<instanceNo>-001); there is no server name prefix option. " +
      "Use dryRun=true to preview without creating.",
    {
      cloudMssqlServiceName: z.string({
        required_error: requiredError("cloudMssqlServiceName"),
      }).describe("MSSQL service name (3-15 chars: letters, Korean, numbers, hyphen)"),
      vpcNo: z.string({
        required_error: requiredError("vpcNo"),
      }).describe("VPC number"),
      subnetNo: z.string({
        required_error: requiredError("subnetNo"),
      }).describe("Subnet number"),
      cloudMssqlUserName: z.string({
        required_error: requiredError("cloudMssqlUserName"),
      }).describe("Initial admin user name"),
      cloudMssqlUserPassword: z.string({
        required_error: requiredError("cloudMssqlUserPassword"),
      }).describe("Initial admin user password"),
      isHa: z.boolean({
        required_error: requiredError("isHa"),
      }).describe("High availability mode (true creates Mirror server, 2 servers total)"),
      cloudMssqlImageProductCode: z.string().optional().describe("MSSQL image product code"),
      cloudMssqlProductCode: z.string().optional().describe("MSSQL server product (spec) code"),
      mirrorSubnetNo: z.string().optional().describe("Mirror server subnet number. Required when isMultiZone=true."),
      dataStorageTypeCode: z.string().optional().describe("Data storage type: SSD | HDD (G2 images, default SSD); CB2 for G3 images (public zone only). Cannot be changed later"),
      isMultiZone: z.boolean().optional().describe("Multi Zone mode (only when isHa=true)"),
      characterSetName: z.string().optional().describe("DB character set (Korean_Wansung_CI_AS | SQL_Latin1_General_CP1_CI_AS)"),
      engineVersionCode: z.string().optional().describe("DB engine version code"),
      configGroupNo: z.string().optional().describe("Config Group number"),
      cloudMssqlPort: z.number().optional().describe("MSSQL port number (default: 1433, range: 10000-20000)"),
      backupTime: z.string().optional().describe("Backup time HH:mm in 15-minute steps. Required when isAutomaticBackup=false"),
      backupFileRetentionPeriod: z.number().optional().describe("Backup retention period in days (1-30)"),
      // isBackup 은 어느 존 가이드에도 없는 유령 파라미터였다(보내도 무시돼 "백업 끔" 요청이 반영되지 않음, 금융존 테스트 S-05).
      isAutomaticBackup: z.boolean().optional().describe("Let the server pick the backup time (default true). If false, backupTime is required. Backups cannot be turned off"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the instance"),
    },
    async (params) => {
      const { dryRun, ...apiParams } = params;
      // 가이드(pub·fin): backupTime 은 Conditional — isAutomaticBackup=false 이면 필수. dryRun 도 같이 막는다.
      if (params.isAutomaticBackup === false && !params.backupTime) {
        return {
          content: [{
            type: "text" as const,
            text: L({
              ko: "❌ isAutomaticBackup=false 이면 backupTime(HH:mm, 15분 단위)이 필수입니다.",
              en: "❌ backupTime (HH:mm, 15-minute steps) is required when isAutomaticBackup=false.",
            }),
          }],
          isError: true,
        };
      }
      if (dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: MSSQL Instance Creation",
          endpoint: "/vmssql/v2/createCloudMssqlInstance",
          requestParams: apiParams,
          noun: { ko: "MSSQL 인스턴스", en: "MSSQL instance" },
        });
      }

      const result = await client.request("/vmssql/v2/createCloudMssqlInstance", apiParams);
      const instance = result.cloudMssqlInstanceList?.[0];
      const summary = {
        리소스타입: "MSSQL",
        리소스ID: instance?.cloudMssqlInstanceNo ?? "unknown",
        서비스명: params.cloudMssqlServiceName,
        상태: instance?.cloudMssqlInstanceStatus?.codeName ?? "creating",
        생성시각: instance?.createDate ?? new Date().toISOString(),
        VPC: params.vpcNo,
        서브넷: params.subnetNo,
        고가용성: params.isHa,
      };
      return summary;
    }
  );

  defineTool(
    server,
    "ncloud_create_mssql_slave",
    "Create a slave server instance for a Cloud DB for MSSQL instance",
    {
      cloudMssqlInstanceNo: z.string().describe("Cloud MSSQL instance number to create slave for"),
      privateDomainPostfix: z.string().describe("Private domain postfix (001-999)"),
      subnetNo: z.string().optional().describe("Subnet number for the slave instance. Required when Multi Zone is enabled."),
    },
    async (params) => {
      return client.request("/vmssql/v2/createCloudMssqlSlaveInstance", params);
    }
  );

  // ─── Operation Tools ───────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_reboot_mssql_server",
    "Reboot a Cloud DB for MSSQL server instance",
    {
      cloudMssqlServerInstanceNo: z.string().describe("Cloud MSSQL server instance number to reboot"),
    },
    async (params) => {
      return client.request("/vmssql/v2/rebootCloudMssqlServerInstance", params);
    }
  );

  // ─── Export Tools ──────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_export_mssql_backup",
    "Export Cloud DB for MSSQL backup files to Object Storage. Use ncloud_list_mssql_backup_details to get available file names.",
    {
      cloudMssqlInstanceNo: z.string().describe("Cloud MSSQL instance number"),
      cloudMssqlServerInstanceNo: z.string().describe("Cloud MSSQL server instance number"),
      bucketName: z.string().describe("Object Storage bucket name to export to"),
      folderPath: z.string().optional().describe("Folder path within the bucket. If omitted, exports to bucket root."),
      cloudMssqlExportObjectList: z.array(z.object({
        fullObjectName: z.string().describe("Full object name of the backup file to export"),
      })).min(1).describe("List of backup objects to export"),
    },
    async (params) => {
      const { cloudMssqlInstanceNo, cloudMssqlServerInstanceNo, bucketName, folderPath, cloudMssqlExportObjectList } = params;
      const requestParams: any = { cloudMssqlInstanceNo, cloudMssqlServerInstanceNo, bucketName };
      if (folderPath) requestParams.folderPath = folderPath;

      for (let i = 0; i < cloudMssqlExportObjectList.length; i++) {
        requestParams[`cloudMssqlExportObjectList.${i + 1}.fullObjectName`] = cloudMssqlExportObjectList[i].fullObjectName;
      }

      const result = await client.request("/vmssql/v2/exportBackupToObjectStorage", requestParams);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_export_mssql_log",
    "Export Cloud DB for MSSQL server logs to Object Storage. Use ncloud_list_mssql_log_files to get available log files.",
    {
      cloudMssqlInstanceNo: z.string().describe("Cloud MSSQL instance number"),
      cloudMssqlServerInstanceNo: z.string().describe("Cloud MSSQL server instance number"),
      bucketName: z.string().describe("Object Storage bucket name to export to"),
      folderPath: z.string().optional().describe("Folder path within the bucket. If omitted, exports to bucket root."),
      // 가이드 database-vmssql-exportdbserverlogstoobjectstorage: 목록 키는 cloudMssqlObjectNameList.N(문자열 목록).
      //   예전에는 백업 내보내기와 같은 cloudMssqlExportObjectList.N.fullObjectName 으로 보냈다(금융존 문서 대조).
      cloudMssqlObjectNameList: z.array(z.string()).min(1).describe("Log file object names to export (from ncloud_list_mssql_log_files)"),
    },
    async (params) => {
      const { cloudMssqlInstanceNo, cloudMssqlServerInstanceNo, bucketName, folderPath, cloudMssqlObjectNameList } = params;
      const requestParams: any = { cloudMssqlInstanceNo, cloudMssqlServerInstanceNo, bucketName, cloudMssqlObjectNameList };
      if (folderPath) requestParams.folderPath = folderPath;

      const result = await client.request("/vmssql/v2/exportDbServerLogsToObjectStorage", requestParams);
      return result;
    }
  );

  // ─── Destructive Tools (with confirm gate) ─────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_mssql_instance",
    "⚠️ Destructive: Permanently delete a Cloud DB for MSSQL instance. Set confirm=true to execute.",
    {
      cloudMssqlInstanceNo: z.string().describe("Cloud MSSQL instance number to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vmssql/v2/deleteCloudMssqlInstance", apiParams);
      return result;
    },
    { destructive: { noun: "MSSQL instance", describe: (params) => params.cloudMssqlInstanceNo } }
  );

  defineTool(
    server,
    "ncloud_delete_mssql_server",
    "⚠️ Destructive: Delete a Slave server instance from a Cloud DB for MSSQL cluster. Set confirm=true to execute.",
    {
      cloudMssqlServerInstanceNo: z.string().describe("Cloud MSSQL server instance number to delete (Slave only)"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vmssql/v2/deleteCloudMssqlServerInstance", apiParams);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete MSSQL server instance [${params.cloudMssqlServerInstanceNo}] (Slave only). Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.` } }
  );
}
