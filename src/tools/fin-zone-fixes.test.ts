import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerComputeServerTools } from "./compute-server.js";
import { registerNetworkInterfaceTools } from "./network-interface.js";
import { registerNetworkAclTools } from "./network-acl.js";
import { registerRouteTableTools } from "./network-route-table.js";
import { registerNatGatewayTools } from "./network-nat-gateway.js";
import { registerDatabaseMysqlTools, kstDateTime } from "./database-mysql.js";
import { registerDatabaseMongodbTools } from "./database-mongodb.js";
import { registerDatabasePostgresqlTools } from "./database-postgresql.js";
import { registerDatabaseMssqlTools } from "./database-mssql.js";
import { registerCloudHadoopTools } from "./analytics-hadoop.js";
import { registerGlobalDnsTools } from "./network-global-dns.js";
import { registerContainersRegistryTools } from "./containers-registry.js";
import { registerContainersNksTools } from "./containers-nks.js";
import { registerSearchEngineServiceTools } from "./analytics-ses.js";
import { registerCloudDataStreamingTools } from "./analytics-cdss.js";

/**
 * 금융존 테스트(2026-10-27) E-02·E-04·E-05·E-09·E-10·E-11·S-03 회귀 — 요청 파라미터가 API 가이드(세 존 동일)대로 나가는지.
 */

function setup(register: (server: McpServer, client: NcloudClient) => void) {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  const client = new NcloudClient({ accessKey: "a", secretKey: "b", baseUrl: "https://ncloud.apigw.ntruss.com", regionCode: "KR" });
  register(server, client);
  const spy = vi.spyOn(client, "request").mockResolvedValue({ ok: true });
  const entryOf = (name: string) => {
    const tools = (server as any)._registeredTools;
    const entry = tools instanceof Map ? tools.get(name) : tools[name];
    if (!entry) throw new Error(`Tool ${name} not found`);
    return entry;
  };
  // SDK 와 동일하게 inputSchema 파싱(기본값 적용) 후 호출한다.
  const call = (name: string, args: any) => {
    const entry = entryOf(name);
    return entry.handler(entry.inputSchema.parse(args), {} as any);
  };
  const schema = (name: string) => entryOf(name).inputSchema;
  return { spy, call, schema };
}

describe("E-02 ncloud_get_flow_log_config", () => {
  it("networkInterfaceNoList(필수) 를 그대로 보낸다", async () => {
    const { spy, call, schema } = setup(registerNetworkInterfaceTools);
    expect(() => schema("ncloud_get_flow_log_config").parse({})).toThrow();
    await call("ncloud_get_flow_log_config", { networkInterfaceNoList: ["7001"] });
    expect(spy).toHaveBeenCalledWith("/vserver/v2/getFlowLogConfigurationList", { networkInterfaceNoList: ["7001"] });
  });
});

describe("E-04 NACL 규칙 설명", () => {
  it.each(["ncloud_add_network_acl_inbound", "ncloud_add_network_acl_outbound"])("%s: networkAclRuleDescription 키로 보낸다", async (tool) => {
    const { spy, call } = setup(registerNetworkAclTools);
    await call(tool, { networkAclNo: "1", priority: 10, protocolTypeCode: "TCP", ruleActionCode: "ALLOW", ipBlock: "10.0.0.0/16", portRange: "22", ruleDescription: "mcp test" });
    const sent = spy.mock.calls[0][1] as Record<string, unknown>;
    expect(sent["networkAclRuleList.1.networkAclRuleDescription"]).toBe("mcp test");
    expect(Object.keys(sent)).not.toContain("networkAclRuleList.1.ruleDescription");
  });
});

describe("E-05 get_server_detail 태그 조회 제거 (모든 존)", () => {
  const DETAIL = { serverInstanceList: [{ serverInstanceNo: "1" }] };

  it("getInstanceTagList 를 호출하지 않고 relatedErrors 도 남기지 않는다", async () => {
    const { spy, call } = setup(registerComputeServerTools);
    spy.mockImplementation(async (path: string) => (path.endsWith("getServerInstanceDetail") ? DETAIL : { blockStorageInstanceList: [] }) as any);
    const res = await call("ncloud_get_server_detail", { serverInstanceNo: "1" });
    expect(spy.mock.calls.map((c) => c[0])).not.toContain("/vserver/v2/getInstanceTagList");
    const out = JSON.parse(res.content[0].text);
    expect(out.relatedErrors).toBeUndefined();
    expect(out.tags).toBeUndefined();
  });
});

