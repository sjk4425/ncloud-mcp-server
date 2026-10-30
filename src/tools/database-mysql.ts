import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { requiredError } from "./_messages.js";
import { dryRunPreview } from "./_dryrun.js";

/** getCloudMysqlEventHistoryList 의 날짜 형식 `yyyy-MM-dd HH:mm:ss`. */
const MYSQL_DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/** epoch ms → KST `yyyy-MM-dd HH:mm:ss`. */
export function kstDateTime(ms: number): string {
  return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
}

export function registerDatabaseMysqlTools(server: McpServer, client: NcloudClient): void {
  // ─── Query Tools ───────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_mysql_instances",
    "List all Cloud DB for MySQL instances in the current region",
    {
      cloudMysqlInstanceNoList: z.array(z.string()).optional().describe("Filter by MySQL instance numbers"),
      cloudMysqlServiceName: z.string().optional().describe("Filter by MySQL service name"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      return client.request("/vmysql/v2/getCloudMysqlInstanceList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_mysql_instance_detail",
    "Get detailed information about a specific Cloud DB for MySQL instance",
    {
      cloudMysqlInstanceNo: z.string().describe("Cloud MySQL instance number to query"),
    },
    async (params) => {
      return client.request("/vmysql/v2/getCloudMysqlInstanceDetail", params);
    }
  );

  defineTool(
    server,
    "ncloud_list_mysql_databases",
    "List databases in a Cloud DB for MySQL instance (paged; pageNo starts at 0)",
    {
      cloudMysqlInstanceNo: z.string().describe("Cloud MySQL instance number"),
      // 가이드 database-vmysql-getcloudmysqldatabaselist: pageNo·pageSize 는 Required(세 존 동일) — 없으면 900.
      pageNo: z.number().int().min(0).optional().default(0).describe("Page number, 0-based (default 0)"),
      pageSize: z.number().int().min(1).optional().default(20).describe("Page size (default 20)"),
    },
    async (params) => {
      return client.request("/vmysql/v2/getCloudMysqlDatabaseList", params);
    }
  );

  defineTool(
    server,
    "ncloud_list_mysql_users",
    "List users in a Cloud DB for MySQL instance (paged; pageNo starts at 0)",
    {
      cloudMysqlInstanceNo: z.string().describe("Cloud MySQL instance number"),
      // 가이드 database-vmysql-getcloudmysqluserlist: pageNo·pageSize 는 Required(세 존 동일).
      pageNo: z.number().int().min(0).optional().default(0).describe("Page number, 0-based (default 0)"),
      pageSize: z.number().int().min(1).optional().default(20).describe("Page size (default 20)"),
    },
    async (params) => {
      return client.request("/vmysql/v2/getCloudMysqlUserList", params);
    }
  );

  defineTool(
    server,
    "ncloud_list_mysql_backups",
    "List backups for a Cloud DB for MySQL instance",
    {
      cloudMysqlInstanceNo: z.string().describe("Cloud MySQL instance number"),
    },
    async (params) => {
      return client.request("/vmysql/v2/getCloudMysqlBackupList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_mysql_image_products",
    "List available Cloud DB for MySQL image product codes (engine versions)",
    {
      regionCode: z.string().optional().describe("Region code (see ncloud_get_regions). Defaults to current region."),
    },
    async (params) => {
      return client.request("/vmysql/v2/getCloudMysqlImageProductList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_mysql_products",
    "List available Cloud DB for MySQL server spec product codes for a given image product code",
    {
      cloudMysqlImageProductCode: z.string().describe("MySQL image product code (from ncloud_get_mysql_image_products)"),
      regionCode: z.string().optional().describe("Region code (see ncloud_get_regions). Defaults to current region."),
    },
    async (params) => {
      return client.request("/vmysql/v2/getCloudMysqlProductList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_mysql_target_vpcs",
    "List VPCs available for Cloud DB for MySQL instance creation",
    {
      regionCode: z.string().optional().describe("Region code (see ncloud_get_regions). Defaults to current region."),
    },
    async (params) => {
      return client.request("/vmysql/v2/getCloudMysqlTargetVpcList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_mysql_target_subnets",
    "List subnets in a VPC that can host a new Cloud DB for MySQL instance of the given image (use before ncloud_create_mysql_instance)",
    {
      // 가이드 database-vmysql-getcloudmysqltargetsubnetlist: vpcNo·cloudMysqlImageProductCode Required(세 존 동일).
      //   이전 스키마는 cloudMysqlInstanceNo 를 받아 항상 900 이었다(금융존 테스트 E-10).
      vpcNo: z.string({ required_error: requiredError("vpcNo") }).describe("VPC number (see ncloud_get_mysql_target_vpcs)"),
      cloudMysqlImageProductCode: z.string({ required_error: requiredError("cloudMysqlImageProductCode") }).describe("MySQL image product code (see ncloud_get_mysql_image_products)"),
      isPublic: z.boolean().optional().describe("true = public subnets only, false = private subnets only"),
      regionCode: z.string().optional().describe("Region code (see ncloud_get_regions). Defaults to current region."),
    },
    async (params) => {
      return client.request("/vmysql/v2/getCloudMysqlTargetSubnetList", params);
    }
  );

  defineTool(
    server,
    "ncloud_list_mysql_backup_details",
    "List detailed backup information (including file names) for a Cloud DB for MySQL instance",
    {
      cloudMysqlInstanceNo: z.string().describe("Cloud MySQL instance number"),
      regionCode: z.string().optional().describe("Region code (see ncloud_get_regions). Defaults to current region."),
    },
    async (params) => {
      return client.request("/vmysql/v2/getCloudMysqlBackupDetailList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_mysql_recovery_time",
    "Get the available recovery time range (recoveryStartTime ~ recoveryEndTime) for a Cloud DB for MySQL instance",
    {
      cloudMysqlInstanceNo: z.string().describe("Cloud MySQL instance number"),
      regionCode: z.string().optional().describe("Region code (see ncloud_get_regions). Defaults to current region."),
    },
    async (params) => {
      return client.request("/vmysql/v2/getCloudMysqlRecoveryTime", params);
    }
  );

  defineTool(
    server,
    "ncloud_list_mysql_events",
    "List event history for a Cloud DB for MySQL instance. startDate/endDate use 'yyyy-MM-dd HH:mm:ss' (KST); when omitted the last 7 days are queried.",
    {
      cloudMysqlInstanceNo: z.string().describe("Cloud MySQL instance number"),
      // 가이드 database-vmysql-getcloudmysqleventhistorylist: startDate·endDate Required, 형식 yyyy-MM-dd HH:mm:ss
      //   (금융존 실측: yyyy-MM-dd·ISO 형식은 5000006). 생략 시 최근 7일로 채운다.
      startDate: z.string().regex(MYSQL_DATETIME_RE, { message: "startDate must be 'yyyy-MM-dd HH:mm:ss'" }).optional().describe("Start, 'yyyy-MM-dd HH:mm:ss' (default: 7 days before endDate)"),
      endDate: z.string().regex(MYSQL_DATETIME_RE, { message: "endDate must be 'yyyy-MM-dd HH:mm:ss'" }).optional().describe("End, 'yyyy-MM-dd HH:mm:ss' (default: now, KST)"),
      cloudMysqlServerName: z.string().optional().describe("Filter by MySQL server name"),
      pageNo: z.number().int().min(0).optional().describe("Page number, 0-based (API default 0)"),
      pageSize: z.number().int().min(1).optional().describe("Page size (API default 20)"),
      regionCode: z.string().optional().describe("Region code (see ncloud_get_regions). Defaults to current region."),
    },
    async (params) => {
      const now = Date.now();
      const apiParams = {
        ...params,
        endDate: params.endDate ?? kstDateTime(now),
        startDate: params.startDate ?? kstDateTime(now - 7 * 24 * 60 * 60 * 1000),
      };
      return client.request("/vmysql/v2/getCloudMysqlEventHistoryList", apiParams);
    }
  );

  defineTool(
    server,
    "ncloud_list_mysql_logs",
    "List DB server log files of one log type for a Cloud DB for MySQL server instance (use the file names with ncloud_export_mysql_log)",
    {
      cloudMysqlServerInstanceNo: z.string().describe("Cloud MySQL server instance number (not the instance number)"),
      // 가이드 database-vmysql-getdbserverloglist: logType Required(세 존 동일).
      logType: z.enum(["BINARY", "ERROR", "SLOW", "GENERAL", "AUDIT"]).describe("Log type: BINARY (binlog), ERROR (error log), SLOW (slow query log), GENERAL (general log), AUDIT (audit log)"),
      regionCode: z.string().optional().describe("Region code (see ncloud_get_regions). Defaults to current region."),
    },
    async (params) => {
      return client.request("/vmysql/v2/getDbServerLogList", params);
    }
  );

  // ─── Create Tools ──────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_create_mysql_instance",
    "Create a new Cloud DB for MySQL instance. Use dryRun=true to preview without creating.",
    {
      // ── Required parameters ──
      cloudMysqlServiceName: z.string({
        required_error: requiredError("cloudMysqlServiceName"),
      }).describe("MySQL service name (3-30 chars, letters, numbers, Korean, '-')"),
      cloudMysqlServerNamePrefix: z.string({
        required_error: requiredError("cloudMysqlServerNamePrefix"),
      }).describe("Server name prefix (3-20 chars, starts with letter, ends with letter/number, allows '-')"),
      cloudMysqlUserName: z.string({
        required_error: requiredError("cloudMysqlUserName"),
      }).describe("DB user account ID (3-16 chars, starts with letter, allows letters/numbers/'-'/'_')"),
      cloudMysqlUserPassword: z.string({
        required_error: requiredError("cloudMysqlUserPassword"),
      }).describe("DB user password (8-20 chars, must include letter+number+special char)"),
      hostIp: z.string({
        required_error: requiredError("hostIp"),
      }).describe("Host IP for MySQL access (e.g. '%' for all, '1.1.1.1', '1.1.1.%', '1.1.1.0/24'). Use '%25' for '%' in GET requests."),
      cloudMysqlDatabaseName: z.string({
        required_error: requiredError("cloudMysqlDatabaseName"),
      }).describe("Initial database name (1-30 chars, starts with letter)"),
      vpcNo: z.string({
        required_error: requiredError("vpcNo"),
      }).describe("VPC number (getCloudMysqlTargetVpcList)"),
      subnetNo: z.string({
        required_error: requiredError("subnetNo"),
      }).describe("Subnet number for primary NIC (getCloudMysqlTargetSubnetList)"),
      // ── Optional parameters ──
      regionCode: z.string().optional().describe("Region code (see ncloud_get_regions). Defaults to first region."),
      cloudMysqlImageProductCode: z.string().optional().describe("MySQL image product code (getCloudMysqlImageProductList)"),
      cloudMysqlProductCode: z.string().optional().describe("MySQL server product (spec) code (getCloudMysqlProductList). Defaults to minimum spec."),
      dataStorageTypeCode: z.enum(["SSD", "HDD", "CB2"]).optional().describe("Data storage type. G2 default: SSD, G3 default: CB2. Cannot change after creation."),
      isHa: z.boolean().optional().describe("High availability (default: true). If true, creates Standby Master (2 servers). If false, isMultiZone/standbyMasterSubnetNo are ignored."),
      isMultiZone: z.boolean().optional().describe("Multi-zone HA (default: false). Required when isHa=true. Places Master and Standby in different zones."),
      standbyMasterSubnetNo: z.string().optional().describe("Subnet for Standby Master server. Required when isMultiZone=true. Must be different zone from primary subnet."),
      isStorageEncryption: z.boolean().optional().describe("Storage encryption (default: false). Only available when isHa=true. Cannot change after creation."),
      isBackup: z.boolean().optional().describe("Backup enabled (default: true). Fixed to true when isHa=true."),
      backupFileRetentionPeriod: z.number().optional().describe("Backup retention period in days (default: 1). Only InnoDB tables supported."),
      backupTime: z.string().optional().describe("Backup time in HH:mm format (e.g. '02:00'). Required when isBackup=true and isAutomaticBackup=false."),
      isAutomaticBackup: z.boolean().optional().describe("Automatic backup time scheduling (default: true). If true, backupTime cannot be specified."),
      cloudMysqlPort: z.number().optional().describe("MySQL TCP port (default: 3306, range: 10000-20000). Cannot change after creation."),
      engineVersionCode: z.string().optional().describe("DB engine version code (getCloudMysqlImageProductList). Defaults to latest version."),
      isPrivateSubDomain: z.boolean().optional().describe("Use private sub-domain (true/false)"),
      privateSubDomainPrefix: z.string().optional().describe("Private sub-domain prefix (3-15 chars). Required when isPrivateSubDomain=true."),
      isDeleteProtection: z.boolean().optional().describe("Cluster deletion protection (default: false). If true, cluster cannot be deleted."),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the instance"),
    },
    async (params) => {
      const { dryRun, ...apiParams } = params;
      if (dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: MySQL Instance Creation",
          endpoint: "/vmysql/v2/createCloudMysqlInstance",
          requestParams: apiParams,
          noun: { ko: "MySQL 인스턴스", en: "MySQL instance" },
        });
      }

      const result = await client.request("/vmysql/v2/createCloudMysqlInstance", apiParams);
      const instance = result.cloudMysqlInstanceList?.[0];
      const summary = {
        리소스타입: "MySQL",
        리소스ID: instance?.cloudMysqlInstanceNo ?? "unknown",
        서비스명: params.cloudMysqlServiceName,
        상태: instance?.cloudMysqlInstanceStatus?.codeName ?? "creating",
        생성시각: instance?.createDate ?? new Date().toISOString(),
        VPC: params.vpcNo,
        서브넷: params.subnetNo,
        데이터베이스명: params.cloudMysqlDatabaseName,
        고가용성: instance?.isHa ?? params.isHa ?? true,
        멀티존: instance?.isMultiZone ?? params.isMultiZone ?? false,
      };
      return summary;
    }
  );

  defineTool(
    server,
    "ncloud_create_mysql_slave",
    "Create a slave (read replica) for a Cloud DB for MySQL instance",
    {
      cloudMysqlInstanceNo: z.string().describe("Cloud MySQL instance number to create slave for"),
      subnetNo: z.string().optional().describe("Subnet number for the slave instance. Required when isMultiZone=true. Ignored when isMultiZone=false."),
      regionCode: z.string().optional().describe("Region code (default: first region)"),
    },
    async (params) => {
      return client.request("/vmysql/v2/createCloudMysqlSlaveInstance", params);
    }
  );

  defineTool(
    server,
    "ncloud_add_mysql_databases",
    "Add databases to a Cloud DB for MySQL instance",
    {
      cloudMysqlInstanceNo: z.string().describe("Cloud MySQL instance number"),
      cloudMysqlDatabaseNameList: z.array(z.string()).min(1).describe("List of database names to add"),
    },
    async (params) => {
      return client.request("/vmysql/v2/addCloudMysqlDatabaseList", params);
    }
  );

  defineTool(
    server,
    "ncloud_add_mysql_users",
    "Add users to a Cloud DB for MySQL instance",
    {
      cloudMysqlInstanceNo: z.string().describe("Cloud MySQL instance number"),
      cloudMysqlUserList: z.array(z.object({
        name: z.string().describe("User name"),
        password: z.string().describe("User password"),
        hostIp: z.string().optional().describe("Host IP (default: %)"),
        authority: z.string().optional().describe("User authority (READ, DDL, CRUD)"),
      })).min(1).describe("List of users to add"),
    },
    async (params) => {
      const { cloudMysqlInstanceNo, cloudMysqlUserList } = params;
      const requestParams: any = { cloudMysqlInstanceNo };

      for (let i = 0; i < cloudMysqlUserList.length; i++) {
        const user = cloudMysqlUserList[i];
        requestParams[`cloudMysqlUserList.${i + 1}.name`] = user.name;
        requestParams[`cloudMysqlUserList.${i + 1}.password`] = user.password;
        if (user.hostIp) {
          requestParams[`cloudMysqlUserList.${i + 1}.hostIp`] = user.hostIp;
        }
        if (user.authority) {
          requestParams[`cloudMysqlUserList.${i + 1}.authority`] = user.authority;
        }
      }

      const result = await client.request("/vmysql/v2/addCloudMysqlUserList", requestParams);
      return result;
    }
  );

  // ─── Operation Tools ───────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_reboot_mysql_server",
    "Reboot a Cloud DB for MySQL server instance",
    {
      cloudMysqlServerInstanceNo: z.string().describe("Cloud MySQL server instance number to reboot"),
    },
    async (params) => {
      return client.request("/vmysql/v2/rebootCloudMysqlServerInstance", params);
    }
  );

  defineTool(
    server,
    "ncloud_change_mysql_spec",
    "Change the server spec (CPU/Memory) of a Cloud DB for MySQL instance",
    {
      cloudMysqlInstanceNo: z.string().describe("Cloud MySQL instance number (getCloudMysqlInstanceList)"),
      cloudMysqlProductCode: z.string().describe("New MySQL server product (spec) code (getCloudMysqlProductList)"),
      isRolling: z.boolean().optional().describe("Rolling upgrade (default: false). true: sequential upgrade with minimal downtime (G3 only). false: all servers stop simultaneously."),
      regionCode: z.string().optional().describe("Region code (default: first region)"),
    },
    async (params) => {
      // 이 API 만 래퍼 키가 "Response" 접미 없이 `changeCloudMysqlServerSpec` 이라 클라이언트가 벗기지 못한다
      //   (금융존 테스트 — 다른 도구와 응답 형식을 맞춘다).
      const result = await client.request("/vmysql/v2/changeCloudMysqlServerSpec", params);
      const keys = result && typeof result === "object" ? Object.keys(result) : [];
      return keys.length === 1 && keys[0] === "changeCloudMysqlServerSpec" ? result[keys[0]] : result;
    }
  );

  defineTool(
    server,
    "ncloud_create_mysql_recovery",
    "Create a Recovery server instance for a Cloud DB for MySQL instance. Restores from backup file or point-in-time.",
    {
      cloudMysqlInstanceNo: z.string().describe("Cloud MySQL instance number (getCloudMysqlInstanceList)"),
      cloudMysqlRecoveryServerName: z.string().describe("Recovery server name prefix (3-20 chars, starts with letter, ends with letter/number, allows '-')"),
      subnetNo: z.string().optional().describe("Subnet number for Recovery server. Required when isMultiZone=true. Ignored when isMultiZone=false."),
      fileName: z.string().optional().describe("Backup file name for restore (getCloudMysqlBackupDetailList). If specified, recoveryTime is ignored. One of fileName or recoveryTime is required."),
      recoveryTime: z.string().optional().describe("Point-in-time recovery (yyyy-MM-dd HH:mm). If specified, fileName is ignored. One of fileName or recoveryTime is required."),
      regionCode: z.string().optional().describe("Region code (default: first region)"),
    },
    async (params) => {
      return client.request("/vmysql/v2/createCloudMysqlRecoveryInstance", params);
    }
  );

  defineTool(
    server,
    "ncloud_change_mysql_users",
    "Change DB user information (authority, password, hostIp) for a Cloud DB for MySQL instance",
    {
      cloudMysqlInstanceNo: z.string().describe("Cloud MySQL instance number"),
      cloudMysqlUserList: z.array(z.object({
        name: z.string().describe("DB user name to modify"),
        hostIp: z.string().describe("Host IP for MySQL access (e.g. '%', '1.1.1.1', '1.1.1.%')"),
        authority: z.enum(["READ", "CRUD", "DDL"]).describe("User authority: READ (select only), CRUD (insert/select/update/delete), DDL (CRUD + create/drop/alter table)"),
        password: z.string().optional().describe("New password (8-20 chars, must include letter+number+special char). Optional — omit to keep current password."),
        isSystemTableAccess: z.boolean().optional().describe("System table access (default: true)"),
      })).min(1).describe("List of users to modify"),
      regionCode: z.string().optional().describe("Region code (default: first region)"),
    },
    async (params) => {
      const { cloudMysqlInstanceNo, cloudMysqlUserList, regionCode } = params;
      const requestParams: any = { cloudMysqlInstanceNo };
      if (regionCode) requestParams.regionCode = regionCode;

      for (let i = 0; i < cloudMysqlUserList.length; i++) {
        const user = cloudMysqlUserList[i];
        requestParams[`cloudMysqlUserList.${i + 1}.name`] = user.name;
        requestParams[`cloudMysqlUserList.${i + 1}.hostIp`] = user.hostIp;
        requestParams[`cloudMysqlUserList.${i + 1}.authority`] = user.authority;
        if (user.password) {
          requestParams[`cloudMysqlUserList.${i + 1}.password`] = user.password;
        }
        if (user.isSystemTableAccess !== undefined) {
          requestParams[`cloudMysqlUserList.${i + 1}.isSystemTableAccess`] = user.isSystemTableAccess;
        }
      }

      const result = await client.request("/vmysql/v2/changeCloudMysqlUserList", requestParams);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_upgrade_mysql_version",
    "Upgrade the DB engine version of a Cloud DB for MySQL instance",
    {
      cloudMysqlInstanceNo: z.string().describe("Cloud MySQL instance number (getCloudMysqlInstanceList)"),
      cloudMysqlImageProductCode: z.string().describe("Target MySQL image product code (getCloudMysqlImageProductList)"),
      engineVersionCode: z.string().optional().describe("Target engine version code (e.g. 'MYSQL8.0.40'). Defaults to latest version if omitted."),
      isMajorVersionUpgrade: z.boolean().optional().describe("Major version upgrade (default: false). true: major upgrade (one step at a time, e.g. 5.7→8.0→8.4). false: minor upgrade only (e.g. 8.0.34→8.0.40)."),
      regionCode: z.string().optional().describe("Region code (default: first region)"),
    },
    async (params) => {
      return client.request("/vmysql/v2/upgradeCloudMysqlDbEngineVersion", params);
    }
  );

  // ─── Destructive Tools (with confirm gate) ─────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_mysql_server",
    "⚠️ Destructive: Delete a Slave or Recovery server instance from a Cloud DB for MySQL cluster. Master/Standby cannot be deleted. Set confirm=true to execute.",
    {
      cloudMysqlServerInstanceNo: z.string().describe("Cloud MySQL server instance number to delete (Slave or Recovery only)"),
      regionCode: z.string().optional().describe("Region code (default: first region)"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vmysql/v2/deleteCloudMysqlServerInstance", apiParams);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete MySQL server instance [${params.cloudMysqlServerInstanceNo}] (Slave/Recovery only). Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.` } }
  );

  defineTool(
    server,
    "ncloud_delete_mysql_instance",
    "⚠️ Destructive: Permanently delete a Cloud DB for MySQL instance. Set confirm=true to execute.",
    {
      cloudMysqlInstanceNo: z.string().describe("Cloud MySQL instance number to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vmysql/v2/deleteCloudMysqlInstance", apiParams);
      return result;
    },
    { destructive: { noun: "MySQL instance", describe: (params) => params.cloudMysqlInstanceNo } }
  );

  defineTool(
    server,
    "ncloud_delete_mysql_databases",
    "⚠️ Destructive: Delete databases from a Cloud DB for MySQL instance. Set confirm=true to execute.",
    {
      cloudMysqlInstanceNo: z.string().describe("Cloud MySQL instance number"),
      cloudMysqlDatabaseNameList: z.array(z.string()).min(1).describe("List of database names to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vmysql/v2/deleteCloudMysqlDatabaseList", apiParams);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete databases [${params.cloudMysqlDatabaseNameList.join(", ")}] from MySQL instance [${params.cloudMysqlInstanceNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.` } }
  );

  defineTool(
    server,
    "ncloud_delete_mysql_users",
    "⚠️ Destructive: Delete users from a Cloud DB for MySQL instance. Set confirm=true to execute.",
    {
      cloudMysqlInstanceNo: z.string().describe("Cloud MySQL instance number"),
      // 가이드 database-vmysql-deletecloudmysqluserlist: cloudMysqlUserList.N.name·hostIp 둘 다 Required(세 존 동일) —
      //   사용자는 name@hostIp 로 특정된다. 이전 스키마(cloudMysqlUserNameList)는 항상 900 이었다(금융존 테스트 E-11).
      //   '%' 는 URLSearchParams 가 %25 로 인코딩한다.
      cloudMysqlUserList: z.array(z.object({
        name: z.string().describe("DB user name"),
        hostIp: z.string().describe("Host IP of the user exactly as registered (e.g. '%', '10.0.0.%'; see ncloud_list_mysql_users)"),
      })).min(1).describe("Users to delete, each identified by name + hostIp"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, cloudMysqlInstanceNo, cloudMysqlUserList } = params;
      const requestParams: any = { cloudMysqlInstanceNo };
      cloudMysqlUserList.forEach((user, i) => {
        requestParams[`cloudMysqlUserList.${i + 1}.name`] = user.name;
        requestParams[`cloudMysqlUserList.${i + 1}.hostIp`] = user.hostIp;
      });
      const result = await client.request("/vmysql/v2/deleteCloudMysqlUserList", requestParams);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete users [${params.cloudMysqlUserList.map((u: { name: string; hostIp: string }) => `${u.name}@${u.hostIp}`).join(", ")}] from MySQL instance [${params.cloudMysqlInstanceNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Export Tools ──────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_export_mysql_backup",
    "Export a Cloud DB for MySQL backup file to Object Storage. Use ncloud_list_mysql_backup_details to get available file names.",
    {
      cloudMysqlInstanceNo: z.string().describe("Cloud MySQL instance number (getCloudMysqlInstanceList)"),
      fileName: z.string().describe("Backup file name to export (getCloudMysqlBackupDetailList)"),
      bucketName: z.string().describe("Object Storage bucket name to export to"),
      folderPath: z.string().optional().describe("Folder path within the bucket (e.g. 'mysql-backups/daily'). If omitted, exports to bucket root."),
      regionCode: z.string().optional().describe("Region code (default: first region)"),
    },
    async (params) => {
      return client.request("/vmysql/v2/exportBackupToObjectStorage", params);
    }
  );

  defineTool(
    server,
    "ncloud_export_mysql_log",
    "Export a Cloud DB for MySQL server log file to Object Storage. Use ncloud_list_mysql_logs to get available log files.",
    {
      cloudMysqlServerInstanceNo: z.string().describe("Cloud MySQL server instance number"),
      logType: z.enum(["BINARY", "ERROR", "SLOW", "GENERAL", "AUDIT"]).describe("Log type to export: BINARY (binlog), ERROR (error log), SLOW (slow query log), GENERAL (general log), AUDIT (audit log)"),
      fileName: z.string().describe("Log file name to export (getDbServerLogList)"),
      bucketName: z.string().describe("Object Storage bucket name to export to"),
      folderPath: z.string().optional().describe("Folder path within the bucket (e.g. 'mysql-logs/error'). If omitted, exports to bucket root."),
      regionCode: z.string().optional().describe("Region code (default: first region)"),
    },
    async (params) => {
      return client.request("/vmysql/v2/exportDbServerLogToObjectStorage", params);
    }
  );
}
