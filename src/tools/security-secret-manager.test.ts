import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerSecretManagerTools, secretPath } from "./security-secret-manager.js";

function setup() {
  const server = new McpServer({ name: "t", version: "1.0.0" });
  const global = new NcloudClient({ accessKey: "k", secretKey: "s", baseUrl: "https://secretmanager.apigw.ntruss.com", regionCode: "KR" });
  const regional = new NcloudClient({ accessKey: "k", secretKey: "s", baseUrl: "https://ocapi-kr.ncloud.com", regionCode: "KR" });
  registerSecretManagerTools(server, { global, regional });
  const tools = (server as any)._registeredTools;
  const entry = (n: string) => (tools instanceof Map ? tools.get(n) : tools[n]);
  const g = vi.spyOn(global, "requestRaw").mockResolvedValue({ ok: "global" });
  const r = vi.spyOn(regional, "requestRaw").mockResolvedValue({ ok: "regional" });
  return {
    g, r,
    names: () => (tools instanceof Map ? [...tools.keys()] : Object.keys(tools)) as string[],
    call: (n: string, a: any) => entry(n).handler(entry(n).inputSchema.parse(a), {} as any),
  };
}
const text = (res: any) => res.content[0].text as string;
/** requestRaw 는 항상 (method, path, query, body) 4-인자로 불린다 — 뒤쪽 undefined 는 무시하고 비교. */
function expectLast(spy: any, ...args: any[]) {
  const last = spy.mock.lastCall as any[];
  expect(last.slice(0, args.length)).toEqual(args);
  expect(last.slice(args.length).every((v: any) => v === undefined)).toBe(true);
}

