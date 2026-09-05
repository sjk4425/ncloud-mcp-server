import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";
import { dryRunPreview } from "./_dryrun.js";
import { L, maxLenMessage } from "./_messages.js";

/**
 * Cloud Data Streaming Service (CDSS) — Apache Kafka 관리형 서비스
 *
 * Base URL: https://clouddatastreamingservice.apigw.ntruss.com
 * 리전별 경로: /api/v1/ (KR), /api/sgn-v1/ (SGN), /api/jpn-v1/ (JPN)
 */

function getApiPrefix(regionCode: string): string {
  switch (regionCode) {
    case "SGN": return "/api/sgn-v1";
    case "JPN": return "/api/jpn-v1";
    default: return "/api/v1";
  }
}

/**
 * SES와 동일한 문제 — `getClusterServerImageList`(G3 OS 이미지 조회)는 공식 문서가
 * 명시한 GET 경로대로 호출해도 API Gateway가 300을 반환한다(2026-09-02 KR 라이브 실측).
 * 이 도구가 막히면 `get_server_spec_list`(G3)가 연쇄로 사용 불가가 된다.
 * `get_server_generations`는 G3(KVM)를 정상 반환하므로 계정 문제가 아니다.
 */
function g3ImageListGuidance(error: any): Error {
  const raw = String(error?.message ?? error);
  if (!/\b300\b|Not Found/i.test(raw)) return error;
  return new Error(
    raw +
      "\n\n" +
      L({
        ko: "진단: 이 엔드포인트는 공식 문서에 GET으로 명시돼 있으나 API Gateway에 라우트가 없어 300을 반환합니다(2026-09-02 KR 실측). " +
          "계정의 G3 미보유 문제가 아닙니다 — ncloud_cdss_get_server_generations는 G3(KVM)를 정상 반환합니다.\n" +
          "대안: G3 OS 이미지 코드는 콘솔(Cloud Data Streaming Service > 클러스터 생성)에서 확인해 " +
          "ncloud_cdss_get_server_spec_list 에 직접 넣으세요. G2 경로는 정상 동작합니다.",
        en: "Diagnosis: the official docs specify this endpoint as GET, but the API gateway has no such route and returns 300 (measured live, KR, 2026-09-02). " +
          "This is not a missing-G3-entitlement problem — ncloud_cdss_get_server_generations does return G3 (KVM).\n" +
          "Workaround: read the G3 OS image code from the console (Cloud Data Streaming Service > create cluster) and pass it directly to " +
          "ncloud_cdss_get_server_spec_list. The G2 path works normally.",
      })
  );
}

