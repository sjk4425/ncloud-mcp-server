import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { toolText } from "./_response.js";

export function registerCloudInsightPluginTools(server: McpServer, client: NcloudClient): void {
  // --- Plugin Tools ---

  // ncloud_list_process_plugins — Get process plugin list
  server.tool(
    "ncloud_list_process_plugins",
    "Get the list of Cloud Insight process monitoring plugins.",
    {
      instanceNo: z.string().optional().describe("Server instance number to filter plugins"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {};
        if (params.instanceNo !== undefined) body.instanceNo = params.instanceNo;

        const result = await client.postRequest("/cw_fea/real/cw/api/plugin/process", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_add_process_plugin — Add a process monitoring plugin
  server.tool(
    "ncloud_add_process_plugin",
    "Add a process monitoring plugin to Cloud Insight for monitoring specific processes on a server.",
    {
      instanceNo: z.string().describe("Server instance number to add the plugin to"),
      processName: z.string().describe("Name of the process to monitor"),
    },
    async (params) => {
      try {
        const body = {
          instanceNo: params.instanceNo,
          processName: params.processName,
        };

        const result = await client.postRequest("/cw_fea/real/cw/api/plugin/process/add", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_remove_process_plugin — Remove a process monitoring plugin
  server.tool(
    "ncloud_remove_process_plugin",
    "⚠️ Destructive: Remove a process monitoring plugin from Cloud Insight.",
    {
      instanceNo: z.string().describe("Server instance number"),
      processName: z.string().describe("Name of the process plugin to remove"),
      confirm: z.boolean().optional().describe("Must be true to execute deletion. If false or omitted, returns a confirmation prompt."),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          return {
            content: [{
              type: "text" as const,
              text: `⚠️ This will permanently remove process plugin [${params.processName}] from instance [${params.instanceNo}]. Do you want to proceed? (yes/no)\n\nTo confirm, call this tool again with confirm=true.`,
            }],
          };
        }

        const body = {
          instanceNo: params.instanceNo,
          processName: params.processName,
        };

        const result = await client.postRequest("/cw_fea/real/cw/api/plugin/process/remove", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_list_port_plugins — Get port plugin list
  server.tool(
    "ncloud_list_port_plugins",
    "Get the list of Cloud Insight port monitoring plugins.",
    {
      instanceNo: z.string().optional().describe("Server instance number to filter plugins"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {};
        if (params.instanceNo !== undefined) body.instanceNo = params.instanceNo;

        const result = await client.postRequest("/cw_fea/real/cw/api/plugin/port", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_add_port_plugin — Add a port monitoring plugin
  server.tool(
    "ncloud_add_port_plugin",
    "Add a port monitoring plugin to Cloud Insight for monitoring specific ports on a server.",
    {
      instanceNo: z.string().describe("Server instance number to add the plugin to"),
      portNumber: z.number().describe("Port number to monitor"),
    },
    async (params) => {
      try {
        const body = {
          instanceNo: params.instanceNo,
          portNumber: params.portNumber,
        };

        const result = await client.postRequest("/cw_fea/real/cw/api/plugin/port/add", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_remove_port_plugin — Remove a port monitoring plugin
  server.tool(
    "ncloud_remove_port_plugin",
    "⚠️ Destructive: Remove a port monitoring plugin from Cloud Insight.",
    {
      instanceNo: z.string().describe("Server instance number"),
      portNumber: z.number().describe("Port number of the plugin to remove"),
      confirm: z.boolean().optional().describe("Must be true to execute deletion. If false or omitted, returns a confirmation prompt."),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          return {
            content: [{
              type: "text" as const,
              text: `⚠️ This will permanently remove port plugin [${params.portNumber}] from instance [${params.instanceNo}]. Do you want to proceed? (yes/no)\n\nTo confirm, call this tool again with confirm=true.`,
            }],
          };
        }

        const body = {
          instanceNo: params.instanceNo,
          portNumber: params.portNumber,
        };

        const result = await client.postRequest("/cw_fea/real/cw/api/plugin/port/remove", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_list_file_plugins — Get file plugin list
  server.tool(
    "ncloud_list_file_plugins",
    "Get the list of Cloud Insight file monitoring plugins.",
    {
      instanceNo: z.string().optional().describe("Server instance number to filter plugins"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {};
        if (params.instanceNo !== undefined) body.instanceNo = params.instanceNo;

        const result = await client.postRequest("/cw_fea/real/cw/api/plugin/file", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_add_file_plugin — Add a file monitoring plugin
  server.tool(
    "ncloud_add_file_plugin",
    "Add a file monitoring plugin to Cloud Insight for monitoring specific file paths on a server.",
    {
      instanceNo: z.string().describe("Server instance number to add the plugin to"),
      filePath: z.string().describe("File path to monitor"),
    },
    async (params) => {
      try {
        const body = {
          instanceNo: params.instanceNo,
          filePath: params.filePath,
        };

        const result = await client.postRequest("/cw_fea/real/cw/api/plugin/file/add", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_remove_file_plugin — Remove a file monitoring plugin
  server.tool(
    "ncloud_remove_file_plugin",
    "⚠️ Destructive: Remove a file monitoring plugin from Cloud Insight.",
    {
      instanceNo: z.string().describe("Server instance number"),
      filePath: z.string().describe("File path of the plugin to remove"),
      confirm: z.boolean().optional().describe("Must be true to execute deletion. If false or omitted, returns a confirmation prompt."),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          return {
            content: [{
              type: "text" as const,
              text: `⚠️ This will permanently remove file plugin [${params.filePath}] from instance [${params.instanceNo}]. Do you want to proceed? (yes/no)\n\nTo confirm, call this tool again with confirm=true.`,
            }],
          };
        }

        const body = {
          instanceNo: params.instanceNo,
          filePath: params.filePath,
        };

        const result = await client.postRequest("/cw_fea/real/cw/api/plugin/file/remove", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // --- Custom Resource Tools ---

  // ncloud_list_custom_resources — Get custom resource list
  server.tool(
    "ncloud_list_custom_resources",
    "Get the list of user-defined custom resources in Cloud Insight.",
    {
      prodKey: z.string().optional().describe("Product key to filter custom resources"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {};
        if (params.prodKey !== undefined) body.prodKey = params.prodKey;

        const result = await client.postRequest("/cw_fea/real/cw/api/custom/resource", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_custom_resource — Get custom resource details
  server.tool(
    "ncloud_get_custom_resource",
    "Get detailed information about a specific user-defined custom resource in Cloud Insight.",
    {
      resourceId: z.string().describe("Custom resource ID to retrieve details for"),
    },
    async (params) => {
      try {
        const body = {
          resourceId: params.resourceId,
        };

        const result = await client.postRequest("/cw_fea/real/cw/api/custom/resource/detail", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_create_custom_resource — Create a custom resource
  server.tool(
    "ncloud_create_custom_resource",
    "Create a user-defined custom resource in Cloud Insight for custom monitoring targets.",
    {
      prodKey: z.string().describe("Product key (cw_key) for the custom schema"),
      resourceName: z.string().describe("Name of the custom resource"),
      dimensions: z.record(z.string()).describe("Dimension key-value pairs identifying the resource"),
    },
    async (params) => {
      try {
        const body = {
          prodKey: params.prodKey,
          resourceName: params.resourceName,
          dimensions: params.dimensions,
        };

        const result = await client.postRequest("/cw_fea/real/cw/api/custom/resource/create", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_delete_custom_resource — Delete a custom resource
  server.tool(
    "ncloud_delete_custom_resource",
    "⚠️ Destructive: Delete a user-defined custom resource from Cloud Insight.",
    {
      resourceId: z.string().describe("Custom resource ID to delete"),
      confirm: z.boolean().optional().describe("Must be true to execute deletion. If false or omitted, returns a confirmation prompt."),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          return {
            content: [{
              type: "text" as const,
              text: `⚠️ This will permanently delete custom resource [${params.resourceId}]. Do you want to proceed? (yes/no)\n\nTo confirm, call this tool again with confirm=true.`,
            }],
          };
        }

        const body = {
          resourceId: params.resourceId,
        };

        const result = await client.postRequest("/cw_fea/real/cw/api/custom/resource/delete", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // --- Schema Tools ---

  // ncloud_get_schema_keys — Get system schema product keys
  server.tool(
    "ncloud_get_schema_keys",
    "Get the list of product keys (cw_key) available in Cloud Insight schema.",
    {},
    async () => {
      try {
        const result = await client.requestRaw("GET", "/cw_fea/real/cw/api/schema/system/list");
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_product_schema — Get product schema details
  server.tool(
    "ncloud_get_product_schema",
    "Get the schema definition for a specific product in Cloud Insight, including available metrics and dimensions.",
    {
      prodKey: z.string().describe("Product key (cw_key) to get schema for"),
    },
    async (params) => {
      try {
        const body = {
          prodKey: params.prodKey,
        };

        const result = await client.postRequest("/cw_fea/real/cw/api/schema", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // --- Plugin Detail/Update Tools ---

  // ncloud_get_process_plugin — Get process plugin for a specific instance
  server.tool(
    "ncloud_get_process_plugin",
    "Get process monitoring plugin details for a specific server instance.",
    {
      instanceNo: z.string().describe("Server instance number"),
    },
    async (params) => {
      try {
        const body = { instanceNo: params.instanceNo };
        const result = await client.postRequest("/cw_fea/real/cw/api/plugin/process/instance", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_port_plugin — Get port plugin for a specific instance
  server.tool(
    "ncloud_get_port_plugin",
    "Get port monitoring plugin details for a specific server instance.",
    {
      instanceNo: z.string().describe("Server instance number"),
    },
    async (params) => {
      try {
        const body = { instanceNo: params.instanceNo };
        const result = await client.postRequest("/cw_fea/real/cw/api/plugin/port/instance", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_file_plugin — Get file plugin for a specific instance
  server.tool(
    "ncloud_get_file_plugin",
    "Get file monitoring plugin details for a specific server instance.",
    {
      instanceNo: z.string().describe("Server instance number"),
    },
    async (params) => {
      try {
        const body = { instanceNo: params.instanceNo };
        const result = await client.postRequest("/cw_fea/real/cw/api/plugin/file/instance", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_update_process_plugin — Update process plugin settings
  server.tool(
    "ncloud_update_process_plugin",
    "Update process monitoring plugin settings in Cloud Insight.",
    {
      instanceNo: z.string().describe("Server instance number"),
      processName: z.string().describe("Process name to update"),
      newProcessName: z.string().optional().describe("New process name"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {
          instanceNo: params.instanceNo,
          processName: params.processName,
        };
        if (params.newProcessName !== undefined) body.newProcessName = params.newProcessName;

        const result = await client.postRequest("/cw_fea/real/cw/api/plugin/process/update", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_update_port_plugin — Update port plugin settings
  server.tool(
    "ncloud_update_port_plugin",
    "Update port monitoring plugin settings in Cloud Insight.",
    {
      instanceNo: z.string().describe("Server instance number"),
      portNumber: z.number().describe("Current port number"),
      newPortNumber: z.number().optional().describe("New port number"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {
          instanceNo: params.instanceNo,
          portNumber: params.portNumber,
        };
        if (params.newPortNumber !== undefined) body.newPortNumber = params.newPortNumber;

        const result = await client.postRequest("/cw_fea/real/cw/api/plugin/port/update", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_update_file_plugin — Update file plugin settings
  server.tool(
    "ncloud_update_file_plugin",
    "Update file monitoring plugin settings in Cloud Insight.",
    {
      instanceNo: z.string().describe("Server instance number"),
      filePath: z.string().describe("Current file path"),
      newFilePath: z.string().optional().describe("New file path"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {
          instanceNo: params.instanceNo,
          filePath: params.filePath,
        };
        if (params.newFilePath !== undefined) body.newFilePath = params.newFilePath;

        const result = await client.postRequest("/cw_fea/real/cw/api/plugin/file/update", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // --- Additional Schema Tools ---

  // ncloud_create_custom_schema — Create a custom schema
  server.tool(
    "ncloud_create_custom_schema",
    "Create a user-defined custom schema in Cloud Insight for custom metrics.",
    {
      prodName: z.string().describe("Product name for the custom schema"),
      fields: z.array(z.object({
        fieldName: z.string().describe("Field name"),
        fieldType: z.enum(["STRING", "INTEGER", "LONG", "FLOAT"]).describe("Field data type"),
        dimension: z.boolean().optional().describe("Whether this field is a dimension (default: false)"),
      })).describe("Schema field definitions"),
    },
    async (params) => {
      try {
        const body = {
          prodName: params.prodName,
          fields: params.fields,
        };

        const result = await client.postRequest("/cw_fea/real/cw/api/schema/create", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_delete_product_schema — Delete a custom schema
  server.tool(
    "ncloud_delete_product_schema",
    "⚠️ Destructive: Delete a user-defined custom schema from Cloud Insight.",
    {
      prodKey: z.string().describe("Product key (cw_key) of the schema to delete"),
      confirm: z.boolean().optional().describe("Must be true to execute deletion."),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          return {
            content: [{
              type: "text" as const,
              text: `⚠️ This will permanently delete custom schema [${params.prodKey}]. To confirm, call this tool again with confirm=true.`,
            }],
          };
        }

        const body = { prodKey: params.prodKey };
        const result = await client.postRequest("/cw_fea/real/cw/api/schema/delete", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_update_product_schema — Update a custom schema
  server.tool(
    "ncloud_update_product_schema",
    "Update a user-defined custom schema in Cloud Insight.",
    {
      prodKey: z.string().describe("Product key (cw_key) of the schema to update"),
      fields: z.array(z.object({
        fieldName: z.string().describe("Field name"),
        fieldType: z.enum(["STRING", "INTEGER", "LONG", "FLOAT"]).describe("Field data type"),
        dimension: z.boolean().optional().describe("Whether this field is a dimension"),
      })).describe("Updated schema field definitions"),
    },
    async (params) => {
      try {
        const body = {
          prodKey: params.prodKey,
          fields: params.fields,
        };

        const result = await client.postRequest("/cw_fea/real/cw/api/schema/update", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_extended_status — Get extended metric status
  server.tool(
    "ncloud_get_extended_status",
    "Get the Extended Metric collection status for a specific instance in Cloud Insight.",
    {
      instanceNo: z.string().describe("Server instance number to check extended metric status"),
    },
    async (params) => {
      try {
        const body = { instanceNo: params.instanceNo };
        const result = await client.postRequest("/cw_fea/real/cw/api/schema/extended/status", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_update_extended_enable — Enable extended metric collection
  server.tool(
    "ncloud_update_extended_enable",
    "Enable Extended Metric collection for a specific instance in Cloud Insight.",
    {
      instanceNo: z.string().describe("Server instance number to enable extended metrics for"),
    },
    async (params) => {
      try {
        const body = { instanceNo: params.instanceNo };
        const result = await client.postRequest("/cw_fea/real/cw/api/schema/extended/enable", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_update_extended_disable — Disable extended metric collection
  server.tool(
    "ncloud_update_extended_disable",
    "Disable Extended Metric collection for a specific instance in Cloud Insight.",
    {
      instanceNo: z.string().describe("Server instance number to disable extended metrics for"),
    },
    async (params) => {
      try {
        const body = { instanceNo: params.instanceNo };
        const result = await client.postRequest("/cw_fea/real/cw/api/schema/extended/disable", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // --- Custom Resource Update ---

  // ncloud_update_custom_resource — Update a custom resource
  server.tool(
    "ncloud_update_custom_resource",
    "Update a user-defined custom resource in Cloud Insight.",
    {
      resourceId: z.string().describe("Custom resource ID to update"),
      resourceName: z.string().optional().describe("New name for the custom resource"),
      dimensions: z.record(z.string()).optional().describe("Updated dimension key-value pairs"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {
          resourceId: params.resourceId,
        };
        if (params.resourceName !== undefined) body.resourceName = params.resourceName;
        if (params.dimensions !== undefined) body.dimensions = params.dimensions;

        const result = await client.postRequest("/cw_fea/real/cw/api/custom/resource/update", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // --- Planned Maintenance Tools ---

  // ncloud_list_maintenances — Get planned maintenance list
  server.tool(
    "ncloud_list_maintenances",
    "Get the list of planned maintenance schedules in Cloud Insight.",
    {},
    async () => {
      try {
        const result = await client.postRequest("/cw_fea/real/cw/api/maintenance/list", {});
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_maintenance_detail — Get planned maintenance detail
  server.tool(
    "ncloud_get_maintenance_detail",
    "Get detailed information about a specific planned maintenance schedule.",
    {
      maintenanceId: z.string().describe("Maintenance ID to retrieve details for"),
    },
    async (params) => {
      try {
        const body = { maintenanceId: params.maintenanceId };
        const result = await client.postRequest("/cw_fea/real/cw/api/maintenance/detail", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_create_maintenance — Create a planned maintenance schedule
  server.tool(
    "ncloud_create_maintenance",
    "Create a new planned maintenance schedule in Cloud Insight.",
    {
      title: z.string().describe("Maintenance title"),
      startTime: z.number().describe("Start time in Unix epoch milliseconds"),
      endTime: z.number().describe("End time in Unix epoch milliseconds"),
      description: z.string().optional().describe("Maintenance description"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {
          title: params.title,
          startTime: params.startTime,
          endTime: params.endTime,
        };
        if (params.description !== undefined) body.description = params.description;

        const result = await client.postRequest("/cw_fea/real/cw/api/maintenance/create", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_update_maintenance — Update a planned maintenance schedule
  server.tool(
    "ncloud_update_maintenance",
    "Update an existing planned maintenance schedule in Cloud Insight.",
    {
      maintenanceId: z.string().describe("Maintenance ID to update"),
      title: z.string().optional().describe("New maintenance title"),
      startTime: z.number().optional().describe("New start time in Unix epoch milliseconds"),
      endTime: z.number().optional().describe("New end time in Unix epoch milliseconds"),
      description: z.string().optional().describe("New maintenance description"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {
          maintenanceId: params.maintenanceId,
        };
        if (params.title !== undefined) body.title = params.title;
        if (params.startTime !== undefined) body.startTime = params.startTime;
        if (params.endTime !== undefined) body.endTime = params.endTime;
        if (params.description !== undefined) body.description = params.description;

        const result = await client.postRequest("/cw_fea/real/cw/api/maintenance/update", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_delete_maintenance — Delete a planned maintenance schedule
  server.tool(
    "ncloud_delete_maintenance",
    "⚠️ Destructive: Delete a planned maintenance schedule from Cloud Insight.",
    {
      maintenanceId: z.string().describe("Maintenance ID to delete"),
      confirm: z.boolean().optional().describe("Must be true to execute deletion."),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          return {
            content: [{
              type: "text" as const,
              text: `⚠️ This will permanently delete maintenance schedule [${params.maintenanceId}]. To confirm, call this tool again with confirm=true.`,
            }],
          };
        }

        const body = { maintenanceId: params.maintenanceId };
        const result = await client.postRequest("/cw_fea/real/cw/api/maintenance/delete", body);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
