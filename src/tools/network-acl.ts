import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { toolText } from "./_response.js";

export function registerNetworkAclTools(server: McpServer, client: NcloudClient): void {
  // ─── Query Tools ───────────────────────────────────────────────────────────

  server.tool(
    "ncloud_list_network_acls",
    "List all Network ACLs in the current region",
    {
      networkAclNoList: z.array(z.string()).optional().describe("Filter by Network ACL numbers"),
      networkAclName: z.string().optional().describe("Filter by Network ACL name"),
      vpcNo: z.string().optional().describe("Filter by VPC number"),
    },
    async (params) => {
      try {
        const result = await client.request("/vpc/v2/getNetworkAclList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_get_network_acl_detail",
    "Get detailed information about a specific Network ACL",
    {
      networkAclNo: z.string().describe("Network ACL number to query"),
    },
    async (params) => {
      try {
        const result = await client.request("/vpc/v2/getNetworkAclDetail", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_get_network_acl_rules",
    "List all inbound and outbound rules for a specific Network ACL",
    {
      networkAclNo: z.string().describe("Network ACL number"),
      networkAclRuleTypeCode: z.string().optional().describe("Filter by rule type (INBND, OTBND)"),
    },
    async (params) => {
      try {
        const result = await client.request("/vpc/v2/getNetworkAclRuleList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Create Tool ─────────────────────────────────────────────────────────

  server.tool(
    "ncloud_create_network_acl",
    "Create a new Network ACL in a VPC",
    {
      vpcNo: z.string({ required_error: "필수 파라미터 'vpcNo'가 누락되었습니다." }).describe("VPC number to create Network ACL in"),
      networkAclName: z.string().max(30, {
        message: "잘못된 파라미터: 'networkAclName'은 30자 이하여야 합니다.",
      }).optional().describe("Network ACL name (max 30 characters)"),
      networkAclDescription: z.string().optional().describe("Description for the Network ACL"),
    },
    async (params) => {
      try {
        const result = await client.request("/vpc/v2/createNetworkAcl", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Rule Management Tools ─────────────────────────────────────────────────

  server.tool(
    "ncloud_add_network_acl_inbound",
    "Add an inbound rule to a Network ACL",
    {
      networkAclNo: z.string({ required_error: "필수 파라미터 'networkAclNo'가 누락되었습니다." }).describe("Network ACL number"),
      priority: z.number({ required_error: "필수 파라미터 'priority'가 누락되었습니다." }).describe("Rule priority (1-199)"),
      protocolTypeCode: z.string({ required_error: "필수 파라미터 'protocolTypeCode'가 누락되었습니다." }).describe("Protocol type code (TCP, UDP, ICMP)"),
      ruleActionCode: z.string({ required_error: "필수 파라미터 'ruleActionCode'가 누락되었습니다." }).describe("Rule action (ALLOW or DROP)"),
      ipBlock: z.string().optional().describe("IP block in CIDR format (e.g., 0.0.0.0/0)"),
      denyAllowGroupNo: z.string().optional().describe("Deny-Allow Group number (alternative to ipBlock)"),
      portRange: z.string().optional().describe("Port range (e.g., 80, 1-65535)"),
      ruleDescription: z.string().optional().describe("Description for the rule"),
    },
    async (params) => {
      try {
        const { networkAclNo, priority, protocolTypeCode, ruleActionCode, ipBlock, denyAllowGroupNo, portRange, ruleDescription } = params;
        const requestParams: any = {
          networkAclNo,
          "networkAclRuleList.1.priority": priority,
          "networkAclRuleList.1.protocolTypeCode": protocolTypeCode,
          "networkAclRuleList.1.ruleActionCode": ruleActionCode,
        };
        if (ipBlock) requestParams["networkAclRuleList.1.ipBlock"] = ipBlock;
        if (denyAllowGroupNo) requestParams["networkAclRuleList.1.denyAllowGroupNo"] = denyAllowGroupNo;
        if (portRange) requestParams["networkAclRuleList.1.portRange"] = portRange;
        if (ruleDescription) requestParams["networkAclRuleList.1.ruleDescription"] = ruleDescription;
        const result = await client.request("/vpc/v2/addNetworkAclInboundRule", requestParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_add_network_acl_outbound",
    "Add an outbound rule to a Network ACL",
    {
      networkAclNo: z.string({ required_error: "필수 파라미터 'networkAclNo'가 누락되었습니다." }).describe("Network ACL number"),
      priority: z.number({ required_error: "필수 파라미터 'priority'가 누락되었습니다." }).describe("Rule priority (1-199)"),
      protocolTypeCode: z.string({ required_error: "필수 파라미터 'protocolTypeCode'가 누락되었습니다." }).describe("Protocol type code (TCP, UDP, ICMP)"),
      ruleActionCode: z.string({ required_error: "필수 파라미터 'ruleActionCode'가 누락되었습니다." }).describe("Rule action (ALLOW or DROP)"),
      ipBlock: z.string().optional().describe("IP block in CIDR format (e.g., 0.0.0.0/0)"),
      denyAllowGroupNo: z.string().optional().describe("Deny-Allow Group number (alternative to ipBlock)"),
      portRange: z.string().optional().describe("Port range (e.g., 80, 1-65535)"),
      ruleDescription: z.string().optional().describe("Description for the rule"),
    },
    async (params) => {
      try {
        const { networkAclNo, priority, protocolTypeCode, ruleActionCode, ipBlock, denyAllowGroupNo, portRange, ruleDescription } = params;
        const requestParams: any = {
          networkAclNo,
          "networkAclRuleList.1.priority": priority,
          "networkAclRuleList.1.protocolTypeCode": protocolTypeCode,
          "networkAclRuleList.1.ruleActionCode": ruleActionCode,
        };
        if (ipBlock) requestParams["networkAclRuleList.1.ipBlock"] = ipBlock;
        if (denyAllowGroupNo) requestParams["networkAclRuleList.1.denyAllowGroupNo"] = denyAllowGroupNo;
        if (portRange) requestParams["networkAclRuleList.1.portRange"] = portRange;
        if (ruleDescription) requestParams["networkAclRuleList.1.ruleDescription"] = ruleDescription;
        const result = await client.request("/vpc/v2/addNetworkAclOutboundRule", requestParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Subnet Network ACL Assignment ─────────────────────────────────────────

  server.tool(
    "ncloud_set_subnet_network_acl",
    "Set the Network ACL for a subnet",
    {
      networkAclNo: z.string({ required_error: "필수 파라미터 'networkAclNo'가 누락되었습니다." }).describe("Network ACL number to assign"),
      subnetNo: z.string({ required_error: "필수 파라미터 'subnetNo'가 누락되었습니다." }).describe("Subnet number to assign the Network ACL to"),
    },
    async (params) => {
      try {
        const result = await client.request("/vpc/v2/setSubnetNetworkAcl", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Destructive Tools (with confirm gate) ─────────────────────────────────

  server.tool(
    "ncloud_delete_network_acl",
    "⚠️ Destructive: Permanently delete a Network ACL. Set confirm=true to execute.",
    {
      networkAclNo: z.string({ required_error: "필수 파라미터 'networkAclNo'가 누락되었습니다." }).describe("Network ACL number to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete Network ACL [${params.networkAclNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const { confirm, ...apiParams } = params;
        const result = await client.request("/vpc/v2/deleteNetworkAcl", apiParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_remove_network_acl_inbound",
    "⚠️ Destructive: Remove an inbound rule from a Network ACL. Set confirm=true to execute.",
    {
      networkAclNo: z.string({ required_error: "필수 파라미터 'networkAclNo'가 누락되었습니다." }).describe("Network ACL number"),
      priority: z.number({ required_error: "필수 파라미터 'priority'가 누락되었습니다." }).describe("Rule priority to remove"),
      protocolTypeCode: z.string({ required_error: "필수 파라미터 'protocolTypeCode'가 누락되었습니다." }).describe("Protocol type code (TCP, UDP, ICMP)"),
      ruleActionCode: z.string({ required_error: "필수 파라미터 'ruleActionCode'가 누락되었습니다." }).describe("Rule action (ALLOW or DROP)"),
      ipBlock: z.string().optional().describe("IP block in CIDR format"),
      denyAllowGroupNo: z.string().optional().describe("Deny-Allow Group number"),
      portRange: z.string().optional().describe("Port range (e.g., 80, 1-65535)"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently remove inbound rule (priority: ${params.priority}) from Network ACL [${params.networkAclNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const { confirm, networkAclNo, priority, protocolTypeCode, ruleActionCode, ipBlock, denyAllowGroupNo, portRange } = params;
        const requestParams: any = {
          networkAclNo,
          "networkAclRuleList.1.priority": priority,
          "networkAclRuleList.1.protocolTypeCode": protocolTypeCode,
          "networkAclRuleList.1.ruleActionCode": ruleActionCode,
        };
        if (ipBlock) requestParams["networkAclRuleList.1.ipBlock"] = ipBlock;
        if (denyAllowGroupNo) requestParams["networkAclRuleList.1.denyAllowGroupNo"] = denyAllowGroupNo;
        if (portRange) requestParams["networkAclRuleList.1.portRange"] = portRange;
        const result = await client.request("/vpc/v2/removeNetworkAclInboundRule", requestParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_remove_network_acl_outbound",
    "⚠️ Destructive: Remove an outbound rule from a Network ACL. Set confirm=true to execute.",
    {
      networkAclNo: z.string({ required_error: "필수 파라미터 'networkAclNo'가 누락되었습니다." }).describe("Network ACL number"),
      priority: z.number({ required_error: "필수 파라미터 'priority'가 누락되었습니다." }).describe("Rule priority to remove"),
      protocolTypeCode: z.string({ required_error: "필수 파라미터 'protocolTypeCode'가 누락되었습니다." }).describe("Protocol type code (TCP, UDP, ICMP)"),
      ruleActionCode: z.string({ required_error: "필수 파라미터 'ruleActionCode'가 누락되었습니다." }).describe("Rule action (ALLOW or DROP)"),
      ipBlock: z.string().optional().describe("IP block in CIDR format"),
      denyAllowGroupNo: z.string().optional().describe("Deny-Allow Group number"),
      portRange: z.string().optional().describe("Port range (e.g., 80, 1-65535)"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently remove outbound rule (priority: ${params.priority}) from Network ACL [${params.networkAclNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const { confirm, networkAclNo, priority, protocolTypeCode, ruleActionCode, ipBlock, denyAllowGroupNo, portRange } = params;
        const requestParams: any = {
          networkAclNo,
          "networkAclRuleList.1.priority": priority,
          "networkAclRuleList.1.protocolTypeCode": protocolTypeCode,
          "networkAclRuleList.1.ruleActionCode": ruleActionCode,
        };
        if (ipBlock) requestParams["networkAclRuleList.1.ipBlock"] = ipBlock;
        if (denyAllowGroupNo) requestParams["networkAclRuleList.1.denyAllowGroupNo"] = denyAllowGroupNo;
        if (portRange) requestParams["networkAclRuleList.1.portRange"] = portRange;
        const result = await client.request("/vpc/v2/removeNetworkAclOutboundRule", requestParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Network ACL Description ─────────────────────────────────────────────

  server.tool(
    "ncloud_set_network_acl_description",
    "Set or update the description of a Network ACL",
    {
      networkAclNo: z.string({ required_error: "필수 파라미터 'networkAclNo'가 누락되었습니다." }).describe("Network ACL number"),
      networkAclDescription: z.string({ required_error: "필수 파라미터 'networkAclDescription'이 누락되었습니다." }).describe("New description for the Network ACL"),
    },
    async (params) => {
      try {
        const result = await client.request("/vpc/v2/setNetworkAclDescription", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Deny-Allow Group Tools ────────────────────────────────────────────────

  server.tool(
    "ncloud_list_deny_allow_groups",
    "List Network ACL Deny-Allow Groups",
    {
      networkAclDenyAllowGroupNoList: z.array(z.string()).optional().describe("Filter by Deny-Allow Group numbers"),
      networkAclDenyAllowGroupName: z.string().optional().describe("Filter by Deny-Allow Group name"),
      vpcNo: z.string().optional().describe("Filter by VPC number"),
    },
    async (params) => {
      try {
        const result = await client.request("/vpc/v2/getNetworkAclDenyAllowGroupList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_get_deny_allow_group_detail",
    "Get detailed information about a specific Deny-Allow Group",
    {
      networkAclDenyAllowGroupNo: z.string({ required_error: "필수 파라미터 'networkAclDenyAllowGroupNo'가 누락되었습니다." }).describe("Deny-Allow Group number to query"),
    },
    async (params) => {
      try {
        const result = await client.request("/vpc/v2/getNetworkAclDenyAllowGroupDetail", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_create_deny_allow_group",
    "Create a new Network ACL Deny-Allow Group in a VPC",
    {
      vpcNo: z.string({ required_error: "필수 파라미터 'vpcNo'가 누락되었습니다." }).describe("VPC number to create the Deny-Allow Group in"),
      networkAclDenyAllowGroupName: z.string().optional().describe("Name for the Deny-Allow Group"),
      networkAclDenyAllowGroupDescription: z.string().optional().describe("Description for the Deny-Allow Group"),
    },
    async (params) => {
      try {
        const result = await client.request("/vpc/v2/createNetworkAclDenyAllowGroup", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_delete_deny_allow_group",
    "⚠️ Destructive: Permanently delete a Network ACL Deny-Allow Group. Set confirm=true to execute.",
    {
      networkAclDenyAllowGroupNo: z.string({ required_error: "필수 파라미터 'networkAclDenyAllowGroupNo'가 누락되었습니다." }).describe("Deny-Allow Group number to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete Deny-Allow Group [${params.networkAclDenyAllowGroupNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const { confirm, ...apiParams } = params;
        const result = await client.request("/vpc/v2/deleteNetworkAclDenyAllowGroup", apiParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_set_deny_allow_group_ips",
    "Set the IP list for a Network ACL Deny-Allow Group",
    {
      networkAclDenyAllowGroupNo: z.string({ required_error: "필수 파라미터 'networkAclDenyAllowGroupNo'가 누락되었습니다." }).describe("Deny-Allow Group number"),
      ipList: z.array(z.string()).describe("List of IP addresses to set for the Deny-Allow Group"),
    },
    async (params) => {
      try {
        const { networkAclDenyAllowGroupNo, ipList } = params;
        const requestParams: any = { networkAclDenyAllowGroupNo };
        for (let i = 0; i < ipList.length; i++) {
          requestParams[`ipList.${i + 1}`] = ipList[i];
        }
        const result = await client.request("/vpc/v2/setNetworkAclDenyAllowGroupIpList", requestParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_set_deny_allow_group_desc",
    "Set or update the description of a Network ACL Deny-Allow Group",
    {
      networkAclDenyAllowGroupNo: z.string({ required_error: "필수 파라미터 'networkAclDenyAllowGroupNo'가 누락되었습니다." }).describe("Deny-Allow Group number"),
      networkAclDenyAllowGroupDescription: z.string({ required_error: "필수 파라미터 'networkAclDenyAllowGroupDescription'이 누락되었습니다." }).describe("New description for the Deny-Allow Group"),
    },
    async (params) => {
      try {
        const result = await client.request("/vpc/v2/setNetworkAclDenyAllowGroupDescription", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
