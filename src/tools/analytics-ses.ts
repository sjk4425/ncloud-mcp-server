import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { dryRunPreview } from "./_dryrun.js";
import { L, maxLenMessage } from "./_messages.js";

/**
 * Search Engine Service (SES) API
 *
 * Base URL: https://vpcsearchengine.apigw.ntruss.com
 * - Korea: /api/v2/...
 * - Singapore: /api/sgn-v2/...
 * - Japan: /api/jpn-v2/...
 *
 * HTTP Methods vary per API (GET, POST, DELETE)
 * Response format: { code, message, result, requestId }
 */

function getApiPrefix(regionCode: string): string {
  switch (regionCode) {
    case "SGN": return "/api/sgn-v2";
    case "JPN": return "/api/jpn-v2";
    default: return "/api/v2";
  }
}

/**
 * `getClusterServerImageList`(G3 OS 이미지 조회)는 **공식 문서가 명시한 GET 경로대로
 * 호출해도 API Gateway가 300 Not Found를 반환한다**(2026-09-02 KR 라이브 실측).
 * 한국어·영어 문서 모두, SES·CDSS 양쪽 모두 같은 경로를 명시하는데 라우트가 없다.
 *
 * 이 도구는 G3 이미지 코드의 유일한 출처라서, 막히면 `get_server_specs` ·
 * `get_subnet_list_g3` · `create_cluster_g3`가 연쇄로 사용 불가가 된다. 원인을
 * 알 수 없는 채로 300만 던지면 사용자가 자기 입력을 의심하게 되므로, 실패에
 * 진단과 대안을 붙여 다시 던진다. (`get_server_generations`는 G3를 정상 반환하므로
 * 계정에 G3가 없어서가 아니다.)
 */
function g3ImageListGuidance(error: any): Error {
  const raw = String(error?.message ?? error);
  if (!/\b300\b|Not Found/i.test(raw)) return error;
  return new Error(
    raw +
      "\n\n" +
      L({
        ko: "진단: 이 엔드포인트는 공식 문서에 GET으로 명시돼 있으나 API Gateway에 라우트가 없어 300을 반환합니다(2026-09-02 KR 실측). " +
          "계정의 G3 미보유 문제가 아닙니다 — ncloud_ses_get_server_generations는 G3(KVM)를 정상 반환합니다.\n" +
          "대안: G3 OS 이미지 코드는 콘솔(Search Engine Service > 클러스터 생성)에서 확인해 " +
          "ncloud_ses_get_server_specs · ncloud_ses_get_subnet_list_g3 에 직접 넣으세요. G2 경로는 정상 동작합니다.",
        en: "Diagnosis: the official docs specify this endpoint as GET, but the API gateway has no such route and returns 300 (measured live, KR, 2026-09-02). " +
          "This is not a missing-G3-entitlement problem — ncloud_ses_get_server_generations does return G3 (KVM).\n" +
          "Workaround: read the G3 OS image code from the console (Search Engine Service > create cluster) and pass it directly to " +
          "ncloud_ses_get_server_specs / ncloud_ses_get_subnet_list_g3. The G2 path works normally.",
      })
  );
}

