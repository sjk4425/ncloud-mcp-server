import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";

export function registerComputeLoginKeyTools(server: McpServer, client: NcloudClient): void {
  // ─── Query Tools ───────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_login_keys",
    "List all login keys in the current region",
    {
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      return client.request("/vserver/v2/getLoginKeyList", params);
    }
  );

  // ─── Create Tools ──────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_create_login_key",
    "Create a new login key and return the private key",
    {
      keyName: z.string().describe("Name for the new login key"),
    },
    async (params) => {
      return client.request("/vserver/v2/createLoginKey", params);
    }
  );

  defineTool(
    server,
    "ncloud_import_login_key",
    "Import an SSH public key as a login key",
    {
      keyName: z.string().describe("Name for the login key"),
      publicKey: z.string().describe("SSH public key content to import"),
    },
    async (params) => {
      return client.request("/vserver/v2/importLoginKey", params);
    }
  );

  // ─── Destructive Tools ─────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_login_keys",
    "⚠️ Destructive: Permanently delete one or more login keys. Set confirm=true to execute.",
    {
      keyNameList: z.array(z.string()).min(1).describe("List of login key names to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vserver/v2/deleteLoginKeys", apiParams);
      return result;
    },
    { destructive: { noun: "LoginKey", describe: (params) => params.keyNameList.join(", ") } }
  );
}
