import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";

export function registerRouteTableTools(server: McpServer, client: NcloudClient): void {
  // ─── Query Tools ───────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_route_tables",
    "List all route tables in the current region",
    {
      routeTableNoList: z.array(z.string()).optional().describe("Filter by route table numbers"),
      routeTableName: z.string().optional().describe("Filter by route table name"),
      vpcNo: z.string().optional().describe("Filter by VPC number"),
      supportedSubnetTypeCode: z.string().optional().describe("Filter by supported subnet type (PUBLIC, PRIVATE)"),
    },
    async (params) => {
      return client.request("/vpc/v2/getRouteTableList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_route_table_detail",
    "Get detailed information about a specific route table",
    {
      routeTableNo: z.string().describe("Route table number to query"),
    },
    async (params) => {
      return client.request("/vpc/v2/getRouteTableDetail", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_routes",
    "List all routes in a specific route table",
    {
      routeTableNo: z.string().describe("Route table number"),
      vpcNo: z.string().describe("VPC number"),
    },
    async (params) => {
      return client.request("/vpc/v2/getRouteList", params);
    }
  );

  // ─── Create Tool ─────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_create_route_table",
    "Create a new route table in a VPC",
    {
      vpcNo: z.string({ required_error: "필수 파라미터 'vpcNo'가 누락되었습니다." }).describe("VPC number to create route table in"),
      supportedSubnetTypeCode: z.string({ required_error: "필수 파라미터 'supportedSubnetTypeCode'가 누락되었습니다." }).describe("Supported subnet type (PUBLIC or PRIVATE)"),
      routeTableName: z.string().max(30, {
        message: "잘못된 파라미터: 'routeTableName'은 30자 이하여야 합니다.",
      }).optional().describe("Route table name (max 30 characters)"),
      routeTableDescription: z.string().optional().describe("Description for the route table"),
    },
    async (params) => {
      return client.request("/vpc/v2/createRouteTable", params);
    }
  );

  // ─── Route Management Tool ─────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_add_route",
    "Add a route to a route table",
    {
      routeTableNo: z.string({ required_error: "필수 파라미터 'routeTableNo'가 누락되었습니다." }).describe("Route table number"),
      vpcNo: z.string({ required_error: "필수 파라미터 'vpcNo'가 누락되었습니다." }).describe("VPC number"),
      destinationCidrBlock: z.string({ required_error: "필수 파라미터 'destinationCidrBlock'이 누락되었습니다." }).regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/, {
        message: "잘못된 파라미터: 'destinationCidrBlock'은 CIDR 형식이어야 합니다 (예: 0.0.0.0/0)",
      }).describe("Destination CIDR block (e.g., 0.0.0.0/0)"),
      targetTypeCode: z.string({ required_error: "필수 파라미터 'targetTypeCode'가 누락되었습니다." }).describe("Target type code (NATGW, VPCPEERING, VGW)"),
      targetNo: z.string({ required_error: "필수 파라미터 'targetNo'가 누락되었습니다." }).describe("Target instance number"),
      targetName: z.string().optional().describe("Target name"),
    },
    async (params) => {
      const { routeTableNo, vpcNo, destinationCidrBlock, targetTypeCode, targetNo, targetName } = params;
      const requestParams: any = {
        routeTableNo,
        vpcNo,
        "routeList.1.destinationCidrBlock": destinationCidrBlock,
        "routeList.1.targetTypeCode": targetTypeCode,
        "routeList.1.targetNo": targetNo,
      };
      if (targetName) requestParams["routeList.1.targetName"] = targetName;
      const result = await client.request("/vpc/v2/addRoute", requestParams);
      return result;
    }
  );

  // ─── Destructive Tools (with confirm gate) ─────────────────────────────────

  // ─── Subnet Association Tools ────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_get_route_table_subnets",
    "List subnets associated with a specific route table",
    {
      routeTableNo: z.string().describe("Route table number"),
    },
    async (params) => {
      return client.request("/vpc/v2/getRouteTableSubnetList", params);
    }
  );

  defineTool(
    server,
    "ncloud_add_route_table_subnet",
    "Associate a subnet with a route table",
    {
      routeTableNo: z.string({ required_error: "필수 파라미터 'routeTableNo'가 누락되었습니다." }).describe("Route table number"),
      vpcNo: z.string({ required_error: "필수 파라미터 'vpcNo'가 누락되었습니다." }).describe("VPC number"),
      subnetNo: z.string({ required_error: "필수 파라미터 'subnetNo'가 누락되었습니다." }).describe("Subnet number to associate"),
    },
    async (params) => {
      const { routeTableNo, vpcNo, subnetNo } = params;
      const requestParams: any = {
        routeTableNo,
        vpcNo,
        "subnetNoList.1": subnetNo,
      };
      const result = await client.request("/vpc/v2/addRouteTableSubnet", requestParams);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_remove_route_table_subnet",
    "⚠️ Destructive: Remove a subnet association from a route table. Set confirm=true to execute.",
    {
      routeTableNo: z.string({ required_error: "필수 파라미터 'routeTableNo'가 누락되었습니다." }).describe("Route table number"),
      vpcNo: z.string({ required_error: "필수 파라미터 'vpcNo'가 누락되었습니다." }).describe("VPC number"),
      subnetNo: z.string({ required_error: "필수 파라미터 'subnetNo'가 누락되었습니다." }).describe("Subnet number to remove from route table"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      if (!params.confirm) {
        const message = `⚠️ This will remove Subnet [${params.subnetNo}] from Route Table [${params.routeTableNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
        return { content: [{ type: "text" as const, text: message }] };
      }
      const { confirm, routeTableNo, vpcNo, subnetNo } = params;
      const requestParams: any = {
        routeTableNo,
        vpcNo,
        "subnetNoList.1": subnetNo,
      };
      const result = await client.request("/vpc/v2/removeRouteTableSubnet", requestParams);
      return result;
    }
  );

  // ─── Description Tool ──────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_set_route_table_description",
    "Update the description of a route table",
    {
      routeTableNo: z.string({ required_error: "필수 파라미터 'routeTableNo'가 누락되었습니다." }).describe("Route table number"),
      routeTableDescription: z.string({ required_error: "필수 파라미터 'routeTableDescription'이 누락되었습니다." }).describe("New description for the route table"),
    },
    async (params) => {
      return client.request("/vpc/v2/setRouteTableDescription", params);
    }
  );

  // ─── Destructive Tools (with confirm gate) ─────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_route_table",
    "⚠️ Destructive: Permanently delete a route table. Set confirm=true to execute.",
    {
      routeTableNo: z.string({ required_error: "필수 파라미터 'routeTableNo'가 누락되었습니다." }).describe("Route table number to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      if (!params.confirm) {
        const message = `⚠️ This will permanently delete Route Table [${params.routeTableNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
        return { content: [{ type: "text" as const, text: message }] };
      }
      const { confirm, ...apiParams } = params;
      const result = await client.request("/vpc/v2/deleteRouteTable", apiParams);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_remove_route",
    "⚠️ Destructive: Remove a route from a route table. Set confirm=true to execute.",
    {
      routeTableNo: z.string({ required_error: "필수 파라미터 'routeTableNo'가 누락되었습니다." }).describe("Route table number"),
      vpcNo: z.string({ required_error: "필수 파라미터 'vpcNo'가 누락되었습니다." }).describe("VPC number"),
      destinationCidrBlock: z.string({ required_error: "필수 파라미터 'destinationCidrBlock'이 누락되었습니다." }).regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/, {
        message: "잘못된 파라미터: 'destinationCidrBlock'은 CIDR 형식이어야 합니다 (예: 0.0.0.0/0)",
      }).describe("Destination CIDR block of the route to remove"),
      targetTypeCode: z.string({ required_error: "필수 파라미터 'targetTypeCode'가 누락되었습니다." }).describe("Target type code (NATGW, VPCPEERING, VGW)"),
      targetNo: z.string({ required_error: "필수 파라미터 'targetNo'가 누락되었습니다." }).describe("Target instance number"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      if (!params.confirm) {
        const message = `⚠️ This will permanently remove route [${params.destinationCidrBlock}] from Route Table [${params.routeTableNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
        return { content: [{ type: "text" as const, text: message }] };
      }
      const { confirm, routeTableNo, vpcNo, destinationCidrBlock, targetTypeCode, targetNo } = params;
      const requestParams: any = {
        routeTableNo,
        vpcNo,
        "routeList.1.destinationCidrBlock": destinationCidrBlock,
        "routeList.1.targetTypeCode": targetTypeCode,
        "routeList.1.targetNo": targetNo,
      };
      const result = await client.request("/vpc/v2/removeRoute", requestParams);
      return result;
    }
  );
}