describe("E-09 route targetName", () => {
  const base = { routeTableNo: "5001", vpcNo: "1", destinationCidrBlock: "0.0.0.0/0", targetTypeCode: "NATGW", targetNo: "6001" };

  it("remove_route: targetName 필수이며 routeList.1.targetName 으로 보낸다", async () => {
    const { spy, call, schema } = setup(registerRouteTableTools);
    expect(() => schema("ncloud_remove_route").parse({ ...base, confirm: true })).toThrow();
    await call("ncloud_remove_route", { ...base, targetName: "natgw-1", confirm: true });
    expect((spy.mock.calls[0][1] as any)["routeList.1.targetName"]).toBe("natgw-1");
  });

  it("add_route: targetName 필수", async () => {
    const { spy, call, schema } = setup(registerRouteTableTools);
    expect(() => schema("ncloud_add_route").parse(base)).toThrow();
    await call("ncloud_add_route", { ...base, targetName: "natgw-1" });
    expect((spy.mock.calls[0][1] as any)["routeList.1.targetName"]).toBe("natgw-1");
  });
});

describe("S-03 create_nat_gateway dryRun", () => {
  it("dryRun=true 면 API 를 호출하지 않는다", async () => {
    const { spy, call } = setup(registerNatGatewayTools);
    const res = await call("ncloud_create_nat_gateway", { vpcNo: "1", zoneCode: "FKR-1", dryRun: true });
    expect(spy).not.toHaveBeenCalled();
    expect(res.content[0].text).toContain("createNatGatewayInstance");
  });
});

describe("E-10 MySQL 조회 필수 파라미터", () => {
  it("list_mysql_databases/users: pageNo=0, pageSize=20 기본값", async () => {
    const { spy, call } = setup(registerDatabaseMysqlTools);
    await call("ncloud_list_mysql_databases", { cloudMysqlInstanceNo: "1" });
    await call("ncloud_list_mysql_users", { cloudMysqlInstanceNo: "1" });
    expect(spy).toHaveBeenCalledTimes(2);
    for (const c of spy.mock.calls) expect(c[1]).toMatchObject({ cloudMysqlInstanceNo: "1", pageNo: 0, pageSize: 20 });
  });

  it("list_mysql_events: 날짜 생략 시 최근 7일(yyyy-MM-dd HH:mm:ss), 잘못된 형식은 거부", async () => {
    const { spy, call, schema } = setup(registerDatabaseMysqlTools);
    await call("ncloud_list_mysql_events", { cloudMysqlInstanceNo: "1" });
    const sent = spy.mock.calls[0][1] as any;
    expect(sent.startDate).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(sent.endDate).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(sent.startDate < sent.endDate).toBe(true);
    expect(() => schema("ncloud_list_mysql_events").parse({ cloudMysqlInstanceNo: "1", startDate: "2026-10-01" })).toThrow();
  });

  it("kstDateTime 은 UTC+9 로 포맷한다", () => {
    expect(kstDateTime(Date.UTC(2026, 9, 27, 15, 30, 0))).toBe("2026-10-28 00:30:00");
  });

  it("list_mysql_logs: logType 필수", async () => {
    const { spy, call, schema } = setup(registerDatabaseMysqlTools);
    expect(() => schema("ncloud_list_mysql_logs").parse({ cloudMysqlServerInstanceNo: "1" })).toThrow();
    await call("ncloud_list_mysql_logs", { cloudMysqlServerInstanceNo: "1", logType: "ERROR" });
    expect(spy.mock.calls[0][1]).toMatchObject({ logType: "ERROR" });
  });

  it("get_mysql_target_subnets: vpcNo + cloudMysqlImageProductCode", async () => {
    const { spy, call, schema } = setup(registerDatabaseMysqlTools);
    expect(() => schema("ncloud_get_mysql_target_subnets").parse({ cloudMysqlInstanceNo: "1" })).toThrow();
    await call("ncloud_get_mysql_target_subnets", { vpcNo: "3001", cloudMysqlImageProductCode: "SW.VMYSL" });
    expect(spy.mock.calls[0][1]).toEqual({ vpcNo: "3001", cloudMysqlImageProductCode: "SW.VMYSL" });
  });

  it("change_mysql_spec: changeCloudMysqlServerSpec 래퍼를 벗긴다", async () => {
    const { spy, call } = setup(registerDatabaseMysqlTools);
    spy.mockResolvedValue({ changeCloudMysqlServerSpec: { returnCode: "0", cloudMysqlInstanceList: [] } } as any);
    const res = await call("ncloud_change_mysql_spec", { cloudMysqlInstanceNo: "1", cloudMysqlProductCode: "P" });
    expect(JSON.parse(res.content[0].text)).toEqual({ returnCode: "0", cloudMysqlInstanceList: [] });
  });

  it("hadoop_list_mysql_instances: cloudHadoopInstanceNo 필수", () => {
    const { schema } = setup(registerCloudHadoopTools);
    expect(() => schema("ncloud_hadoop_list_mysql_instances").parse({})).toThrow();
  });
});

