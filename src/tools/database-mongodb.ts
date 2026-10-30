import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient, type NcloudApiParams } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { L, requiredError } from "./_messages.js";
import { dryRunPreview } from "./_dryrun.js";

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
    "Create a new Cloud DB for MongoDB instance. Backups are always on (only the retention period and time can be set). " +
      "Use dryRun=true to preview without creating.",
    {
      cloudMongoDbServiceName: z.string({
        required_error: requiredError("cloudMongoDbServiceName"),
      }).describe("MongoDB service name (3-15 chars: lowercase letters, numbers, hyphen). Unique; becomes the replica set name"),
      cloudMongoDbServerNamePrefix: z.string({
        required_error: requiredError("cloudMongoDbServerNamePrefix"),
      }).describe("Server name prefix (3-15 chars: lowercase letters, numbers, hyphen; starts with a letter). A random suffix is appended"),
      clusterTypeCode: z.string({
        required_error: requiredError("clusterTypeCode"),
      }).describe("Cluster type code (STAND_ALONE | SINGLE_REPLICA_SET | SHARDED_CLUSTER)"),
      vpcNo: z.string({
        required_error: requiredError("vpcNo"),
      }).describe("VPC number"),
      subnetNo: z.string({
        required_error: requiredError("subnetNo"),
      }).describe("Subnet number"),
      cloudMongoDbUserName: z.string({
        required_error: requiredError("cloudMongoDbUserName"),
      }).describe("Initial admin user name"),
      cloudMongoDbUserPassword: z.string({
        required_error: requiredError("cloudMongoDbUserPassword"),
      }).describe("Initial admin user password"),
      cloudMongoDbImageProductCode: z.string().optional().describe("MongoDB image product code"),
      memberProductCode: z.string().optional().describe("Member server product code"),
      arbiterProductCode: z.string().optional().describe("Arbiter server product code"),
      mongosProductCode: z.string().optional().describe("Mongos server product code"),
      configProductCode: z.string().optional().describe("Config server product code"),
      dataStorageTypeCode: z.string().optional().describe("Data storage type: SSD | HDD (G2 images, default SSD); CB2 for G3 images (public zone only). Available types depend on the zone — check ncloud_get_mongodb_products"),
      memberPort: z.number().optional().describe("Member port (default 17017, range 10000-65535)"),
      mongosPort: z.number().optional().describe("Mongos port (default 17017)"),
      configPort: z.number().optional().describe("Config port (default 17017)"),
      compressCode: z.string().optional().describe("Compression algorithm (SNPP | ZLIB | ZSTD | NONE)"),
      engineVersionCode: z.string().optional().describe("MongoDB engine version code. Several versions share one image product code, so set this to pick a version (latest if omitted)"),
      shardCount: z.number().optional().describe("Number of shards (2-3, default 2; SHARDED_CLUSTER only)"),
      backupFileRetentionPeriod: z.number().optional().describe("Backup retention period in days (1-30, default 1)"),
      backupTime: z.string().optional().describe("Backup start time HH:mm in 15-minute steps (default 02:00)"),
      memberServerCount: z.number().optional().describe("Number of member servers in the replica set"),
      arbiterServerCount: z.number().optional().describe("Number of arbiter servers"),
      mongosServerCount: z.number().optional().describe("Number of mongos servers (for sharded cluster)"),
      configServerCount: z.number().optional().describe("Number of config servers (for sharded cluster)"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the instance"),
    },
    async (params) => {
      const { dryRun, ...apiParams } = params;
      if (dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: MongoDB Instance Creation",
          endpoint: "/vmongodb/v2/createCloudMongoDbInstance",
          requestParams: apiParams,
          noun: { ko: "MongoDB 인스턴스", en: "MongoDB instance" },
        });
      }

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
  // 서버 수를 늘리면 곧바로 과금 서버가 추가된다 — 다른 생성 도구처럼 dryRun 으로 요청을 미리 본다(금융존 테스트 S-04).

  const SCALE_DRY_RUN = z.boolean().optional().default(false)
    .describe("If true, returns a preview without changing anything. Adding servers adds billed servers immediately.");

  const scale = async (endpoint: string, params: { dryRun?: boolean } & NcloudApiParams) => {
    const { dryRun, ...apiParams } = params;
    if (dryRun) {
      return dryRunPreview({
        label: "🔍 Dry-Run Preview: MongoDB Server Count Change",
        endpoint,
        requestParams: apiParams,
        noun: { ko: "MongoDB 서버 수 변경", en: "MongoDB server count change" },
        verb: "apply",
        notes: {
          note_current: L({
            ko: "현재 서버 수는 ncloud_get_mongodb_instance_detail 로 확인하세요. 늘어난 서버는 바로 과금됩니다.",
            en: "Check the current server counts with ncloud_get_mongodb_instance_detail. Added servers are billed immediately.",
          }),
        },
      });
    }
    return client.request(endpoint, apiParams);
  };

  defineTool(
    server,
    "ncloud_change_mongodb_secondary_count",
    "Change the number of Secondary (Member/Arbiter) servers in a MongoDB replica set (members + arbiter = 3-7). Use dryRun=true to preview",
    {
      cloudMongoDbInstanceNo: z.string({
        required_error: requiredError("cloudMongoDbInstanceNo"),
      }).describe("Cloud MongoDB instance number"),
      memberServerCount: z.number({
        required_error: requiredError("memberServerCount"),
      }).describe("Number of member servers (2-7)"),
      arbiterServerCount: z.number({
        required_error: requiredError("arbiterServerCount"),
      }).describe("Number of arbiter servers (0-1)"),
      arbiterProductCode: z.string().optional().describe("Arbiter server product code"),
      dryRun: SCALE_DRY_RUN,
    },
    async (params) => scale("/vmongodb/v2/changeCloudMongoDbSecondaryCount", params)
  );

  defineTool(
    server,
    "ncloud_change_mongodb_mongos_count",
    "Change the number of Mongos servers in a MongoDB instance (SHARDED_CLUSTER only). Use dryRun=true to preview",
    {
      cloudMongoDbInstanceNo: z.string({
        required_error: requiredError("cloudMongoDbInstanceNo"),
      }).describe("Cloud MongoDB instance number"),
      mongosServerCount: z.number({
        required_error: requiredError("mongosServerCount"),
      }).describe("Number of mongos servers (2-5)"),
      dryRun: SCALE_DRY_RUN,
    },
    async (params) => scale("/vmongodb/v2/changeCloudMongoDbMongosCount", params)
  );

  defineTool(
    server,
    "ncloud_change_mongodb_config_count",
    "Change the number of Config servers in a MongoDB instance (SHARDED_CLUSTER only). Use dryRun=true to preview",
    {
      cloudMongoDbInstanceNo: z.string({
        required_error: requiredError("cloudMongoDbInstanceNo"),
      }).describe("Cloud MongoDB instance number"),
      configServerCount: z.number({
        required_error: requiredError("configServerCount"),
      }).describe("Number of config servers (3-7)"),
      dryRun: SCALE_DRY_RUN,
    },
    async (params) => scale("/vmongodb/v2/changeCloudMongoDbConfigCount", params)
  );

  defineTool(
    server,
    "ncloud_change_mongodb_shard_count",
    "Add shards to a MongoDB instance (SHARDED_CLUSTER only). Use dryRun=true to preview",
    {
      cloudMongoDbInstanceNo: z.string({
        required_error: requiredError("cloudMongoDbInstanceNo"),
      }).describe("Cloud MongoDB instance number"),
      shardCount: z.number({
        required_error: requiredError("shardCount"),
      }).describe("Number of shards (3-5). Shards can only be added, not removed"),
      dryRun: SCALE_DRY_RUN,
    },
    async (params) => scale("/vmongodb/v2/changeCloudMongoDbShardCount", params)
  );

  // ─── User Management Tools ─────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_mongodb_users",
    "List users in a Cloud DB for MongoDB instance",
    {
      cloudMongoDbInstanceNo: z.string({
        required_error: requiredError("cloudMongoDbInstanceNo"),
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
        required_error: requiredError("cloudMongoDbInstanceNo"),
      }).describe("Cloud MongoDB instance number"),
      // 사용자 이름 키는 userName(금융존 테스트 E-16 — `.name` 으로 보내 900 location: cloudMongoDbUserList.N.userName).
      cloudMongoDbUserList: z.array(z.object({
        userName: z.string().describe("User name"),
        password: z.string().describe("User password"),
        databaseName: z.string().describe("Database name the user belongs to"),
        authority: z.enum(["READ", "READ_WRITE"]).describe("User authority: READ | READ_WRITE"),
      })).min(1).max(10).describe("List of users to add (1-10)"),
    },
    async (params) => {
      const { cloudMongoDbInstanceNo, cloudMongoDbUserList } = params;
      const requestParams: any = { cloudMongoDbInstanceNo };

      for (let i = 0; i < cloudMongoDbUserList.length; i++) {
        const user = cloudMongoDbUserList[i];
        requestParams[`cloudMongoDbUserList.${i + 1}.userName`] = user.userName;
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
    "Change users (password and authority) in a Cloud DB for MongoDB instance",
    {
      cloudMongoDbInstanceNo: z.string({
        required_error: requiredError("cloudMongoDbInstanceNo"),
      }).describe("Cloud MongoDB instance number"),
      // add 와 같은 구조(금융존 테스트 E-16 — userName·databaseName·authority 를 보내야 하고, authority 도 바꿀 수 있다).
      cloudMongoDbUserList: z.array(z.object({
        userName: z.string().describe("User name"),
        password: z.string().optional().describe("New password (omit to keep)"),
        databaseName: z.string().describe("Database name the user belongs to"),
        authority: z.enum(["READ", "READ_WRITE"]).optional().describe("New authority: READ | READ_WRITE (omit to keep)"),
      })).min(1).max(10).describe("List of users to change (1-10)"),
    },
    async (params) => {
      const { cloudMongoDbInstanceNo, cloudMongoDbUserList } = params;
      const requestParams: any = { cloudMongoDbInstanceNo };

      for (let i = 0; i < cloudMongoDbUserList.length; i++) {
        const user = cloudMongoDbUserList[i];
        requestParams[`cloudMongoDbUserList.${i + 1}.userName`] = user.userName;
        requestParams[`cloudMongoDbUserList.${i + 1}.databaseName`] = user.databaseName;
        if (user.password !== undefined) requestParams[`cloudMongoDbUserList.${i + 1}.password`] = user.password;
        if (user.authority !== undefined) requestParams[`cloudMongoDbUserList.${i + 1}.authority`] = user.authority;
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
        required_error: requiredError("cloudMongoDbInstanceNo"),
      }).describe("Cloud MongoDB instance number"),
      // 가이드 database-vmongodb-deletecloudmongodbuserlist: cloudMongoDbUserList.N.userName·databaseName Required(세 존 동일),
      //   최대 10명. 이전에는 `.name` 만 보내 항상 실패했다.
      cloudMongoDbUserList: z.array(z.object({
        userName: z.string().describe("User name to delete"),
        databaseName: z.string().describe("Authentication database of the user (see ncloud_list_mongodb_users)"),
      })).min(1).max(10).describe("Users to delete (1-10), each identified by userName + databaseName"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, cloudMongoDbInstanceNo, cloudMongoDbUserList } = params;
      const requestParams: any = { cloudMongoDbInstanceNo };

      for (let i = 0; i < cloudMongoDbUserList.length; i++) {
        const user = cloudMongoDbUserList[i];
        requestParams[`cloudMongoDbUserList.${i + 1}.userName`] = user.userName;
        requestParams[`cloudMongoDbUserList.${i + 1}.databaseName`] = user.databaseName;
      }

      const result = await client.request("/vmongodb/v2/deleteCloudMongoDbUserList", requestParams);
      return result;
    },
    {
      destructive: {
        message: (params) => {
          const userNames = params.cloudMongoDbUserList.map((u: any) => `${u.userName}@${u.databaseName}`).join(", ");
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
        required_error: requiredError("cloudMongoDbInstanceNo"),
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
        required_error: requiredError("cloudMongoDbServerInstanceNo"),
      }).describe("Cloud MongoDB server instance number"),
      // 가이드 database-vmongodb-getdbserverloglist: logType Required(세 존 동일).
      logType: z.enum(["log", "audit"]).default("log").describe("Log type: log (server log, default) or audit"),
      pageNo: z.number().int().min(0).optional().describe("Page number (pageSize is required when set)"),
      pageSize: z.number().int().min(1).max(1000).optional().describe("Page size, 1-1000"),
    },
    async (params) => {
      return client.request("/vmongodb/v2/getDbServerLogList", params);
    }
  );

  // 가이드 database-vmongodb-exportbackuptoobjectstorage / exportdbserverlogtoobjectstorage:
  //   백업은 cloudMongoDbInstanceNo + objectName + bucketName, 로그는 cloudMongoDbServerInstanceNo + logType + fileName
  //   + bucketName 이다. folderPath·목록형(cloudMongoDbExportObjectList) 파라미터는 없다 — 예전 스키마는 MSSQL 형식을
  //   그대로 옮겨 와 필수값이 빠져 있었다(금융존 문서 대조).
  defineTool(
    server,
    "ncloud_export_mongodb_backup",
    "Export a Cloud DB for MongoDB backup file to Object Storage. Get objectName from ncloud_list_mongodb_backup_details " +
      "and bucketName from ncloud_list_mongodb_buckets.",
    {
      cloudMongoDbInstanceNo: z.string({
        required_error: requiredError("cloudMongoDbInstanceNo"),
      }).describe("Cloud MongoDB instance number"),
      objectName: z.string({
        required_error: requiredError("objectName"),
      }).describe("Backup file object name (from ncloud_list_mongodb_backup_details)"),
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Object Storage bucket name (from ncloud_list_mongodb_buckets)"),
    },
    async (params) => {
      return client.request("/vmongodb/v2/exportBackupToObjectStorage", params);
    }
  );

  defineTool(
    server,
    "ncloud_export_mongodb_log",
    "Export a Cloud DB for MongoDB server log file to Object Storage. Get fileName from ncloud_list_mongodb_logs " +
      "(same logType) and bucketName from ncloud_list_mongodb_buckets.",
    {
      cloudMongoDbServerInstanceNo: z.string({
        required_error: requiredError("cloudMongoDbServerInstanceNo"),
      }).describe("Cloud MongoDB server instance number"),
      logType: z.enum(["log", "audit"]).default("log").describe("Log type: log (server log, default) or audit"),
      fileName: z.string({
        required_error: requiredError("fileName"),
      }).describe("Log file name (from ncloud_list_mongodb_logs)"),
      bucketName: z.string({
        required_error: requiredError("bucketName"),
      }).describe("Object Storage bucket name (from ncloud_list_mongodb_buckets)"),
    },
    async (params) => {
      return client.request("/vmongodb/v2/exportDbServerLogToObjectStorage", params);
    }
  );

  // ─── Product & Reference Tools ─────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_get_mongodb_image_products",
    "List available MongoDB image product codes",
    {
      regionCode: z.string().optional().describe("Region code (see ncloud_get_regions)"),
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
        required_error: requiredError("cloudMongoDbImageProductCode"),
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
      regionCode: z.string().optional().describe("Region code (see ncloud_get_regions)"),
    },
    async (params) => {
      return client.request("/vmongodb/v2/getCloudMongoDbTargetVpcList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_mongodb_target_subnets",
    "List subnets in a VPC that can host a new Cloud DB for MongoDB instance of the given image",
    {
      // 가이드 database-vmongodb-getcloudmongodbtargetsubnetlist: vpcNo·cloudMongoDbImageProductCode Required(세 존 동일).
      vpcNo: z.string({ required_error: requiredError("vpcNo") }).describe("VPC number"),
      cloudMongoDbImageProductCode: z.string({ required_error: requiredError("cloudMongoDbImageProductCode") }).describe("MongoDB image product code"),
      isPublic: z.boolean().optional().describe("true = public subnets only (API default), false = private subnets only"),
      regionCode: z.string().optional().describe("Region code (see ncloud_get_regions)"),
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
      // 세 존 가이드(database-vmongodb-getcloudmongodbbucketlist)는 Optional 이지만, 실제 API 는 이 값 없이
      // 400 / 900 "Required field is not specified" 로 거절한다 — 금융존(E-15)·민간존(2026-10-30) 실호출 확인. 공공존은 미확인.
      cloudMongoDbInstanceNo: z.string({
        required_error: requiredError("cloudMongoDbInstanceNo"),
      }).describe("Cloud MongoDB instance number the export will run from (required by the API, although the guide marks it optional)"),
      regionCode: z.string().optional().describe("Region code (see ncloud_get_regions)"),
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
