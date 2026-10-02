import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool, excludingTools } from "./_tool.js";
import { L, requiredError } from "./_messages.js";
import { dryRunPreview } from "./_dryrun.js";
import { nksPathPrefix, type Zone } from "../client/endpoints.js";

/**
 * NKS (Ncloud Kubernetes Service) API Tools
 *
 * Base URL: https://nks.apigw.ntruss.com (민간존) / https://nks.apigw.gov-ntruss.com (공공존)
 * API Style: RESTful (GET/POST/PATCH/PUT/DELETE with JSON body)
 * Auth: x-ncp-apigw-timestamp, x-ncp-iam-access-key, x-ncp-apigw-signature-v2, Content-Type: application/json
 *
 * NOTE: NKS API does NOT use responseFormatType=json (always returns JSON).
 * All requests use client.requestRaw() instead of client.request().
 *
 * 경로 접두는 **리전별**이다(민간존 KR `/vnks/v2` · SGN `/vnks/sgn-v2` · JPN `/vnks/jpn-v2`, 공공존 KR `/vnks/v2` ·
 * KRS `/vnks/krs-v2`) — 모든 경로는 `base()`(`nksPathPrefix(zone, client.getRegionCode())`)로 조립한다.
 *
 * 2026-09-30 두 존 공식 가이드 대조로 정정한 오퍼레이션(모두 두 존 공통 스펙):
 *   - Cluster Subnet 추가: `PATCH /clusters/{uuid}/add-subnet`, body `{ subnets: [{ number }] }` (nks-addsubnet)
 *   - NodePool Subnet 수정: `PATCH .../node-pool/{instanceNo}/subnets`, body `{ subnets: [number] }` (nks-updatenodepoolsubnet)
 *   - LB Subnet 수정: **쿼리** `lbSubnetNo` | `lbSubnetNoList`(민간존, ≤2) + `igwYn`, 본문 없음 (nks-lbsubnet)
 *   - IP ACL: `defaultAction` 필수, `entries[].comment` (nks-patchipacl)
 *   - IAM Access Entry: `/access-entries`, 식별자 `entryUuid`(UUID), 생성 body `{type, entry, groups?, policies?}`,
 *     수정은 **PUT** `{groups?, policies?}` (nks-createaccessentry / nks-updateaccessentry / nks-getaccessentry)
 *   - kubeconfig 재발급(`PATCH /kubeconfig`, nks-updatekubeconfig)은 민간존 가이드에만 있다.
 */
export interface NksToolOptions {
  /** 존 — 리전별 경로 접두 표를 고른다. 기본 `public`. */
  zone?: Zone;
  /** `ncloud_nks_reset_kubeconfig` 등록 여부. 기본 true(민간존). 공공존·금융존 가이드에는 해당 오퍼레이션이 없다. */
  resetKubeconfig?: boolean;
  /** Add-on Manager 도구 8종 등록 여부. 기본 true. 금융존 가이드에는 addon 오퍼레이션이 없다(2026-09-30). */
  addons?: boolean;
}

/** Add-on Manager 도구 — 금융존 미제공. */
export const NKS_ADDON_TOOLS = [
  "ncloud_nks_list_available_addons",
  "ncloud_nks_get_available_addon",
  "ncloud_nks_get_available_addon_version",
  "ncloud_nks_list_cluster_addons",
  "ncloud_nks_get_cluster_addon",
  "ncloud_nks_install_addons",
  "ncloud_nks_update_addon",
  "ncloud_nks_delete_addon",
] as const;