describe("E-11 delete_mysql_users / 형제 DB", () => {
  it("MySQL: cloudMysqlUserList.N.name + hostIp", async () => {
    const { spy, call } = setup(registerDatabaseMysqlTools);
    await call("ncloud_delete_mysql_users", { cloudMysqlInstanceNo: "1", cloudMysqlUserList: [{ name: "mcpuser1", hostIp: "%" }], confirm: true });
    expect(spy).toHaveBeenCalledWith("/vmysql/v2/deleteCloudMysqlUserList", {
      cloudMysqlInstanceNo: "1", "cloudMysqlUserList.1.name": "mcpuser1", "cloudMysqlUserList.1.hostIp": "%",
    });
  });

  it("MongoDB: cloudMongoDbUserList.N.userName + databaseName", async () => {
    const { spy, call } = setup(registerDatabaseMongodbTools);
    await call("ncloud_delete_mongodb_users", { cloudMongoDbInstanceNo: "1", cloudMongoDbUserList: [{ userName: "u1", databaseName: "admin" }], confirm: true });
    expect(spy).toHaveBeenCalledWith("/vmongodb/v2/deleteCloudMongoDbUserList", {
      cloudMongoDbInstanceNo: "1", "cloudMongoDbUserList.1.userName": "u1", "cloudMongoDbUserList.1.databaseName": "admin",
    });
  });

  it("PostgreSQL 로그 목록: logType=POSTGRESQL_LOG 고정", async () => {
    const { spy, call } = setup(registerDatabasePostgresqlTools);
    await call("ncloud_list_postgresql_logs", { cloudPostgresqlServerInstanceNo: "1" });
    expect(spy.mock.calls[0][1]).toMatchObject({ logType: "POSTGRESQL_LOG" });
  });
});

describe("E-12·E-13 PostgreSQL", () => {
  it("add_postgresql_databases: owner 필수", async () => {
    const { spy, call, schema } = setup(registerDatabasePostgresqlTools);
    expect(() => schema("ncloud_add_postgresql_databases").parse({ cloudPostgresqlInstanceNo: "1", cloudPostgresqlDatabaseList: [{ name: "db1" }] })).toThrow();
    await call("ncloud_add_postgresql_databases", { cloudPostgresqlInstanceNo: "1", cloudPostgresqlDatabaseList: [{ name: "db1", owner: "admin" }] });
    expect(spy.mock.calls[0][1]).toMatchObject({ "cloudPostgresqlDatabaseList.1.name": "db1", "cloudPostgresqlDatabaseList.1.owner": "admin" });
  });

  it("add_postgresql_users: clientCidr 필수·isReplicationRole 기본 false, 0.0.0.0/0 경고", async () => {
    const { spy, call } = setup(registerDatabasePostgresqlTools);
    const res = await call("ncloud_add_postgresql_users", {
      cloudPostgresqlInstanceNo: "1", cloudPostgresqlUserList: [{ name: "mcpuser1", password: "x", clientCidr: "0.0.0.0/0" }],
    });
    expect(spy.mock.calls[0][1]).toMatchObject({ "cloudPostgresqlUserList.1.clientCidr": "0.0.0.0/0", "cloudPostgresqlUserList.1.isReplicationRole": false });
    expect(res.content[0].text).toContain("0.0.0.0/0");
  });

  it("change_postgresql_users: password·clientCidr·isReplicationRole 중 하나 이상", async () => {
    const { spy, call, schema } = setup(registerDatabasePostgresqlTools);
    expect(() => schema("ncloud_change_postgresql_users").parse({ cloudPostgresqlInstanceNo: "1", cloudPostgresqlUserList: [{ name: "u" }] })).toThrow();
    await call("ncloud_change_postgresql_users", { cloudPostgresqlInstanceNo: "1", cloudPostgresqlUserList: [{ name: "u", clientCidr: "10.0.0.0/16" }] });
    expect(spy.mock.calls[0][1]).toEqual({ cloudPostgresqlInstanceNo: "1", "cloudPostgresqlUserList.1.name": "u", "cloudPostgresqlUserList.1.clientCidr": "10.0.0.0/16" });
  });

  it("export_postgresql_log: logType 은 POSTGRESQL_LOG 만", () => {
    const { schema } = setup(registerDatabasePostgresqlTools);
    const base = { cloudPostgresqlServerInstanceNo: "1", fileName: "f", bucketName: "b" };
    expect(schema("ncloud_export_postgresql_log").parse(base).logType).toBe("POSTGRESQL_LOG");
    expect(() => schema("ncloud_export_postgresql_log").parse({ ...base, logType: "ERROR" })).toThrow();
  });
});

