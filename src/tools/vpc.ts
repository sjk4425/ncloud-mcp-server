import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";

export function registerVpcTools(server: McpServer, client: NcloudClient): void {
  // ─── VPC Query Tools ───────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_vpcs",
    "List all VPCs in the current region",
    {
      vpcNoList: z.array(z.string()).optional().describe("Filter by VPC numbers"),
      vpcName: z.string().optional().describe("Filter by VPC name"),
      vpcStatusCode: z.string().optional().describe("Filter by VPC status code (INIT, CREATING, RUN, TERMTING)"),
    },
    async (params) => {
      return client.request("/vpc/v2/getVpcList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_vpc_detail",
    "Get detailed information about a specific VPC",
    {
      vpcNo: z.string().describe("VPC number to query"),
    },
    async (params) => {
      return client.request("/vpc/v2/getVpcDetail", params);
    }
  );

  // ─── VPC Create Tool ───────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_create_vpc",
    "Create a new VPC. Use dryRun=true to preview without creating.",
    {
      ipv4CidrBlock: z.string({
        required_error: "필수 파라미터 'ipv4CidrBlock'이 누락되었습니다.",
      }).regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/, {
        message: "잘못된 파라미터: 'ipv4CidrBlock'은 CIDR 형식이어야 합니다 (예: 10.0.0.0/16)",
      }).describe("VPC IPv4 CIDR block (e.g., 10.0.0.0/16)"),
      vpcName: z.string().max(30, {
        message: "잘못된 파라미터: 'vpcName'은 30자 이하여야 합니다.",
      }).optional().describe("VPC name (max 30 characters)"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the VPC"),
    },
    async (params) => {
      if (params.dryRun) {
        const preview = {
          label: "🔍 Dry-Run Preview: VPC Creation",
          ipv4CidrBlock: params.ipv4CidrBlock,
          vpcName: params.vpcName ?? "(auto-generated)",
          message: "이 요청은 실제 VPC를 생성하지 않습니다. dryRun=false로 호출하면 VPC가 생성됩니다.",
        };
        return preview;
      }

      const { dryRun, ...apiParams } = params;
      const result = await client.request("/vpc/v2/createVpc", apiParams);
      const instance = result.vpcList?.[0];
      const summary = {
        리소스타입: "VPC",
        리소스ID: instance?.vpcNo ?? "unknown",
        리소스명: instance?.vpcName ?? params.vpcName ?? "unknown",
        상태: instance?.vpcStatus?.codeName ?? "creating",
        생성시각: instance?.createDate ?? new Date().toISOString(),
        CIDR블록: params.ipv4CidrBlock,
      };
      return summary;
    }
  );


  // ─── VPC Destructive Tool ──────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_vpc",
    "⚠️ Destructive: Permanently delete a VPC. Set confirm=true to execute.",
    {
      vpcNo: z.string({
        required_error: "필수 파라미터 'vpcNo'가 누락되었습니다.",
      }).describe("VPC number to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      if (!params.confirm) {
        const message = `⚠️ This will permanently delete VPC [${params.vpcNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
        return { content: [{ type: "text" as const, text: message }] };
      }
      const { confirm, ...apiParams } = params;
      return client.request("/vpc/v2/deleteVpc", apiParams);
    }
  );

  // ─── Subnet Query Tools ────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_list_subnets",
    "List all subnets in the current region",
    {
      subnetNoList: z.array(z.string()).optional().describe("Filter by subnet numbers"),
      vpcNo: z.string().optional().describe("Filter by VPC number"),
      subnetName: z.string().optional().describe("Filter by subnet name"),
      subnetTypeCode: z.string().optional().describe("Filter by subnet type (PUBLIC, PRIVATE)"),
      usageTypeCode: z.string().optional().describe("Filter by usage type (GEN, LOADB, BM, NATGW)"),
    },
    async (params) => {
      return client.request("/vpc/v2/getSubnetList", params);
    }
  );

  defineTool(
    server,
    "ncloud_get_subnet_detail",
    "Get detailed information about a specific subnet",
    {
      subnetNo: z.string().describe("Subnet number to query"),
    },
    async (params) => {
      return client.request("/vpc/v2/getSubnetDetail", params);
    }
  );

  // ─── Subnet Create Tool ────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_create_subnet",
    "Create a new subnet in a VPC. Use dryRun=true to preview without creating.",
    {
      vpcNo: z.string({
        required_error: "필수 파라미터 'vpcNo'가 누락되었습니다.",
      }).describe("VPC number to create the subnet in"),
      subnet: z.string({
        required_error: "필수 파라미터 'subnet'이 누락되었습니다.",
      }).regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/, {
        message: "잘못된 파라미터: 'subnet'은 CIDR 형식이어야 합니다 (예: 10.0.1.0/24)",
      }).describe("Subnet CIDR block (e.g., 10.0.1.0/24)"),
      zoneCode: z.string({
        required_error: "필수 파라미터 'zoneCode'가 누락되었습니다.",
      }).describe("Zone code (e.g., KR-1, KR-2)"),
      networkAclNo: z.string({
        required_error: "필수 파라미터 'networkAclNo'가 누락되었습니다.",
      }).describe("Network ACL number to associate"),
      subnetTypeCode: z.string({
        required_error: "필수 파라미터 'subnetTypeCode'가 누락되었습니다.",
      }).describe("Subnet type code (PUBLIC or PRIVATE)"),
      subnetName: z.string().max(30, {
        message: "잘못된 파라미터: 'subnetName'은 30자 이하여야 합니다.",
      }).optional().describe("Subnet name (max 30 characters)"),
      usageTypeCode: z.string().optional().describe("Usage type code (GEN, LOADB, BM, NATGW). Default: GEN"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the subnet"),
    },
    async (params) => {
      if (params.dryRun) {
        const preview = {
          label: "🔍 Dry-Run Preview: Subnet Creation",
          vpcNo: params.vpcNo,
          subnet: params.subnet,
          zoneCode: params.zoneCode,
          networkAclNo: params.networkAclNo,
          subnetTypeCode: params.subnetTypeCode,
          subnetName: params.subnetName ?? "(auto-generated)",
          usageTypeCode: params.usageTypeCode ?? "GEN",
          message: "이 요청은 실제 서브넷을 생성하지 않습니다. dryRun=false로 호출하면 서브넷이 생성됩니다.",
        };
        return preview;
      }

      const { dryRun, ...apiParams } = params;
      const result = await client.request("/vpc/v2/createSubnet", apiParams);
      const instance = result.subnetList?.[0];
      const summary = {
        리소스타입: "Subnet",
        리소스ID: instance?.subnetNo ?? "unknown",
        리소스명: instance?.subnetName ?? params.subnetName ?? "unknown",
        상태: instance?.subnetStatus?.codeName ?? "creating",
        생성시각: instance?.createDate ?? new Date().toISOString(),
        CIDR블록: params.subnet,
        존: params.zoneCode,
        VPC: params.vpcNo,
      };
      return summary;
    }
  );

  // ─── Subnet Destructive Tool ───────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_delete_subnet",
    "⚠️ Destructive: Permanently delete a subnet. Set confirm=true to execute.",
    {
      subnetNo: z.string({
        required_error: "필수 파라미터 'subnetNo'가 누락되었습니다.",
      }).describe("Subnet number to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      if (!params.confirm) {
        const message = `⚠️ This will permanently delete Subnet [${params.subnetNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
        return { content: [{ type: "text" as const, text: message }] };
      }
      const { confirm, ...apiParams } = params;
      return client.request("/vpc/v2/deleteSubnet", apiParams);
    }
  );
}
