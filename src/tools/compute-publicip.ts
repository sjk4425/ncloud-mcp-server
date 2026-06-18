import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { requiredError } from "./_messages.js";

export function registerComputePublicIpTools(server: McpServer, client: NcloudClient): void {
  // ─── Query Tools ───────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_public_ips",
    "List all public IP instances in the current region",
    {
      publicIpInstanceNoList: z.array(z.string()).optional().describe("Filter by public IP instance numbers"),
      isAssociated: z.boolean().optional().describe("Filter by association status"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      return client.request("/vserver/v2/getPublicIpInstanceList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_public_ip_detail",
    "Get detailed information about a specific public IP instance",
    {
      publicIpInstanceNo: z.string().describe("Public IP instance number"),
    },
    async (params) => {
      return client.request("/vserver/v2/getPublicIpInstanceDetail", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_public_ip_target_servers",
    "List server instances that can be assigned a public IP",
    {},
    async () => {
      return client.request("/vserver/v2/getPublicIpTargetServerInstanceList");
    }
  );

  // ─── Create & Associate Tools ──────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_create_public_ip",
    "Create a new public IP instance",
    {
      serverInstanceNo: z.string().optional().describe("Server instance number to associate with immediately"),
      publicIpDescription: z.string().optional().describe("Description for the public IP"),
    },
    async (params) => {
      return client.request("/vserver/v2/createPublicIpInstance", params);
    }
  );

  defineTool(
    server,
    "ncloud_associate_public_ip",
    "Associate a public IP with a server instance",
    {
      publicIpInstanceNo: z.string({ required_error: requiredError("publicIpInstanceNo") }).describe("Public IP instance number"),
      serverInstanceNo: z.string({ required_error: requiredError("serverInstanceNo") }).describe("Server instance number to associate with"),
    },
    async (params) => {
      return client.request("/vserver/v2/associatePublicIpWithServerInstance", params);
    }
  );

  defineTool(
    server,
    "ncloud_disassociate_public_ip",
    "Disassociate a public IP from its currently associated server instance",
    {
      publicIpInstanceNo: z.string({ required_error: requiredError("publicIpInstanceNo") }).describe("Public IP instance number to disassociate"),
    },
    async (params) => {
      return client.request("/vserver/v2/disassociatePublicIpFromServerInstance", params);
    }
  );

  // ─── Destructive Tools (with confirm gate) ─────────────────────────────────
  // Destructive tool includes:
  // 1. "⚠️ Destructive" in description
  // 2. confirm parameter (default false) that gates API execution
  // 3. Required parameter validation via zod

  defineTool(
    server,
    "ncloud_delete_public_ip",
    "⚠️ Destructive: Delete a public IP instance. Set confirm=true to execute.",
    {
      publicIpInstanceNo: z.string({ required_error: requiredError("publicIpInstanceNo") }).describe("Public IP instance number to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vserver/v2/deletePublicIpInstance", apiParams);
      return result;
    },
    { destructive: { noun: "PublicIP", describe: (params) => params.publicIpInstanceNo } }
  );
}