describe("E-14 MSSQL", () => {
  it("list_mssql_buckets: cloudMssqlInstanceNo + cloudMssqlServerName", async () => {
    const { spy, call, schema } = setup(registerDatabaseMssqlTools);
    expect(() => schema("ncloud_list_mssql_buckets").parse({ cloudMssqlInstanceNo: "1" })).toThrow();
    await call("ncloud_list_mssql_buckets", { cloudMssqlInstanceNo: "1", cloudMssqlServerName: "m-1-001" });
    expect(spy.mock.calls[0][1]).toEqual({ cloudMssqlInstanceNo: "1", cloudMssqlServerName: "m-1-001" });
  });

  it("create_mssql_instance: isAutomaticBackup=false 인데 backupTime 이 없으면 dryRun 도 API 호출 전에 막는다 (가이드 Conditional)", async () => {
    const { spy, call } = setup(registerDatabaseMssqlTools);
    const base = { cloudMssqlServiceName: "test-fin-mssql", vpcNo: "1", subnetNo: "2", cloudMssqlUserName: "admin1", cloudMssqlUserPassword: "Fake-Pass-1234!", isHa: false };
    for (const dryRun of [true, false]) {
      const result = await call("ncloud_create_mssql_instance", { ...base, isAutomaticBackup: false, dryRun });
      expect(result.isError).toBe(true);
    }
    expect(spy).not.toHaveBeenCalled();
    const ok = await call("ncloud_create_mssql_instance", { ...base, isAutomaticBackup: false, backupTime: "01:15", dryRun: true });
    expect(ok.isError).toBeFalsy();
  });

  it("list_mssql_log_backup_files: databaseName + backupSetId 필수", () => {
    const { schema } = setup(registerDatabaseMssqlTools);
    expect(() => schema("ncloud_list_mssql_log_backup_files").parse({ cloudMssqlInstanceNo: "1", databaseName: "master" })).toThrow();
    expect(() => schema("ncloud_list_mssql_log_backup_files").parse({ cloudMssqlInstanceNo: "1", databaseName: "master", backupSetId: "1" })).not.toThrow();
  });

  it("export_mssql_log: cloudMssqlObjectNameList.N 로 보낸다", async () => {
    const { spy, call } = setup(registerDatabaseMssqlTools);
    await call("ncloud_export_mssql_log", { cloudMssqlInstanceNo: "1", cloudMssqlServerInstanceNo: "2", bucketName: "b", cloudMssqlObjectNameList: ["ERRORLOG"] });
    expect(spy).toHaveBeenCalledWith("/vmssql/v2/exportDbServerLogsToObjectStorage", {
      cloudMssqlInstanceNo: "1", cloudMssqlServerInstanceNo: "2", bucketName: "b", cloudMssqlObjectNameList: ["ERRORLOG"],
    });
  });
});

describe("E-15·E-16·S-04 MongoDB", () => {
  it("add/change_mongodb_users: userName 키, change 는 password·authority 선택", async () => {
    const { spy, call, schema } = setup(registerDatabaseMongodbTools);
    expect(() => schema("ncloud_add_mongodb_users").parse({ cloudMongoDbInstanceNo: "1", cloudMongoDbUserList: [{ userName: "u1", password: "p", databaseName: "admin", authority: "DB_ADMIN" }] })).toThrow();
    await call("ncloud_add_mongodb_users", { cloudMongoDbInstanceNo: "1", cloudMongoDbUserList: [{ userName: "u1", password: "p", databaseName: "admin", authority: "READ_WRITE" }] });
    await call("ncloud_change_mongodb_users", { cloudMongoDbInstanceNo: "1", cloudMongoDbUserList: [{ userName: "u1", databaseName: "admin", authority: "READ" }] });
    expect(spy.mock.calls[0][1]).toMatchObject({ "cloudMongoDbUserList.1.userName": "u1", "cloudMongoDbUserList.1.authority": "READ_WRITE" });
    expect(spy.mock.calls[1][1]).toEqual({
      cloudMongoDbInstanceNo: "1", "cloudMongoDbUserList.1.userName": "u1", "cloudMongoDbUserList.1.databaseName": "admin", "cloudMongoDbUserList.1.authority": "READ",
    });
  });

  it("list_mongodb_buckets: cloudMongoDbInstanceNo 필수 (가이드는 Optional 이지만 민간·금융존 API 가 거절)", () => {
    const { schema } = setup(registerDatabaseMongodbTools);
    expect(() => schema("ncloud_list_mongodb_buckets").parse({})).toThrow();
  });

  it("export_mongodb_backup/log: 가이드 파라미터로 보낸다", async () => {
    const { spy, call } = setup(registerDatabaseMongodbTools);
    await call("ncloud_export_mongodb_backup", { cloudMongoDbInstanceNo: "1", objectName: "o", bucketName: "b" });
    await call("ncloud_export_mongodb_log", { cloudMongoDbServerInstanceNo: "2", fileName: "f", bucketName: "b" });
    expect(spy.mock.calls[0][1]).toEqual({ cloudMongoDbInstanceNo: "1", objectName: "o", bucketName: "b" });
    expect(spy.mock.calls[1][1]).toEqual({ cloudMongoDbServerInstanceNo: "2", logType: "log", fileName: "f", bucketName: "b" });
  });

  it.each([
    ["ncloud_change_mongodb_secondary_count", { memberServerCount: 3, arbiterServerCount: 0 }],
    ["ncloud_change_mongodb_mongos_count", { mongosServerCount: 3 }],
    ["ncloud_change_mongodb_config_count", { configServerCount: 5 }],
    ["ncloud_change_mongodb_shard_count", { shardCount: 4 }],
  ])("%s: dryRun 이면 API 를 호출하지 않는다", async (tool, counts) => {
    const { spy, call } = setup(registerDatabaseMongodbTools);
    const res = await call(tool, { cloudMongoDbInstanceNo: "1", ...counts, dryRun: true });
    expect(spy).not.toHaveBeenCalled();
    expect(JSON.parse(res.content[0].text).requestParams).toMatchObject({ cloudMongoDbInstanceNo: "1", ...counts });
  });
});

