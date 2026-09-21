import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerDatabaseServerlessTools } from "./database-serverless.js";

/**
 * Cloud DB Serverless(MySQL) v1 도구 테스트 — 2026-09-17 신규 API, 문서 56 op 전량 대조.
 * 경로(kebab-case, name 식별자, 0-base pageNo, sort 반복), 메서드(PATCH/DELETE+JSON), 202 Operation 힌트·폴링 라우팅,
 * 사전 검증(이름·비밀번호·autoScale 조합·배치 한도), 파괴적 게이트, 403 Sub Account 힌트를 고정한다.
 */
function setup() {
  const server = new McpServer({ name: "t", version: "1" });
  const client = new NcloudClient({ accessKey: "a", secretKey: "b", baseUrl: "https://clouddb-serverless.apigw.ntruss.com", regionCode: "KR" });
  registerDatabaseServerlessTools(server, client);
  const tools = (server as any)._registeredTools;
  const map: Map<string, any> = tools instanceof Map ? tools : new Map(Object.entries(tools));
  return {
    client, map,
    parse: (name: string, args: any) => map.get(name).inputSchema.parse(args),
    call: (name: string, args: any) => map.get(name).handler(map.get(name).inputSchema.parse(args), {} as any),
  };
}
const text = (r: any) => r.content[0].text as string;
const OP = { id: "3fa85f64-5717-4562-b3fc-2c963f66afa6", done: false, metadata: { operationType: "CREATE", resourceType: "clusters" } };
const PW = "Passw0rd!x";

describe("Serverless — 구성·경로", () => {
  it("registers 42 tools (56 documented ops; the 16 Operation endpoints collapse into 2 routed tools), all prefixed ncloud_serverless_", () => {
    const { map } = setup();
    const names = [...map.keys()];
    expect(names).toHaveLength(42);
    expect(names.every((n) => n.startsWith("ncloud_serverless_"))).toBe(true);
  });

  it("list/get use kebab-case paths under /mysql/v1 with 0-based pageNo and repeated sort keys", async () => {
    const { client, call } = setup();
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ clusters: [] });
    await call("ncloud_serverless_list_clusters", { pageNo: 0, pageSize: 50, sort: ["name,asc", "createdDateTime,desc"] });
    expect(spy.mock.calls[0].slice(0, 2)).toEqual(["GET", "/mysql/v1/clusters?pageNo=0&pageSize=50&sort=name%2Casc&sort=createdDateTime%2Cdesc"]);
    await call("ncloud_serverless_list_engine_versions", {});
    expect(spy.mock.calls[1][1]).toBe("/mysql/v1/engine-versions");
    await call("ncloud_serverless_list_imported_backups", {});
    expect(spy.mock.calls[2][1]).toBe("/mysql/v1/imported-backups");
    await call("ncloud_serverless_get_instance", { clusterName: "my-cluster", instanceName: "my-cluster-28f07378" });
    expect(spy.mock.calls[3][1]).toBe("/mysql/v1/clusters/my-cluster/instances/my-cluster-28f07378");
    await call("ncloud_serverless_list_logs", { clusterName: "my-cluster", instanceName: "my-cluster-28f07378", logType: "SLOW_QUERY" });
    expect(spy.mock.calls[4][1]).toBe("/mysql/v1/clusters/my-cluster/instances/my-cluster-28f07378/logs?logType=SLOW_QUERY");
    await call("ncloud_serverless_list_events", { clusterName: "my-cluster", filter: 'eventType = "BACKUP"' });
    expect(spy.mock.calls[5][1]).toBe("/mysql/v1/clusters/my-cluster/events?filter=eventType+%3D+%22BACKUP%22");
    expect(() => setup().parse("ncloud_serverless_list_clusters", { pageNo: -1 })).toThrow();
    expect(() => setup().parse("ncloud_serverless_list_clusters", { sort: ["name"] })).toThrow();
  });

  it("appends a Sub Account hint to a 403 'sub account is not supported yet' failure", async () => {
    const { client, call } = setup();
    vi.spyOn(client, "requestRaw").mockRejectedValue(new Error("API 호출 실패\n\n에러 코드: Forbidden\n메시지: sub account is not supported yet\n\nHTTP 상태: 403"));
    const r = await call("ncloud_serverless_list_clusters", {});
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/Sub Account/);
    expect(text(r)).toMatch(/sub account is not supported yet/);
  });
});

