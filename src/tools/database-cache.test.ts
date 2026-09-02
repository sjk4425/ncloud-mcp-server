import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerDatabaseCacheTools } from "./database-cache.js";

/**
 * MCP-BUG-REPORT_2026-09-01 B-1·B-2·B-3 회귀 테스트.
 *
 * 이 계열 결함은 "입력 필드명 ≠ API 파라미터명"이라 **전송 파라미터명을 검증하지 않으면
 * 잡히지 않는다.** 그래서 여기서는 client.request에 넘어간 객체의 **키 이름**을 직접 본다.
 */

function createMockClient(): NcloudClient {
  return new NcloudClient({
    accessKey: "testAccessKey",
    secretKey: "testSecretKey",
    baseUrl: "https://ncloud.apigw.ntruss.com",
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

/** 등록된 inputSchema에서 해당 필드가 필수(optional 아님)인지 본다. */
function isRequired(server: McpServer, toolName: string, field: string): boolean {
  const shape = getTool(server, toolName).inputSchema.shape;
  const entry = shape[field];
  if (!entry) throw new Error(`Field ${field} not in ${toolName} schema`);
  return !entry.isOptional();
}

const VALID_INSTANCE_INPUT = {
  cloudCacheServiceName: "democache",
  cloudCacheServerNamePrefix: "democache",
  vpcNo: "21538",
  subnetNo: "45007",
  configGroupNo: "9964",
  cloudCacheModeCode: "SIMPLE" as const,
};

describe("Cloud DB for Cache — create_cache_instance (B-1/B-3)", () => {
  let server: McpServer;
  let client: NcloudClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerDatabaseCacheTools(server, client);
  });

  it("config group 번호를 configGroupNo 로 전송한다 (cloudCacheConfigGroupNo 아님)", async () => {
    const spy = vi.spyOn(client, "request").mockResolvedValue({ cloudCacheInstanceList: [] });
    const handler = getToolHandler(server, "ncloud_create_cache_instance");
    await handler(VALID_INSTANCE_INPUT, {} as any);

    // R-1 사전 검증 프로브가 앞에 붙으므로 생성 호출을 이름으로 찾는다.
    const createCall = spy.mock.calls.find((c) => c[0] === "/vcache/v2/createCloudCacheInstance");
    expect(createCall).toBeDefined();
    const params = createCall![1] as Record<string, unknown>;
    expect(params).toHaveProperty("configGroupNo", "9964");
    expect(params).not.toHaveProperty("cloudCacheConfigGroupNo");
    // API 필수값이 모두 실려야 한다.
    expect(params).toHaveProperty("cloudCacheServerNamePrefix");
    expect(params).toHaveProperty("cloudCacheModeCode", "SIMPLE");
    // dryRun 플래그는 API로 새어나가지 않는다.
    expect(params).not.toHaveProperty("dryRun");
    spy.mockRestore();
  });

  it("API 필수값은 스키마에서도 필수다 — optional 표기가 값을 생략하게 만들었다 (B-1)", () => {
    for (const field of [
      "cloudCacheServiceName",
      "cloudCacheServerNamePrefix",
      "vpcNo",
      "subnetNo",
      "configGroupNo",
      "cloudCacheModeCode",
    ]) {
      expect(isRequired(server, "ncloud_create_cache_instance", field), field).toBe(true);
    }
    // 존재하지 않는 API 파라미터는 스키마에서도 사라져야 한다.
    const shape = getTool(server, "ncloud_create_cache_instance").inputSchema.shape;
    expect(shape).not.toHaveProperty("cloudCacheConfigGroupNo");
    expect(shape).not.toHaveProperty("isAutomaticFailover");
  });

  it("dryRun 프리뷰는 전송 파라미터를 그대로 보여준다 (B-8)", async () => {
    const spy = vi.spyOn(client, "request");
    const handler = getToolHandler(server, "ncloud_create_cache_instance");
    const result = await handler({ ...VALID_INSTANCE_INPUT, dryRun: true }, {} as any);

    expect(spy).not.toHaveBeenCalled();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.endpoint).toBe("/vcache/v2/createCloudCacheInstance");
    expect(parsed.requestParams.configGroupNo).toBe("9964");
    expect(parsed.requestParams).not.toHaveProperty("cloudCacheConfigGroupNo");
    spy.mockRestore();
  });

  it("생략한 포트를 6379로 단정하지 않는다 (B-3)", async () => {
    const spy = vi.spyOn(client, "request").mockResolvedValue({ cloudCacheInstanceList: [] });
    const handler = getToolHandler(server, "ncloud_create_cache_instance");
    const result = await handler(VALID_INSTANCE_INPUT, {} as any);

    const createCall = spy.mock.calls.find((c) => c[0] === "/vcache/v2/createCloudCacheInstance");
    const params = createCall![1] as Record<string, unknown>;
    expect(params).not.toHaveProperty("cloudCachePort");
    // 보내지 않은 값을 보고서에 기본값으로 적어넣지 않는다.
    expect(JSON.parse(result.content[0].text)["포트"]).not.toBe(6379);
    spy.mockRestore();
  });

  it("isBackup=true + isAutomaticBackup=false 인데 backupTime이 없으면 호출 전에 막는다", async () => {
    const spy = vi.spyOn(client, "request");
    const handler = getToolHandler(server, "ncloud_create_cache_instance");
    const result = await handler(
      { ...VALID_INSTANCE_INPUT, isBackup: true, isAutomaticBackup: false },
      {} as any
    );

    expect(spy).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("backupTime");
    spy.mockRestore();
  });
});

