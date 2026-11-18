import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";

// Paths verified against the pub/gov guides on 2026-10-02 (globaltrafficmanager-profile-*, policy-*, geocidr-*, geolocation-*,
// domain-query-countview): health check = .../monitors, lookups = /policies/resources/{types,regions}, /policies/lb-types,
// /maps/mapType; map delete = DELETE /gtm/v1/maps with body { list: [mapId] }.
/**
 * Traffic Policy 요청(PolicyRequest)의 lbType 값 — 가이드 policy-request / policy-load-balancer-typeview
 * (GET /gtm/v1/policies/lb-types 응답 예시)와 일치. 민간·공공존 동일(2026-11-18 대조).
 * ≤2.2.0 스키마의 GEO·WEIGHTED_RR 는 API 가 거부(05X002 "cannot be converted to LoadBalancerType")하므로
 * 하위호환 별칭으로만 받아 API 값으로 바꾼다. FAILOVER 는 API 에 없는 값이라 제거.
 */
export const GTM_LB_TYPES = ["ROUND_ROBIN", "WEIGHTED_ROUND_ROBIN", "GEOLOCATION", "CIDR"] as const;
const GTM_LB_TYPE_ALIASES: Record<string, (typeof GTM_LB_TYPES)[number]> = {
  GEO: "GEOLOCATION",
  WEIGHTED_RR: "WEIGHTED_ROUND_ROBIN",
};
const LB_TYPE_DESC =
  "Load balancing type: ROUND_ROBIN | WEIGHTED_ROUND_ROBIN | GEOLOCATION | CIDR (same values as ncloud_gtm_get_lb_types). The legacy aliases GEO and WEIGHTED_RR are converted to GEOLOCATION and WEIGHTED_ROUND_ROBIN.";
const lbTypeSchema = (requiredMessage?: string) =>
  z.preprocess(
    (v) => (typeof v === "string" && GTM_LB_TYPE_ALIASES[v] ? GTM_LB_TYPE_ALIASES[v] : v),
    requiredMessage ? z.enum(GTM_LB_TYPES, { required_error: requiredMessage }) : z.enum(GTM_LB_TYPES)
  );

/** Resource.type — 가이드 policy-request 의 Enum 및 policy-resource-typeview 응답(PUBLIC_IP, EXTERNAL_DOMAIN). CNAME 은 API 값이 아니다. */
const GTM_RESOURCE_SCHEMA = z.object({
  content: z.string().describe("Resource value: an IP address for PUBLIC_IP, a domain name for EXTERNAL_DOMAIN"),
  healthCheckRegionId: z.number().describe("Health check region ID (see ncloud_gtm_get_health_check_regions)"),
  type: z.enum(["PUBLIC_IP", "EXTERNAL_DOMAIN"]).describe("Resource type: PUBLIC_IP | EXTERNAL_DOMAIN (same values as ncloud_gtm_get_resource_types)"),
});
const WEIGHTED_DESC = "Weight (only when lbType is WEIGHTED_ROUND_ROBIN)";
const GEO_MAP_DETAIL_DESC =
  "Geo/CIDR map detail ID this group serves (only when lbType is GEOLOCATION or CIDR). IDs come from ncloud_gtm_get_geo_cidr_map_detail (detailedMapList[].id); the catch-all ETC detail is -1";
/**
 * 2026-11-18 민간존 실측(가이드 미기재): GEOLOCATION 정책은 맵의 **모든** detail(ETC = -1 포함)마다 리소스 그룹이 있어야 한다 —
 *   하나라도 빠지면 05X000 "need all detail id". PUBLIC_IP 는 공인 IP 여야 한다(문서용 203.0.113.x 도 "is not public ip").
 */
const RESOURCE_GROUPS_RULE =
  "For GEOLOCATION, include one group for EVERY detail of the map, including ETC (geoMapDetailId -1) — otherwise the API rejects the request with 'need all detail id'. PUBLIC_IP resources must be public IP addresses.";