describe("Serverless — 클러스터", () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => { s = setup(); });
  const body = {
    name: "my-cluster", network: { vpcNo: 1, subnetNo: 2, port: 3306 }, multiZone: false, unit: { min: 1, max: 2 },
    initialDatabase: { databaseName: "appdb", adminUserName: "appadmin", adminPassword: PW },
    backupConfig: { retentionDays: 7 }, highAvailability: true, engineVersion: "8.4.5",
  };

  it("create posts the documented body (storageType defaults to CB2) and returns the 202 Operation with a pollWith hint", async () => {
    const spy = vi.spyOn(s.client, "requestRaw").mockResolvedValue(OP);
    const r = await s.call("ncloud_serverless_create_cluster", body);
    expect(spy).toHaveBeenCalledWith("POST", "/mysql/v1/clusters", undefined, { ...body, storageType: "CB2" });
    const t = text(r);
    expect(t).toMatch(/"pollWith"/);
    expect(t).toMatch(/"tool":\s*"ncloud_serverless_get_operation"/);
    expect(t).toMatch(/"resourceType":\s*"clusters"/);
    expect(t).toMatch(new RegExp(OP.id));
    expect(t).not.toMatch(/"clusterName"/);
  });

  it("create dryRun masks the password and does not call; validation rejects bad names/passwords/units", async () => {
    const spy = vi.spyOn(s.client, "requestRaw");
    const r = await s.call("ncloud_serverless_create_cluster", { ...body, dryRun: true });
    expect(spy).not.toHaveBeenCalled();
    expect(text(r)).toMatch(/Dry-Run Preview/);
    expect(text(r)).not.toContain(PW);
    expect(text(r)).toMatch(/unit\.max/);
    expect(() => s.parse("ncloud_serverless_create_cluster", { ...body, name: "-bad" })).toThrow(/clusterName/);
    expect(() => s.parse("ncloud_serverless_create_cluster", { ...body, name: "Ab" })).toThrow();
    expect(() => s.parse("ncloud_serverless_create_cluster", { ...body, initialDatabase: { ...body.initialDatabase, adminPassword: "short" } })).toThrow();
    expect(() => s.parse("ncloud_serverless_create_cluster", { ...body, initialDatabase: { ...body.initialDatabase, adminPassword: "Passw0rd&long" } })).toThrow(/must not contain/);
    expect(() => s.parse("ncloud_serverless_create_cluster", { ...body, initialDatabase: { ...body.initialDatabase, databaseName: "mysql" } })).toThrow(/reserved/);
    expect(() => s.parse("ncloud_serverless_create_cluster", { ...body, unit: { min: 2, max: 1 } })).toThrow(/min must be/);
    expect(() => s.parse("ncloud_serverless_create_cluster", { ...body, unit: { min: 1.25, max: 2 } })).toThrow(/0\.5/);
    expect(() => s.parse("ncloud_serverless_create_cluster", { ...body, backupConfig: { backupAuto: false, retentionDays: 7 } })).toThrow(/backupTime/);
  });

  it("autoScale: thresholds are mutually exclusive and scaleOut.enabled needs a threshold + replica range", () => {
    const ok = { scaleOut: { enabled: true, thresholdCpu: 80, replica: { min: 1, max: 3 } }, scaleUp: { enabled: true } };
    expect(() => s.parse("ncloud_serverless_create_cluster", { ...body, autoScale: ok })).not.toThrow();
    expect(() => s.parse("ncloud_serverless_create_cluster", { ...body, autoScale: { scaleOut: { enabled: true, thresholdCpu: 80, thresholdConnection: 1000, replica: { min: 1, max: 3 } } } })).toThrow(/mutually exclusive/);
    expect(() => s.parse("ncloud_serverless_create_cluster", { ...body, autoScale: { scaleOut: { enabled: true } } })).toThrow(/requires one threshold/);
  });

  it("update PATCHes only the given fields and refuses an empty change; delete is confirm-gated and passes cascading", async () => {
    const spy = vi.spyOn(s.client, "requestRaw").mockResolvedValue({ ...OP, metadata: { operationType: "UPDATE", resourceType: "clusters" } });
    const empty = await s.call("ncloud_serverless_update_cluster", { clusterName: "my-cluster" });
    expect(empty.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    await s.call("ncloud_serverless_update_cluster", { clusterName: "my-cluster", multiZone: true });
    expect(spy).toHaveBeenLastCalledWith("PATCH", "/mysql/v1/clusters/my-cluster", undefined, { multiZone: true });
    const gate = await s.call("ncloud_serverless_delete_cluster", { clusterName: "my-cluster", cascading: true });
    expect(text(gate)).toMatch(/confirm=true/);
    expect(text(gate)).toMatch(/with all users and databases/);
    await s.call("ncloud_serverless_delete_cluster", { clusterName: "my-cluster", cascading: true, confirm: true });
    expect(spy).toHaveBeenLastCalledWith("DELETE", "/mysql/v1/clusters/my-cluster?cascading=true");
    await s.call("ncloud_serverless_delete_cluster", { clusterName: "my-cluster", confirm: true });
    expect(spy).toHaveBeenLastCalledWith("DELETE", "/mysql/v1/clusters/my-cluster");
  });

  it("restore requires originalClusterName for BACKUP and admin credentials for IMPORTED_BACKUP", async () => {
    const spy = vi.spyOn(s.client, "requestRaw").mockResolvedValue(OP);
    const base = { name: "restored", network: body.network, multiZone: false, unit: { min: 1, max: 1 }, backupConfig: { retentionDays: 3 }, highAvailability: false };
    const r1 = await s.call("ncloud_serverless_restore_cluster", { ...base, source: { type: "BACKUP", backupName: "my-cluster-20260721103000" } });
    expect(r1.isError).toBe(true);
    expect(text(r1)).toMatch(/originalClusterName/);
    const r2 = await s.call("ncloud_serverless_restore_cluster", { ...base, source: { type: "IMPORTED_BACKUP", backupName: "imported-1" } });
    expect(text(r2)).toMatch(/adminUserName/);
    expect(spy).not.toHaveBeenCalled();
    await s.call("ncloud_serverless_restore_cluster", { ...base, source: { type: "BACKUP", originalClusterName: "my-cluster", backupName: "my-cluster-20260721103000" } });
    expect(spy).toHaveBeenLastCalledWith("POST", "/mysql/v1/clusters/restore", undefined, { ...base, source: { type: "BACKUP", originalClusterName: "my-cluster", backupName: "my-cluster-20260721103000" } });
  });
});