export function registerContainersNksTools(rawServer: McpServer, client: NcloudClient, opts: NksToolOptions = {}): void {
  const zone: Zone = opts.zone ?? "pub";
  const server = opts.addons === false ? excludingTools(rawServer, NKS_ADDON_TOOLS) : rawServer;
  /** 현재 리전의 경로 접두(리전은 런타임에 바뀔 수 있어 호출 시점에 계산). */
  const base = () => nksPathPrefix(zone, client.getRegionCode());

  // ─── Cluster Query Tools ───────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_nks_list_clusters",
    "List all NKS (Ncloud Kubernetes Service) clusters in the current region",
    {},
    async () => {
      return client.requestRaw("GET", `${base()}/clusters`);
    }
  );

  defineTool(
    server,
    "ncloud_nks_get_cluster",
    "Get detailed information about a specific NKS cluster",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster to query"),
    },
    async (params) => {
      return client.requestRaw("GET", `${base()}/clusters/${params.clusterUuid}`);
    }
  );


  // ─── Cluster Create Tool ───────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_nks_create_cluster",
    `Create a new NKS Kubernetes cluster. Use dryRun=true to preview without creating.

**G3(KVM) cluster requirements:**
- hypervisorCode: 'KVM' (required)
- clusterType: must contain G003 (e.g., SVR.VNKS.STAND.C004.M016.G003)
- k8sVersion: must use nks.2 suffix (e.g., 1.35.3-nks.2)
- lbPrivateSubnetNo: Private LB subnet number (required — returns 400 without details if missing)
- zoneCode: Required at cluster level when isRegional=false (default). Missing causes 400 without details.
- nodePool.softwareCode: Must use FULL value from ncloud_nks_get_server_images including pipe and image number (e.g., SW.VSVR.OS.LNX64.UBNTU.SVR22.WRKND.G003|23215604)
- nodePool.serverSpecCode: g3 spec code (e.g., c2-g3)
- nodePool.storageSize: 100~2000GB (required)

**Server-side validations added 2026-09-17 (request fails with 400 if violated):**
- Regional cluster (isRegional=true): every nodePool.zoneCode must match the zone of the subnets assigned to that node pool (subnetNoList). Check each subnet's zone with the VPC subnet tools before creating.
- log.audit=true requires an active Cloud Log Analytics (CLA) subscription on the account — subscribe first or leave audit off and enable later with ncloud_nks_set_audit_log.
- Istio is now available as an add-on (1.36+ clusters): install after creation with ncloud_nks_install_addons.

**G2(XEN) vs G3(KVM) differences:**
- G2: clusterType contains G002, k8sVersion suffix nks.1, hypervisorCode optional
- G3: clusterType contains G003, k8sVersion suffix nks.2, hypervisorCode='KVM' required`,
    {
      name: z.string({ required_error: requiredError("name") }).describe("Cluster name (3-30 chars, lowercase+numbers+'-')"),
      clusterType: z.string({ required_error: requiredError("clusterType") }).describe("Cluster type (e.g., SVR.VNKS.STAND.C004.M016.G003 for G3, SVR.VNKS.STAND.C004.M016.G002 for G2)"),
      loginKeyName: z.string({ required_error: requiredError("loginKeyName") }).describe("Login key name for node access"),
      regionCode: z.string({ required_error: requiredError("regionCode") }).describe("Region code (e.g., KR, SGN, JPN)"),
      vpcNo: z.number({ required_error: requiredError("vpcNo") }).describe("VPC number"),
      subnetNoList: z.array(z.number(), { required_error: requiredError("subnetNoList") }).describe("Subnet number list for the cluster"),
      lbPublicSubnetNo: z.number().optional().describe("Load balancer public subnet number. Required unless lbPublicSubnetNoList is given (Public zone) — the Government-zone guide lists it as required"),
      lbPublicSubnetNoList: z.array(z.number()).max(2).optional().describe("Public zone only: up to 2 public LB subnet numbers in different zones (multi-zone). Alternative to lbPublicSubnetNo"),
      k8sVersion: z.string().optional().describe("Kubernetes version (from ncloud_nks_get_versions). G3/KVM uses nks.2 suffix, G2/XEN uses nks.1 suffix"),
      hypervisorCode: z.string().optional().describe("Hypervisor code: XEN (default) or KVM. Required as 'KVM' for G3 clusters"),
      zoneCode: z.string().optional().describe("Zone code (e.g., KR-2). Required when isRegional is false (default). API returns 400 without details if missing for single-zone clusters"),
      zoneNo: z.number().optional().describe("Zone number — documented alternative to zoneCode"),
      subnetLbNo: z.number().optional().describe("Load balancer subnet number (legacy single LB-subnet field; conditional per the guide)"),
      lbPrivateSubnetNo: z.number().optional().describe("Load balancer private subnet number. Required for G3/KVM clusters (API returns 400 without details if missing)"),
      lbPrivateSubnetNoList: z.array(z.number()).max(2).optional().describe("Public zone only: up to 2 private LB subnet numbers in different zones (multi-zone). Alternative to lbPrivateSubnetNo"),
      isRegional: z.boolean().optional().describe("Multi-zone (Regional) cluster. Default: false. Public zone only (not in the Government-zone guide)"),
      publicNetwork: z.boolean().optional().describe("Subnet network type. true=Public, false=Private (default)"),
      log: z.object({ audit: z.boolean().optional() }).optional().describe("Log settings. audit=true sends the Kubernetes audit log to Cloud Log Analytics and, since 2026-09-17, is rejected (400) unless the account has an active CLA subscription"),
      authType: z.enum(["API", "CONFIG_MAP"]).optional().describe("Cluster authentication mode. IAM access entries (ncloud_nks_*_access_entry) require API. ⚠️ Once set to API it cannot be changed back"),
      bootstrapAccessEntry: z.boolean().optional().describe("Auto-create an IAM access entry for the creating principal (authType=API only)"),
      kmsKeyTag: z.string().optional().describe("KMS key tag for Kubernetes secret encryption (from the Key Management Service console)"),
      nodePool: z.array(z.object({
        name: z.string().optional().describe("Node pool name"),
        nodeCount: z.number().optional().describe("Number of nodes"),
        subnetNo: z.number().optional().describe("Subnet number for the node pool (single subnet)"),
        subnetNoList: z.array(z.number()).optional().describe("Subnet numbers for the node pool (multiple subnets)"),
        softwareCode: z.string().optional().describe("Server image code — MUST use the FULL value from ncloud_nks_get_server_images including pipe and image number (e.g., SW.VSVR.OS.LNX64.UBNTU.SVR22.WRKND.G003|23215604). Do NOT strip the pipe portion."),
        productCode: z.string().optional().describe("Product code (XEN/G2 only, not available for G3/KVM)"),
        serverSpecCode: z.string().optional().describe("Server spec code (KVM/G3 only, e.g., c2-g3. from ncloud_nks_get_server_specs)"),
        storageSize: z.number().optional().describe("Storage size in GB (KVM/G3 only, 100-2000, required for G3)"),
        labels: z.array(z.object({ key: z.string(), value: z.string() })).optional().describe("Node labels"),
        taints: z.array(z.object({ key: z.string(), value: z.string().optional(), effect: z.string() })).optional().describe("Node taints"),
        serverRoleId: z.string().optional().describe("IAM server role ID"),
        fabricCluster: z.object({
          poolName: z.string().optional().describe("Fabric cluster pool name"),
          poolNo: z.number().optional().describe("Fabric cluster pool number"),
        }).optional().describe("Fabric cluster to place the node pool in (poolName or poolNo)"),
        zoneCode: z.string().optional().describe("Zone code (e.g., KR-1). Required for Regional clusters and, since 2026-09-17, must match the zone of the subnets assigned to this node pool — a mismatch is rejected with 400"),
      })).optional().describe("Initial node pool configurations"),
      addons: z.array(z.object({
        addonName: z.string().describe("Add-on name (from ncloud_nks_list_available_addons)"),
        version: z.string().optional().describe("Add-on version (from ncloud_nks_get_available_addon)"),
        configurationValues: z.record(z.unknown()).optional().describe("Add-on configuration values (schema from ncloud_nks_get_available_addon_version)"),
      })).optional().describe("Add-ons to install together with the cluster"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually creating"),
    },
    async (params) => {
      // ─── G3/KVM pre-validation ────────────────────────────────────────────
      const isG3 = params.clusterType?.includes("G003") || params.hypervisorCode?.toUpperCase() === "KVM";

      // 공용 LB 서브넷은 단일 값 또는(민간존) 목록 중 하나가 있어야 한다.
      if (params.lbPublicSubnetNo === undefined && (!params.lbPublicSubnetNoList || params.lbPublicSubnetNoList.length === 0)) {
        return {
          content: [{ type: "text" as const, text: L({
            ko: "❌ lbPublicSubnetNo(또는 민간존 lbPublicSubnetNoList) 중 하나는 필수입니다.",
            en: "❌ One of lbPublicSubnetNo (or, in the Public zone, lbPublicSubnetNoList) is required.",
          }) }],
          isError: true,
        };
      }

      // ─── Common pre-validation (applies to both G2 and G3) ────────────────
      if (!params.isRegional && !params.zoneCode) {
        return {
          content: [{ type: "text" as const, text: L({
            ko: "❌ 단일 존 클러스터(isRegional=false, 기본값) 생성 시 zoneCode는 필수입니다.\n\n클러스터 레벨에 zoneCode를 지정해주세요 (예: KR-2).\n미전달 시 NKS API가 상세 에러 없이 400 Bad Request만 반환합니다.",
            en: "❌ zoneCode is required when creating a single-zone cluster (isRegional=false, the default).\n\nSpecify zoneCode at the cluster level (e.g. KR-2).\nWithout it, the NKS API returns a bare 400 Bad Request with no details.",
          }) }],
          isError: true,
        };
      }

      // softwareCode 형식 검증 (파이프 포함 여부)
      if (params.nodePool && params.nodePool.length > 0) {
        for (const pool of params.nodePool) {
          if (pool.softwareCode && !pool.softwareCode.includes("|")) {
            return {
              content: [{ type: "text" as const, text: L({
                ko: `❌ nodePool "${pool.name || "(unnamed)"}"의 softwareCode 형식이 올바르지 않습니다.\n\n입력값: ${pool.softwareCode}\n\nsoftwareCode는 반드시 ncloud_nks_get_server_images의 value 필드 전체를 사용해야 합니다.\n올바른 형식: 코드|이미지번호 (예: SW.VSVR.OS.LNX64.UBNTU.SVR22.WRKND.G003|23215604)\n\n파이프(|) 뒤의 이미지 번호를 제거하지 마세요.`,
                en: `❌ Invalid softwareCode format for nodePool "${pool.name || "(unnamed)"}".\n\nValue: ${pool.softwareCode}\n\nsoftwareCode must be the entire value field from ncloud_nks_get_server_images.\nCorrect format: code|imageNumber (e.g. SW.VSVR.OS.LNX64.UBNTU.SVR22.WRKND.G003|23215604)\n\nDo not strip the image number after the pipe (|).`,
              }) }],
              isError: true,
            };
          }
        }
      }

      if (isG3) {
        if (!params.lbPrivateSubnetNo) {
          return {
            content: [{ type: "text" as const, text: L({
              ko: "❌ G3/KVM 클러스터 생성 시 lbPrivateSubnetNo는 필수입니다.\n\n미전달 시 NKS API가 상세 에러 없이 400 Bad Request만 반환합니다.\nPrivate Load Balancer용 서브넷 번호를 지정해주세요.",
              en: "❌ lbPrivateSubnetNo is required when creating a G3/KVM cluster.\n\nWithout it, the NKS API returns a bare 400 Bad Request with no details.\nSpecify the subnet number for the private load balancer.",
            }) }],
            isError: true,
          };
        }

        if (!params.hypervisorCode || params.hypervisorCode.toUpperCase() !== "KVM") {
          return {
            content: [{ type: "text" as const, text: L({
              ko: "❌ G3 클러스터(clusterType에 G003 포함) 생성 시 hypervisorCode를 'KVM'으로 지정해야 합니다.\n\n미지정 시 API가 G2(XEN)로 해석하여 clusterType/k8sVersion 불일치 에러가 발생합니다.",
              en: "❌ Set hypervisorCode to 'KVM' when creating a G3 cluster (clusterType containing G003).\n\nOtherwise the API interprets it as G2 (XEN), causing a clusterType/k8sVersion mismatch error.",
            }) }],
            isError: true,
          };
        }

        if (params.k8sVersion && !params.k8sVersion.includes("-nks.2")) {
          return {
            content: [{ type: "text" as const, text: L({
              ko: `❌ G3/KVM 클러스터에서는 nks.2 suffix 버전만 사용 가능합니다.\n\n입력값: ${params.k8sVersion}\n예시: 1.35.3-nks.2\n\nncloud_nks_get_versions(hypervisorCode='KVM')으로 사용 가능한 버전을 확인하세요.`,
              en: `❌ G3/KVM clusters only support versions with the nks.2 suffix.\n\nValue: ${params.k8sVersion}\nExample: 1.35.3-nks.2\n\nCheck available versions with ncloud_nks_get_versions(hypervisorCode='KVM').`,
            }) }],
            isError: true,
          };
        }
      }
      // ─── End pre-validation ───────────────────────────────────────────────

      const { dryRun, ...body } = params;
      if (dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: NKS Cluster Creation",
          endpoint: `${base()}/clusters`,
          method: "POST",
          requestParams: body,
          noun: { ko: "클러스터", en: "cluster" },
          notes: {
            ...(isG3 ? { g3Validation: L({ ko: "✅ G3/KVM 필수 파라미터 검증 통과", en: "✅ G3/KVM required-parameter validation passed" }) } : {}),
            // 2026-09-17 서버측 검증 2건은 클라이언트에서 판정할 수 없어(서브넷 zone·CLA 구독 조회 필요) 대조 자료만 노출한다.
            ...(params.isRegional
              ? {
                  regionalZoneCheck: L({
                    ko: "Regional 클러스터: 아래 노드풀 zoneCode가 각 노드풀에 배정된 서브넷의 zone과 일치해야 합니다(2026-09-17부터 불일치 시 400).",
                    en: "Regional cluster: each node pool zoneCode below must match the zone of that pool's subnets (mismatch → 400 since 2026-09-17).",
                  }),
                  nodePoolZones: (params.nodePool ?? []).map((np) => ({ name: np.name, zoneCode: np.zoneCode ?? null })),
                  clusterSubnetNoList: params.subnetNoList,
                }
              : {}),
            ...(params.log?.audit
              ? { auditLogCheck: L({
                  ko: "log.audit=true: 계정에 Cloud Log Analytics 구독이 있어야 합니다(2026-09-17부터 미구독 시 400).",
                  en: "log.audit=true requires an active Cloud Log Analytics subscription (400 since 2026-09-17 otherwise).",
                }) }
              : {}),
          },
        });
      }

      const result = await client.requestRaw("POST", `${base()}/clusters`, undefined, body);
      return result;
    }
  );

  // ─── Cluster Delete Tool ───────────────────────────────────────────────────
  // ⚠️ Destructive: DELETE method, confirm=true required, description has warning

  defineTool(
    server,
    "ncloud_nks_delete_cluster",
    "⚠️ Destructive: Permanently delete an NKS Kubernetes cluster. Set confirm=true to execute.",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const result = await client.requestRaw("DELETE", `${base()}/clusters/${params.clusterUuid}`);
      return result ?? { success: true };
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete NKS Cluster [${params.clusterUuid}]. All node pools and workloads will be destroyed.\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Cluster Upgrade Tool ──────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_nks_upgrade_cluster",
    "Upgrade the Kubernetes version of an NKS cluster. Uses PATCH with query parameters.",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster to upgrade"),
      k8sVersion: z.string({ required_error: requiredError("k8sVersion") }).describe("Target Kubernetes version (e.g., 1.27.9-nks.1)"),
      maxSurge: z.number().optional().describe("Max nodes that can be added during upgrade (default: 1)"),
      maxUnavailable: z.number().optional().describe("Max nodes that can be unavailable during upgrade (default: 0)"),
    },
    async (params) => {
      const queryParams: Record<string, string> = { k8sVersion: params.k8sVersion };
      if (params.maxSurge !== undefined) queryParams.maxSurge = String(params.maxSurge);
      if (params.maxUnavailable !== undefined) queryParams.maxUnavailable = String(params.maxUnavailable);
      const result = await client.requestRaw("PATCH", `${base()}/clusters/${params.clusterUuid}/upgrade`, queryParams);
      return result;
    }
  );


  // ─── Cluster Configuration Tools ──────────────────────────────────────────

  defineTool(
    server,
    "ncloud_nks_set_audit_log",
    "Configure audit log collection via Cloud Log Analytics (CLA) for an NKS cluster. Since 2026-09-17 enabling it (audit=true) is rejected with 400 unless the account has an active CLA subscription — subscribe to Cloud Log Analytics first.",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
      audit: z.boolean({ required_error: requiredError("audit") }).describe("Whether to enable audit log collection (true/false)"),
    },
    async (params) => {
      return client.requestRaw("PATCH", `${base()}/clusters/${params.clusterUuid}/log`, undefined, { audit: params.audit });
    }
  );

  defineTool(
    server,
    "ncloud_nks_add_subnet",
    "Add subnets to an NKS cluster (PATCH /clusters/{uuid}/add-subnet; a cluster can have at most 5 subnets)",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
      subnetNoList: z.array(z.number(), { required_error: requiredError("subnetNoList") }).min(1).describe("List of subnet numbers to add (sent as subnets[].number)"),
    },
    async (params) => {
      // 스펙(두 존 공통): PATCH .../add-subnet, body { subnets: [{ number }] } — 이전의 `/subnet` + subnetNoList 는 어느 존 문서에도 없다.
      const body = { subnets: params.subnetNoList.map((number) => ({ number })) };
      return client.requestRaw("PATCH", `${base()}/clusters/${params.clusterUuid}/add-subnet`, undefined, body);
    }
  );

  defineTool(
    server,
    "ncloud_nks_set_oidc",
    "Configure OIDC (OpenID Connect) authentication for an NKS cluster",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
      status: z.boolean({ required_error: requiredError("status") }).describe("OIDC activation status (true=enable, false=disable)"),
      clientId: z.string({ required_error: requiredError("clientId") }).describe("OIDC provider Client ID"),
      issuerURL: z.string({ required_error: requiredError("issuerURL") }).describe("OIDC provider URL"),
      usernameClaim: z.string().optional().describe("JWT claim for username"),
      usernamePrefix: z.string().optional().describe("Prefix for username claim"),
      groupsClaim: z.string().optional().describe("JWT claim for groups"),
      groupsPrefix: z.string().optional().describe("Prefix for groups claim"),
      requiredClaim: z.string().optional().describe("Required claim as key=value pair"),
    },
    async (params) => {
      const { clusterUuid, ...body } = params;
      const result = await client.requestRaw("PATCH", `${base()}/clusters/${clusterUuid}/oidc`, undefined, body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_nks_get_oidc",
    "Get OIDC (OpenID Connect) provider configuration for an NKS cluster",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
    },
    async (params) => {
      return client.requestRaw("GET", `${base()}/clusters/${params.clusterUuid}/oidc`);
    }
  );

  defineTool(
    server,
    "ncloud_nks_get_ip_acl",
    "Get IP ACL configuration for an NKS cluster",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
    },
    async (params) => {
      return client.requestRaw("GET", `${base()}/clusters/${params.clusterUuid}/ip-acl`);
    }
  );

  defineTool(
    server,
    "ncloud_nks_set_ip_acl",
    "Configure IP ACL for an NKS cluster to restrict API server access. defaultAction (allow|deny) is required and applies to addresses not matched by entries.",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
      defaultAction: z.enum(["allow", "deny"], { required_error: requiredError("defaultAction") }).describe("Default action for addresses not matched by any entry"),
      entries: z.array(z.object({
        action: z.enum(["allow", "deny"]).describe("ACL action for this entry"),
        address: z.string().describe("IP address or CIDR block"),
        comment: z.string().optional().describe("Free-text comment"),
      })).optional().describe("IP ACL entries (optional)"),
    },
    async (params) => {
      // 스펙(두 존 공통, nks-patchipacl): defaultAction 필수, entries 선택 — 이전 구현은 defaultAction 누락으로 항상 실패했다.
      const body: Record<string, unknown> = { defaultAction: params.defaultAction };
      if (params.entries) body.entries = params.entries;
      return client.requestRaw("PATCH", `${base()}/clusters/${params.clusterUuid}/ip-acl`, undefined, body);
    }
  );

  defineTool(
    server,
    "ncloud_nks_set_return_protection",
    "Configure return (deletion) protection for an NKS cluster",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
      returnProtection: z.boolean({ required_error: requiredError("returnProtection") }).describe("Enable/disable deletion protection"),
    },
    async (params) => {
      return client.requestRaw("PATCH", `${base()}/clusters/${params.clusterUuid}/return-protection`, undefined, { returnProtection: params.returnProtection });
    }
  );

  defineTool(
    server,
    "ncloud_nks_update_lb_subnet",
    "Update the load balancer subnet of an NKS cluster. Parameters are sent as query string (no JSON body): lbSubnetNo (or, Public zone only, lbSubnetNoList with up to 2 subnets in different zones) plus igwYn (Y = public subnet, N = private, default).",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
      lbSubnetNo: z.number().optional().describe("Load balancer subnet instance number (required unless lbSubnetNoList is given)"),
      lbSubnetNoList: z.array(z.number()).max(2).optional().describe("Public zone only: up to 2 LB subnet instance numbers in different zones (multi-zone). Alternative to lbSubnetNo"),
      igwYn: z.enum(["Y", "N"]).optional().describe("Subnet type: Y = public LB subnet, N = private (default)"),
    },
    async (params) => {
      // 스펙(두 존 공통, nks-lbsubnet): PATCH + 쿼리 파라미터, 본문 없음 — 이전 구현은 존재하지 않는 body 필드를 보냈다.
      if (params.lbSubnetNo === undefined && (!params.lbSubnetNoList || params.lbSubnetNoList.length === 0)) {
        return { content: [{ type: "text" as const, text: "One of lbSubnetNo or lbSubnetNoList (Public zone) is required." }], isError: true };
      }
      const queryParams: Record<string, string> = {};
      if (params.lbSubnetNo !== undefined) queryParams.lbSubnetNo = String(params.lbSubnetNo);
      if (params.lbSubnetNoList && params.lbSubnetNoList.length > 0) queryParams.lbSubnetNoList = params.lbSubnetNoList.join(",");
      if (params.igwYn) queryParams.igwYn = params.igwYn;
      const result = await client.requestRaw("PATCH", `${base()}/clusters/${params.clusterUuid}/lb-subnet`, queryParams);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_nks_update_secret_encryption",
    "Configure secret encryption for an NKS cluster",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
      kmsKeyTag: z.string().optional().describe("KMS key tag for secret encryption"),
    },
    async (params) => {
      const { clusterUuid, ...body } = params;
      const result = await client.requestRaw("PATCH", `${base()}/clusters/${clusterUuid}/secret-encryption`, undefined, body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_nks_update_auth_type",
    "Update authentication mode for an NKS cluster",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
      authType: z.string({ required_error: requiredError("authType") }).describe("Auth type: API or CONFIG_MAP"),
    },
    async (params) => {
      return client.requestRaw("PATCH", `${base()}/clusters/${params.clusterUuid}/auth-type`, undefined, { authType: params.authType });
    }
  );


  // ─── Kubeconfig Tools ──────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_nks_get_kubeconfig",
    "Retrieve the kubeconfig for a specified NKS cluster",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
    },
    async (params) => {
      return client.requestRaw("GET", `${base()}/clusters/${params.clusterUuid}/kubeconfig`);
    }
  );

  // kubeconfig 재발급은 민간존 가이드(nks-updatekubeconfig)에만 있다 — 공공존은 등록하지 않는다.
  if (opts.resetKubeconfig ?? true) {
    defineTool(
      server,
      "ncloud_nks_reset_kubeconfig",
      "Reset the kubeconfig credentials for a specified NKS cluster",
      {
        clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
      },
      async (params) => {
        return client.requestRaw("PATCH", `${base()}/clusters/${params.clusterUuid}/kubeconfig`);
      }
    );
  }

  // ─── Worker Node Tools ─────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_nks_list_worker_nodes",
    "List worker nodes in an NKS cluster",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
    },
    async (params) => {
      return client.requestRaw("GET", `${base()}/clusters/${params.clusterUuid}/nodes`);
    }
  );

  // ⚠️ Destructive: DELETE worker node, confirm=true required
  defineTool(
    server,
    "ncloud_nks_delete_worker_node",
    "⚠️ Destructive: Delete a specific worker node from an NKS cluster. Set confirm=true to execute.",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
      instanceNo: z.number({ required_error: requiredError("instanceNo") }).describe("Instance number of the worker node to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to execute"),
    },
    async (params) => {
      const result = await client.requestRaw("DELETE", `${base()}/clusters/${params.clusterUuid}/nodes/${params.instanceNo}`);
      return result ?? { success: true };
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete Worker Node [${params.instanceNo}] from Cluster [${params.clusterUuid}].\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Node Pool Tools ───────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_nks_list_node_pools",
    "List all node pools in a specified NKS cluster",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
      hypervisorCode: z.enum(["XEN", "KVM"]).optional().describe("Hypervisor filter: XEN (default) or KVM"),
    },
    async (params) => {
      return client.requestRaw("GET", `${base()}/clusters/${params.clusterUuid}/node-pool`, params.hypervisorCode ? { hypervisorCode: params.hypervisorCode } : undefined);
    }
  );

  defineTool(
    server,
    "ncloud_nks_create_node_pool",
    "Create a new node pool in an NKS cluster. Use dryRun=true to preview. On a Regional cluster, zoneCode is required and must match the zone of the subnets the pool uses (400 on mismatch since 2026-09-17).",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
      name: z.string({ required_error: requiredError("name") }).describe("Node pool name"),
      nodeCount: z.number().optional().describe("Number of nodes (required if autoscale not set)"),
      softwareCode: z.string().optional().describe("Server image code"),
      serverSpecCode: z.string().optional().describe("Server spec code (KVM)"),
      storageSize: z.number().optional().describe("Storage size in GB (KVM, 100-2000)"),
      autoscale: z.object({
        enabled: z.boolean().optional(),
        min: z.number().optional(),
        max: z.number().optional(),
      }).optional().describe("Autoscale configuration"),
      labels: z.array(z.object({ key: z.string(), value: z.string() })).optional().describe("Node labels"),
      taints: z.array(z.object({ key: z.string(), value: z.string().optional(), effect: z.string() })).optional().describe("Node taints"),
      serverRoleId: z.string().optional().describe("IAM server role ID"),
      zoneCode: z.string().optional().describe("Zone code (e.g., KR-1). Required for Regional clusters and, since 2026-09-17, must match the zone of the subnets assigned to this node pool — a mismatch is rejected with 400"),
      dryRun: z.boolean().optional().default(false).describe("If true, preview only"),
    },
    async (params) => {
      const { clusterUuid, dryRun, ...body } = params;
      if (dryRun) {
        // clusterUuid는 경로 세그먼트라 본문에 들어가지 않는다 — 프리뷰도 본문만 보여준다.
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: Node Pool Creation",
          endpoint: `${base()}/clusters/${clusterUuid}/node-pool`,
          method: "POST",
          requestParams: body,
          noun: { ko: "노드풀", en: "node pool" },
        });
      }
      const result = await client.requestRaw("POST", `${base()}/clusters/${clusterUuid}/node-pool`, undefined, body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_nks_update_node_pool",
    "Update node pool settings (node count or autoscale) in an NKS cluster",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
      instanceNo: z.number({ required_error: requiredError("instanceNo") }).describe("Node pool instance number"),
      nodeCount: z.number().optional().describe("Desired node count (required if autoscale disabled)"),
      autoscale: z.object({
        enabled: z.boolean().optional(),
        min: z.number().optional(),
        max: z.number().optional(),
      }).optional().describe("Autoscale configuration"),
    },
    async (params) => {
      const body: Record<string, unknown> = {};
      if (params.nodeCount !== undefined) body.nodeCount = params.nodeCount;
      if (params.autoscale !== undefined) body.autoscale = params.autoscale;
      const result = await client.requestRaw("PATCH", `${base()}/clusters/${params.clusterUuid}/node-pool/${params.instanceNo}`, undefined, body);
      return result;
    }
  );

  // ⚠️ Destructive: DELETE node pool, confirm=true required
  defineTool(
    server,
    "ncloud_nks_delete_node_pool",
    "⚠️ Destructive: Permanently delete a node pool from an NKS cluster. Set confirm=true to execute.",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
      instanceNo: z.number({ required_error: requiredError("instanceNo") }).describe("Node pool instance number to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to execute"),
    },
    async (params) => {
      const result = await client.requestRaw("DELETE", `${base()}/clusters/${params.clusterUuid}/node-pool/${params.instanceNo}`);
      return result ?? { success: true };
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete Node Pool [${params.instanceNo}] from Cluster [${params.clusterUuid}].\n\nTo execute, call this tool again with confirm=true.` } }
  );


  // ─── Node Pool Label / Taint / Upgrade / Subnet ────────────────────────────

  defineTool(
    server,
    "ncloud_nks_update_node_pool_label",
    "Update labels on a node pool in an NKS cluster (PUT replaces all labels)",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
      instanceNo: z.number({ required_error: requiredError("instanceNo") }).describe("Node pool instance number"),
      labels: z.array(z.object({
        key: z.string({ required_error: requiredError("labels[].key") }),
        value: z.string({ required_error: requiredError("labels[].value") }),
      }), { required_error: requiredError("labels") }).describe("Label key/value pairs"),
    },
    async (params) => {
      return client.requestRaw("PUT", `${base()}/clusters/${params.clusterUuid}/node-pool/${params.instanceNo}/labels`, undefined, { labels: params.labels });
    }
  );

  defineTool(
    server,
    "ncloud_nks_update_node_pool_taint",
    "Update taints on a node pool in an NKS cluster (PUT replaces all taints)",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
      instanceNo: z.number({ required_error: requiredError("instanceNo") }).describe("Node pool instance number"),
      taints: z.array(z.object({
        key: z.string({ required_error: requiredError("taints[].key") }),
        value: z.string().optional().describe("Taint value"),
        effect: z.string({ required_error: requiredError("taints[].effect") }).describe("NoSchedule | PreferNoSchedule | NoExecute"),
      }), { required_error: requiredError("taints") }).describe("Taint key/value/effect objects"),
    },
    async (params) => {
      return client.requestRaw("PUT", `${base()}/clusters/${params.clusterUuid}/node-pool/${params.instanceNo}/taints`, undefined, { taints: params.taints });
    }
  );

  defineTool(
    server,
    "ncloud_nks_upgrade_node_pool",
    "Upgrade the Kubernetes version of a node pool. Uses PATCH with query parameters.",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
      instanceNo: z.number({ required_error: requiredError("instanceNo") }).describe("Node pool instance number"),
      k8sVersion: z.string({ required_error: requiredError("k8sVersion") }).describe("Target Kubernetes version"),
      maxSurge: z.number().optional().describe("Max nodes added during upgrade (default: 1)"),
      maxUnavailable: z.number().optional().describe("Max unavailable nodes during upgrade (default: 0)"),
    },
    async (params) => {
      const queryParams: Record<string, string> = { k8sVersion: params.k8sVersion };
      if (params.maxSurge !== undefined) queryParams.maxSurge = String(params.maxSurge);
      if (params.maxUnavailable !== undefined) queryParams.maxUnavailable = String(params.maxUnavailable);
      const result = await client.requestRaw("PATCH", `${base()}/clusters/${params.clusterUuid}/node-pool/${params.instanceNo}/upgrade`, queryParams);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_nks_update_node_pool_subnet",
    "Update the subnets of a node pool that has manually assigned subnets (PATCH .../node-pool/{instanceNo}/subnets). Not usable when subnets are auto-assigned.",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
      instanceNo: z.number({ required_error: requiredError("instanceNo") }).describe("Node pool instance number"),
      subnetNoList: z.array(z.number(), { required_error: requiredError("subnetNoList") }).min(1).describe("New subnet number list (sent as subnets[])"),
    },
    async (params) => {
      // 스펙(두 존 공통, nks-updatenodepoolsubnet): `/subnets` + body { subnets: [number] } — 이전의 `/subnet` + subnetNoList 는 문서에 없다.
      return client.requestRaw("PATCH", `${base()}/clusters/${params.clusterUuid}/node-pool/${params.instanceNo}/subnets`, undefined, { subnets: params.subnetNoList });
    }
  );

  // ─── IAM Access Entry Tools ────────────────────────────────────────────────
  // 스펙(두 존 공통): /clusters/{uuid}/access-entries, 식별자 entryUuid(UUID), 생성 POST {type, entry, groups?, policies?},
  // 수정 PUT {groups?, policies?}(전체 교체). 클러스터 authType=API 에서만 동작한다.

  const accessPolicySchema = z.array(z.object({
    type: z.enum(["NKSClusterAdminPolicy", "NKSAdminPolicy", "NKSEditPolicy", "NKSViewPolicy"]).describe("NKS access policy type"),
    scope: z.enum(["cluster", "namespace"]).describe("Policy scope"),
    namespaces: z.array(z.string()).optional().describe("Target namespaces — required when scope is 'namespace'"),
  }));

  defineTool(
    server,
    "ncloud_nks_list_access_entries",
    "List IAM access entries of an NKS cluster (requires authType=API on the cluster)",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
    },
    async (params) => {
      return client.requestRaw("GET", `${base()}/clusters/${params.clusterUuid}/access-entries`);
    }
  );

  defineTool(
    server,
    "ncloud_nks_get_access_entry",
    "Get one IAM access entry of an NKS cluster by its UUID",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
      entryUuid: z.string({ required_error: requiredError("entryUuid") }).describe("IAM access entry UUID (from ncloud_nks_list_access_entries)"),
    },
    async (params) => {
      return client.requestRaw("GET", `${base()}/clusters/${params.clusterUuid}/access-entries/${params.entryUuid}`);
    }
  );

  defineTool(
    server,
    "ncloud_nks_create_access_entry",
    "Create an IAM access entry for an NKS cluster: maps an IAM USER or ROLE (NRN) to Kubernetes groups and/or NKS access policies. Requires authType=API.",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
      type: z.enum(["USER", "ROLE"], { required_error: requiredError("type") }).describe("IAM principal type"),
      entry: z.string({ required_error: requiredError("entry") }).describe("NRN of the IAM USER or ROLE"),
      groups: z.array(z.string()).optional().describe("Kubernetes group names to bind the principal to"),
      policies: accessPolicySchema.optional().describe("NKS access policies to attach (type + scope, namespaces when scope is 'namespace')"),
    },
    async (params) => {
      const { clusterUuid, ...body } = params;
      const bad = (body.policies ?? []).find((p) => p.scope === "namespace" && (!p.namespaces || p.namespaces.length === 0));
      if (bad) return { content: [{ type: "text" as const, text: `policies[].namespaces is required when scope is 'namespace' (policy ${bad.type}).` }], isError: true };
      const result = await client.requestRaw("POST", `${base()}/clusters/${clusterUuid}/access-entries`, undefined, body);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_nks_update_access_entry",
    "Update the Kubernetes groups and/or NKS access policies of an IAM access entry (PUT — the supplied lists replace the existing ones)",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
      entryUuid: z.string({ required_error: requiredError("entryUuid") }).describe("IAM access entry UUID"),
      groups: z.array(z.string()).optional().describe("Kubernetes group names (replaces the existing list)"),
      policies: accessPolicySchema.optional().describe("NKS access policies (replaces the existing list)"),
    },
    async (params) => {
      const { clusterUuid, entryUuid, ...body } = params;
      const result = await client.requestRaw("PUT", `${base()}/clusters/${clusterUuid}/access-entries/${entryUuid}`, undefined, body);
      return result;
    }
  );

  // ⚠️ Destructive: DELETE access entry, confirm=true required
  defineTool(
    server,
    "ncloud_nks_delete_access_entry",
    "⚠️ Destructive: Delete an IAM access entry from an NKS cluster. Set confirm=true to execute.",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
      entryUuid: z.string({ required_error: requiredError("entryUuid") }).describe("IAM access entry UUID to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to execute"),
    },
    async (params) => {
      const result = await client.requestRaw("DELETE", `${base()}/clusters/${params.clusterUuid}/access-entries/${params.entryUuid}`);
      return result ?? { success: true };
    },
    { destructive: { message: (params) => `⚠️ This will delete IAM Access Entry [${params.entryUuid}] from Cluster [${params.clusterUuid}].\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Reference/Query Tools (Versions, Images, Specs) ───────────────────────

  defineTool(
    server,
    "ncloud_nks_get_versions",
    "List available Kubernetes versions for NKS cluster creation",
    {
      hypervisorCode: z.string().optional().describe("Hypervisor code filter: XEN (default) or KVM"),
      isRegionalSupport: z.boolean().optional().describe("Filter only Regional (multi-zone) cluster supported versions"),
    },
    async (params) => {
      const queryParams: Record<string, string> = {};
      if (params.hypervisorCode) queryParams.hypervisorCode = params.hypervisorCode;
      if (params.isRegionalSupport !== undefined) queryParams.isRegionalSupport = String(params.isRegionalSupport);
      const result = await client.requestRaw("GET", `${base()}/option/version`, Object.keys(queryParams).length > 0 ? queryParams : undefined);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_nks_get_server_images",
    "List available server image types for NKS cluster/node pool creation",
    {
      hypervisorCode: z.string().optional().describe("Hypervisor type code filter: XEN (default) or KVM"),
    },
    async (params) => {
      const queryParams: Record<string, string> = {};
      if (params.hypervisorCode) queryParams.hypervisorCode = params.hypervisorCode;
      const result = await client.requestRaw("GET", `${base()}/option/server-image`, Object.keys(queryParams).length > 0 ? queryParams : undefined);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_nks_get_server_specs",
    "List available server specifications for NKS cluster/node pool creation. Requires softwareCode (from ncloud_nks_get_server_images) and zoneCode or zoneNo.",
    {
      softwareCode: z.string({ required_error: requiredError("softwareCode") }).describe("Server image code (value from ncloud_nks_get_server_images)"),
      zoneCode: z.string().optional().describe("Zone code (e.g., KR-1). Required if zoneNo not provided."),
      zoneNo: z.string().optional().describe("Zone number. Required if zoneCode not provided."),
    },
    async (params) => {
      const queryParams: Record<string, string> = { softwareCode: params.softwareCode };
      if (params.zoneCode) queryParams.zoneCode = params.zoneCode;
      if (params.zoneNo) queryParams.zoneNo = params.zoneNo;
      const result = await client.requestRaw("GET", `${base()}/option/server-product-code`, queryParams);
      return result;
    }
  );

  // ─── Add-on Manager Tools (2026-07 update) ─────────────────────────────────
  // Add-on Manager는 k8s 1.36+ 에서 사용 가능. LoadBalancer Controller / Global DNS
  // Webhook Provider 등은 별도 API가 아니라 여기서 설치하는 애드온으로 제공된다.

  defineTool(
    server,
    "ncloud_nks_list_available_addons",
    "List add-ons installable on an NKS cluster for a given Kubernetes version (Add-on Manager catalog; Add-on Manager is only available on Kubernetes 1.36+ clusters). Requires k8sVersion. The catalog includes components delivered as add-ons such as the NAVER Cloud Global DNS (ExternalDNS) webhook provider and, since 2026-09-17, Istio (service mesh); the available add-ons vary by Kubernetes version and region.",
    {
      k8sVersion: z.string({ required_error: requiredError("k8sVersion") }).describe("Kubernetes version in major.minor.patch (e.g., 1.36.0). Use the version from ncloud_nks_get_versions without the -nks.N suffix"),
      page: z.number().optional().describe("Page number for pagination"),
      size: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      const queryParams: Record<string, string> = { k8sVersion: params.k8sVersion };
      if (params.page !== undefined) queryParams.page = String(params.page);
      if (params.size !== undefined) queryParams.size = String(params.size);
      return client.requestRaw("GET", `${base()}/addon-configs`, queryParams);
    }
  );

  defineTool(
    server,
    "ncloud_nks_get_available_addon",
    "Get details of an installable add-on (Add-on Manager catalog; requires Kubernetes 1.36+), including its installable versions for the given Kubernetes version.",
    {
      addonName: z.string({ required_error: requiredError("addonName") }).describe("Add-on name (from ncloud_nks_list_available_addons)"),
      k8sVersion: z.string({ required_error: requiredError("k8sVersion") }).describe("Kubernetes version in major.minor.patch (e.g., 1.36.0)"),
    },
    async (params) => {
      return client.requestRaw("GET", `${base()}/addon-configs/${params.addonName}`, { k8sVersion: params.k8sVersion });
    }
  );

  defineTool(
    server,
    "ncloud_nks_get_available_addon_version",
    "Get details of a specific add-on version (Add-on Manager catalog; requires Kubernetes 1.36+), including its configuration schema for configurationValues.",
    {
      addonName: z.string({ required_error: requiredError("addonName") }).describe("Add-on name"),
      version: z.string({ required_error: requiredError("version") }).describe("Add-on version (from ncloud_nks_get_available_addon)"),
      k8sVersion: z.string({ required_error: requiredError("k8sVersion") }).describe("Kubernetes version in major.minor.patch (e.g., 1.36.0)"),
    },
    async (params) => {
      return client.requestRaw("GET", `${base()}/addon-configs/${params.addonName}/versions/${params.version}`, { k8sVersion: params.k8sVersion });
    }
  );

  defineTool(
    server,
    "ncloud_nks_list_cluster_addons",
    "List add-ons currently installed on an NKS cluster, with their versions and status.",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
      status: z.string().optional().describe("Filter by add-on status"),
      page: z.number().optional().describe("Page number for pagination"),
      size: z.number().optional().describe("Page size for pagination"),
    },
    async (params) => {
      const queryParams: Record<string, string> = {};
      if (params.status) queryParams.status = params.status;
      if (params.page !== undefined) queryParams.page = String(params.page);
      if (params.size !== undefined) queryParams.size = String(params.size);
      return client.requestRaw("GET", `${base()}/clusters/${params.clusterUuid}/addons`, Object.keys(queryParams).length > 0 ? queryParams : undefined);
    }
  );

  defineTool(
    server,
    "ncloud_nks_get_cluster_addon",
    "Get a single add-on installed on an NKS cluster, including status, configuration, and version.",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
      addonRef: z.string({ required_error: requiredError("addonRef") }).describe("Installed add-on reference: the add-on name OR the installed add-on's UUID"),
    },
    async (params) => {
      return client.requestRaw("GET", `${base()}/clusters/${params.clusterUuid}/addons/${params.addonRef}`);
    }
  );

  defineTool(
    server,
    "ncloud_nks_install_addons",
    "Install one or more add-ons on an NKS cluster (Add-on Manager, k8s 1.36+). Use dryRun=true to preview without installing.",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
      addons: z.array(z.object({
        addonName: z.string({ required_error: requiredError("addons[].addonName") }).describe("Add-on name (from ncloud_nks_list_available_addons)"),
        version: z.string({ required_error: requiredError("addons[].version") }).describe("Add-on version to install (e.g., 1.0.0)"),
        configurationValues: z.string().optional().describe("Helm values override as a JSON-object STRING (already stringified), e.g. '{\"policy\":\"sync\"}'. Defaults to {} when omitted"),
        resolveConflicts: z.enum(["Overwrite", "Preserve"]).optional().describe("Conflict resolution when the add-on touches existing resources: Overwrite (default) | Preserve"),
      }), { required_error: requiredError("addons") }).min(1).describe("One or more add-ons to install"),
      dryRun: z.boolean().optional().default(false).describe("If true, returns a preview without actually installing"),
    },
    async (params) => {
      if (params.dryRun) {
        // 요청 바디는 최상위 JSON 배열이며 clusterUuid는 경로 세그먼트다.
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: NKS Add-on Installation",
          endpoint: `${base()}/clusters/${params.clusterUuid}/addons`,
          method: "POST",
          requestParams: params.addons,
          noun: { ko: "애드온", en: "add-on" },
        });
      }
      // 요청 바디는 최상위 JSON 배열(객체 래핑 아님).
      const result = await client.requestRaw("POST", `${base()}/clusters/${params.clusterUuid}/addons`, undefined, params.addons);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_nks_update_addon",
    "Update an add-on installed on an NKS cluster — change its version and/or configurationValues. At least one of version/configurationValues/resolveConflicts must be provided.",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
      addonRef: z.string({ required_error: requiredError("addonRef") }).describe("Installed add-on reference: the add-on name OR the installed add-on's UUID"),
      version: z.string().optional().describe("Target version. Omit to keep the current version"),
      configurationValues: z.string().optional().describe("Helm values override as a JSON-object STRING. An empty string resets to {}"),
      resolveConflicts: z.enum(["Overwrite", "Preserve"]).optional().describe("Conflict resolution: Overwrite (default) | Preserve"),
    },
    async (params) => {
      const { clusterUuid, addonRef, ...rest } = params;
      const body: Record<string, unknown> = {};
      if (rest.version !== undefined) body.version = rest.version;
      if (rest.configurationValues !== undefined) body.configurationValues = rest.configurationValues;
      if (rest.resolveConflicts !== undefined) body.resolveConflicts = rest.resolveConflicts;
      if (Object.keys(body).length === 0) {
        return {
          content: [{ type: "text" as const, text: L({
            ko: "❌ version / configurationValues / resolveConflicts 중 최소 하나는 지정해야 합니다.",
            en: "❌ Provide at least one of version / configurationValues / resolveConflicts.",
          }) }],
          isError: true,
        };
      }
      return client.requestRaw("PATCH", `${base()}/clusters/${clusterUuid}/addons/${addonRef}`, undefined, body);
    }
  );

  // ⚠️ Destructive: DELETE add-on, confirm=true required
  defineTool(
    server,
    "ncloud_nks_delete_addon",
    "⚠️ Destructive: Uninstall an add-on from an NKS cluster. Set confirm=true to execute.",
    {
      clusterUuid: z.string({ required_error: requiredError("clusterUuid") }).describe("UUID of the cluster"),
      addonRef: z.string({ required_error: requiredError("addonRef") }).describe("Installed add-on reference: the add-on name OR the installed add-on's UUID"),
      confirm: z.boolean().optional().default(false).describe("Must be true to execute"),
    },
    async (params) => {
      const result = await client.requestRaw("DELETE", `${base()}/clusters/${params.clusterUuid}/addons/${params.addonRef}`);
      return result ?? { success: true };
    },
    { destructive: { message: (params) => `⚠️ This will uninstall Add-on [${params.addonRef}] from Cluster [${params.clusterUuid}].\n\nTo execute, call this tool again with confirm=true.` } }
  );
}