export function registerSearchEngineServiceTools(server: McpServer, client: NcloudClient): void {
  // ─── Cluster List ──────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_list_clusters",
    "List all Search Engine Service (Elasticsearch/OpenSearch) clusters in the current region",
    {
      inputText: z.string().optional().describe("Search keyword to filter cluster names"),
      vpcName: z.string().optional().describe("VPC name to filter (exact match)"),
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Page size (default: 10)"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const queryParams: Record<string, string | number | boolean | undefined> = {};
      if (params.inputText) queryParams["inputText"] = params.inputText;
      if (params.vpcName) queryParams["vpcName"] = params.vpcName;
      if (params.pageNo) queryParams["pageNo"] = params.pageNo;
      if (params.pageSize) queryParams["pageSize"] = params.pageSize;
      const result = await client.requestRaw("GET", `${prefix}/cluster/getClusterInfoList`, queryParams);
      return result;
    }
  );

  // ─── Cluster Detail ────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_cluster_detail",
    "Get detailed information about a specific Search Engine Service cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number (from getClusterInfoList)"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("GET", `${prefix}/cluster/getClusterInfo/${params.serviceGroupInstanceNo}`);
      return result;
    }
  );

  // ─── Cluster ACG List ──────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_cluster_acg",
    "Get ACG (Access Control Group) rules for a Search Engine Service cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      // op명은 getAcgInfoList 다. getClusterAcgInfo 는 존재하지 않는 경로였다
      // (CDSS에도 같은 이름을 복사해 둘 다 300이었다 — 2026-09-04 감사 §1-E).
      const result = await client.requestRaw("GET", `${prefix}/cluster/getAcgInfoList/${params.serviceGroupInstanceNo}`);
      return result;
    }
  );

  // ─── Cluster Node List ─────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_node_list",
    "Get node list for a Search Engine Service cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("GET", `${prefix}/cluster/getClusterNodeList/${params.serviceGroupInstanceNo}`);
      return result;
    }
  );

  // ─── Get Version List ──────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_versions",
    "Get available Search Engine (Elasticsearch/OpenSearch) versions",
    {},
    async () => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("GET", `${prefix}/cluster/getSearchEngineVersionList`);
      return result;
    }
  );

  // ─── Get Server Generation List ───────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_server_generations",
    "Get available node server generations for Search Engine Service",
    {},
    async () => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("GET", `${prefix}/cluster/getSearchEngineServerGenerationList`);
      return result;
    }
  );

  // ─── Get Server Type (G2) ─────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_node_products",
    "Get available node server types (product codes) for Search Engine Service (G2)",
    {
      softwareProductCode: z.string().describe("OS product code (from ncloud_ses_get_os_products)"),
      subnetNo: z.number().describe("Subnet number (from ncloud_ses_get_subnet_list)"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      // GET + 쿼리스트링이다. POST 본문으로 보내면 API Gateway가 라우트를 찾지 못해
      // 300 Not Found로 거절한다(B-4). subnetNo도 필수 파라미터다.
      const result = await client.requestRaw("GET", `${prefix}/cluster/getNodeProductList`, {
        softwareProductCode: params.softwareProductCode,
        subnetNo: params.subnetNo,
      });
      return result;
    }
  );

  // ─── Get Server Type (G3) ─────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_server_specs",
    "Get available node server types for Search Engine Service (G3/KVM only). " +
      "softwareProductCode must be a G3 image code — a G2 code from ncloud_ses_get_os_products is rejected.",
    {
      softwareProductCode: z.string().describe("G3 OS image code (from ncloud_ses_get_cluster_server_images)"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("POST", `${prefix}/cluster/getServerSpecList`, undefined, {
        softwareProductCode: params.softwareProductCode,
      });
      return result;
    }
  );

  // ─── Get OS Product List (G2) ─────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_os_products",
    "Get available OS types for Search Engine Service (G2)",
    {},
    async () => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("GET", `${prefix}/cluster/getOsProductList`);
      return result;
    }
  );

  // ─── Get OS Product List (G3) ─────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_cluster_server_images",
    "Get available OS types for Search Engine Service (G3/KVM only). " +
      "⚠️ Known issue: the documented endpoint currently returns 300 Not Found on the live API — " +
      "read the G3 image code from the console instead. The G2 tool ncloud_ses_get_os_products works.",
    {
      generationCode: z.enum(["G3"]).optional().describe("Server generation code. Only G3 (3rd generation) is valid"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      try {
        return await client.requestRaw("GET", `${prefix}/cluster/getClusterServerImageList`, {
          generationCode: params.generationCode,
        });
      } catch (error) {
        throw g3ImageListGuidance(error);
      }
    }
  );

  // ─── Get VPC List ─────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_vpc_list",
    "Get available VPC list for Search Engine Service cluster creation",
    {},
    async () => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("GET", `${prefix}/cluster/getVpcList`);
      return result;
    }
  );

  // ─── Get Subnet List ──────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_subnet_list",
    "Get available subnet list for Search Engine Service cluster creation (G2)",
    {
      softwareProductCode: z.string().describe("OS product code (from ncloud_ses_get_os_products)"),
      vpcNo: z.number().describe("VPC number (from ncloud_ses_get_vpc_list)"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      // softwareProductCode 없이 호출하면 400 "유효하지 않은 OS 타입입니다"로 거절된다(B-5).
      const result = await client.requestRaw("GET", `${prefix}/cluster/getSubnetList`, {
        softwareProductCode: params.softwareProductCode,
        vpcNo: params.vpcNo,
      });
      return result;
    }
  );

  // ─── Get Subnet List (G3) ─────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_subnet_list_g3",
    "Get available subnet list for Search Engine Service cluster creation (G3/KVM only)",
    {
      softwareProductCode: z.string().describe("G3 OS image code (from ncloud_ses_get_cluster_server_images)"),
      vpcNo: z.number().describe("VPC number (from ncloud_ses_get_vpc_list)"),
      isPrivate: z.boolean().optional().describe("true: private subnets only, false: public subnets only"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      // G2 경로(B-5)와 같은 결함 — OS 타입 코드 없이는 조회되지 않는다.
      const body: Record<string, unknown> = {
        softwareProductCode: params.softwareProductCode,
        vpcNo: params.vpcNo,
      };
      if (params.isPrivate !== undefined) body.isPrivate = params.isPrivate;
      const result = await client.requestRaw("POST", `${prefix}/cluster/getVpcAvailableSubnetList`, undefined, body);
      return result;
    }
  );

  // ─── Get Login Key List ───────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_login_keys",
    "Get authentication key list for SSH access to Search Engine Service manager nodes",
    {},
    async () => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("GET", `${prefix}/cluster/getLoginKeyList`);
      return result;
    }
  );

  // ─── Create Cluster (G2) ───────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_create_cluster",
    "Create a new Search Engine Service cluster (G2). Use dryRun=true to preview.",
    {
      clusterName: z.string().describe("Cluster name (3-15 chars, lowercase+numbers+'-')"),
      searchEngineVersionCode: z.string().describe("Search engine version code (from getSearchEngineVersionList)"),
      searchEngineDashboardPort: z.string().describe("Dashboard port (1025-65534, not 9090/9200/9300)"),
      searchEngineUserName: z.string().describe("Admin account ID (3-15 chars)"),
      searchEngineUserPassword: z.string().describe("Admin password (8-20 chars, letters+numbers+special)"),
      softwareProductCode: z.string().describe("OS type code (from getOsProductList)"),
      vpcNo: z.number().describe("VPC number"),
      managerNodeSubnetNo: z.number().describe("Manager node subnet number"),
      managerNodeProductCode: z.string().describe("Manager node server type code"),
      dataNodeSubnetNo: z.number().describe("Data node subnet number"),
      dataNodeCount: z.number().describe("Number of data nodes (3-10)"),
      dataNodeProductCode: z.string().describe("Data node server type code"),
      dataNodeStorageSize: z.number().describe("Data node storage size in GB (100-2000, 10GB increment)"),
      loginKeyName: z.string().describe("Authentication key name for SSH access"),
      isDualManager: z.boolean().optional().describe("Manager node redundancy (default: true)"),
      isMasterOnlyNodeActivated: z.boolean().optional().describe("Enable dedicated master nodes"),
      masterNodeSubnetNo: z.number().optional().describe("Master node subnet (required if master enabled)"),
      masterNodeCount: z.number().optional().describe("Number of master nodes (3 or 5)"),
      masterNodeProductCode: z.string().optional().describe("Master node server type code"),
      dryRun: z.boolean().optional().default(false).describe("If true, preview only without creating"),
    },
    async (params) => {
      const { dryRun, ...apiParams } = params;
      const prefix = getApiPrefix(client.getRegionCode());
      if (dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: SES Cluster Creation (G2)",
          endpoint: `${prefix}/cluster/createSearchEngineCluster`,
          method: "POST",
          requestParams: apiParams,
          noun: { ko: "SES 클러스터", en: "SES cluster" },
        });
      }
      const result = await client.requestRaw("POST", `${prefix}/cluster/createSearchEngineCluster`, undefined, apiParams);
      return result;
    }
  );

  // ─── Create Cluster (G3/KVM) ──────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_create_cluster_g3",
    "Create a new Search Engine Service cluster on 3rd-generation KVM servers (G3). " +
      "Use dryRun=true to preview.",
    {
      clusterName: z.string().max(15, {
        message: maxLenMessage("clusterName", 15),
      }).describe("Cluster name (3-15 chars: lowercase letters, numbers, '-'; starts with a letter, ends with a letter or number)"),
      searchEngineVersionCode: z.string().describe("Search engine version code (from ncloud_ses_get_versions)"),
      searchEngineDashboardPort: z.string().describe("Dashboard port (1025-65534; 9090, 9200 and 9300 are unavailable)"),
      searchEngineUserName: z.string().describe("Admin account ID (3-15 chars: lowercase letters, numbers, '-')"),
      searchEngineUserPassword: z.string().describe("Admin password (8-20 chars, letters+numbers+special; excludes ' \" ` ₩ / & and spaces)"),
      softwareProductCode: z.string().describe("G3 OS image code (see ncloud_ses_get_cluster_server_images; e.g. SW.VELST.OS.LNX64.ROCKY.08.G003)"),
      // hypervisorCode·generationCode 는 이 API의 필수값인데 스키마에 아예 없었다.
      hypervisorCode: z.string().describe("Hypervisor code. KVM for 3rd generation"),
      generationCode: z.string().describe("Server generation code. G3 for 3rd generation"),
      vpcNo: z.number().describe("VPC number (from ncloud_ses_get_vpc_list)"),
      managerNodeSubnetNo: z.number().describe("Manager node subnet number (from ncloud_ses_get_subnet_list_g3)"),
      // API 파라미터는 *ProductCode 다. 예전 스키마의 *ServerSpecCode 세 개는 그대로
      // 본문에 실려 나가 서버가 필수값 누락으로 거절했다(B-1과 같은 부류).
      managerNodeProductCode: z.string().describe("Manager node server type code (from ncloud_ses_get_server_specs)"),
      dataNodeSubnetNo: z.number().describe("Data node subnet number"),
      dataNodeCount: z.number().min(3).max(10).describe("Number of data nodes (3-10, default: 3)"),
      dataNodeProductCode: z.string().describe("Data node server type code"),
      dataNodeStorageSize: z.number().min(100).max(16000).describe("Data node storage in GB (100-16000, 10GB increments)"),
      dataNodeStorageInfraResourceDetailTypeCode: z.string().optional().describe("Data node storage type code. Documented valid value: CB1"),
      serverSpecCode: z.string().optional().describe("Server spec code. Optional here, unlike the CDSS G3 create where it is required"),
      loginKeyName: z.string().describe("Authentication key name (from ncloud_ses_get_login_keys)"),
      isDualManager: z.boolean().optional().describe("Manager node redundancy (default: true)"),
      isMasterOnlyNodeActivated: z.boolean().optional().describe("Enable dedicated master nodes. If true, the three masterNode* parameters below are required"),
      masterNodeSubnetNo: z.number().optional().describe("Master node subnet number. Required when isMasterOnlyNodeActivated=true"),
      masterNodeCount: z.number().optional().describe("Number of master nodes (3 or 5, default: 3). Required when isMasterOnlyNodeActivated=true"),
      masterNodeProductCode: z.string().optional().describe("Master node server type code. Required when isMasterOnlyNodeActivated=true"),
      dryRun: z.boolean().optional().default(false).describe("If true, preview only without creating"),
    },
    async (params) => {
      // 전용 마스터 노드를 켜면 세 값이 조건부 필수가 된다 — 호출 전에 걸러낸다.
      if (params.isMasterOnlyNodeActivated === true) {
        const missing = (["masterNodeSubnetNo", "masterNodeCount", "masterNodeProductCode"] as const)
          .filter((k) => params[k] === undefined);
        if (missing.length > 0) {
          return {
            content: [{
              type: "text" as const,
              text: L({
                ko: `isMasterOnlyNodeActivated=true 이면 다음 값이 필수입니다: ${missing.join(", ")}`,
                en: `These values are required when isMasterOnlyNodeActivated=true: ${missing.join(", ")}`,
              }),
            }],
            isError: true,
          };
        }
      }

      const { dryRun, ...apiParams } = params;
      const prefix = getApiPrefix(client.getRegionCode());
      if (dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: SES Cluster Creation (G3/KVM)",
          endpoint: `${prefix}/cluster/createKvmSearchEngineCluster`,
          method: "POST",
          requestParams: apiParams,
          noun: { ko: "SES 클러스터", en: "SES cluster" },
        });
      }
      const result = await client.requestRaw("POST", `${prefix}/cluster/createKvmSearchEngineCluster`, undefined, apiParams);
      return result;
    }
  );

  // ─── Restart Cluster ───────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_restart_cluster",
    "Restart a Search Engine Service cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      // op명은 restartSearchEngineCluster 이고 메서드는 GET 이다.
      // restartCluster + POST 조합은 라우트가 없어 300이었다.
      const result = await client.requestRaw("GET", `${prefix}/cluster/restartSearchEngineCluster/${params.serviceGroupInstanceNo}`);
      return result;
    }
  );

  // ─── Delete Cluster ────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_delete_cluster",
    "⚠️ Destructive: Permanently delete a Search Engine Service cluster. All data and indices will be lost. Set confirm=true to execute.",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number to delete"),
      confirm: z.boolean().optional().default(false).describe("Must be true to actually execute the destructive operation"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("DELETE", `${prefix}/cluster/deleteSearchEngineCluster/${params.serviceGroupInstanceNo}`);
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete Search Engine Service cluster [${params.serviceGroupInstanceNo}]. All data and indices will be lost.\n\nTo execute, call this tool again with confirm=true.` } }
  );

  // ─── Add Node ──────────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_add_node",
    "Change the data node count of a Search Engine Service cluster. " +
      "⚠️ newDataNodeCount is the TARGET total, not how many to add.",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number (path segment)"),
      // 예전 스키마의 addDataNodeCount는 API에 없는 이름이었고, 의미도 달랐다
      // (증분 vs 목표 총계). 인스턴스 번호도 본문이 아니라 경로에 들어간다.
      newDataNodeCount: z.number().describe("Target total number of data nodes after the change"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw(
        "POST",
        `${prefix}/cluster/changeCountOfDataNode/${params.serviceGroupInstanceNo}`,
        undefined,
        { newDataNodeCount: params.newDataNodeCount }
      );
      return result;
    }
  );

  // ─── Get Node Spec Detail ──────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_node_spec_detail",
    "Get server specifications for each node in a Search Engine Service cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("GET", `${prefix}/cluster/getNodeSpecDetail/${params.serviceGroupInstanceNo}`);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_ses_get_node_spec_for_change_g3",
    "Get the server specs a running Search Engine Service cluster's nodes can be changed to (G3/KVM only). " +
      "The G2 equivalent is ncloud_ses_get_node_spec_detail.",
    {
      // CDSS의 같은 이름 오퍼레이션과 형태가 다르다 — SES는 인스턴스 번호가 **경로**에 있고
      // 본문에 computeInstanceProductCode 가 필수다. CDSS는 본문에 serviceGroupInstanceNo 하나뿐이다.
      serviceGroupInstanceNo: z.string().describe("Cluster instance number (path segment; from ncloud_ses_list_clusters)"),
      computeInstanceProductCode: z.string().describe("Current node server type code (from ncloud_ses_get_node_spec_detail)"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      return client.requestRaw(
        "POST",
        `${prefix}/cluster/getServerSpecListForSpecChange/${params.serviceGroupInstanceNo}`,
        undefined,
        { computeInstanceProductCode: params.computeInstanceProductCode }
      );
    }
  );

  // ─── Change Node Spec ──────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_change_node_spec",
    "Change server specifications per node role in a Search Engine Service cluster. " +
      "Send only the roles you are changing — read the changeable specs with " +
      "ncloud_ses_get_node_product_for_change (G2) or ncloud_ses_get_node_spec_for_change_g3 (G3) first.",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number (path segment)"),
      // 예전 스키마의 computeInstanceNoList·productCode는 API에 없는 이름이었다.
      // 실제 계약은 역할별 *ProductCode 이고 인스턴스 번호는 경로에 있다.
      managerNodeProductCode: z.string().optional().describe("New manager node server type code"),
      dataNodeProductCode: z.string().optional().describe("New data node server type code"),
      masterNodeProductCode: z.string().optional().describe("New master node server type code"),
    },
    async (params) => {
      const { serviceGroupInstanceNo, ...rest } = params;
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined) body[k] = v;
      }
      if (Object.keys(body).length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: L({
              ko: "변경할 노드 역할을 하나 이상 지정해야 합니다(managerNodeProductCode / dataNodeProductCode / masterNodeProductCode).",
              en: "Specify at least one node role to change (managerNodeProductCode / dataNodeProductCode / masterNodeProductCode).",
            }),
          }],
          isError: true,
        };
      }
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw(
        "POST", `${prefix}/cluster/changeSpecNode/${serviceGroupInstanceNo}`, undefined, body
      );
      return result;
    }
  );

  // ─── Change Disk Capacity ──────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_change_disk_size",
    "Change data node disk capacity for a Search Engine Service cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number (path segment)"),
      // API 필드명은 diskSize 다. dataNodeStorageSize 로는 값이 전달되지 않았다.
      diskSize: z.number().describe("New storage size in GB (10GB increments)"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      // 인스턴스 번호는 경로 세그먼트다. 본문에만 담으면 300이었다(재판정 A-1).
      // SES는 계열별로 갈린다 — 노드 조작(changeCountOfDataNode·changeSpecNode·
      // resetSearchEngineUserPassword·changeClusterNodeDiskSize)은 세그먼트를 쓰고,
      // 업그레이드·setHotWarmNode 는 본문에 담는다. "전부 세그먼트"가 아니다.
      const result = await client.requestRaw(
        "POST", `${prefix}/cluster/changeClusterNodeDiskSize/${params.serviceGroupInstanceNo}`,
        undefined, { diskSize: params.diskSize }
      );
      return result;
    }
  );

  // ─── Reset Account Password ────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_reset_password",
    "Reset the Search Engine admin account password",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      searchEngineUserPassword: z.string().describe("New admin password (8-20 chars)"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      // 인스턴스 번호는 경로 세그먼트다 — 본문에만 넣으면 라우트를 찾지 못한다.
      const result = await client.requestRaw(
        "POST",
        `${prefix}/cluster/resetSearchEngineUserPassword/${params.serviceGroupInstanceNo}`,
        undefined,
        { searchEngineUserPassword: params.searchEngineUserPassword }
      );
      return result;
    }
  );

  // ─── Dashboard ─────────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_dashboard",
    "Get dashboard information for a Search Engine Service cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      pageNo: z.number().optional().describe("Page number"),
      pageSize: z.number().optional().describe("Page size"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      // 대시보드는 /cluster/ 가 아니라 /dashboard/ 섹션이고 op명은 getDashboardInformation 이다.
      const result = await client.requestRaw(
        "GET", `${prefix}/dashboard/getDashboardInformation/${params.serviceGroupInstanceNo}`,
        { pageNo: params.pageNo, pageSize: params.pageSize }
      );
      return result;
    }
  );

  // ─── Monitoring ────────────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_monitoring",
    "Get search-engine monitoring data for a Search Engine Service cluster or node",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number (path segment)"),
      // 예전 스키마의 startDateTime/endDateTime 은 API에 없는 이름이었고,
      // 필수값 metric 이 아예 빠져 있었다. 경로도 /cluster/ 가 아니라 /monitoring/ 섹션이다.
      // 시각은 **epoch millis(Long)** 다. ISO 8601을 넣으면 서버가
      // "Failed to convert ... to required type 'java.lang.Long'" 로 거부한다(재판정 B-1).
      timeStart: z.number().describe("Start time as epoch milliseconds (e.g. 1742747874000) — NOT an ISO 8601 string"),
      timeEnd: z.number().describe("End time as epoch milliseconds"),
      // metric 은 자유 문자열이 아니라 enum 이다 — 'cpu' 같은 값은 거부된다(재판정 B-2).
      metric: z.enum(["CLUSTER_ALL_METRICS", "SES_ALL_METRICS"]).describe("Metric set to retrieve"),
      computeInstanceNo: z.string().optional().describe("Node instance number. Required for node-level metrics"),
      interval: z.string().optional().describe("Aggregation interval (e.g. Min1, Min30, Hour2, Day1)"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw(
        "GET", `${prefix}/monitoring/getSearchEngineMonitoringData/${params.serviceGroupInstanceNo}`,
        {
          timeStart: params.timeStart,
          timeEnd: params.timeEnd,
          metric: params.metric,
          computeInstanceNo: params.computeInstanceNo,
          interval: params.interval,
        }
      );
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_ses_get_os_monitoring",
    "Get OS-level monitoring data for a Search Engine Service node",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number (path segment)"),
      computeInstanceNo: z.string().describe("Node instance number"),
      timeStart: z.number().describe("Start time as epoch milliseconds (e.g. 1742520660000) — NOT an ISO 8601 string"),
      timeEnd: z.number().describe("End time as epoch milliseconds"),
      metric: z.enum(["OS_ALL_METRICS"]).describe("Metric set to retrieve. OS_ALL_METRICS is the only valid value"),
      interval: z.string().optional().describe("Aggregation interval (e.g. Min1, Min30, Hour2, Day1). Default: Min1"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw(
        "GET", `${prefix}/monitoring/getOsMonitoringData/${params.serviceGroupInstanceNo}`,
        {
          timeStart: params.timeStart,
          timeEnd: params.timeEnd,
          metric: params.metric,
          computeInstanceNo: params.computeInstanceNo,
          interval: params.interval,
        }
      );
      return result;
    }
  );

  // ─── Snapshot ──────────────────────────────────────────────────────────────
  //
  // 이 섹션 전체가 `/cluster/` 접두사와 추정한 op명으로 되어 있어 6종 전부 300이었다.
  // 실제로는 **`/snapshot/` 섹션**이고 인스턴스 번호는 경로 세그먼트다.
  // 2026-09-04 경로 감사 §1-A.

  defineTool(
    server,
    "ncloud_ses_get_snapshot_buckets",
    "Get Object Storage bucket list available for storing cluster snapshots",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("GET", `${prefix}/snapshot/getBucketList/${params.serviceGroupInstanceNo}`);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_ses_set_snapshot_api_key",
    "Set the Object Storage API authentication key used for snapshots",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      accessKeyId: z.string().describe("Object Storage access key"),
      // API 필드명은 secretKey 다 — secretAccessKey 로는 전달되지 않았다.
      secretKey: z.string().describe("Object Storage secret key"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      // op명 대문자 주의: updateAPIAuthenticationKey (API 가 전부 대문자).
      const result = await client.requestRaw(
        "POST", `${prefix}/snapshot/updateAPIAuthenticationKey/${params.serviceGroupInstanceNo}`,
        undefined,
        { accessKeyId: params.accessKeyId, secretKey: params.secretKey }
      );
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_ses_create_snapshot",
    "Create a snapshot of a Search Engine Service cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      snapshotName: z.string().describe("Name for the snapshot"),
      bucketName: z.string().describe("Object Storage bucket to store the snapshot in (from ncloud_ses_get_snapshot_buckets)"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw(
        "POST", `${prefix}/snapshot/createSnapshot/${params.serviceGroupInstanceNo}`,
        undefined,
        { snapshotName: params.snapshotName, bucketName: params.bucketName }
      );
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_ses_get_snapshot_history",
    "Get snapshot creation history for a Search Engine Service cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      pageNo: z.number().optional().describe("Page number"),
      pageSize: z.number().optional().describe("Page size"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw(
        "GET", `${prefix}/snapshot/getSnapshotHistory/${params.serviceGroupInstanceNo}`,
        { pageNo: params.pageNo, pageSize: params.pageSize }
      );
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_ses_get_snapshot_schedule_history",
    "Get the snapshot scheduling history for a Search Engine Service cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      pageNo: z.number().optional().describe("Page number"),
      pageSize: z.number().optional().describe("Page size"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      return client.requestRaw(
        "GET", `${prefix}/snapshot/getSnapshotSchedulingHistory/${params.serviceGroupInstanceNo}`,
        { pageNo: params.pageNo, pageSize: params.pageSize }
      );
    }
  );

  defineTool(
    server,
    "ncloud_ses_set_snapshot_schedule",
    "Set a daily snapshot schedule for a Search Engine Service cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      snapshotName: z.string().describe("Name prefix for scheduled snapshots"),
      bucketName: z.string().describe("Object Storage bucket to store snapshots in"),
      // 예전 스키마의 scheduleExpression(cron)은 API에 없는 파라미터였다.
      // 실제 계약은 요일·시·분을 따로 받는다.
      scheduledDay: z.string().describe("Scheduled day"),
      scheduledHour: z.string().describe("Scheduled hour"),
      scheduledMinute: z.string().describe("Scheduled minute"),
    },
    async (params) => {
      const { serviceGroupInstanceNo, ...body } = params;
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw(
        "POST", `${prefix}/snapshot/setSnapshotScheduling/${serviceGroupInstanceNo}`, undefined, body
      );
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_ses_unset_snapshot_schedule",
    "Release the snapshot schedule for a Search Engine Service cluster. This only removes the schedule, not existing snapshots.",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      // op명은 releaseSnapshotScheduling 이고 메서드는 GET 이다(POST 아님).
      const result = await client.requestRaw("GET", `${prefix}/snapshot/releaseSnapshotScheduling/${params.serviceGroupInstanceNo}`);
      return result;
    }
  );

  // ─── Import ────────────────────────────────────────────────────────────────
  //
  // 스냅샷 섹션과 같은 결함 — `/cluster/` 접두사와 추정한 op명으로 4종 전부 300이었다.
  // 실제로는 **`/import/`** 섹션이고 인스턴스 번호는 경로 세그먼트다.

  defineTool(
    server,
    "ncloud_ses_get_import_buckets",
    "Get Object Storage bucket list available for data import",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("GET", `${prefix}/import/getBucketList/${params.serviceGroupInstanceNo}`);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_ses_run_import",
    "Start a data import job from Object Storage into a Search Engine Service cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      bucketName: z.string().describe("Object Storage bucket name (from ncloud_ses_get_import_buckets)"),
      // 예전 스키마의 filePath·indexName 은 API에 없는 이름이었고,
      // 필수 dataSource 가 빠져 있었다.
      objectKey: z.string().describe("Object key (path) of the file in the bucket"),
      index: z.string().describe("Target index name"),
      dataSource: z.string().describe("Data source type"),
      isBulkFormat: z.boolean().optional().describe("Whether the file is in Elasticsearch bulk format"),
    },
    async (params) => {
      const { serviceGroupInstanceNo, ...rest } = params;
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined) body[k] = v;
      }
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw(
        "POST", `${prefix}/import/createDataImportJob/${serviceGroupInstanceNo}`, undefined, body
      );
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_ses_get_import_history",
    "Get data import history for a Search Engine Service cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      pageNo: z.number().optional().describe("Page number"),
      pageSize: z.number().optional().describe("Page size"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw(
        "GET", `${prefix}/import/getDataImportHistory/${params.serviceGroupInstanceNo}`,
        { pageNo: params.pageNo, pageSize: params.pageSize }
      );
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_ses_stop_import",
    "Stop the running data import job on a Search Engine Service cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      // 예전 스키마의 importTaskId 는 API에 없는 파라미터다 — 이 op는 클러스터 단위로
      // 진행 중인 작업을 멈추며, 메서드도 POST가 아니라 GET 이다.
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("GET", `${prefix}/import/stopDataImportJob/${params.serviceGroupInstanceNo}`);
      return result;
    }
  );

  // ─── Version Upgrade ───────────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_upgrade_version",
    "Upgrade the Search Engine version of a cluster. Run ncloud_ses_precheck_upgrade first.",
    {
      // 경로는 맞았지만 파라미터명이 틀려 서버가 "Target version code is not allowed to
      // be empty" 로 답했다(2026-09-04 감사 §2). 실제 필드는 targetVersionCode 이고
      // regionNo 도 필수인데 스키마에 없었다.
      regionNo: z.number().describe("Region number (from ncloud_get_regions — this is regionNo, not the region code)"),
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      targetVersionCode: z.string().describe("Target version code (from ncloud_ses_get_versions)"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("POST", `${prefix}/cluster/rollingUpgradeCluster`, undefined, params);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_ses_precheck_upgrade",
    "Pre-check whether a Search Engine version upgrade can proceed",
    {
      regionNo: z.number().describe("Region number (from ncloud_get_regions)"),
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      targetVersionCode: z.string().describe("Target version code (from ncloud_ses_get_versions)"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("POST", `${prefix}/cluster/rollingUpgradePreCheck`, undefined, params);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_ses_get_upgrade_progress",
    "Get version upgrade progress for a Search Engine Service cluster",
    {
      regionNo: z.number().describe("Region number (from ncloud_get_regions)"),
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      // POST + 본문이다. GET + 경로 세그먼트 조합은 라우트가 없어 300이었다.
      const result = await client.requestRaw("POST", `${prefix}/cluster/getRollingUpgradeProgress`, undefined, {
        regionNo: params.regionNo,
        serviceGroupInstanceNo: params.serviceGroupInstanceNo,
      });
      return result;
    }
  );

  // ─── Change Node Type (Hot/Warm) ──────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_change_node_type",
    "Set each data node's storage role (HOT/WARM) in a Search Engine Service cluster. " +
      "Roles are assigned per node, not by count. Manager and master node types cannot be changed. " +
      "List the nodes with ncloud_ses_get_node_list first.",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      // 예전 스키마의 hotDataNodeCount/warmDataNodeCount 는 API에 없는 파라미터였다.
      // 실제 계약은 노드별 역할 지정이다.
      nodeSpecList: z.array(z.object({
        computeInstanceNo: z.string().describe("Node instance number (from ncloud_ses_get_node_list)"),
        nodeStorageRole: z.enum(["HOT", "WARM"]).describe("Storage role for this node"),
      })).min(1, {
        message: L({
          ko: "nodeSpecList는 최소 1개 이상이어야 합니다.",
          en: "nodeSpecList must contain at least one entry.",
        }),
      }).describe("Per-node storage role assignments"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      const result = await client.requestRaw("POST", `${prefix}/cluster/setHotWarmNode`, undefined, {
        serviceGroupInstanceNo: params.serviceGroupInstanceNo,
        nodeSpecList: params.nodeSpecList,
      });
      return result;
    }
  );

  // ─── Changeable Node Spec (G2) ────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_ses_get_node_product_for_change",
    "Get the server types a running Search Engine Service cluster's nodes can be changed to (G2). " +
      "The G3/KVM equivalent is ncloud_ses_get_node_spec_for_change_g3.",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number (path segment)"),
      softwareProductCode: z.string().describe("OS product code (from ncloud_ses_get_os_products)"),
    },
    async (params) => {
      const prefix = getApiPrefix(client.getRegionCode());
      return client.requestRaw(
        "POST", `${prefix}/cluster/getNodeProductListForSpecChange/${params.serviceGroupInstanceNo}`,
        undefined,
        { softwareProductCode: params.softwareProductCode }
      );
    }
  );
}
