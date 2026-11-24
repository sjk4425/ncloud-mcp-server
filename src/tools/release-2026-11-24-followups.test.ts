import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerContainersNksTools, authnBlocker } from "./containers-nks.js";
import { registerComputeInitScriptTools } from "./compute-initscript.js";
import { registerDatabaseCacheTools, cacheVersionHint } from "./database-cache.js";

/**
 * 2026-11-24 릴리스(민간존·금융존) 후속 3건 — 존별 차이는 2026-11-25 세 존 가이드 대조 결과.
 *  - NKS Control Plane 로그 `authn`(nks-createcluster `log.authn`, nks-clusterauditlog `authn`): 민간·금융존만, 공공존은 audit 필수.
 *  - createInitScript `initScriptName`: 민간·금융존 3~100자 '_' 허용, 공공존 3~30자.
 *  - createCloudCacheConfigGroup `cloudCacheVersion`: 금융존 4개 값만.
 */
type Zone = "pub" | "gov" | "fin";

function tools(zone: Zone, register: (s: McpServer, c: NcloudClient) => void) {
  const client = new NcloudClient({ accessKey: "a", secretKey: "s", regionCode: "KR" });
  const raw = vi.spyOn(client, "requestRaw").mockResolvedValue({ uuid: "u" } as any);
  const req = vi.spyOn(client, "request").mockResolvedValue({ initScriptList: [] } as any);
  const server = new McpServer({ name: "t", version: "1" });
  register(server, client);
  const reg = (server as any)._registeredTools;
  const tool = (name: string) => {
    const e = reg instanceof Map ? reg.get(name) : reg[name];
    if (!e) throw new Error(`Tool ${name} not found (${zone})`);
    return {
      e,
      safeParse: (a: any) => e.inputSchema.safeParse(a),
      call: (a: any) => e.handler(e.inputSchema.parse(a), {} as any),
    };
  };
  return { raw, req, tool };
}

const nks = (zone: Zone) => tools(zone, (s, c) => registerContainersNksTools(s, c, { zone, addons: zone !== "fin" }));

describe("NKS set_audit_log: authn", () => {
  it.each(["pub", "fin"] as const)("%s: authn 만 보내면 authn 만 전송(audit 미입력=현재 설정 유지)", async (zone) => {
    const { raw, tool } = nks(zone);
    await tool("ncloud_nks_set_audit_log").call({ clusterUuid: "c1", authn: true });
    expect(raw).toHaveBeenCalledWith("PATCH", expect.stringMatching(/\/clusters\/c1\/log$/), undefined, { authn: true });
  });

  it("pub: audit·authn 둘 다 없으면 호출 전에 거부", async () => {
    const { raw, tool } = nks("pub");
    const r = await tool("ncloud_nks_set_audit_log").call({ clusterUuid: "c1" });
    expect(r.isError).toBe(true);
    expect(raw).not.toHaveBeenCalled();
  });

  it("gov: audit 필수, authn 은 스키마에 없다", async () => {
    const { raw, tool } = nks("gov");
    const t = tool("ncloud_nks_set_audit_log");
    expect(Object.keys(t.e.inputSchema.shape)).not.toContain("authn");
    expect(t.safeParse({ clusterUuid: "c1" }).success).toBe(false);
    await t.call({ clusterUuid: "c1", audit: true, authn: true });
    expect(raw).toHaveBeenCalledWith("PATCH", expect.any(String), undefined, { audit: true });
  });
});

