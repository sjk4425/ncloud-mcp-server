import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";

// Cloud Insight Plugin / Custom Resource / Schema / Planned Maintenance APIs
// Base: https://cw.apigw.ntruss.com. 경로/메서드/필드는 공식 docs(management-cloudinsight-*) 기준.
//   - Plugin(process/port/file):  prefix /cw_server/real/api/plugin/...
//   - Custom Resource / Schema / Planned Maintenance:  prefix /cw_fea/real/cw/api/...
const CW_SERVER = "/cw_server/real/api/plugin";
const CW = "/cw_fea/real/cw/api";

const targetType = z
  .enum(["vpcserver", "classicserver", "cloudhadoop"])
  .optional()
  .describe("Target type (default 'vpcserver')");

export function registerCloudInsightPluginTools(server: McpServer, client: NcloudClient): void {
  // ─── Process plugin ─────────────────────────────────────────────────────
  defineTool(
    server,
    "ncloud_list_process_plugins",
    "Get the full list of Cloud Insight process monitoring plugins.",
    {},
    async () => {
      return client.requestRaw("GET", `${CW_SERVER}/process`);
    }
  );

  defineTool(
    server,
    "ncloud_get_process_plugin",
    "Get process monitoring plugin configuration for a specific server instance.",
    { instanceNo: z.string().describe("Server instance number") },
    async (params) => {
      return client.requestRaw("GET", `${CW_SERVER}/process/instanceNo/${params.instanceNo}`);
    }
  );

  defineTool(
    server,
    "ncloud_add_process_plugin",
    "Add process monitoring plugin(s) to a server instance. Provide one or more process names (wildcards like *abc* allowed).",
    {
      instanceNo: z.string().describe("Server instance number"),
      configList: z.array(z.string()).min(1).describe("Process names to monitor"),
      type: targetType,
    },
    async (params) => {
      const body: Record<string, unknown> = { instanceNo: params.instanceNo, configList: params.configList };
      if (params.type !== undefined) body.type = params.type;
      const result = await client.postRequest(`${CW_SERVER}/process/add`, body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_remove_process_plugin",
    "⚠️ Destructive: Remove process monitoring plugin(s) from a server instance. Set confirm=true to execute.",
    {
      instanceNo: z.string().describe("Server instance number"),
      configList: z.array(z.string()).min(1).describe("Process names to remove"),
      type: targetType,
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      if (!params.confirm) {
        return { content: [{ type: "text" as const, text: `⚠️ This will remove process plugins [${params.configList.join(", ")}] from instance [${params.instanceNo}]. To execute, call again with confirm=true.` }] };
      }
      const body: Record<string, unknown> = { instanceNo: params.instanceNo, configList: params.configList };
      if (params.type !== undefined) body.type = params.type;
      const result = await client.postRequest(`${CW_SERVER}/process/remove`, body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_set_process_plugins",
    "Replace the full set of process monitoring plugins for a server instance (sends the entire list).",
    {
      instanceNo: z.string().describe("Server instance number"),
      configList: z.array(z.string()).describe("Full list of process names to monitor (replaces existing)"),
      type: targetType,
    },
    async (params) => {
      const body: Record<string, unknown> = { instanceNo: params.instanceNo, configList: params.configList };
      if (params.type !== undefined) body.type = params.type;
      const result = await client.postRequest(`${CW_SERVER}/process`, body);
      return result;
    }
  );

  // ─── Port plugin ────────────────────────────────────────────────────────
  defineTool(
    server,
    "ncloud_list_port_plugins",
    "Get the full list of Cloud Insight port monitoring plugins.",
    {},
    async () => {
      return client.requestRaw("GET", `${CW_SERVER}/port`);
    }
  );

  defineTool(
    server,
    "ncloud_get_port_plugin",
    "Get port monitoring plugin configuration for a specific server instance.",
    { instanceNo: z.string().describe("Server instance number") },
    async (params) => {
      return client.requestRaw("GET", `${CW_SERVER}/port/instanceNo/${params.instanceNo}`);
    }
  );

  defineTool(
    server,
    "ncloud_add_port_plugin",
    "Add port monitoring plugin(s) to a server instance.",
    {
      instanceNo: z.string().describe("Server instance number"),
      portList: z.array(z.number()).min(1).describe("Port numbers to monitor"),
      type: targetType,
    },
    async (params) => {
      const body: Record<string, unknown> = { instanceNo: params.instanceNo, portList: params.portList };
      if (params.type !== undefined) body.type = params.type;
      const result = await client.postRequest(`${CW_SERVER}/port/add`, body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_remove_port_plugin",
    "⚠️ Destructive: Remove port monitoring plugin(s) from a server instance. Set confirm=true to execute.",
    {
      instanceNo: z.string().describe("Server instance number"),
      portList: z.array(z.number()).min(1).describe("Port numbers to remove"),
      type: targetType,
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      if (!params.confirm) {
        return { content: [{ type: "text" as const, text: `⚠️ This will remove port plugins [${params.portList.join(", ")}] from instance [${params.instanceNo}]. To execute, call again with confirm=true.` }] };
      }
      const body: Record<string, unknown> = { instanceNo: params.instanceNo, portList: params.portList };
      if (params.type !== undefined) body.type = params.type;
      const result = await client.postRequest(`${CW_SERVER}/port/remove`, body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_set_port_plugins",
    "Replace the full set of port monitoring plugins for a server instance (sends the entire list).",
    {
      instanceNo: z.string().describe("Server instance number"),
      portList: z.array(z.number()).describe("Full list of port numbers to monitor (replaces existing)"),
      type: targetType,
    },
    async (params) => {
      const body: Record<string, unknown> = { instanceNo: params.instanceNo, portList: params.portList };
      if (params.type !== undefined) body.type = params.type;
      const result = await client.postRequest(`${CW_SERVER}/port`, body);
      return result;
    }
  );

  // ─── File plugin ────────────────────────────────────────────────────────
  defineTool(
    server,
    "ncloud_list_file_plugins",
    "Get the full list of Cloud Insight file monitoring plugins.",
    {},
    async () => {
      return client.requestRaw("GET", `${CW_SERVER}/file`);
    }
  );

  defineTool(
    server,
    "ncloud_get_file_plugin",
    "Get file monitoring plugin configuration for a specific server instance.",
    { instanceNo: z.string().describe("Server instance number") },
    async (params) => {
      return client.requestRaw("GET", `${CW_SERVER}/file/instanceNo/${params.instanceNo}`);
    }
  );

  defineTool(
    server,
    "ncloud_add_file_plugin",
    "Add file monitoring plugin(s) to a server instance.",
    {
      instanceNo: z.string().describe("Server instance number"),
      configList: z.array(z.string()).min(1).describe("File paths to monitor"),
      type: targetType,
    },
    async (params) => {
      const body: Record<string, unknown> = { instanceNo: params.instanceNo, configList: params.configList };
      if (params.type !== undefined) body.type = params.type;
      const result = await client.postRequest(`${CW_SERVER}/file/add`, body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_remove_file_plugin",
    "⚠️ Destructive: Remove file monitoring plugin(s) from a server instance. Set confirm=true to execute.",
    {
      instanceNo: z.string().describe("Server instance number"),
      configList: z.array(z.string()).min(1).describe("File paths to remove"),
      type: targetType,
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      if (!params.confirm) {
        return { content: [{ type: "text" as const, text: `⚠️ This will remove file plugins [${params.configList.join(", ")}] from instance [${params.instanceNo}]. To execute, call again with confirm=true.` }] };
      }
      const body: Record<string, unknown> = { instanceNo: params.instanceNo, configList: params.configList };
      if (params.type !== undefined) body.type = params.type;
      const result = await client.postRequest(`${CW_SERVER}/file/remove`, body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_set_file_plugins",
    "Replace the full set of file monitoring plugins for a server instance (sends the entire list).",
    {
      instanceNo: z.string().describe("Server instance number"),
      configList: z.array(z.string()).describe("Full list of file paths to monitor (replaces existing)"),
      type: targetType,
    },
    async (params) => {
      const body: Record<string, unknown> = { instanceNo: params.instanceNo, configList: params.configList };
      if (params.type !== undefined) body.type = params.type;
      const result = await client.postRequest(`${CW_SERVER}/file`, body);
      return result;
    }
  );

  // ─── Custom Resource ────────────────────────────────────────────────────
  defineTool(
    server,
    "ncloud_list_custom_resources",
    "Get the list of user-defined custom resources in Cloud Insight.",
    {
      resourceTypeId: z.string().optional().describe("Resource type ID (default 'DEFAULT')"),
      query: z.string().optional().describe("Filter keyword"),
    },
    async (params) => {
      const q: Record<string, string> = {};
      if (params.resourceTypeId !== undefined) q.resourceTypeId = params.resourceTypeId;
      if (params.query !== undefined) q.query = params.query;
      const result = await client.requestRaw("GET", `${CW}/custom/resource/list`, q);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_get_custom_resource",
    "Get detailed information about a specific custom resource in Cloud Insight.",
    { resourceId: z.string().describe("Custom resource ID") },
    async (params) => {
      return client.requestRaw("GET", `${CW}/custom/resource/${params.resourceId}`);
    }
  );

  defineTool(
    server,
    "ncloud_create_custom_resource",
    "Create a user-defined custom resource in Cloud Insight.",
    {
      resourceName: z.string().describe("Name of the custom resource"),
      resourceData: z
        .object({
          organizationCode: z.string().describe("Organization code"),
          projectId: z.string().describe("Project ID"),
          serverIp: z.string().describe("Server IP"),
          serverType: z.string().describe("Server type"),
          serverName: z.string().optional().describe("Server name"),
        })
        .describe("Resource data"),
      resourceTypeId: z.string().optional().describe("Resource type ID (default 'DEFAULT')"),
      resourceId: z.string().optional().describe("Resource ID (auto-generated if omitted)"),
    },
    async (params) => {
      const body: Record<string, unknown> = { resourceName: params.resourceName, resourceData: params.resourceData };
      if (params.resourceTypeId !== undefined) body.resourceTypeId = params.resourceTypeId;
      if (params.resourceId !== undefined) body.resourceId = params.resourceId;
      const result = await client.postRequest(`${CW}/custom/resource`, body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_update_custom_resource",
    "Update a user-defined custom resource in Cloud Insight.",
    {
      resourceId: z.string().describe("Custom resource ID to update"),
      resourceName: z.string().describe("Name of the custom resource"),
      resourceData: z
        .object({
          organizationCode: z.string().describe("Organization code"),
          projectId: z.string().describe("Project ID"),
          serverIp: z.string().describe("Server IP"),
          serverType: z.string().describe("Server type"),
          serverName: z.string().optional().describe("Server name"),
        })
        .describe("Resource data"),
    },
    async (params) => {
      const body = { resourceName: params.resourceName, resourceData: params.resourceData };
      const result = await client.putRequest(`${CW}/custom/resource/${params.resourceId}`, body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_delete_custom_resource",
    "⚠️ Destructive: Delete a user-defined custom resource from Cloud Insight. Set confirm=true to execute.",
    {
      resourceId: z.string().describe("Custom resource ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      if (!params.confirm) {
        return { content: [{ type: "text" as const, text: `⚠️ This will permanently delete custom resource [${params.resourceId}]. To execute, call again with confirm=true.` }] };
      }
      const result = await client.requestRaw("DELETE", `${CW}/custom/resource/${params.resourceId}`);
      return result;
    }
  );

  // ─── Schema ─────────────────────────────────────────────────────────────
  defineTool(
    server,
    "ncloud_get_schema_keys",
    "Get the list of system schema product keys (cw_key) available in Cloud Insight.",
    {},
    async () => {
      return client.requestRaw("GET", `${CW}/schema/system/list`);
    }
  );

  defineTool(
    server,
    "ncloud_get_product_schema",
    "Get the schema definition for a specific product in Cloud Insight (metrics and dimensions).",
    {
      prodName: z.string().describe("Product name to get schema for"),
      cw_key: z.string().optional().describe("Product key (cw_key) for custom schema"),
    },
    async (params) => {
      const q: Record<string, string> = { prodName: params.prodName };
      if (params.cw_key !== undefined) q.cw_key = params.cw_key;
      const result = await client.requestRaw("GET", `${CW}/schema`, q);
      return result;
    }
  );

  const schemaField = z.object({
    fieldName: z.string().describe("Field name"),
    fieldType: z.enum(["STRING", "INTEGER", "LONG", "FLOAT"]).describe("Field data type"),
    dimension: z.boolean().optional().describe("Whether this field is a dimension"),
  });

  defineTool(
    server,
    "ncloud_create_custom_schema",
    "Create a user-defined custom schema in Cloud Insight for custom metrics.",
    {
      prodName: z.array(z.string()).describe("Product name(s) for the custom schema"),
      fields: z.array(schemaField).describe("Schema field definitions"),
      useCustomResource: z.boolean().optional().describe("Whether to use custom resource (default false)"),
    },
    async (params) => {
      const body: Record<string, unknown> = { prodName: params.prodName, fields: params.fields };
      if (params.useCustomResource !== undefined) body.useCustomResource = params.useCustomResource;
      const result = await client.postRequest(`${CW}/schema`, body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_update_product_schema",
    "Update a user-defined custom schema in Cloud Insight.",
    {
      prodName: z.string().describe("Product name of the schema to update"),
      cw_key: z.string().describe("Product key (cw_key) of the schema to update"),
      fields: z.array(schemaField).describe("Updated schema field definitions"),
    },
    async (params) => {
      const body = { prodName: params.prodName, cw_key: params.cw_key, fields: params.fields };
      const result = await client.putRequest(`${CW}/schema`, body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_delete_product_schema",
    "⚠️ Destructive: Delete a user-defined custom schema from Cloud Insight. Set confirm=true to execute.",
    {
      prodName: z.string().describe("Product name of the schema to delete"),
      cw_key: z.string().describe("Product key (cw_key) of the schema to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      if (!params.confirm) {
        return { content: [{ type: "text" as const, text: `⚠️ This will permanently delete custom schema [${params.prodName} / ${params.cw_key}]. To execute, call again with confirm=true.` }] };
      }
      const result = await client.requestRaw("DELETE", `${CW}/schema`, { cw_key: params.cw_key, prodName: params.prodName });
      return result;
    }
  );

  // ─── Extended metric ─────────────────────────────────────────────────────
  defineTool(
    server,
    "ncloud_get_extended_status",
    "Get the Extended Metric collection status for servers in Cloud Insight.",
    {
      prodKey: z.string().describe("Product key (cw_key)"),
      servers: z.array(z.string()).describe("Server instance numbers to check"),
    },
    async (params) => {
      const body = { prodKey: params.prodKey, servers: params.servers };
      const result = await client.postRequest(`${CW}/schema/extended/status`, body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_update_extended_enable",
    "Enable Extended Metric collection for instances in Cloud Insight.",
    {
      cw_key: z.string().describe("Product key (cw_key)"),
      instanceIds: z.string().describe("Comma-separated server instance numbers"),
    },
    async (params) => {
      return client.requestRaw("PUT", `${CW}/schema/extended/enable`, { cw_key: params.cw_key, instanceIds: params.instanceIds });
    }
  );

  defineTool(
    server,
    "ncloud_update_extended_disable",
    "Disable Extended Metric collection for instances in Cloud Insight.",
    {
      cw_key: z.string().describe("Product key (cw_key)"),
      instanceIds: z.string().describe("Comma-separated server instance numbers"),
    },
    async (params) => {
      return client.requestRaw("PUT", `${CW}/schema/extended/disable`, { cw_key: params.cw_key, instanceIds: params.instanceIds });
    }
  );

  // ─── Planned Maintenance ─────────────────────────────────────────────────
  defineTool(
    server,
    "ncloud_list_maintenances",
    "Get the list of planned maintenance schedules in Cloud Insight (paged). The API requires a filter: either a time range (from/to/timeType) OR a resource (resourceId+productKey). If none is given, a default ±180-day window by startTime is applied.",
    {
      pageNum: z.number().optional().default(1).describe("Page number (>= 1)"),
      pageSize: z.number().optional().default(100).describe("Page size (>= 1)"),
      from: z.number().optional().describe("Filter start (epoch ms), used with 'to' and 'timeType'"),
      to: z.number().optional().describe("Filter end (epoch ms)"),
      timeType: z.enum(["startTime", "endTime"]).optional().describe("Which time the from/to filter applies to (default startTime)"),
      resourceId: z.string().optional().describe("Filter by resource ID (use together with productKey instead of a time range)"),
      productKey: z.string().optional().describe("Filter by product key (use together with resourceId)"),
    },
    async (params) => {
      const q: Record<string, string | number> = { pageNum: params.pageNum ?? 1, pageSize: params.pageSize ?? 100 };
      if (params.resourceId !== undefined && params.productKey !== undefined) {
        // 리소스 필터 모드
        q.resourceId = params.resourceId;
        q.productKey = params.productKey;
      } else {
        // 시간범위 필터 모드 — 미지정 시 ±180일 기본창 주입(API가 필터를 요구하므로 무인자 400 방지)
        const DAY = 86_400_000;
        q.from = params.from ?? Date.now() - 180 * DAY;
        q.to = params.to ?? Date.now() + 180 * DAY;
        q.timeType = params.timeType ?? "startTime";
      }
      const result = await client.requestRaw("GET", `${CW}/planned-maintenances`, q);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_get_maintenance_detail",
    "Get detailed information about a specific planned maintenance schedule.",
    { maintenanceId: z.string().describe("Planned maintenance ID") },
    async (params) => {
      return client.requestRaw("GET", `${CW}/planned-maintenances/${params.maintenanceId}`);
    }
  );

  defineTool(
    server,
    "ncloud_create_maintenance",
    "Create a new planned maintenance schedule in Cloud Insight.",
    {
      title: z.string().describe("Maintenance title"),
      startTime: z.number().describe("Start time in Unix epoch milliseconds"),
      endTime: z.number().describe("End time in Unix epoch milliseconds"),
      dimensions: z.record(z.unknown()).describe("Target dimensions (resource identifiers)"),
      desc: z.string().optional().describe("Maintenance description"),
    },
    async (params) => {
      const body: Record<string, unknown> = {
        title: params.title,
        startTime: params.startTime,
        endTime: params.endTime,
        dimensions: params.dimensions,
      };
      if (params.desc !== undefined) body.desc = params.desc;
      const result = await client.postRequest(`${CW}/planned-maintenances`, body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_update_maintenance",
    "Update an existing planned maintenance schedule in Cloud Insight.",
    {
      maintenanceId: z.string().describe("Planned maintenance ID to update"),
      title: z.string().optional().describe("Maintenance title"),
      startTime: z.number().optional().describe("Start time in Unix epoch milliseconds"),
      endTime: z.number().optional().describe("End time in Unix epoch milliseconds"),
      dimensions: z.record(z.unknown()).optional().describe("Target dimensions"),
      desc: z.string().optional().describe("Maintenance description"),
    },
    async (params) => {
      const body: Record<string, unknown> = {};
      if (params.title !== undefined) body.title = params.title;
      if (params.startTime !== undefined) body.startTime = params.startTime;
      if (params.endTime !== undefined) body.endTime = params.endTime;
      if (params.dimensions !== undefined) body.dimensions = params.dimensions;
      if (params.desc !== undefined) body.desc = params.desc;
      const result = await client.putRequest(`${CW}/planned-maintenances/${params.maintenanceId}`, body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_delete_maintenance",
    "⚠️ Destructive: Delete a planned maintenance schedule from Cloud Insight. Set confirm=true to execute.",
    {
      maintenanceId: z.string().describe("Planned maintenance ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      if (!params.confirm) {
        return { content: [{ type: "text" as const, text: `⚠️ This will permanently delete maintenance schedule [${params.maintenanceId}]. To execute, call again with confirm=true.` }] };
      }
      const result = await client.requestRaw("DELETE", `${CW}/planned-maintenances/${params.maintenanceId}`);
      return result;
    }
  );
}