describe("E-18·E-19 Global DNS", () => {
  const setupRaw = () => {
    const server = new McpServer({ name: "test", version: "1.0.0" });
    const client = new NcloudClient({ accessKey: "a", secretKey: "b", baseUrl: "https://globaldns.apigw.ntruss.com", regionCode: "KR" });
    registerGlobalDnsTools(server, client);
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ success: true });
    const call = (name: string, args: any) => {
      const entry = (server as any)._registeredTools[name] ?? (server as any)._registeredTools.get?.(name);
      return entry.handler(entry.inputSchema.parse(args), {} as any);
    };
    return { spy, call };
  };

  it("dns_delete_records: 본문은 레코드 ID 배열 그 자체", async () => {
    const { spy, call } = setupRaw();
    await call("ncloud_dns_delete_records", { domainId: 1001, recordIds: [2001, 2002], confirm: true });
    expect(spy).toHaveBeenCalledWith("DELETE", "/dns/v1/ncpdns/record/1001", undefined, [2001, 2002]);
  });

  it("dns_apply_domain: PUT /record/apply/{domainId}", async () => {
    const { spy, call } = setupRaw();
    await call("ncloud_dns_apply_domain", { domainId: 1001 });
    expect(spy).toHaveBeenCalledWith("PUT", "/dns/v1/ncpdns/record/apply/1001");
  });

  it("dns_rollback_domain: PUT /record/rollback/{domainId}", async () => {
    const { spy, call } = setupRaw();
    await call("ncloud_dns_rollback_domain", { domainId: 1001, confirm: true });
    expect(spy).toHaveBeenCalledWith("PUT", "/dns/v1/ncpdns/record/rollback/1001");
  });

  it("dns_list_lb_records: GET /lb-record/{platformType}/{recordType}", async () => {
    const { spy, call } = setupRaw();
    await call("ncloud_dns_list_lb_records", {});
    expect(spy).toHaveBeenCalledWith("GET", "/dns/v1/ncpdns/lb-record/VPC/A", undefined);
  });

  it("dns_create_domain: comments 키로 보내고 생성된 domainId 를 붙인다", async () => {
    const { spy, call } = setupRaw();
    spy.mockImplementation(async (method: string) =>
      (method === "GET" ? { content: [{ id: 1001, name: "a.com" }] } : { success: true }) as any);
    const res = await call("ncloud_dns_create_domain", { name: "a.com", comments: "mcp" });
    expect(spy.mock.calls[0]).toEqual(["POST", "/dns/v1/ncpdns/domain", undefined, { name: "a.com", comments: "mcp" }]);
    expect(JSON.parse(res.content[0].text)).toMatchObject({ success: true, domainId: 1001 });
  });
});

describe("S-02 NCR storageType 존 분기", () => {
  const schemaOf = (zone: "pub" | "fin") => {
    const { schema } = setup((s, c) => registerContainersRegistryTools(s, c, { zone }));
    return schema("ncloud_ncr_create_registry");
  };

  it("금융존은 ncloudStorage 를 받지 않는다", () => {
    expect(() => schemaOf("fin").parse({ registryName: "r", storageType: "ncloudStorage" })).toThrow();
    expect(() => schemaOf("fin").parse({ registryName: "r", storageType: "objectStorage", bucket: "b" })).not.toThrow();
  });

  it("민간존은 그대로 ncloudStorage 를 받는다", () => {
    expect(() => schemaOf("pub").parse({ registryName: "r", storageType: "ncloudStorage" })).not.toThrow();
  });
});

