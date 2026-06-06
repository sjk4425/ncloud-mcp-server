import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { toolText } from "./_response.js";

export function registerDatabaseCacheTools(server: McpServer, client: NcloudClient): void {
  // ─── Query Tools ───────────────────────────────────────────────────────────

  server.tool(
    "ncloud_list_cache_instances",
    "List all Cloud DB for Cache (Redis/Valkey) instances in the current region",
    {
      cloudCacheInstanceNoList: z.array(z.string()).optional().describe("Filter by Cache instance numbers"),
      cloudCacheServiceName: z.string().optional().describe("Filter by Cache service name"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      try {
        const result = await client.request("/vcache/v2/getCloudCacheInstanceList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_get_cache_instance_detail",
    "Get detailed information about a specific Cloud DB for Cache (Redis/Valkey) instance",
    {
      cloudCacheInstanceNo: z.string().describe("Cloud Cache instance number to query"),
    },
    async (params) => {
      try {
        const result = await client.request("/vcache/v2/getCloudCacheInstanceDetail", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_list_cache_backups",
    "List backups for a Cloud DB for Cache (Redis/Valkey) instance",
    {
      cloudCacheInstanceNo: z.string().describe("Cloud Cache instance number"),
    },
    async (params) => {
      try {
        const result = await client.request("/vcache/v2/getCloudCacheBackupList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Config Group Tools ────────────────────────────────────────────────────

  server.tool(
    "ncloud_list_cache_config_groups",
    "List all Cloud Cache config groups",
    {
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      try {
        const result = await client.request("/vcache/v2/getCloudCacheConfigGroupList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_create_cache_config_group",
    "Create a new Cloud Cache config group. Use dryRun=true to preview without creating.",
    {
      cloudCacheConfigGroupName: z.string({
        required_error: "필수 파라미터 'cloudCacheConfigGroupName'이 누락되었습니다.",
      }).describe("Config group name"),
      cloudCacheImageProductCode: z.string({
        required_error: "필수 파라미터 'cloudCacheImageProductCode'이 누락되었습니다.",
      }).describe("Cache image product code for the config group"),
      description: z.string().optional().describe("Config group description"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the config group"),
    },
    async (params) => {
      try {
        if (params.dryRun) {
          const preview = {
            label: "🔍 Dry-Run Preview: Cache Config Group Creation",
            cloudCacheConfigGroupName: params.cloudCacheConfigGroupName,
            cloudCacheImageProductCode: params.cloudCacheImageProductCode,
            description: params.description,
            message: "이 요청은 실제 Config Group을 생성하지 않습니다. dryRun=false로 호출하면 Config Group이 생성됩니다.",
          };
          return toolText(preview);
        }

        const { dryRun, ...apiParams } = params;
        const result = await client.request("/vcache/v2/createCloudCacheConfigGroup", apiParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_delete_cache_config_group",
    "⚠️ Destructive: Permanently delete a Cloud Cache config group. Set confirm=true to execute.",
    {
      cloudCacheConfigGroupNo: z.string().describe("Cloud Cache config group number to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete Cache config group [${params.cloudCacheConfigGroupNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const { confirm, ...apiParams } = params;
        const result = await client.request("/vcache/v2/deleteCloudCacheConfigGroup", apiParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Create Tools ──────────────────────────────────────────────────────────

  server.tool(
    "ncloud_create_cache_instance",
    "Create a new Cloud DB for Cache (Redis/Valkey) instance. Use dryRun=true to preview without creating.",
    {
      cloudCacheServiceName: z.string({
        required_error: "필수 파라미터 'cloudCacheServiceName'이 누락되었습니다.",
      }).describe("Cache service name (3-20 chars, lowercase letters and numbers)"),
      vpcNo: z.string({
        required_error: "필수 파라미터 'vpcNo'이 누락되었습니다.",
      }).describe("VPC number"),
      subnetNo: z.string({
        required_error: "필수 파라미터 'subnetNo'이 누락되었습니다.",
      }).describe("Subnet number"),
      cloudCacheImageProductCode: z.string().optional().describe("Cache image product code (Redis/Valkey version)"),
      cloudCacheProductCode: z.string().optional().describe("Cache server product (spec) code"),
      cloudCacheConfigGroupNo: z.string().optional().describe("Config group number to apply"),
      cloudCacheServerNamePrefix: z.string().optional().describe("Server name prefix"),
      cloudCachePort: z.number().optional().describe("Cache port number (default: 6379)"),
      isBackup: z.boolean().optional().describe("Whether to enable automatic backup"),
      backupTime: z.string().optional().describe("Backup time (HH:mm format)"),
      backupFileRetentionPeriod: z.number().optional().describe("Backup retention period in days (1-30)"),
      isAutomaticFailover: z.boolean().optional().describe("Whether to enable automatic failover"),
      shardCount: z.number().optional().describe("Number of shards (for cluster mode)"),
      shardCopyCount: z.number().optional().describe("Number of replicas per shard"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the instance"),
    },
    async (params) => {
      try {
        if (params.dryRun) {
          const preview = {
            label: "🔍 Dry-Run Preview: Cache Instance Creation",
            cloudCacheServiceName: params.cloudCacheServiceName,
            vpcNo: params.vpcNo,
            subnetNo: params.subnetNo,
            cloudCacheImageProductCode: params.cloudCacheImageProductCode,
            cloudCacheProductCode: params.cloudCacheProductCode,
            cloudCacheConfigGroupNo: params.cloudCacheConfigGroupNo,
            cloudCachePort: params.cloudCachePort ?? 6379,
            isBackup: params.isBackup ?? true,
            isAutomaticFailover: params.isAutomaticFailover,
            shardCount: params.shardCount,
            shardCopyCount: params.shardCopyCount,
            message: "이 요청은 실제 Cache 인스턴스를 생성하지 않습니다. dryRun=false로 호출하면 인스턴스가 생성됩니다.",
          };
          return toolText(preview);
        }

        const { dryRun, ...apiParams } = params;
        const result = await client.request("/vcache/v2/createCloudCacheInstance", apiParams);
        const instance = result.cloudCacheInstanceList?.[0];
        const summary = {
          리소스타입: "Cache (Redis/Valkey)",
          리소스ID: instance?.cloudCacheInstanceNo ?? "unknown",
          서비스명: params.cloudCacheServiceName,
          상태: instance?.cloudCacheInstanceStatus?.codeName ?? "creating",
          생성시각: instance?.createDate ?? new Date().toISOString(),
          VPC: params.vpcNo,
          서브넷: params.subnetNo,
          포트: params.cloudCachePort ?? 6379,
        };
        return toolText(summary);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Operation Tools ───────────────────────────────────────────────────────

  server.tool(
    "ncloud_reboot_cache_server",
    "Reboot a Cloud DB for Cache server instance",
    {
      cloudCacheServerInstanceNo: z.string().describe("Cloud Cache server instance number to reboot"),
    },
    async (params) => {
      try {
        const result = await client.request("/vcache/v2/rebootCloudCacheServerInstance", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Manual Backup Tools ─────────────────────────────────────────────────────

  server.tool(
    "ncloud_list_cache_manual_backups",
    "List manual backups for Cloud DB for Cache instances",
    {
      cloudCacheInstanceNo: z.string().optional().describe("Filter by Cloud Cache instance number"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      try {
        const result = await client.request("/vcache/v2/getCloudCacheManualBackupList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_list_cache_manual_backup_details",
    "Get detailed information about a specific Cloud Cache manual backup",
    {
      cloudCacheManualBackupNo: z.string({
        required_error: "필수 파라미터 'cloudCacheManualBackupNo'이 누락되었습니다.",
      }).describe("Cloud Cache manual backup number"),
    },
    async (params) => {
      try {
        const result = await client.request("/vcache/v2/getCloudCacheManualBackupDetailList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_create_cache_manual_backup",
    "Create a manual backup for a Cloud DB for Cache instance",
    {
      cloudCacheInstanceNo: z.string({
        required_error: "필수 파라미터 'cloudCacheInstanceNo'이 누락되었습니다.",
      }).describe("Cloud Cache instance number"),
      cloudCacheManualBackupName: z.string({
        required_error: "필수 파라미터 'cloudCacheManualBackupName'이 누락되었습니다.",
      }).describe("Manual backup name"),
    },
    async (params) => {
      try {
        const result = await client.request("/vcache/v2/createCloudCacheManualBackup", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_delete_cache_manual_backup",
    "⚠️ Destructive: Permanently delete a Cloud Cache manual backup. Set confirm=true to execute.",
    {
      cloudCacheManualBackupNo: z.string({
        required_error: "필수 파라미터 'cloudCacheManualBackupNo'이 누락되었습니다.",
      }).describe("Cloud Cache manual backup number to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete Cache manual backup [${params.cloudCacheManualBackupNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const { confirm, ...apiParams } = params;
        const result = await client.request("/vcache/v2/deleteCloudCacheManualBackup", apiParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Operation Tools (P2) ──────────────────────────────────────────────────

  server.tool(
    "ncloud_flush_cache_server",
    "⚠️ Destructive: Permanently deletes ALL data from a Cloud Cache server (FlushAll). Set confirm=true to execute.",
    {
      cloudCacheServerInstanceNo: z.string({
        required_error: "필수 파라미터 'cloudCacheServerInstanceNo'이 누락되었습니다.",
      }).describe("Cloud Cache server instance number to flush"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete ALL data from Cache server [${params.cloudCacheServerInstanceNo}]. This action cannot be undone. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const { confirm, ...apiParams } = params;
        const result = await client.request("/vcache/v2/flushAllCloudCacheServerInstance", apiParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_export_cache_backup",
    "Export a Cloud Cache backup file to Object Storage",
    {
      cloudCacheInstanceNo: z.string({
        required_error: "필수 파라미터 'cloudCacheInstanceNo'이 누락되었습니다.",
      }).describe("Cloud Cache instance number"),
      cloudCacheServerInstanceNo: z.string({
        required_error: "필수 파라미터 'cloudCacheServerInstanceNo'이 누락되었습니다.",
      }).describe("Cloud Cache server instance number"),
      bucketName: z.string({
        required_error: "필수 파라미터 'bucketName'이 누락되었습니다.",
      }).describe("Object Storage bucket name"),
      folderPath: z.string().optional().describe("Folder path in the bucket"),
      cloudCacheExportObjectList: z.array(z.string()).describe("List of full object names to export"),
    },
    async (params) => {
      try {
        const { cloudCacheExportObjectList, ...rest } = params;
        const apiParams: Record<string, any> = { ...rest };
        cloudCacheExportObjectList.forEach((name, idx) => {
          apiParams[`cloudCacheExportObjectList.${idx + 1}.fullObjectName`] = name;
        });
        const result = await client.request("/vcache/v2/exportBackupToObjectStorage", apiParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_list_cache_backup_details",
    "List detailed backup information for a Cloud Cache server instance (includes file paths)",
    {
      cloudCacheInstanceNo: z.string({
        required_error: "필수 파라미터 'cloudCacheInstanceNo'이 누락되었습니다.",
      }).describe("Cloud Cache instance number"),
      cloudCacheServerInstanceNo: z.string({
        required_error: "필수 파라미터 'cloudCacheServerInstanceNo'이 누락되었습니다.",
      }).describe("Cloud Cache server instance number"),
    },
    async (params) => {
      try {
        const result = await client.request("/vcache/v2/getCloudCacheBackupDetailList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Reference Tools (P3) ─────────────────────────────────────────────────

  server.tool(
    "ncloud_get_cache_image_products",
    "List available Cloud Cache image product codes (Redis/Valkey versions)",
    {
      regionCode: z.string().optional().describe("Region code (e.g., KR, JPN, SGN)"),
    },
    async (params) => {
      try {
        const result = await client.request("/vcache/v2/getCloudCacheImageProductList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_get_cache_products",
    "List available Cloud Cache server spec product codes for a given image",
    {
      cloudCacheImageProductCode: z.string({
        required_error: "필수 파라미터 'cloudCacheImageProductCode'이 누락되었습니다.",
      }).describe("Cloud Cache image product code"),
    },
    async (params) => {
      try {
        const result = await client.request("/vcache/v2/getCloudCacheProductList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_get_cache_target_vpcs",
    "List VPCs available for Cloud DB for Cache",
    {
      regionCode: z.string().optional().describe("Region code (e.g., KR, JPN, SGN)"),
    },
    async (params) => {
      try {
        const result = await client.request("/vcache/v2/getCloudCacheTargetVpcList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_get_cache_target_subnets",
    "List subnets available for Cloud DB for Cache within a specific instance",
    {
      cloudCacheInstanceNo: z.string({
        required_error: "필수 파라미터 'cloudCacheInstanceNo'이 누락되었습니다.",
      }).describe("Cloud Cache instance number"),
      regionCode: z.string().optional().describe("Region code (e.g., KR, JPN, SGN)"),
    },
    async (params) => {
      try {
        const result = await client.request("/vcache/v2/getCloudCacheTargetSubnetList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_list_cache_config_group_versions",
    "List available Cloud Cache config group versions",
    {
      regionCode: z.string().optional().describe("Region code (e.g., KR, JPN, SGN)"),
    },
    async (params) => {
      try {
        const result = await client.request("/vcache/v2/getCloudCacheConfigGroupVersionList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_list_cache_buckets",
    "List Object Storage buckets available for Cloud DB for Cache backup export",
    {
      regionCode: z.string().optional().describe("Region code (e.g., KR, JPN, SGN)"),
    },
    async (params) => {
      try {
        const result = await client.request("/vcache/v2/getCloudCacheBucketList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Destructive Tools (with confirm gate) ─────────────────────────────────

  server.tool(
    "ncloud_delete_cache_instance",
    "⚠️ Destructive: Permanently delete a Cloud DB for Cache (Redis/Valkey) instance. Set confirm=true to execute.",
    {
      cloudCacheInstanceNo: z.string().describe("Cloud Cache instance number to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete Cache instance [${params.cloudCacheInstanceNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const { confirm, ...apiParams } = params;
        const result = await client.request("/vcache/v2/deleteCloudCacheInstance", apiParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