describe("NKS create_cluster: log.authn", () => {
  it("authnBlocker: CONFIG_MAP 또는 1.26 미만이면 사유, 그 외 null", () => {
    expect(authnBlocker("CONFIG_MAP", "1.30.1-nks.1")).toMatch(/CONFIG_MAP/);
    expect(authnBlocker(undefined, "1.25.9-nks.1")).toMatch(/1\.25/);
    expect(authnBlocker("API", "1.26.0-nks.1")).toBeNull();
    expect(authnBlocker(undefined, "1.35.3-nks.2")).toBeNull();
    expect(authnBlocker(undefined, undefined)).toBeNull();
  });

  it("pub: log.authn 스키마 존재, gov: 제거(zod 가 키를 버림)", () => {
    const shape = (zone: Zone) => nks(zone).tool("ncloud_nks_create_cluster").e.inputSchema.shape.log.unwrap().shape;
    expect(Object.keys(shape("pub"))).toContain("authn");
    expect(Object.keys(shape("fin"))).toContain("authn");
    expect(Object.keys(shape("gov"))).not.toContain("authn");
  });

  it("pub: authType=CONFIG_MAP + log.authn=true 는 API 호출 전에 거부", async () => {
    const { raw, tool } = nks("pub");
    const r = await tool("ncloud_nks_create_cluster").call({
      name: "c", clusterType: "SVR.VNKS.STAND.C004.M016.G003", loginKeyName: "k", k8sVersion: "1.35.3-nks.2",
      hypervisorCode: "KVM", zoneCode: "KR-1", regionCode: "KR", vpcNo: 1, subnetNoList: [2], lbPrivateSubnetNo: 3, lbPublicSubnetNo: 4,
      authType: "CONFIG_MAP", log: { authn: true },
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("authn");
    expect(raw).not.toHaveBeenCalled();
  });
});

describe("createInitScript initScriptName", () => {
  const init = (zone: Zone) => tools(zone, (s, c) => registerComputeInitScriptTools(s, c, { zone })).tool("ncloud_create_init_script");
  const base = { initScriptContent: "echo hi" };

  it.each(["pub", "fin"] as const)("%s: '_' 허용, 3~100자", (zone) => {
    const t = init(zone);
    expect(t.safeParse({ ...base, initScriptName: "my_init-script_01" }).success).toBe(true);
    expect(t.safeParse({ ...base, initScriptName: "a".repeat(100) }).success).toBe(true);
    expect(t.safeParse({ ...base, initScriptName: "a".repeat(101) }).success).toBe(false);
    expect(t.safeParse({ ...base, initScriptName: "ab" }).success).toBe(false);
    expect(t.safeParse({ ...base, initScriptName: "has space" }).success).toBe(false);
  });

  it("gov: '_' 불가, 3~30자, 영문자 시작·영숫자 끝", () => {
    const t = init("gov");
    expect(t.safeParse({ ...base, initScriptName: "my-script1" }).success).toBe(true);
    expect(t.safeParse({ ...base, initScriptName: "my_script" }).success).toBe(false);
    expect(t.safeParse({ ...base, initScriptName: "a".repeat(31) }).success).toBe(false);
    expect(t.safeParse({ ...base, initScriptName: "1script" }).success).toBe(false);
    expect(t.safeParse({ ...base, initScriptName: "script-" }).success).toBe(false);
  });

  it("이름 생략은 허용(자동 생성)", () => {
    expect(init("pub").safeParse(base).success).toBe(true);
  });
});

describe("Cache cloudCacheVersion 안내", () => {
  it("금융존: 4개 값만 안내하고 8.1.6 예시를 쓰지 않는다", () => {
    const h = cacheVersionHint("fin");
    expect(h.allowed).toContain("8.1.11-cluster");
    expect(h.example).not.toContain("8.1.6");
    const t = tools("fin", (s, c) => registerDatabaseCacheTools(s, c, { zone: "fin" })).tool("ncloud_create_cache_config_group");
    expect(t.e.description).toContain("Financial zone allows only");
    expect(t.e.inputSchema.shape.cloudCacheVersion.description).not.toContain("8.1.6");
  });

  it("공공존: simple 전용 안내, 예시에 -cluster 없음", () => {
    const h = cacheVersionHint("gov");
    expect(h.allowed).toMatch(/simple/);
    expect(h.example).not.toContain("cluster");
  });
});
