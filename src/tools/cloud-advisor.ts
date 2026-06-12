import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";

export function registerCloudAdvisorTools(server: McpServer, client: NcloudClient): void {
  // ncloud_advisor_get_categories — Get check categories
  defineTool(
    server,
    "ncloud_advisor_get_categories",
    "Get Cloud Advisor check categories (SECURITY, COST). Returns available inspection category list.",
    {},
    async () => {
      return client.requestRaw("GET", "/api/v1/categories");
    }
  );

  // ncloud_advisor_get_checkitems — Get check items for a category
  defineTool(
    server,
    "ncloud_advisor_get_checkitems",
    "Get Cloud Advisor check items for a specific category. Returns item codes, names, descriptions, recommendations, and result table header info.",
    {
      categoryCode: z.enum(["SECURITY", "COST"]).describe("Check category code: SECURITY (security) or COST (cost & high availability)"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/v1/categories/${params.categoryCode}/checkitems`);
    }
  );

  // ncloud_advisor_get_category_status — Get check status for all items in a category
  defineTool(
    server,
    "ncloud_advisor_get_category_status",
    "Get check request availability status for all items in a category. Shows whether each item can be refreshed and its current processing state.",
    {
      categoryCode: z.enum(["SECURITY", "COST"]).describe("Check category code: SECURITY or COST"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/v1/categories/${params.categoryCode}/checkitems/status`);
    }
  );

  // ncloud_advisor_refresh_category — Request check for all items in a category
  defineTool(
    server,
    "ncloud_advisor_refresh_category",
    "Request a check (refresh) for all items in a category. Triggers inspection for all check items under the specified category.",
    {
      categoryCode: z.enum(["SECURITY", "COST"]).describe("Check category code: SECURITY or COST"),
    },
    async (params) => {
      return client.requestRaw("POST", `/api/v1/categories/${params.categoryCode}/checkitems/refresh`, undefined, {});
    }
  );

  // ncloud_advisor_get_category_dashboard — Get check result grade summary for a category
  defineTool(
    server,
    "ncloud_advisor_get_category_dashboard",
    "Get check result grade summary (GREEN/YELLOW/RED counts) for categories. Shows how many items are in each alert level.",
    {
      categoryCode: z.enum(["SECURITY", "COST"]).optional().describe("Check category code (optional). If omitted, returns dashboard for all categories."),
    },
    async (params) => {
      const path = params.categoryCode
        ? `/api/v1/categories/${params.categoryCode}/dashboard`
        : `/api/v1/categories/dashboard`;
      const result = await client.requestRaw("GET", path);
      return result;
    }
  );

  // ncloud_advisor_get_category_result_summary — Get check result summary for all items in a category
  defineTool(
    server,
    "ncloud_advisor_get_category_result_summary",
    "Get check result summary for all items in a category. Returns each item's alert level (GREEN/YELLOW/RED), summary text, and last check time.",
    {
      categoryCode: z.enum(["SECURITY", "COST"]).describe("Check category code: SECURITY or COST"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/v1/categories/${params.categoryCode}/checkitems/result-summary`);
    }
  );

  // ncloud_advisor_get_item_status — Get check status for a specific item
  defineTool(
    server,
    "ncloud_advisor_get_item_status",
    "Get check request availability status for a specific check item. Shows whether the item can be refreshed and its current processing state.",
    {
      categoryCode: z.enum(["SECURITY", "COST"]).describe("Check category code: SECURITY or COST"),
      itemCode: z.string().describe("Check item code (e.g., SUB_ACCOUNT_ACCESSKEY, ACG_PORT, IDLE_RESOURCE_VM)"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/v1/categories/${params.categoryCode}/checkitems/${params.itemCode}/status`);
    }
  );

  // ncloud_advisor_refresh_item — Request check for a specific item
  defineTool(
    server,
    "ncloud_advisor_refresh_item",
    "Request a check (refresh) for a specific check item. Triggers inspection for the specified item.",
    {
      categoryCode: z.enum(["SECURITY", "COST"]).describe("Check category code: SECURITY or COST"),
      itemCode: z.string().describe("Check item code (e.g., SUB_ACCOUNT_ACCESSKEY, ACG_PORT, IDLE_RESOURCE_VM)"),
    },
    async (params) => {
      return client.requestRaw("POST", `/api/v1/categories/${params.categoryCode}/checkitems/${params.itemCode}/refresh`, undefined, {});
    }
  );

  // ncloud_advisor_get_item_result_summary — Get check result summary for a specific item
  defineTool(
    server,
    "ncloud_advisor_get_item_result_summary",
    "Get check result summary for a specific check item. Returns the item's alert level (GREEN/YELLOW/RED), summary text, and last check time.",
    {
      categoryCode: z.enum(["SECURITY", "COST"]).describe("Check category code: SECURITY or COST"),
      itemCode: z.string().describe("Check item code (e.g., SUB_ACCOUNT_ACCESSKEY, ACG_PORT, IDLE_RESOURCE_VM)"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/v1/categories/${params.categoryCode}/checkitems/${params.itemCode}/result-summary`);
    }
  );

  // ncloud_advisor_get_item_result_detail — Get detailed check results for a specific item
  defineTool(
    server,
    "ncloud_advisor_get_item_result_detail",
    "Get detailed per-instance check results for a specific check item. Returns paginated instance-level inspection results with status (GREEN/YELLOW/RED).",
    {
      categoryCode: z.enum(["SECURITY", "COST"]).describe("Check category code: SECURITY or COST"),
      itemCode: z.string().describe("Check item code (e.g., SUB_ACCOUNT_ACCESSKEY, ACG_PORT, IDLE_RESOURCE_VM)"),
      page: z.number().describe("Page number (1-based)"),
      size: z.number().describe("Number of items per page"),
      display: z.enum(["all", "included", "excluded"]).optional().describe("Filter instances: all (all instances), included (included only, default), excluded (excluded only)"),
    },
    async (params) => {
      const queryParams: Record<string, string | number | boolean | undefined> = {
        page: params.page,
        size: params.size,
      };
      if (params.display) {
        queryParams.display = params.display;
      }
      const result = await client.requestRaw(
        "GET",
        `/api/v1/categories/${params.categoryCode}/checkitems/${params.itemCode}/result-detail`,
        queryParams
      );
      return result;
    }
  );

  // ncloud_advisor_include_instances — Set instances to include in check result detail
  defineTool(
    server,
    "ncloud_advisor_include_instances",
    "Set instances to include in check result detail view. Marks specified instances to be shown in detailed results (reverses exclusion).",
    {
      categoryCode: z.enum(["SECURITY", "COST"]).describe("Check category code: SECURITY or COST"),
      itemCode: z.string().describe("Check item code"),
      instanceKeys: z.array(z.string()).describe("Array of instance keys to include in results"),
    },
    async (params) => {
      return client.requestRaw(
          "POST",
          `/api/v1/categories/${params.categoryCode}/checkitems/${params.itemCode}/result-detail/include`,
          undefined,
          params.instanceKeys
        );
    }
  );

  // ncloud_advisor_exclude_instances — Set instances to exclude from check result detail
  defineTool(
    server,
    "ncloud_advisor_exclude_instances",
    "Set instances to exclude from check result detail view. Marks specified instances to be hidden from detailed results.",
    {
      categoryCode: z.enum(["SECURITY", "COST"]).describe("Check category code: SECURITY or COST"),
      itemCode: z.string().describe("Check item code"),
      instanceKeys: z.array(z.string()).describe("Array of instance keys to exclude from results"),
    },
    async (params) => {
      return client.requestRaw(
          "POST",
          `/api/v1/categories/${params.categoryCode}/checkitems/${params.itemCode}/result-detail/exclude`,
          undefined,
          params.instanceKeys
        );
    }
  );

  // ncloud_advisor_download_category_results — Download check results for a category (Excel)
  defineTool(
    server,
    "ncloud_advisor_download_category_results",
    "Download check results for all items in a category. Returns the download URL or binary data for the Excel report.",
    {
      categoryCode: z.enum(["SECURITY", "COST"]).describe("Check category code: SECURITY or COST"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/v1/categories/${params.categoryCode}/checkitems/excel`);
    }
  );

  // ncloud_advisor_download_item_results — Download check results for a specific item (Excel)
  defineTool(
    server,
    "ncloud_advisor_download_item_results",
    "Download check results for a specific check item. Returns the download URL or binary data for the Excel report.",
    {
      categoryCode: z.enum(["SECURITY", "COST"]).describe("Check category code: SECURITY or COST"),
      itemCode: z.string().describe("Check item code"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/v1/categories/${params.categoryCode}/checkitems/${params.itemCode}/excel`);
    }
  );

  // ncloud_advisor_download_all_results — Download check results for all categories (Excel)
  defineTool(
    server,
    "ncloud_advisor_download_all_results",
    "Download check results for all categories. Returns the download URL or binary data for the complete Excel report.",
    {},
    async () => {
      return client.requestRaw("GET", "/api/v1/excel");
    }
  );
}
