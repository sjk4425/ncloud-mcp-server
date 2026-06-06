import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { toolText } from "./_response.js";

/**
 * Cloud Data Streaming Service (CDSS) — Apache Kafka 관리형 서비스
 *
 * Base URL: https://clouddatastreamingservice.apigw.ntruss.com
 * 리전별 경로: /api/v1/ (KR), /api/sgn-v1/ (SGN), /api/jpn-v1/ (JPN)
 */

function getApiPrefix(regionCode: string): string {
  switch (regionCode) {
    case "SGN": return "/api/sgn-v1";
    case "JPN": return "/api/jpn-v1";
    default: return "/api/v1";
  }
}

export function registerCloudDataStreamingTools(server: McpServer, client: NcloudClient): void {
  const regionCode = client.getRegionCode();
  const prefix = getApiPrefix(regionCode);

  // ─── Cluster Query Tools ─────────────────────────────────────────────

  server.tool(
    "ncloud_cdss_list_clusters",
    "List Cloud Data Streaming Service (Kafka) clusters with optional filtering",
    {
      inputText: z.string().optional().describe("Search keyword (partial match on cluster name)"),
      vpcName: z.string().optional().describe("VPC name filter (exact match)"),
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Page size (default: 10)"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {};
        if (params.inputText) body.inputText = params.inputText;
        if (params.vpcName) body.vpcName = params.vpcName;
        if (params.pageNo) body.pageNo = params.pageNo;
        if (params.pageSize) body.pageSize = params.pageSize;
        const result = await client.postRequest(
          `${prefix}/cluster/getClusterInfoList`, body
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_get_cluster_detail",
    "Get detailed information about a specific CDSS (Kafka) cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number from cluster list"),
    },
    async (params) => {
      try {
        const result = await client.postRequest(
          `${prefix}/cluster/getClusterInfoList/${params.serviceGroupInstanceNo}`, {}
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_get_cluster_status",
    "Get health status of a CDSS cluster (broker, zookeeper, CMAK status per node)",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw(
          "GET", `${prefix}/cluster/getClusterStatus/${params.serviceGroupInstanceNo}`
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_get_cluster_acg",
    "Get ACG (Access Control Group) rules for a CDSS cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw(
          "GET", `${prefix}/cluster/getClusterAcgInfo/${params.serviceGroupInstanceNo}`
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_get_certificate",
    "Get TLS certificate used for cluster communication encryption",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw(
          "GET", `${prefix}/cluster/downloadCertificate/${params.serviceGroupInstanceNo}`
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Version & Product Query Tools ───────────────────────────────────

  server.tool(
    "ncloud_cdss_get_kafka_versions",
    "Get available Kafka version list for CDSS cluster creation",
    {},
    async () => {
      try {
        const result = await client.requestRaw(
          "GET", `${prefix}/cluster/getKafkaVersionList`
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_get_node_products",
    "Get available node server types (product codes) for CDSS cluster creation",
    {},
    async () => {
      try {
        const result = await client.requestRaw(
          "GET", `${prefix}/cluster/getNodeProductList`
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_get_os_products",
    "Get available operating system types for CDSS cluster creation",
    {},
    async () => {
      try {
        const result = await client.requestRaw(
          "GET", `${prefix}/cluster/getOsProductList`
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_get_vpc_list",
    "Get available VPC list for CDSS cluster creation",
    {},
    async () => {
      try {
        const result = await client.requestRaw(
          "GET", `${prefix}/cluster/getVpcList`
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_get_subnet_list",
    "Get available subnet list for CDSS cluster creation",
    {
      vpcNo: z.number().optional().describe("VPC number to filter subnets"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string | number | boolean | undefined> = {};
        if (params.vpcNo) queryParams.vpcNo = params.vpcNo;
        const result = await client.requestRaw(
          "GET", `${prefix}/cluster/getSubnetList`, queryParams
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Cluster Create Tool ─────────────────────────────────────────────

  server.tool(
    "ncloud_cdss_create_cluster",
    "Create a new CDSS (Kafka) cluster (G2). Use dryRun=true to preview.",
    {
      clusterName: z.string().describe("Cluster name (3-15 chars, lowercase+numbers+'-')"),
      kafkaVersionCode: z.number().describe("Kafka version code (from get_kafka_versions)"),
      configGroupNo: z.number().describe("Config group number"),
      kafkaManagerUserName: z.string().describe("CMAK access account ID"),
      kafkaManagerUserPassword: z.string().describe("CMAK access account password"),
      softwareProductCode: z.string().describe("OS type code (from get_os_products)"),
      vpcNo: z.number().describe("VPC number"),
      managerNodeSubnetNo: z.number().describe("Manager node subnet number"),
      managerNodeProductCode: z.string().describe("Manager node server type code"),
      brokerNodeSubnetNo: z.number().describe("Broker node subnet number"),
      brokerNodeCount: z.number().describe("Number of broker nodes (3-10)"),
      brokerNodeProductCode: z.string().describe("Broker node server type code"),
      brokerNodeStorageSize: z.number().describe("Broker storage in GB (100-2000, 10GB increment)"),
      dryRun: z.boolean().optional().default(false).describe("Preview without creating"),
    },
    async (params) => {
      try {
        if (params.dryRun) {
          const { dryRun, ...rest } = params;
          return toolText({
            label: "Dry-Run Preview: CDSS Cluster Creation (G2)",
            ...rest,
            message: "No cluster created. Call again with dryRun=false to create.",
          });
        }
        const { dryRun, ...apiParams } = params;
        const result = await client.postRequest(
          `${prefix}/cluster/createCDSSCluster`, apiParams
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Cluster Destructive Tool ────────────────────────────────────────

  server.tool(
    "ncloud_cdss_delete_cluster",
    "⚠️ Destructive: Permanently delete a CDSS (Kafka) cluster. All data will be lost. Set confirm=true to execute.",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number to delete (required)"),
      confirm: z.boolean().optional().default(false).describe("Must be true to execute deletion"),
    },
    async (params) => {
      try {
        if (!params.serviceGroupInstanceNo) {
          return { content: [{ type: "text" as const, text: "Error: serviceGroupInstanceNo is required." }], isError: true };
        }
        if (!params.confirm) {
          return { content: [{ type: "text" as const, text:
            `⚠️ This will permanently delete CDSS cluster [${params.serviceGroupInstanceNo}]. All data will be lost.\n\nTo execute, call again with confirm=true.`
          }] };
        }
        const result = await client.deleteRequest(
          `${prefix}/cluster/deleteCDSSCluster/${params.serviceGroupInstanceNo}`
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Node Management Tools ───────────────────────────────────────────

  server.tool(
    "ncloud_cdss_list_nodes",
    "List all nodes (broker, manager) in a CDSS cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw(
          "GET", `${prefix}/cluster/getClusterNodeList/${params.serviceGroupInstanceNo}`
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_add_nodes",
    "Add broker nodes to a CDSS cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      newBrokerNodeCount: z.number().describe("Number of broker nodes to add (1-10)"),
    },
    async (params) => {
      try {
        const result = await client.postRequest(
          `${prefix}/cluster/changeCountOfBrokerNode/${params.serviceGroupInstanceNo}`,
          { newBrokerNodeCount: params.newBrokerNodeCount }
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_get_broker_info",
    "Get broker node communication info (endpoints, ports) for a CDSS cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw(
          "GET", `${prefix}/cluster/getBrokerInfo/${params.serviceGroupInstanceNo}`
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_get_node_spec",
    "Get current server spec details for nodes in a CDSS cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw(
          "GET", `${prefix}/cluster/getNodeSpecDetail/${params.serviceGroupInstanceNo}`
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_change_node_spec",
    "Change server spec for nodes in a CDSS cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      brokerNodeProductCode: z.string().optional().describe("New broker node product code"),
      managerNodeProductCode: z.string().optional().describe("New manager node product code"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {};
        if (params.brokerNodeProductCode) body.brokerNodeProductCode = params.brokerNodeProductCode;
        if (params.managerNodeProductCode) body.managerNodeProductCode = params.managerNodeProductCode;
        const result = await client.postRequest(
          `${prefix}/cluster/changeSpecNode/${params.serviceGroupInstanceNo}`, body
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Cluster Service Restart Tools ───────────────────────────────────

  server.tool(
    "ncloud_cdss_restart_all_services",
    "Restart all services (Kafka + ZooKeeper + CMAK) in a CDSS cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      try {
        const result = await client.postRequest(
          `${prefix}/cluster/restartAllServices/${params.serviceGroupInstanceNo}`, {}
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_restart_kafka",
    "Restart Kafka and ZooKeeper services in a CDSS cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      try {
        const result = await client.postRequest(
          `${prefix}/cluster/restartKafkaService/${params.serviceGroupInstanceNo}`, {}
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_restart_cmak",
    "Restart CMAK (Cluster Manager for Apache Kafka) in a CDSS cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      try {
        const result = await client.postRequest(
          `${prefix}/cluster/restartCmakService/${params.serviceGroupInstanceNo}`, {}
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_restart_kafka_per_node",
    "Restart Kafka on a specific node in a CDSS cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      computeInstanceNo: z.string().describe("Node compute instance number to restart"),
    },
    async (params) => {
      try {
        const result = await client.postRequest(
          `${prefix}/cluster/restartKafkaServicePerNode/${params.serviceGroupInstanceNo}`,
          { computeInstanceNo: params.computeInstanceNo }
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Public Domain & Endpoint Tools ──────────────────────────────────

  server.tool(
    "ncloud_cdss_enable_public_domain",
    "Enable public domain for CMAK management tool access",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      try {
        const result = await client.postRequest(
          `${prefix}/cluster/enablePublicDomain/${params.serviceGroupInstanceNo}`, {}
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_disable_public_domain",
    "Disable public domain for CMAK management tool access",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      try {
        const result = await client.postRequest(
          `${prefix}/cluster/disablePublicDomain/${params.serviceGroupInstanceNo}`, {}
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_enable_public_endpoint",
    "Enable public endpoint for broker nodes",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      try {
        const result = await client.postRequest(
          `${prefix}/cluster/enableBrokerNodePublicEndpoint/${params.serviceGroupInstanceNo}`, {}
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_disable_public_endpoint",
    "Disable public endpoint for broker nodes",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      try {
        const result = await client.postRequest(
          `${prefix}/cluster/disableBrokerNodePublicEndpoint/${params.serviceGroupInstanceNo}`, {}
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_reset_cmak_password",
    "Reset CMAK access account password for a CDSS cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      kafkaManagerUserPassword: z.string().describe("New CMAK password (8-20 chars, letters+numbers+special)"),
    },
    async (params) => {
      try {
        const result = await client.postRequest(
          `${prefix}/cluster/resetCmakPassword/${params.serviceGroupInstanceNo}`,
          { kafkaManagerUserPassword: params.kafkaManagerUserPassword }
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Monitoring Tools ────────────────────────────────────────────────

  server.tool(
    "ncloud_cdss_get_monitoring",
    "Get monitoring metrics for a CDSS cluster and its nodes",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      startTime: z.string().optional().describe("Start time (ISO 8601 format)"),
      endTime: z.string().optional().describe("End time (ISO 8601 format)"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {
          serviceGroupInstanceNo: params.serviceGroupInstanceNo,
        };
        if (params.startTime) body.startTime = params.startTime;
        if (params.endTime) body.endTime = params.endTime;
        const result = await client.postRequest(
          `${prefix}/monitoring/getMonitoringData`, body
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_get_os_monitoring",
    "Get OS-level monitoring metrics (CPU, memory, disk) for CDSS cluster nodes",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      startTime: z.string().optional().describe("Start time (ISO 8601 format)"),
      endTime: z.string().optional().describe("End time (ISO 8601 format)"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {
          serviceGroupInstanceNo: params.serviceGroupInstanceNo,
        };
        if (params.startTime) body.startTime = params.startTime;
        if (params.endTime) body.endTime = params.endTime;
        const result = await client.postRequest(
          `${prefix}/monitoring/getOsMonitoringData`, body
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Config Group Tools ──────────────────────────────────────────────

  server.tool(
    "ncloud_cdss_list_config_groups",
    "List Config Groups for CDSS (Kafka configuration templates)",
    {
      kafkaVersionCode: z.string().optional().describe("Filter by Kafka version code"),
    },
    async (params) => {
      try {
        const queryParams: Record<string, string | number | boolean | undefined> = {};
        if (params.kafkaVersionCode) queryParams.kafkaVersionCode = params.kafkaVersionCode;
        const result = await client.requestRaw(
          "GET", `${prefix}/configGroup/getConfigGroupList`, queryParams
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_get_config_group_detail",
    "Get Config Group details including Kafka settings",
    {
      configGroupNo: z.string().describe("Config group number"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw(
          "GET", `${prefix}/configGroup/getConfigGroupDetail/${params.configGroupNo}`
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_get_kafka_config",
    "Get Kafka configuration settings for a Config Group",
    {
      configGroupNo: z.string().describe("Config group number"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw(
          "GET", `${prefix}/configGroup/getKafkaConfig/${params.configGroupNo}`
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_create_config_group",
    "Create a new Config Group for CDSS cluster configuration",
    {
      configGroupName: z.string().describe("Config group name"),
      kafkaVersionCode: z.string().describe("Kafka version code"),
      description: z.string().optional().describe("Config group description"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {
          configGroupName: params.configGroupName,
          kafkaVersionCode: params.kafkaVersionCode,
        };
        if (params.description) body.description = params.description;
        const result = await client.postRequest(
          `${prefix}/configGroup/createConfigGroup`, body
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_apply_config_group",
    "Apply a Config Group to a CDSS cluster",
    {
      configGroupNo: z.string().describe("Config group number to apply"),
      serviceGroupInstanceNo: z.string().describe("Target cluster instance number"),
    },
    async (params) => {
      try {
        const result = await client.postRequest(
          `${prefix}/configGroup/applyConfigGroup/${params.configGroupNo}`,
          { serviceGroupInstanceNo: params.serviceGroupInstanceNo }
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_change_kafka_config",
    "Change Kafka configuration settings in a Config Group",
    {
      configGroupNo: z.string().describe("Config group number"),
      kafkaConfig: z.record(z.string()).describe("Kafka config key-value pairs to change"),
    },
    async (params) => {
      try {
        const result = await client.putRequest(
          `${prefix}/configGroup/changeKafkaConfig/${params.configGroupNo}`,
          { kafkaConfig: params.kafkaConfig }
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_delete_config_group",
    "⚠️ Destructive: Delete a Config Group. Set confirm=true to execute.",
    {
      configGroupNo: z.string().describe("Config group number to delete (required)"),
      confirm: z.boolean().optional().default(false).describe("Must be true to execute deletion"),
    },
    async (params) => {
      try {
        if (!params.configGroupNo) {
          return { content: [{ type: "text" as const, text: "Error: configGroupNo is required." }], isError: true };
        }
        if (!params.confirm) {
          return { content: [{ type: "text" as const, text:
            `⚠️ This will delete Config Group [${params.configGroupNo}].\n\nTo execute, call again with confirm=true.`
          }] };
        }
        const result = await client.deleteRequest(
          `${prefix}/configGroup/deleteConfigGroup/${params.configGroupNo}`
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Rolling Restart & Upgrade Tools ──────────────────────────────────

  server.tool(
    "ncloud_cdss_rolling_restart",
    "Perform a rolling restart of all nodes in a CDSS cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      try {
        const result = await client.postRequest(
          `${prefix}/cluster/rollingRestart/${params.serviceGroupInstanceNo}`, {}
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_rolling_restart_precheck",
    "Pre-check before performing a rolling restart",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      try {
        const result = await client.postRequest(
          `${prefix}/cluster/rollingRestartPreCheck/${params.serviceGroupInstanceNo}`, {}
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_rolling_restart_status",
    "Get the progress status of a rolling restart operation",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw(
          "GET", `${prefix}/cluster/rollingRestartProgressCheck/${params.serviceGroupInstanceNo}`
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_upgrade_version",
    "Upgrade Kafka version for a CDSS cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      kafkaVersionCode: z.string().describe("Target Kafka version code"),
      configGroupNo: z.string().optional().describe("Config group number for the new version"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {
          kafkaVersionCode: params.kafkaVersionCode,
        };
        if (params.configGroupNo) body.configGroupNo = params.configGroupNo;
        const result = await client.postRequest(
          `${prefix}/cluster/rollingUpgrade/${params.serviceGroupInstanceNo}`, body
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_upgrade_precheck",
    "Pre-check before upgrading Kafka version",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      kafkaVersionCode: z.string().describe("Target Kafka version code"),
      configGroupNo: z.string().optional().describe("Config group number for the new version"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {
          kafkaVersionCode: params.kafkaVersionCode,
        };
        if (params.configGroupNo) body.configGroupNo = params.configGroupNo;
        const result = await client.postRequest(
          `${prefix}/cluster/rollingUpgradePreCheck/${params.serviceGroupInstanceNo}`, body
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_upgrade_status",
    "Get the progress status of a version upgrade operation",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw(
          "GET", `${prefix}/cluster/rollingUpgradeProgressCheck/${params.serviceGroupInstanceNo}`
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Server Generation & G3 Tools ───────────────────────────────────

  server.tool(
    "ncloud_cdss_get_server_generations",
    "Get available server generations (hypervisor types) for CDSS",
    {},
    async () => {
      try {
        const result = await client.requestRaw(
          "GET", `${prefix}/cluster/getServerGenerationList`
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_get_server_spec_list",
    "Get available server specs for CDSS (G3/KVM)",
    {},
    async () => {
      try {
        const result = await client.requestRaw(
          "GET", `${prefix}/cluster/getServerSpecList`
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_cdss_get_cluster_server_images",
    "Get available OS images for CDSS (G3/KVM)",
    {},
    async () => {
      try {
        const result = await client.requestRaw(
          "GET", `${prefix}/cluster/getClusterServerImageList`
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Load Balancer Query Tool ────────────────────────────────────────

  server.tool(
    "ncloud_cdss_get_load_balancers",
    "Get available load balancers for CDSS broker node public endpoint",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      try {
        const result = await client.requestRaw(
          "GET", `${prefix}/cluster/getLoadBalancerInstanceList/${params.serviceGroupInstanceNo}`
        );
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
