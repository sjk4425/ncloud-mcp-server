import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerSearchEngineServiceTools } from "./analytics-ses.js";
import { registerCloudDataStreamingTools } from "./analytics-cdss.js";
import { registerCloudHadoopTools } from "./analytics-hadoop.js";

/**
 * MCP-BUG-REPORT_2026-09-01 B-4·B-5·B-6·B-7 회귀 테스트.
 *
 * 이 계열 결함은 **HTTP 메서드·경로·필수 파라미터의 불일치**라 응답만 목킹해서는
 * 잡히지 않는다. 그래서 client 호출의 (method, path, query, body) 를 직접 검증한다.
 */

function createMockClient(baseUrl: string): NcloudClient {
  return new NcloudClient({
    accessKey: "testAccessKey",
    secretKey: "testSecretKey",
    baseUrl,
    regionCode: "KR",
  });
}

function getTool(server: McpServer, toolName: string): any {
  const tools = (server as any)._registeredTools;
  const entry = tools instanceof Map ? tools.get(toolName) : tools[toolName];
  if (!entry) throw new Error(`Tool ${toolName} not found`);
  return entry;
}

function getToolHandler(server: McpServer, toolName: string): any {
  return getTool(server, toolName).handler;
}

function isRequired(server: McpServer, toolName: string, field: string): boolean {
  const shape = getTool(server, toolName).inputSchema.shape;
  const entry = shape[field];
  if (!entry) throw new Error(`Field ${field} not in ${toolName} schema`);
  return !entry.isOptional();
}

const OS_CODE = "SW.VELST.OS.LNX64.ROCKY.0808.B050";

