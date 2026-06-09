import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { toolText } from "./_response.js";

export function registerVpcPeeringTools(server: McpServer, client: NcloudClient): void {
  // ─── Query Tools ───────────────────────────────────────────────────────────

  server.tool(
    "ncloud_list_vpc_peerings",
    "List all VPC Peering instances in the current region",
    {
      vpcPeeringInstanceNoList: z.array(z.string()).optional().describe("Filter by VPC Peering instance numbers"),
      vpcPeeringName: z.string().optional().describe("Filter by VPC Peering name"),
      sourceVpcNo: z.string().optional().describe("Filter by source VPC number"),
      targetVpcNo: z.string().optional().describe("Filter by target VPC number"),
      vpcPeeringInstanceStatusCode: z.string().optional().describe("Filter by status code (RUN, INIT, TERMTING)"),
    },
    async (params) => {
      try {
        const result = await client.request("/vpc/v2/getVpcPeeringInstanceList", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  server.tool(
    "ncloud_get_vpc_peering_detail",
    "Get detailed information about a specific VPC Peering instance",
    {
      vpcPeeringInstanceNo: z.string({ required_error: "필수 파라미터 'vpcPeeringInstanceNo'가 누락되었습니다." }).describe("VPC Peering instance number to query"),
    },
    async (params) => {
      try {
        const result = await client.request("/vpc/v2/getVpcPeeringInstanceDetail", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Create Tool (with dryRun) ─────────────────────────────────────────────

  server.tool(
    "ncloud_create_vpc_peering",
    "Create a new VPC Peering connection between two VPCs. Use dryRun=true to preview without creating.",
    {
      sourceVpcNo: z.string({ required_error: "필수 파라미터 'sourceVpcNo'가 누락되었습니다." }).describe("Source (requester) VPC number"),
      targetVpcNo: z.string({ required_error: "필수 파라미터 'targetVpcNo'가 누락되었습니다." }).describe("Target (accepter) VPC number"),
      targetVpcName: z.string().optional().describe("Target VPC name (required for cross-account peering)"),
      targetVpcLoginId: z.string().optional().describe("Target VPC owner login ID (required for cross-account peering)"),
      vpcPeeringName: z.string().regex(/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/, {
        message: "잘못된 파라미터: 'vpcPeeringName'은 3~30자의 소문자/숫자/하이픈만 허용하며, 영숫자로 시작·종료해야 합니다.",
      }).optional().describe("VPC Peering name (3-30 chars; lowercase letters, numbers, hyphens; must start and end with an alphanumeric character)"),
      vpcPeeringDescription: z.string().optional().describe("Description for the VPC Peering"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the resource"),
    },
    async (params) => {
      try {
        if (params.dryRun) {
          const preview = {
            "🔍 Dry-Run Preview": "VPC Peering 생성 미리보기",
            sourceVpcNo: params.sourceVpcNo,
            targetVpcNo: params.targetVpcNo,
            targetVpcName: params.targetVpcName ?? "(same account)",
            targetVpcLoginId: params.targetVpcLoginId ?? "(same account)",
            vpcPeeringName: params.vpcPeeringName ?? "(auto-generated)",
            vpcPeeringDescription: params.vpcPeeringDescription ?? "(none)",
            note: "dryRun=false로 다시 호출하면 실제로 생성됩니다.",
          };
          return toolText(preview);
        }
        const { dryRun, ...apiParams } = params;
        const result = await client.request("/vpc/v2/createVpcPeeringInstance", apiParams);
        const instance = result.vpcPeeringInstanceList?.[0];
        const summary = {
          리소스타입: "VPC Peering",
          리소스ID: instance?.vpcPeeringInstanceNo ?? "unknown",
          리소스명: instance?.vpcPeeringName ?? params.vpcPeeringName ?? "unknown",
          상태: instance?.vpcPeeringInstanceStatus?.codeName ?? "creating",
          생성시각: instance?.createDate ?? new Date().toISOString(),
          소스VPC: params.sourceVpcNo,
          타겟VPC: params.targetVpcNo,
        };
        return toolText(summary);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Accept/Reject Tool ────────────────────────────────────────────────────

  server.tool(
    "ncloud_accept_reject_vpc_peering",
    "Accept or reject a pending VPC Peering request",
    {
      vpcPeeringInstanceNo: z.string({ required_error: "필수 파라미터 'vpcPeeringInstanceNo'가 누락되었습니다." }).describe("VPC Peering instance number"),
      isAccept: z.boolean({ required_error: "필수 파라미터 'isAccept'가 누락되었습니다." }).describe("true to accept, false to reject the peering request"),
    },
    async (params) => {
      try {
        const result = await client.request("/vpc/v2/acceptOrRejectVpcPeering", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Description Tool ──────────────────────────────────────────────────────

  server.tool(
    "ncloud_set_vpc_peering_description",
    "Set or update the description of a VPC Peering instance",
    {
      vpcPeeringInstanceNo: z.string({ required_error: "필수 파라미터 'vpcPeeringInstanceNo'가 누락되었습니다." }).describe("VPC Peering instance number"),
      vpcPeeringDescription: z.string({ required_error: "필수 파라미터 'vpcPeeringDescription'이 누락되었습니다." }).describe("New description for the VPC Peering"),
    },
    async (params) => {
      try {
        const result = await client.request("/vpc/v2/setVpcPeeringDescription", params);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ─── Destructive Tool (with confirm gate) ──────────────────────────────────

  server.tool(
    "ncloud_delete_vpc_peering",
    "⚠️ Destructive: Permanently delete a VPC Peering connection. Set confirm=true to execute.",
    {
      vpcPeeringInstanceNo: z.string({ required_error: "필수 파라미터 'vpcPeeringInstanceNo'가 누락되었습니다." }).describe("VPC Peering instance number to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      try {
        if (!params.confirm) {
          const message = `⚠️ This will permanently delete VPC Peering [${params.vpcPeeringInstanceNo}]. Do you want to proceed? (yes/no)\n\nTo execute, call this tool again with confirm=true.`;
          return { content: [{ type: "text" as const, text: message }] };
        }
        const { confirm, ...apiParams } = params;
        const result = await client.request("/vpc/v2/deleteVpcPeeringInstance", apiParams);
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
