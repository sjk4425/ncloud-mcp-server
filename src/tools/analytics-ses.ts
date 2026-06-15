import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";

/**
 * Search Engine Service (SES) API
 *
 * Base URL: https://vpcsearchengine.apigw.ntruss.com
 * - Korea: /api/v2/...
 * - Singapore: /api/sgn-v2/...
 * - Japan: /api/jpn-v2/...
 *
 * HTTP Methods vary per API (GET, POST, DELETE)
 * Response format: { code, message, result, requestId }
 */

function getApiPrefix(regionCode: string): string {
  switch (regionCode) {
    case "SGN": return "/api/sgn-v2";
    case "JPN": return "/api/jpn-v2";
    default: return "/api/v2";
  }
}

export function registerSearchEngineServiceTools(server: McpServer, client: NcloudClient): void {
  // ─── Cluster List ──────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_list_clusters",
    "List all Search Engine Service (Elasticsearch/OpenSearch) clusters in the current region",
    {
      inputText: z.string().optional().describe("Search keyword to filter cluster names"),
      vpcName: z.string().optional().describe("VPC name to filter (exact match)"),
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Page size (default: 10)"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const queryParams: Record<string, string | number | boolean | undefined> = {};
      if (params.inputText) queryParams["inputText"] = params.inputText;
      if (params.vpcName) queryParams["vpcName"] = params.vpcName;
      if (params.pageNo) queryParams["pageNo"] = params.pageNo;
      if (params.pageSize) queryParams["pageSize"] = params.pageSize;
      const result = await client.requestRaw("GET", `${prefix}/cluster/getClusterInfoList`, queryParams);
      return result;
    }
  );

  // ─── Cluster Detail ────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_cluster_detail",
    "Get detailed information about a specific Search Engine Service cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number (from getClusterInfoList)"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("GET", `${prefix}/cluster/getClusterInfo/${params.serviceGroupInstanceNo}`);
      return result;
    }
  );

  // ─── Cluster ACG List ──────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_cluster_acg",
    "Get ACG (Access Control Group) rules for a Search Engine Service cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("GET", `${prefix}/cluster/getClusterAcgInfo/${params.serviceGroupInstanceNo}`);
      return result;
    }
  );

  // ─── Cluster Node List ─────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_node_list",
    "Get node list for a Search Engine Service cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("GET", `${prefix}/cluster/getClusterNodeList/${params.serviceGroupInstanceNo}`);
      return result;
    }
  );

  // ─── Get Version List ──────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_versions",
    "Get available Search Engine (Elasticsearch/OpenSearch) versions",
    {},
    async () => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("GET", `${prefix}/cluster/getSearchEngineVersionList`);
      return result;
    }
  );

  // ─── Get Server Generation List ───────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_server_generations",
    "Get available node server generations for Search Engine Service",
    {},
    async () => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("GET", `${prefix}/cluster/getSearchEngineServerGenerationList`);
      return result;
    }
  );

  // ─── Get Server Type (G2) ─────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_node_products",
    "Get available node server types (product codes) for Search Engine Service (G2)",
    {
      softwareProductCode: z.string().describe("OS product code (from getOsProductList)"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("POST", `${prefix}/cluster/getNodeProductList`, undefined, {
        softwareProductCode: params.softwareProductCode,
      });
      return result;
    }
  );

  // ─── Get Server Type (G3) ─────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_server_specs",
    "Get available node server types for Search Engine Service (G3/KVM only)",
    {
      softwareProductCode: z.string().describe("OS product code (from getClusterServerImageList)"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("POST", `${prefix}/cluster/getServerSpecList`, undefined, {
        softwareProductCode: params.softwareProductCode,
      });
      return result;
    }
  );

  // ─── Get OS Product List (G2) ─────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_os_products",
    "Get available OS types for Search Engine Service (G2)",
    {},
    async () => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("GET", `${prefix}/cluster/getOsProductList`);
      return result;
    }
  );

  // ─── Get OS Product List (G3) ─────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_cluster_server_images",
    "Get available OS types for Search Engine Service (G3/KVM only)",
    {},
    async () => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("GET", `${prefix}/cluster/getClusterServerImageList`);
      return result;
    }
  );

  // ─── Get VPC List ─────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_vpc_list",
    "Get available VPC list for Search Engine Service cluster creation",
    {},
    async () => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("GET", `${prefix}/cluster/getVpcList`);
      return result;
    }
  );

  // ─── Get Subnet List ──────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_subnet_list",
    "Get available subnet list for Search Engine Service cluster creation",
    {
      vpcNo: z.number().describe("VPC number"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("GET", `${prefix}/cluster/getSubnetList`, { vpcNo: params.vpcNo });
      return result;
    }
  );

  // ─── Get Subnet List (G3) ─────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_subnet_list_g3",
    "Get available subnet list for Search Engine Service cluster creation (G3/KVM only)",
    {
      vpcNo: z.number().describe("VPC number"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("POST", `${prefix}/cluster/getVpcAvailableSubnetList`, undefined, {
        vpcNo: params.vpcNo,
      });
      return result;
    }
  );

  // ─── Get Login Key List ───────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_login_keys",
    "Get authentication key list for SSH access to Search Engine Service manager nodes",
    {},
    async () => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("GET", `${prefix}/cluster/getLoginKeyList`);
      return result;
    }
  );

  // ─── Create Cluster (G2) ───────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_create_cluster",
    "Create a new Search Engine Service cluster (G2). Use dryRun=true to preview.",
    {
      clusterName: z.string().describe("Cluster name (3-15 chars, lowercase+numbers+'-')"),
      searchEngineVersionCode: z.string().describe("Search engine version code (from getSearchEngineVersionList)"),
      searchEngineDashboardPort: z.string().describe("Dashboard port (1025-65534, not 9090/9200/9300)"),
      searchEngineUserName: z.string().describe("Admin account ID (3-15 chars)"),
      searchEngineUserPassword: z.string().describe("Admin password (8-20 chars, letters+numbers+special)"),
      softwareProductCode: z.string().describe("OS type code (from getOsProductList)"),
      vpcNo: z.number().describe("VPC number"),
      managerNodeSubnetNo: z.number().describe("Manager node subnet number"),
      managerNodeProductCode: z.string().describe("Manager node server type code"),
      dataNodeSubnetNo: z.number().describe("Data node subnet number"),
      dataNodeCount: z.number().describe("Number of data nodes (3-10)"),
      dataNodeProductCode: z.string().describe("Data node server type code"),
      dataNodeStorageSize: z.number().describe("Data node storage size in GB (100-2000, 10GB increment)"),
      loginKeyName: z.string().describe("Authentication key name for SSH access"),
      isDualManager: z.boolean().optional().describe("Manager node redundancy (default: true)"),
      isMasterOnlyNodeActivated: z.boolean().optional().describe("Enable dedicated master nodes"),
      masterNodeSubnetNo: z.number().optional().describe("Master node subnet (required if master enabled)"),
      masterNodeCount: z.number().optional().describe("Number of master nodes (3 or 5)"),
      masterNodeProductCode: z.string().optional().describe("Master node server type code"),
      dryRun: z.boolean().optional().default(false).describe("If true, preview only without creating"),
    },
    async (params) => {
      if (params.dryRun) {
        const { dryRun, ...rest } = params;
        const preview = {
          label: "Dry-Run Preview: SES Cluster Creation (G2)",
          ...rest,
          message: "This is a dry-run preview. Call again with dryRun=false to create.",
        };
        return preview;
      }
      const { dryRun, ...apiParams } = params;
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("POST", `${prefix}/cluster/createSearchEngineCluster`, undefined, apiParams);
      return result;
    }
  );

  // ─── Create Cluster (G3/KVM) ──────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_create_cluster_g3",
    "Create a new Search Engine Service cluster (G3/KVM). Use dryRun=true to preview.",
    {
      clusterName: z.string().describe("Cluster name (3-15 chars, lowercase+numbers+'-')"),
      searchEngineVersionCode: z.string().describe("Search engine version code"),
      searchEngineDashboardPort: z.string().describe("Dashboard port (1025-65534, not 9090/9200/9300)"),
      searchEngineUserName: z.string().describe("Admin account ID (3-15 chars)"),
      searchEngineUserPassword: z.string().describe("Admin password (8-20 chars)"),
      softwareProductCode: z.string().describe("OS type code (from getClusterServerImageList)"),
      vpcNo: z.number().describe("VPC number"),
      managerNodeSubnetNo: z.number().describe("Manager node subnet number"),
      managerNodeServerSpecCode: z.string().describe("Manager node server spec code (from getServerSpecList)"),
      dataNodeSubnetNo: z.number().describe("Data node subnet number"),
      dataNodeCount: z.number().describe("Number of data nodes (3-10)"),
      dataNodeServerSpecCode: z.string().describe("Data node server spec code"),
      dataNodeStorageSize: z.number().describe("Data node storage size in GB (100-2000)"),
      loginKeyName: z.string().describe("Authentication key name"),
      isDualManager: z.boolean().optional().describe("Manager node redundancy (default: true)"),
      isMasterOnlyNodeActivated: z.boolean().optional().describe("Enable dedicated master nodes"),
      masterNodeSubnetNo: z.number().optional().describe("Master node subnet"),
      masterNodeCount: z.number().optional().describe("Number of master nodes (3 or 5)"),
      masterNodeServerSpecCode: z.string().optional().describe("Master node server spec code"),
      dryRun: z.boolean().optional().default(false).describe("If true, preview only without creating"),
    },
    async (params) => {
      if (params.dryRun) {
        const { dryRun, ...rest } = params;
        const preview = {
          label: "Dry-Run Preview: SES Cluster Creation (G3/KVM)",
          ...rest,
          message: "This is a dry-run preview. Call again with dryRun=false to create.",
        };
        return preview;
      }
      const { dryRun, ...apiParams } = params;
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("POST", `${prefix}/cluster/createKvmSearchEngineCluster`, undefined, apiParams);
      return result;
    }
  );

  // ─── Restart Cluster ───────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_restart_cluster",
    "Restart a Search Engine Service cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("POST", `${prefix}/cluster/restartCluster/${params.serviceGroupInstanceNo}`);
      return result;
    }
  );

  // ─── Delete Cluster ────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_delete_cluster",
    "⚠️ Destructive: Permanently delete a Search Engine Service cluster. All data and indices will be lost. Set confirm=true to execute.",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("DELETE", `${prefix}/cluster/deleteSearchEngineCluster/${params.serviceGroupInstanceNo}`);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete Search Engine Service cluster [${params.serviceGroupInstanceNo}]. All data and indices will be lost.\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Add Node ──────────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_add_node",
    "Add data nodes to a Search Engine Service cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      addDataNodeCount: z.number().describe("Number of data nodes to add"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("POST", `${prefix}/cluster/changeCountOfDataNode`, undefined, {
        serviceGroupInstanceNo: params.serviceGroupInstanceNo,
        addDataNodeCount: params.addDataNodeCount,
      });
      return result;
    }
  );

  // ─── Get Node Spec Detail ──────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_node_spec_detail",
    "Get server specifications for each node in a Search Engine Service cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("GET", `${prefix}/cluster/getNodeSpecDetail/${params.serviceGroupInstanceNo}`);
      return result;
    }
  );

  // ─── Change Node Spec ──────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_change_node_spec",
    "Change server specifications for nodes in a Search Engine Service cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      computeInstanceNoList: z.array(z.number()).describe("List of node instance numbers to change"),
      productCode: z.string().describe("New server product code"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("POST", `${prefix}/cluster/changeSpecNode`, undefined, params);
      return result;
    }
  );

  // ─── Change Disk Capacity ──────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_change_disk_size",
    "Change data node disk capacity for a Search Engine Service cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      dataNodeStorageSize: z.number().describe("New storage size in GB (100-2000, 10GB increment)"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("POST", `${prefix}/cluster/changeClusterNodeDiskSize`, undefined, params);
      return result;
    }
  );

  // ─── Reset Account Password ────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_reset_password",
    "Reset the Search Engine admin account password",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      searchEngineUserPassword: z.string().describe("New admin password (8-20 chars)"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("POST", `${prefix}/cluster/resetSearchEngineUserPassword`, undefined, params);
      return result;
    }
  );

  // ─── Dashboard ─────────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_dashboard",
    "Get dashboard information for a Search Engine Service cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("GET", `${prefix}/cluster/getDashboard/${params.serviceGroupInstanceNo}`);
      return result;
    }
  );

  // ─── Monitoring ────────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_monitoring",
    "Get monitoring data for a Search Engine Service cluster or node",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      startDateTime: z.string().optional().describe("Start time (ISO 8601 format)"),
      endDateTime: z.string().optional().describe("End time (ISO 8601 format)"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const queryParams: Record<string, string | number | boolean | undefined> = {
        serviceGroupInstanceNo: params.serviceGroupInstanceNo,
      };
      if (params.startDateTime) queryParams["startDateTime"] = params.startDateTime;
      if (params.endDateTime) queryParams["endDateTime"] = params.endDateTime;
      const result = await client.requestRaw("GET", `${prefix}/cluster/getMonitoringData`, queryParams);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_ses_get_os_monitoring",
    "Get OS-level monitoring data for a Search Engine Service node",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      computeInstanceNo: z.string().describe("Node instance number"),
      startDateTime: z.string().optional().describe("Start time (ISO 8601 format)"),
      endDateTime: z.string().optional().describe("End time (ISO 8601 format)"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const queryParams: Record<string, string | number | boolean | undefined> = {
        serviceGroupInstanceNo: params.serviceGroupInstanceNo,
        computeInstanceNo: params.computeInstanceNo,
      };
      if (params.startDateTime) queryParams["startDateTime"] = params.startDateTime;
      if (params.endDateTime) queryParams["endDateTime"] = params.endDateTime;
      const result = await client.requestRaw("GET", `${prefix}/cluster/getOsMonitoringData`, queryParams);
      return result;
    }
  );

  // ─── Snapshot ──────────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_snapshot_buckets",
    "Get Object Storage bucket list available for storing cluster snapshots",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("GET", `${prefix}/cluster/getSnapshotBucketList`, {
        serviceGroupInstanceNo: params.serviceGroupInstanceNo,
      });
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_ses_set_snapshot_api_key",
    "Set API authentication key for Object Storage access (for snapshots)",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      accessKeyId: z.string().describe("Object Storage access key"),
      secretAccessKey: z.string().describe("Object Storage secret key"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("POST", `${prefix}/cluster/setSnapshotApiKey`, undefined, params);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_ses_create_snapshot",
    "Create a snapshot of a Search Engine Service cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      bucketName: z.string().describe("Object Storage bucket name for snapshot storage"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("POST", `${prefix}/cluster/createSnapshot`, undefined, params);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_ses_get_snapshot_history",
    "Get snapshot creation history for a Search Engine Service cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("GET", `${prefix}/cluster/getSnapshotHistory`, {
        serviceGroupInstanceNo: params.serviceGroupInstanceNo,
      });
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_ses_set_snapshot_schedule",
    "Set snapshot scheduling for a Search Engine Service cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      bucketName: z.string().describe("Object Storage bucket name"),
      scheduleExpression: z.string().describe("Cron expression for scheduling"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("POST", `${prefix}/cluster/setSnapshotSchedule`, undefined, params);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_ses_unset_snapshot_schedule",
    "Unset (disable) snapshot scheduling for a Search Engine Service cluster. This only removes the schedule, not existing snapshots.",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("POST", `${prefix}/cluster/removeSnapshotSchedule`, undefined, params);
      return result;
    }
  );

  // ─── Import ────────────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_import_buckets",
    "Get Object Storage bucket list available for data import",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("GET", `${prefix}/cluster/getImportBucketList`, {
        serviceGroupInstanceNo: params.serviceGroupInstanceNo,
      });
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_ses_run_import",
    "Run data import from Object Storage to a Search Engine Service cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      bucketName: z.string().describe("Object Storage bucket name"),
      filePath: z.string().describe("File path in the bucket"),
      indexName: z.string().describe("Target index name"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("POST", `${prefix}/cluster/runImport`, undefined, params);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_ses_get_import_history",
    "Get data import history for a Search Engine Service cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("GET", `${prefix}/cluster/getImportHistory`, {
        serviceGroupInstanceNo: params.serviceGroupInstanceNo,
      });
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_ses_stop_import",
    "Stop a running data import operation",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      importTaskId: z.string().describe("Import task ID to stop"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("POST", `${prefix}/cluster/stopImport`, undefined, params);
      return result;
    }
  );

  // ─── Version Upgrade ───────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_upgrade_version",
    "Upgrade Search Engine version for a cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      searchEngineVersionCode: z.string().describe("Target version code"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("POST", `${prefix}/cluster/rollingUpgradeCluster`, undefined, params);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_ses_precheck_upgrade",
    "Pre-check before upgrading Search Engine version",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      searchEngineVersionCode: z.string().describe("Target version code"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("POST", `${prefix}/cluster/rollingUpgradePreCheck`, undefined, params);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_ses_get_upgrade_progress",
    "Get version upgrade progress for a Search Engine Service cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("GET", `${prefix}/cluster/getRollingUpgradeProgress/${params.serviceGroupInstanceNo}`);
      return result;
    }
  );

  // ─── Change Node Type (Hot/Warm) ──────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_change_node_type",
    "Change data node type (Hot/Warm) for a Search Engine Service cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      hotDataNodeCount: z.number().describe("Number of hot data nodes"),
      warmDataNodeCount: z.number().describe("Number of warm data nodes"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("POST", `${prefix}/cluster/setHotWarmNode`, undefined, params);
      return result;
    }
  );
}
