import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { toolText } from "./_response.js";

export function registerAcgTools(server: McpServer, client: NcloudClient): void {
  // ─── Query Tools ───────────────────────────────────────────────────────────

  server.tool(
    "ncloud_list_acgs",
    "List all Access Control Groups (ACGs) in the current region",
    {
      accessControlGroupNoList: z.array(z.string()).optional().describe("Filter by ACG numbers"),
      accessControlGroupName: z.string().optional().describe("Filter by ACG name"),
      accessControlGroupStatusCode: z.string().optional().describe("Filter by ACG status code (INIT | SET | RUN | TERMTING)"),
      vpcNo: z.string().optional().describe("Filter by VPC number"),
      pageNo: z.number().optional().describe("Page number for pagination (0 or 1 for first page)"),
      pageSize: z.number().optional().describe("Page size for pagination (1-1000, required when pageNo is set)"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/getAccessControlGroupList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_get_acg_detail",
    "Get detailed information about a specific Access Control Group",
    {
      accessControlGroupNo: z.string().describe("Access Control Group number"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/getAccessControlGroupDetail", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_get_acg_rules",
    "List all inbound and outbound rules for a specific ACG",
    {
      accessControlGroupNo: z.string().describe("Access Control Group number"),
      accessControlGroupRuleTypeCode: z.string().optional().describe("Filter by rule type (INBND: inbound, OTBND: outbound). Default: all rules"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/getAccessControlGroupRuleList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Create Tools ──────────────────────────────────────────────────────────

  server.tool(
    "ncloud_create_acg",
    "Create a new Access Control Group in a VPC",
    {
      vpcNo: z.string().describe("VPC number to create ACG in (required)"),
      accessControlGroupName: z.string().optional().describe("Name for the new ACG (3-30 chars, lowercase letters + numbers + '-', starts with letter, ends with letter or number). Auto-generated if omitted."),
      accessControlGroupDescription: z.string().optional().describe("Description for the ACG (0-1000 bytes)"),
    },
    async (params) => {
      try {
        const result = await client.request("/vserver/v2/createAccessControlGroup", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Rule Management Tools ─────────────────────────────────────────────────

  server.tool(
    "ncloud_add_acg_inbound_rule",
    "Add an inbound rule to an Access Control Group",
    {
      vpcNo: z.string().describe("VPC number (required)"),
      accessControlGroupNo: z.string().describe("ACG number to add rule to (required)"),
      protocolTypeCode: z.string().describe("Protocol type code (TCP, UDP, ICMP, or 1-254 protocol number)"),
      ipBlock: z.string().optional().describe("Access source IP block in CIDR format (e.g., 0.0.0.0/0). Cannot be used with accessControlGroupSequence."),
      accessControlGroupSequence: z.string().optional().describe("Access source ACG number (alternative to ipBlock). Cannot be used with ipBlock."),
      portRange: z.string().optional().describe("Allowed port range (e.g., 22, 1-65535). Required if protocol is TCP or UDP."),
      accessControlGroupRuleDescription: z.string().optional().describe("Rule description (0-1000 bytes)"),
    },
    async (params) => {
      try {
        const { vpcNo, accessControlGroupNo, protocolTypeCode, ipBlock, accessControlGroupSequence, portRange, accessControlGroupRuleDescription } = params;
        const requestParams: any = {
          vpcNo,
          accessControlGroupNo,
          "accessControlGroupRuleList.1.protocolTypeCode": protocolTypeCode,
        };
        if (ipBlock) {
          requestParams["accessControlGroupRuleList.1.ipBlock"] = ipBlock;
        }
        if (accessControlGroupSequence) {
          requestParams["accessControlGroupRuleList.1.accessControlGroupSequence"] = accessControlGroupSequence;
        }
        if (portRange) {
          requestParams["accessControlGroupRuleList.1.portRange"] = portRange;
        }
        if (accessControlGroupRuleDescription) {
          requestParams["accessControlGroupRuleList.1.accessControlGroupRuleDescription"] = accessControlGroupRuleDescription;
        }
        const result = await client.request("/vserver/v2/addAccessControlGroupInboundRule", requestParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_add_acg_outbound_rule",
    "Add an outbound rule to an Access Control Group",
    {
      vpcNo: z.string().describe("VPC number (required)"),
      accessControlGroupNo: z.string().describe("ACG number to add rule to (required)"),
      protocolTypeCode: z.string().describe("Protocol type code (TCP, UDP, ICMP, or 1-254 protocol number)"),
      ipBlock: z.string().optional().describe("Destination IP block in CIDR format (e.g., 0.0.0.0/0). Cannot be used with accessControlGroupSequence."),
      accessControlGroupSequence: z.string().optional().describe("Destination ACG number (alternative to ipBlock). Cannot be used with ipBlock."),
      portRange: z.string().optional().describe("Allowed port range (e.g., 80, 1-65535). Required if protocol is TCP or UDP."),
      accessControlGroupRuleDescription: z.string().optional().describe("Rule description (0-1000 bytes)"),
    },
    async (params) => {
      try {
        const { vpcNo, accessControlGroupNo, protocolTypeCode, ipBlock, accessControlGroupSequence, portRange, accessControlGroupRuleDescription } = params;
        const requestParams: any = {
          vpcNo,
          accessControlGroupNo,
          "accessControlGroupRuleList.1.protocolTypeCode": protocolTypeCode,
        };
        if (ipBlock) {
          requestParams["accessControlGroupRuleList.1.ipBlock"] = ipBlock;
        }
        if (accessControlGroupSequence) {
          requestParams["accessControlGroupRuleList.1.accessControlGroupSequence"] = accessControlGroupSequence;
        }
        if (portRange) {
          requestParams["accessControlGroupRuleList.1.portRange"] = portRange;
        }
        if (accessControlGroupRuleDescription) {
          requestParams["accessControlGroupRuleList.1.accessControlGroupRuleDescription"] = accessControlGroupRuleDescription;
        }
        const result = await client.request("/vserver/v2/addAccessControlGroupOutboundRule", requestParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Destructive Tools (with confirm gate) ─────────────────────────────────

  server.tool(
    "ncloud_delete_acg",
    "⚠️ Destructive: Delete an Access Control Group. Set confirm=true to execute.",
    {
      vpcNo: z.string().describe("VPC number (required)"),
      accessControlGroupNo: z.string().describe("ACG number to delete (required)"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete ACG [${params.accessControlGroupNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const { confirm, ...apiParams } = params;
        const result = await client.request("/vserver/v2/deleteAccessControlGroup", apiParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_remove_acg_inbound_rule",
    "⚠️ Destructive: Remove an inbound rule from an Access Control Group. Set confirm=true to execute.",
    {
      vpcNo: z.string().describe("VPC number (required)"),
      accessControlGroupNo: z.string().describe("ACG number to remove rule from (required)"),
      protocolTypeCode: z.string().describe("Protocol type code (TCP, UDP, ICMP, or protocol number)"),
      ipBlock: z.string().optional().describe("IP block in CIDR format. Cannot be used with accessControlGroupSequence."),
      accessControlGroupSequence: z.string().optional().describe("Source ACG number. Cannot be used with ipBlock."),
      portRange: z.string().optional().describe("Port range (e.g., 80, 1-65535). Required if protocol is TCP or UDP."),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently remove inbound rule from ACG [${params.accessControlGroupNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const { confirm, vpcNo, accessControlGroupNo, protocolTypeCode, ipBlock, accessControlGroupSequence, portRange } = params;
        const requestParams: any = {
          vpcNo,
          accessControlGroupNo,
          "accessControlGroupRuleList.1.protocolTypeCode": protocolTypeCode,
        };
        if (ipBlock) {
          requestParams["accessControlGroupRuleList.1.ipBlock"] = ipBlock;
        }
        if (accessControlGroupSequence) {
          requestParams["accessControlGroupRuleList.1.accessControlGroupSequence"] = accessControlGroupSequence;
        }
        if (portRange) {
          requestParams["accessControlGroupRuleList.1.portRange"] = portRange;
        }
        const result = await client.request("/vserver/v2/removeAccessControlGroupInboundRule", requestParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_remove_acg_outbound_rule",
    "⚠️ Destructive: Remove an outbound rule from an Access Control Group. Set confirm=true to execute.",
    {
      vpcNo: z.string().describe("VPC number (required)"),
      accessControlGroupNo: z.string().describe("ACG number to remove rule from (required)"),
      protocolTypeCode: z.string().describe("Protocol type code (TCP, UDP, ICMP, or protocol number)"),
      ipBlock: z.string().optional().describe("IP block in CIDR format. Cannot be used with accessControlGroupSequence."),
      accessControlGroupSequence: z.string().optional().describe("Destination ACG number. Cannot be used with ipBlock."),
      portRange: z.string().optional().describe("Port range (e.g., 80, 1-65535). Required if protocol is TCP or UDP."),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently remove outbound rule from ACG [${params.accessControlGroupNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const { confirm, vpcNo, accessControlGroupNo, protocolTypeCode, ipBlock, accessControlGroupSequence, portRange } = params;
        const requestParams: any = {
          vpcNo,
          accessControlGroupNo,
          "accessControlGroupRuleList.1.protocolTypeCode": protocolTypeCode,
        };
        if (ipBlock) {
          requestParams["accessControlGroupRuleList.1.ipBlock"] = ipBlock;
        }
        if (accessControlGroupSequence) {
          requestParams["accessControlGroupRuleList.1.accessControlGroupSequence"] = accessControlGroupSequence;
        }
        if (portRange) {
          requestParams["accessControlGroupRuleList.1.portRange"] = portRange;
        }
        const result = await client.request("/vserver/v2/removeAccessControlGroupOutboundRule", requestParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