export function registerGlobalTrafficManagerTools(server: McpServer, client: NcloudClient): void {
  // ─── Traffic Profile (Domain) Tools ─────────────────────────────────────────

  defineTool(
    server,
    "ncloud_gtm_list_profiles",
    "List Global Traffic Manager profiles (domains) with optional pagination and name filter",
    {
      page: z.number().optional().describe("Page number (0-based, default: 0)"),
      size: z.number().optional().describe("Number of items per page (default: 20)"),
      name: z.string().optional().describe("Filter by profile name"),
    },
    async (params) => {
      const queryParams: Record<string, string> = {};
      if (params.page !== undefined) queryParams.page = String(params.page);
      if (params.size !== undefined) queryParams.size = String(params.size);
      if (params.name !== undefined) queryParams.name = params.name;
      const result = await client.requestRaw("GET", "/gtm/v1/domains", Object.keys(queryParams).length > 0 ? queryParams : undefined);
      return result;

    }
  );

  defineTool(
    server,
    "ncloud_gtm_get_profile_detail",
    "Get detailed information about a specific Global Traffic Manager profile (domain)",
    {
      domainId: z.number({ required_error: "Required parameter 'domainId' is missing." }).describe("Domain(Profile) ID to query"),
    },
    async (params) => {
      return client.requestRaw("GET", `/gtm/v1/domains/${params.domainId}`);
    }
  );

  defineTool(
    server,
    "ncloud_gtm_create_profile",
    "Create a new Global Traffic Manager profile (domain)",
    {
      name: z.string({ required_error: "Required parameter 'name' is missing." }).describe("Domain name (e.g., profile.ncloudgtm.com)"),
      policyId: z.number({ required_error: "Required parameter 'policyId' is missing." }).describe("Policy ID to associate"),
      ttl: z.number().optional().describe("TTL value in seconds"),
      claRegion: z.string().optional().describe("CLA region code (e.g., KR)"),
    },
    async (params) => {
      const body: Record<string, unknown> = { name: params.name, policyId: params.policyId };
      if (params.ttl !== undefined) body.ttl = params.ttl;
      if (params.claRegion !== undefined) body.claRegion = params.claRegion;
      const result = await client.requestRaw("POST", "/gtm/v1/domains", undefined, body);
      return result;

    }
  );

  defineTool(
    server,
    "ncloud_gtm_update_profile",
    "Update an existing Global Traffic Manager profile (domain)",
    {
      domainId: z.number({ required_error: "Required parameter 'domainId' is missing." }).describe("Domain(Profile) ID to update"),
      policyId: z.number().optional().describe("Policy ID to associate"),
      ttl: z.number().optional().describe("TTL value in seconds"),
      claRegion: z.string().optional().describe("CLA region code (e.g., KR)"),
    },
    async (params) => {
      const body: Record<string, unknown> = {};
      if (params.policyId !== undefined) body.policyId = params.policyId;
      if (params.ttl !== undefined) body.ttl = params.ttl;
      if (params.claRegion !== undefined) body.claRegion = params.claRegion;
      const result = await client.requestRaw("PUT", `/gtm/v1/domains/${params.domainId}`, undefined, body);
      return result;

    }
  );

  defineTool(
    server,
    "ncloud_gtm_delete_profile",
    "⚠️ Destructive: Permanently delete a Global Traffic Manager profile (domain). Set confirm=true to execute.",
    {
      domainId: z.number({ required_error: "Required parameter 'domainId' is missing." }).describe("Domain(Profile) ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const result = await client.requestRaw("DELETE", `/gtm/v1/domains/${params.domainId}`);
      return result;

    },
    { destructive: { message: (params) => `⚠️ This will permanently delete GTM Profile (Domain) [${params.domainId}].\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Traffic Policy Tools ───────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_gtm_list_policies",
    "List Global Traffic Manager policies with optional pagination and filters",
    {
      page: z.number().optional().describe("Page number (0-based, default: 0)"),
      size: z.number().optional().describe("Number of items per page (default: 20)"),
      applyYn: z.boolean().optional().describe("Filter by apply status (true: applied, false: not applied)"),
      domainName: z.string().optional().describe("Filter by associated profile (domain) name"),
      name: z.string().optional().describe("Filter by policy name"),
    },
    async (params) => {
      const queryParams: Record<string, string> = {};
      if (params.page !== undefined) queryParams.page = String(params.page);
      if (params.size !== undefined) queryParams.size = String(params.size);
      if (params.applyYn !== undefined) queryParams.applyYn = String(params.applyYn);
      if (params.domainName !== undefined) queryParams.domainName = params.domainName;
      if (params.name !== undefined) queryParams.name = params.name;
      const result = await client.requestRaw("GET", "/gtm/v1/policies", Object.keys(queryParams).length > 0 ? queryParams : undefined);
      return result;

    }
  );

  defineTool(
    server,
    "ncloud_gtm_get_policy_detail",
    "Get detailed information about a specific Global Traffic Manager policy",
    {
      policyId: z.number({ required_error: "Required parameter 'policyId' is missing." }).describe("Policy ID to query"),
    },
    async (params) => {
      return client.requestRaw("GET", `/gtm/v1/policies/${params.policyId}`);
    }
  );

  defineTool(
    server,
    "ncloud_gtm_create_policy",
    "Create a new Global Traffic Manager policy with load balancing, monitor, and resource groups",
    {
      name: z.string({ required_error: "Required parameter 'name' is missing." }).describe("Policy name"),
      lbType: lbTypeSchema("Required parameter 'lbType' is missing.").describe(LB_TYPE_DESC),
      geoMapId: z.number().optional().describe("Geo/CIDR Map ID (required when lbType is GEOLOCATION or CIDR)"),
      monitor: z.object({
        protocol: z.enum(["HTTP", "HTTPS", "TCP"]).describe("Health check protocol"),
        port: z.number().describe("Health check port"),
        path: z.string().optional().describe("Health check path (HTTP/HTTPS only)"),
        hostHeader: z.string().optional().describe("Host header (HTTP/HTTPS only)"),
        period: z.number().optional().describe("Check period in seconds (default: 30)"),
        thresholdFail: z.number().optional().describe("Failure threshold (default: 1)"),
        thresholdNormal: z.number().optional().describe("Normal threshold (default: 1)"),
      }).optional().describe("Health check monitor configuration"),
      resourceGroups: z.array(z.object({
        sid: z.number().nullable().optional().describe("Resource group ID (null for new)"),
        weighted: z.number().nullable().optional().describe(WEIGHTED_DESC),
        geoMapDetailId: z.number().nullable().optional().describe(GEO_MAP_DETAIL_DESC),
        active: z.array(GTM_RESOURCE_SCHEMA).describe("Active resources"),
        standby: z.array(GTM_RESOURCE_SCHEMA).optional().describe("Standby resources"),
      })).optional().describe(`Resource groups with active/standby resources. ${RESOURCE_GROUPS_RULE}`),
    },
    async (params) => {
      const body: Record<string, unknown> = { name: params.name, lbType: params.lbType };
      if (params.geoMapId !== undefined) body.geoMapId = params.geoMapId;
      if (params.monitor !== undefined) body.monitor = params.monitor;
      if (params.resourceGroups !== undefined) body.resourceGroups = params.resourceGroups;
      const result = await client.requestRaw("POST", "/gtm/v1/policies", undefined, body);
      return result;

    }
  );

  defineTool(
    server,
    "ncloud_gtm_update_policy",
    "Update an existing Global Traffic Manager policy",
    {
      policyId: z.number({ required_error: "Required parameter 'policyId' is missing." }).describe("Policy ID to update"),
      name: z.string().optional().describe("Policy name"),
      lbType: lbTypeSchema().optional().describe(LB_TYPE_DESC),
      geoMapId: z.number().optional().describe("Geo/CIDR Map ID (required when lbType is GEOLOCATION or CIDR)"),
      monitor: z.object({
        protocol: z.enum(["HTTP", "HTTPS", "TCP"]).describe("Health check protocol"),
        port: z.number().describe("Health check port"),
        path: z.string().optional().describe("Health check path"),
        hostHeader: z.string().optional().describe("Host header"),
        period: z.number().optional().describe("Check period in seconds"),
        thresholdFail: z.number().optional().describe("Failure threshold"),
        thresholdNormal: z.number().optional().describe("Normal threshold"),
      }).optional().describe("Health check monitor configuration"),
      resourceGroups: z.array(z.object({
        sid: z.number().nullable().optional().describe("Resource group ID"),
        weighted: z.number().nullable().optional().describe(WEIGHTED_DESC),
        geoMapDetailId: z.number().nullable().optional().describe(GEO_MAP_DETAIL_DESC),
        active: z.array(GTM_RESOURCE_SCHEMA).describe("Active resources"),
        standby: z.array(GTM_RESOURCE_SCHEMA).optional().describe("Standby resources"),
      })).optional().describe(`Resource groups. ${RESOURCE_GROUPS_RULE}`),
    },
    async (params) => {
      const { policyId, ...bodyFields } = params;
      const body: Record<string, unknown> = {};
      if (bodyFields.name !== undefined) body.name = bodyFields.name;
      if (bodyFields.lbType !== undefined) body.lbType = bodyFields.lbType;
      if (bodyFields.geoMapId !== undefined) body.geoMapId = bodyFields.geoMapId;
      if (bodyFields.monitor !== undefined) body.monitor = bodyFields.monitor;
      if (bodyFields.resourceGroups !== undefined) body.resourceGroups = bodyFields.resourceGroups;
      const result = await client.requestRaw("PUT", `/gtm/v1/policies/${policyId}`, undefined, body);
      return result;

    }
  );

  defineTool(
    server,
    "ncloud_gtm_delete_policy",
    "⚠️ Destructive: Permanently delete a Global Traffic Manager policy. Set confirm=true to execute.",
    {
      policyId: z.number({ required_error: "Required parameter 'policyId' is missing." }).describe("Policy ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const result = await client.requestRaw("DELETE", `/gtm/v1/policies/${params.policyId}`);
      return result;

    },
    { destructive: { message: (params) => `⚠️ This will permanently delete GTM Policy [${params.policyId}].\n\nTo execute, call this tool again with confirm=true.` } }
  );

  defineTool(
    server,
    "ncloud_gtm_get_policy_resources",
    "Get resource details for a specific Global Traffic Manager policy",
    {
      policyId: z.number({ required_error: "Required parameter 'policyId' is missing." }).describe("Policy ID"),
    },
    async (params) => {
      return client.requestRaw("GET", `/gtm/v1/policies/${params.policyId}/resources`);
    }
  );

  defineTool(
    server,
    "ncloud_gtm_update_policy_resources",
    "Update all resources for a specific Global Traffic Manager policy",
    {
      policyId: z.number({ required_error: "Required parameter 'policyId' is missing." }).describe("Policy ID"),
      resourceGroups: z.array(z.object({
        sid: z.number().nullable().optional().describe("Resource group ID"),
        weighted: z.number().nullable().optional().describe(WEIGHTED_DESC),
        geoMapDetailId: z.number().nullable().optional().describe(GEO_MAP_DETAIL_DESC),
        active: z.array(GTM_RESOURCE_SCHEMA).describe("Active resources"),
        standby: z.array(GTM_RESOURCE_SCHEMA).optional().describe("Standby resources"),
      }), { required_error: "Required parameter 'resourceGroups' is missing." }).describe(`Resource groups to set (replaces all existing groups). ${RESOURCE_GROUPS_RULE}`),
    },
    async (params) => {
      return client.requestRaw("PUT", `/gtm/v1/policies/${params.policyId}/resources`, undefined, params.resourceGroups);
    }
  );

  defineTool(
    server,
    "ncloud_gtm_update_policy_resource",
    "Update a specific resource group within a Global Traffic Manager policy",
    {
      policyId: z.number({ required_error: "Required parameter 'policyId' is missing." }).describe("Policy ID"),
      resourceGroupSid: z.number({ required_error: "Required parameter 'resourceGroupSid' is missing." }).describe("Resource group SID"),
      weighted: z.number().nullable().optional().describe(WEIGHTED_DESC),
      geoMapDetailId: z.number().nullable().optional().describe(GEO_MAP_DETAIL_DESC),
      active: z.array(GTM_RESOURCE_SCHEMA).optional().describe("Active resources"),
      standby: z.array(GTM_RESOURCE_SCHEMA).optional().describe("Standby resources"),
    },
    async (params) => {
      const { policyId, resourceGroupSid, ...bodyFields } = params;
      const body: Record<string, unknown> = { sid: resourceGroupSid };
      if (bodyFields.weighted !== undefined) body.weighted = bodyFields.weighted;
      if (bodyFields.geoMapDetailId !== undefined) body.geoMapDetailId = bodyFields.geoMapDetailId;
      if (bodyFields.active !== undefined) body.active = bodyFields.active;
      if (bodyFields.standby !== undefined) body.standby = bodyFields.standby;
      const result = await client.requestRaw("PUT", `/gtm/v1/policies/${policyId}/resources/${resourceGroupSid}`, undefined, body);
      return result;

    }
  );

  defineTool(
    server,
    "ncloud_gtm_update_policy_health_check",
    "Update health check configuration for a Global Traffic Manager policy",
    {
      policyId: z.number({ required_error: "Required parameter 'policyId' is missing." }).describe("Policy ID"),
      protocol: z.enum(["HTTP", "HTTPS", "TCP"]).optional().describe("Health check protocol"),
      port: z.number().optional().describe("Health check port"),
      path: z.string().optional().describe("Health check path (HTTP/HTTPS only)"),
      hostHeader: z.string().optional().describe("Host header (HTTP/HTTPS only)"),
      period: z.number().optional().describe("Check period in seconds"),
      thresholdFail: z.number().optional().describe("Failure threshold count"),
      thresholdNormal: z.number().optional().describe("Normal threshold count"),
    },
    async (params) => {
      const { policyId, ...bodyFields } = params;
      const body: Record<string, unknown> = {};
      if (bodyFields.protocol !== undefined) body.protocol = bodyFields.protocol;
      if (bodyFields.port !== undefined) body.port = bodyFields.port;
      if (bodyFields.path !== undefined) body.path = bodyFields.path;
      if (bodyFields.hostHeader !== undefined) body.hostHeader = bodyFields.hostHeader;
      if (bodyFields.period !== undefined) body.period = bodyFields.period;
      if (bodyFields.thresholdFail !== undefined) body.thresholdFail = bodyFields.thresholdFail;
      if (bodyFields.thresholdNormal !== undefined) body.thresholdNormal = bodyFields.thresholdNormal;
      const result = await client.requestRaw("PUT", `/gtm/v1/policies/${policyId}/monitors`, undefined, body);
      return result;

    }
  );

  defineTool(
    server,
    "ncloud_gtm_delete_policy_health_check",
    "⚠️ Destructive: Delete health check configuration for a GTM policy. Set confirm=true to execute.",
    {
      policyId: z.number({ required_error: "Required parameter 'policyId' is missing." }).describe("Policy ID"),
      confirm: z.boolean().optional().default(false).describe("Must be true to execute"),
    },
    async (params) => {
      const result = await client.requestRaw("DELETE", `/gtm/v1/policies/${params.policyId}/monitors`);
      return result;

    },
    { destructive: { message: (params) => `⚠️ This will delete health check for GTM Policy [${params.policyId}].\n\nCall again with confirm=true.` } }
  );

  defineTool(
    server,
    "ncloud_gtm_get_resource_types",
    "Get available resource types for Global Traffic Manager policies",
    {},
    async () => {
      return client.requestRaw("GET", "/gtm/v1/policies/resources/types");
    }
  );

  defineTool(
    server,
    "ncloud_gtm_get_health_check_regions",
    "Get available health check region codes for Global Traffic Manager",
    {},
    async () => {
      return client.requestRaw("GET", "/gtm/v1/policies/resources/regions");
    }
  );

  defineTool(
    server,
    "ncloud_gtm_get_lb_types",
    "Get available load balancer types for Global Traffic Manager policies",
    {},
    async () => {
      return client.requestRaw("GET", "/gtm/v1/policies/lb-types");
    }
  );

  // ─── Geo and CIDR Map Tools ─────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_gtm_list_geo_cidr_maps",
    "List Global Traffic Manager Geo and CIDR maps with optional pagination",
    {
      page: z.number().optional().describe("Page number (0-based, default: 0)"),
      size: z.number().optional().describe("Number of items per page (default: 20)"),
    },
    async (params) => {
      const queryParams: Record<string, string> = {};
      if (params.page !== undefined) queryParams.page = String(params.page);
      if (params.size !== undefined) queryParams.size = String(params.size);
      const result = await client.requestRaw("GET", "/gtm/v1/maps", Object.keys(queryParams).length > 0 ? queryParams : undefined);
      return result;

    }
  );

  defineTool(
    server,
    "ncloud_gtm_get_geo_cidr_map_detail",
    "Get detailed information about a specific Geo or CIDR map",
    {
      mapId: z.number({ required_error: "Required parameter 'mapId' is missing." }).describe("Map ID to query"),
    },
    async (params) => {
      return client.requestRaw("GET", `/gtm/v1/maps/${params.mapId}`);
    }
  );

  defineTool(
    server,
    "ncloud_gtm_create_geo_cidr_map",
    "Create a new Geo or CIDR map for Global Traffic Manager",
    {
      name: z.string({ required_error: "Required parameter 'name' is missing." }).describe("Map name"),
      mapType: z.enum(["GEO", "CIDR"], { required_error: "Required parameter 'mapType' is missing." }).describe("Map type"),
      detailedMapList: z.array(z.object({
        name: z.string().describe("Zone/detail name"),
        content: z.string().optional().describe("CIDR subnet (e.g., 10.10.10.0/24)"),
        geoIdMappings: z.array(z.object({
          geoName: z.string().describe("Geolocation name (country/continent)"),
          geoType: z.string().describe("Geolocation type (NATION, CONTINENT)"),
        })).optional().describe("Geolocation mappings (for GEO type)"),
      }), { required_error: "Required parameter 'detailedMapList' is missing." }).describe("Detailed map entries"),
    },
    async (params) => {
      const body = { name: params.name, mapType: params.mapType, detailedMapList: params.detailedMapList };
      const result = await client.requestRaw("POST", "/gtm/v1/maps", undefined, body);
      return result;

    }
  );

  defineTool(
    server,
    "ncloud_gtm_update_geo_cidr_map",
    "Update an existing Geo or CIDR map",
    {
      mapId: z.number({ required_error: "Required parameter 'mapId' is missing." }).describe("Map ID to update"),
      name: z.string().optional().describe("Map name"),
      mapType: z.enum(["GEO", "CIDR"]).optional().describe("Map type"),
      detailedMapList: z.array(z.object({
        name: z.string().describe("Zone/detail name"),
        content: z.string().optional().describe("CIDR subnet"),
        geoIdMappings: z.array(z.object({
          geoName: z.string().describe("Geolocation name"),
          geoType: z.string().describe("Geolocation type"),
        })).optional().describe("Geolocation mappings"),
      })).optional().describe("Detailed map entries"),
    },
    async (params) => {
      const { mapId, ...bodyFields } = params;
      const body: Record<string, unknown> = {};
      if (bodyFields.name !== undefined) body.name = bodyFields.name;
      if (bodyFields.mapType !== undefined) body.mapType = bodyFields.mapType;
      if (bodyFields.detailedMapList !== undefined) body.detailedMapList = bodyFields.detailedMapList;
      const result = await client.requestRaw("PUT", `/gtm/v1/maps/${mapId}`, undefined, body);
      return result;

    }
  );

  defineTool(
    server,
    "ncloud_gtm_delete_geo_cidr_map",
    "⚠️ Destructive: Permanently delete a Geo or CIDR map. Set confirm=true to execute.",
    {
      mapId: z.number({ required_error: "Required parameter 'mapId' is missing." }).describe("Map ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to execute"),
    },
    async (params) => {
      const result = await client.requestRaw("DELETE", "/gtm/v1/maps", undefined, { list: [params.mapId] });
      return result;

    },
    { destructive: { message: (params) => `⚠️ This will permanently delete GTM Geo/CIDR Map [${params.mapId}].\n\nCall again with confirm=true.` } }
  );

  defineTool(
    server,
    "ncloud_gtm_get_map_types",
    "Get available Geo and CIDR map types for Global Traffic Manager",
    {},
    async () => {
      return client.requestRaw("GET", "/gtm/v1/maps/mapType");
    }
  );

  defineTool(
    server,
    "ncloud_gtm_get_geolocation_info",
    "Get geolocation information (country/continent mappings) for Global Traffic Manager",
    {},
    async () => {
      return client.requestRaw("GET", "/gtm/v1/maps/geolocation");
    }
  );

  // ─── Monitoring Tools ───────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_gtm_get_query_count",
    "Get GTM domain (profile) query count time-series monitoring data",
    {
      baseTimeUnit: z.enum(["MINUTE_1", "MINUTE_5", "MINUTE_30", "HOUR_3", "DAY_1"], { required_error: "Required parameter 'baseTimeUnit' is missing." }).describe("Time unit for aggregation"),
      domainId: z.number().optional().describe("Filter by specific domain (profile) ID"),
    },
    async (params) => {
      const queryParams: Record<string, string> = { baseTimeUnit: params.baseTimeUnit };
      if (params.domainId !== undefined) queryParams.domainId = String(params.domainId);
      const result = await client.requestRaw("GET", "/gtm/v1/monitoring/query-counts", queryParams);
      return result;

    }
  );
}
