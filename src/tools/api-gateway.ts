import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { toolText } from "./_response.js";

export function registerApiGatewayTools(server: McpServer, client: NcloudClient): void {
  // ─── Product Query Tools ───────────────────────────────────────────────────

  server.tool(
    "ncloud_apigw_list_products",
    "List all API Gateway products",
    {
      offset: z.number().optional().describe("Starting point of the response data for pagination"),
      limit: z.number().optional().describe("Maximum number of response data for pagination"),
    },
    async (params) => {
      try {
        const apiParams: Record<string, string | number | undefined> = {};
        if (params.offset !== undefined) apiParams.offset = params.offset;
        if (params.limit !== undefined) apiParams.limit = params.limit;
        const result = await client.request("/api/v1/products", apiParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_apigw_get_product",
    "Get detailed information about a specific API Gateway product",
    {
      productId: z.string({ required_error: "필수 파라미터 'productId'가 누락되었습니다." }).describe("Product ID to query"),
    },
    async (params) => {
      try {
        const result = await client.request(`/api/v1/products/${encodeURIComponent(params.productId)}`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── API Query Tool ────────────────────────────────────────────────────────

  server.tool(
    "ncloud_apigw_list_apis",
    "List all APIs in a specific API Gateway product",
    {
      productId: z.string({ required_error: "필수 파라미터 'productId'가 누락되었습니다." }).describe("Product ID to list APIs for"),
      offset: z.number().optional().describe("Starting point of the response data for pagination"),
      limit: z.number().optional().describe("Maximum number of response data for pagination"),
      apiName: z.string().optional().describe("Filter by API name"),
    },
    async (params) => {
      try {
        const apiParams: Record<string, string | number | undefined> = {};
        if (params.offset !== undefined) apiParams.offset = params.offset;
        if (params.limit !== undefined) apiParams.limit = params.limit;
        if (params.apiName !== undefined) apiParams.apiName = params.apiName;
        const result = await client.request(`/api/v1/products/${encodeURIComponent(params.productId)}/apis`, apiParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Stage Tools ───────────────────────────────────────────────────────────

  server.tool(
    "ncloud_apigw_list_stages",
    "List all stages for a specific API Gateway product",
    {
      productId: z.string({ required_error: "필수 파라미터 'productId'가 누락되었습니다." }).describe("Product ID to list stages for"),
      offset: z.number().optional().describe("Starting point of the response data for pagination"),
      limit: z.number().optional().describe("Maximum number of response data for pagination"),
    },
    async (params) => {
      try {
        const apiParams: Record<string, string | number | undefined> = {};
        if (params.offset !== undefined) apiParams.offset = params.offset;
        if (params.limit !== undefined) apiParams.limit = params.limit;
        const result = await client.request(`/api/v1/products/${encodeURIComponent(params.productId)}/stages`, apiParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_apigw_create_stage",
    "Create a new stage for an API Gateway product. Use dryRun=true to preview without creating.",
    {
      productId: z.string({ required_error: "필수 파라미터 'productId'가 누락되었습니다." }).describe("Product ID to create stage for"),
      stageName: z.string({ required_error: "필수 파라미터 'stageName'이 누락되었습니다." }).describe("Name for the new stage"),
      stageDescription: z.string().optional().describe("Description for the new stage"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the stage"),
    },
    async (params) => {
      try {
        if (params.dryRun) {
          const preview = {
            label: "🔍 Dry-Run Preview: API Gateway Stage Creation",
            productId: params.productId,
            stageName: params.stageName,
            stageDescription: params.stageDescription ?? "(none)",
            message: "이 요청은 실제 스테이지를 생성하지 않습니다. dryRun=false로 호출하면 스테이지가 생성됩니다.",
          };
          return toolText(preview);
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
        return toolText(summary);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_apigw_delete_stage",
    "⚠️ Destructive: Permanently delete an API Gateway stage. Set confirm=true to execute.",
    {
      productId: z.string({ required_error: "필수 파라미터 'productId'가 누락되었습니다." }).describe("Product ID the stage belongs to"),
      stageId: z.string({ required_error: "필수 파라미터 'stageId'가 누락되었습니다." }).describe("Stage ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete API Gateway Stage [${params.stageId}] from Product [${params.productId}]. All deployments on this stage will be removed.\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const result = await client.request(`/api/v1/products/${encodeURIComponent(params.productId)}/stages/${encodeURIComponent(params.stageId)}/delete`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── API Key Tools ─────────────────────────────────────────────────────────

  server.tool(
    "ncloud_apigw_list_api_keys",
    "List all API keys in API Gateway",
    {
      offset: z.number().optional().describe("Starting point of the response data for pagination"),
      limit: z.number().optional().describe("Maximum number of response data for pagination"),
    },
    async (params) => {
      try {
        const apiParams: Record<string, string | number | undefined> = {};
        if (params.offset !== undefined) apiParams.offset = params.offset;
        if (params.limit !== undefined) apiParams.limit = params.limit;
        const result = await client.request("/api/v1/api-keys", apiParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_apigw_create_api_key",
    "Create a new API key in API Gateway. Use dryRun=true to preview without creating.",
    {
      apiKeyName: z.string({ required_error: "필수 파라미터 'apiKeyName'이 누락되었습니다." }).describe("Name for the new API key"),
      apiKeyDescription: z.string().optional().describe("Description for the new API key"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the API key"),
    },
    async (params) => {
      try {
        if (params.dryRun) {
          const preview = {
            label: "🔍 Dry-Run Preview: API Gateway API Key Creation",
            apiKeyName: params.apiKeyName,
            apiKeyDescription: params.apiKeyDescription ?? "(none)",
            message: "이 요청은 실제 API 키를 생성하지 않습니다. dryRun=false로 호출하면 API 키가 생성됩니다.",
          };
          return toolText(preview);
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
        return toolText(summary);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_apigw_delete_api_key",
    "⚠️ Destructive: Permanently delete an API key from API Gateway. Set confirm=true to execute.",
    {
      apiKeyId: z.string({ required_error: "필수 파라미터 'apiKeyId'가 누락되었습니다." }).describe("API key ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete API Key [${params.apiKeyId}]. Any stages subscribed with this key will lose access.\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const result = await client.request(`/api/v1/api-keys/${encodeURIComponent(params.apiKeyId)}/delete`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Usage Plan Tool ───────────────────────────────────────────────────────

  server.tool(
    "ncloud_apigw_get_usage_plan",
    "Get usage plan details and API usage statistics from API Gateway",
    {
      usagePlanId: z.string({ required_error: "필수 파라미터 'usagePlanId'가 누락되었습니다." }).describe("Usage plan ID to query"),
    },
    async (params) => {
      try {
        const result = await client.request(`/api/v1/usage-plans/${encodeURIComponent(params.usagePlanId)}`);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