describe("Serverless — 사용자·DB·프로세스·백업·로그", () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => { s = setup(); });

  it("users: create/update/delete/batch paths, name rules, empty update refused, batch limits", async () => {
    const spy = vi.spyOn(s.client, "requestRaw").mockResolvedValue({ ...OP, metadata: { operationType: "CREATE", resourceType: "users" } });
    const r = await s.call("ncloud_serverless_create_user", { clusterName: "cl1", name: "app_user", password: PW, permission: "CRUD" });
    expect(spy).toHaveBeenLastCalledWith("POST", "/mysql/v1/clusters/cl1/users", undefined, { name: "app_user", password: PW, permission: "CRUD" });
    expect(text(r)).toMatch(/"clusterName":\s*"cl1"/);
    const empty = await s.call("ncloud_serverless_update_user", { clusterName: "cl1", userName: "app_user" });
    expect(empty.isError).toBe(true);
    await s.call("ncloud_serverless_update_user", { clusterName: "cl1", userName: "app_user", permission: "READ" });
    expect(spy).toHaveBeenLastCalledWith("PATCH", "/mysql/v1/clusters/cl1/users/app_user", undefined, { permission: "READ" });
    await s.call("ncloud_serverless_delete_user", { clusterName: "cl1", userName: "app_user", confirm: true });
    expect(spy).toHaveBeenLastCalledWith("DELETE", "/mysql/v1/clusters/cl1/users/app_user");
    await s.call("ncloud_serverless_batch_delete_users", { clusterName: "cl1", names: ["u_one", "u_two"], confirm: true });
    expect(spy).toHaveBeenLastCalledWith("POST", "/mysql/v1/clusters/cl1/users/batch-delete", undefined, { names: ["u_one", "u_two"] });
    expect(() => s.parse("ncloud_serverless_create_user", { clusterName: "cl1", name: "1abc", password: PW, permission: "READ" })).toThrow(/userName/);
    expect(() => s.parse("ncloud_serverless_create_user", { clusterName: "cl1", name: "abc", password: PW, permission: "READ" })).toThrow();
    expect(() => s.parse("ncloud_serverless_batch_create_users", { clusterName: "cl1", users: Array.from({ length: 11 }, (_, i) => ({ name: `user${i}x`, password: PW, permission: "READ" })) })).toThrow();
  });

  it("databases: batch-create wraps names as objects, batch-delete sends names, reserved schema refused", async () => {
    const spy = vi.spyOn(s.client, "requestRaw").mockResolvedValue({ ...OP, metadata: { operationType: "CREATE", resourceType: "databases" } });
    await s.call("ncloud_serverless_batch_create_databases", { clusterName: "cl1", names: ["db1", "db2"] });
    expect(spy).toHaveBeenLastCalledWith("POST", "/mysql/v1/clusters/cl1/databases/batch-create", undefined, { databases: [{ name: "db1" }, { name: "db2" }] });
    await s.call("ncloud_serverless_batch_delete_databases", { clusterName: "cl1", names: ["db1"], confirm: true });
    expect(spy).toHaveBeenLastCalledWith("POST", "/mysql/v1/clusters/cl1/databases/batch-delete", undefined, { names: ["db1"] });
    const gate = await s.call("ncloud_serverless_delete_database", { clusterName: "cl1", databaseName: "db1" });
    expect(text(gate)).toMatch(/drop/);
    expect(() => s.parse("ncloud_serverless_create_database", { clusterName: "cl1", name: "information_schema" })).toThrow(/reserved/);
  });

  it("kill_processes is confirm-gated, limited to 49 sessions, and hints the processes operation path with instanceName", async () => {
    const spy = vi.spyOn(s.client, "requestRaw").mockResolvedValue({ ...OP, metadata: { operationType: "DELETE", resourceType: "processes" } });
    expect(() => s.parse("ncloud_serverless_kill_processes", { clusterName: "cl1", instanceName: "cl1-abc", sessionNos: Array.from({ length: 50 }, (_, i) => i + 1) })).toThrow();
    const gate = await s.call("ncloud_serverless_kill_processes", { clusterName: "cl1", instanceName: "cl1-abc", sessionNos: [11, 12] });
    expect(text(gate)).toMatch(/kill/);
    expect(spy).not.toHaveBeenCalled();
    const r = await s.call("ncloud_serverless_kill_processes", { clusterName: "cl1", instanceName: "cl1-abc", sessionNos: [11, 12], confirm: true });
    expect(spy).toHaveBeenLastCalledWith("POST", "/mysql/v1/clusters/cl1/instances/cl1-abc/processes/batch-kill", undefined, { sessionNos: [11, 12] });
    expect(text(r)).toMatch(/"instanceName":\s*"cl1-abc"/);
  });

  it("backups: export posts bucketName/uploadPath; imported backup create validates objectPath and delete is gated", async () => {
    const spy = vi.spyOn(s.client, "requestRaw").mockResolvedValue({ ...OP, metadata: { operationType: "CREATE", resourceType: "backups" } });
    await s.call("ncloud_serverless_export_backup", { clusterName: "cl1", backupName: "cl1-20260721103000", bucketName: "my-bucket", uploadPath: "backups/2026" });
    expect(spy).toHaveBeenLastCalledWith("POST", "/mysql/v1/clusters/cl1/backups/cl1-20260721103000/export", undefined, { bucketName: "my-bucket", uploadPath: "backups/2026" });
    await s.call("ncloud_serverless_create_imported_backup", { name: "imported-1", bucketName: "my-bucket", objectPath: "exports/backup.tar.gz", engineVersion: "8.4.5" });
    expect(spy).toHaveBeenLastCalledWith("POST", "/mysql/v1/imported-backups", undefined, { name: "imported-1", bucketName: "my-bucket", objectPath: "exports/backup.tar.gz", engineVersion: "8.4.5" });
    expect(() => s.parse("ncloud_serverless_create_imported_backup", { name: "imported-1", bucketName: "b", objectPath: "bad path!", engineVersion: "8.4.5" })).toThrow(/objectPath/);
    const gate = await s.call("ncloud_serverless_delete_imported_backup", { backupName: "imported-1" });
    expect(text(gate)).toMatch(/confirm=true/);
    await s.call("ncloud_serverless_delete_imported_backup", { backupName: "imported-1", confirm: true });
    expect(spy).toHaveBeenLastCalledWith("DELETE", "/mysql/v1/imported-backups/imported-1");
  });

  it("config: update defaults applyWithoutRestart=true, PATCHes parameters, dryRun warns on restart; log config PATCH is synchronous", async () => {
    const spy = vi.spyOn(s.client, "requestRaw").mockResolvedValue({ ...OP, metadata: { operationType: "UPDATE", resourceType: "config" } });
    await s.call("ncloud_serverless_update_config", { clusterName: "cl1", parameters: { max_connections: "500" } });
    expect(spy).toHaveBeenLastCalledWith("PATCH", "/mysql/v1/clusters/cl1/config?applyWithoutRestart=true", undefined, { parameters: { max_connections: "500" } });
    const preview = await s.call("ncloud_serverless_update_config", { clusterName: "cl1", parameters: { innodb_buffer_pool_size: "1G" }, applyWithoutRestart: false, dryRun: true });
    expect(text(preview)).toMatch(/restart/i);
    expect(() => s.parse("ncloud_serverless_update_config", { clusterName: "cl1", parameters: {} })).toThrow(/empty/);
    spy.mockResolvedValue({ logConfig: {} });
    await s.call("ncloud_serverless_update_log_config", { clusterName: "cl1", rotations: { SLOW_QUERY: { rotationType: "SIZE", fileCount: 5, megaBytes: 50 } } });
    expect(spy).toHaveBeenLastCalledWith("PATCH", "/mysql/v1/clusters/cl1/log-config", undefined, { rotations: { SLOW_QUERY: { rotationType: "SIZE", fileCount: 5, megaBytes: 50 } } });
    expect(() => s.parse("ncloud_serverless_update_log_config", { clusterName: "cl1", rotations: { ERROR: { rotationType: "SIZE", fileCount: 5 } } })).toThrow(/megaBytes/);
    expect(() => s.parse("ncloud_serverless_update_log_config", { clusterName: "cl1", rotations: { ERROR: { rotationType: "SIZE", fileCount: 5, megaBytes: 55 } } })).toThrow();
  });

  it("logs: batch-delete refuses BIN before the call; export posts logs + bucket", async () => {
    const spy = vi.spyOn(s.client, "requestRaw").mockResolvedValue({ ...OP, metadata: { operationType: "DELETE", resourceType: "logs" } });
    const bin = await s.call("ncloud_serverless_batch_delete_logs", { clusterName: "cl1", instanceName: "cl1-abc", logs: [{ name: "binlog.000001", logType: "BIN" }], confirm: true });
    expect(bin.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    await s.call("ncloud_serverless_batch_delete_logs", { clusterName: "cl1", instanceName: "cl1-abc", logs: [{ name: "slow-query.log.1", logType: "SLOW_QUERY" }], confirm: true });
    expect(spy).toHaveBeenLastCalledWith("POST", "/mysql/v1/clusters/cl1/instances/cl1-abc/logs/batch-delete", undefined, { logs: [{ name: "slow-query.log.1", logType: "SLOW_QUERY" }] });
    await s.call("ncloud_serverless_export_logs", { clusterName: "cl1", instanceName: "cl1-abc", logs: [{ name: "error.log", logType: "ERROR" }], bucketName: "b" });
    expect(spy).toHaveBeenLastCalledWith("POST", "/mysql/v1/clusters/cl1/instances/cl1-abc/logs/export", undefined, { logs: [{ name: "error.log", logType: "ERROR" }], bucketName: "b" });
  });
});

