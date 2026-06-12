import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";

// Cloud Insight Integration API (base: https://cw.apigw.ntruss.com)
// 공식 docs 기준 경로/메서드/필드 (management-cloudinsight-*integration*)
const BASE = "/cw_fea/real/cw/api/integration";

export function registerCloudInsightIntegrationTools(server: McpServer, client: NcloudClient): void {
  // ncloud_list_integrations — Get integration list (paged)
  defineTool(
    server,
    "ncloud_list_integrations",
    "Get the list of Cloud Insight integrations (paged).",
    {
      query: z.string().optional().default("").describe("Filter keyword (empty string = all)"),
      pageNum: z.number().optional().default(1).describe("Page number (>= 1)"),
      pageSize: z.number().optional().default(100).describe("Page size (>= 1)"),
    },
    async (params) => {
      const body = {
        query: params.query ?? "",
        pageNum: params.pageNum ?? 1,
        pageSize: params.pageSize ?? 100,
      };
      const result = await client.postRequest(`${BASE}/page`, body);
      return result;
    }
  );

  // ncloud_get_integration — Get integration details (GET, id in path)
  defineTool(
    server,
    "ncloud_get_integration",
    "Get detailed information about a specific Cloud Insight integration.",
    {
      integrationId: z.string().describe("Integration ID to retrieve details for"),
    },
    async (params) => {
      return client.requestRaw("GET", `${BASE}/${params.integrationId}/detail`);
    }
  );

  // ncloud_create_integration — Create an integration (OUT_GOING webhook)
  defineTool(
    server,
    "ncloud_create_integration",
    "Create a new Cloud Insight integration (outgoing webhook).",
    {
      name: z.string().describe("Name of the integration"),
      url: z.string().describe("Outgoing webhook URL"),
      payload: z.string().describe("Request payload template (JSON string, 0-15000 bytes)"),
      type: z.string().optional().default("OUT_GOING").describe("Integration type (currently 'OUT_GOING')"),
      headers: z.record(z.string()).optional().describe("HTTP headers to send (max 10 entries)"),
    },
    async (params) => {
      const body: Record<string, unknown> = {
        name: params.name,
        type: params.type ?? "OUT_GOING",
        url: params.url,
        payload: params.payload,
      };
      if (params.headers !== undefined) body.headers = params.headers;
      const result = await client.postRequest(`${BASE}/create`, body);
      return result;
    }
  );

  // ncloud_update_integration — Update an integration
  defineTool(
    server,
    "ncloud_update_integration",
    "Update an existing Cloud Insight integration.",
    {
      integrationId: z.string().describe("Integration ID to update"),
      name: z.string().describe("Name of the integration"),
      url: z.string().describe("Outgoing webhook URL"),
      payload: z.string().describe("Request payload template (JSON string, 0-15000 bytes)"),
      type: z.string().optional().default("OUT_GOING").describe("Integration type (currently 'OUT_GOING')"),
      headers: z.record(z.string()).optional().describe("HTTP headers to send (max 10 entries)"),
    },
    async (params) => {
      const body: Record<string, unknown> = {
        id: params.integrationId,
        name: params.name,
        type: params.type ?? "OUT_GOING",
        url: params.url,
        payload: params.payload,
      };
      if (params.headers !== undefined) body.headers = params.headers;
      const result = await client.postRequest(`${BASE}/update`, body);
      return result;
    }
  );

  // ncloud_delete_integration — Delete integration(s) (body = JSON array of ids)
  defineTool(
    server,
    "ncloud_delete_integration",
    "⚠️ Destructive: Delete a Cloud Insight integration. Set confirm=true to execute.",
    {
      integrationId: z.string().describe("Integration ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      if (!params.confirm) {
        return {
          content: [{
            type: "text" as const,
            text: `⚠️ This will permanently delete integration [${params.integrationId}]. To execute, call this tool again with confirm=true.`,
          }],
        };
      }
      // 삭제 API는 id 문자열의 JSON 배열을 body로 받는다
      const result = await client.postRequest(`${BASE}/delete`, [params.integrationId]);
      return result;
    }
  );
}
