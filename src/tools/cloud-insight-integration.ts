import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";

export function registerCloudInsightIntegrationTools(server: McpServer, client: NcloudClient): void {
  // ncloud_list_integrations — Get integration list
  server.tool(
    "ncloud_list_integrations",
    "Get the list of Cloud Insight integrations.",
    {},
    async () => {
      try {
        const result = await client.postRequest("/cw_fea/real/cw/api/integration/list", {});
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_integration — Get integration details
  server.tool(
    "ncloud_get_integration",
    "Get detailed information about a specific Cloud Insight integration.",
    {
      integrationId: z.string().describe("Integration ID to retrieve details for"),
    },
    async (params) => {
      try {
        const body = { integrationId: params.integrationId };
        const result = await client.postRequest("/cw_fea/real/cw/api/integration/detail", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_create_integration — Create an integration
  server.tool(
    "ncloud_create_integration",
    "Create a new Cloud Insight integration.",
    {
      integrationName: z.string().describe("Name of the integration"),
      integrationType: z.string().describe("Type of integration"),
      config: z.record(z.unknown()).optional().describe("Integration configuration as key-value pairs"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {
          integrationName: params.integrationName,
          integrationType: params.integrationType,
        };
        if (params.config !== undefined) body.config = params.config;

        const result = await client.postRequest("/cw_fea/real/cw/api/integration/create", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_update_integration — Update an integration
  server.tool(
    "ncloud_update_integration",
    "Update an existing Cloud Insight integration.",
    {
      integrationId: z.string().describe("Integration ID to update"),
      integrationName: z.string().optional().describe("New name for the integration"),
      config: z.record(z.unknown()).optional().describe("Updated integration configuration"),
    },
    async (params) => {
      try {
        const body: Record<string, unknown> = {
          integrationId: params.integrationId,
        };
        if (params.integrationName !== undefined) body.integrationName = params.integrationName;
        if (params.config !== undefined) body.config = params.config;

        const result = await client.postRequest("/cw_fea/real/cw/api/integration/update", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_delete_integration — Delete an integration
  server.tool(
    "ncloud_delete_integration",
    "⚠️ Destructive: Delete a Cloud Insight integration.",
    {
      integrationId: z.string().describe("Integration ID to delete"),
      confirm: z.boolean().optional().describe("Must be true to execute deletion."),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          return {
            content: [{
              type: "text" as const,
              text: `⚠️ This will permanently delete integration [${params.integrationId}]. To confirm, call this tool again with confirm=true.`,
            }],
          };
        }

        const body = { integrationId: params.integrationId };
        const result = await client.postRequest("/cw_fea/real/cw/api/integration/delete", body);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
