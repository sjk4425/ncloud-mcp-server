import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { dryRunMessage, requiredError } from "./_messages.js";

export function registerApiGatewayTools(server: McpServer, client: NcloudClient): void {
  // ─── Product Query Tools ───────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_apigw_list_products",
    "List all API Gateway products",
    {
      offset: z.number().optional().describe("Starting point of the response data for pagination"),
      limit: z.number().optional().describe("Maximum number of response data for pagination"),
    },
    async (params) => {
      const apiParams: Record<string, string | number | undefined> = {};
      if (params.offset !== undefined) apiParams.offset = params.offset;
      if (params.limit !== undefined) apiParams.limit = params.limit;
      const result = await client.request("/api/v1/products", apiParams);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_apigw_get_product",
    "Get detailed information about a specific API Gateway product",
    {
      productId: z.string({ required_error: requiredError("productId") }).describe("Product ID to query"),
    },
    async (params) => {
      return client.request(`/api/v1/products/${encodeURIComponent(params.productId)}`);
    }
  );

  // ─── API Query Tool ────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_apigw_list_apis",
    "List all APIs in a specific API Gateway product",
    {
      productId: z.string({ required_error: requiredError("productId") }).describe("Product ID to list APIs for"),
      offset: z.number().optional().describe("Starting point of the response data for pagination"),
      limit: z.number().optional().describe("Maximum number of response data for pagination"),
      apiName: z.string().optional().describe("Filter by API name"),
    },
    async (params) => {
      const apiParams: Record<string, string | number | undefined> = {};
      if (params.offset !== undefined) apiParams.offset = params.offset;
      if (params.limit !== undefined) apiParams.limit = params.limit;
      if (params.apiName !== undefined) apiParams.apiName = params.apiName;
      const result = await client.request(`/api/v1/products/${encodeURIComponent(params.productId)}/apis`, apiParams);
      return result;
    }
  );

  // ─── Stage Tools ───────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_apigw_list_stages",
    "List all stages for a specific API Gateway product",
    {
      productId: z.string({ required_error: requiredError("productId") }).describe("Product ID to list stages for"),
      offset: z.number().optional().describe("Starting point of the response data for pagination"),
      limit: z.number().optional().describe("Maximum number of response data for pagination"),
    },
    async (params) => {
      const apiParams: Record<string, string | number | undefined> = {};
      if (params.offset !== undefined) apiParams.offset = params.offset;
      if (params.limit !== undefined) apiParams.limit = params.limit;
      const result = await client.request(`/api/v1/products/${encodeURIComponent(params.productId)}/stages`, apiParams);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_apigw_create_stage",
    "Create a new stage for an API Gateway product. Use dryRun=true to preview without creating.",
    {
      productId: z.string({ required_error: requiredError("productId") }).describe("Product ID to create stage for"),
      stageName: z.string({ required_error: requiredError("stageName") }).describe("Name for the new stage"),
      stageDescription: z.string().optional().describe("Description for the new stage"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the stage"),
    },
    async (params) => {
      if (params.dryRun) {
        const preview = {
          label: "🔍 Dry-Run Preview: API Gateway Stage Creation",
          productId: params.productId,
          stageName: params.stageName,
          stageDescription: params.stageDescription ?? "(none)",
          message: dryRunMessage({ ko: "스테이지", en: "stage" }),
        };
        return preview;
      }

      const body: Record<string, string> = { stageName: params.stageName };
      if (params.stageDescription) body.stageDescription = params.stageDescription;

      const result = await client.postRequest(`/api/v1/products/${encodeURIComponent(params.productId)}/stages`, body);
      const summary = {
        리소스타입: "API Gateway Stage",
        프로덕트ID: params.productId,
        스테이지명: params.stageName,
        설명: params.stageDescription ?? "(none)",
        상태: "created",
      };
      return summary;
    }
  );

  defineTool(
    server,
    "ncloud_apigw_delete_stage",
    "⚠️ Destructive: Permanently delete an API Gateway stage. Set confirm=true to execute.",
    {
      productId: z.string({ required_error: requiredError("productId") }).describe("Product ID the stage belongs to"),
      stageId: z.string({ required_error: requiredError("stageId") }).describe("Stage ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const result = await client.request(`/api/v1/products/${encodeURIComponent(params.productId)}/stages/${encodeURIComponent(params.stageId)}/delete`);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete API Gateway Stage [${params.stageId}] from Product [${params.productId}]. All deployments on this stage will be removed.\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── API Key Tools ─────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_apigw_list_api_keys",
    "List all API keys in API Gateway",
    {
      offset: z.number().optional().describe("Starting point of the response data for pagination"),
      limit: z.number().optional().describe("Maximum number of response data for pagination"),
    },
    async (params) => {
      const apiParams: Record<string, string | number | undefined> = {};
      if (params.offset !== undefined) apiParams.offset = params.offset;
      if (params.limit !== undefined) apiParams.limit = params.limit;
      const result = await client.request("/api/v1/api-keys", apiParams);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_apigw_create_api_key",
    "Create a new API key in API Gateway. Use dryRun=true to preview without creating.",
    {
      apiKeyName: z.string({ required_error: requiredError("apiKeyName") }).describe("Name for the new API key"),
      apiKeyDescription: z.string().optional().describe("Description for the new API key"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the API key"),
    },
    async (params) => {
      if (params.dryRun) {
        const preview = {
          label: "🔍 Dry-Run Preview: API Gateway API Key Creation",
          apiKeyName: params.apiKeyName,
          apiKeyDescription: params.apiKeyDescription ?? "(none)",
          message: dryRunMessage({ ko: "API 키", en: "API key" }),
        };
        return preview;
      }

      const body: Record<string, string> = { apiKeyName: params.apiKeyName };
      if (params.apiKeyDescription) body.apiKeyDescription = params.apiKeyDescription;

      const result = await client.postRequest("/api/v1/api-keys", body);
      const summary = {
        리소스타입: "API Gateway API Key",
        API키명: params.apiKeyName,
        설명: params.apiKeyDescription ?? "(none)",
        상태: "created",
      };
      return summary;
    }
  );

  defineTool(
    server,
    "ncloud_apigw_delete_api_key",
    "⚠️ Destructive: Permanently delete an API key from API Gateway. Set confirm=true to execute.",
    {
      apiKeyId: z.string({ required_error: requiredError("apiKeyId") }).describe("API key ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const result = await client.request(`/api/v1/api-keys/${encodeURIComponent(params.apiKeyId)}/delete`);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete API Key [${params.apiKeyId}]. Any stages subscribed with this key will lose access.\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Usage Plan Tool ───────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_apigw_get_usage_plan",
    "Get usage plan details and API usage statistics from API Gateway",
    {
      usagePlanId: z.string({ required_error: requiredError("usagePlanId") }).describe("Usage plan ID to query"),
    },
    async (params) => {
      return client.request(`/api/v1/usage-plans/${encodeURIComponent(params.usagePlanId)}`);
    }
  );
}