describe("Cloud DB for Cache — create_cache_config_group (B-2)", () => {
  let server: McpServer;
  let client: NcloudClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerDatabaseCacheTools(server, client);
  });

  it("cloudCacheVersion·configGroupName·configGroupDescription 을 그대로 전송한다", async () => {
    const spy = vi.spyOn(client, "request").mockResolvedValue({ returnCode: "0" });
    const handler = getToolHandler(server, "ncloud_create_cache_config_group");
    await handler(
      {
        configGroupName: "demo-config",
        cloudCacheVersion: "7.2.11-simple",
        configGroupDescription: "demo",
        cloudCacheDbmsCode: "Valkey",
      },
      {} as any
    );

    const [action, params] = spy.mock.calls[0];
    expect(action).toBe("/vcache/v2/createCloudCacheConfigGroup");
    expect(params).toEqual({
      configGroupName: "demo-config",
      cloudCacheVersion: "7.2.11-simple",
      configGroupDescription: "demo",
      cloudCacheDbmsCode: "Valkey",
    });
    // 예전 스키마의 이름들은 더 이상 나가지 않는다.
    expect(params).not.toHaveProperty("cloudCacheConfigGroupName");
    expect(params).not.toHaveProperty("description");
    expect(params).not.toHaveProperty("cloudCacheImageProductCode");
    spy.mockRestore();
  });

  it("cloudCacheVersion 은 스키마 필수다 — 값을 넣을 자리가 아예 없었다 (B-2)", () => {
    expect(isRequired(server, "ncloud_create_cache_config_group", "cloudCacheVersion")).toBe(true);
    expect(isRequired(server, "ncloud_create_cache_config_group", "configGroupName")).toBe(true);

    const shape = getTool(server, "ncloud_create_cache_config_group").inputSchema.shape;
    expect(shape).not.toHaveProperty("cloudCacheConfigGroupName");
    expect(shape).not.toHaveProperty("cloudCacheImageProductCode");
  });
});

/**
 * 라이브 리포트(2026-09-02) §3-C + 후속 #6 파라미터명 전수 감사에서 나온 결함들.
 *
 * §3-C(`delete_cache_config_group`)는 B-1과 **문자 그대로 같은 결함**이었고,
 * 같은 파일을 전량 대조하니 같은 부류가 11건 더 있었다. 그래서 이 describe는
 * 도구 하나가 아니라 **파일 전체의 파라미터 계약**을 고정한다.
 */
