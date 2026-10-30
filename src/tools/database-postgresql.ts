import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { L, requiredError } from "./_messages.js";
import { dryRunPreview } from "./_dryrun.js";

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
      const { dryRun, ...apiParams } = params;
      if (dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: PostgreSQL Instance Creation",
          endpoint: "/vpostgresql/v2/createCloudPostgresqlInstance",
          requestParams: apiParams,
          noun: { ko: "PostgreSQL 인스턴스", en: "PostgreSQL instance" },
        });
      }

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
      // owner 는 API 필수(금융존 테스트 E-13 — 없으면 900 location: cloudPostgresqlDatabaseList.N.owner).
      cloudPostgresqlDatabaseList: z.array(z.object({
        name: z.string().describe("Database name to add"),
        owner: z.string().describe("Owner — an existing DB user name (see ncloud_list_postgresql_users)"),
      })).min(1).describe("List of databases to add"),
    },
    async (params) => {
      const { cloudPostgresqlInstanceNo, cloudPostgresqlDatabaseList } = params;
      const requestParams: any = { cloudPostgresqlInstanceNo };

      for (let i = 0; i < cloudPostgresqlDatabaseList.length; i++) {
        const db = cloudPostgresqlDatabaseList[i];
        requestParams[`cloudPostgresqlDatabaseList.${i + 1}.name`] = db.name;
        requestParams[`cloudPostgresqlDatabaseList.${i + 1}.owner`] = db.owner;
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
    "Add users to a Cloud DB for PostgreSQL instance. clientCidr limits where the user can connect from — avoid 0.0.0.0/0.",
    {
      cloudPostgresqlInstanceNo: z.string().describe("Cloud PostgreSQL instance number"),
      // clientCidr·isReplicationRole 은 API 필수(금융존 테스트 E-13 — 900 이 하나씩 차례로 났다).
      cloudPostgresqlUserList: z.array(z.object({
        name: z.string().describe("User name to add"),
        password: z.string().describe("User password"),
        clientCidr: z.string().describe("Client CIDR allowed to connect (e.g. 10.0.0.0/16)"),
        isReplicationRole: z.boolean().default(false).describe("Grant the replication role (default false)"),
      })).min(1).describe("List of users to add"),
    },
    async (params) => {
      const { cloudPostgresqlInstanceNo, cloudPostgresqlUserList } = params;
      const requestParams: any = { cloudPostgresqlInstanceNo };

      for (let i = 0; i < cloudPostgresqlUserList.length; i++) {
        const user = cloudPostgresqlUserList[i];
        requestParams[`cloudPostgresqlUserList.${i + 1}.name`] = user.name;
        requestParams[`cloudPostgresqlUserList.${i + 1}.password`] = user.password;
        requestParams[`cloudPostgresqlUserList.${i + 1}.clientCidr`] = user.clientCidr;
        requestParams[`cloudPostgresqlUserList.${i + 1}.isReplicationRole`] = user.isReplicationRole;
      }

      const result = await client.request("/vpostgresql/v2/addCloudPostgresqlUserList", requestParams);
      const open = cloudPostgresqlUserList.filter((u) => u.clientCidr.trim() === "0.0.0.0/0").map((u) => u.name);
      if (open.length === 0) return result;
      return {
        ...result,
        warning: L({
          ko: `⚠️ 사용자 [${open.join(", ")}]의 clientCidr 가 0.0.0.0/0 이라 모든 주소에서 접속할 수 있습니다. 필요한 대역으로 좁히는 것을 권장합니다.`,
          en: `⚠️ User(s) [${open.join(", ")}] have clientCidr 0.0.0.0/0 and can connect from any address. Narrow it to the ranges you need.`,
        }),
      };
    }
  );

  defineTool(
    server,
    "ncloud_change_postgresql_users",
    "Change users (password, client CIDR, replication role) for a Cloud DB for PostgreSQL instance",
    {
      cloudPostgresqlInstanceNo: z.string().describe("Cloud PostgreSQL instance number"),
      // 가이드 database-vpostgresql-changecloudpostgresqluserlist: password·clientCidr·isReplicationRole 은
      //   Conditional(셋 중 하나 이상). 예전 스키마는 password 만 받아 CIDR·복제 권한을 바꿀 수 없었다.
      cloudPostgresqlUserList: z.array(z.object({
        name: z.string().describe("User name to modify"),
        password: z.string().optional().describe("New password"),
        clientCidr: z.string().optional().describe("New client CIDR allowed to connect"),
        isReplicationRole: z.boolean().optional().describe("Grant (true) or revoke (false) the replication role"),
      }).refine((u) => u.password !== undefined || u.clientCidr !== undefined || u.isReplicationRole !== undefined, {
        message: "Set at least one of password, clientCidr, isReplicationRole",
      })).min(1).describe("List of users to modify"),
    },
    async (params) => {
      const { cloudPostgresqlInstanceNo, cloudPostgresqlUserList } = params;
      const requestParams: any = { cloudPostgresqlInstanceNo };

      for (let i = 0; i < cloudPostgresqlUserList.length; i++) {
        const user = cloudPostgresqlUserList[i];
        requestParams[`cloudPostgresqlUserList.${i + 1}.name`] = user.name;
        if (user.password !== undefined) requestParams[`cloudPostgresqlUserList.${i + 1}.password`] = user.password;
        if (user.clientCidr !== undefined) requestParams[`cloudPostgresqlUserList.${i + 1}.clientCidr`] = user.clientCidr;
        if (user.isReplicationRole !== undefined) requestParams[`cloudPostgresqlUserList.${i + 1}.isReplicationRole`] = user.isReplicationRole;
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
      regionCode: z.string().optional().describe("Region code (see ncloud_get_regions). Defaults to current region."),
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
      regionCode: z.string().optional().describe("Region code (see ncloud_get_regions). Defaults to current region."),
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
      regionCode: z.string().optional().describe("Region code (see ncloud_get_regions). Defaults to current region."),
    },
    async (params) => {
      return client.request("/vpostgresql/v2/getCloudPostgresqlTargetVpcList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_postgresql_target_subnets",
    "List subnets in a VPC that can host a new Cloud DB for PostgreSQL instance of the given image",
    {
      // 가이드 database-vpostgresql-getcloudpostgresqltargetsubnetlist: vpcNo·cloudPostgresqlImageProductCode Required(세 존 동일).
      vpcNo: z.string().describe("VPC number"),
      cloudPostgresqlImageProductCode: z.string().describe("PostgreSQL image product code"),
      isPublic: z.boolean().optional().describe("true = public subnets only, false = private subnets only"),
      regionCode: z.string().optional().describe("Region code (see ncloud_get_regions). Defaults to current region."),
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
      regionCode: z.string().optional().describe("Region code (see ncloud_get_regions). Defaults to current region."),
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
      regionCode: z.string().optional().describe("Region code (see ncloud_get_regions). Defaults to current region."),
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
      // 가이드 database-vpostgresql-getdbserverloglist: logType Required(POSTGRESQL_LOG 만, 세 존 동일) — 고정값으로 보낸다.
      pageNo: z.number().int().min(0).optional().describe("Page number (pageSize is required when set)"),
      pageSize: z.number().int().min(1).max(1000).optional().describe("Page size, 1-1000"),
      regionCode: z.string().optional().describe("Region code (see ncloud_get_regions). Defaults to current region."),
    },
    async (params) => {
      return client.request("/vpostgresql/v2/getDbServerLogList", { ...params, logType: "POSTGRESQL_LOG" });
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
      // PostgreSQL 의 logType 허용 값은 POSTGRESQL_LOG 하나(금융존 테스트 E-12, 5000026 응답으로 확인).
      logType: z.enum(["POSTGRESQL_LOG"]).default("POSTGRESQL_LOG").describe("Log type (only POSTGRESQL_LOG is supported)"),
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
