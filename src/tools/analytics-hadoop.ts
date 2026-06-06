import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { toolText } from "./_response.js";

/**
 * Cloud Hadoop (VPC) — 빅데이터 분석 관리형 서비스
 *
 * Base URL: https://ncloud.apigw.ntruss.com
 * API 경로: /vhadoop/v2/
 * 공식 문서: https://api.ncloud-docs.com/docs/analytics-vhadoop
 *
 * Clusters API (19개) + Notebooks API (8개) = 총 27개
 */

export function registerCloudHadoopTools(server: McpServer, client: NcloudClient): void {
  // ═══════════════════════════════════════════════════════════════════════
  // Clusters — Query Tools
  // ═══════════════════════════════════════════════════════════════════════

  server.tool(
    "ncloud_hadoop_list_clusters",
    "List Cloud Hadoop clusters with optional filtering",
    {
      regionCode: z.string().optional().describe("Region code (e.g. KR, SGN, JPN)"),
      zoneCode: z.string().optional().describe("Zone code filter (e.g. KR-2)"),
      vpcNo: z.string().optional().describe("VPC number filter"),
      subnetNo: z.string().optional().describe("Subnet number filter"),
      cloudHadoopClusterName: z.string().optional().describe("Cluster name filter"),
      cloudHadoopInstanceNoList: z.array(z.string()).optional().describe("Cluster instance numbers"),
      cloudHadoopServerName: z.string().optional().describe("Server name filter"),
      cloudHadoopServerInstanceNoList: z.array(z.string()).optional().describe("Server instance numbers"),
      pageNo: z.number().optional().describe("Page number (default: 0)"),
      pageSize: z.number().optional().describe("Page size (default: 1)"),
    },
    async (params) => {
      try {
        const result = await client.request("/vhadoop/v2/getCloudHadoopInstanceList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_hadoop_get_cluster_detail",
    "Get detailed information about a specific Cloud Hadoop cluster",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopInstanceNo: z.string().describe("Cloud Hadoop instance number"),
    },
    async (params) => {
      try {
        const result = await client.request("/vhadoop/v2/getCloudHadoopInstanceDetail", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_hadoop_list_addons",
    "List available add-on components for Cloud Hadoop clusters",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopImageProductCode: z.string().optional().describe("Image product code filter"),
    },
    async (params) => {
      try {
        const result = await client.request("/vhadoop/v2/getCloudHadoopAddOnList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_hadoop_list_buckets",
    "List Object Storage buckets available for Cloud Hadoop",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopInstanceNo: z.string().optional().describe("Cloud Hadoop instance number"),
    },
    async (params) => {
      try {
        const result = await client.request("/vhadoop/v2/getCloudHadoopBucketList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_hadoop_list_cluster_types",
    "List available cluster types for Cloud Hadoop",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopImageProductCode: z.string().optional().describe("Image product code filter"),
    },
    async (params) => {
      try {
        const result = await client.request("/vhadoop/v2/getCloudHadoopClusterTypeList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_hadoop_list_image_products",
    "List available Cloud Hadoop image products (engine versions)",
    {
      regionCode: z.string().optional().describe("Region code"),
    },
    async (params) => {
      try {
        const result = await client.request("/vhadoop/v2/getCloudHadoopImageProductList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_hadoop_list_login_keys",
    "List login keys available for Cloud Hadoop SSH access",
    {
      regionCode: z.string().optional().describe("Region code"),
    },
    async (params) => {
      try {
        const result = await client.request("/vhadoop/v2/getCloudHadoopLoginKeyList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_hadoop_list_mysql_instances",
    "List Cloud DB for MySQL instances for Hive metastore integration",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopInstanceNo: z.string().optional().describe("Cloud Hadoop instance number"),
    },
    async (params) => {
      try {
        const result = await client.request("/vhadoop/v2/getCloudHadoopMysqlInstanceList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_hadoop_list_mysql_users",
    "List MySQL users for Hive metastore integration",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudMysqlInstanceNo: z.string().describe("Cloud DB for MySQL instance number"),
    },
    async (params) => {
      try {
        const result = await client.request("/vhadoop/v2/getCloudHadoopMysqlUserList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_hadoop_list_objects",
    "List objects in Object Storage bucket linked to Cloud Hadoop",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopInstanceNo: z.string().describe("Cloud Hadoop instance number"),
      bucketName: z.string().optional().describe("Bucket name"),
      directoryName: z.string().optional().describe("Directory path within bucket"),
    },
    async (params) => {
      try {
        const result = await client.request("/vhadoop/v2/getCloudHadoopObjectList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_hadoop_list_products",
    "List available server types (specs) for Cloud Hadoop nodes",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopImageProductCode: z.string().optional().describe("Image product code filter"),
    },
    async (params) => {
      try {
        const result = await client.request("/vhadoop/v2/getCloudHadoopProductList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_hadoop_list_target_subnets",
    "List subnets available for Cloud Hadoop deployment",
    {
      regionCode: z.string().optional().describe("Region code"),
      vpcNo: z.string().optional().describe("VPC number filter"),
      zoneCode: z.string().optional().describe("Zone code filter"),
    },
    async (params) => {
      try {
        const result = await client.request("/vhadoop/v2/getCloudHadoopTargetSubnetList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_hadoop_list_target_vpcs",
    "List VPCs available for Cloud Hadoop deployment",
    {
      regionCode: z.string().optional().describe("Region code"),
    },
    async (params) => {
      try {
        const result = await client.request("/vhadoop/v2/getCloudHadoopTargetVpcList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Clusters — Hive Metastore Tools
  // ═══════════════════════════════════════════════════════════════════════

  server.tool(
    "ncloud_hadoop_test_hive_metastore",
    "Test connectivity to external Hive metastore (Cloud DB for MySQL)",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopInstanceNo: z.string().describe("Cloud Hadoop instance number"),
      cloudMysqlInstanceNo: z.string().describe("Cloud DB for MySQL instance number"),
      cloudMysqlUserName: z.string().describe("MySQL user name for metastore"),
      cloudMysqlUserPassword: z.string().describe("MySQL user password"),
      cloudMysqlDatabaseName: z.string().describe("MySQL database name for metastore"),
    },
    async (params) => {
      try {
        const result = await client.request("/vhadoop/v2/testConnectExternalHiveMetaStore", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_hadoop_save_hive_metastore",
    "Save external Hive metastore configuration to Cloud Hadoop cluster",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopInstanceNo: z.string().describe("Cloud Hadoop instance number"),
      cloudMysqlInstanceNo: z.string().describe("Cloud DB for MySQL instance number"),
      cloudMysqlUserName: z.string().describe("MySQL user name for metastore"),
      cloudMysqlUserPassword: z.string().describe("MySQL user password"),
      cloudMysqlDatabaseName: z.string().describe("MySQL database name for metastore"),
    },
    async (params) => {
      try {
        const result = await client.request("/vhadoop/v2/saveExternalHiveMetaStore", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Clusters — Backup Tool
  // ═══════════════════════════════════════════════════════════════════════

  server.tool(
    "ncloud_hadoop_backup_config",
    "Backup all cluster component configurations to Object Storage bucket",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopInstanceNo: z.string().describe("Cloud Hadoop instance number"),
    },
    async (params) => {
      try {
        const result = await client.request("/vhadoop/v2/backupClusterConfiguration", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Clusters — Create / Mutate Tools
  // ═══════════════════════════════════════════════════════════════════════

  server.tool(
    "ncloud_hadoop_create_cluster",
    "Create a new Cloud Hadoop cluster. HA is always enabled (2 master nodes). Use dryRun=true to preview.",
    {
      regionCode: z.string().optional().describe("Region code (e.g. KR)"),
      cloudHadoopClusterName: z.string().describe("Cluster name (3-15 chars, lowercase+numbers+'-')"),
      cloudHadoopClusterTypeCode: z.string().describe("Cluster type code (use ncloud_hadoop_list_cluster_types)"),
      cloudHadoopImageProductCode: z.string().optional().describe("Image product code. Default: latest"),
      cloudHadoopAddOnCodeList: z.array(z.string()).optional().describe("Add-on codes (e.g. PRESTO, HBASE)"),
      useDataCatalog: z.boolean().optional().describe("Use Data Catalog for Hive metastore (default: false)"),
      useKdc: z.boolean().optional().describe("Use Kerberos KDC (default: false)"),
      kdcRealm: z.string().optional().describe("KDC Realm (required when useKdc=true)"),
      kdcPassword: z.string().optional().describe("KDC admin password (required when useKdc=true)"),
      vpcNo: z.string().describe("VPC number"),
      cloudHadoopAdminUserName: z.string().describe("Admin user name for Ambari (3-15 chars)"),
      cloudHadoopAdminUserPassword: z.string().describe("Admin password (8-20 chars)"),
      bucketName: z.string().describe("Object Storage bucket name"),
      useBootstrapScript: z.boolean().optional().describe("Use bootstrap script (default: false)"),
      bootstrapScript: z.string().optional().describe("Bootstrap script path (required when useBootstrapScript=true)"),
      edgeNodeSubnetNo: z.string().describe("Edge node subnet number"),
      edgeNodeProductCode: z.string().optional().describe("Edge node server type code"),
      masterNodeSubnetNo: z.string().describe("Master node subnet number"),
      masterNodeProductCode: z.string().optional().describe("Master node server type code"),
      masterNodeDataStorageTypeCode: z.string().describe("Master storage type (SSD|HDD|CB2)"),
      masterNodeDataStorageSize: z.number().describe("Master storage GB (100-2000/10GB, or 4000, 6000)"),
      workerNodeSubnetNo: z.string().describe("Worker node subnet (private subnet only)"),
      workerNodeProductCode: z.string().optional().describe("Worker node server type code"),
      workerNodeCount: z.number().optional().describe("Worker node count (2-8, default: 2)"),
      workerNodeDataStorageTypeCode: z.string().describe("Worker storage type (SSD|HDD|CB2)"),
      workerNodeDataStorageSize: z.number().describe("Worker storage GB (100-2000/10GB, or 4000, 6000)"),
      loginKeyName: z.string().describe("Login key name for SSH access"),
      engineVersionCode: z.string().optional().describe("Engine version code (for Rocky cluster)"),
      dryRun: z.boolean().optional().default(false).describe("Preview without creating"),
    },
    async (params) => {
      try {
        if (params.dryRun) {
          const { dryRun, ...rest } = params;
          const preview = { label: "Dry-Run Preview", ...rest, note: "Call with dryRun=false to create." };
          return toolText(preview);
        }
        const { dryRun, ...apiParams } = params;
        const result = await client.request("/vhadoop/v2/createCloudHadoopInstance", apiParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_hadoop_change_node_count",
    "Change worker node count in a Cloud Hadoop cluster (add or remove nodes)",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopInstanceNo: z.string().describe("Cloud Hadoop instance number"),
      workerNodeCount: z.number().describe("Target worker node count (max +10 per call)"),
    },
    async (params) => {
      try {
        const result = await client.request("/vhadoop/v2/changeCloudHadoopNodeCount", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_hadoop_change_node_spec",
    "Upgrade node specs for Cloud Hadoop cluster (at least one node type required)",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopInstanceNo: z.string().describe("Cloud Hadoop instance number"),
      masterNodeProductCode: z.string().optional().describe("New master node server type code"),
      edgeNodeProductCode: z.string().optional().describe("New edge node server type code"),
      workerNodeProductCode: z.string().optional().describe("New worker node server type code"),
    },
    async (params) => {
      try {
        const result = await client.request("/vhadoop/v2/changeCloudHadoopNodeSpec", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Clusters — Destructive Tools
  // ═══════════════════════════════════════════════════════════════════════

  server.tool(
    "ncloud_hadoop_delete_cluster",
    "⚠️ Destructive: Permanently delete a Cloud Hadoop cluster. All data will be lost. Set confirm=true to execute.",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopInstanceNo: z.string().describe("Cloud Hadoop instance number to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to execute deletion"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          return {
            content: [{ type: "text" as const, text: `⚠️ This will permanently delete Cloud Hadoop cluster [${params.cloudHadoopInstanceNo}]. All data will be lost.\n\nCall again with confirm=true to proceed.` }],
          };
        }
        const { confirm, ...apiParams } = params;
        const result = await client.request("/vhadoop/v2/deleteCloudHadoopInstance", apiParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Notebooks — Query Tools
  // ═══════════════════════════════════════════════════════════════════════

  server.tool(
    "ncloud_hadoop_list_notebooks",
    "List Cloud Hadoop notebook instances",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopInstanceNo: z.string().optional().describe("Filter by cluster instance number"),
      cloudHadoopNotebookInstanceNoList: z.array(z.string()).optional().describe("Notebook instance numbers"),
      pageNo: z.number().optional().describe("Page number"),
      pageSize: z.number().optional().describe("Page size"),
    },
    async (params) => {
      try {
        const result = await client.request("/vhadoop/v2/getCloudHadoopNotebookInstanceList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_hadoop_get_notebook_detail",
    "Get detailed information about a specific Cloud Hadoop notebook",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopNotebookInstanceNo: z.string().describe("Notebook instance number"),
    },
    async (params) => {
      try {
        const result = await client.request("/vhadoop/v2/getCloudHadoopNotebookInstanceDetail", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_hadoop_list_notebook_buckets",
    "List Object Storage buckets available for Cloud Hadoop notebooks",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopInstanceNo: z.string().optional().describe("Cloud Hadoop instance number"),
    },
    async (params) => {
      try {
        const result = await client.request("/vhadoop/v2/getCloudHadoopNotebookBucketList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_hadoop_list_notebook_components",
    "List available notebook components (e.g. Jupyter versions)",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopImageProductCode: z.string().optional().describe("Image product code filter"),
    },
    async (params) => {
      try {
        const result = await client.request("/vhadoop/v2/getCloudHadoopNotebookComponentList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_hadoop_list_notebook_images",
    "List available notebook image products",
    {
      regionCode: z.string().optional().describe("Region code"),
    },
    async (params) => {
      try {
        const result = await client.request("/vhadoop/v2/getCloudHadoopNotebookImageProductList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_hadoop_list_notebook_products",
    "List available server types for notebook nodes",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopNotebookImageProductCode: z.string().optional().describe("Notebook image product code"),
    },
    async (params) => {
      try {
        const result = await client.request("/vhadoop/v2/getCloudHadoopNotebookProductList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Notebooks — Create / Delete Tools
  // ═══════════════════════════════════════════════════════════════════════

  server.tool(
    "ncloud_hadoop_create_notebook",
    "Create a Cloud Hadoop notebook instance attached to an existing cluster",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopNotebookName: z.string().describe("Notebook name (3-15 chars, lowercase+numbers+'-')"),
      cloudHadoopNotebookComponent: z.string().describe("Notebook component code (use ncloud_hadoop_list_notebook_components)"),
      cloudHadoopNotebookImageProductCode: z.string().optional().describe("Notebook image code. Default: latest"),
      cloudHadoopInstanceNo: z.string().describe("Cluster instance number to attach"),
      bucketName: z.string().describe("Object Storage bucket name"),
      notebookNodeSubnetNo: z.string().describe("Notebook node subnet number"),
      notebookNodeProductCode: z.string().optional().describe("Notebook node server type code"),
      useNotebookBlockStorage: z.boolean().optional().describe("Add block storage (default: false)"),
      notebookNodeDataStorageTypeCode: z.string().optional().describe("Storage type SSD|HDD|CB2 (when useNotebookBlockStorage=true)"),
      notebookNodeDataStorageSize: z.number().optional().describe("Storage GB (when useNotebookBlockStorage=true)"),
      loginKeyName: z.string().describe("Login key name for SSH access"),
      engineVersionCode: z.string().optional().describe("Engine version code (for Rocky)"),
    },
    async (params) => {
      try {
        const result = await client.request("/vhadoop/v2/createCloudHadoopNotebookInstance", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_hadoop_delete_notebook",
    "⚠️ Destructive: Permanently delete a Cloud Hadoop notebook. Set confirm=true to execute.",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopNotebookInstanceNo: z.string().describe("Notebook instance number to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to execute deletion"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          return {
            content: [{ type: "text" as const, text: `⚠️ This will permanently delete notebook [${params.cloudHadoopNotebookInstanceNo}].\n\nCall again with confirm=true to proceed.` }],
          };
        }
        const { confirm, ...apiParams } = params;
        const result = await client.request("/vhadoop/v2/deleteCloudHadoopNotebookInstance", apiParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
