import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";

export function registerComputePlacementTools(server: McpServer, client: NcloudClient): void {
  // ═══════════════════════════════════════════════════════════════════════════
  // Placement Group Tools
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Query Tools ───────────────────────────────────────────────────────────

  server.tool(
    "ncloud_list_placement_groups",
    "List all placement groups in the current region",
    {
      placementGroupNoList: z.array(z.string()).optional().describe("Filter by placement group numbers"),
      placementGroupName: z.string().optional().describe("Filter by placement group name"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/getPlacementGroupList", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_get_placement_group_detail",
    "Get detailed information about a specific placement group",
    {
      placementGroupNo: z.string({ required_error: "필수 파라미터 'placementGroupNo'가 누락되었습니다." }).describe("Placement group number to query"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/getPlacementGroupDetail", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Create Tool ─────────────────────────────────────────────────────────

  server.tool(
    "ncloud_create_placement_group",
    "Create a new placement group for physical server placement control",
    {
      placementGroupName: z.string().max(30, {
        message: "잘못된 파라미터: 'placementGroupName'은 30자 이하여야 합니다.",
      }).optional().describe("Placement group name (max 30 characters)"),
      placementGroupTypeCode: z.string().optional().describe("Placement group type code (default: AA - Anti-Affinity)"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/createPlacementGroup", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Server Management Tools ───────────────────────────────────────────────

  server.tool(
    "ncloud_add_placement_group_server",
    "Add a server instance to a placement group",
    {
      placementGroupNo: z.string({ required_error: "필수 파라미터 'placementGroupNo'가 누락되었습니다." }).describe("Placement group number"),
      serverInstanceNo: z.string({ required_error: "필수 파라미터 'serverInstanceNo'가 누락되었습니다." }).describe("Server instance number to add"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/addPlacementGroupServerInstance", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_remove_placement_group_server",
    "⚠️ Destructive: Remove a server instance from a placement group. Set confirm=true to execute.",
    {
      placementGroupNo: z.string({ required_error: "필수 파라미터 'placementGroupNo'가 누락되었습니다." }).describe("Placement group number"),
      serverInstanceNo: z.string({ required_error: "필수 파라미터 'serverInstanceNo'가 누락되었습니다." }).describe("Server instance number to remove"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will remove server [${params.serverInstanceNo}] from placement group [${params.placementGroupNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const { confirm, ...apiParams } = params;
        const result = await client.request("/vserver/v2/removePlacementGroupServerInstance", apiParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Destructive Tool ──────────────────────────────────────────────────────

  server.tool(
    "ncloud_delete_placement_group",
    "⚠️ Destructive: Permanently delete a placement group. Set confirm=true to execute.",
    {
      placementGroupNo: z.string({ required_error: "필수 파라미터 'placementGroupNo'가 누락되었습니다." }).describe("Placement group number to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete placement group [${params.placementGroupNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const { confirm, ...apiParams } = params;
        const result = await client.request("/vserver/v2/deletePlacementGroup", apiParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Fabric Cluster Tools
  // ═══════════════════════════════════════════════════════════════════════════

  // ─── Query Tools ───────────────────────────────────────────────────────────

  server.tool(
    "ncloud_list_fabric_clusters",
    "List all fabric clusters in the current region",
    {
      fabricClusterNoList: z.array(z.string()).optional().describe("Filter by fabric cluster numbers"),
      fabricClusterName: z.string().optional().describe("Filter by fabric cluster name"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/getFabricClusterList", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_get_fabric_cluster_detail",
    "Get detailed information about a specific fabric cluster",
    {
      fabricClusterNo: z.string({ required_error: "필수 파라미터 'fabricClusterNo'가 누락되었습니다." }).describe("Fabric cluster number to query"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/getFabricClusterDetail", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_get_fabric_cluster_pools",
    "List available fabric cluster pools (physical resource pools)",
    {
      fabricClusterPoolNoList: z.array(z.string()).optional().describe("Filter by fabric cluster pool numbers"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/getFabricClusterPoolList", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Create Tool ─────────────────────────────────────────────────────────

  server.tool(
    "ncloud_create_fabric_cluster",
    "Create a new fabric cluster for dedicated physical server grouping",
    {
      fabricClusterName: z.string({ required_error: "필수 파라미터 'fabricClusterName'이 누락되었습니다." }).max(30, {
        message: "잘못된 파라미터: 'fabricClusterName'은 30자 이하여야 합니다.",
      }).describe("Fabric cluster name (max 30 characters)"),
      fabricClusterPoolNo: z.string({ required_error: "필수 파라미터 'fabricClusterPoolNo'가 누락되었습니다." }).describe("Fabric cluster pool number"),
      fabricClusterDescription: z.string().optional().describe("Description for the fabric cluster"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/createFabricCluster", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Update Tool ─────────────────────────────────────────────────────────

  server.tool(
    "ncloud_update_fabric_cluster",
    "Update a fabric cluster's name or description",
    {
      fabricClusterNo: z.string({ required_error: "필수 파라미터 'fabricClusterNo'가 누락되었습니다." }).describe("Fabric cluster number to update"),
      fabricClusterName: z.string().max(30, {
        message: "잘못된 파라미터: 'fabricClusterName'은 30자 이하여야 합니다.",
      }).optional().describe("New fabric cluster name"),
      fabricClusterDescription: z.string().optional().describe("New description for the fabric cluster"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/updateFabricCluster", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Server Management Tool ────────────────────────────────────────────────

  server.tool(
    "ncloud_change_fabric_cluster_servers",
    "Change server instances assigned to a fabric cluster",
    {
      fabricClusterNo: z.string({ required_error: "필수 파라미터 'fabricClusterNo'가 누락되었습니다." }).describe("Fabric cluster number"),
      serverInstanceNoList: z.array(z.string()).describe("List of server instance numbers to assign to the fabric cluster"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/changeFabricClusterServerInstances", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Destructive Tool ──────────────────────────────────────────────────────

  server.tool(
    "ncloud_delete_fabric_cluster",
    "⚠️ Destructive: Permanently delete a fabric cluster. Set confirm=true to execute.",
    {
      fabricClusterNo: z.string({ required_error: "필수 파라미터 'fabricClusterNo'가 누락되었습니다." }).describe("Fabric cluster number to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete fabric cluster [${params.fabricClusterNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const { confirm, ...apiParams } = params;
        const result = await client.request("/vserver/v2/deleteFabricCluster", apiParams);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