describe("SES — 조회 엔드포인트 전송 방식 (B-4/B-5)", () => {
  let server: McpServer;
  let client: NcloudClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient("https://vpcsearchengine.apigw.ntruss.com");
    registerSearchEngineServiceTools(server, client);
  });

  it("get_node_products(G2): GET + 쿼리스트링, softwareProductCode·subnetNo 동봉", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ code: 0 });
    await getToolHandler(server, "ncloud_ses_get_node_products")(
      { softwareProductCode: OS_CODE, subnetNo: 20001 },
      {} as any
    );

    const [method, path, query, body] = spy.mock.calls[0];
    // POST 로 보내면 API Gateway 가 라우트를 찾지 못해 300 Not Found 다.
    expect(method).toBe("GET");
    expect(path).toBe("/api/v2/cluster/getNodeProductList");
    expect(query).toEqual({ softwareProductCode: OS_CODE, subnetNo: 20001 });
    expect(body).toBeUndefined();
    spy.mockRestore();
  });

  it("get_node_products(G2): subnetNo 도 필수다", () => {
    expect(isRequired(server, "ncloud_ses_get_node_products", "softwareProductCode")).toBe(true);
    expect(isRequired(server, "ncloud_ses_get_node_products", "subnetNo")).toBe(true);
  });

  it("get_server_specs(G3): POST + JSON 본문 (공식 스펙)", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ code: 0 });
    await getToolHandler(server, "ncloud_ses_get_server_specs")(
      { softwareProductCode: "SW.VELST.OS.LNX64.ROCKY.08.G003" },
      {} as any
    );

    const [method, path, query, body] = spy.mock.calls[0];
    expect(method).toBe("POST");
    expect(path).toBe("/api/v2/cluster/getServerSpecList");
    expect(query).toBeUndefined();
    expect(body).toEqual({ softwareProductCode: "SW.VELST.OS.LNX64.ROCKY.08.G003" });
    spy.mockRestore();
  });

  it("get_subnet_list(G2): softwareProductCode 없이는 400 '유효하지 않은 OS 타입' 이었다", async () => {
    expect(isRequired(server, "ncloud_ses_get_subnet_list", "softwareProductCode")).toBe(true);

    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ code: 0 });
    await getToolHandler(server, "ncloud_ses_get_subnet_list")(
      { softwareProductCode: OS_CODE, vpcNo: 93001 },
      {} as any
    );

    const [method, path, query] = spy.mock.calls[0];
    expect(method).toBe("GET");
    expect(path).toBe("/api/v2/cluster/getSubnetList");
    expect(query).toEqual({ softwareProductCode: OS_CODE, vpcNo: 93001 });
    spy.mockRestore();
  });

  it("get_subnet_list_g3: POST 본문에 softwareProductCode 를 동봉한다", async () => {
    expect(isRequired(server, "ncloud_ses_get_subnet_list_g3", "softwareProductCode")).toBe(true);

    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ code: 0 });
    await getToolHandler(server, "ncloud_ses_get_subnet_list_g3")(
      { softwareProductCode: "SW.VELST.OS.LNX64.ROCKY.08.G003", vpcNo: 4001, isPrivate: true },
      {} as any
    );

    const [method, path, , body] = spy.mock.calls[0];
    expect(method).toBe("POST");
    expect(path).toBe("/api/v2/cluster/getVpcAvailableSubnetList");
    expect(body).toEqual({
      softwareProductCode: "SW.VELST.OS.LNX64.ROCKY.08.G003",
      vpcNo: 4001,
      isPrivate: true,
    });
    spy.mockRestore();
  });

  it("get_cluster_server_images(G3): GET + 선택적 generationCode", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ code: 0 });
    await getToolHandler(server, "ncloud_ses_get_cluster_server_images")({ generationCode: "G3" }, {} as any);

    const [method, path, query] = spy.mock.calls[0];
    expect(method).toBe("GET");
    expect(path).toBe("/api/v2/cluster/getClusterServerImageList");
    expect(query).toEqual({ generationCode: "G3" });
    spy.mockRestore();
  });

  it("create_cluster_g3: 노드 코드는 *ProductCode 이고 hypervisor/generation 이 필수다", async () => {
    const shape = getTool(server, "ncloud_ses_create_cluster_g3").inputSchema.shape;
    // 예전 스키마의 *ServerSpecCode 세 개는 API에 없는 이름이었다(B-1과 같은 부류).
    for (const gone of ["managerNodeServerSpecCode", "dataNodeServerSpecCode", "masterNodeServerSpecCode"]) {
      expect(shape, gone).not.toHaveProperty(gone);
    }
    for (const f of ["managerNodeProductCode", "dataNodeProductCode", "hypervisorCode", "generationCode"]) {
      expect(isRequired(server, "ncloud_ses_create_cluster_g3", f), f).toBe(true);
    }
    // 마스터 노드 코드는 조건부라 스키마에서는 optional 이다.
    expect(isRequired(server, "ncloud_ses_create_cluster_g3", "masterNodeProductCode")).toBe(false);

    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ code: 0 });
    await getToolHandler(server, "ncloud_ses_create_cluster_g3")(
      {
        clusterName: "v1130-ses", searchEngineVersionCode: "2150",
        searchEngineDashboardPort: "5601", searchEngineUserName: "ncpadmin",
        searchEngineUserPassword: "pw", softwareProductCode: "SW.VELST.OS.LNX64.ROCKY.08.G003",
        hypervisorCode: "KVM", generationCode: "G3", vpcNo: 21538,
        managerNodeSubnetNo: 299510, managerNodeProductCode: "SVR.VELST.HICPU.C002.M004.NET.SSD.B050.G003",
        dataNodeSubnetNo: 299511, dataNodeCount: 3,
        dataNodeProductCode: "SVR.VELST.HICPU.C002.M004.NET.SSD.B050.G003",
        dataNodeStorageSize: 100, loginKeyName: "ksj-key",
      },
      {} as any
    );

    const [method, path, , body] = spy.mock.calls[0];
    expect(method).toBe("POST");
    expect(path).toBe("/api/v2/cluster/createKvmSearchEngineCluster");
    expect(body).toHaveProperty("managerNodeProductCode");
    expect(body).toHaveProperty("hypervisorCode", "KVM");
    expect(body).not.toHaveProperty("dryRun");
    spy.mockRestore();
  });

  it("create_cluster_g3: 전용 마스터 노드를 켜면 조건부 필수를 사전 검사한다", async () => {
    const spy = vi.spyOn(client, "requestRaw");
    const result = await getToolHandler(server, "ncloud_ses_create_cluster_g3")(
      {
        clusterName: "v1130-ses", searchEngineVersionCode: "2150",
        searchEngineDashboardPort: "5601", searchEngineUserName: "ncpadmin",
        searchEngineUserPassword: "pw", softwareProductCode: "x",
        hypervisorCode: "KVM", generationCode: "G3", vpcNo: 1,
        managerNodeSubnetNo: 2, managerNodeProductCode: "p",
        dataNodeSubnetNo: 3, dataNodeCount: 3, dataNodeProductCode: "p",
        dataNodeStorageSize: 100, loginKeyName: "k",
        isMasterOnlyNodeActivated: true,
      },
      {} as any
    );

    expect(spy).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("masterNodeProductCode");
    spy.mockRestore();
  });

  it("get_node_spec_for_change_g3(신규): 인스턴스 번호는 경로, 본문은 computeInstanceProductCode", async () => {
    // CDSS의 같은 이름 오퍼레이션과 형태가 다르다 — 복사하면 틀린다.
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ code: 0 });
    await getToolHandler(server, "ncloud_ses_get_node_spec_for_change_g3")(
      { serviceGroupInstanceNo: "1039123", computeInstanceProductCode: "SVR.VELST.STAND.C002.M008.NET.SSD.B050.G003" },
      {} as any
    );

    const [method, path, , body] = spy.mock.calls[0];
    expect(method).toBe("POST");
    expect(path).toBe("/api/v2/cluster/getServerSpecListForSpecChange/1039123");
    expect(body).toEqual({ computeInstanceProductCode: "SVR.VELST.STAND.C002.M008.NET.SSD.B050.G003" });
    spy.mockRestore();
  });

  it("SES G3 오퍼레이션 5개가 모두 도구로 존재한다", () => {
    for (const name of [
      "ncloud_ses_get_server_specs",                 // getServerSpecList
      "ncloud_ses_get_cluster_server_images",        // getClusterServerImageList
      "ncloud_ses_get_subnet_list_g3",               // getVpcAvailableSubnetList
      "ncloud_ses_create_cluster_g3",                // createKvmSearchEngineCluster
      "ncloud_ses_get_node_spec_for_change_g3",      // getServerSpecListForSpecChange
    ]) {
      expect(() => getTool(server, name), name).not.toThrow();
    }
  });
});

