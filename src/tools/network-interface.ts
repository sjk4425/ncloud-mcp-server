import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { dryRunMessage } from "./_messages.js";

export function registerNetworkInterfaceTools(server: McpServer, client: NcloudClient): void {
  // ─── Query Tools ───────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_network_interfaces",
    "List all network interfaces in the current region",
    {
      networkInterfaceNoList: z.array(z.string()).optional().describe("Filter by network interface numbers"),
      subnetNo: z.string().optional().describe("Filter by subnet number"),
      serverInstanceNo: z.string().optional().describe("Filter by attached server instance number"),
      pageNo: z.number().optional().describe("Page number for pagination"),
      pageSize: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      return client.request("/vserver/v2/getNetworkInterfaceList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_network_interface_detail",
    "Get detailed information about a specific network interface",
    {
      networkInterfaceNo: z.string().describe("Network interface number to query"),
    },
    async (params) => {
      return client.request("/vserver/v2/getNetworkInterfaceDetail", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_flow_log_config",
    "Get FlowLog configuration list. Returns all FlowLog configurations or filters by network interface number.",
    {
      networkInterfaceNo: z.string().optional().describe("Network interface number to filter FlowLog configurations"),
    },
    async (params) => {
      return client.request("/vserver/v2/getFlowLogConfigurationList", params);
    }
  );

  // ─── Create Tools ──────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_create_network_interface",
    "Create a new network interface. Use dryRun=true to preview.",
    {
      subnetNo: z.string().describe("Subnet number to create the network interface in"),
      accessControlGroupNoList: z.array(z.string()).min(1).describe("List of ACG numbers to apply"),
      networkInterfaceName: z.string().optional().describe("Network interface name"),
      networkInterfaceDescription: z.string().optional().describe("Network interface description"),
      privateIp: z.string().optional().describe("Private IP address to assign"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating"),
    },
    async (params) => {
      if (params.dryRun) {
        const preview = {
          label: "🔍 Dry-Run Preview: Network Interface Creation",
          subnetNo: params.subnetNo,
          accessControlGroupNoList: params.accessControlGroupNoList,
          networkInterfaceName: params.networkInterfaceName ?? "(auto-generated)",
          privateIp: params.privateIp ?? "(auto-assigned)",
          message: dryRunMessage({ ko: "네트워크 인터페이스", en: "network interface" }),
        };
        return preview;
      }
      const { dryRun, ...apiParams } = params;
      const result = await client.request("/vserver/v2/createNetworkInterface", apiParams);
      return result;
    }
  );

  // ─── Operation Tools ───────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_attach_network_interface",
    "Attach a network interface to a server instance",
    {
      networkInterfaceNo: z.string().describe("Network interface number to attach"),
      serverInstanceNo: z.string().describe("Server instance number to attach to"),
    },
    async (params) => {
      return client.request("/vserver/v2/attachNetworkInterface", params);
    }
  );

  defineTool(
    server,
    "ncloud_detach_network_interface",
    "Detach a network interface from a server instance",
    {
      networkInterfaceNo: z.string().describe("Network interface number to detach"),
      serverInstanceNo: z.string().describe("Server instance number to detach from"),
    },
    async (params) => {
      return client.request("/vserver/v2/detachNetworkInterface", params);
    }
  );


  defineTool(
    server,
    "ncloud_add_nic_acg",
    "Add access control groups (ACGs) to a network interface",
    {
      networkInterfaceNo: z.string().describe("Network interface number to add ACGs to"),
      accessControlGroupNoList: z.array(z.string()).min(1).describe("List of ACG numbers to add"),
    },
    async (params) => {
      return client.request("/vserver/v2/addNetworkInterfaceAccessControlGroup", params);
    }
  );

  defineTool(
    server,
    "ncloud_assign_secondary_ips",
    "Assign secondary IPs to a network interface. Provide either secondaryIpList (specific IPs) or secondaryIpCount (auto-assign count).",
    {
      networkInterfaceNo: z.string().describe("Network interface number to assign secondary IPs to"),
      secondaryIpList: z.array(z.string()).optional().describe("List of specific secondary IP addresses to assign"),
      secondaryIpCount: z.number().optional().describe("Number of secondary IPs to auto-assign"),
    },
    async (params) => {
      return client.request("/vserver/v2/assignSecondaryIps", params);
    }
  );

  defineTool(
    server,
    "ncloud_unassign_secondary_ips",
    "Unassign (release) secondary IPs from a network interface",
    {
      networkInterfaceNo: z.string().describe("Network interface number to unassign secondary IPs from"),
      secondaryIpList: z.array(z.string()).min(1).describe("List of secondary IP addresses to unassign"),
    },
    async (params) => {
      return client.request("/vserver/v2/unassignSecondaryIps", params);
    }
  );

  defineTool(
    server,
    "ncloud_enable_flow_log",
    "Enable FlowLog on a network interface. Captures network traffic logs and stores them in the specified bucket.",
    {
      networkInterfaceNo: z.string().describe("Network interface number to enable FlowLog on"),
      flowLogBucketName: z.string().describe("Object Storage bucket name to store FlowLog data"),
      flowLogStatusTypeCode: z.string().optional().describe("FlowLog status type code (ACCEPT, REJECT, ALL)"),
    },
    async (params) => {
      return client.request("/vserver/v2/enableFlowLog", params);
    }
  );

  defineTool(
    server,
    "ncloud_disable_flow_log",
    "Disable FlowLog on a network interface. Stops capturing network traffic logs.",
    {
      networkInterfaceNo: z.string().describe("Network interface number to disable FlowLog on"),
    },
    async (params) => {
      return client.request("/vserver/v2/disableFlowLog", params);
    }
  );

  // ─── Destructive Tools ─────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_remove_nic_acg",
    "⚠️ DESTRUCTIVE: Remove access control groups (ACGs) from a network interface. Set confirm=true to execute.",
    {
      networkInterfaceNo: z.string().describe("Network interface number to remove ACGs from"),
      accessControlGroupNoList: z.array(z.string()).min(1).describe("List of ACG numbers to remove"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vserver/v2/removeNetworkInterfaceAccessControlGroup", apiParams);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will remove ACG(s) [${params.accessControlGroupNoList.join(", ")}] from NetworkInterface [${params.networkInterfaceNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.` } }
  );

  defineTool(
    server,
    "ncloud_delete_network_interface",
    "⚠️ Destructive: Permanently delete a network interface. Set confirm=true to execute.",
    {
      networkInterfaceNo: z.string().describe("Network interface number to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vserver/v2/deleteNetworkInterface", apiParams);
      return result;
    },
    { destructive: { noun: "NetworkInterface", describe: (params) => params.networkInterfaceNo } }
  );
}
