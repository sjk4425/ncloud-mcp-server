import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";

export function registerGlobalEdgeTools(server: McpServer, client: NcloudClient): void {
  // ─── Profile Query Tools ───────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_edge_list_profiles",
    "List all Global Edge CDN profiles",
    {
      pageNo: z.number().optional().describe("Page number for pagination (default 1)"),
      pageSize: z.number().optional().describe("Number of items per page (default 15)"),
    },
    async (params) => {
      return client.request("/api/v1/profiles", params);
    }
  );

  defineTool(
    server,
    "ncloud_edge_get_profile",
    "Get detailed information about a specific Global Edge profile",
    {
      profileId: z.number({ required_error: "필수 파라미터 'profileId'가 누락되었습니다." }).describe("Profile ID to query"),
    },
    async (params) => {
      return client.request(`/api/v1/profiles/${params.profileId}`);
    }
  );

  // ─── Profile Management Tools ────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_edge_create_profile",
    "Create a new Global Edge CDN profile",
    {
      profileName: z.string({ required_error: "필수 파라미터 'profileName'이 누락되었습니다." }).describe("Name for the new Global Edge profile"),
    },
    async (params) => {
      const body = { profileName: params.profileName };
      const result = await client.postRequest("/api/v1/profiles", body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_edge_delete_profile",
    "⚠️ Destructive: Permanently delete a Global Edge CDN profile. All edges under this profile must be deleted first. Set confirm=true to execute.",
    {
      profileId: z.number({ required_error: "필수 파라미터 'profileId'가 누락되었습니다." }).describe("Profile ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      if (!params.confirm) {
        const message = `⚠️ This will permanently delete Global Edge Profile [${params.profileId}]. All edges under this profile must be deleted first.\n\nTo execute, call this tool again with confirm=true.`;
        return { content: [{ type: "text" as const, text: message }] };
      }
      const result = await client.deleteRequest(`/api/v1/profiles/${params.profileId}`);
      return result;
    }
  );

  // ─── Edge Query Tools ──────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_edge_list_edges",
    "List all edges under a specific Global Edge profile",
    {
      profileId: z.number({ required_error: "필수 파라미터 'profileId'가 누락되었습니다." }).describe("Profile ID to list edges for"),
      pageNo: z.number().optional().describe("Page number for pagination (default 1)"),
      pageSize: z.number().optional().describe("Number of items per page (default 15)"),
    },
    async (params) => {
      const { profileId, ...queryParams } = params;
      const result = await client.request("/api/v1/cdn-edges", { profileId, ...queryParams });
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_edge_get_edge",
    "Get detailed configuration of a specific Global Edge CDN edge including origin, caching, and access control settings",
    {
      edgeId: z.number({ required_error: "필수 파라미터 'edgeId'가 누락되었습니다." }).describe("Edge ID to query"),
    },
    async (params) => {
      return client.request(`/api/v1/cdn-edge/${params.edgeId}`);
    }
  );

  // ─── Edge Create Tool ──────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_edge_create_edge",
    "Create a new Global Edge CDN edge with origin, caching, and distribution settings. Use dryRun=true to preview without creating.",
    {
      profileId: z.number({ required_error: "필수 파라미터 'profileId'가 누락되었습니다." }).describe("Profile ID to create the edge under"),
      edgeName: z.string({ required_error: "필수 파라미터 'edgeName'이 누락되었습니다." }).describe("Edge name (3-35 chars, letters, numbers, '-', '_')"),
      protocolType: z.enum(["HTTP", "HTTPS", "ALL"]).describe("Service protocol type"),
      regionType: z.enum(["KOREA", "JAPAN", "GLOBAL"]).describe("Service area (KOREA, JAPAN, or GLOBAL)"),
      serviceDomainType: z.enum(["NCP_DOMAIN_AUTO", "NCP_DOMAIN_CUSTOM", "CUSTOM_DOMAIN"]).describe("Service domain type"),
      serviceDomainName: z.string().optional().describe("Domain name (required for NCP_DOMAIN_CUSTOM or CUSTOM_DOMAIN)"),
      certificateSlotId: z.number().optional().describe("Certificate slot ID (required for CUSTOM_DOMAIN with HTTPS)"),
      originType: z.enum(["OBJECT_STORAGE", "LOAD_BALANCER", "API_GATEWAY", "CUSTOM"]).describe("Origin server type"),
      originRegion: z.string().optional().describe("Origin region (required for OBJECT_STORAGE or LOAD_BALANCER)"),
      originBucketName: z.string().optional().describe("Origin bucket name (required for OBJECT_STORAGE)"),
      originCustomLocation: z.string().optional().describe("Origin domain name (required for LOAD_BALANCER, API_GATEWAY, or CUSTOM)"),
      originProtocolType: z.enum(["HTTP", "HTTPS"]).optional().default("HTTP").describe("Origin protocol type"),
      originPort: z.number().optional().default(80).describe("Origin port number"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the edge"),
    },
    async (params) => {
      if (params.dryRun) {
        const preview = {
          label: "🔍 Dry-Run Preview: Global Edge Creation",
          profileId: params.profileId,
          edgeName: params.edgeName,
          protocolType: params.protocolType,
          regionType: params.regionType,
          serviceDomainType: params.serviceDomainType,
          serviceDomainName: params.serviceDomainName || "(auto-generated)",
          originType: params.originType,
          originLocation: params.originBucketName || params.originCustomLocation || "(not specified)",
          message: "이 요청은 실제 엣지를 생성하지 않습니다. dryRun=false로 호출하면 엣지가 생성됩니다.",
        };
        return preview;
      }

      const body: any = {
        profileId: params.profileId,
        edgeName: params.edgeName,
        distributionConfig: {
          protocolType: params.protocolType,
          regionType: params.regionType,
          serviceDomain: {
            domainType: params.serviceDomainType,
            domainName: params.serviceDomainName || null,
            certificate: params.certificateSlotId ? { id: params.certificateSlotId } : null,
          },
          edgeLogging: { enabled: false },
        },
        originalCopyConfig: {
          originalCopyLocation: {
            type: params.originType,
            region: params.originRegion || null,
            bucketName: params.originBucketName || null,
            customLocation: params.originCustomLocation || null,
          },
          forwardHostHeader: {
            type: "INCOMING_HOST_HEADER",
            customHostHeader: null,
          },
          originalCopyProtocol: {
            type: params.originProtocolType,
            port: params.originPort,
          },
          originalCopyPath: null,
        },
        cachingConfig: {
          defaultCaching: {
            enabled: true,
            ruleDefinitionType: "CACHING",
            cacheRevalidateConfig: {
              type: "IF_POSSIBLE",
              ageType: "DAYS",
              age: 7,
            },
          },
          negativeTtl: true,
          bypassQueryString: { enabled: false },
          cacheKeyHostname: "INCOMING_HOST_HEADER",
          cacheKeyIgnoreQueryString: { type: "ALL_ALLOWED" },
          removeVaryHeader: true,
          edgeAuth: { enabled: false },
          cachingRules: [],
        },
        managedRule: {
          cors: false,
          http2: true,
          trueClientIpHeader: false,
          hsts: false,
        },
        headerPolicies: [],
        optimizationConfig: {
          httpCompression: true,
          largeFileOptimization: true,
          headerMaxSize: {
            singleSize: "SIZE_16KB",
            totalSize: "SIZE_32KB",
          },
        },
        accessControl: {
          type: "WHITELIST",
          ipPolicies: [],
          geoPolicies: [],
          refererPolicies: [],
        },
      };

      const result = await client.postRequest("/api/v1/cdn-edges", body);
      const summary = {
        리소스타입: "Global Edge",
        엣지명: params.edgeName,
        프로필ID: params.profileId,
        서비스영역: params.regionType,
        프로토콜: params.protocolType,
        오리진타입: params.originType,
        상태: "creating",
        edgeId: result?.result?.edgeId || result?.edgeId,
      };
      return summary;
    }
  );

  // ─── Edge Edit Tool ────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_edge_edit_edge",
    "Edit an existing Global Edge CDN edge configuration. Provide the full edge configuration as a JSON object.",
    {
      edgeId: z.number({ required_error: "필수 파라미터 'edgeId'가 누락되었습니다." }).describe("Edge ID to edit"),
      configuration: z.string({ required_error: "필수 파라미터 'configuration'이 누락되었습니다." }).describe("Full edge configuration as JSON string (get current config from ncloud_edge_get_edge, modify, and pass here)"),
    },
    async (params) => {
      let config: any;
      try {
        config = JSON.parse(params.configuration);
      } catch {
        return {
          content: [{ type: "text" as const, text: "잘못된 파라미터: 'configuration'은 유효한 JSON 문자열이어야 합니다." }],
          isError: true,
        };
      }

      const result = await client.putRequest(`/api/v1/cdn-edges/${params.edgeId}`, config);
      return result;
    }
  );

  // ─── Edge Delete Tool ──────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_edge_delete_edge",
    "⚠️ Destructive: Permanently delete a Global Edge CDN edge. The edge must be in Stopped status. Set confirm=true to execute.",
    {
      edgeId: z.number({ required_error: "필수 파라미터 'edgeId'가 누락되었습니다." }).describe("Edge ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      if (!params.confirm) {
        const message = `⚠️ This will permanently delete Global Edge [${params.edgeId}]. The edge must be in Stopped status. All cached content will be purged.\n\nTo execute, call this tool again with confirm=true.`;
        return { content: [{ type: "text" as const, text: message }] };
      }
      const result = await client.deleteRequest(`/api/v1/cdn-edges/${params.edgeId}`);
      return result;
    }
  );

  // ─── Purge Tool ────────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_edge_purge",
    "Run a cache purge (invalidation) on a Global Edge CDN edge. Supports purging all content, by directory, pattern, or specific URLs.",
    {
      edgeId: z.number({ required_error: "필수 파라미터 'edgeId'가 누락되었습니다." }).describe("Edge ID to purge cache for"),
      purgeType: z.enum(["ALL", "DIRECTORY", "PATTERN", "URL"]).describe("Purge type: ALL (purge everything), DIRECTORY (by directory path), PATTERN (directory + extension), URL (specific files)"),
      purgeTarget: z.array(z.string()).optional().describe("Purge target list (omit for ALL type). DIRECTORY: /path/*, PATTERN: /path/*.ext, URL: /path/file.ext"),
    },
    async (params) => {
      const body: any = {
        edgeId: params.edgeId,
        purgeType: params.purgeType,
      };
      if (params.purgeType !== "ALL" && params.purgeTarget) {
        body.purgeTarget = params.purgeTarget;
      }

      const result = await client.postRequest("/api/v1/purge", body);
      return result;
    }
  );

  // ─── Edge Operation Tools ────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_edge_start_edge",
    "Start (restart) a stopped Global Edge CDN edge to resume content delivery",
    {
      profileId: z.number({ required_error: "필수 파라미터 'profileId'가 누락되었습니다." }).describe("Profile ID that the edge belongs to"),
      edgeId: z.number({ required_error: "필수 파라미터 'edgeId'가 누락되었습니다." }).describe("Edge ID to start"),
    },
    async (params) => {
      return client.postRequest(`/api/v1/profiles/${params.profileId}/cdn-edges/${params.edgeId}/start`, {});
    }
  );

  defineTool(
    server,
    "ncloud_edge_stop_edge",
    "Stop a running Global Edge CDN edge. Stopped edges do not serve content.",
    {
      profileId: z.number({ required_error: "필수 파라미터 'profileId'가 누락되었습니다." }).describe("Profile ID that the edge belongs to"),
      edgeId: z.number({ required_error: "필수 파라미터 'edgeId'가 누락되었습니다." }).describe("Edge ID to stop"),
    },
    async (params) => {
      return client.postRequest(`/api/v1/profiles/${params.profileId}/cdn-edges/${params.edgeId}/stop`, {});
    }
  );

  defineTool(
    server,
    "ncloud_edge_get_edge_status",
    "Get the current operational status of a Global Edge CDN edge",
    {
      profileId: z.number({ required_error: "필수 파라미터 'profileId'가 누락되었습니다." }).describe("Profile ID that the edge belongs to"),
      edgeId: z.number({ required_error: "필수 파라미터 'edgeId'가 누락되었습니다." }).describe("Edge ID to check status for"),
    },
    async (params) => {
      return client.request(`/api/v1/profiles/${params.profileId}/cdn-edges/${params.edgeId}/status`);
    }
  );

  defineTool(
    server,
    "ncloud_edge_get_edge_stats",
    "Get traffic statistics for a Global Edge CDN edge within a specified time range",
    {
      profileId: z.number({ required_error: "필수 파라미터 'profileId'가 누락되었습니다." }).describe("Profile ID that the edge belongs to"),
      edgeId: z.number({ required_error: "필수 파라미터 'edgeId'가 누락되었습니다." }).describe("Edge ID to get statistics for"),
      startDateTime: z.string({ required_error: "필수 파라미터 'startDateTime'이 누락되었습니다." }).describe("Start date-time for statistics (ISO 8601 format, e.g. 2024-01-01T00:00:00Z)"),
      endDateTime: z.string({ required_error: "필수 파라미터 'endDateTime'이 누락되었습니다." }).describe("End date-time for statistics (ISO 8601 format, e.g. 2024-01-02T00:00:00Z)"),
    },
    async (params) => {
      return client.request(`/api/v1/profiles/${params.profileId}/cdn-edges/${params.edgeId}/stats`, {
          startDateTime: params.startDateTime,
          endDateTime: params.endDateTime,
        });
    }
  );

  defineTool(
    server,
    "ncloud_edge_get_purge_history",
    "Get cache purge execution history for a Global Edge CDN edge",
    {
      profileId: z.number({ required_error: "필수 파라미터 'profileId'가 누락되었습니다." }).describe("Profile ID that the edge belongs to"),
      edgeId: z.number({ required_error: "필수 파라미터 'edgeId'가 누락되었습니다." }).describe("Edge ID to get purge history for"),
    },
    async (params) => {
      return client.request(`/api/v1/profiles/${params.profileId}/cdn-edges/${params.edgeId}/purge-history`);
    }
  );

  // ─── Certificate Tools ─────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_edge_list_certificates",
    "List all provisioned SSL/TLS certificates for Global Edge CDN",
    {
      pageNo: z.number().optional().describe("Page number for pagination (default 1)"),
      pageSize: z.number().optional().describe("Number of items per page (default 15)"),
    },
    async (params) => {
      return client.request("/api/v1/certificate/provisioning", params);
    }
  );

  defineTool(
    server,
    "ncloud_edge_provision_certificate",
    "Provision (register) a certificate from Certificate Manager to Global Edge for use with custom domains",
    {
      certificateNo: z.number({ required_error: "필수 파라미터 'certificateNo'가 누락되었습니다." }).describe("Certificate number from Certificate Manager to provision"),
      serviceRegion: z.enum(["KR_JP", "GLOBAL"]).optional().default("KR_JP").describe("Certificate application scope: KR_JP (Korea/Japan) or GLOBAL"),
    },
    async (params) => {
      const body = {
        certificateNo: params.certificateNo,
        serviceRegion: params.serviceRegion,
      };
      const result = await client.postRequest("/api/v1/certificate/provisioning", body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_edge_get_certificate",
    "Get detailed information about a specific provisioned certificate for Global Edge CDN",
    {
      certificateId: z.number({ required_error: "필수 파라미터 'certificateId'가 누락되었습니다." }).describe("Certificate ID to query"),
    },
    async (params) => {
      return client.request(`/api/v1/certificate/provisioning/${params.certificateId}`);
    }
  );

  defineTool(
    server,
    "ncloud_edge_delete_certificate",
    "⚠️ Destructive: Delete a provisioned certificate from Global Edge CDN. The certificate must not be in use by any edge. Set confirm=true to execute.",
    {
      certificateId: z.number({ required_error: "필수 파라미터 'certificateId'가 누락되었습니다." }).describe("Certificate ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      if (!params.confirm) {
        const message = `⚠️ This will permanently delete Global Edge Certificate [${params.certificateId}]. The certificate must not be in use by any edge.\n\nTo execute, call this tool again with confirm=true.`;
        return { content: [{ type: "text" as const, text: message }] };
      }
      const result = await client.deleteRequest(`/api/v1/certificate/provisioning/${params.certificateId}`);
      return result;
    }
  );
}
