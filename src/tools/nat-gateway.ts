import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";

export function registerNatGatewayTools(server: McpServer, client: NcloudClient): void {
  // ─── Query Tools ───────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_nat_gateways",
    "List all NAT Gateway instances in the current region",
    {
      natGatewayInstanceNoList: z.array(z.string()).optional().describe("Filter by NAT Gateway instance numbers"),
      natGatewayName: z.string().optional().describe("Filter by NAT Gateway name"),
      vpcName: z.string().optional().describe("Filter by VPC name"),
      publicIp: z.string().optional().describe("Filter by public IP address assigned to the NAT Gateway"),
      zoneCode: z.string().optional().describe("Filter by zone code (e.g., KR-1, KR-2)"),
      natGatewayInstanceStatusCode: z.enum(["INIT", "RUN", "SET", "TERMTING"]).optional().describe("Filter by NAT Gateway instance status code"),
      natGatewayTypeCode: z.enum(["PRVT", "PBLIP"]).optional().describe("Filter by NAT Gateway type (PRVT: Private, PBLIP: Public)"),
      subnetName: z.string().optional().describe("Filter by subnet name"),
      subnetNo: z.string().optional().describe("Filter by subnet number"),
      privateIp: z.string().optional().describe("Filter by private IP address"),
      publicIpInstanceNo: z.string().optional().describe("Filter by public IP instance number"),
      pageNo: z.number().optional().describe("Page number for paged results"),
      pageSize: z.number().optional().describe("Page size for paged results (required when pageNo is specified)"),
    },
    async (params) => {
      return client.request("/vpc/v2/getNatGatewayInstanceList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_nat_gateway_detail",
    "Get detailed information about a specific NAT Gateway",
    {
      natGatewayInstanceNo: z.string().describe("NAT Gateway instance number to query"),
    },
    async (params) => {
      return client.request("/vpc/v2/getNatGatewayInstanceDetail", params);
    }
  );

  // ─── Create Tool ─────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_create_nat_gateway",
    "Create a new NAT Gateway instance in a VPC. Supports both Public (PBLIP) and Private (PRVT) types.",
    {
      vpcNo: z.string({ required_error: "필수 파라미터 'vpcNo'가 누락되었습니다." }).describe("VPC number to create NAT Gateway in (from getVpcList)"),
      zoneCode: z.string({ required_error: "필수 파라미터 'zoneCode'가 누락되었습니다." }).describe("Zone code (e.g., KR-1, KR-2)"),
      subnetNo: z.string().optional().describe("NATGW-type subnet number. If NULL, creates a PUBLIC-type NATGW subnet automatically. If specified, creates NAT Gateway according to the subnet's subnetTypeCode (PUBLIC or PRIVATE)."),
      natGatewayName: z.string().max(30, {
        message: "잘못된 파라미터: 'natGatewayName'은 30자 이하여야 합니다.",
      }).optional().describe("NAT Gateway name (3-30 chars, English letters/numbers/hyphens, must start with letter and end with letter or number)"),
      natGatewayDescription: z.string().optional().describe("Description for the NAT Gateway (max 1000 bytes)"),
      publicIpInstanceNo: z.string().optional().describe("Public IP instance number. Ignored for PRIVATE subnet type. For PUBLIC subnet: auto-created if NULL, assigned if specified."),
      privateIp: z.string().optional().describe("Private IP address. Ignored for PUBLIC subnet type. For PRIVATE subnet: auto-assigned if NULL, created with specified IP if provided."),
    },
    async (params) => {
      return client.request("/vpc/v2/createNatGatewayInstance", params);
    }
  );

  // ─── Description Tool ─────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_set_nat_gateway_description",
    "Set or update the description of a NAT Gateway instance",
    {
      natGatewayInstanceNo: z.string({ required_error: "필수 파라미터 'natGatewayInstanceNo'가 누락되었습니다." }).describe("NAT Gateway instance number"),
      natGatewayDescription: z.string({ required_error: "필수 파라미터 'natGatewayDescription'이 누락되었습니다." }).describe("New description for the NAT Gateway"),
    },
    async (params) => {
      return client.request("/vpc/v2/setNatGatewayDescription", params);
    }
  );

  // ─── Destructive Tool (with confirm gate) ──────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_nat_gateway",
    "⚠️ Destructive: Permanently delete a NAT Gateway instance. Set confirm=true to execute.",
    {
      natGatewayInstanceNo: z.string({ required_error: "필수 파라미터 'natGatewayInstanceNo'가 누락되었습니다." }).describe("NAT Gateway instance number to delete"),
      returnPublicIpInstance: z.boolean().optional().describe("Also return (release) the public IP instance assigned to the public NAT Gateway. Default: true"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      if (!params.confirm) {
        const message = `⚠️ This will permanently delete NAT Gateway [${params.natGatewayInstanceNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
        return { content: [{ type: "text" as const, text: message }] };
      }
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vpc/v2/deleteNatGatewayInstance", apiParams);
      return result;
    }
  );
}