describe("Cloud DB for Cache — 파라미터명 전수 감사 (라이브 리포트 §3-C + 후속 #6)", () => {
  let server: McpServer;
  let client: NcloudClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerDatabaseCacheTools(server, client);
  });

  /** 도구를 호출하고 client.request 에 실제로 넘어간 (action, params) 를 돌려준다. */
  async function captureRequest(toolName: string, input: Record<string, unknown>) {
    const spy = vi.spyOn(client, "request").mockResolvedValue({});
    await getToolHandler(server, toolName)(input, {} as any);
    const call = spy.mock.calls[0];
    spy.mockRestore();
    return { action: call[0] as string, params: (call[1] ?? {}) as Record<string, unknown> };
  }

  it("delete_cache_config_group: configGroupNo 로 전송한다 (§3-C — B-1과 동일 결함)", async () => {
    expect(isRequired(server, "ncloud_delete_cache_config_group", "configGroupNo")).toBe(true);
    const shape = getTool(server, "ncloud_delete_cache_config_group").inputSchema.shape;
    expect(shape).not.toHaveProperty("cloudCacheConfigGroupNo");

    const { action, params } = await captureRequest("ncloud_delete_cache_config_group", {
      configGroupNo: "11080",
      confirm: true,
    });
    expect(action).toBe("/vcache/v2/deleteCloudCacheConfigGroup");
    expect(params).toHaveProperty("configGroupNo", "11080");
    expect(params).not.toHaveProperty("cloudCacheConfigGroupNo");
    // confirm 게이트 값이 API로 새어나가지 않는다.
    expect(params).not.toHaveProperty("confirm");
  });

  it("get_cache_target_subnets: vpcNo + cloudCacheImageProductCode 를 받는다 (인스턴스 번호가 아니다)", async () => {
    expect(isRequired(server, "ncloud_get_cache_target_subnets", "vpcNo")).toBe(true);
    expect(isRequired(server, "ncloud_get_cache_target_subnets", "cloudCacheImageProductCode")).toBe(true);
    expect(getTool(server, "ncloud_get_cache_target_subnets").inputSchema.shape)
      .not.toHaveProperty("cloudCacheInstanceNo");

    const { params } = await captureRequest("ncloud_get_cache_target_subnets", {
      vpcNo: "21538",
      cloudCacheImageProductCode: "SW.VRDS.OS.LNX64.ROCKY.0810.VALKY.B050",
    });
    expect(params).toHaveProperty("vpcNo", "21538");
    expect(params).toHaveProperty("cloudCacheImageProductCode");
  });

  it("list_cache_manual_backup_details: 백업 번호가 아니라 인스턴스 번호를 받는다", async () => {
    expect(isRequired(server, "ncloud_list_cache_manual_backup_details", "cloudCacheInstanceNo")).toBe(true);
    expect(getTool(server, "ncloud_list_cache_manual_backup_details").inputSchema.shape)
      .not.toHaveProperty("cloudCacheManualBackupNo");
  });

  it("delete_cache_manual_backup: cloudCacheInstanceNo + fileNameList.N 으로 전송한다", async () => {
    const shape = getTool(server, "ncloud_delete_cache_manual_backup").inputSchema.shape;
    expect(shape).not.toHaveProperty("cloudCacheManualBackupNo");
    expect(isRequired(server, "ncloud_delete_cache_manual_backup", "cloudCacheInstanceNo")).toBe(true);
    expect(isRequired(server, "ncloud_delete_cache_manual_backup", "fileNameList")).toBe(true);

    const { action, params } = await captureRequest("ncloud_delete_cache_manual_backup", {
      cloudCacheInstanceNo: "144909674",
      fileNameList: ["20220315", "20220322"],
      confirm: true,
    });
    expect(action).toBe("/vcache/v2/deleteCloudCacheManualBackup");
    // 배열은 client.serializeListParams 가 fileNameList.1 / .2 로 직렬화한다.
    expect(client.serializeListParams(params as any)).toMatchObject({
      "fileNameList.1": "20220315",
      "fileNameList.2": "20220322",
    });
  });

  it("export_cache_backup: fileName + backupTypeMode 를 보내고 유령 파라미터를 보내지 않는다", async () => {
    for (const f of ["cloudCacheInstanceNo", "fileName", "backupTypeMode", "bucketName"]) {
      expect(isRequired(server, "ncloud_export_cache_backup", f), f).toBe(true);
    }
    const shape = getTool(server, "ncloud_export_cache_backup").inputSchema.shape;
    for (const gone of ["cloudCacheServerInstanceNo", "folderPath", "cloudCacheExportObjectList"]) {
      expect(shape, gone).not.toHaveProperty(gone);
    }

    const { params } = await captureRequest("ncloud_export_cache_backup", {
      cloudCacheInstanceNo: "144909674",
      fileName: "20210315",
      backupTypeMode: "SYSTEM",
      bucketName: "cache-bucket",
    });
    expect(params).toEqual({
      cloudCacheInstanceNo: "144909674",
      fileName: "20210315",
      backupTypeMode: "SYSTEM",
      bucketName: "cache-bucket",
    });
  });

  it("list_cache_buckets: cloudCacheInstanceNo 가 필수다", () => {
    expect(isRequired(server, "ncloud_list_cache_buckets", "cloudCacheInstanceNo")).toBe(true);
  });

  it("유령 파라미터가 스키마에서 제거됐다 (전송돼도 서버가 무시하던 필드들)", () => {
    const gone: Array<[string, string]> = [
      // API가 이름을 받지 않는데 필수로 강제하던 값
      ["ncloud_create_cache_manual_backup", "cloudCacheManualBackupName"],
      // API가 서버 인스턴스 번호를 받지 않는다
      ["ncloud_list_cache_backup_details", "cloudCacheServerInstanceNo"],
      // 두 목록 API는 regionCode만 받는다 — 인스턴스 필터·페이지네이션이 없다
      ["ncloud_list_cache_backups", "cloudCacheInstanceNo"],
      ["ncloud_list_cache_manual_backups", "cloudCacheInstanceNo"],
      ["ncloud_list_cache_manual_backups", "pageNo"],
      ["ncloud_list_cache_manual_backups", "pageSize"],
      // config group 목록은 페이지네이션을 지원하지 않는다
      ["ncloud_list_cache_config_groups", "pageNo"],
      ["ncloud_list_cache_config_groups", "pageSize"],
    ];
    for (const [tool, field] of gone) {
      expect(getTool(server, tool).inputSchema.shape, `${tool}.${field}`).not.toHaveProperty(field);
    }
  });

  it("list_cache_config_groups: 문서화된 실제 필터 7개를 받는다", () => {
    const shape = getTool(server, "ncloud_list_cache_config_groups").inputSchema.shape;
    for (const f of [
      "cloudCacheInstanceNo", "cloudCacheServiceName", "configGroupNo",
      "configGroupName", "cloudCacheImageProductCode", "cloudCacheModeCode", "cloudCacheDbmsCode",
    ]) {
      expect(shape, f).toHaveProperty(f);
    }
  });

  it("list_cache_instances: pageNo만 주면 사전 거부한다 (pageSize 조건부 필수)", async () => {
    const spy = vi.spyOn(client, "request");
    const result = await getToolHandler(server, "ncloud_list_cache_instances")({ pageNo: 0 }, {} as any);

    expect(spy).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("pageSize");
    spy.mockRestore();
  });
});