describe("Serverless — Operation 라우팅", () => {
  let s: ReturnType<typeof setup>;
  beforeEach(() => { s = setup(); });
  const id = OP.id;

  it("routes get_operation by resourceType and demands clusterName/instanceName where the API needs them", async () => {
    const spy = vi.spyOn(s.client, "requestRaw").mockResolvedValue({ ...OP, done: true });
    await s.call("ncloud_serverless_get_operation", { resourceType: "clusters", operationId: id });
    expect(spy).toHaveBeenLastCalledWith("GET", `/mysql/v1/clusters/operations/${id}`);
    await s.call("ncloud_serverless_get_operation", { resourceType: "imported-backups", operationId: id });
    expect(spy).toHaveBeenLastCalledWith("GET", `/mysql/v1/imported-backups/operations/${id}`);
    await s.call("ncloud_serverless_get_operation", { resourceType: "users", operationId: id, clusterName: "cl1" });
    expect(spy).toHaveBeenLastCalledWith("GET", `/mysql/v1/clusters/cl1/users/operations/${id}`);
    await s.call("ncloud_serverless_get_operation", { resourceType: "config", operationId: id, clusterName: "cl1" });
    expect(spy).toHaveBeenLastCalledWith("GET", `/mysql/v1/clusters/cl1/config/operations/${id}`);
    await s.call("ncloud_serverless_get_operation", { resourceType: "logs", operationId: id, clusterName: "cl1", instanceName: "cl1-abc" });
    expect(spy).toHaveBeenLastCalledWith("GET", `/mysql/v1/clusters/cl1/instances/cl1-abc/logs/operations/${id}`);
    const missing = await s.call("ncloud_serverless_get_operation", { resourceType: "backups", operationId: id });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toMatch(/clusterName/);
    const missing2 = await s.call("ncloud_serverless_get_operation", { resourceType: "processes", operationId: id, clusterName: "cl1" });
    expect(text(missing2)).toMatch(/instanceName/);
    expect(() => s.parse("ncloud_serverless_get_operation", { resourceType: "clusters", operationId: "not-a-uuid" })).toThrow(/UUID/);
  });

  it("list_operations adds operationType and paging to the routed path", async () => {
    const spy = vi.spyOn(s.client, "requestRaw").mockResolvedValue({ operations: [] });
    await s.call("ncloud_serverless_list_operations", { resourceType: "clusters", operationType: "DELETE", pageSize: 10 });
    expect(spy).toHaveBeenLastCalledWith("GET", "/mysql/v1/clusters/operations?operationType=DELETE&pageSize=10");
    await s.call("ncloud_serverless_list_operations", { resourceType: "processes", clusterName: "cl1", instanceName: "cl1-abc" });
    expect(spy).toHaveBeenLastCalledWith("GET", "/mysql/v1/clusters/cl1/instances/cl1-abc/processes/operations");
  });
});