describe("Secret Manager (secretmanager-*, 민간존 전용)", () => {
  it("32 ops registered under ncloud_secret_*", () => {
    const t = setup();
    expect(t.names().filter((n) => n.startsWith("ncloud_secret_")).length).toBe(32);
  });

  it("global (default) host: paths unprefixed; regional host: /secretmanager prefix (개요 API URL 표)", async () => {
    const t = setup();
    await t.call("ncloud_secret_list_secrets", {});
    expectLast(t.g, "GET", "/api/v1/secrets", undefined);
    expect(t.r).not.toHaveBeenCalled();
    await t.call("ncloud_secret_list_secrets", { pageNo: 2, keyIsolation: "regional" });
    expectLast(t.r, "GET", "/secretmanager/api/v1/secrets", { pageNo: 2 });
    expect(secretPath("regional", "/api/v1/keys")).toBe("/secretmanager/api/v1/keys");
    expect(secretPath("global", "/api/v1/keys")).toBe("/api/v1/keys");
    expect(secretPath(undefined, "/api/v1/keys")).toBe("/api/v1/keys");
  });

  it("lookups: detail / values / stage value / logs / keys / triggers", async () => {
    const t = setup();
    await t.call("ncloud_secret_get_secret", { secretId: "s1" });
    expectLast(t.g, "GET", "/api/v1/secrets/s1");
    await t.call("ncloud_secret_get_secret_value", { secretId: "s1" });
    expectLast(t.g, "GET", "/api/v1/secrets/s1/values");
    await t.call("ncloud_secret_get_secret_stage_value", { secretId: "s1", stage: "pending" });
    expectLast(t.g, "GET", "/api/v1/secrets/s1/pending");
    await t.call("ncloud_secret_get_secret_logs", { secretId: "s1", pageSize: 10, timestampFrom: 1 });
    expectLast(t.g, "GET", "/api/v1/secrets/s1/logs", { pageSize: 10, timestampFrom: 1 });
    await t.call("ncloud_secret_list_protection_keys", { keyIsolation: "regional" });
    expectLast(t.r, "GET", "/secretmanager/api/v1/keys");
    await t.call("ncloud_secret_list_triggers", {});
    expectLast(t.g, "GET", "/api/v1/triggers");
  });

  it("create: body shape per secretmanager-createsecret; conditional fields validated; dryRun redacts the value", async () => {
    const t = setup();
    const bad = await t.call("ncloud_secret_create_secret", { secretName: "app-db", secretValue: '{"pw":"x"}', rotationTargets: ["pw"], autoRotationYN: "Y" });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toContain("triggerId");
    const dry = await t.call("ncloud_secret_create_secret", { secretName: "app-db", secretValue: '{"pw":"x"}', rotationTargets: ["pw"], dryRun: true });
    expect(text(dry)).toContain("redacted");
    expect(text(dry)).not.toContain('"pw":"x"');
    expect(t.g).not.toHaveBeenCalled();
    await t.call("ncloud_secret_create_secret", {
      secretName: "app-db", secretValue: '{"pw":"x"}', rotationTargets: ["pw"], memo: "m",
      autoRotationYN: "Y", autoRotationPeriod: 30, triggerId: "trg", protectionKeyType: "USER_MANAGED_KEY", kmsKeyTag: "tag", kmsBoundaryType: "ISOLATED",
    });
    expectLast(t.g, "POST", "/api/v1/secrets", undefined, {
      secretName: "app-db", secretValue: { value: '{"pw":"x"}', rotationTargets: ["pw"] }, secretType: "BASIC", autoRotationYN: "Y",
      protectionKeyType: "USER_MANAGED_KEY", memo: "m", autoRotationPeriod: 30, triggerId: "trg", kmsKeyTag: "tag", kmsBoundaryType: "ISOLATED",
    });
  });

  it("updates: values (≥1 stage) / stage value / memo / protection key / rotation period / trigger", async () => {
    const t = setup();
    const none = await t.call("ncloud_secret_update_secret_value", { secretId: "s1" });
    expect(none.isError).toBe(true);
    await t.call("ncloud_secret_update_secret_value", { secretId: "s1", active: '{"a":"1"}' });
    expectLast(t.g, "PUT", "/api/v1/secrets/s1/values", undefined, { active: '{"a":"1"}' });
    await t.call("ncloud_secret_update_secret_stage_value", { secretId: "s1", stage: "active", value: '{"a":"2"}' });
    expectLast(t.g, "PUT", "/api/v1/secrets/s1/values/active", undefined, { value: '{"a":"2"}' });
    await t.call("ncloud_secret_update_memo", { secretId: "s1", memo: "d" });
    expectLast(t.g, "PUT", "/api/v1/secrets/s1/memo", undefined, { memo: "d" });
    await t.call("ncloud_secret_update_protection_key", { secretId: "s1", protectionKeyType: "USER_MANAGED_KEY", kmsKeyTag: "tag", kmsBoundaryType: "GLOBAL" });
    expectLast(t.g, "PUT", "/api/v1/secrets/s1/protection-key", undefined, { protectionKeyType: "USER_MANAGED_KEY", kmsKeyTag: "tag", kmsBoundaryType: "GLOBAL" });
    await t.call("ncloud_secret_update_rotation_period", { secretId: "s1", rotationPeriod: 730 });
    expectLast(t.g, "PUT", "/api/v1/secrets/s1/rotation-period", undefined, { rotationPeriod: 730 });
    await t.call("ncloud_secret_update_rotation_trigger", { secretId: "s1", triggerId: "trg" });
    expectLast(t.g, "PUT", "/api/v1/secrets/s1/triggers", undefined, { triggerId: "trg" });
    await t.call("ncloud_secret_enable_auto_rotation", { secretId: "s1", rotationPeriod: 90, triggerId: "trg" });
    expectLast(t.g, "POST", "/api/v1/secrets/s1/enable-auto-rotation", undefined, { rotationPeriod: 90, triggerId: "trg" });
  });

  it("state / rotation-job ops are POST on the documented suffixes", async () => {
    const t = setup();
    const cases: Array<[string, string]> = [
      ["ncloud_secret_enable_secret", "enable"], ["ncloud_secret_cancel_deletion", "cancel-deletion"],
      ["ncloud_secret_disable_auto_rotation", "disable-auto-rotation"], ["ncloud_secret_execute_rotation", "rotation"],
      ["ncloud_secret_retry_rotation", "retry-rotation"], ["ncloud_secret_cancel_rotation", "cancel-rotation"],
    ];
    for (const [tool, suffix] of cases) {
      await t.call(tool, { secretId: "s1" });
      expectLast(t.g, "POST", `/api/v1/secrets/s1/${suffix}`);
    }
  });

  it("confirm gate: delete / request-deletion / disable / rollback / trigger delete do not call the API without confirm", async () => {
    const t = setup();
    for (const tool of ["ncloud_secret_delete_secret", "ncloud_secret_request_deletion", "ncloud_secret_disable_secret", "ncloud_secret_rollback_rotation", "ncloud_secret_delete_rotation_trigger"]) {
      const res = await t.call(tool, { secretId: "s1" });
      expect(text(res)).toContain("⚠️");
      expect(t.g).not.toHaveBeenCalled();
    }
    await t.call("ncloud_secret_delete_secret", { secretId: "s1", confirm: true });
    expectLast(t.g, "DELETE", "/api/v1/secrets/s1");
    await t.call("ncloud_secret_delete_rotation_trigger", { secretId: "s1", confirm: true, keyIsolation: "regional" });
    expectLast(t.r, "DELETE", "/secretmanager/api/v1/secrets/s1/triggers");
    await t.call("ncloud_secret_rollback_rotation", { secretId: "s1", confirm: true });
    expectLast(t.g, "POST", "/api/v1/secrets/s1/rollback-rotation");
  });

  it("rotate process control: /action/v1/secrets/{id}/jobs/{token}/…", async () => {
    const t = setup();
    await t.call("ncloud_secret_job_start", { secretId: "s1", jobToken: "tok" });
    expectLast(t.g, "POST", "/action/v1/secrets/s1/jobs/tok/start");
    await t.call("ncloud_secret_job_add_pending_stage", { secretId: "s1", jobToken: "tok" });
    expectLast(t.g, "POST", "/action/v1/secrets/s1/jobs/tok/pending");
    await t.call("ncloud_secret_job_update_pending_stage", { secretId: "s1", jobToken: "tok", value: '{"a":"b"}' });
    expectLast(t.g, "PUT", "/action/v1/secrets/s1/jobs/tok/pending", undefined, { value: '{"a":"b"}' });
    await t.call("ncloud_secret_job_generate_random_secret", { secretId: "s1", jobToken: "tok", length: 16, excludePunctuation: true });
    expectLast(t.g, "POST", "/action/v1/secrets/s1/jobs/tok/generate-random-secret", undefined, { length: 16, excludePunctuation: true });
    await t.call("ncloud_secret_job_complete", { secretId: "s1", jobToken: "tok", keyIsolation: "regional" });
    expectLast(t.r, "POST", "/secretmanager/action/v1/secrets/s1/jobs/tok/complete");
    await t.call("ncloud_secret_job_fail", { secretId: "s1", jobToken: "tok" });
    expectLast(t.g, "POST", "/action/v1/secrets/s1/jobs/tok/fail");
  });
});
