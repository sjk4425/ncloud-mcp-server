import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { defineTool } from "./_tool.js";
import { L } from "./_messages.js";
import {
  regionCatalog,
  regionName,
  resolveRegionCode,
  invalidRegionMessage,
  RESOURCE_DETAIL_MAP,
  unsupportedResourceTypeMessage,
} from "./_validation.js";
import { ZONE_PROFILES } from "../client/endpoints.js";
import type { ClientFactory } from "./registry.js";

export function registerCommonTools(server: McpServer, client: ClientFactory): void {
  // 존(민간/공공)별 리전 카탈로그 — 도구 description 은 등록 시점의 존으로 고정된다.
  // 민간존 문구는 통합 이전(v1.16.0)과 글자 단위로 동일하게 유지한다.
  const zone = client.getZone();
  const regions = regionCatalog(zone);
  const regionCodes = regions.map((r) => r.code).join(", ");
  const regionNames = regions.map((r) => r.ko).join(", ");
  const zoneTag = zone === "gov" ? " (Gov)" : "";

  // ncloud_get_regions — List available regions
  defineTool(
    server,
    "ncloud_get_regions",
    "List all available Ncloud regions",
    {},
    async () => {
      return client().request("/vserver/v2/getRegionList");
    }
  );

  // ncloud_get_zones — List available zones
  defineTool(
    server,
    "ncloud_get_zones",
    "List all available zones in the current region",
    {},
    async () => {
      return client().request("/vserver/v2/getZoneList");
    }
  );

  // ncloud_set_region — Change active region
  defineTool(
    server,
    "ncloud_set_region",
    `Set the active Ncloud${zoneTag} region by code (${regionCodes}) or Korean name (${regionNames})`,
    {
      region: z.string().describe(`Region code (${regionCodes}) or Korean name (${regionNames})`),
    },
    async ({ region }) => {
      const resolvedCode = resolveRegionCode(region, zone);
      if (!resolvedCode) {
        return {
          content: [{ type: "text" as const, text: invalidRegionMessage(region, zone) }],
          isError: true,
        };
      }
      const previousCode = client.getRegionCode();
      client.setRegionAll(resolvedCode);
      const result = {
        message: L({
          ko: `✅ 리전이 ${regionName(resolvedCode, zone)} (${resolvedCode})으로 변경되었습니다.`,
          en: `✅ Region changed to ${regionName(resolvedCode, zone)} (${resolvedCode}).`,
        }),
        previousRegion: { code: previousCode, name: regionName(previousCode, zone) },
        currentRegion: { code: resolvedCode, name: regionName(resolvedCode, zone) },
        appliedScope: {
          applied: L({
            ko: "일반 API 클라이언트 전체 (Compute, Network, Database, Cloud Insight, NKS, Billing 등)",
            en: "All general API clients (Compute, Network, Database, Cloud Insight, NKS, Billing, etc.)",
          }),
          notApplied: [
            L({
              ko: "Object Storage·Archive Storage — 환경 변수 기반 리전 고정 (서버 재시작 필요)",
              en: "Object Storage / Archive Storage — region is fixed via environment variables (server restart required)",
            }),
            L({
              ko: "Cloud Functions — 리전별 base URL이 달라 setRegion으로 전환 불가 (서버 재시작 필요)",
              en: "Cloud Functions — base URL differs per region, so setRegion cannot switch it (server restart required)",
            }),
          ],
        },
      };
      return result;
    },
    // 휴리스틱 오버라이드: 외부 API 호출 없이 서버 로컬 상태(활성 리전)만 변경
    { annotations: { readOnlyHint: false, openWorldHint: false } }
  );

  // ncloud_get_current_region — Get current active region
  defineTool(
    server,
    "ncloud_get_current_region",
    "Get the currently active Ncloud region code and name (and the zone this server is bound to: public or gov)",
    {},
    async () => {
      const code = client.getRegionCode();
      const profile = ZONE_PROFILES[zone];
      const result = {
        regionCode: code,
        regionName: regionName(code, zone),
        zone: {
          code: zone,
          name: L(profile.label),
          console: profile.console,
          availableRegions: regions.map((r) => ({ code: r.code, name: r.ko })),
        },
      };
      return result;
    },
    // 휴리스틱 오버라이드: 외부 API 호출 없이 서버 로컬 상태만 조회
    { annotations: { openWorldHint: false } }
  );

  // ncloud_get_operation_status — Check resource operation status
  defineTool(
    server,
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
          content: [{ type: "text" as const, text: unsupportedResourceTypeMessage(resourceType) }],
          isError: true,
        };
      }
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
        ? L({ ko: `✅ 완료: ${resourceType} [${resourceId}] 정상 생성됨`, en: `✅ Done: ${resourceType} [${resourceId}] created successfully` })
        : L({ ko: `⏳ 진행 중: ${resourceType} [${resourceId}] - 현재 상태: ${status}`, en: `⏳ In progress: ${resourceType} [${resourceId}] - current status: ${status}` });

      const response = { message, resourceType, resourceId, status };
      return response;
    }
  );
}
