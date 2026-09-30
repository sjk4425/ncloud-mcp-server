import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool, excludingTools } from "./_tool.js";
import { requiredError } from "./_messages.js";
import type { Zone } from "../client/endpoints.js";

/**
 * One Click Multi DRM 도구 (`ncloud_drm_*`) — 두 존 제공.
 *
 * Base URL: https://multi-drm.apigw.ntruss.com (민간존) / https://multi-drm.apigw.gov-ntruss.com (공공존) — registry 에서 주입.
 * 경로 prefix /api/v1 (Site /sites, Policy /policy, License /license). REST(JSON) GET/POST/PUT/DELETE,
 * 인증 HMAC-SHA256 + **`x-ncp-region_code: KR`**(두 존 개요 모두 필수 헤더로 명시) → GET 은 requestRaw(regionHeader),
 * 쓰기는 postRequest/putRequest/deleteRequest(헤더 내장).
 *
 * 근거(2026-09-30): https://api.ncloud-docs.com/docs/one-click-multi-drm-api-overview ,
 *                  https://api-gov.ncloud-docs.com/docs/one-click-multi-drm-api-overview
 * 정책 복제(`drm-policy-copy`, POST /api/v1/policy/{policyId}/copy)는 **민간존 가이드에만** 있다.
 *
 * 구현 범위: 관리·모니터링(Site 7 + DRM Policy 6(+복제) + License 통계 1).
 *   ※ 런타임/플레이어용 4종(FairPlay/Widevine·PlayReady License Request, Client Bind 토큰, DRM Content Encryption)은
 *      challenge blob·X-DRM-TOKEN 등 플레이어 페이로드가 필요해 래핑하지 않는다.
 * 최초 구현은 ncloud-gov-mcp-server v0.1.0(공공존 가이드 기반)에서 가져왔다.
 */

// DRM 정책 설정(create/update 공용) — Widevine/PlayReady/FairPlay
const drmPolicyConfigSchema = z.object({
  widevine: z.object({
    useYn: z.boolean().describe("Enable/disable Widevine"),
    securityLevel: z.number().optional().describe("Security level 1-5 (higher = stronger)"),
    hdcp: z.enum(["HDCP_NONE", "HDCP_V1", "HDCP_V2", "HDCP_V2_1", "HDCP_V2_2", "HDCP_NO_DIGITAL_OUTPUT"]).optional().describe("HDCP level"),
    cgms: z.enum(["CGMS_NONE", "COPY_FREE", "COPY_ONCE", "COPY_NEVER"]).optional().describe("Analog output security (CGMS)"),
    disableAnalogOutputYn: z.boolean().optional().describe("Block analog output"),
    hdcpSrmRule: z.enum(["HDCP_SRM_RULE_NONE", "CURRENT_SRM"]).optional().describe("SRM handling"),
    deviceRevocation: z.boolean().optional().describe("Allow licenses for revoked Android devices"),
  }).describe("Widevine policy configuration"),
  playready: z.object({
    useYn: z.boolean().describe("Enable/disable PlayReady"),
    securityLevel: z.number().optional().describe("Security level: 150, 2000, 3000"),
    digitalVideoProtectionLevel: z.number().optional().describe("Digital video protection: 100, 250, 270, 300, 301"),
    analogVideoProtectionLevel: z.number().optional().describe("Analog video protection: 100, 150, 200, 201"),
    digitalAudioProtectionLevel: z.number().optional().describe("Digital audio protection: 100, 250, 300, 301"),
    hdcpUseYn: z.boolean().optional().describe("Require HDCP 2.2+ (Type 1)"),
  }).describe("PlayReady policy configuration"),
  fairplay: z.object({
    useYn: z.boolean().describe("Enable/disable FairPlay Streaming"),
    hdcpEnforcement: z.string().optional().describe("HDCP enforcement: '-1' (none), '0' (Type 0), '1' (Type 1)"),
    allowAirPlay: z.boolean().optional().describe("Allow AirPlay playback"),
    allowAvAdaptor: z.boolean().optional().describe("Allow digital AV adapter output"),
  }).describe("FairPlay Streaming policy configuration"),
});

// Site 생성/수정 공용 body 필드
const fairPlayCertSchema = z.object({
  certFile: z.string().optional().describe("FPS certificate (DER/CER file or HTTP URL)"),
  privateKey: z.string().optional().describe("Private key (PEM file or HTTP URL)"),
  privateEncryptedString: z.string().optional().describe("Password string for the private key file"),
  secretKey: z.string().optional().describe("ASK (Application Secret Key) string"),
}).describe("FairPlay Streaming certificate details");

/** 민간존 가이드에만 있는 오퍼레이션 — 공공존에서는 미등록. */
export const DRM_PUBLIC_ONLY_TOOLS = ["ncloud_drm_copy_policy"] as const;

