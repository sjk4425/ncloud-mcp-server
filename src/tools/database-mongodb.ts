import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";

export function registerDatabaseMongodbTools(server: McpServer, client: NcloudClient): void {
  // ─── Query Tools ───────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_mongodb_instances",
    "List all Cloud DB for MongoDB instances in the current region",
    {
      cloudMongoDbInstanceNoList: z.array(z.string()).optional().describe("Filter by MongoDB instance numbers"),
      cloudMongoDbServiceName: z.string().optional().describe("Filter by MongoDB service name"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      return client.request("/vmongodb/v2/getCloudMongoDbInstanceList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_mongodb_instance_detail",
    "Get detailed information about a specific Cloud DB for MongoDB instance",
    {
      cloudMongoDbInstanceNo: z.string().describe("Cloud MongoDB instance number to query"),
    },
    async (params) => {
      return client.request("/vmongodb/v2/getCloudMongoDbInstanceDetail", params);
    }
  );

  defineTool(
    server,
    "ncloud_list_mongodb_backups",
    "List backups for a Cloud DB for MongoDB instance",
    {
      cloudMongoDbInstanceNo: z.string().describe("Cloud MongoDB instance number"),
    },
    async (params) => {
      return client.request("/vmongodb/v2/getCloudMongoDbBackupList", params);
    }
  );

  // ─── Create Tools ──────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_create_mongodb_instance",
    "Create a new Cloud DB for MongoDB instance. Use dryRun=true to preview without creating.",
    {
      cloudMongoDbServiceName: z.string({
        required_error: "필수 파라미터 'cloudMongoDbServiceName'이 누락되었습니다.",
      }).describe("MongoDB service name (3-20 chars, lowercase letters and numbers)"),
      cloudMongoDbServerNamePrefix: z.string({
        required_error: "필수 파라미터 'cloudMongoDbServerNamePrefix'이 누락되었습니다.",
      }).describe("Server name prefix"),
      clusterTypeCode: z.string({
        required_error: "필수 파라미터 'clusterTypeCode'이 누락되었습니다.",
      }).describe("Cluster type code (STAND_ALONE | SINGLE_REPLICA_SET | SHARDED_CLUSTER)"),
      vpcNo: z.string({
        required_error: "필수 파라미터 'vpcNo'이 누락되었습니다.",
      }).describe("VPC number"),
      subnetNo: z.string({
        required_error: "필수 파라미터 'subnetNo'이 누락되었습니다.",
      }).describe("Subnet number"),
      cloudMongoDbUserName: z.string({
        required_error: "필수 파라미터 'cloudMongoDbUserName'이 누락되었습니다.",
      }).describe("Initial admin user name"),
      cloudMongoDbUserPassword: z.string({
        required_error: "필수 파라미터 'cloudMongoDbUserPassword'이 누락되었습니다.",
      }).describe("Initial admin user password"),
      cloudMongoDbImageProductCode: z.string().optional().describe("MongoDB image product code"),
      memberProductCode: z.string().optional().describe("Member server product code"),
      arbiterProductCode: z.string().optional().describe("Arbiter server product code"),
      mongosProductCode: z.string().optional().describe("Mongos server product code"),
      configProductCode: z.string().optional().describe("Config server product code"),
      dataStorageTypeCode: z.string().optional().describe("Data storage type (SSD | HDD | CB2)"),
      memberPort: z.number().optional().describe("Member port (default 17017, range 10000-65535)"),
      mongosPort: z.number().optional().describe("Mongos port (default 17017)"),
      configPort: z.number().optional().describe("Config port (default 17017)"),
      compressCode: z.string().optional().describe("Compression algorithm (SNPP | ZLIB | ZSTD | NONE)"),
      engineVersionCode: z.string().optional().describe("MongoDB engine version code"),
      shardCount: z.number().optional().describe("Number of shards (2-3, for SHARDED_CLUSTER)"),
      backupFileRetentionPeriod: z.number().optional().describe("Backup retention period in days (1-30)"),
      memberServerCount: z.number().optional().describe("Number of member servers in the replica set"),
      arbiterServerCount: z.number().optional().describe("Number of arbiter servers"),
      mongosServerCount: z.number().optional().describe("Number of mongos servers (for sharded cluster)"),
      configServerCount: z.number().optional().describe("Number of config servers (for sharded cluster)"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the instance"),
    },
    async (params) => {
      if (params.dryRun) {
        const preview = {
          label: "🔍 Dry-Run Preview: MongoDB Instance Creation",
          cloudMongoDbServiceName: params.cloudMongoDbServiceName,
          cloudMongoDbServerNamePrefix: params.cloudMongoDbServerNamePrefix,
          clusterTypeCode: params.clusterTypeCode,
          vpcNo: params.vpcNo,
          subnetNo: params.subnetNo,
          cloudMongoDbUserName: params.cloudMongoDbUserName,
          memberServerCount: params.memberServerCount,
          shardCount: params.shardCount,
          message: "이 요청은 실제 MongoDB 인스턴스를 생성하지 않습니다. dryRun=false로 호출하면 인스턴스가 생성됩니다.",
        };
        return preview;
      }

      const { dryRun, ...apiParams } = params;
      const result = await client.request("/vmongodb/v2/createCloudMongoDbInstance", apiParams);
      const instance = result.cloudMongoDbInstanceList?.[0];
      const summary = {
        리소스타입: "MongoDB",
        리소스ID: instance?.cloudMongoDbInstanceNo ?? "unknown",
        서비스명: params.cloudMongoDbServiceName,
        상태: instance?.cloudMongoDbInstanceStatus?.codeName ?? "creating",
        생성시각: instance?.createDate ?? new Date().toISOString(),
        VPC: params.vpcNo,
        서브넷: params.subnetNo,
        클러스터타입: params.clusterTypeCode,
      };
      return summary;
    }
  );

  // ─── Operation Tools ───────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_reboot_mongodb_server",
    "Reboot a Cloud DB for MongoDB server instance",
    {
      cloudMongoDbServerInstanceNo: z.string().describe("Cloud MongoDB server instance number to reboot"),
    },
    async (params) => {
      return client.request("/vmongodb/v2/rebootCloudMongoDbServerInstance", params);
    }
  );

  // ─── Cluster Scaling Tools ─────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_change_mongodb_secondary_count",
    "Change the number of Secondary (Member/Arbiter) servers in a MongoDB instance",
    {
      cloudMongoDbInstanceNo: z.string({
        required_error: "필수 파라미터 'cloudMongoDbInstanceNo'이 누락되었습니다.",
      }).describe("Cloud MongoDB instance number"),
      memberServerCount: z.number({
        required_error: "필수 파라미터 'memberServerCount'이 누락되었습니다.",
      }).describe("Number of member servers (2-7)"),
      arbiterServerCount: z.number({
        required_error: "필수 파라미터 'arbiterServerCount'이 누락되었습니다.",
      }).describe("Number of arbiter servers (0-1)"),
      arbiterProductCode: z.string().optional().describe("Arbiter server product code"),
    },
    async (params) => {
      return client.request("/vmongodb/v2/changeCloudMongoDbSecondaryCount", params);
    }
  );

  defineTool(
    server,
    "ncloud_change_mongodb_mongos_count",
    "Change the number of Mongos servers in a MongoDB Sharded Cluster instance",
    {
      cloudMongoDbInstanceNo: z.string({
        required_error: "필수 파라미터 'cloudMongoDbInstanceNo'이 누락되었습니다.",
      }).describe("Cloud MongoDB instance number"),
      mongosServerCount: z.number({
        required_error: "필수 파라미터 'mongosServerCount'이 누락되었습니다.",
      }).describe("Number of mongos servers (2-5)"),
    },
    async (params) => {
      return client.request("/vmongodb/v2/changeCloudMongoDbMongosCount", params);
    }
  );

  defineTool(
    server,
    "ncloud_change_mongodb_config_count",
    "Change the number of Config servers in a MongoDB Sharded Cluster instance",
    {
      cloudMongoDbInstanceNo: z.string({
        required_error: "필수 파라미터 'cloudMongoDbInstanceNo'이 누락되었습니다.",
      }).describe("Cloud MongoDB instance number"),
      configServerCount: z.number({
        required_error: "필수 파라미터 'configServerCount'이 누락되었습니다.",
      }).describe("Number of config servers"),
    },
    async (params) => {
      return client.request("/vmongodb/v2/changeCloudMongoDbConfigCount", params);
    }
  );

  defineTool(
    server,
    "ncloud_change_mongodb_shard_count",
    "Change the number of shards in a MongoDB Sharded Cluster instance",
    {
      cloudMongoDbInstanceNo: z.string({
        required_error: "필수 파라미터 'cloudMongoDbInstanceNo'이 누락되었습니다.",
      }).describe("Cloud MongoDB instance number"),
      shardCount: z.number({
        required_error: "필수 파라미터 'shardCount'이 누락되었습니다.",
      }).describe("Number of shards"),
    },
    async (params) => {
      return client.request("/vmongodb/v2/changeCloudMongoDbShardCount", params);
    }
  );

  // ─── User Management Tools ─────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_mongodb_users",
    "List users in a Cloud DB for MongoDB instance",
    {
      cloudMongoDbInstanceNo: z.string({
        required_error: "필수 파라미터 'cloudMongoDbInstanceNo'이 누락되었습니다.",
      }).describe("Cloud MongoDB instance number"),
    },
    async (params) => {
      return client.request("/vmongodb/v2/getCloudMongoDbUserList", params);
    }
  );

  defineTool(
    server,
    "ncloud_add_mongodb_users",
    "Add users to a Cloud DB for MongoDB instance",
    {
      cloudMongoDbInstanceNo: z.string({
        required_error: "필수 파라미터 'cloudMongoDbInstanceNo'이 누락되었습니다.",
      }).describe("Cloud MongoDB instance number"),
      cloudMongoDbUserList: z.array(z.object({
        name: z.string().describe("User name"),
        password: z.string().describe("User password"),
        databaseName: z.string().describe("Database name the user belongs to"),
        authority: z.string().describe("User authority (e.g., READ, READ_WRITE, DB_ADMIN)"),
      })).describe("List of users to add"),
    },
    async (params) => {
      const { cloudMongoDbInstanceNo, cloudMongoDbUserList } = params;
      const requestParams: any = { cloudMongoDbInstanceNo };

      for (let i = 0; i < cloudMongoDbUserList.length; i++) {
        const user = cloudMongoDbUserList[i];
        requestParams[`cloudMongoDbUserList.${i + 1}.name`] = user.name;
        requestParams[`cloudMongoDbUserList.${i + 1}.password`] = user.password;
        requestParams[`cloudMongoDbUserList.${i + 1}.databaseName`] = user.databaseName;
        requestParams[`cloudMongoDbUserList.${i + 1}.authority`] = user.authority;
      }

      const result = await client.request("/vmongodb/v2/addCloudMongoDbUserList", requestParams);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_change_mongodb_users",
    "Change user information (password) in a Cloud DB for MongoDB instance",
    {
      cloudMongoDbInstanceNo: z.string({
        required_error: "필수 파라미터 'cloudMongoDbInstanceNo'이 누락되었습니다.",
      }).describe("Cloud MongoDB instance number"),
      cloudMongoDbUserList: z.array(z.object({
        name: z.string().describe("User name"),
        password: z.string().describe("New password"),
      })).describe("List of users to change"),
    },
    async (params) => {
      const { cloudMongoDbInstanceNo, cloudMongoDbUserList } = params;
      const requestParams: any = { cloudMongoDbInstanceNo };

      for (let i = 0; i < cloudMongoDbUserList.length; i++) {
        const user = cloudMongoDbUserList[i];
        requestParams[`cloudMongoDbUserList.${i + 1}.name`] = user.name;
        requestParams[`cloudMongoDbUserList.${i + 1}.password`] = user.password;
      }

      const result = await client.request("/vmongodb/v2/changeCloudMongoDbUserList", requestParams);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_delete_mongodb_users",
    "⚠️ Destructive: Delete users from a Cloud DB for MongoDB instance. Set confirm=true to execute.",
    {
      cloudMongoDbInstanceNo: z.string({
        required_error: "필수 파라미터 'cloudMongoDbInstanceNo'이 누락되었습니다.",
      }).describe("Cloud MongoDB instance number"),
      cloudMongoDbUserList: z.array(z.object({
        name: z.string().describe("User name to delete"),
      })).describe("List of users to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, cloudMongoDbInstanceNo, cloudMongoDbUserList } = params;
      const requestParams: any = { cloudMongoDbInstanceNo };

      for (let i = 0; i < cloudMongoDbUserList.length; i++) {
        const user = cloudMongoDbUserList[i];
        requestParams[`cloudMongoDbUserList.${i + 1}.name`] = user.name;
      }

      const result = await client.request("/vmongodb/v2/deleteCloudMongoDbUserList", requestParams);
      return result;
    },
    {
      destructive: {
        message: (params) => {
          const userNames = params.cloudMongoDbUserList.map((u: any) => u.name).join(", ");
          return `⚠️ This will permanently delete MongoDB users [${userNames}] from instance [${params.cloudMongoDbInstanceNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
        },
      },
    }
  );

  // ─── Backup & Log Tools ────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_mongodb_backup_details",
    "List detailed backup information for a Cloud DB for MongoDB instance",
    {
      cloudMongoDbInstanceNo: z.string({
        required_error: "필수 파라미터 'cloudMongoDbInstanceNo'이 누락되었습니다.",
      }).describe("Cloud MongoDB instance number"),
    },
    async (params) => {
      return client.request("/vmongodb/v2/getCloudMongoDbBackupDetailList", params);
    }
  );

  defineTool(
    server,
    "ncloud_list_mongodb_logs",
    "List server logs for a Cloud DB for MongoDB server instance",
    {
      cloudMongoDbServerInstanceNo: z.string({
        required_error: "필수 파라미터 'cloudMongoDbServerInstanceNo'이 누락되었습니다.",
      }).describe("Cloud MongoDB server instance number"),
    },
    async (params) => {
      return client.request("/vmongodb/v2/getDbServerLogList", params);
    }
  );

  defineTool(
    server,
    "ncloud_export_mongodb_backup",
    "Export MongoDB backup files to Object Storage",
    {
      cloudMongoDbInstanceNo: z.string({
        required_error: "필수 파라미터 'cloudMongoDbInstanceNo'이 누락되었습니다.",
      }).describe("Cloud MongoDB instance number"),
      cloudMongoDbServerInstanceNo: z.string({
        required_error: "필수 파라미터 'cloudMongoDbServerInstanceNo'이 누락되었습니다.",
      }).describe("Cloud MongoDB server instance number"),
      bucketName: z.string({
        required_error: "필수 파라미터 'bucketName'이 누락되었습니다.",
      }).describe("Object Storage bucket name"),
      folderPath: z.string().optional().describe("Folder path in the bucket"),
      cloudMongoDbExportObjectList: z.array(z.object({
        fullObjectName: z.string().describe("Full object name of the backup file to export"),
      })).describe("List of backup objects to export"),
    },
    async (params) => {
      const { cloudMongoDbInstanceNo, cloudMongoDbServerInstanceNo, bucketName, folderPath, cloudMongoDbExportObjectList } = params;
      const requestParams: any = { cloudMongoDbInstanceNo, cloudMongoDbServerInstanceNo, bucketName };
      if (folderPath) requestParams.folderPath = folderPath;

      for (let i = 0; i < cloudMongoDbExportObjectList.length; i++) {
        requestParams[`cloudMongoDbExportObjectList.${i + 1}.fullObjectName`] = cloudMongoDbExportObjectList[i].fullObjectName;
      }

      const result = await client.request("/vmongodb/v2/exportBackupToObjectStorage", requestParams);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_export_mongodb_log",
    "Export MongoDB server logs to Object Storage",
    {
      cloudMongoDbInstanceNo: z.string({
        required_error: "필수 파라미터 'cloudMongoDbInstanceNo'이 누락되었습니다.",
      }).describe("Cloud MongoDB instance number"),
      cloudMongoDbServerInstanceNo: z.string({
        required_error: "필수 파라미터 'cloudMongoDbServerInstanceNo'이 누락되었습니다.",
      }).describe("Cloud MongoDB server instance number"),
      bucketName: z.string({
        required_error: "필수 파라미터 'bucketName'이 누락되었습니다.",
      }).describe("Object Storage bucket name"),
      folderPath: z.string().optional().describe("Folder path in the bucket"),
      cloudMongoDbExportObjectList: z.array(z.object({
        fullObjectName: z.string().describe("Full object name of the log file to export"),
      })).describe("List of log objects to export"),
    },
    async (params) => {
      const { cloudMongoDbInstanceNo, cloudMongoDbServerInstanceNo, bucketName, folderPath, cloudMongoDbExportObjectList } = params;
      const requestParams: any = { cloudMongoDbInstanceNo, cloudMongoDbServerInstanceNo, bucketName };
      if (folderPath) requestParams.folderPath = folderPath;

      for (let i = 0; i < cloudMongoDbExportObjectList.length; i++) {
        requestParams[`cloudMongoDbExportObjectList.${i + 1}.fullObjectName`] = cloudMongoDbExportObjectList[i].fullObjectName;
      }

      const result = await client.request("/vmongodb/v2/exportDbServerLogToObjectStorage", requestParams);
      return result;
    }
  );

  // ─── Product & Reference Tools ─────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_get_mongodb_image_products",
    "List available MongoDB image product codes",
    {
      regionCode: z.string().optional().describe("Region code (e.g., KR, JPN, SGN)"),
    },
    async (params) => {
      return client.request("/vmongodb/v2/getCloudMongoDbImageProductList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_mongodb_products",
    "List available MongoDB server spec product codes (filterable by role type)",
    {
      cloudMongoDbImageProductCode: z.string({
        required_error: "필수 파라미터 'cloudMongoDbImageProductCode'이 누락되었습니다.",
      }).describe("MongoDB image product code"),
      infraResourceDetailTypeCode: z.string().optional().describe("Filter by server role type (MNGOD | ARBIT | CFGSV | MNGOS)"),
    },
    async (params) => {
      return client.request("/vmongodb/v2/getCloudMongoDbProductList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_mongodb_target_vpcs",
    "List VPCs available for Cloud DB for MongoDB",
    {
      regionCode: z.string().optional().describe("Region code (e.g., KR, JPN, SGN)"),
    },
    async (params) => {
      return client.request("/vmongodb/v2/getCloudMongoDbTargetVpcList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_mongodb_target_subnets",
    "List subnets available for Cloud DB for MongoDB",
    {
      cloudMongoDbInstanceNo: z.string({
        required_error: "필수 파라미터 'cloudMongoDbInstanceNo'이 누락되었습니다.",
      }).describe("Cloud MongoDB instance number"),
      regionCode: z.string().optional().describe("Region code (e.g., KR, JPN, SGN)"),
    },
    async (params) => {
      return client.request("/vmongodb/v2/getCloudMongoDbTargetSubnetList", params);
    }
  );

  defineTool(
    server,
    "ncloud_list_mongodb_buckets",
    "List Object Storage buckets available for Cloud DB for MongoDB backup export",
    {
      regionCode: z.string().optional().describe("Region code (e.g., KR, JPN, SGN)"),
    },
    async (params) => {
      return client.request("/vmongodb/v2/getCloudMongoDbBucketList", params);
    }
  );

  // ─── Destructive Tools (with confirm gate) ─────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_mongodb_instance",
    "⚠️ Destructive: Permanently delete a Cloud DB for MongoDB instance. Set confirm=true to execute.",
    {
      cloudMongoDbInstanceNo: z.string().describe("Cloud MongoDB instance number to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vmongodb/v2/deleteCloudMongoDbInstance", apiParams);
      return result;
    },
    { destructive: { noun: "MongoDB instance", describe: (params) => params.cloudMongoDbInstanceNo } }
  );
}
