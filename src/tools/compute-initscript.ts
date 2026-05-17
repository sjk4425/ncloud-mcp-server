import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";

export function registerComputeInitScriptTools(server: McpServer, client: NcloudClient): void {
  // ─── Query Tools ───────────────────────────────────────────────────────────

  server.tool(
    "ncloud_list_init_scripts",
    "List all init scripts in the current region",
    {
      initScriptNoList: z.array(z.string()).optional().describe("Filter by init script numbers"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/getInitScriptList", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_get_init_script_detail",
    "Get detailed information about a specific init script",
    {
      initScriptNo: z.string().describe("Init script number to query"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/getInitScriptDetail", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Create Tools ──────────────────────────────────────────────────────────

  server.tool(
    "ncloud_create_init_script",
    "Create a new init script",
    {
      initScriptContent: z.string().describe("Init script content (shell script)"),
      initScriptName: z.string().optional().describe("Init script name"),
      initScriptDescription: z.string().optional().describe("Init script description"),
      osTypeCode: z.string().optional().describe("OS type code (LNX or WND)"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/createInitScript", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Destructive Tools ─────────────────────────────────────────────────────

  server.tool(
    "ncloud_delete_init_scripts",
    "⚠️ Destructive: Permanently delete one or more init scripts. Set confirm=true to execute.",
    {
      initScriptNoList: z.array(z.string()).min(1).describe("List of init script numbers to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete InitScript [${params.initScriptNoList.join(", ")}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const { confirm, ...apiParams } = params;
        const result = await client.request("/vserver/v2/deleteInitScripts", apiParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