export interface MultiDrmToolOptions {
  /** 존 — 민간존 전용 도구 제외. 기본 `public`. */
  zone?: Zone;
}

export function registerMultiDrmTools(server: McpServer, client: NcloudClient, opts: MultiDrmToolOptions = {}): void {
  const zone: Zone = opts.zone ?? "public";
  const s = zone === "gov" ? excludingTools(server, DRM_PUBLIC_ONLY_TOOLS) : server;
  // GET helper — DRM API는 x-ncp-region_code 헤더 필요
  const get = (path: string, query?: Record<string, string | number | boolean | undefined>) =>
    client.requestRaw("GET", path, query, undefined, { regionHeader: true });

  // ═══════════════════════════════════════════════════════════════════════
  // Site Management
  // ═══════════════════════════════════════════════════════════════════════

  defineTool(
    s,
    "ncloud_drm_list_sites",
    "List One Click Multi DRM sites with pagination",
    {
      pageNo: z.number().optional().describe("Page number (1~N, default 1)"),
      pageSize: z.number().optional().describe("Items per page (1~100)"),
    },
    async (params) => get("/api/v1/sites", params)
  );

  defineTool(
    s,
    "ncloud_drm_get_site",
    "Get detailed information about a specific DRM site",
    {
      siteId: z.string({ required_error: requiredError("siteId") }).describe("Site ID (from ncloud_drm_list_sites)"),
    },
    async (params) => get(`/api/v1/sites/${encodeURIComponent(params.siteId)}`)
  );

  defineTool(
    s,
    "ncloud_drm_create_site",
    "Create a new DRM site (binds a DRM policy; optionally registers a FairPlay certificate)",
    {
      policyId: z.number({ required_error: requiredError("policyId") }).describe("DRM policy ID (0 = Basic default, or a custom policy ID)"),
      siteName: z.string({ required_error: requiredError("siteName") }).describe("Site name (3-20 chars: letters, numbers, '_')"),
      fairPlayCert: fairPlayCertSchema.optional(),
    },
    async (params) => client.postRequest("/api/v1/sites", params)
  );

  defineTool(
    s,
    "ncloud_drm_update_site",
    "Update a DRM site (policy binding, name, or FairPlay certificate)",
    {
      siteId: z.string({ required_error: requiredError("siteId") }).describe("Site ID to update"),
      policyId: z.number({ required_error: requiredError("policyId") }).describe("DRM policy ID (0 = Basic default, or a custom policy ID)"),
      siteName: z.string({ required_error: requiredError("siteName") }).describe("Site name (3-20 chars: letters, numbers, '_')"),
      fairPlayCert: fairPlayCertSchema.optional(),
    },
    async (params) => {
      const { siteId, ...body } = params;
      return client.putRequest(`/api/v1/sites/${encodeURIComponent(siteId)}`, body);
    }
  );

  defineTool(
    s,
    "ncloud_drm_enable_site",
    "Enable (activate) a DRM site",
    {
      siteId: z.string({ required_error: requiredError("siteId") }).describe("Site ID to enable"),
    },
    async (params) => client.putRequest(`/api/v1/sites/${encodeURIComponent(params.siteId)}/on`, {})
  );

  defineTool(
    s,
    "ncloud_drm_disable_site",
    "Disable (deactivate) a DRM site. Disable a site before modifying its active policy.",
    {
      siteId: z.string({ required_error: requiredError("siteId") }).describe("Site ID to disable"),
    },
    async (params) => client.putRequest(`/api/v1/sites/${encodeURIComponent(params.siteId)}/off`, {})
  );

  defineTool(
    s,
    "ncloud_drm_get_site_logs",
    "Get event logs for a DRM site",
    {
      siteId: z.string({ required_error: requiredError("siteId") }).describe("Site ID to query logs for"),
      pageNo: z.number().optional().describe("Page number (1~N, default 1)"),
      pageSize: z.number().optional().describe("Items per page (1~100)"),
    },
    async (params) => get("/api/v1/sites/siteLog", params)
  );

  // ═══════════════════════════════════════════════════════════════════════
  // DRM Policy Management
  // ═══════════════════════════════════════════════════════════════════════

  defineTool(
    s,
    "ncloud_drm_list_policies",
    "List DRM policies with pagination",
    {
      pageNo: z.number().optional().describe("Page number (1~N, default 1)"),
      pageSize: z.number().optional().describe("Items per page (1~100)"),
    },
    async (params) => get("/api/v1/policy", params)
  );

  defineTool(
    s,
    "ncloud_drm_get_policy",
    "Get detailed configuration of a specific DRM policy",
    {
      policyId: z.number({ required_error: requiredError("policyId") }).describe("DRM policy ID (from ncloud_drm_list_policies)"),
    },
    async (params) => get(`/api/v1/policy/${params.policyId}`)
  );

  defineTool(
    s,
    "ncloud_drm_create_policy",
    "Create a new DRM policy with Widevine / PlayReady / FairPlay security settings",
    {
      policyName: z.string({ required_error: requiredError("policyName") }).describe("Policy name (3-20 chars: letters, numbers, '_')"),
      persistent: z.boolean({ required_error: requiredError("persistent") }).describe("Offline license retention (must be true if using rentalDuration)"),
      rentalDuration: z.number({ required_error: requiredError("rentalDuration") }).describe("Seconds until first playback must start after license acquisition (0~2147483647, default 0)"),
      playbackDuration: z.number({ required_error: requiredError("playbackDuration") }).describe("License validity in seconds from first playback (0~2147483647, default 0)"),
      drmPolicyConfig: drmPolicyConfigSchema.describe("Per-DRM policy settings (widevine/playready/fairplay)"),
    },
    async (params) => client.postRequest("/api/v1/policy", params)
  );

  defineTool(
    s,
    "ncloud_drm_copy_policy",
    "Duplicate a DRM policy (POST /api/v1/policy/{policyId}/copy — Public zone only). The copy is named 'Copy_<original>' and gets a new policyId.",
    {
      policyId: z.number({ required_error: requiredError("policyId") }).describe("DRM policy ID to duplicate"),
    },
    async (params) => client.postRequest(`/api/v1/policy/${params.policyId}/copy`, {})
  );

  defineTool(
    s,
    "ncloud_drm_update_policy",
    "Update a DRM policy. Disable any site using this policy before updating.",
    {
      policyId: z.number({ required_error: requiredError("policyId") }).describe("DRM policy ID to update"),
      policyName: z.string({ required_error: requiredError("policyName") }).describe("Policy name (3-20 chars: letters, numbers, '_')"),
      persistent: z.boolean({ required_error: requiredError("persistent") }).describe("Offline license retention"),
      rentalDuration: z.number({ required_error: requiredError("rentalDuration") }).describe("Seconds until first playback (0~2147483647)"),
      playbackDuration: z.number({ required_error: requiredError("playbackDuration") }).describe("License validity in seconds from first playback (0~2147483647)"),
      drmPolicyConfig: drmPolicyConfigSchema.describe("Per-DRM policy settings (widevine/playready/fairplay)"),
    },
    async (params) => {
      const { policyId, ...body } = params;
      return client.putRequest(`/api/v1/policy/${policyId}`, body);
    }
  );

  defineTool(
    s,
    "ncloud_drm_delete_policy",
    "⚠️ Destructive: Permanently delete a DRM policy. Disable any site using this policy first. Set confirm=true to execute.",
    {
      policyId: z.number({ required_error: requiredError("policyId") }).describe("DRM policy ID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => client.deleteRequest(`/api/v1/policy/${params.policyId}`),
    { destructive: { message: (params) => `⚠️ This will permanently delete DRM Policy [${params.policyId}]. Ensure no active site uses it (disable the site first).\n\nTo execute, call this tool again with confirm=true.` } }
  );

  defineTool(
    s,
    "ncloud_drm_get_policy_logs",
    "Get event logs for a DRM policy",
    {
      policyId: z.number({ required_error: requiredError("policyId") }).describe("DRM policy ID to query logs for"),
      pageNo: z.number().optional().describe("Page number (1~N, default 1)"),
      pageSize: z.number().optional().describe("Items per page (1~100)"),
      startTime: z.number().optional().describe("Query start time (Unix epoch milliseconds)"),
      endTime: z.number().optional().describe("Query end time (Unix epoch milliseconds)"),
    },
    async (params) => get("/api/v1/policy/policyLog", params)
  );

  // ═══════════════════════════════════════════════════════════════════════
  // License Statistics (monitoring)
  // ═══════════════════════════════════════════════════════════════════════

  defineTool(
    s,
    "ncloud_drm_get_license_statistics",
    "Get DRM license issuance statistics/history for a site (filterable by content/user/device, time range, status)",
    {
      siteId: z.string({ required_error: requiredError("siteId") }).describe("Site ID to query license statistics for"),
      searchCondition: z.enum(["contentId", "drmType", "userId", "deviceId", "deviceModel"]).optional().describe("Search field to filter by"),
      searchKeyword: z.string().optional().describe("Search term matching searchCondition"),
      startTime: z.number().optional().describe("Query start time (Unix epoch milliseconds)"),
      endTime: z.number().optional().describe("Query end time (Unix epoch milliseconds)"),
      status: z.enum(["success", "fail"]).optional().describe("Filter by license issuance result"),
      pageNo: z.number().optional().describe("Page number (default 1)"),
      pageSize: z.number().optional().describe("Items per page (1~100)"),
    },
    async (params) => get("/api/v1/license/statistics", params)
  );
}
