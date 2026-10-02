import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { L, requiredError } from "./_messages.js";
import { dryRunPreview } from "./_dryrun.js";

/**
 * Global Edge (CDN) — paths/bodies verified 2026-10-02 against the official guide pages
 * (pub: edge-*, profile-*, purge-*; gov host edge.apigw.gov-ntruss.com, same operations).
 *
 *   profiles      GET  /api/v1/profiles · GET /api/v1/profiles/validation?name= · POST /api/v1/profile {name}
 *                 PUT  /api/v1/profiles/{profileId} {name} · DELETE /api/v1/profiles/{profileId}
 *                 (no single-profile GET exists — ncloud_edge_get_profile filters the list)
 *   edges         GET  /api/v1/profiles/{profileId}/cdn-edges · GET /api/v1/cdn-edge/{edgeId}
 *                 POST /api/v1/cdn-edge · PUT /api/v1/cdn-edges/{edgeId} · DELETE /api/v1/cdn-edges {edges}
 *                 POST /api/v1/cdn-edges/activate|stop {edges} · GET /api/v1/cdn-edges/{edgeId}/status
 *                 GET  /api/v1/statistics/{profileId}/{edgeId}?dateFrom&dateTo
 *   purge         POST /api/v1/purge · GET /api/v1/purge/{purgeRequestId}
 *   certificates  GET|POST /api/v1/certificate/provisioning · GET|DELETE|POST /api/v1/certificate/provisioning/{slotId}
 *                 PUT /api/v1/certificate/provisioning/{slotId}/certificates/tls · DELETE …/{slotId}/certificates
 */
