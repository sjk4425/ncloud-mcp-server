import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";

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
    "List log backup files for a Cloud DB for MSSQL instance",
    {
      cloudMssqlInstanceNo: z.string().describe("Cloud MSSQL instance number"),
      cloudMssqlServerInstanceNo: z.string().describe("Cloud MSSQL server instance number"),
    },
    async (params) => {
      return client.request("/vmssql/v2/getCloudMssqlLogBackupFileList", params);
    }
  );

  defineTool(
    server,
    "ncloud_list_mssql_log_files",
    "List log files for a Cloud DB for MSSQL server instance",
    {
      cloudMssqlServerInstanceNo: z.string().describe("Cloud MSSQL server instance number"),
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
      regionCode: z.string().optional().describe("Region code (e.g. KR, SGN, JPN). Defaults to current region."),
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
      regionCode: z.string().optional().describe("Region code (e.g. KR, SGN, JPN). Defaults to current region."),
    },
    async (params) => {
      return client.request("/vmssql/v2/getCloudMssqlTargetVpcList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_mssql_target_subnets",
    "List subnets available for Cloud DB for MSSQL within a specific instance",
    {
      cloudMssqlInstanceNo: z.string().describe("Cloud MSSQL instance number"),
      regionCode: z.string().optional().describe("Region code (e.g. KR, SGN, JPN). Defaults to current region."),
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
      regionCode: z.string().optional().describe("Region code (e.g. KR, SGN, JPN). Defaults to current region."),
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
      regionCode: z.string().optional().describe("Region code (e.g. KR, SGN, JPN). Defaults to current region."),
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
      regionCode: z.string().optional().describe("Region code (e.g. KR, SGN, JPN). Defaults to current region."),
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
    "Create a new Cloud DB for MSSQL instance. Use dryRun=true to preview without creating.",
    {
      cloudMssqlServiceName: z.string({
        required_error: "필수 파라미터 'cloudMssqlServiceName'이 누락되었습니다.",
      }).describe("MSSQL service name (3-20 chars, lowercase letters and numbers)"),
      vpcNo: z.string({
        required_error: "필수 파라미터 'vpcNo'이 누락되었습니다.",
      }).describe("VPC number"),
      subnetNo: z.string({
        required_error: "필수 파라미터 'subnetNo'이 누락되었습니다.",
      }).describe("Subnet number"),
      cloudMssqlUserName: z.string({
        required_error: "필수 파라미터 'cloudMssqlUserName'이 누락되었습니다.",
      }).describe("Initial admin user name"),
      cloudMssqlUserPassword: z.string({
        required_error: "필수 파라미터 'cloudMssqlUserPassword'이 누락되었습니다.",
      }).describe("Initial admin user password"),
      isHa: z.boolean({
        required_error: "필수 파라미터 'isHa'이 누락되었습니다.",
      }).describe("High availability mode (true creates Mirror server, 2 servers total)"),
      cloudMssqlImageProductCode: z.string().optional().describe("MSSQL image product code"),
      cloudMssqlProductCode: z.string().optional().describe("MSSQL server product (spec) code"),
      mirrorSubnetNo: z.string().optional().describe("Mirror server subnet number. Required when isMultiZone=true."),
      dataStorageTypeCode: z.string().optional().describe("Data storage type: SSD | HDD | CB2"),
      isMultiZone: z.boolean().optional().describe("Multi Zone mode (only when isHa=true)"),
      characterSetName: z.string().optional().describe("DB character set (Korean_Wansung_CI_AS | SQL_Latin1_General_CP1_CI_AS)"),
      engineVersionCode: z.string().optional().describe("DB engine version code"),
      configGroupNo: z.string().optional().describe("Config Group number"),
      cloudMssqlPort: z.number().optional().describe("MSSQL port number (default: 1433, range: 10000-20000)"),
      isBackup: z.boolean().optional().describe("Whether to enable automatic backup"),
      backupTime: z.string().optional().describe("Backup time (HH:mm format)"),
      backupFileRetentionPeriod: z.number().optional().describe("Backup retention period in days (1-30)"),
      isAutomaticBackup: z.boolean().optional().describe("Whether to enable automatic backup scheduling"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the instance"),
    },
    async (params) => {
      if (params.dryRun) {
        const preview = {
          label: "🔍 Dry-Run Preview: MSSQL Instance Creation",
          cloudMssqlServiceName: params.cloudMssqlServiceName,
          vpcNo: params.vpcNo,
          subnetNo: params.subnetNo,
          cloudMssqlUserName: params.cloudMssqlUserName,
          isHa: params.isHa,
          isMultiZone: params.isMultiZone ?? false,
          characterSetName: params.characterSetName ?? "Korean_Wansung_CI_AS",
          cloudMssqlPort: params.cloudMssqlPort ?? 1433,
          isBackup: params.isBackup ?? true,
          message: "이 요청은 실제 MSSQL 인스턴스를 생성하지 않습니다. dryRun=false로 호출하면 인스턴스가 생성됩니다.",
        };
        return preview;
      }

      const { dryRun, ...apiParams } = params;
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
      cloudMssqlExportObjectList: z.array(z.object({
        fullObjectName: z.string().describe("Full object name of the log file to export"),
      })).min(1).describe("List of log objects to export"),
    },
    async (params) => {
      const { cloudMssqlInstanceNo, cloudMssqlServerInstanceNo, bucketName, folderPath, cloudMssqlExportObjectList } = params;
      const requestParams: any = { cloudMssqlInstanceNo, cloudMssqlServerInstanceNo, bucketName };
      if (folderPath) requestParams.folderPath = folderPath;

      for (let i = 0; i < cloudMssqlExportObjectList.length; i++) {
        requestParams[`cloudMssqlExportObjectList.${i + 1}.fullObjectName`] = cloudMssqlExportObjectList[i].fullObjectName;
      }

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
      if (!params.confirm) {
        const message = `⚠️ This will permanently delete MSSQL instance [${params.cloudMssqlInstanceNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
        return { content: [{ type: "text" as const, text: message }] };
      }
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vmssql/v2/deleteCloudMssqlInstance", apiParams);
      return result;
    }
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
      if (!params.confirm) {
        const message = `⚠️ This will permanently delete MSSQL server instance [${params.cloudMssqlServerInstanceNo}] (Slave only). Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
        return { content: [{ type: "text" as const, text: message }] };
      }
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vmssql/v2/deleteCloudMssqlServerInstance", apiParams);
      return result;
    }
  );
}
