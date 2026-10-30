import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { dryRunPreview } from "./_dryrun.js";
import { requiredError } from "./_messages.js";

/** 클러스터·노트북·관리자 이름 규칙(세 존 가이드 동일): 3~15자, 영소문자로 시작, 영소문자·숫자·'-', 영소문자·숫자로 끝. */
const HADOOP_NAME = /^[a-z][a-z0-9-]{1,13}[a-z0-9]$/;
const hadoopName = (field: string) =>
  z.string({ required_error: requiredError(field) }).regex(HADOOP_NAME, {
    message: `${field}: 3-15 chars, lowercase letters, numbers and '-', starting with a lowercase letter and ending with a letter or number`,
  });

/** 데이터 스토리지 크기(세 존 가이드 동일): 100~2000GB 10GB 단위, 또는 4000·6000. */
const hadoopStorageSize = (field: string) =>
  z.number().refine((n) => n === 4000 || n === 6000 || (n >= 100 && n <= 2000 && n % 10 === 0), {
    message: `${field}: 100-2000 GB in 10 GB steps, or 4000 / 6000`,
  });

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

  defineTool(
    server,
    "ncloud_hadoop_list_clusters",
    "List Cloud Hadoop clusters with optional filtering",
    {
      regionCode: z.string().optional().describe("Region code (see ncloud_get_regions)"),
      zoneCode: z.string().optional().describe("Zone code filter (see ncloud_get_zones)"),
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
      return client.request("/vhadoop/v2/getCloudHadoopInstanceList", params);
    }
  );

  defineTool(
    server,
    "ncloud_hadoop_get_cluster_detail",
    "Get detailed information about a specific Cloud Hadoop cluster",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopInstanceNo: z.string().describe("Cloud Hadoop instance number"),
    },
    async (params) => {
      return client.request("/vhadoop/v2/getCloudHadoopInstanceDetail", params);
    }
  );

  defineTool(
    server,
    "ncloud_hadoop_list_addons",
    "List available add-on components for a Cloud Hadoop image version and cluster type",
    {
      regionCode: z.string().optional().describe("Region code"),
      // 가이드 getCloudHadoopAddOnList(세 존 동일): 두 코드 모두 Required — 금융존 테스트에서 clusterTypeCode 가 없어 호출 불가였다.
      cloudHadoopImageProductCode: z.string({ required_error: requiredError("cloudHadoopImageProductCode") }).describe("Cluster image product code (from ncloud_hadoop_list_image_products)"),
      cloudHadoopClusterTypeCode: z.string({ required_error: requiredError("cloudHadoopClusterTypeCode") }).describe("Cluster type code (from ncloud_hadoop_list_cluster_types, e.g. CORE_HADOOP_WITH_SPARK)"),
      engineVersionCode: z.string().optional().describe("Engine version code for Rocky images (latest if omitted). Not in the Financial-zone guide"),
    },
    async (params) => {
      return client.request("/vhadoop/v2/getCloudHadoopAddOnList", params);
    }
  );

  defineTool(
    server,
    "ncloud_hadoop_list_buckets",
    "List Object Storage buckets available for Cloud Hadoop",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopInstanceNo: z.string().optional().describe("Cloud Hadoop instance number"),
    },
    async (params) => {
      return client.request("/vhadoop/v2/getCloudHadoopBucketList", params);
    }
  );

  defineTool(
    server,
    "ncloud_hadoop_list_cluster_types",
    "List available cluster types for a Cloud Hadoop image version",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopImageProductCode: z.string({ required_error: requiredError("cloudHadoopImageProductCode") }).describe("Cluster image product code (from ncloud_hadoop_list_image_products)"),
      engineVersionCode: z.string().optional().describe("Engine version code for Rocky images (latest if omitted). Not in the Financial-zone guide"),
    },
    async (params) => {
      return client.request("/vhadoop/v2/getCloudHadoopClusterTypeList", params);
    }
  );

  defineTool(
    server,
    "ncloud_hadoop_list_image_products",
    "List available Cloud Hadoop image products (engine versions)",
    {
      regionCode: z.string().optional().describe("Region code"),
      productCode: z.string().optional().describe("Image product code to look up"),
      exclusionProductCode: z.string().optional().describe("Image product code to exclude"),
      generationCode: z.string().optional().describe("Server generation filter (e.g. G2). Not in the Government-zone guide"),
    },
    async (params) => {
      return client.request("/vhadoop/v2/getCloudHadoopImageProductList", params);
    }
  );

  defineTool(
    server,
    "ncloud_hadoop_list_login_keys",
    "List login keys available for Cloud Hadoop SSH access",
    {
      regionCode: z.string().optional().describe("Region code"),
    },
    async (params) => {
      return client.request("/vhadoop/v2/getCloudHadoopLoginKeyList", params);
    }
  );

  defineTool(
    server,
    "ncloud_hadoop_list_mysql_instances",
    "List Cloud DB for MySQL instances (in the same VPC as the cluster) usable as the Hive metastore of a Cloud Hadoop cluster",
    {
      regionCode: z.string().optional().describe("Region code"),
      // 가이드 getCloudHadoopMysqlInstanceList: cloudHadoopInstanceNo Required(세 존 동일, 금융존 테스트 E-10).
      cloudHadoopInstanceNo: z.string().describe("Cloud Hadoop instance number (required; see ncloud_hadoop_list_clusters)"),
    },
    async (params) => {
      return client.request("/vhadoop/v2/getCloudHadoopMysqlInstanceList", params);
    }
  );

  defineTool(
    server,
    "ncloud_hadoop_list_mysql_users",
    "List MySQL users (with DDL privilege) usable for Hive metastore integration",
    {
      regionCode: z.string().optional().describe("Region code"),
      // 가이드대로 cloudMysqlInstanceNo 만 받는다(세 존 동일). 2026-10-30 금융·민간존 모두 클러스터 번호 없이 정상 조회.
      // Hive 메타스토어 연동은 MySQL 8.0.x 만 지원 — 8.4 인스턴스는 5001426 으로 거절된다.
      cloudMysqlInstanceNo: z.string().describe("Cloud DB for MySQL instance number (from ncloud_hadoop_list_mysql_instances). Only MySQL 8.0.x instances are supported for Hive metastore integration"),
    },
    async (params) => {
      return client.request("/vhadoop/v2/getCloudHadoopMysqlUserList", params);
    }
  );

  defineTool(
    server,
    "ncloud_hadoop_list_objects",
    "List objects in an Object Storage bucket usable by Cloud Hadoop. Filter with prefix; add delimiter='/' for a directory-style listing (sub-paths are rolled up into commonPrefixList)",
    {
      regionCode: z.string().optional().describe("Region code"),
      // 가이드(세 존 동일): bucketName 필수, 필터는 prefix/delimiter/maxKeys/marker. cloudHadoopInstanceNo·directoryName 은
      // 이 API 의 파라미터가 아니라 무시됐다(금융존 테스트: directoryName 을 줘도 버킷 전체 반환, 더미 instanceNo 통과).
      bucketName: z.string({ required_error: requiredError("bucketName") }).describe("Bucket name (from ncloud_hadoop_list_buckets)"),
      prefix: z.string().optional().describe("Return only objects whose key starts with this prefix (e.g. 'test/')"),
      delimiter: z.string().optional().describe("Roll up keys containing this delimiter after the prefix into commonPrefixList (use '/' for directories)"),
      maxKeys: z.string().optional().describe("Maximum number of objects to return"),
      marker: z.string().optional().describe("List keys after this key (UTF-8 binary order) — for paging"),
    },
    async (params) => {
      return client.request("/vhadoop/v2/getCloudHadoopObjectList", params);
    }
  );

  defineTool(
    server,
    "ncloud_hadoop_list_products",
    "List available server types (specs) for Cloud Hadoop nodes. Use infraResourceDetailTypeCode to separate master/worker (MSTDT) from edge (EDGND) node products",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopImageProductCode: z.string({ required_error: requiredError("cloudHadoopImageProductCode") }).describe("Cluster image product code (from ncloud_hadoop_list_image_products)"),
      infraResourceDetailTypeCode: z.enum(["MSTDT", "EDGND"]).optional().describe("Node type filter: MSTDT = master/worker(data) nodes, EDGND = edge node"),
      zoneCode: z.string().optional().describe("Zone code (see ncloud_get_zones)"),
      productCode: z.string().optional().describe("Server product code to look up"),
      exclusionProductCode: z.string().optional().describe("Server product code to exclude"),
    },
    async (params) => {
      return client.request("/vhadoop/v2/getCloudHadoopProductList", params);
    }
  );

  defineTool(
    server,
    "ncloud_hadoop_list_target_subnets",
    "List subnets available for Cloud Hadoop deployment",
    {
      regionCode: z.string().optional().describe("Region code"),
      // 둘 다 API 필수값이다. 빠지면 900 "Required field is not specified"로 거절된다(B-7).
      // zoneCode는 이 API의 파라미터가 아니어서 보내도 무시됐다 — 제거했다.
      vpcNo: z.string().describe("VPC number (from ncloud_hadoop_list_target_vpcs)"),
      cloudHadoopImageProductCode: z.string().describe("Cluster image product code (from ncloud_hadoop_list_image_products)"),
      isPublic: z.boolean().optional().describe("true: public subnets only, false: private subnets only"),
    },
    async (params) => {
      return client.request("/vhadoop/v2/getCloudHadoopTargetSubnetList", params);
    }
  );

  defineTool(
    server,
    "ncloud_hadoop_list_target_vpcs",
    "List VPCs available for Cloud Hadoop deployment",
    {
      regionCode: z.string().optional().describe("Region code"),
    },
    async (params) => {
      return client.request("/vhadoop/v2/getCloudHadoopTargetVpcList", params);
    }
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Clusters — Hive Metastore Tools
  // ═══════════════════════════════════════════════════════════════════════

  defineTool(
    server,
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
      return client.request("/vhadoop/v2/testConnectExternalHiveMetaStore", params);
    }
  );

  defineTool(
    server,
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
      return client.request("/vhadoop/v2/saveExternalHiveMetaStore", params);
    }
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Clusters — Backup Tool
  // ═══════════════════════════════════════════════════════════════════════

  defineTool(
    server,
    "ncloud_hadoop_backup_config",
    "Backup all cluster component configurations to Object Storage bucket",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopInstanceNo: z.string().describe("Cloud Hadoop instance number"),
    },
    async (params) => {
      return client.request("/vhadoop/v2/backupClusterConfiguration", params);
    }
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Clusters — Create / Mutate Tools
  // ═══════════════════════════════════════════════════════════════════════

  defineTool(
    server,
    "ncloud_hadoop_create_cluster",
    "Create a new Cloud Hadoop cluster. HA is mandatory and not configurable: always 2 master nodes and 1 edge node. " +
      "Pass cloudHadoopImageProductCode explicitly — it defaults to the latest image, but the related lookups " +
      "(ncloud_hadoop_list_cluster_types / _list_addons / _list_products / _list_target_subnets) all require it, so the values you pick must come from the same image. " +
      "Use dryRun=true to preview.",
    {
      regionCode: z.string().optional().describe("Region code (see ncloud_get_regions)"),
      cloudHadoopClusterName: hadoopName("cloudHadoopClusterName").describe("Cluster name (3-15 chars: lowercase letters, numbers, '-'; starts with a letter, ends with a letter or number)"),
      cloudHadoopClusterTypeCode: z.string().describe("Cluster type code (use ncloud_hadoop_list_cluster_types)"),
      cloudHadoopImageProductCode: z.string().optional().describe("Image product code (from ncloud_hadoop_list_image_products). Default: latest — explicit value recommended"),
      cloudHadoopAddOnCodeList: z.array(z.string()).optional().describe("Add-on codes (from ncloud_hadoop_list_addons, e.g. PRESTO, HBASE)"),
      useDataCatalog: z.boolean().optional().describe("Public zone only: use Data Catalog for the Hive metastore (default: false)"),
      useKdc: z.boolean().optional().describe("Use Kerberos KDC (default: false)"),
      kdcRealm: z.string().optional().describe("KDC Realm (required when useKdc=true)"),
      kdcPassword: z.string().min(8).max(20).optional().describe("KDC admin password (required when useKdc=true; 8-20 chars, 9-20 in the Government zone)"),
      vpcNo: z.string().describe("VPC number"),
      cloudHadoopAdminUserName: hadoopName("cloudHadoopAdminUserName").describe("Ambari admin user name (3-15 chars: lowercase letters, numbers, '-'; starts with a letter)"),
      cloudHadoopAdminUserPassword: z.string().min(8).max(20).describe("Admin password: 8-20 chars (9-20 in the Government zone) mixing letters, numbers and special characters; must not contain ' \" ₩ / & ` or spaces"),
      bucketName: z.string().describe("Object Storage bucket name"),
      useBootstrapScript: z.boolean().optional().describe("Use bootstrap script (default: false)"),
      bootstrapScript: z.string().optional().describe("Bootstrap script path (required when useBootstrapScript=true)"),
      edgeNodeSubnetNo: z.string().describe("Edge node subnet number"),
      edgeNodeProductCode: z.string().optional().describe("Edge node server type code"),
      masterNodeSubnetNo: z.string().describe("Master node subnet number"),
      masterNodeProductCode: z.string().optional().describe("Master node server type code"),
      masterNodeDataStorageTypeCode: z.string().describe("Master storage type: SSD | HDD (CB2 also in the Public zone)"),
      masterNodeDataStorageSize: hadoopStorageSize("masterNodeDataStorageSize").describe("Master storage GB (100-2000 in 10 GB steps, or 4000, 6000)"),
      workerNodeSubnetNo: z.string().describe("Worker node subnet (private subnet only)"),
      workerNodeProductCode: z.string().optional().describe("Worker node server type code"),
      workerNodeCount: z.number().int().min(2).max(8).optional().describe("Worker node count (2-8, default: 2)"),
      workerNodeDataStorageTypeCode: z.string().describe("Worker storage type: SSD | HDD (CB2 also in the Public zone)"),
      workerNodeDataStorageSize: hadoopStorageSize("workerNodeDataStorageSize").describe("Worker storage GB (100-2000 in 10 GB steps, or 4000, 6000)"),
      loginKeyName: z.string().describe("Login key name for SSH access"),
      engineVersionCode: z.string().optional().describe("Engine version code (for Rocky clusters). Not in the Financial-zone guide"),
      dryRun: z.boolean().optional().default(false).describe("Preview without creating"),
    },
    async (params) => {
      const { dryRun, ...apiParams } = params;
      if (dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: Cloud Hadoop Cluster Creation",
          endpoint: "/vhadoop/v2/createCloudHadoopInstance",
          requestParams: apiParams,
          noun: { ko: "Hadoop 클러스터", en: "Hadoop cluster" },
        });
      }
      const result = await client.request("/vhadoop/v2/createCloudHadoopInstance", apiParams);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_hadoop_change_node_count",
    "Change worker node count in a Cloud Hadoop cluster (add or remove nodes)",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopInstanceNo: z.string().describe("Cloud Hadoop instance number"),
      workerNodeCount: z.number().describe("Target worker node count. Adding is limited per call (Public zone +10, Government/Financial zones +8); removing has no limit"),
    },
    async (params) => {
      return client.request("/vhadoop/v2/changeCloudHadoopNodeCount", params);
    }
  );

  defineTool(
    server,
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
      return client.request("/vhadoop/v2/changeCloudHadoopNodeSpec", params);
    }
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Clusters — Destructive Tools
  // ═══════════════════════════════════════════════════════════════════════

  defineTool(
    server,
    "ncloud_hadoop_delete_cluster",
    "⚠️ Destructive: Permanently delete a Cloud Hadoop cluster. All data will be lost. Set confirm=true to execute.",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopInstanceNo: z.string().describe("Cloud Hadoop instance number to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to execute deletion"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vhadoop/v2/deleteCloudHadoopInstance", apiParams);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete Cloud Hadoop cluster [${params.cloudHadoopInstanceNo}]. All data will be lost.\n\nCall again with confirm=true to proceed.` } }
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Notebooks — Query Tools
  // ═══════════════════════════════════════════════════════════════════════

  defineTool(
    server,
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
      return client.request("/vhadoop/v2/getCloudHadoopNotebookInstanceList", params);
    }
  );

  defineTool(
    server,
    "ncloud_hadoop_get_notebook_detail",
    "Get detailed information about a specific Cloud Hadoop notebook",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopNotebookInstanceNo: z.string().describe("Notebook instance number"),
    },
    async (params) => {
      return client.request("/vhadoop/v2/getCloudHadoopNotebookInstanceDetail", params);
    }
  );

  defineTool(
    server,
    "ncloud_hadoop_list_notebook_buckets",
    "List Object Storage buckets available for Cloud Hadoop notebooks",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopInstanceNo: z.string().optional().describe("Cloud Hadoop instance number"),
    },
    async (params) => {
      return client.request("/vhadoop/v2/getCloudHadoopNotebookBucketList", params);
    }
  );

  defineTool(
    server,
    "ncloud_hadoop_list_notebook_components",
    "List available notebook components (e.g. Jupyter versions)",
    {
      regionCode: z.string().optional().describe("Region code"),
      // 가이드 getCloudHadoopNotebookComponentList(세 존 동일): 노트북 이미지 코드가 Required — 클러스터 이미지 코드 이름으로 보내 호출 불가였다(금융존 테스트).
      cloudHadoopNotebookImageProductCode: z.string({ required_error: requiredError("cloudHadoopNotebookImageProductCode") }).describe("Notebook image product code (from ncloud_hadoop_list_notebook_images)"),
    },
    async (params) => {
      return client.request("/vhadoop/v2/getCloudHadoopNotebookComponentList", params);
    }
  );

  defineTool(
    server,
    "ncloud_hadoop_list_notebook_images",
    "List available notebook image products",
    {
      regionCode: z.string().optional().describe("Region code"),
      productCode: z.string().optional().describe("Image product code to look up"),
      exclusionProductCode: z.string().optional().describe("Image product code to exclude"),
      generationCode: z.string().optional().describe("Server generation filter (e.g. G2). Not in the Government-zone guide"),
    },
    async (params) => {
      return client.request("/vhadoop/v2/getCloudHadoopNotebookImageProductList", params);
    }
  );

  defineTool(
    server,
    "ncloud_hadoop_list_notebook_products",
    "List available server types for notebook nodes",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopNotebookImageProductCode: z.string({ required_error: requiredError("cloudHadoopNotebookImageProductCode") }).describe("Notebook image product code (from ncloud_hadoop_list_notebook_images)"),
      zoneCode: z.string().optional().describe("Zone code (see ncloud_get_zones)"),
      productCode: z.string().optional().describe("Server product code to look up"),
      exclusionProductCode: z.string().optional().describe("Server product code to exclude"),
    },
    async (params) => {
      return client.request("/vhadoop/v2/getCloudHadoopNotebookProductList", params);
    }
  );

  // ═══════════════════════════════════════════════════════════════════════
  // Notebooks — Create / Delete Tools
  // ═══════════════════════════════════════════════════════════════════════

  defineTool(
    server,
    "ncloud_hadoop_create_notebook",
    "Create a Cloud Hadoop notebook instance (a billable server) attached to an existing cluster. Use dryRun=true to preview.",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopNotebookName: hadoopName("cloudHadoopNotebookName").describe("Notebook name (3-15 chars: lowercase letters, numbers, '-'; starts with a letter, ends with a letter or number)"),
      cloudHadoopNotebookComponent: z.string().describe("Notebook component code (use ncloud_hadoop_list_notebook_components)"),
      cloudHadoopNotebookImageProductCode: z.string().optional().describe("Notebook image code (from ncloud_hadoop_list_notebook_images). Default: latest"),
      cloudHadoopInstanceNo: z.string().describe("Cluster instance number to attach"),
      bucketName: z.string().describe("Object Storage bucket name (from ncloud_hadoop_list_notebook_buckets)"),
      notebookNodeSubnetNo: z.string().describe("Notebook node subnet number (from ncloud_hadoop_list_target_subnets)"),
      notebookNodeProductCode: z.string().optional().describe("Notebook node server type code (from ncloud_hadoop_list_notebook_products)"),
      useNotebookBlockStorage: z.boolean().optional().describe("Add block storage (default: false)"),
      notebookNodeDataStorageTypeCode: z.string().optional().describe("Storage type SSD | HDD (CB2 also in the Public zone) — when useNotebookBlockStorage=true"),
      notebookNodeDataStorageSize: hadoopStorageSize("notebookNodeDataStorageSize").optional().describe("Storage GB (100-2000 in 10 GB steps, or 4000, 6000) — required when useNotebookBlockStorage=true"),
      loginKeyName: z.string().describe("Login key name for SSH access"),
      engineVersionCode: z.string().optional().describe("Engine version code (for Rocky). Not in the Financial-zone guide"),
      dryRun: z.boolean().optional().default(false).describe("Preview without creating"),
    },
    async (params) => {
      const { dryRun, ...apiParams } = params;
      if (dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: Cloud Hadoop Notebook Creation",
          endpoint: "/vhadoop/v2/createCloudHadoopNotebookInstance",
          requestParams: apiParams,
          noun: { ko: "Hadoop 노트북", en: "Hadoop notebook" },
        });
      }
      return client.request("/vhadoop/v2/createCloudHadoopNotebookInstance", apiParams);
    }
  );

  defineTool(
    server,
    "ncloud_hadoop_delete_notebook",
    "⚠️ Destructive: Permanently delete a Cloud Hadoop notebook. Set confirm=true to execute.",
    {
      regionCode: z.string().optional().describe("Region code"),
      cloudHadoopNotebookInstanceNo: z.string().describe("Notebook instance number to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to execute deletion"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vhadoop/v2/deleteCloudHadoopNotebookInstance", apiParams);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete notebook [${params.cloudHadoopNotebookInstanceNo}].\n\nCall again with confirm=true to proceed.` } }
  );
}