export function registerGlobalEdgeTools(server: McpServer, client: NcloudClient): void {
  // ─── Profile Tools ─────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_edge_list_profiles",
    "List all Global Edge CDN profiles",
    {},
    async () => {
      return client.requestRaw("GET", "/api/v1/profiles");
    }
  );

  defineTool(
    server,
    "ncloud_edge_get_profile",
    "Get a specific Global Edge profile by ID (the API has no single-profile endpoint; this filters the profile list)",
    {
      profileId: z.number({ required_error: requiredError("profileId") }).describe("Profile ID to query"),
    },
    async (params) => {
      const result = await client.requestRaw("GET", "/api/v1/profiles");
      const list: any[] = Array.isArray(result) ? result : Array.isArray(result?.result) ? result.result : Array.isArray(result?.content) ? result.content : [];
      const found = list.find((p) => Number(p?.profileId ?? p?.id) === params.profileId);
      if (!found) {
        return {
          content: [{ type: "text" as const, text: L({ ko: `프로필 [${params.profileId}]을(를) 찾을 수 없습니다.`, en: `Profile [${params.profileId}] not found.` }) }],
          isError: true,
        };
      }
      return found;
    }
  );

  defineTool(
    server,
    "ncloud_edge_check_profile_name",
    "Check whether a Global Edge profile name is available (duplicate check)",
    {
      name: z.string({ required_error: requiredError("name") }).describe("Profile name to check (3-35 chars: letters, digits, '-', '_')"),
    },
    async (params) => {
      return client.requestRaw("GET", "/api/v1/profiles/validation", { name: params.name });
    }
  );

  defineTool(
    server,
    "ncloud_edge_create_profile",
    "Create a new Global Edge CDN profile",
    {
      name: z.string({ required_error: requiredError("name") }).describe("Name for the new profile (3-35 chars: letters, digits, '-', '_')"),
    },
    async (params) => {
      return client.postRequest("/api/v1/profile", { name: params.name });
    }
  );

  defineTool(
    server,
    "ncloud_edge_rename_profile",
    "Rename an existing Global Edge CDN profile",
    {
      profileId: z.number({ required_error: requiredError("profileId") }).describe("Profile ID to rename"),
      name: z.string({ required_error: requiredError("name") }).describe("New profile name (3-35 chars: letters, digits, '-', '_')"),
    },
    async (params) => {
      return client.putRequest(`/api/v1/profiles/${params.profileId}`, { name: params.name });
    }
  );

  defineTool(
    server,
    "ncloud_edge_delete_profile",
    "⚠️ Destructive: Permanently delete a Global Edge CDN profile. All edges under this profile must be deleted first. Set confirm=true to execute.",
    {
      profileId: z.number({ required_error: requiredError("profileId") }).describe("Profile ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      return client.deleteRequest(`/api/v1/profiles/${params.profileId}`);
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete Global Edge Profile [${params.profileId}]. All edges under this profile must be deleted first.\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Edge Query Tools ──────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_edge_list_edges",
    "List all edges under a specific Global Edge profile",
    {
      profileId: z.number({ required_error: requiredError("profileId") }).describe("Profile ID to list edges for"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/v1/profiles/${params.profileId}/cdn-edges`);
    }
  );

  defineTool(
    server,
    "ncloud_edge_get_edge",
    "Get detailed configuration of a specific Global Edge CDN edge including origin, caching, and access control settings",
    {
      edgeId: z.number({ required_error: requiredError("edgeId") }).describe("Edge ID to query"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/v1/cdn-edge/${params.edgeId}`);
    }
  );

  // ─── Edge Create Tool ──────────────────────────────────────────────────────

  const ageTypeSchema = z.enum(["SECONDS", "MINUTES", "HOURS", "DAYS"]);
  const osRegionSchema = z.enum(["KR", "USWN", "SGN", "JPN", "DEN"]);

  defineTool(
    server,
    "ncloud_edge_create_edge",
    "Create a new Global Edge CDN edge with origin, caching, and distribution settings. Sub-objects not exposed as parameters use sensible defaults (no edge logging, no edge auth, no caching rules, no header policies, WHITELIST access control with empty lists). For full control use ncloud_edge_edit_edge after creation. Use dryRun=true to preview without creating.",
    {
      profileId: z.number({ required_error: requiredError("profileId") }).describe("Profile ID to create the edge under"),
      edgeName: z.string({ required_error: requiredError("edgeName") }).describe("Edge name (3-35 chars: letters, digits, '-', '_')"),
      protocolType: z.enum(["HTTPS", "ALL"]).describe("Service protocol: HTTPS or ALL (HTTP+HTTPS)"),
      regionType: z.enum(["KOREA", "JAPAN", "GLOBAL"]).describe("Service region: KOREA, JAPAN, or GLOBAL"),
      serviceDomainType: z.enum(["NCP_DOMAIN_AUTO", "NCP_DOMAIN_CUSTOM", "CUSTOM_DOMAIN"]).describe("Service domain type"),
      serviceDomainName: z.string().optional().describe("Domain name (required for NCP_DOMAIN_CUSTOM or CUSTOM_DOMAIN)"),
      certificateSlotId: z.number().optional().describe("Certificate slot ID (required for CUSTOM_DOMAIN served over HTTPS; see ncloud_edge_list_certificates)"),
      edgeLoggingBucketName: z.string().optional().describe("Enable edge logging into this Object Storage bucket (omit to disable logging)"),
      edgeLoggingRegion: osRegionSchema.optional().describe("Region of the edge-logging bucket (default KR)"),
      edgeLoggingBucketPrefix: z.string().optional().describe("Log path prefix inside the logging bucket"),
      originType: z.enum(["OBJECT_STORAGE", "LOAD_BALANCER", "API_GATEWAY", "CUSTOM"]).describe("Origin server type"),
      originRegion: osRegionSchema.optional().describe("Origin region (required for OBJECT_STORAGE or LOAD_BALANCER)"),
      originBucketName: z.string().optional().describe("Origin bucket name (required for OBJECT_STORAGE)"),
      originCustomLocation: z.string().optional().describe("Origin domain name (required for LOAD_BALANCER, API_GATEWAY, or CUSTOM)"),
      originProtocolType: z.enum(["HTTP", "HTTPS"]).optional().default("HTTP").describe("Origin protocol type"),
      originPort: z.number().optional().default(80).describe("Origin port number"),
      originPath: z.string().optional().describe("Origin path appended to origin requests, e.g. /static/"),
      forwardHostHeaderType: z.enum(["INCOMING_HOST_HEADER", "ORIGIN_HOSTNAME", "CUSTOM"]).optional().default("INCOMING_HOST_HEADER").describe("Host header forwarding type"),
      customHostHeader: z.string().optional().describe("Host header value (required when forwardHostHeaderType is CUSTOM)"),
      cacheRuleDefinitionType: z.enum(["CACHING", "BYPASS_CACHE", "ORIGIN_CACHE_CONTROL_HEADER"]).optional().default("CACHING").describe("Default caching option"),
      cacheRevalidateType: z.enum(["IF_POSSIBLE", "ALWAYS"]).optional().default("IF_POSSIBLE").describe("Stale object revalidation type"),
      cacheAgeType: ageTypeSchema.optional().default("DAYS").describe("Cache max-age unit"),
      cacheAge: z.number().optional().default(7).describe("Cache max-age (1 second to 365 days)"),
      negativeTtl: z.boolean().optional().default(true).describe("Cache origin error responses (negative TTL)"),
      cacheKeyHostname: z.enum(["INCOMING_HOST_HEADER", "ORIGIN_HOSTNAME"]).optional().default("INCOMING_HOST_HEADER").describe("Cache key hostname type"),
      cacheKeyIgnoreQueryStringType: z.enum(["ALL_IGNORED", "ALL_ALLOWED", "ALLOW_SPECIFIC_STRING"]).optional().default("ALL_ALLOWED").describe("How query strings are used in the cache key"),
      cacheKeyQueryStrings: z.array(z.string()).optional().describe("Query strings allowed in the cache key (required for ALLOW_SPECIFIC_STRING)"),
      removeVaryHeader: z.boolean().optional().default(true).describe("Remove Vary headers (other than Accept-Encoding) before caching"),
      cors: z.boolean().optional().default(false).describe("Add CORS headers (managed rule)"),
      http2: z.boolean().optional().default(true).describe("Enable HTTP/2"),
      trueClientIpHeader: z.boolean().optional().default(false).describe("Forward the client IP header to the origin"),
      hsts: z.boolean().optional().default(false).describe("Enable HSTS"),
      httpCompression: z.boolean().optional().default(true).describe("Enable Gzip/Brotli compression"),
      largeFileOptimization: z.boolean().optional().default(true).describe("Enable large file optimization"),
      accessControlType: z.enum(["WHITELIST", "BLACKLIST"]).optional().default("WHITELIST").describe("Access control policy type"),
      accessControlIpPolicies: z.array(z.string()).optional().describe("Client IPs or CIDR blocks for access control"),
      accessControlGeoPolicies: z.array(z.string()).optional().describe("ISO 3166-1 alpha-2 country codes for access control"),
      accessControlRefererPolicies: z.array(z.string()).optional().describe("Referer domains for access control"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating the edge"),
    },
    async (params) => {
      const body: any = {
        profileId: params.profileId,
        edgeName: params.edgeName,
        distributionConfig: {
          protocolType: params.protocolType,
          regionType: params.regionType,
          serviceDomain: {
            domainType: params.serviceDomainType,
            domainName: params.serviceDomainName ?? null,
            certificate: params.certificateSlotId ? { id: params.certificateSlotId } : null,
          },
          edgeLogging: params.edgeLoggingBucketName
            ? {
                enabled: true,
                bucketPrefix: params.edgeLoggingBucketPrefix ?? null,
                objectStorage: { region: params.edgeLoggingRegion ?? "KR", bucketName: params.edgeLoggingBucketName },
              }
            : { enabled: false },
        },
        originalCopyConfig: {
          originalCopyLocation: {
            type: params.originType,
            region: params.originRegion ?? null,
            bucketName: params.originBucketName ?? null,
            customLocation: params.originCustomLocation ?? null,
          },
          forwardHostHeader: {
            type: params.forwardHostHeaderType,
            customHostHeader: params.forwardHostHeaderType === "CUSTOM" ? params.customHostHeader ?? null : null,
          },
          originalCopyProtocol: {
            type: params.originProtocolType,
            port: params.originPort,
          },
          originalCopyPath: params.originPath ?? null,
        },
        cachingConfig: {
          defaultCaching: {
            enabled: true,
            ruleDefinitionType: params.cacheRuleDefinitionType,
            cacheRevalidateConfig: {
              type: params.cacheRevalidateType,
              ageType: params.cacheAgeType,
              age: params.cacheAge,
            },
          },
          negativeTtl: params.negativeTtl,
          bypassQueryString: { enabled: false },
          cacheKeyHostname: params.cacheKeyHostname,
          cacheKeyIgnoreQueryString: params.cacheKeyIgnoreQueryStringType === "ALLOW_SPECIFIC_STRING"
            ? { type: params.cacheKeyIgnoreQueryStringType, queryStrings: params.cacheKeyQueryStrings ?? [] }
            : { type: params.cacheKeyIgnoreQueryStringType },
          removeVaryHeader: params.removeVaryHeader,
          edgeAuth: { enabled: false },
          cachingRules: [],
        },
        managedRule: {
          cors: params.cors,
          http2: params.http2,
          trueClientIpHeader: params.trueClientIpHeader,
          hsts: params.hsts,
        },
        headerPolicies: [],
        optimizationConfig: {
          httpCompression: params.httpCompression,
          largeFileOptimization: params.largeFileOptimization,
          headerMaxSize: {
            singleSize: "SIZE_16KB",
            totalSize: "SIZE_32KB",
          },
        },
        accessControl: {
          type: params.accessControlType,
          ipPolicies: params.accessControlIpPolicies ?? [],
          geoPolicies: params.accessControlGeoPolicies ?? [],
          refererPolicies: params.accessControlRefererPolicies ?? [],
        },
      };
      if (params.cors) {
        body.managedRule.corsPolicy = { allowOrigin: "*", allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: [], allowCredentials: false, useMaxAge: true };
      }

      if (params.dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: Global Edge Creation",
          endpoint: "/api/v1/cdn-edge",
          method: "POST",
          requestParams: body,
          noun: { ko: "엣지", en: "edge" },
        });
      }

      const result = await client.postRequest("/api/v1/cdn-edge", body);
      return {
        리소스타입: "Global Edge",
        엣지명: params.edgeName,
        프로필ID: params.profileId,
        서비스영역: params.regionType,
        프로토콜: params.protocolType,
        오리진타입: params.originType,
        상태: "creating",
        edgeId: result?.result?.edgeId ?? result?.edgeId ?? result?.result?.id ?? result?.id,
        raw: result,
      };
    }
  );

  // ─── Edge Edit Tool ────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_edge_edit_edge",
    "Edit an existing Global Edge CDN edge configuration. Provide the full edge configuration as a JSON object (same shape as the create body: profileId, edgeName, distributionConfig, originalCopyConfig, cachingConfig, managedRule, headerPolicies, optimizationConfig, accessControl). regionType and serviceDomain cannot change — pass their current values.",
    {
      edgeId: z.number({ required_error: requiredError("edgeId") }).describe("Edge ID to edit"),
      configuration: z.string({ required_error: requiredError("configuration") }).describe("Full edge configuration as JSON string (get current config from ncloud_edge_get_edge, modify, and pass here)"),
    },
    async (params) => {
      let config: any;
      try {
        config = JSON.parse(params.configuration);
      } catch {
        return {
          content: [{ type: "text" as const, text: L({ ko: "잘못된 파라미터: 'configuration'은 유효한 JSON 문자열이어야 합니다.", en: "Invalid parameter: 'configuration' must be a valid JSON string." }) }],
          isError: true,
        };
      }

      return client.putRequest(`/api/v1/cdn-edges/${params.edgeId}`, config);
    }
  );

  // ─── Edge Delete Tool ──────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_edge_delete_edge",
    "⚠️ Destructive: Permanently delete one or more Global Edge CDN edges. Edges must be in Stopped status. Set confirm=true to execute.",
    {
      edgeIds: z.array(z.number()).min(1, requiredError("edgeIds")).describe("Edge IDs to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      return client.deleteRequest("/api/v1/cdn-edges", { edges: params.edgeIds });
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete Global Edge [${(params.edgeIds ?? []).join(", ")}]. The edges must be in Stopped status. All cached content will be purged.\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Purge Tools ───────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_edge_purge",
    "Run a cache purge (invalidation) on a Global Edge CDN edge. Supports purging all content, by directory, pattern, or specific URLs. Returns a purge request ID (check with ncloud_edge_get_purge_request).",
    {
      edgeId: z.number({ required_error: requiredError("edgeId") }).describe("Edge ID to purge cache for"),
      purgeType: z.enum(["ALL", "DIRECTORY", "PATTERN", "URL"]).describe("Purge type: ALL (purge everything), DIRECTORY (by directory path), PATTERN (directory + extension), URL (specific files)"),
      purgeTarget: z.array(z.string()).optional().describe("Purge target list (omit for ALL type). DIRECTORY: /path/*, PATTERN: /path/*.ext, URL: /path/file.ext"),
    },
    async (params) => {
      const body: any = {
        edgeId: params.edgeId,
        purgeType: params.purgeType,
      };
      if (params.purgeType !== "ALL") {
        if (!params.purgeTarget || params.purgeTarget.length === 0) {
          return {
            content: [{ type: "text" as const, text: L({ ko: `purgeType=${params.purgeType} 에는 purgeTarget 이 필요합니다.`, en: `purgeTarget is required when purgeType is ${params.purgeType}.` }) }],
            isError: true,
          };
        }
        body.purgeTarget = params.purgeTarget;
      }

      return client.postRequest("/api/v1/purge", body);
    }
  );

  defineTool(
    server,
    "ncloud_edge_get_purge_request",
    "Get the status/details of a Global Edge purge request",
    {
      purgeRequestId: z.number({ required_error: requiredError("purgeRequestId") }).describe("Purge request ID returned by ncloud_edge_purge"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/v1/purge/${params.purgeRequestId}`);
    }
  );

  // ─── Edge Operation Tools ────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_edge_start_edge",
    "Start (activate) stopped Global Edge CDN edges to resume content delivery",
    {
      edgeIds: z.array(z.number()).min(1, requiredError("edgeIds")).describe("Edge IDs to activate"),
    },
    async (params) => {
      return client.postRequest("/api/v1/cdn-edges/activate", { edges: params.edgeIds });
    }
  );

  defineTool(
    server,
    "ncloud_edge_stop_edge",
    "Stop running Global Edge CDN edges. Stopped edges do not serve content.",
    {
      edgeIds: z.array(z.number()).min(1, requiredError("edgeIds")).describe("Edge IDs to stop"),
    },
    async (params) => {
      return client.postRequest("/api/v1/cdn-edges/stop", { edges: params.edgeIds });
    }
  );

  defineTool(
    server,
    "ncloud_edge_get_edge_status",
    "Get the current operational status of a Global Edge CDN edge",
    {
      edgeId: z.number({ required_error: requiredError("edgeId") }).describe("Edge ID to check status for"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/v1/cdn-edges/${params.edgeId}/status`);
    }
  );

  defineTool(
    server,
    "ncloud_edge_get_edge_stats",
    "Get traffic statistics summary for a Global Edge CDN edge within a time range (UTC, up to 730 days back)",
    {
      profileId: z.number({ required_error: requiredError("profileId") }).describe("Profile ID that the edge belongs to"),
      edgeId: z.number({ required_error: requiredError("edgeId") }).describe("Edge ID to get statistics for"),
      dateFrom: z.string({ required_error: requiredError("dateFrom") }).describe("Start date-time (ISO 8601 UTC, e.g. 2025-07-17T07:00:00Z)"),
      dateTo: z.string({ required_error: requiredError("dateTo") }).describe("End date-time (ISO 8601 UTC, e.g. 2025-07-17T08:00:00Z)"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/v1/statistics/${params.profileId}/${params.edgeId}`, {
        dateFrom: params.dateFrom,
        dateTo: params.dateTo,
      });
    }
  );

  // ─── Certificate Tools ─────────────────────────────────────────────────────

  const tlsVersionSchema = z.enum(["TLS_ALL_VERSIONS", "TLS_MIN_VERSION_1_2"]);
  const cipherProfileSchema = z.enum(["DEFAULT", "GENERAL", "STRICT"]);

  defineTool(
    server,
    "ncloud_edge_list_certificates",
    "List provisioned SSL/TLS certificate slots for Global Edge CDN",
    {
      pageNo: z.number().optional().describe("Page number (default 1)"),
      offset: z.number().optional().describe("Items per page (default 15)"),
    },
    async (params) => {
      return client.requestRaw("GET", "/api/v1/certificate/provisioning", { pageNo: params.pageNo, offset: params.offset });
    }
  );

  defineTool(
    server,
    "ncloud_edge_provision_certificate",
    "Provision certificates from Certificate Manager into a new Global Edge certificate slot for custom domains",
    {
      serviceRegion: z.enum(["KR_JP", "KR_JP_GLOBAL"]).describe("Service region: KR_JP (one KR/JP certificate) or KR_JP_GLOBAL (one KR/JP + one global certificate)"),
      cmCertificateIds: z.array(z.number()).min(1, requiredError("cmCertificateIds")).describe("Certificate Manager certificate numbers"),
      tlsVersion: tlsVersionSchema.describe("Supported TLS versions (TLS_MIN_VERSION_1_2 recommended)"),
      cipherProfile: cipherProfileSchema.describe("Cipher profile (STRICT not allowed with TLS_ALL_VERSIONS)"),
    },
    async (params) => {
      return client.postRequest("/api/v1/certificate/provisioning", {
        serviceRegion: params.serviceRegion,
        cmCertificateIds: params.cmCertificateIds,
        tlsVersion: params.tlsVersion,
        cipherProfile: params.cipherProfile,
      });
    }
  );

  defineTool(
    server,
    "ncloud_edge_get_certificate",
    "Get details of a Global Edge certificate slot (certificates provisioned in the slot)",
    {
      slotId: z.number({ required_error: requiredError("slotId") }).describe("Certificate slot ID"),
      pageNo: z.number().optional().describe("Page number (default 1)"),
      offset: z.number().optional().describe("Items per page (default 15)"),
    },
    async (params) => {
      return client.requestRaw("GET", `/api/v1/certificate/provisioning/${params.slotId}`, { pageNo: params.pageNo, offset: params.offset });
    }
  );

  defineTool(
    server,
    "ncloud_edge_add_certificate_to_slot",
    "Add a Global Edge Dedicated certificate (from Certificate Manager) to an existing certificate slot",
    {
      slotId: z.number({ required_error: requiredError("slotId") }).describe("Certificate slot ID"),
      cmCertificateId: z.number({ required_error: requiredError("cmCertificateId") }).describe("Certificate Manager certificate number (Global Edge Dedicated type)"),
    },
    async (params) => {
      return client.postRequest(`/api/v1/certificate/provisioning/${params.slotId}`, { cmCertificateId: params.cmCertificateId });
    }
  );

  defineTool(
    server,
    "ncloud_edge_update_certificate_tls",
    "Update the TLS version and cipher profile of a Global Edge certificate slot",
    {
      slotId: z.number({ required_error: requiredError("slotId") }).describe("Certificate slot ID"),
      tlsVersion: tlsVersionSchema.describe("Supported TLS versions"),
      cipherProfile: cipherProfileSchema.describe("Cipher profile (STRICT not allowed with TLS_ALL_VERSIONS)"),
    },
    async (params) => {
      return client.putRequest(`/api/v1/certificate/provisioning/${params.slotId}/certificates/tls`, {
        tlsVersion: params.tlsVersion,
        cipherProfile: params.cipherProfile,
      });
    }
  );

  defineTool(
    server,
    "ncloud_edge_remove_certificates_from_slot",
    "⚠️ Destructive: Remove specific certificates (expired or superseded Global Edge Dedicated certificates) from a certificate slot. Set confirm=true to execute.",
    {
      slotId: z.number({ required_error: requiredError("slotId") }).describe("Certificate slot ID"),
      certificateItemIds: z.array(z.number()).min(1, requiredError("certificateItemIds")).describe("Certificate numbers to remove from the slot"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      return client.deleteRequest(`/api/v1/certificate/provisioning/${params.slotId}/certificates`, { certificateItemIds: params.certificateItemIds });
    },
    { destructive: { message: (params) => `⚠️ This will remove certificates [${(params.certificateItemIds ?? []).join(", ")}] from Global Edge certificate slot [${params.slotId}].\n\nTo execute, call this tool again with confirm=true.` } }
  );

  defineTool(
    server,
    "ncloud_edge_delete_certificate",
    "⚠️ Destructive: Delete a Global Edge certificate slot. The slot must not be in use by any edge. Set confirm=true to execute.",
    {
      slotId: z.number({ required_error: requiredError("slotId") }).describe("Certificate slot ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      return client.deleteRequest(`/api/v1/certificate/provisioning/${params.slotId}`);
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete Global Edge certificate slot [${params.slotId}]. The slot must not be in use by any edge.\n\nTo execute, call this tool again with confirm=true.` } }
  );
}