describe("E-17 list_network_interfaces 필터", () => {
  const LIST = { totalRows: 2, networkInterfaceList: [{ networkInterfaceNo: "1", subnetNo: "4001" }, { networkInterfaceNo: "2", subnetNo: "4002" }] };

  it("subnetNo 는 API 로 보내지 않고 결과에서 거른다", async () => {
    const { spy, call } = setup(registerNetworkInterfaceTools);
    spy.mockResolvedValue(LIST as any);
    const res = await call("ncloud_list_network_interfaces", { subnetNo: "4001" });
    expect(spy.mock.calls[0][1]).not.toHaveProperty("subnetNo");
    const out = JSON.parse(res.content[0].text);
    expect(out.networkInterfaceList.map((n: any) => n.networkInterfaceNo)).toEqual(["1"]);
  });

  it("subnetName·instanceNo 는 API 필터로 그대로 보낸다", async () => {
    const { spy, call } = setup(registerNetworkInterfaceTools);
    await call("ncloud_list_network_interfaces", { subnetName: "sub", instanceNo: "9" });
    expect(spy.mock.calls[0][1]).toEqual({ subnetName: "sub", instanceNo: "9" });
  });
});

/** REST 계열(NKS·SES·CDSS) — 지정한 클라이언트 메서드를 가로채고 SDK 처럼 스키마 파싱 후 호출한다. */
function setupRest(
  register: (server: McpServer, client: NcloudClient) => void,
  method: "requestRaw" | "postRequest"
) {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  const client = new NcloudClient({ accessKey: "a", secretKey: "b", baseUrl: "https://example.apigw.ntruss.com", regionCode: "KR" });
  register(server, client);
  const spy = vi.spyOn(client, method).mockResolvedValue({ code: 0 });
  const entryOf = (name: string) => {
    const tools = (server as any)._registeredTools;
    return tools instanceof Map ? tools.get(name) : tools[name];
  };
  const call = (name: string, args: any) => {
    const entry = entryOf(name);
    return entry.handler(entry.inputSchema.parse(args), {} as any);
  };
  return { spy, call, entryOf };
}