describe("Cloud DB for Cache — 모드↔config group 정합성 사전 검증 (라이브 리포트 R-1)", () => {
  let server: McpServer;
  let client: NcloudClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerDatabaseCacheTools(server, client);
  });

  it("모드가 어긋나면 생성 호출 없이 거부한다", async () => {
    // configGroupNo + cloudCacheModeCode 조회는 0건, configGroupNo 단독 조회는 1건
    // → 그룹은 존재하지만 모드가 다르다.
    const spy = vi.spyOn(client, "request").mockImplementation(async (action: string, params?: any) => {
      if (action === "/vcache/v2/getCloudCacheConfigGroupList") {
        return params?.cloudCacheModeCode
          ? { cloudCacheConfigGroupList: [] }
          : { cloudCacheConfigGroupList: [{ configGroupNo: "9964", cloudCacheVersion: "7.2.11-simple" }] };
      }
      return { cloudCacheInstanceList: [] };
    });

    const result = await getToolHandler(server, "ncloud_create_cache_instance")(
      { ...VALID_INSTANCE_INPUT, cloudCacheModeCode: "CLUSTER" },
      {} as any
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("7.2.11-simple");
    // 생성 API는 호출되지 않았다.
    expect(spy.mock.calls.some((c) => c[0] === "/vcache/v2/createCloudCacheInstance")).toBe(false);
    spy.mockRestore();
  });

  it("모드가 일치하면 그대로 생성한다", async () => {
    const spy = vi.spyOn(client, "request").mockImplementation(async (action: string) => {
      if (action === "/vcache/v2/getCloudCacheConfigGroupList") {
        return { cloudCacheConfigGroupList: [{ configGroupNo: "9964", cloudCacheVersion: "7.2.11-simple" }] };
      }
      return { cloudCacheInstanceList: [] };
    });

    const result = await getToolHandler(server, "ncloud_create_cache_instance")(VALID_INSTANCE_INPUT, {} as any);

    expect(result.isError).toBeUndefined();
    expect(spy.mock.calls.some((c) => c[0] === "/vcache/v2/createCloudCacheInstance")).toBe(true);
    spy.mockRestore();
  });

  it("사전 검증이 실패하면 생성을 막지 않는다 — 진단이 정상 호출을 깨서는 안 된다", async () => {
    const spy = vi.spyOn(client, "request").mockImplementation(async (action: string) => {
      if (action === "/vcache/v2/getCloudCacheConfigGroupList") throw new Error("probe blew up");
      return { cloudCacheInstanceList: [] };
    });

    const result = await getToolHandler(server, "ncloud_create_cache_instance")(VALID_INSTANCE_INPUT, {} as any);

    expect(result.isError).toBeUndefined();
    expect(spy.mock.calls.some((c) => c[0] === "/vcache/v2/createCloudCacheInstance")).toBe(true);
    spy.mockRestore();
  });

  it("dryRun 은 사전 검증 프로브도 호출하지 않는다", async () => {
    const spy = vi.spyOn(client, "request");
    await getToolHandler(server, "ncloud_create_cache_instance")(
      { ...VALID_INSTANCE_INPUT, dryRun: true },
      {} as any
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
