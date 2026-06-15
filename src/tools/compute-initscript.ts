import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";

export function registerComputeInitScriptTools(server: McpServer, client: NcloudClient): void {
  // ─── Query Tools ───────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_init_scripts",
    "List all init scripts in the current region",
    {
      initScriptNoList: z.array(z.string()).optional().describe("Filter by init script numbers"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      return client.request("/vserver/v2/getInitScriptList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_init_script_detail",
    "Get detailed information about a specific init script",
    {
      initScriptNo: z.string().describe("Init script number to query"),
    },
    async (params) => {
      return client.request("/vserver/v2/getInitScriptDetail", params);
    }
  );

  // ─── Create Tools ──────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_create_init_script",
    "Create a new init script",
    {
      initScriptContent: z.string().describe("Init script content (shell script)"),
      initScriptName: z.string().optional().describe("Init script name"),
      initScriptDescription: z.string().optional().describe("Init script description"),
      osTypeCode: z.string().optional().describe("OS type code (LNX or WND)"),
    },
    async (params) => {
      return client.request("/vserver/v2/createInitScript", params);
    }
  );

  // ─── Destructive Tools ─────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_init_scripts",
    "⚠️ Destructive: Permanently delete one or more init scripts. Set confirm=true to execute.",
    {
      initScriptNoList: z.array(z.string()).min(1).describe("List of init script numbers to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vserver/v2/deleteInitScripts", apiParams);
      return result;
    },
    { destructive: { noun: "InitScript", describe: (params) => params.initScriptNoList.join(", ") } }
  );
}