describe("E-20·E-21 NKS XEN 노드풀", () => {
  const XEN_IMAGE = "SW.VSVR.OS.LNX64.UBNTU.SVR2004.WRKND.B050";
  const base = {
    name: "test-fin-nks", clusterType: "SVR.VNKS.STAND.C002.M008.NET.HDD.B050.G001", loginKeyName: "k", regionCode: "FKR",
    vpcNo: 1, subnetNoList: [2], lbPublicSubnetNo: 3, lbPrivateSubnetNo: 4, zoneCode: "FKR-1",
  };

  it("create_cluster: XEN 이미지 값(파이프 없음)을 거부하지 않는다", async () => {
    const { spy, call } = setupRest((s, c) => registerContainersNksTools(s, c, { zone: "fin", addons: false }), "requestRaw");
    const r = await call("ncloud_nks_create_cluster", { ...base, nodePool: [{ name: "np", nodeCount: 1, softwareCode: XEN_IMAGE, productCode: "SVR.VSVR.STAND.C002.M004.NET.SSD.B050.G002" }] });
    expect(r.isError).toBeFalsy();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("create_cluster: KVM(G3)에서는 파이프 검사를 유지한다", async () => {
    const { spy, call } = setupRest((s, c) => registerContainersNksTools(s, c, { zone: "pub" }), "requestRaw");
    const r = await call("ncloud_nks_create_cluster", { ...base, clusterType: "SVR.VNKS.STAND.C004.M016.G003", hypervisorCode: "KVM", nodePool: [{ name: "np", softwareCode: "SW.VSVR.OS.LNX64.UBNTU.SVR22.WRKND.G003" }] });
    expect(r.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("create_node_pool: productCode·subnetNoList 를 본문으로 보낸다", async () => {
    const { spy, call } = setupRest((s, c) => registerContainersNksTools(s, c, { zone: "fin", addons: false }), "requestRaw");
    await call("ncloud_nks_create_node_pool", { clusterUuid: "u", name: "np", nodeCount: 1, softwareCode: XEN_IMAGE, productCode: "SVR.VSVR.STAND.C002.M004.NET.SSD.B050.G002", subnetNoList: [2] });
    const [, path, , body] = spy.mock.calls[0];
    expect(path).toBe("/nks/v2/clusters/u/node-pool");
    expect(body).toMatchObject({ productCode: "SVR.VSVR.STAND.C002.M004.NET.SSD.B050.G002", subnetNoList: [2], softwareCode: XEN_IMAGE });
  });

  it("create_node_pool: XEN 상품 코드를 serverSpecCode 에 넣으면 호출 전에 productCode 로 안내한다", async () => {
    const { spy, call } = setupRest((s, c) => registerContainersNksTools(s, c, { zone: "fin", addons: false }), "requestRaw");
    const r = await call("ncloud_nks_create_node_pool", { clusterUuid: "u", name: "np", nodeCount: 1, serverSpecCode: "SVR.VSVR.STAND.C002.M004.NET.SSD.B050.G001" });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("productCode");
    expect(spy).not.toHaveBeenCalled();
  });

  it("금융존 create_cluster 스키마에는 addons 가 없고, 민간존에는 있다", () => {
    const fin = setupRest((s, c) => registerContainersNksTools(s, c, { zone: "fin", addons: false }), "requestRaw");
    const pub = setupRest((s, c) => registerContainersNksTools(s, c, { zone: "pub" }), "requestRaw");
    expect(Object.keys(fin.entryOf("ncloud_nks_create_cluster").inputSchema.shape)).not.toContain("addons");
    expect(Object.keys(pub.entryOf("ncloud_nks_create_cluster").inputSchema.shape)).toContain("addons");
  });
});

describe("E-22 Cloud Hadoop 조회 필수 파라미터", () => {
  it("필수 코드가 빠지면 스키마에서 거부한다", () => {
    const { schema } = setup(registerCloudHadoopTools);
    expect(() => schema("ncloud_hadoop_list_cluster_types").parse({})).toThrow();
    expect(() => schema("ncloud_hadoop_list_addons").parse({ cloudHadoopImageProductCode: "x" })).toThrow();
    expect(() => schema("ncloud_hadoop_list_mysql_users").parse({})).toThrow();
    expect(() => schema("ncloud_hadoop_list_objects").parse({})).toThrow();
    expect(() => schema("ncloud_hadoop_list_notebook_products").parse({})).toThrow();
  });

  it("list_mysql_users: 가이드대로 cloudMysqlInstanceNo 만 보낸다 (금융·민간존 실호출 2026-10-30, 클러스터 번호 불필요)", async () => {
    const { spy, call, schema } = setup(registerCloudHadoopTools);
    expect(Object.keys(schema("ncloud_hadoop_list_mysql_users").shape)).not.toContain("cloudHadoopInstanceNo");
    await call("ncloud_hadoop_list_mysql_users", { cloudMysqlInstanceNo: "1" });
    expect(spy).toHaveBeenCalledWith("/vhadoop/v2/getCloudHadoopMysqlUserList", { cloudMysqlInstanceNo: "1" });
  });

  it("list_notebook_components: cloudHadoopNotebookImageProductCode 로 보낸다", async () => {
    const { spy, call } = setup(registerCloudHadoopTools);
    await call("ncloud_hadoop_list_notebook_components", { cloudHadoopNotebookImageProductCode: "NB" });
    expect(spy).toHaveBeenCalledWith("/vhadoop/v2/getCloudHadoopNotebookComponentList", { cloudHadoopNotebookImageProductCode: "NB" });
  });

  it("list_objects: 필터는 prefix/delimiter, directoryName 은 보내지 않는다", async () => {
    const { spy, call } = setup(registerCloudHadoopTools);
    await call("ncloud_hadoop_list_objects", { bucketName: "b", prefix: "test/", delimiter: "/", directoryName: "x" });
    expect(spy).toHaveBeenCalledWith("/vhadoop/v2/getCloudHadoopObjectList", { bucketName: "b", prefix: "test/", delimiter: "/" });
  });

  it("list_products: 노드 유형 필터 infraResourceDetailTypeCode", async () => {
    const { spy, call } = setup(registerCloudHadoopTools);
    await call("ncloud_hadoop_list_products", { cloudHadoopImageProductCode: "IMG", infraResourceDetailTypeCode: "EDGND" });
    expect(spy.mock.calls[0][1]).toMatchObject({ infraResourceDetailTypeCode: "EDGND" });
  });
});

describe("S-08 Cloud Hadoop 생성 검증·노트북 dryRun", () => {
  it("create_notebook dryRun 은 API 를 호출하지 않는다", async () => {
    const { spy, call } = setup(registerCloudHadoopTools);
    const r = await call("ncloud_hadoop_create_notebook", {
      cloudHadoopNotebookName: "nb-1", cloudHadoopNotebookComponent: "c", cloudHadoopInstanceNo: "1",
      bucketName: "b", notebookNodeSubnetNo: "2", loginKeyName: "k", dryRun: true,
    });
    expect(spy).not.toHaveBeenCalled();
    expect(JSON.parse(r.content[0].text).endpoint).toBe("/vhadoop/v2/createCloudHadoopNotebookInstance");
  });

  it("create_cluster: 이름·비밀번호·노드 수·스토리지 범위를 스키마에서 검사한다", () => {
    const { schema } = setup(registerCloudHadoopTools);
    const ok = {
      cloudHadoopClusterName: "test-hdp", cloudHadoopClusterTypeCode: "T", vpcNo: "1", cloudHadoopAdminUserName: "admin",
      cloudHadoopAdminUserPassword: "Passw0rd!", bucketName: "b", edgeNodeSubnetNo: "1", masterNodeSubnetNo: "1",
      masterNodeDataStorageTypeCode: "SSD", masterNodeDataStorageSize: 100, workerNodeSubnetNo: "2",
      workerNodeDataStorageTypeCode: "SSD", workerNodeDataStorageSize: 4000, loginKeyName: "k",
    };
    const s = schema("ncloud_hadoop_create_cluster");
    expect(() => s.parse(ok)).not.toThrow();
    expect(() => s.parse({ ...ok, cloudHadoopClusterName: "Bad_Name" })).toThrow();
    expect(() => s.parse({ ...ok, cloudHadoopAdminUserPassword: "abc" })).toThrow();
    expect(() => s.parse({ ...ok, workerNodeCount: 9 })).toThrow();
    expect(() => s.parse({ ...ok, masterNodeDataStorageSize: 105 })).toThrow();
  });
});

describe("S-07 SES G2 생성 입력 검증", () => {
  const ok = {
    clusterName: "test-ses", searchEngineVersionCode: "1", searchEngineDashboardPort: "5601", searchEngineUserName: "admin",
    searchEngineUserPassword: "Passw0rd!", softwareProductCode: "SW", vpcNo: 1, managerNodeSubnetNo: 1, managerNodeProductCode: "P",
    dataNodeSubnetNo: 1, dataNodeCount: 3, dataNodeProductCode: "P", dataNodeStorageSize: 100, loginKeyName: "k",
  };

  it.each([
    ["clusterName", "Bad_Name--X"],
    ["searchEngineDashboardPort", "9200"],
    ["searchEngineUserPassword", "abc"],
    ["searchEngineUserPassword", "has space1!"],
    ["dataNodeCount", 1],
    ["dataNodeStorageSize", 55],
  ])("%s=%s 는 dryRun 전에 스키마에서 거부된다", (field, value) => {
    const { entryOf } = setupRest(registerSearchEngineServiceTools, "requestRaw");
    const s = entryOf("ncloud_ses_create_cluster").inputSchema;
    expect(() => s.parse(ok)).not.toThrow();
    expect(() => s.parse({ ...ok, [field]: value })).toThrow();
  });

  it("isMasterOnlyNodeActivated=true 인데 master 값이 없으면 거부한다", async () => {
    const { spy, call } = setupRest(registerSearchEngineServiceTools, "requestRaw");
    const r = await call("ncloud_ses_create_cluster", { ...ok, isMasterOnlyNodeActivated: true, dryRun: true });
    expect(r.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("S-09 CDSS 과금·비가역 도구 게이트", () => {
  const setupCdss = () => setupRest((s, c) => registerCloudDataStreamingTools(s, c, { zone: "fin" }), "postRequest");

  it.each([
    ["ncloud_cdss_add_nodes", { serviceGroupInstanceNo: "1", newBrokerNodeCount: 2 }],
    ["ncloud_cdss_change_node_spec", { serviceGroupInstanceNo: "1", brokerNodeProductCode: "P" }],
    ["ncloud_cdss_upgrade_version", { serviceGroupInstanceNo: "1", upgradeKafkaVersionCode: 1, upgradeConfigGroupNo: 2 }],
  ])("%s: confirm 없이는 호출하지 않고, dryRun 은 프리뷰, confirm=true 면 호출한다", async (tool, args) => {
    const { spy, call } = setupCdss();
    const warned = await call(tool, args);
    expect(warned.content[0].text).toContain("confirm=true");
    const preview = await call(tool, { ...args, dryRun: true });
    const parsed = JSON.parse(preview.content[0].text);
    expect(parsed.requestParams).toBeDefined();
    expect(parsed.note_confirm).toBeDefined();
    expect(spy).not.toHaveBeenCalled();
    await call(tool, { ...args, confirm: true });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("change_node_spec: 두 코드가 모두 없으면 빈 본문을 보내지 않는다", async () => {
    const { spy, call } = setupCdss();
    const r = await call("ncloud_cdss_change_node_spec", { serviceGroupInstanceNo: "1", confirm: true });
    expect(r.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("create_cluster(G2): 이름·비밀번호·브로커 수·스토리지 규칙을 스키마에서 검사한다", () => {
    const { entryOf } = setupCdss();
    const s = entryOf("ncloud_cdss_create_cluster").inputSchema;
    const ok = {
      clusterName: "test-kafka", kafkaVersionCode: 1, configGroupNo: 830, kafkaManagerUserName: "admin",
      kafkaManagerUserPassword: "Passw0rd!", softwareProductCode: "SW", vpcNo: 1, managerNodeSubnetNo: 1,
      managerNodeProductCode: "P", brokerNodeSubnetNo: 1, brokerNodeCount: 3, brokerNodeProductCode: "P", brokerNodeStorageSize: 100,
    };
    expect(() => s.parse(ok)).not.toThrow();
    for (const [k, v] of [["clusterName", "Bad_Name--X"], ["kafkaManagerUserName", "ab"], ["kafkaManagerUserPassword", "abcde"], ["brokerNodeCount", 2], ["brokerNodeStorageSize", 105]] as const) {
      expect(() => s.parse({ ...ok, [k]: v }), k).toThrow();
    }
  });
});