export function registerCloudDataStreamingTools(server: McpServer, client: NcloudClient): void {
  const regionCode = client.getRegionCode();
  const prefix = getApiPrefix(regionCode);

  // ─── Cluster Query Tools ─────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_cdss_list_clusters",
    "List Cloud Data Streaming Service (Kafka) clusters with optional filtering",
    {
      inputText: z.string().optional().describe("Search keyword (partial match on cluster name)"),
      vpcName: z.string().optional().describe("VPC name filter (exact match)"),
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Page size (default: 10)"),
    },
    async (params) => {
      const body: Record<string, unknown> = {};
      if (params.inputText) body.inputText = params.inputText;
      if (params.vpcName) body.vpcName = params.vpcName;
      if (params.pageNo) body.pageNo = params.pageNo;
      if (params.pageSize) body.pageSize = params.pageSize;
      const result = await client.postRequest(
        `${prefix}/cluster/getClusterInfoList`, body
      );
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_cdss_get_cluster_detail",
    "Get detailed information about a specific CDSS (Kafka) cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number from cluster list"),
    },
    async (params) => {
      return client.postRequest(
          `${prefix}/cluster/getClusterInfoList/${params.serviceGroupInstanceNo}`, {}
        );
    }
  );

  defineTool(
    server,
    "ncloud_cdss_get_cluster_status",
    "Get health status of a CDSS cluster (broker, zookeeper, CMAK status per node)",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      return client.requestRaw(
          "GET", `${prefix}/cluster/getClusterStatus/${params.serviceGroupInstanceNo}`
        );
    }
  );

  defineTool(
    server,
    "ncloud_cdss_get_cluster_acg",
    "Get ACG (Access Control Group) rules for a CDSS cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      return client.requestRaw(
          // op명은 getAcgInfoList 다 — SES에도 같은 이름을 복사해 둘 다 300이었다(감사 §1-E).
          "GET", `${prefix}/cluster/getAcgInfoList/${params.serviceGroupInstanceNo}`
        );
    }
  );

  defineTool(
    server,
    "ncloud_cdss_get_certificate",
    "Get TLS certificate used for cluster communication encryption",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      return client.requestRaw(
          "GET", `${prefix}/cluster/downloadCertificate/${params.serviceGroupInstanceNo}`
        );
    }
  );

  // ─── Version & Product Query Tools ───────────────────────────────────

  defineTool(
    server,
    "ncloud_cdss_get_kafka_versions",
    "Get available Kafka version list (kafkaVersionCode) for CDSS cluster creation",
    {},
    async () => {
      // 실제 오퍼레이션 이름은 getCDSSVersionList다. getKafkaVersionList 경로는
      // 존재하지 않아 API Gateway가 300 Not Found로 거절했다(B-6).
      return client.requestRaw(
          "GET", `${prefix}/cluster/getCDSSVersionList`
        );
    }
  );

  defineTool(
    server,
    "ncloud_cdss_get_node_products",
    "Get available node server types (product codes) for CDSS cluster creation (G2)",
    {
      softwareProductCode: z.string().describe("OS type code (from ncloud_cdss_get_os_products)"),
      subnetNo: z.number().describe("Subnet number (from ncloud_cdss_get_subnet_list)"),
    },
    async (params) => {
      // POST + JSON 본문이며 두 파라미터 모두 필수다. GET·무파라미터로 호출하면 300이다(B-6).
      return client.postRequest(
          `${prefix}/cluster/getNodeProductList`,
          { softwareProductCode: params.softwareProductCode, subnetNo: params.subnetNo }
        );
    }
  );

  defineTool(
    server,
    "ncloud_cdss_get_os_products",
    "Get available operating system types for CDSS cluster creation",
    {},
    async () => {
      return client.requestRaw(
          "GET", `${prefix}/cluster/getOsProductList`
        );
    }
  );

  defineTool(
    server,
    "ncloud_cdss_get_vpc_list",
    "Get available VPC list for CDSS cluster creation",
    {},
    async () => {
      return client.requestRaw(
          "GET", `${prefix}/cluster/getVpcList`
        );
    }
  );

  defineTool(
    server,
    "ncloud_cdss_get_subnet_list",
    "Get available subnet list for CDSS cluster creation (G2)",
    {
      softwareProductCode: z.string().describe("OS type code (from ncloud_cdss_get_os_products)"),
      vpcNo: z.number().describe("VPC number (from ncloud_cdss_get_vpc_list)"),
    },
    async (params) => {
      // POST + JSON 본문이며 두 파라미터 모두 필수다(B-6).
      const result = await client.postRequest(
        `${prefix}/cluster/getSubnetList`,
        { softwareProductCode: params.softwareProductCode, vpcNo: params.vpcNo }
      );
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_cdss_get_subnet_list_g3",
    "Get available subnet list for CDSS cluster creation (G3/KVM only)",
    {
      // 문서 인덱스의 슬러그는 getavailablesubnetlist 지만 실제 오퍼레이션은
      // getVpcAvailableSubnetList 다(SES와 같은 이름). getCDSSVersionList 와 같은 패턴 —
      // 인덱스 슬러그를 op명으로 믿으면 존재하지 않는 경로를 만든다.
      vpcNo: z.number().describe("VPC number (from ncloud_cdss_get_vpc_list)"),
      softwareProductCode: z.string().describe("G3 OS image code (see ncloud_cdss_get_cluster_server_images; e.g. SW.VCDSS.OS.LNX64.ROCKY.08.G003)"),
      isPrivate: z.boolean().optional().describe("true: private subnets only, false: public subnets only"),
    },
    async (params) => {
      const body: Record<string, unknown> = {
        vpcNo: params.vpcNo,
        softwareProductCode: params.softwareProductCode,
      };
      if (params.isPrivate !== undefined) body.isPrivate = params.isPrivate;
      return client.postRequest(`${prefix}/cluster/getVpcAvailableSubnetList`, body);
    }
  );

  defineTool(
    server,
    "ncloud_cdss_get_node_spec_for_change_g3",
    "Get the server specs a running CDSS cluster's nodes can be changed to (G3/KVM only). " +
      "The G2 equivalent is ncloud_cdss_get_node_spec.",
    {
      serviceGroupInstanceNo: z.number().describe("Cluster instance number (from ncloud_cdss_list_clusters)"),
    },
    async (params) => {
      return client.postRequest(
        `${prefix}/cluster/getServerSpecListForSpecChange`,
        { serviceGroupInstanceNo: params.serviceGroupInstanceNo }
      );
    }
  );

  // ─── Cluster Create Tool ─────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_cdss_create_cluster",
    "Create a new CDSS (Kafka) cluster (G2). Set returnClusterId=true to get the new cluster's " +
      "serviceGroupInstanceNo back — the default operation returns only success/failure, so you would " +
      "otherwise have to find the cluster with ncloud_cdss_list_clusters. Use dryRun=true to preview.",
    {
      clusterName: z.string().describe("Cluster name (3-15 chars, lowercase+numbers+'-')"),
      kafkaVersionCode: z.number().describe("Kafka version code (from get_kafka_versions)"),
      configGroupNo: z.number().describe("Config group number"),
      kafkaManagerUserName: z.string().describe("CMAK access account ID"),
      kafkaManagerUserPassword: z.string().describe("CMAK access account password"),
      softwareProductCode: z.string().describe("OS type code (from get_os_products)"),
      vpcNo: z.number().describe("VPC number"),
      managerNodeSubnetNo: z.number().describe("Manager node subnet number"),
      managerNodeProductCode: z.string().describe("Manager node server type code"),
      brokerNodeSubnetNo: z.number().describe("Broker node subnet number"),
      brokerNodeCount: z.number().describe("Number of broker nodes (3-10)"),
      brokerNodeProductCode: z.string().describe("Broker node server type code"),
      brokerNodeStorageSize: z.number().describe("Broker storage in GB (100-2000, 10GB increment)"),
      // 같은 파라미터를 받는 별도 op가 있다 — 응답에 serviceGroupInstanceNo 를 담아 준다.
      // 스키마 15개를 복제하지 않고 플래그로 고른다.
      returnClusterId: z.boolean().optional().default(false).describe("If true, calls the variant that returns the new cluster's serviceGroupInstanceNo"),
      dryRun: z.boolean().optional().default(false).describe("Preview without creating"),
    },
    async (params) => {
      const { dryRun, returnClusterId, ...apiParams } = params;
      const op = returnClusterId
        ? "createCDSSClusterReturnServiceGroupInstanceNo"
        : "createCDSSCluster";
      if (dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: CDSS Cluster Creation (G2)",
          endpoint: `${prefix}/cluster/${op}`,
          method: "POST",
          requestParams: apiParams,
          noun: { ko: "CDSS 클러스터", en: "CDSS cluster" },
        });
      }
      const result = await client.postRequest(`${prefix}/cluster/${op}`, apiParams);
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_cdss_create_cluster_g3",
    "Create a new CDSS (Kafka) cluster on 3rd-generation KVM servers (G3). " +
      "⚠️ Broker node parameters are named dataNode* here, not brokerNode* as in the G2 tool. " +
      "VPC and subnets must be given by BOTH name and number. Use dryRun=true to preview.",
    {
      clusterName: z.string().max(15, {
        message: maxLenMessage("clusterName", 15),
      }).describe("Cluster name (3-15 chars: lowercase letters, numbers, '-')"),
      kafkaVersionCode: z.number().describe("Kafka version code (from ncloud_cdss_get_kafka_versions)"),
      configGroupNo: z.number().describe("Config group number (from ncloud_cdss_list_config_groups)"),
      kafkaManagerUserName: z.string().describe("CMAK access account ID"),
      kafkaManagerUserPassword: z.string().describe("CMAK access account password"),
      hypervisorCode: z.string().describe("Hypervisor code. KVM for 3rd generation"),
      generationCode: z.string().describe("Server generation code. G3 for 3rd generation"),
      softwareProductCode: z.string().describe("G3 OS image code (e.g. SW.VCDSS.OS.LNX64.ROCKY.08.G003)"),
      vpcName: z.string().describe("VPC name — required in addition to vpcNo"),
      vpcNo: z.number().describe("VPC number (from ncloud_cdss_get_vpc_list)"),
      managerNodeSubnetName: z.string().describe("Manager node subnet name — required in addition to the number"),
      managerNodeSubnetNo: z.number().describe("Manager node subnet number (from ncloud_cdss_get_subnet_list_g3)"),
      managerNodeProductCode: z.string().describe("Manager node server type code"),
      // 브로커 노드인데 파라미터명이 dataNode* 다 — G2의 createCDSSCluster는 brokerNode* 를 쓴다.
      dataNodeSubnetName: z.string().describe("Broker node subnet name — required in addition to the number"),
      dataNodeSubnetNo: z.number().describe("Broker node subnet number"),
      dataNodeCount: z.number().min(3).max(10).describe("Broker node count (3-10, default: 3)"),
      dataNodeProductCode: z.string().describe("Broker node server type code"),
      dataNodeStorageSize: z.number().min(100).max(2000).describe("Broker node storage in GB (100-2000, 10GB increments)"),
      serverSpecCode: z.string().describe("Server spec code (from ncloud_cdss_get_server_spec_list, e.g. cdss.s2-g3)"),
      // 문서 표는 유효값을 NET 이라 적지만 같은 페이지의 curl 예제는 SSD 를 보낸다.
      // 어느 쪽이 맞는지 확정할 수 없어 enum으로 좁히지 않고 그대로 전달한다.
      dataNodeStorageType2Code: z.string().optional().describe("Broker storage type. The spec table says NET; the spec page's own sample sends SSD — unresolved, so it is passed through as given"),
      dataNodeStorageInfraResourceDetailTypeCode: z.string().optional().describe("Broker storage detail type. Documented valid value: CB1"),
      dryRun: z.boolean().optional().default(false).describe("Preview without creating"),
    },
    async (params) => {
      const { dryRun, ...apiParams } = params;
      if (dryRun) {
        return dryRunPreview({
          label: "🔍 Dry-Run Preview: CDSS Cluster Creation (G3/KVM)",
          endpoint: `${prefix}/cluster/createKvmCluster`,
          method: "POST",
          requestParams: apiParams,
          noun: { ko: "CDSS 클러스터", en: "CDSS cluster" },
        });
      }
      return client.postRequest(`${prefix}/cluster/createKvmCluster`, apiParams);
    }
  );

  // ─── Cluster Destructive Tool ────────────────────────────────────────

  defineTool(
    server,
    "ncloud_cdss_delete_cluster",
    "⚠️ Destructive: Permanently delete a CDSS (Kafka) cluster. All data will be lost. Set confirm=true to execute.",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number to delete (required)"),
      confirm: z.boolean().optional().default(false).describe("Must be true to execute deletion"),
    },
    async (params) => {
      if (!params.serviceGroupInstanceNo) {
        return { content: [{ type: "text" as const, text: "Error: serviceGroupInstanceNo is required." }], isError: true };
      }
      const result = await client.deleteRequest(
        `${prefix}/cluster/deleteCDSSCluster/${params.serviceGroupInstanceNo}`
      );
      return result;
    },
    { destructive: { message: (params) => `⚠️ This will permanently delete CDSS cluster [${params.serviceGroupInstanceNo}]. All data will be lost.\n\nTo execute, call again with confirm=true.` } }
  );

  // ─── Node Management Tools ───────────────────────────────────────────

  defineTool(
    server,
    "ncloud_cdss_list_nodes",
    "List all nodes (broker, manager) in a CDSS cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      return client.requestRaw(
          "GET", `${prefix}/cluster/getClusterNodeList/${params.serviceGroupInstanceNo}`
        );
    }
  );

  defineTool(
    server,
    "ncloud_cdss_add_nodes",
    "Add broker nodes to a CDSS cluster. " +
      "⚠️ newBrokerNodeCount is HOW MANY TO ADD, not the resulting total — a cluster with 3 brokers " +
      "given newBrokerNodeCount=4 ends up with 7. The SES counterpart (ncloud_ses_add_node) behaves the " +
      "same way. " +
      "⚠️ Broker count cannot be reduced afterwards: CDSS has no scale-down operation, so the only way " +
      "back from adding too many is deleting the cluster.",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      // 실제로 오입력 사고가 났다(2026-09-05: 브로커 3대에 4를 넣어 7대가 됨).
      // 축소 op가 없어 되돌리려면 클러스터를 지워야 한다.
      // 한때 "SES는 목표 총계라 의미가 반대"라고 적었으나 그것이 거짓이었다 — SES도 증분이다.
      newBrokerNodeCount: z.number().min(1).max(10).describe("How many broker nodes to ADD (1-10). This is a delta, not the resulting total"),
    },
    async (params) => {
      return client.postRequest(
          `${prefix}/cluster/changeCountOfBrokerNode/${params.serviceGroupInstanceNo}`,
          { newBrokerNodeCount: params.newBrokerNodeCount }
        );
    }
  );

  defineTool(
    server,
    "ncloud_cdss_get_broker_info",
    "Get broker node communication info (endpoints, ports) for a CDSS cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      return client.requestRaw(
          "GET", `${prefix}/cluster/getBrokerInfo/${params.serviceGroupInstanceNo}`
        );
    }
  );

  defineTool(
    server,
    "ncloud_cdss_get_node_spec",
    "Get current server spec details for nodes in a CDSS cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      return client.requestRaw(
          "GET", `${prefix}/cluster/getNodeSpecDetail/${params.serviceGroupInstanceNo}`
        );
    }
  );

  defineTool(
    server,
    "ncloud_cdss_get_node_product_for_change",
    "Get the server types a running CDSS cluster's nodes can be changed to (G2 clusters only). " +
      "⚠️ On a G3/KVM cluster this returns empty lists rather than an error — use " +
      "ncloud_cdss_get_node_spec_for_change_g3 there. Note that ncloud_cdss_get_node_spec returns a node's " +
      "CURRENT spec, which is a different operation from the specs it may be changed to.",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number (path segment)"),
      softwareProductCode: z.string().describe("OS type code (from ncloud_cdss_get_os_products)"),
    },
    async (params) => {
      return client.postRequest(
        `${prefix}/cluster/getNodeProductListForSpecChange/${params.serviceGroupInstanceNo}`,
        { softwareProductCode: params.softwareProductCode }
      );
    }
  );

  defineTool(
    server,
    "ncloud_cdss_change_node_spec",
    "Change server spec for nodes in a CDSS cluster. " +
      "⚠️ Downgrades are refused by the service — check `isChangeSpec` in " +
      "ncloud_cdss_get_node_spec_for_change_g3 (G3) or ncloud_cdss_get_node_product_for_change (G2) first; " +
      "a spec smaller than the current one comes back with isChangeSpec=false.",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      brokerNodeProductCode: z.string().optional().describe("New broker node product code"),
      managerNodeProductCode: z.string().optional().describe("New manager node product code"),
    },
    async (params) => {
      const body: Record<string, unknown> = {};
      if (params.brokerNodeProductCode) body.brokerNodeProductCode = params.brokerNodeProductCode;
      if (params.managerNodeProductCode) body.managerNodeProductCode = params.managerNodeProductCode;
      const result = await client.postRequest(
        `${prefix}/cluster/changeSpecNode/${params.serviceGroupInstanceNo}`, body
      );
      return result;
    }
  );

  // ─── Cluster Service Restart Tools ───────────────────────────────────

  defineTool(
    server,
    "ncloud_cdss_restart_all_services",
    "Restart all services (Kafka + ZooKeeper + CMAK) in a CDSS cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      // 재시작 계열은 전부 GET 이다 — POST로 보내 라우트를 찾지 못했다(2026-09-04 감사 §1-C).
      return client.requestRaw(
          "GET", `${prefix}/cluster/restartAllServices/${params.serviceGroupInstanceNo}`
        );
    }
  );

  defineTool(
    server,
    "ncloud_cdss_restart_kafka",
    "Restart Kafka and ZooKeeper services in a CDSS cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      return client.requestRaw(
          "GET", `${prefix}/cluster/restartKafkaService/${params.serviceGroupInstanceNo}`
        );
    }
  );

  defineTool(
    server,
    "ncloud_cdss_restart_cmak",
    "⚠️ Deprecated by Ncloud: this operation is no longer supported and the API may reject it. " +
      "Use ncloud_cdss_restart_all_services instead. Restarts CMAK (Cluster Manager for Apache Kafka).",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      // op명은 restartCMAKService 다(CMAK 전부 대문자). 그리고 공식 문서가
      // "지원이 종료되어 더 이상 사용할 수 없습니다"로 표시한 op다 — 경로를 바로잡되
      // description으로 폐기를 알린다(2026-09-04 감사 §8 #1).
      return client.requestRaw(
          "GET", `${prefix}/cluster/restartCMAKService/${params.serviceGroupInstanceNo}`
        );
    }
  );

  defineTool(
    server,
    "ncloud_cdss_restart_kafka_per_node",
    "Restart Kafka on one or more specific nodes in a CDSS cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      // API는 **배열**(computeInstanceNoList)을 받는다. 단수 computeInstanceNo 로 보내면
      // 유효한 노드 번호를 넣어도 "3 Invalid Compute Instance No list" 로 거부된다
      // (2026-09-05 실클러스터 검증). 에러 문구의 'list' 가 단서였다.
      //
      // 이 결함은 **유효한 클러스터가 있어야만 드러난다** — 없는 번호로 호출하면 서버가
      // 클러스터 검증에서 먼저 걸러 파라미터까지 도달하지 않는다. 7·8차 경로 스윕이
      // 경로 오류 36건을 잡고도 이건 못 잡은 이유다.
      computeInstanceNoList: z.array(z.union([z.number(), z.string()])).min(1, {
        message: L({
          ko: "computeInstanceNoList는 최소 1개 이상이어야 합니다.",
          en: "computeInstanceNoList must contain at least one node number.",
        }),
      }).describe("Node server instance numbers to restart (from ncloud_cdss_list_nodes)"),
    },
    async (params) => {
      // 공식 curl 예제는 따옴표 없는 숫자 배열이다. 입력은 문자열도 받되(노드 목록 응답이
      // 문자열로 오는 경우가 있다) 숫자로 변환 가능한 값은 숫자로 보낸다.
      const list = params.computeInstanceNoList.map((v) => {
        if (typeof v === "number") return v;
        const n = Number(v);
        return Number.isFinite(n) && v.trim() !== "" ? n : v;
      });
      return client.postRequest(
          `${prefix}/cluster/restartKafkaServicePerNode/${params.serviceGroupInstanceNo}`,
          { computeInstanceNoList: list }
        );
    }
  );

  // ─── Public Domain & Endpoint Tools ──────────────────────────────────

  defineTool(
    server,
    "ncloud_cdss_enable_public_domain",
    "Enable public domain for CMAK management tool access",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      // 경로는 맞았고 메서드가 틀렸다 — 이 계열은 GET 이다(2026-09-04 감사 §1-F).
      // enableBrokerNodePublicEndpoint 만 POST여서 "켤 수는 있고 끌 수는 없는" 상태였다.
      return client.requestRaw(
          "GET", `${prefix}/cluster/enablePublicDomain/${params.serviceGroupInstanceNo}`
        );
    }
  );

  defineTool(
    server,
    "ncloud_cdss_disable_public_domain",
    "Disable public domain for CMAK management tool access",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      return client.requestRaw(
          "GET", `${prefix}/cluster/disablePublicDomain/${params.serviceGroupInstanceNo}`
        );
    }
  );

  defineTool(
    server,
    "ncloud_cdss_enable_public_endpoint",
    "Enable a public endpoint for broker nodes. Requires a load balancer — list the available ones " +
      "with ncloud_cdss_get_load_balancers.",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      // 이 계열에서 유일하게 POST 이고, 필수 본문 파라미터가 있는데 빠져 있었다.
      loadBalancerInstanceNo: z.string().describe("Load balancer instance number (from ncloud_cdss_get_load_balancers)"),
    },
    async (params) => {
      return client.postRequest(
          `${prefix}/cluster/enableBrokerNodePublicEndpoint/${params.serviceGroupInstanceNo}`,
          { loadBalancerInstanceNo: params.loadBalancerInstanceNo }
        );
    }
  );

  defineTool(
    server,
    "ncloud_cdss_disable_public_endpoint",
    "Disable the public endpoint for broker nodes",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      return client.requestRaw(
          "GET", `${prefix}/cluster/disableBrokerNodePublicEndpoint/${params.serviceGroupInstanceNo}`
        );
    }
  );

  defineTool(
    server,
    "ncloud_cdss_reset_cmak_password",
    "Reset the CMAK access account password for a CDSS cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      kafkaManagerUserPassword: z.string().describe("New CMAK password (8-20 chars, letters+numbers+special; excludes ' \" ` ₩ / & and spaces)"),
    },
    async (params) => {
      // 실제 op명은 resetCMAKPassword 다(CMAK 전부 대문자 — restartCMAKService 와 같은 표기 규칙).
      // 공식 문서는 curl 예제까지 resetMGMTPassword 로 적고 있으나 그 경로는 게이트웨이에 없다.
      // 문서가 틀린 사례이며, 라이브 실측으로 확정했다(2026-09-04).
      //
      // 메서드는 POST + JSON 본문을 유지한다. 같은 서비스의 단일 액션 op 6종이 GET이라
      // GET 전환이 제안됐었지만, 그러면 비밀번호가 쿼리스트링에 실리고 NCLOUD_DEBUG=1이
      // 전체 URL을 stderr로 찍는다 — op명만 고치면 되는 문제였다.
      return client.postRequest(
          `${prefix}/cluster/resetCMAKPassword/${params.serviceGroupInstanceNo}`,
          { kafkaManagerUserPassword: params.kafkaManagerUserPassword }
        );
    }
  );

  // ─── Monitoring Tools ────────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_cdss_get_monitoring",
    "Get Kafka monitoring metrics for a CDSS cluster node",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number (path segment)"),
      // 예전 스키마의 startTime/endTime 은 API에 없는 이름이었고, 필수 metric·
      // computeInstanceNo 가 빠져 있었다. 인스턴스 번호도 본문이 아니라 경로다.
      // op명도 getMonitoringData 가 아니라 getCdssMonitoringData 다.
      // 시각은 **epoch millis(Long)** 다 — ISO 8601은 서버가 타입 변환 실패로 거부한다(재판정 B-1).
      timeStart: z.number().describe("Start time as epoch milliseconds (e.g. 1745280000000) — NOT an ISO 8601 string"),
      timeEnd: z.number().describe("End time as epoch milliseconds"),
      // metric 은 enum 이다 — 'cpu'·'CPU' 모두 거부된다(재판정 B-2).
      metric: z.enum(["CLUSTER_ALL_METRICS", "BROKER_ALL_METRICS"]).describe("Metric set to retrieve"),
      computeInstanceNo: z.string().describe("Node instance number (from ncloud_cdss_list_nodes)"),
      interval: z.string().optional().describe("Aggregation interval (e.g. Min1, Min30, Hour2, Day1)"),
    },
    async (params) => {
      const { serviceGroupInstanceNo, ...rest } = params;
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined) body[k] = v;
      }
      const result = await client.postRequest(
        `${prefix}/monitoring/getCdssMonitoringData/${serviceGroupInstanceNo}`, body
      );
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_cdss_get_os_monitoring",
    "Get OS-level monitoring metrics (CPU, memory, disk) for a CDSS cluster node",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number (path segment)"),
      timeStart: z.number().describe("Start time as epoch milliseconds (e.g. 1745280000000) — NOT an ISO 8601 string"),
      timeEnd: z.number().describe("End time as epoch milliseconds"),
      metric: z.enum(["OS_ALL_METRICS"]).describe("Metric set to retrieve. OS_ALL_METRICS is the only valid value"),
      computeInstanceNo: z.string().describe("Node instance number (from ncloud_cdss_list_nodes)"),
      interval: z.string().optional().describe("Aggregation interval (e.g. Min1, Min30, Hour2, Day1). Default: Min1"),
    },
    async (params) => {
      const { serviceGroupInstanceNo, ...rest } = params;
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) {
        if (v !== undefined) body[k] = v;
      }
      const result = await client.postRequest(
        `${prefix}/monitoring/getOsMonitoringData/${serviceGroupInstanceNo}`, body
      );
      return result;
    }
  );

  // ─── Config Group Tools ──────────────────────────────────────────────

  defineTool(
    server,
    "ncloud_cdss_list_config_groups",
    "List Config Groups for CDSS (Kafka configuration templates) for a given Kafka version",
    {
      kafkaVersionCode: z.number().describe("Kafka version code (from ncloud_cdss_get_kafka_versions)"),
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Page size (default: 10)"),
    },
    async (params) => {
      // 실제 오퍼레이션은 POST /configGroup/getKafkaVersionConfigGroupList 이며
      // kafkaVersionCode가 필수다. getConfigGroupList 경로는 존재하지 않는다(B-6).
      const body: Record<string, unknown> = { kafkaVersionCode: params.kafkaVersionCode };
      if (params.pageNo !== undefined) body.pageNo = params.pageNo;
      if (params.pageSize !== undefined) body.pageSize = params.pageSize;
      const result = await client.postRequest(
        `${prefix}/configGroup/getKafkaVersionConfigGroupList`, body
      );
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_cdss_get_config_group_detail",
    "Get Config Group details (name, Kafka version, description) for a CDSS config group",
    {
      configGroupNo: z.string().describe("Config group number (from ncloud_cdss_list_config_groups)"),
      kafkaVersionCode: z.number().describe("Kafka version code of the group (from ncloud_cdss_get_kafka_versions)"),
    },
    async (params) => {
      // 실제 오퍼레이션은 POST /configGroup/getKafkaConfigGroup/{configGroupNo} 이며
      // 본문에 kafkaVersionCode가 필수다. getConfigGroupDetail 경로는 존재하지 않아
      // 300 Not Found로 거절됐다(라이브 리포트 §3-B — B-6과 같은 경로 오류 계열).
      return client.postRequest(
          `${prefix}/configGroup/getKafkaConfigGroup/${params.configGroupNo}`,
          { kafkaVersionCode: params.kafkaVersionCode }
        );
    }
  );

  defineTool(
    server,
    "ncloud_cdss_get_kafka_config",
    "Get the Kafka settings held by a Config Group (default and custom values per setting)",
    {
      configGroupNo: z.string().describe("Config group number (from ncloud_cdss_list_config_groups)"),
      kafkaVersionCode: z.number().describe("Kafka version code of the group (from ncloud_cdss_get_kafka_versions)"),
    },
    async (params) => {
      // 실제 오퍼레이션은 POST /configGroup/getKafkaConfigGroupDetailList/{configGroupNo} 이며
      // 본문에 kafkaVersionCode가 필수다. getKafkaConfig 경로는 존재하지 않는다
      // (§3-B와 같은 계열 — Config Group 계열 op명을 관용적 이름으로 추정해 쓴 결과).
      return client.postRequest(
          `${prefix}/configGroup/getKafkaConfigGroupDetailList/${params.configGroupNo}`,
          { kafkaVersionCode: params.kafkaVersionCode }
        );
    }
  );

  defineTool(
    server,
    "ncloud_cdss_get_config_group_clusters",
    "List the CDSS clusters a Config Group is currently applied to. Call this before deleting a group.",
    {
      configGroupNo: z.string().describe("Config group number (from ncloud_cdss_list_config_groups)"),
      pageNo: z.number().optional().describe("Page number (default: 1)"),
      pageSize: z.number().optional().describe("Page size (default: 10)"),
    },
    async (params) => {
      const body: Record<string, unknown> = {};
      if (params.pageNo !== undefined) body.pageNo = params.pageNo;
      if (params.pageSize !== undefined) body.pageSize = params.pageSize;
      return client.postRequest(
          `${prefix}/configGroup/getConfigGroupUsingClusterList/${params.configGroupNo}`, body
        );
    }
  );

  defineTool(
    server,
    "ncloud_cdss_create_config_group",
    "Create a new Config Group for CDSS cluster configuration",
    {
      configGroupName: z.string().max(30, {
        message: maxLenMessage("configGroupName", 30),
      }).describe("Config group name (3-30 chars: lowercase letters, numbers, hyphen; must start and end with a lowercase letter or number)"),
      // 이 계열의 다른 도구와 타입을 맞춘다(문서상 Integer). 예전엔 여기만 string이었다.
      kafkaVersionCode: z.number().describe("Kafka version code (from ncloud_cdss_get_kafka_versions)"),
      description: z.string().max(255, {
        message: maxLenMessage("description", 255),
      }).optional().describe("Config group description (0-255 chars)"),
    },
    async (params) => {
      const body: Record<string, unknown> = {
        configGroupName: params.configGroupName,
        kafkaVersionCode: params.kafkaVersionCode,
      };
      if (params.description) body.description = params.description;
      const result = await client.postRequest(
        `${prefix}/configGroup/createConfigGroup`, body
      );
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_cdss_apply_config_group",
    "Apply a Config Group to a CDSS cluster. The cluster must run the same Kafka version as the group.",
    {
      configGroupNo: z.string().describe("Config group number to apply (from ncloud_cdss_list_config_groups)"),
      kafkaVersionCode: z.number().describe("Kafka version code of the group (from ncloud_cdss_get_kafka_versions)"),
      serviceGroupInstanceNo: z.number().describe("Target cluster instance number (from ncloud_cdss_list_clusters)"),
    },
    async (params) => {
      // 실제 오퍼레이션은 setClusterKafkaConfigGroup 이며 본문에 kafkaVersionCode도 필수다.
      // applyConfigGroup 경로는 존재하지 않는다.
      return client.postRequest(
          `${prefix}/configGroup/setClusterKafkaConfigGroup/${params.configGroupNo}`,
          {
            kafkaVersionCode: params.kafkaVersionCode,
            serviceGroupInstanceNo: params.serviceGroupInstanceNo,
          }
        );
    }
  );

  defineTool(
    server,
    "ncloud_cdss_set_config_group_description",
    "Change a Config Group's description. An empty string clears it.",
    {
      configGroupNo: z.string().describe("Config group number (from ncloud_cdss_list_config_groups)"),
      kafkaVersionCode: z.number().describe("Kafka version code of the group (from ncloud_cdss_get_kafka_versions)"),
      description: z.string().max(255, {
        message: maxLenMessage("description", 255),
      }).optional().describe("New description (0-255 chars). Omit or pass an empty string to clear it"),
    },
    async (params) => {
      const body: Record<string, unknown> = { kafkaVersionCode: params.kafkaVersionCode };
      if (params.description !== undefined) body.description = params.description;
      return client.postRequest(
          `${prefix}/configGroup/setKafkaConfigGroupMemo/${params.configGroupNo}`, body
        );
    }
  );

  defineTool(
    server,
    "ncloud_cdss_change_kafka_config",
    "⚠️ Replaces the Config Group's ENTIRE custom configuration. Any setting you omit loses its custom value " +
      "and reverts to the default — the API reports SUCCESS either way, so the revert is silent. " +
      "Read the current values with ncloud_cdss_get_kafka_config and send EVERY value you want to keep, " +
      "not just the ones you are changing. Named settings are typed parameters; anything without one goes in " +
      "additionalSettings. `range` in the read response gives each setting's valid bounds (the server enforces " +
      "them), and `modifyYn: false` marks settings the server silently discards rather than rejecting " +
      "(authorizer.class.name is one). The group must be re-applied to a cluster with " +
      "ncloud_cdss_apply_config_group for a change to take effect.",
    {
      configGroupNo: z.string().describe("Config group number (from ncloud_cdss_list_config_groups)"),
      kafkaVersionCode: z.number().describe("Kafka version code of the group (from ncloud_cdss_get_kafka_versions)"),
      // 임의 키-값 맵(예전 kafkaConfig)이 아니라 **타입이 지정된 필드**들이다.
      autoCreateTopicsEnable: z.boolean().optional().describe("auto.create.topics.enable"),
      deleteTopicEnable: z.boolean().optional().describe("delete.topic.enable"),
      offsetsTopicReplicationFactor: z.number().optional().describe("offsets.topic.replication.factor"),
      logCleanerEnable: z.boolean().optional().describe("log.cleaner.enable"),
      logCleanupPolicy: z.string().optional().describe("log.cleanup.policy (e.g. 'delete', 'compact')"),
      logCleanerThreads: z.number().optional().describe("log.cleaner.threads"),
      logFlushIntervalMessages: z.number().optional().describe("log.flush.interval.messages"),
      logRetentionBytes: z.number().optional().describe("log.retention.bytes (-1 for unlimited)"),
      logRetentionHours: z.number().optional().describe("log.retention.hours (e.g. 168)"),
      logSegmentBytes: z.number().optional().describe("log.segment.bytes (e.g. 1073741824)"),
      numIoThreads: z.number().optional().describe("num.io.threads"),
      numNetworkThreads: z.number().optional().describe("num.network.threads"),
      numPartitions: z.number().optional().describe("num.partitions"),
      authorizerClassName: z.string().optional().describe("authorizer.class.name. ⚠️ Read-only in practice: the server accepts this, answers SUCCESS, and discards it (modifyYn=false)"),
      allowEveryoneIfNoAclFound: z.boolean().optional().describe("allow.everyone.if.no.acl.found"),
      additionalSettings: z.array(z.object({
        configName: z.string().describe("Kafka setting name (e.g. 'compression.type')"),
        // 읽기 응답의 additionalKafkaConfigGroupDetailList 항목은 값 필드가 configValue다
        // (명시 설정 15개의 customValue와 이름이 다르다). 공식 문서에는 이 배열의
        // 항목 서브 필드 표가 없어 처음엔 customValue로 보냈고, 서버가 항목만 만들고
        // 값을 버렸다(5차 T-7). 읽기 셰이프에 맞춰 configValue로 보낸다 — 라이브 재검증 대상.
        configValue: z.string().describe("Value to set, as a string"),
      })).optional().describe("Settings without a named parameter above — sent as additionalKafkaConfigGroupDetailList. ⚠️ Value application is unverified: an earlier attempt registered the entry with an empty value"),
    },
    async (params) => {
      // 실제 오퍼레이션은 POST setKafkaConfigGroupDetail 이다.
      // changeKafkaConfig 경로는 존재하지 않고, 메서드도 PUT이 아니라 POST다.
      const { configGroupNo, additionalSettings, ...rest } = params;
      const body: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rest)) {
        if (value !== undefined) body[key] = value;
      }
      if (additionalSettings !== undefined) {
        body.additionalKafkaConfigGroupDetailList = additionalSettings;
      }
      const result = await client.postRequest(
          `${prefix}/configGroup/setKafkaConfigGroupDetail/${configGroupNo}`, body
      );
      // 서버가 SUCCESS로 답하고 조용히 버리는 값들을 결과에 명시한다 — 성공 응답만 보고
      // 반영됐다고 오해하는 것을 막는다(5차 T-6d·T-7. create_snapshot의 경고와 같은 방식).
      const warnings: Record<string, string> = {};
      if (params.authorizerClassName !== undefined) {
        warnings.warning_authorizerClassName = L({
          ko: "authorizer.class.name은 modifyYn=false 설정이라 서버가 SUCCESS를 반환하고 값을 버립니다. 반영 여부를 ncloud_cdss_get_kafka_config로 확인하세요.",
          en: "authorizer.class.name has modifyYn=false — the server answers SUCCESS and discards the value. Verify with ncloud_cdss_get_kafka_config.",
        });
      }
      if (additionalSettings !== undefined) {
        warnings.warning_additionalSettings = L({
          ko: "additionalSettings의 값 반영은 아직 검증되지 않았습니다(항목만 등록되고 값이 비는 사례 관측). ncloud_cdss_get_kafka_config로 확인하세요.",
          en: "additionalSettings value application is unverified — an entry was once registered with an empty value. Verify with ncloud_cdss_get_kafka_config.",
        });
      }
      // 이 호출은 생략한 설정을 기본값으로 되돌린다 — 성공 응답에 그 사실을 남긴다.
      warnings.note_replacement = L({
        ko: "이 호출은 그룹의 사용자 정의 설정을 전부 교체합니다. 보내지 않은 설정은 기본값으로 되돌아갑니다.",
        en: "This call replaces the group's entire custom configuration; settings you omitted have reverted to their defaults.",
      });
      // 응답이 객체가 아닐 수도 있으므로 경고를 덧붙이기 전에 감싼다.
      const base =
        result !== null && typeof result === "object" && !Array.isArray(result) ? result : { result };
      return { ...base, ...warnings };
    }
  );

  defineTool(
    server,
    "ncloud_cdss_delete_config_group",
    "⚠️ Destructive: Delete a Config Group. Check which clusters still use it with " +
      "ncloud_cdss_get_config_group_clusters first. Set confirm=true to execute.",
    {
      configGroupNo: z.string().describe("Config group number to delete (required)"),
      confirm: z.boolean().optional().default(false).describe("Must be true to execute deletion"),
    },
    async (params) => {
      if (!params.configGroupNo) {
        return { content: [{ type: "text" as const, text: "Error: configGroupNo is required." }], isError: true };
      }
      const result = await client.deleteRequest(
        `${prefix}/configGroup/deleteConfigGroup/${params.configGroupNo}`
      );
      return result;
    },
    {
      // 게이트 경고는 사용자가 삭제를 실제로 시도한 직후 — 안내가 가장 필요한 순간 — 에 나온다.
      // 안전 워크플로(사용 중 클러스터 확인)를 description에만 두면 그 순간에 전달되지 않는다(4차 T-4).
      destructive: {
        message: (params) =>
          `⚠️ This will delete Config Group [${params.configGroupNo}].\n\n` +
          `Check which clusters still use it first: ncloud_cdss_get_config_group_clusters { configGroupNo: "${params.configGroupNo}" }\n\n` +
          `To execute, call again with confirm=true.`,
      },
    }
  );

  // ─── Rolling Restart & Upgrade Tools ──────────────────────────────────

  defineTool(
    server,
    "ncloud_cdss_rolling_restart",
    "Perform a rolling restart of all nodes in a CDSS cluster",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      // 롤링 계열은 인스턴스 번호를 **본문**으로 받는다 — 경로 세그먼트로 붙여
      // 라우트를 찾지 못했다(2026-09-04 감사 §1-D).
      return client.postRequest(
          `${prefix}/cluster/rollingRestart`,
          { serviceGroupInstanceNo: params.serviceGroupInstanceNo }
        );
    }
  );

  defineTool(
    server,
    "ncloud_cdss_rolling_restart_precheck",
    "Pre-check before performing a rolling restart",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      return client.postRequest(
          `${prefix}/cluster/rollingRestartPreCheck`,
          { serviceGroupInstanceNo: params.serviceGroupInstanceNo }
        );
    }
  );

  defineTool(
    server,
    "ncloud_cdss_rolling_restart_status",
    "Get the progress status of a rolling restart operation",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      // POST + 본문이다. GET + 경로 세그먼트 조합은 라우트가 없었다.
      return client.postRequest(
          `${prefix}/cluster/rollingRestartProgressCheck`,
          { serviceGroupInstanceNo: params.serviceGroupInstanceNo }
        );
    }
  );

  defineTool(
    server,
    "ncloud_cdss_upgrade_version",
    "Upgrade the Kafka version of a CDSS cluster. Run ncloud_cdss_upgrade_precheck first.",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      // 실제 필드명은 upgrade* 접두사가 붙고 둘 다 필수다. 경로 세그먼트도 쓰지 않는다.
      upgradeKafkaVersionCode: z.number().describe("Target Kafka version code (from ncloud_cdss_get_kafka_versions)"),
      upgradeConfigGroupNo: z.number().describe("Config group number for the target version (from ncloud_cdss_list_config_groups)"),
    },
    async (params) => {
      const result = await client.postRequest(`${prefix}/cluster/rollingUpgrade`, {
        serviceGroupInstanceNo: params.serviceGroupInstanceNo,
        upgradeKafkaVersionCode: params.upgradeKafkaVersionCode,
        upgradeConfigGroupNo: params.upgradeConfigGroupNo,
      });
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_cdss_upgrade_precheck",
    "Pre-check whether a CDSS Kafka version upgrade can proceed",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
      upgradeKafkaVersionCode: z.number().describe("Target Kafka version code (from ncloud_cdss_get_kafka_versions)"),
      upgradeConfigGroupNo: z.number().describe("Config group number for the target version"),
    },
    async (params) => {
      const result = await client.postRequest(`${prefix}/cluster/rollingUpgradePreCheck`, {
        serviceGroupInstanceNo: params.serviceGroupInstanceNo,
        upgradeKafkaVersionCode: params.upgradeKafkaVersionCode,
        upgradeConfigGroupNo: params.upgradeConfigGroupNo,
      });
      return result;
    }
  );

  defineTool(
    server,
    "ncloud_cdss_upgrade_status",
    "Get the progress status of a version upgrade operation",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      // POST + 본문이다(GET + 경로 세그먼트 아님).
      return client.postRequest(
          `${prefix}/cluster/rollingUpgradeProgressCheck`,
          { serviceGroupInstanceNo: params.serviceGroupInstanceNo }
        );
    }
  );

  // ─── Server Generation & G3 Tools ───────────────────────────────────

  defineTool(
    server,
    "ncloud_cdss_get_server_generations",
    "Get available server generations (hypervisor types) for CDSS",
    {},
    async () => {
      return client.requestRaw(
          "GET", `${prefix}/cluster/getServerGenerationList`
        );
    }
  );

  defineTool(
    server,
    "ncloud_cdss_get_server_spec_list",
    "Get available server specs for CDSS (G3/KVM). softwareProductCode must be a G3 image code — " +
      "a G2 code from ncloud_cdss_get_os_products is rejected.",
    {
      softwareProductCode: z.string().describe("G3 OS image code (from ncloud_cdss_get_cluster_server_images)"),
    },
    async (params) => {
      // POST + JSON 본문이다(B-6).
      return client.postRequest(
          `${prefix}/cluster/getServerSpecList`,
          { softwareProductCode: params.softwareProductCode }
        );
    }
  );

  defineTool(
    server,
    "ncloud_cdss_get_cluster_server_images",
    "Get available OS images for CDSS (G3/KVM). " +
      "⚠️ Known issue: the documented endpoint currently returns 300 Not Found on the live API — " +
      "read the G3 image code from the console instead. The G2 tool ncloud_cdss_get_os_products works.",
    {
      generationCode: z.enum(["G3"]).optional().describe("Server generation code. Only G3 (3rd generation) is valid"),
    },
    async (params) => {
      try {
        return await client.requestRaw(
          "GET", `${prefix}/cluster/getClusterServerImageList`,
          { generationCode: params.generationCode }
        );
      } catch (error) {
        throw g3ImageListGuidance(error);
      }
    }
  );

  // ─── Load Balancer Query Tool ────────────────────────────────────────

  defineTool(
    server,
    "ncloud_cdss_get_load_balancers",
    "Get available load balancers for CDSS broker node public endpoint",
    {
      serviceGroupInstanceNo: z.string().describe("Cluster instance number"),
    },
    async (params) => {
      return client.requestRaw(
          "GET", `${prefix}/cluster/getLoadBalancerInstanceList/${params.serviceGroupInstanceNo}`
        );
    }
  );
}
