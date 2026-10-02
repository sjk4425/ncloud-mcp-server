import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { requiredError } from "./_messages.js";
import { dryRunPreview } from "./_dryrun.js";

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

  // Stages belong to an API, not directly to a product:
  // guide apigateway-stage-getstagelist / createstage / deletestage / getstage —
  // /api/v1/products/{product-id}/apis/{api-id}/stages[/{stage-id}] (verified 2026-10-02, same in gov/fin).
  const stagesPath = (productId: string, apiId: string) =>
    `/api/v1/products/${encodeURIComponent(productId)}/apis/${encodeURIComponent(apiId)}/stages`;

  defineTool(
    server,
    "ncloud_apigw_list_stages",
    "List all stages of an API in an API Gateway product. Find apiId with ncloud_apigw_list_apis.",
    {
      productId: z.string({ required_error: requiredError("productId") }).describe("Product ID the API belongs to"),
      apiId: z.string({ required_error: requiredError("apiId") }).describe("API ID to list stages for"),
    },
    async (params) => {
      return client.request(stagesPath(params.productId, params.apiId));
    }
  );

  defineTool(
    server,
    "ncloud_apigw_get_stage",
    "Get details of a single stage of an API in an API Gateway product.",
    {
      productId: z.string({ required_error: requiredError("productId") }).describe("Product ID the API belongs to"),
      apiId: z.string({ required_error: requiredError("apiId") }).describe("API ID the stage belongs to"),
      stageId: z.string({ required_error: requiredError("stageId") }).describe("Stage ID to retrieve"),
    },
    async (params) => {
      return client.request(`${stagesPath(params.productId, params.apiId)}/${encodeURIComponent(params.stageId)}`);
    }
  );

  defineTool(
    server,
    "ncloud_apigw_create_stage",
    "Create a new stage for an API in an API Gateway product. Use dryRun=true to preview without creating.",
    {
      productId: z.string({ required_error: requiredError("productId") }).describe("Product ID the API belongs to"),
      apiId: z.string({ required_error: requiredError("apiId") }).describe("API ID to create the stage for"),
      stageName: z.string({ required_error: requiredError("stageName") }).describe("Name for the new stage (1-20 chars: letters, digits, '-', '_')"),
      endpointDomain: z.string({ required_error: requiredError("endpointDomain") }).describe("Backend endpoint domain for the stage, e.g. https://backend.example.com (required)"),
      deploymentDescription: z.string().optional().describe("Description for the stage deployment"),
      cacheTtlSec: z.number().optional().describe("API cache TTL in seconds (1-3600)"),
      throttleRps: z.number().optional().describe("Per-method requests-per-second limit"),
      isMaintenance: z.boolean().optional().describe("Enable maintenance mode (default false)"),
      statusCode: z.number().optional().describe("Status code returned while in maintenance (100-599)"),
      response: z.string().optional().describe("Response body for the maintenance status code (0-1500 chars)"),
      ipAclCode: z.enum(["ALLOWED", "REJECTED"]).optional().describe("IP ACL mode; required together with ipAclList"),
      ipAclList: z.string().optional().describe("IP ACL list; required together with ipAclCode"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the stage"),
    },
    async (params) => {
      const body: Record<string, unknown> = { stageName: params.stageName, endpointDomain: params.endpointDomain };
      for (const k of ["deploymentDescription", "cacheTtlSec", "throttleRps", "isMaintenance", "statusCode", "response", "ipAclCode", "ipAclList"] as const) {
        if (params[k] !== undefined) body[k] = params[k];
      }
      const path = stagesPath(params.productId, params.apiId);

      if (params.dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: API Gateway Stage Creation",
          endpoint: path,
          method: "POST",
          requestParams: body,
          noun: { ko: "스테이지", en: "stage" },
        });
      }

      const result = await client.postRequest(path, body);
      return {
        리소스타입: "API Gateway Stage",
        프로덕트ID: params.productId,
        API_ID: params.apiId,
        스테이지ID: result?.stage?.stageId ?? result?.stageId,
        스테이지명: params.stageName,
        상태: "created",
      };
    }
  );

  defineTool(
    server,
    "ncloud_apigw_delete_stage",
    "⚠️ Destructive: Permanently delete an API Gateway stage. Set confirm=true to execute.",
    {
      productId: z.string({ required_error: requiredError("productId") }).describe("Product ID the API belongs to"),
      apiId: z.string({ required_error: requiredError("apiId") }).describe("API ID the stage belongs to"),
      stageId: z.string({ required_error: requiredError("stageId") }).describe("Stage ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      return client.deleteRequest(`${stagesPath(params.productId, params.apiId)}/${encodeURIComponent(params.stageId)}`);
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete API Gateway Stage [${params.stageId}] of API [${params.apiId}] in Product [${params.productId}]. All deployments on this stage will be removed.\n\nTo execute, call this tool again with confirm=true.` } }
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
      const body: Record<string, string> = { apiKeyName: params.apiKeyName };
      if (params.apiKeyDescription) body.apiKeyDescription = params.apiKeyDescription;

      if (params.dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: API Gateway API Key Creation",
          endpoint: "/api/v1/api-keys",
          method: "POST",
          requestParams: body,
          noun: { ko: "API 키", en: "API key" },
        });
      }

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
      // Guide apigateway-apikey-delete: DELETE /api/v1/api-keys/{api-key-id}
      return client.deleteRequest(`/api/v1/api-keys/${encodeURIComponent(params.apiKeyId)}`);
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
