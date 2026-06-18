import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { dryRunMessage, requiredError } from "./_messages.js";

export function registerDatabasePostgresqlTools(server: McpServer, client: NcloudClient): void {
  // ─── Query Tools ───────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_postgresql_instances",
    "List all Cloud DB for PostgreSQL instances in the current region",
    {
      cloudPostgresqlInstanceNoList: z.array(z.string()).optional().describe("Filter by PostgreSQL instance numbers"),
      cloudPostgresqlServiceName: z.string().optional().describe("Filter by PostgreSQL service name"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      return client.request("/vpostgresql/v2/getCloudPostgresqlInstanceList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_postgresql_instance_detail",
    "Get detailed information about a specific Cloud DB for PostgreSQL instance",
    {
      cloudPostgresqlInstanceNo: z.string().describe("Cloud PostgreSQL instance number to query"),
    },
    async (params) => {
      return client.request("/vpostgresql/v2/getCloudPostgresqlInstanceDetail", params);
    }
  );

  defineTool(
    server,
    "ncloud_list_postgresql_backups",
    "List backups for a Cloud DB for PostgreSQL instance",
    {
      cloudPostgresqlInstanceNo: z.string().describe("Cloud PostgreSQL instance number"),
    },
    async (params) => {
      return client.request("/vpostgresql/v2/getCloudPostgresqlBackupList", params);
    }
  );

  // ─── Create Tools ──────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_create_postgresql_instance",
    "Create a new Cloud DB for PostgreSQL instance. Use dryRun=true to preview without creating.",
    {
      cloudPostgresqlServiceName: z.string({
        required_error: requiredError("cloudPostgresqlServiceName"),
      }).describe("PostgreSQL service name (3-20 chars, lowercase letters and numbers)"),
      vpcNo: z.string({
        required_error: requiredError("vpcNo"),
      }).describe("VPC number"),
      subnetNo: z.string({
        required_error: requiredError("subnetNo"),
      }).describe("Subnet number"),
      cloudPostgresqlDatabaseName: z.string({
        required_error: requiredError("cloudPostgresqlDatabaseName"),
      }).describe("Initial database name"),
      cloudPostgresqlUserName: z.string({
        required_error: requiredError("cloudPostgresqlUserName"),
      }).describe("Initial user name"),
      cloudPostgresqlUserPassword: z.string({
        required_error: requiredError("cloudPostgresqlUserPassword"),
      }).describe("Initial user password"),
      cloudPostgresqlServerNamePrefix: z.string({
        required_error: requiredError("cloudPostgresqlServerNamePrefix"),
      }).describe("Server name prefix"),
      clientCidr: z.string({
        required_error: requiredError("clientCidr"),
      }).describe("Client CIDR for access control"),
      cloudPostgresqlImageProductCode: z.string().optional().describe("PostgreSQL image product code"),
      cloudPostgresqlProductCode: z.string().optional().describe("PostgreSQL server product (spec) code"),
      isMultiZone: z.boolean().optional().describe("Whether to enable multi-zone high availability"),
      secondarySubnetNo: z.string().optional().describe("Secondary subnet number (required when isMultiZone is true)"),
      isHa: z.boolean().optional().describe("High availability setting (default: true)"),
      dataStorageTypeCode: z.string().optional().describe("Data storage type code (SSD | HDD | CB2)"),
      isStorageEncryption: z.boolean().optional().describe("Storage encryption (cannot be changed after creation)"),
      isBackup: z.boolean().optional().describe("Whether to enable automatic backup"),
      backupTime: z.string().optional().describe("Backup time (HH:mm format)"),
      backupFileRetentionPeriod: z.number().optional().describe("Backup retention period in days (1-30)"),
      backupFileStorageCount: z.number().optional().describe("Number of backup files to retain (1-30)"),
      isBackupFileCompression: z.boolean().optional().describe("Whether to compress backup files"),
      isAutomaticBackup: z.boolean().optional().describe("Whether to enable automatic backup scheduling"),
      cloudPostgresqlPort: z.number().optional().describe("PostgreSQL port number (default: 5432)"),
      engineVersionCode: z.string().optional().describe("PostgreSQL engine version code (required for Gen3/KVM)"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the instance"),
    },
    async (params) => {
      if (params.dryRun) {
        const preview = {
          label: "🔍 Dry-Run Preview: PostgreSQL Instance Creation",
          cloudPostgresqlServiceName: params.cloudPostgresqlServiceName,
          vpcNo: params.vpcNo,
          subnetNo: params.subnetNo,
          cloudPostgresqlDatabaseName: params.cloudPostgresqlDatabaseName,
          cloudPostgresqlUserName: params.cloudPostgresqlUserName,
          isMultiZone: params.isMultiZone ?? false,
          isBackup: params.isBackup ?? true,
          cloudPostgresqlPort: params.cloudPostgresqlPort ?? 5432,
          message: dryRunMessage({ ko: "PostgreSQL 인스턴스", en: "PostgreSQL instance" }),
        };
        return preview;
      }

      const { dryRun, ...apiParams } = params;
      const result = await client.request("/vpostgresql/v2/createCloudPostgresqlInstance", apiParams);
      const instance = result.cloudPostgresqlInstanceList?.[0];
      const summary = {
        리소스타입: "PostgreSQL",
        리소스ID: instance?.cloudPostgresqlInstanceNo ?? "unknown",
        서비스명: params.cloudPostgresqlServiceName,
        상태: instance?.cloudPostgresqlInstanceStatus?.codeName ?? "creating",
        생성시각: instance?.createDate ?? new Date().toISOString(),
        VPC: params.vpcNo,
        서브넷: params.subnetNo,
        데이터베이스명: params.cloudPostgresqlDatabaseName,
      };
      return summary;
    }
  );

  defineTool(
    server,
    "ncloud_create_postgresql_read_replica",
    "Create a read replica for a Cloud DB for PostgreSQL instance",
    {
      cloudPostgresqlInstanceNo: z.string().describe("Cloud PostgreSQL instance number to create read replica for"),
      subnetNo: z.string().optional().describe("Subnet number for the read replica instance"),
      cloudPostgresqlServerNamePrefix: z.string().optional().describe("Server name prefix for the read replica"),
    },
    async (params) => {
      return client.request("/vpostgresql/v2/createCloudPostgresqlReadReplicaInstance", params);
    }
  );

  // ─── Operation Tools ───────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_reboot_postgresql_server",
    "Reboot a Cloud DB for PostgreSQL server instance",
    {
      cloudPostgresqlServerInstanceNo: z.string().describe("Cloud PostgreSQL server instance number to reboot"),
    },
    async (params) => {
      return client.request("/vpostgresql/v2/rebootCloudPostgresqlServerInstance", params);
    }
  );

  // ─── Database Management Tools ──────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_postgresql_databases",
    "List databases in a Cloud DB for PostgreSQL instance",
    {
      cloudPostgresqlInstanceNo: z.string().describe("Cloud PostgreSQL instance number"),
    },
    async (params) => {
      return client.request("/vpostgresql/v2/getCloudPostgresqlDatabaseList", params);
    }
  );

  defineTool(
    server,
    "ncloud_add_postgresql_databases",
    "Add databases to a Cloud DB for PostgreSQL instance",
    {
      cloudPostgresqlInstanceNo: z.string().describe("Cloud PostgreSQL instance number"),
      cloudPostgresqlDatabaseList: z.array(z.object({
        name: z.string().describe("Database name to add"),
      })).min(1).describe("List of databases to add"),
    },
    async (params) => {
      const { cloudPostgresqlInstanceNo, cloudPostgresqlDatabaseList } = params;
      const requestParams: any = { cloudPostgresqlInstanceNo };

      for (let i = 0; i < cloudPostgresqlDatabaseList.length; i++) {
        const db = cloudPostgresqlDatabaseList[i];
        requestParams[`cloudPostgresqlDatabaseList.${i + 1}.name`] = db.name;
      }

      const result = await client.request("/vpostgresql/v2/addCloudPostgresqlDatabaseList", requestParams);
      return result;
    }
  );

  // ─── User Management Tools ─────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_postgresql_users",
    "List users in a Cloud DB for PostgreSQL instance",
    {
      cloudPostgresqlInstanceNo: z.string().describe("Cloud PostgreSQL instance number"),
    },
    async (params) => {
      return client.request("/vpostgresql/v2/getCloudPostgresqlUserList", params);
    }
  );

  defineTool(
    server,
    "ncloud_add_postgresql_users",
    "Add users to a Cloud DB for PostgreSQL instance",
    {
      cloudPostgresqlInstanceNo: z.string().describe("Cloud PostgreSQL instance number"),
      cloudPostgresqlUserList: z.array(z.object({
        name: z.string().describe("User name to add"),
        password: z.string().describe("User password"),
      })).min(1).describe("List of users to add"),
    },
    async (params) => {
      const { cloudPostgresqlInstanceNo, cloudPostgresqlUserList } = params;
      const requestParams: any = { cloudPostgresqlInstanceNo };

      for (let i = 0; i < cloudPostgresqlUserList.length; i++) {
        const user = cloudPostgresqlUserList[i];
        requestParams[`cloudPostgresqlUserList.${i + 1}.name`] = user.name;
        requestParams[`cloudPostgresqlUserList.${i + 1}.password`] = user.password;
      }

      const result = await client.request("/vpostgresql/v2/addCloudPostgresqlUserList", requestParams);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_change_postgresql_users",
    "Change user information (password) for a Cloud DB for PostgreSQL instance",
    {
      cloudPostgresqlInstanceNo: z.string().describe("Cloud PostgreSQL instance number"),
      cloudPostgresqlUserList: z.array(z.object({
        name: z.string().describe("User name to modify"),
        password: z.string().describe("New password for the user"),
      })).min(1).describe("List of users to modify"),
    },
    async (params) => {
      const { cloudPostgresqlInstanceNo, cloudPostgresqlUserList } = params;
      const requestParams: any = { cloudPostgresqlInstanceNo };

      for (let i = 0; i < cloudPostgresqlUserList.length; i++) {
        const user = cloudPostgresqlUserList[i];
        requestParams[`cloudPostgresqlUserList.${i + 1}.name`] = user.name;
        requestParams[`cloudPostgresqlUserList.${i + 1}.password`] = user.password;
      }

      const result = await client.request("/vpostgresql/v2/changeCloudPostgresqlUserList", requestParams);
      return result;
    }
  );

  // ─── Destructive Tools (with confirm gate) ─────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_postgresql_instance",
    "⚠️ Destructive: Permanently delete a Cloud DB for PostgreSQL instance. Set confirm=true to execute.",
    {
      cloudPostgresqlInstanceNo: z.string().describe("Cloud PostgreSQL instance number to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vpostgresql/v2/deleteCloudPostgresqlInstance", apiParams);
      return result;
    },
    { destructive: { noun: "PostgreSQL instance", describe: (params) => params.cloudPostgresqlInstanceNo } }
  );

  defineTool(
    server,
    "ncloud_delete_postgresql_databases",
    "⚠️ Destructive: Delete databases from a Cloud DB for PostgreSQL instance. Set confirm=true to execute.",
    {
      cloudPostgresqlInstanceNo: z.string().describe("Cloud PostgreSQL instance number"),
      cloudPostgresqlDatabaseList: z.array(z.object({
        name: z.string().describe("Database name to delete"),
      })).min(1).describe("List of databases to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, cloudPostgresqlInstanceNo, cloudPostgresqlDatabaseList } = params;
      const requestParams: any = { cloudPostgresqlInstanceNo };

      for (let i = 0; i < cloudPostgresqlDatabaseList.length; i++) {
        const db = cloudPostgresqlDatabaseList[i];
        requestParams[`cloudPostgresqlDatabaseList.${i + 1}.name`] = db.name;
      }

      const result = await client.request("/vpostgresql/v2/deleteCloudPostgresqlDatabaseList", requestParams);
      return result;
    },
    {
      destructive: {
        message: (params) => {
          const names = params.cloudPostgresqlDatabaseList.map((db: any) => db.name).join(", ");
          return `⚠️ This will permanently delete databases [${names}] from PostgreSQL instance [${params.cloudPostgresqlInstanceNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
        },
      },
    }
  );

  defineTool(
    server,
    "ncloud_delete_postgresql_users",
    "⚠️ Destructive: Delete users from a Cloud DB for PostgreSQL instance. Set confirm=true to execute.",
    {
      cloudPostgresqlInstanceNo: z.string().describe("Cloud PostgreSQL instance number"),
      cloudPostgresqlUserList: z.array(z.object({
        name: z.string().describe("User name to delete"),
      })).min(1).describe("List of users to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, cloudPostgresqlInstanceNo, cloudPostgresqlUserList } = params;
      const requestParams: any = { cloudPostgresqlInstanceNo };

      for (let i = 0; i < cloudPostgresqlUserList.length; i++) {
        const user = cloudPostgresqlUserList[i];
        requestParams[`cloudPostgresqlUserList.${i + 1}.name`] = user.name;
      }

      const result = await client.request("/vpostgresql/v2/deleteCloudPostgresqlUserList", requestParams);
      return result;
    },
    {
      destructive: {
        message: (params) => {
          const names = params.cloudPostgresqlUserList.map((u: any) => u.name).join(", ");
          return `⚠️ This will permanently delete users [${names}] from PostgreSQL instance [${params.cloudPostgresqlInstanceNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
        },
      },
    }
  );

  defineTool(
    server,
    "ncloud_delete_postgresql_read_replica",
    "⚠️ Destructive: Delete a Cloud DB for PostgreSQL Read Replica instance. Set confirm=true to execute.",
    {
      cloudPostgresqlReadReplicaInstanceNo: z.string().describe("Cloud PostgreSQL Read Replica instance number to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vpostgresql/v2/deleteCloudPostgresqlReadReplicaInstance", apiParams);
      return result;
    },
    { destructive: { noun: "PostgreSQL Read Replica instance", describe: (params) => params.cloudPostgresqlReadReplicaInstanceNo } }
  );

  // ─── Reference/Query Tools (P3) ────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_get_postgresql_image_products",
    "List available Cloud DB for PostgreSQL image product codes (engine versions)",
    {
      regionCode: z.string().optional().describe("Region code (e.g. KR, SGN, JPN). Defaults to current region."),
    },
    async (params) => {
      return client.request("/vpostgresql/v2/getCloudPostgresqlImageProductList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_postgresql_products",
    "List available Cloud DB for PostgreSQL server spec product codes for a given image product code",
    {
      cloudPostgresqlImageProductCode: z.string().describe("PostgreSQL image product code (from ncloud_get_postgresql_image_products)"),
      regionCode: z.string().optional().describe("Region code (e.g. KR, SGN, JPN). Defaults to current region."),
    },
    async (params) => {
      return client.request("/vpostgresql/v2/getCloudPostgresqlProductList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_postgresql_target_vpcs",
    "List VPCs available for Cloud DB for PostgreSQL instance creation",
    {
      regionCode: z.string().optional().describe("Region code (e.g. KR, SGN, JPN). Defaults to current region."),
    },
    async (params) => {
      return client.request("/vpostgresql/v2/getCloudPostgresqlTargetVpcList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_postgresql_target_subnets",
    "List subnets available for Cloud DB for PostgreSQL instance creation within a specific PostgreSQL instance",
    {
      cloudPostgresqlInstanceNo: z.string().describe("Cloud PostgreSQL instance number"),
      regionCode: z.string().optional().describe("Region code (e.g. KR, SGN, JPN). Defaults to current region."),
    },
    async (params) => {
      return client.request("/vpostgresql/v2/getCloudPostgresqlTargetSubnetList", params);
    }
  );

  defineTool(
    server,
    "ncloud_list_postgresql_backup_details",
    "List detailed backup information (including file names) for a Cloud DB for PostgreSQL instance",
    {
      cloudPostgresqlInstanceNo: z.string().describe("Cloud PostgreSQL instance number"),
      regionCode: z.string().optional().describe("Region code (e.g. KR, SGN, JPN). Defaults to current region."),
    },
    async (params) => {
      return client.request("/vpostgresql/v2/getCloudPostgresqlBackupDetailList", params);
    }
  );

  defineTool(
    server,
    "ncloud_list_postgresql_buckets",
    "List Object Storage buckets available for Cloud DB for PostgreSQL (for backup export)",
    {
      regionCode: z.string().optional().describe("Region code (e.g. KR, SGN, JPN). Defaults to current region."),
    },
    async (params) => {
      return client.request("/vpostgresql/v2/getCloudPostgresqlBucketList", params);
    }
  );

  defineTool(
    server,
    "ncloud_list_postgresql_logs",
    "List DB server log files for a Cloud DB for PostgreSQL server instance",
    {
      cloudPostgresqlServerInstanceNo: z.string().describe("Cloud PostgreSQL server instance number"),
      regionCode: z.string().optional().describe("Region code (e.g. KR, SGN, JPN). Defaults to current region."),
    },
    async (params) => {
      return client.request("/vpostgresql/v2/getDbServerLogList", params);
    }
  );

  defineTool(
    server,
    "ncloud_export_postgresql_backup",
    "Export a Cloud DB for PostgreSQL backup file to Object Storage. Use ncloud_list_postgresql_backup_details to get available file names.",
    {
      cloudPostgresqlInstanceNo: z.string().describe("Cloud PostgreSQL instance number"),
      fileName: z.string().describe("Backup file name to export (from ncloud_list_postgresql_backup_details)"),
      bucketName: z.string().describe("Object Storage bucket name to export to"),
      folderPath: z.string().optional().describe("Folder path within the bucket (e.g. 'postgresql-backups/daily'). If omitted, exports to bucket root."),
      regionCode: z.string().optional().describe("Region code (default: current region)"),
    },
    async (params) => {
      return client.request("/vpostgresql/v2/exportBackupToObjectStorage", params);
    }
  );

  defineTool(
    server,
    "ncloud_export_postgresql_log",
    "Export a Cloud DB for PostgreSQL server log file to Object Storage. Use ncloud_list_postgresql_logs to get available log files.",
    {
      cloudPostgresqlServerInstanceNo: z.string().describe("Cloud PostgreSQL server instance number"),
      logType: z.string().describe("Log type to export (e.g. ERROR, SLOW, etc.)"),
      fileName: z.string().describe("Log file name to export (from ncloud_list_postgresql_logs)"),
      bucketName: z.string().describe("Object Storage bucket name to export to"),
      folderPath: z.string().optional().describe("Folder path within the bucket (e.g. 'postgresql-logs/error'). If omitted, exports to bucket root."),
      regionCode: z.string().optional().describe("Region code (default: current region)"),
    },
    async (params) => {
      return client.request("/vpostgresql/v2/exportDbServerLogToObjectStorage", params);
    }
  );
}
