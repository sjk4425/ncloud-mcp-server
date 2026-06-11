import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toolText } from "./_response.js";
import type { ClientFactory } from "./registry.js";

const REGION_NAME_MAP: Record<string, string> = {
  "한국": "KR",
  "일본": "JPN",
  "싱가포르": "SGN",
  "미국": "USWN",
  "독일": "DEN",
};

const REGION_CODE_MAP: Record<string, string> = {
  KR: "한국",
  JPN: "일본",
  SGN: "싱가포르",
  USWN: "미국",
  DEN: "독일",
};

const RESOURCE_DETAIL_MAP: Record<string, { apiPath: string; paramKey: string }> = {
  server: { apiPath: "/vserver/v2/getServerInstanceDetail", paramKey: "serverInstanceNo" },
  vpc: { apiPath: "/vpc/v2/getVpcDetail", paramKey: "vpcNo" },
  subnet: { apiPath: "/vpc/v2/getSubnetDetail", paramKey: "subnetNo" },
  loadbalancer: { apiPath: "/vloadbalancer/v2/getLoadBalancerInstanceDetail", paramKey: "loadBalancerInstanceNo" },
  targetGroup: { apiPath: "/vloadbalancer/v2/getTargetGroupDetail", paramKey: "targetGroupNo" },
  natGateway: { apiPath: "/vpc/v2/getNatGatewayInstanceDetail", paramKey: "natGatewayInstanceNo" },
  mysqlInstance: { apiPath: "/vmysql/v2/getCloudMysqlInstanceDetail", paramKey: "cloudMysqlInstanceNo" },
  blockStorage: { apiPath: "/vserver/v2/getBlockStorageInstanceDetail", paramKey: "blockStorageInstanceNo" },
  publicIp: { apiPath: "/vserver/v2/getPublicIpInstanceDetail", paramKey: "publicIpInstanceNo" },
  acg: { apiPath: "/vserver/v2/getAccessControlGroupDetail", paramKey: "accessControlGroupNo" },
  networkAcl: { apiPath: "/vpc/v2/getNetworkAclDetail", paramKey: "networkAclNo" },
  autoScalingGroup: { apiPath: "/vautoscaling/v2/getAutoScalingGroupDetail", paramKey: "autoScalingGroupNo" },
};

export function registerCommonTools(server: McpServer, client: ClientFactory): void {
  // ncloud_get_regions — List available regions
  server.tool(
    "ncloud_get_regions",
    "List all available Ncloud regions",
    {},
    async () => {
      try {
        const result = await client().request("/vserver/v2/getRegionList");
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_zones — List available zones
  server.tool(
    "ncloud_get_zones",
    "List all available zones in the current region",
    {},
    async () => {
      try {
        const result = await client().request("/vserver/v2/getZoneList");
        return toolText(result);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_set_region — Change active region
  server.tool(
    "ncloud_set_region",
    "Set the active Ncloud region by code (KR, JPN, SGN, USWN, DEN) or Korean name (한국, 일본, 싱가포르, 미국, 독일)",
    {
      region: z.string().describe("Region code (KR, JPN, SGN, USWN, DEN) or Korean name (한국, 일본, 싱가포르, 미국, 독일)"),
    },
    async ({ region }) => {
      const resolvedCode = REGION_NAME_MAP[region] ?? region.toUpperCase();
      if (!REGION_CODE_MAP[resolvedCode]) {
        return {
          content: [{ type: "text" as const, text: `유효하지 않은 리전입니다: "${region}". 사용 가능한 리전: KR, JPN, SGN, USWN, DEN (또는 한국, 일본, 싱가포르, 미국, 독일)` }],
          isError: true,
        };
      }
      const previousCode = client.getRegionCode();
      client.setRegionAll(resolvedCode);
      const result = {
        message: `✅ 리전이 ${REGION_CODE_MAP[resolvedCode]} (${resolvedCode})으로 변경되었습니다.`,
        previousRegion: { code: previousCode, name: REGION_CODE_MAP[previousCode] ?? previousCode },
        currentRegion: { code: resolvedCode, name: REGION_CODE_MAP[resolvedCode] },
        appliedScope: {
          applied: "일반 API 클라이언트 전체 (Compute, Network, Database, Cloud Insight, NKS, Billing 등)",
          notApplied: [
            "Object Storage·Archive Storage — 환경 변수 기반 리전 고정 (서버 재시작 필요)",
            "Cloud Functions — 리전별 base URL이 달라 setRegion으로 전환 불가 (서버 재시작 필요)",
          ],
        },
      };
      return toolText(result);
    }
  );

  // ncloud_get_current_region — Get current active region
  server.tool(
    "ncloud_get_current_region",
    "Get the currently active Ncloud region code and name",
    {},
    async () => {
      const code = client.getRegionCode();
      const result = {
        regionCode: code,
        regionName: REGION_CODE_MAP[code] ?? code,
      };
      return toolText(result);
    }
  );

  // ncloud_get_operation_status — Check resource operation status
  server.tool(
    "ncloud_get_operation_status",
    "Check the current status of a recently created or modified resource by type and ID",
    {
      resourceType: z.enum([
        "server", "vpc", "subnet", "loadbalancer", "targetGroup",
        "natGateway", "mysqlInstance", "blockStorage", "publicIp",
        "acg", "networkAcl", "autoScalingGroup",
      ]).describe("Type of the resource to check status"),
      resourceId: z.string().describe("Resource instance number/ID to check"),
    },
    async ({ resourceType, resourceId }) => {
      const mapping = RESOURCE_DETAIL_MAP[resourceType];
      if (!mapping) {
        return {
          content: [{ type: "text" as const, text: `지원하지 않는 리소스 타입: ${resourceType}` }],
          isError: true,
        };
      }
      try {
        const result = await client().request(mapping.apiPath, { [mapping.paramKey]: resourceId });
        // Extract status from the first list item in the response
        const listKey = Object.keys(result).find((k) => Array.isArray(result[k]));
        const item = listKey ? result[listKey][0] : undefined;
        const status = item?.status?.code ?? item?.serverInstanceStatus?.code
          ?? item?.vpcStatus?.code ?? item?.subnetStatus?.code
          ?? item?.loadBalancerInstanceStatus?.code ?? item?.targetGroupStatus?.code
          ?? item?.natGatewayInstanceStatus?.code ?? item?.cloudMysqlInstanceStatus?.code
          ?? item?.blockStorageInstanceStatus?.code ?? item?.publicIpInstanceStatus?.code
          ?? item?.accessControlGroupStatus?.code ?? item?.networkAclStatus?.code
          ?? item?.autoScalingGroupStatus?.code ?? "unknown";

        const isComplete = ["running", "run", "active", "set", "used", "created", "creat"].includes(status.toLowerCase());
        const message = isComplete
          ? `✅ 완료: ${resourceType} [${resourceId}] 정상 생성됨`
          : `⏳ 진행 중: ${resourceType} [${resourceId}] - 현재 상태: ${status}`;

        const response = { message, resourceType, resourceId, status };
        return toolText(response);
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );
}