describe("CDSS — 조회 엔드포인트 경로·전송 방식 (B-6)", () => {
  let server: McpServer;
  let client: NcloudClient;
  const CDSS_OS = "SW.VCDSS.OS.LNX64.CNTOS.0708.B050";

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient("https://clouddatastreamingservice.apigw.ntruss.com");
    registerCloudDataStreamingTools(server, client);
  });

  it("get_kafka_versions: 실제 오퍼레이션은 getCDSSVersionList 다", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ code: 0 });
    await getToolHandler(server, "ncloud_cdss_get_kafka_versions")({}, {} as any);

    const [method, path] = spy.mock.calls[0];
    expect(method).toBe("GET");
    // getKafkaVersionList 경로는 존재하지 않아 300 Not Found 였다.
    expect(path).toBe("/api/v1/cluster/getCDSSVersionList");
    spy.mockRestore();
  });

  it("get_node_products: POST 본문에 softwareProductCode·subnetNo", async () => {
    expect(isRequired(server, "ncloud_cdss_get_node_products", "softwareProductCode")).toBe(true);
    expect(isRequired(server, "ncloud_cdss_get_node_products", "subnetNo")).toBe(true);

    const spy = vi.spyOn(client, "postRequest").mockResolvedValue({ code: 0 });
    await getToolHandler(server, "ncloud_cdss_get_node_products")(
      { softwareProductCode: CDSS_OS, subnetNo: 30001 },
      {} as any
    );

    expect(spy).toHaveBeenCalledWith("/api/v1/cluster/getNodeProductList", {
      softwareProductCode: CDSS_OS,
      subnetNo: 30001,
    });
    spy.mockRestore();
  });

  it("get_subnet_list: POST 본문에 softwareProductCode·vpcNo", async () => {
    expect(isRequired(server, "ncloud_cdss_get_subnet_list", "softwareProductCode")).toBe(true);

    const spy = vi.spyOn(client, "postRequest").mockResolvedValue({ code: 0 });
    await getToolHandler(server, "ncloud_cdss_get_subnet_list")(
      { softwareProductCode: CDSS_OS, vpcNo: 4001 },
      {} as any
    );

    expect(spy).toHaveBeenCalledWith("/api/v1/cluster/getSubnetList", {
      softwareProductCode: CDSS_OS,
      vpcNo: 4001,
    });
    spy.mockRestore();
  });

  it("get_server_spec_list(G3): POST 본문에 softwareProductCode", async () => {
    expect(isRequired(server, "ncloud_cdss_get_server_spec_list", "softwareProductCode")).toBe(true);

    const spy = vi.spyOn(client, "postRequest").mockResolvedValue({ code: 0 });
    await getToolHandler(server, "ncloud_cdss_get_server_spec_list")(
      { softwareProductCode: "SW.VCDSS.OS.LNX64.ROCKY.08.G003" },
      {} as any
    );

    expect(spy).toHaveBeenCalledWith("/api/v1/cluster/getServerSpecList", {
      softwareProductCode: "SW.VCDSS.OS.LNX64.ROCKY.08.G003",
    });
    spy.mockRestore();
  });

  it("get_cluster_server_images(G3): GET + 선택적 generationCode", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ code: 0 });
    await getToolHandler(server, "ncloud_cdss_get_cluster_server_images")({}, {} as any);

    const [method, path] = spy.mock.calls[0];
    expect(method).toBe("GET");
    expect(path).toBe("/api/v1/cluster/getClusterServerImageList");
    spy.mockRestore();
  });

  it("get_subnet_list_g3(신규): POST getVpcAvailableSubnetList — 인덱스 슬러그명이 아니다", async () => {
    const spy = vi.spyOn(client, "postRequest").mockResolvedValue({ code: 0 });
    await getToolHandler(server, "ncloud_cdss_get_subnet_list_g3")(
      { vpcNo: 21538, softwareProductCode: "SW.VCDSS.OS.LNX64.ROCKY.08.G003", isPrivate: true },
      {} as any
    );

    const [path, body] = spy.mock.calls[0];
    // 문서 인덱스 슬러그는 getavailablesubnetlist 지만 실제 op는 getVpcAvailableSubnetList 다.
    expect(path).toBe("/api/v1/cluster/getVpcAvailableSubnetList");
    expect(path).not.toContain("getAvailableSubnetList");
    expect(body).toEqual({
      vpcNo: 21538,
      softwareProductCode: "SW.VCDSS.OS.LNX64.ROCKY.08.G003",
      isPrivate: true,
    });
    spy.mockRestore();
  });

  it("get_node_spec_for_change_g3(신규): POST getServerSpecListForSpecChange", async () => {
    const spy = vi.spyOn(client, "postRequest").mockResolvedValue({ code: 0 });
    await getToolHandler(server, "ncloud_cdss_get_node_spec_for_change_g3")(
      { serviceGroupInstanceNo: 100912345 },
      {} as any
    );

    expect(spy).toHaveBeenCalledWith("/api/v1/cluster/getServerSpecListForSpecChange", {
      serviceGroupInstanceNo: 100912345,
    });
    spy.mockRestore();
  });

  it("create_cluster_g3(신규): POST createKvmCluster, 브로커는 dataNode* 로 나간다", async () => {
    const shape = getTool(server, "ncloud_cdss_create_cluster_g3").inputSchema.shape;
    // G2는 brokerNode*, G3는 dataNode* 다 — 혼동하면 필수값 누락이 된다.
    expect(shape).toHaveProperty("dataNodeCount");
    expect(shape).not.toHaveProperty("brokerNodeCount");
    // VPC·서브넷은 이름과 번호를 둘 다 요구한다.
    for (const f of ["vpcName", "vpcNo", "managerNodeSubnetName", "managerNodeSubnetNo",
                     "dataNodeSubnetName", "dataNodeSubnetNo", "serverSpecCode",
                     "hypervisorCode", "generationCode"]) {
      expect(isRequired(server, "ncloud_cdss_create_cluster_g3", f), f).toBe(true);
    }

    const spy = vi.spyOn(client, "postRequest").mockResolvedValue({ code: 0 });
    await getToolHandler(server, "ncloud_cdss_create_cluster_g3")(
      {
        clusterName: "v1130-g3", kafkaVersionCode: 3903006, configGroupNo: 1693,
        kafkaManagerUserName: "ncpadmin", kafkaManagerUserPassword: "pw",
        hypervisorCode: "KVM", generationCode: "G3",
        softwareProductCode: "SW.VCDSS.OS.LNX64.ROCKY.08.G003",
        vpcName: "test-vpc2", vpcNo: 21538,
        managerNodeSubnetName: "sb1", managerNodeSubnetNo: 299510,
        managerNodeProductCode: "SVR.VCDSS.STAND.C002.M008.NET.SSD.B050.G003",
        dataNodeSubnetName: "sb2", dataNodeSubnetNo: 299511, dataNodeCount: 3,
        dataNodeProductCode: "SVR.VCDSS.STAND.C002.M008.NET.SSD.B050.G003",
        dataNodeStorageSize: 100, serverSpecCode: "cdss.s2-g3",
      },
      {} as any
    );

    const [path, body] = spy.mock.calls[0];
    expect(path).toBe("/api/v1/cluster/createKvmCluster");
    expect(body).not.toHaveProperty("dryRun");
    expect((body as any).dataNodeCount).toBe(3);
    spy.mockRestore();
  });

  it("create_cluster_g3: dryRun 프리뷰가 비밀번호를 노출하지 않는다", async () => {
    const spy = vi.spyOn(client, "postRequest");
    const result = await getToolHandler(server, "ncloud_cdss_create_cluster_g3")(
      {
        clusterName: "v1130-g3", kafkaVersionCode: 3903006, configGroupNo: 1693,
        kafkaManagerUserName: "ncpadmin", kafkaManagerUserPassword: "PlainTextPw1!",
        hypervisorCode: "KVM", generationCode: "G3",
        softwareProductCode: "SW.VCDSS.OS.LNX64.ROCKY.08.G003",
        vpcName: "v", vpcNo: 1, managerNodeSubnetName: "a", managerNodeSubnetNo: 2,
        managerNodeProductCode: "p", dataNodeSubnetName: "b", dataNodeSubnetNo: 3,
        dataNodeCount: 3, dataNodeProductCode: "p", dataNodeStorageSize: 100,
        serverSpecCode: "s", dryRun: true,
      },
      {} as any
    );

    expect(spy).not.toHaveBeenCalled();
    expect(result.content[0].text).not.toContain("PlainTextPw1!");
    expect(result.content[0].text).toContain("createKvmCluster");
    spy.mockRestore();
  });

  it("CDSS G3 오퍼레이션 6개가 모두 도구로 존재한다", () => {
    for (const name of [
      "ncloud_cdss_get_server_generations",        // getServerGenerationList
      "ncloud_cdss_get_cluster_server_images",     // getClusterServerImageList
      "ncloud_cdss_get_server_spec_list",          // getServerSpecList
      "ncloud_cdss_get_subnet_list_g3",            // getVpcAvailableSubnetList
      "ncloud_cdss_create_cluster_g3",             // createKvmCluster
      "ncloud_cdss_get_node_spec_for_change_g3",   // getServerSpecListForSpecChange
    ]) {
      expect(() => getTool(server, name), name).not.toThrow();
    }
  });

  it("get_config_group_detail: POST getKafkaConfigGroup/{no} + 본문 kafkaVersionCode (라이브 §3-B)", async () => {
    // getConfigGroupDetail 경로는 존재하지 않아 300이었다 — B-6과 같은 경로 오류 계열.
    expect(isRequired(server, "ncloud_cdss_get_config_group_detail", "kafkaVersionCode")).toBe(true);

    const spy = vi.spyOn(client, "postRequest").mockResolvedValue({ code: 0 });
    await getToolHandler(server, "ncloud_cdss_get_config_group_detail")(
      { configGroupNo: "1693", kafkaVersionCode: 3903006 },
      {} as any
    );

    expect(spy).toHaveBeenCalledWith("/api/v1/configGroup/getKafkaConfigGroup/1693", {
      kafkaVersionCode: 3903006,
    });
    spy.mockRestore();
  });

  it("get_kafka_config: POST getKafkaConfigGroupDetailList/{no} + 본문 kafkaVersionCode", async () => {
    // getKafkaConfig 경로는 존재하지 않았다 — §3-B와 같은 계열(관용적 op명 추정).
    expect(isRequired(server, "ncloud_cdss_get_kafka_config", "kafkaVersionCode")).toBe(true);

    const spy = vi.spyOn(client, "postRequest").mockResolvedValue({ code: 0 });
    await getToolHandler(server, "ncloud_cdss_get_kafka_config")(
      { configGroupNo: "1693", kafkaVersionCode: 3903006 },
      {} as any
    );

    expect(spy).toHaveBeenCalledWith("/api/v1/configGroup/getKafkaConfigGroupDetailList/1693", {
      kafkaVersionCode: 3903006,
    });
    spy.mockRestore();
  });

  it("apply_config_group: POST setClusterKafkaConfigGroup/{no} + kafkaVersionCode·serviceGroupInstanceNo", async () => {
    // applyConfigGroup 경로는 존재하지 않고, kafkaVersionCode도 필수인데 빠져 있었다.
    expect(isRequired(server, "ncloud_cdss_apply_config_group", "kafkaVersionCode")).toBe(true);

    const spy = vi.spyOn(client, "postRequest").mockResolvedValue({ code: 0 });
    await getToolHandler(server, "ncloud_cdss_apply_config_group")(
      { configGroupNo: "1693", kafkaVersionCode: 3903006, serviceGroupInstanceNo: 100912345 },
      {} as any
    );

    expect(spy).toHaveBeenCalledWith("/api/v1/configGroup/setClusterKafkaConfigGroup/1693", {
      kafkaVersionCode: 3903006,
      serviceGroupInstanceNo: 100912345,
    });
    spy.mockRestore();
  });

  it("change_kafka_config: POST setKafkaConfigGroupDetail/{no}, 타입 지정 필드 + additional 배열", async () => {
    const shape = getTool(server, "ncloud_cdss_change_kafka_config").inputSchema.shape;
    // 임의 키-값 맵(kafkaConfig)이 아니라 타입 지정 필드다.
    expect(shape).not.toHaveProperty("kafkaConfig");
    expect(shape).toHaveProperty("numPartitions");
    expect(isRequired(server, "ncloud_cdss_change_kafka_config", "kafkaVersionCode")).toBe(true);

    const spy = vi.spyOn(client, "postRequest").mockResolvedValue({ code: 0 });
    await getToolHandler(server, "ncloud_cdss_change_kafka_config")(
      {
        configGroupNo: "1693",
        kafkaVersionCode: 3903006,
        numPartitions: 3,
        logRetentionHours: 168,
        additionalSettings: [{ configName: "compression.type", customValue: "gzip" }],
      },
      {} as any
    );

    const [path, body] = spy.mock.calls[0];
    // PUT changeKafkaConfig 가 아니라 POST setKafkaConfigGroupDetail 이다.
    expect(path).toBe("/api/v1/configGroup/setKafkaConfigGroupDetail/1693");
    expect(body).toEqual({
      kafkaVersionCode: 3903006,
      numPartitions: 3,
      logRetentionHours: 168,
      // 입력 이름(additionalSettings)이 아니라 API 필드명으로 나간다.
      additionalKafkaConfigGroupDetailList: [{ configName: "compression.type", customValue: "gzip" }],
    });
    // 경로 세그먼트인 configGroupNo 는 본문에 들어가지 않는다.
    expect(body).not.toHaveProperty("configGroupNo");
    spy.mockRestore();
  });

  it("change_kafka_config: 전체 교체 사실을 성공 응답에 남긴다 (5차 T-5)", async () => {
    // description이 "보낸 것만 적용된다"고 주장했으나 실측은 전체 교체였다.
    // 성공 응답만 보고 나머지 설정이 유지됐다고 오해하는 것을 막는다.
    const spy = vi.spyOn(client, "postRequest").mockResolvedValue({ code: 0, message: "SUCCESS" });
    const result = await getToolHandler(server, "ncloud_cdss_change_kafka_config")(
      { configGroupNo: "1695", kafkaVersionCode: 3903006, numPartitions: 6 },
      {} as any
    );

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe(0);
    expect(parsed.note_replacement).toBeDefined();
    // 보내지 않은 항목에 대한 경고는 붙지 않는다.
    expect(parsed.warning_authorizerClassName).toBeUndefined();
    expect(parsed.warning_additionalSettings).toBeUndefined();
    spy.mockRestore();
  });

  it("change_kafka_config: 조용히 버려지는 값에 경고를 붙인다 (5차 T-6d·T-7)", async () => {
    const spy = vi.spyOn(client, "postRequest").mockResolvedValue({ code: 0, message: "SUCCESS" });
    const result = await getToolHandler(server, "ncloud_cdss_change_kafka_config")(
      {
        configGroupNo: "1695",
        kafkaVersionCode: 3903006,
        authorizerClassName: "x.y.Z",
        additionalSettings: [{ configName: "compression.type", configValue: "gzip" }],
      },
      {} as any
    );

    const parsed = JSON.parse(result.content[0].text);
    // 서버는 SUCCESS를 주고 값을 버린다 — 응답에 그 사실이 남아야 한다.
    expect(parsed.warning_authorizerClassName).toContain("modifyYn");
    expect(parsed.warning_additionalSettings).toBeDefined();

    // additionalSettings 항목의 값 필드명은 configValue다(읽기 응답 셰이프와 일치).
    const [, body] = spy.mock.calls[0];
    expect((body as any).additionalKafkaConfigGroupDetailList).toEqual([
      { configName: "compression.type", configValue: "gzip" },
    ]);
    spy.mockRestore();
  });

  it("get_config_group_clusters (신규): POST getConfigGroupUsingClusterList/{no}", async () => {
    const spy = vi.spyOn(client, "postRequest").mockResolvedValue({ code: 0 });
    await getToolHandler(server, "ncloud_cdss_get_config_group_clusters")(
      { configGroupNo: "1693", pageNo: 1, pageSize: 10 },
      {} as any
    );

    expect(spy).toHaveBeenCalledWith("/api/v1/configGroup/getConfigGroupUsingClusterList/1693", {
      pageNo: 1,
      pageSize: 10,
    });
    spy.mockRestore();
  });

  it("set_config_group_description (신규): POST setKafkaConfigGroupMemo/{no} + kafkaVersionCode 필수", async () => {
    expect(isRequired(server, "ncloud_cdss_set_config_group_description", "kafkaVersionCode")).toBe(true);

    const spy = vi.spyOn(client, "postRequest").mockResolvedValue({ code: 0 });
    await getToolHandler(server, "ncloud_cdss_set_config_group_description")(
      { configGroupNo: "1693", kafkaVersionCode: 3903006, description: "" },
      {} as any
    );

    // 빈 문자열은 "설명 지우기"라 그대로 전송돼야 한다 — falsy 검사로 떨어뜨리면 안 된다.
    expect(spy).toHaveBeenCalledWith("/api/v1/configGroup/setKafkaConfigGroupMemo/1693", {
      kafkaVersionCode: 3903006,
      description: "",
    });
    spy.mockRestore();
  });

  it("create_config_group: kafkaVersionCode 타입이 계열과 일치한다(number)", async () => {
    const spy = vi.spyOn(client, "postRequest").mockResolvedValue({ code: 0 });
    await getToolHandler(server, "ncloud_cdss_create_config_group")(
      { configGroupName: "v1130-cfg", kafkaVersionCode: 3903006 },
      {} as any
    );
    expect(spy).toHaveBeenCalledWith("/api/v1/configGroup/createConfigGroup", {
      configGroupName: "v1130-cfg",
      kafkaVersionCode: 3903006,
    });
    spy.mockRestore();
  });

  it("delete_config_group 게이트 경고가 사용 중 클러스터 확인을 안내한다 (4차 T-4)", async () => {
    // 안내가 description에만 있으면 삭제를 시도한 순간에는 전달되지 않는다.
    const spy = vi.spyOn(client, "deleteRequest");
    const result = await getToolHandler(server, "ncloud_cdss_delete_config_group")(
      { configGroupNo: "1693" },
      {} as any
    );

    // confirm 없이는 핸들러가 실행되지 않는다.
    expect(spy).not.toHaveBeenCalled();
    const text = result.content[0].text;
    expect(text).toContain("ncloud_cdss_get_config_group_clusters");
    expect(text).toContain("1693");
    expect(text).toContain("confirm=true");
    spy.mockRestore();
  });

  it("Config Group 계열 9개 op가 모두 도구로 존재한다", () => {
    for (const name of [
      "ncloud_cdss_create_config_group",          // createConfigGroup
      "ncloud_cdss_list_config_groups",           // getKafkaVersionConfigGroupList
      "ncloud_cdss_get_config_group_clusters",    // getConfigGroupUsingClusterList
      "ncloud_cdss_get_config_group_detail",      // getKafkaConfigGroup
      "ncloud_cdss_get_kafka_config",             // getKafkaConfigGroupDetailList
      "ncloud_cdss_set_config_group_description", // setKafkaConfigGroupMemo
      "ncloud_cdss_apply_config_group",           // setClusterKafkaConfigGroup
      "ncloud_cdss_change_kafka_config",          // setKafkaConfigGroupDetail
      "ncloud_cdss_delete_config_group",          // deleteConfigGroup
    ]) {
      expect(() => getTool(server, name), name).not.toThrow();
    }
  });

  it("configGroup 경로에 존재하지 않는 op명이 남아 있지 않다", () => {
    // 이 계열은 관용적 이름 추정으로 3건이 틀렸다 — 회귀 방지용 스윕.
    const gone = ["getConfigGroupList", "getConfigGroupDetail", "getKafkaConfig/", "applyConfigGroup", "changeKafkaConfig"];
    const paths: string[] = [];
    const spy = vi.spyOn(client, "postRequest").mockImplementation(async (p: string) => { paths.push(p); return {}; });
    const raw = vi.spyOn(client, "requestRaw").mockImplementation(async (_m: string, p: string) => { paths.push(p); return {}; });
    const del = vi.spyOn(client, "deleteRequest").mockImplementation(async (p: string) => { paths.push(p); return {}; });

    // configGroup 계열 도구를 전부 한 번씩 호출해 경로를 수집한다.
    return Promise.all([
      getToolHandler(server, "ncloud_cdss_list_config_groups")({ kafkaVersionCode: 1 }, {} as any),
      getToolHandler(server, "ncloud_cdss_get_config_group_detail")({ configGroupNo: "1", kafkaVersionCode: 1 }, {} as any),
      getToolHandler(server, "ncloud_cdss_get_kafka_config")({ configGroupNo: "1", kafkaVersionCode: 1 }, {} as any),
      getToolHandler(server, "ncloud_cdss_get_config_group_clusters")({ configGroupNo: "1" }, {} as any),
      getToolHandler(server, "ncloud_cdss_set_config_group_description")({ configGroupNo: "1", kafkaVersionCode: 1 }, {} as any),
      getToolHandler(server, "ncloud_cdss_apply_config_group")({ configGroupNo: "1", kafkaVersionCode: 1, serviceGroupInstanceNo: 1 }, {} as any),
      getToolHandler(server, "ncloud_cdss_change_kafka_config")({ configGroupNo: "1", kafkaVersionCode: 1 }, {} as any),
      getToolHandler(server, "ncloud_cdss_create_config_group")({ configGroupName: "a", kafkaVersionCode: 1 }, {} as any),
      getToolHandler(server, "ncloud_cdss_delete_config_group")({ configGroupNo: "1", confirm: true }, {} as any),
    ]).then(() => {
      const joined = paths.join("\n");
      for (const bad of gone) {
        expect(joined, bad).not.toContain(bad);
      }
      expect(paths.length).toBe(9);
      spy.mockRestore();
      raw.mockRestore();
      del.mockRestore();
    });
  });

  it("get_cluster_server_images: 300 실패에 진단·대안을 붙여 던진다 (라이브 §3-A)", async () => {
    // 문서가 명시한 GET 경로인데도 라이브가 300을 준다 — 원인 불명이므로 고치지 않고,
    // 사용자가 자기 입력을 의심하지 않도록 실패 메시지에 진단을 붙인다.
    const spy = vi.spyOn(client, "requestRaw").mockRejectedValue(
      new Error("API 호출 실패\n\n에러 코드: 300\n메시지: Not Found Exception")
    );
    const result = await getToolHandler(server, "ncloud_cdss_get_cluster_server_images")({}, {} as any);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("300");
    expect(result.content[0].text).toMatch(/get_server_generations/);
    spy.mockRestore();
  });

  it("get_cluster_server_images: 300이 아닌 에러는 그대로 통과시킨다", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockRejectedValue(
      new Error("API 호출 실패\n\n에러 코드: 401\n메시지: Unauthorized")
    );
    const result = await getToolHandler(server, "ncloud_cdss_get_cluster_server_images")({}, {} as any);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("401");
    // 관련 없는 진단을 덧붙이지 않는다.
    expect(result.content[0].text).not.toMatch(/get_server_generations/);
    spy.mockRestore();
  });

  it("list_config_groups: POST getKafkaVersionConfigGroupList + 필수 kafkaVersionCode", async () => {
    expect(isRequired(server, "ncloud_cdss_list_config_groups", "kafkaVersionCode")).toBe(true);

    const spy = vi.spyOn(client, "postRequest").mockResolvedValue({ code: 0 });
    await getToolHandler(server, "ncloud_cdss_list_config_groups")(
      { kafkaVersionCode: 3903006, pageNo: 1 },
      {} as any
    );

    expect(spy).toHaveBeenCalledWith("/api/v1/configGroup/getKafkaVersionConfigGroupList", {
      kafkaVersionCode: 3903006,
      pageNo: 1,
    });
    spy.mockRestore();
  });
});

describe("Cloud Hadoop — list_target_subnets 필수 파라미터 (B-7)", () => {
  let server: McpServer;
  let client: NcloudClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient("https://ncloud.apigw.ntruss.com");
    registerCloudHadoopTools(server, client);
  });

  it("vpcNo·cloudHadoopImageProductCode 가 필수이고 zoneCode 는 사라졌다", () => {
    expect(isRequired(server, "ncloud_hadoop_list_target_subnets", "vpcNo")).toBe(true);
    expect(isRequired(server, "ncloud_hadoop_list_target_subnets", "cloudHadoopImageProductCode")).toBe(true);
    // zoneCode 는 이 API 의 파라미터가 아니라 보내도 무시됐다.
    expect(getTool(server, "ncloud_hadoop_list_target_subnets").inputSchema.shape)
      .not.toHaveProperty("zoneCode");
  });

  it("이미지 코드를 그대로 전송한다", async () => {
    const spy = vi.spyOn(client, "request").mockResolvedValue({ subnetList: [] });
    await getToolHandler(server, "ncloud_hadoop_list_target_subnets")(
      { vpcNo: "21538", cloudHadoopImageProductCode: "SW.VCHDP.LNX64.CNTOS.0708.HADOOP.G002" },
      {} as any
    );

    const [action, params] = spy.mock.calls[0];
    expect(action).toBe("/vhadoop/v2/getCloudHadoopTargetSubnetList");
    expect(params).toEqual({
      vpcNo: "21538",
      cloudHadoopImageProductCode: "SW.VCHDP.LNX64.CNTOS.0708.HADOOP.G002",
    });
    spy.mockRestore();
  });
});
