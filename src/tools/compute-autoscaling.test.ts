import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import type { Zone } from "../client/endpoints.js";
import { registerAutoScalingTools } from "./compute-autoscaling.js";

/**
 * Auto Scaling 도구 — 세 존 가이드(compute-vautoscaling-*, 2026-11-21 22개 오퍼레이션 대조)대로 요청이 나가는지.
 * 발단: create_asg 가 vpcNo 없이 subnetNoList 를 보내 `900 Required field … vpcNo` 로 VPC ASG 생성 불가(2026-11-20 리포트).
 */

function setup(zone: Zone = "pub") {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  const client = new NcloudClient({ accessKey: "a", secretKey: "b", baseUrl: "https://ncloud.apigw.ntruss.com", regionCode: "KR" });
  registerAutoScalingTools(server, client, { zone });
  const spy = vi.spyOn(client, "request").mockResolvedValue({ ok: true } as any);
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

const ASG = {
  launchConfigurationNo: "1001",
  autoScalingGroupName: "test-asg",
  vpcNo: "2001",
  subnetNo: "3001",
  accessControlGroupNoList: ["4001"],
  minSize: 1,
  maxSize: 2,
};

describe("ncloud_create_asg", () => {
  it("vpcNo·subnetNo(단일)·accessControlGroupNoList·defaultCoolDown 을 가이드 키로 보낸다", async () => {
    const { spy, call } = setup();
    await call("ncloud_create_asg", {
      ...ASG, desiredCapacity: 1, defaultCoolDown: 300,
      healthCheckTypeCode: "LOADB", healthCheckGracePeriod: 300, targetGroupNoList: ["5001"], serverNamePrefix: "test-as",
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const [path, sent] = spy.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe("/vautoscaling/v2/createAutoScalingGroup");
    expect(sent).toEqual({
      ...ASG, desiredCapacity: 1, defaultCoolDown: 300,
      healthCheckTypeCode: "LOADB", healthCheckGracePeriod: 300, targetGroupNoList: ["5001"], serverNamePrefix: "test-as",
    });
    expect(Object.keys(sent)).not.toContain("subnetNoList");
    expect(Object.keys(sent)).not.toContain("defaultCooldown");
  });

  it("vpcNo 를 생략하면 서브넷 상세에서 채운다 — dryRun 프리뷰도 같은 요청을 보여준다", async () => {
    const { spy, call } = setup();
    spy.mockImplementation(async (path: string) =>
      (path === "/vpc/v2/getSubnetDetail" ? { subnetList: [{ subnetNo: "3001", vpcNo: "2001" }] } : { ok: true }) as any);
    const { vpcNo, ...noVpc } = ASG;

    const preview = JSON.parse((await call("ncloud_create_asg", { ...noVpc, dryRun: true })).content[0].text);
    expect(spy.mock.calls.map((c) => c[0])).toEqual(["/vpc/v2/getSubnetDetail"]);
    expect(spy.mock.calls[0][1]).toEqual({ subnetNo: "3001" });
    expect(preview.requestParams.vpcNo).toBe("2001");
    expect(preview.vpcNoFrom).toContain("3001");

    await call("ncloud_create_asg", noVpc);
    expect(spy).toHaveBeenLastCalledWith("/vautoscaling/v2/createAutoScalingGroup", expect.objectContaining({ vpcNo: "2001", subnetNo: "3001" }));
  });

  it("vpcNo 를 주면 서브넷을 조회하지 않는다", async () => {
    const { spy, call } = setup();
    await call("ncloud_create_asg", ASG);
    expect(spy.mock.calls.map((c) => c[0])).toEqual(["/vautoscaling/v2/createAutoScalingGroup"]);
  });

  it("서브넷을 찾지 못하면 생성 요청 없이 오류", async () => {
    const { spy, call } = setup();
    spy.mockResolvedValue({ subnetList: [] } as any);
    const { vpcNo, ...noVpc } = ASG;
    const res = await call("ncloud_create_asg", noVpc);
    expect(res.isError).toBe(true);
    expect(spy.mock.calls.map((c) => c[0])).not.toContain("/vautoscaling/v2/createAutoScalingGroup");
  });

  it("스키마: subnetNo·ACG 필수, ACG 1~3개, 용량 0~30, serverNamePrefix 3~7자, 이름 규칙", () => {
    const { schema } = setup();
    const s = schema("ncloud_create_asg");
    expect(() => s.parse(ASG)).not.toThrow();
    const { subnetNo, accessControlGroupNoList, ...rest } = ASG;
    expect(() => s.parse({ ...rest, accessControlGroupNoList })).toThrow();
    expect(() => s.parse({ ...rest, subnetNo })).toThrow();
    expect(() => s.parse({ ...ASG, accessControlGroupNoList: [] })).toThrow();
    expect(() => s.parse({ ...ASG, accessControlGroupNoList: ["1", "2", "3", "4"] })).toThrow();
    expect(() => s.parse({ ...ASG, maxSize: 31 })).toThrow();
    expect(() => s.parse({ ...ASG, serverNamePrefix: "ab" })).toThrow();
    expect(() => s.parse({ ...ASG, serverNamePrefix: "abcdefgh" })).toThrow();
    expect(() => s.parse({ ...ASG, autoScalingGroupName: "Test-ASG" })).toThrow();
    expect(() => s.parse({ ...ASG, autoScalingGroupName: "test-" })).toThrow();
    expect(() => s.parse({ ...ASG, healthCheckTypeCode: "ELB" })).toThrow();
    expect(Object.keys(s.shape)).not.toContain("subnetNoList");
  });

  it.each([
    ["minSize > maxSize", { minSize: 3, maxSize: 2 }],
    ["desiredCapacity 범위 밖", { desiredCapacity: 5 }],
    ["LOADB 인데 healthCheckGracePeriod 없음", { healthCheckTypeCode: "LOADB" }],
    ["SVR 인데 targetGroupNoList", { targetGroupNoList: ["5001"] }],
  ])("%s → dryRun 포함 API 호출 없이 오류", async (_label, extra) => {
    const { spy, call } = setup();
    for (const dryRun of [true, false]) {
      const res = await call("ncloud_create_asg", { ...ASG, ...extra, dryRun });
      expect(res.isError).toBe(true);
    }
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("ncloud_update_asg", () => {
  it("minSize·maxSize 필수(가이드 Required), serverNamePrefix·healthCheckTypeCode 전달", async () => {
    const { spy, call, schema } = setup();
    expect(() => schema("ncloud_update_asg").parse({ autoScalingGroupNo: "1", desiredCapacity: 1 })).toThrow();
    await call("ncloud_update_asg", {
      autoScalingGroupNo: "1", minSize: 0, maxSize: 3, serverNamePrefix: "web", healthCheckTypeCode: "LOADB", healthCheckGracePeriod: 120,
    });
    expect(spy).toHaveBeenCalledWith("/vautoscaling/v2/updateAutoScalingGroup", {
      autoScalingGroupNo: "1", minSize: 0, maxSize: 3, serverNamePrefix: "web", healthCheckTypeCode: "LOADB", healthCheckGracePeriod: 120,
    });
  });

  it("LOADB 인데 healthCheckGracePeriod 없으면 오류", async () => {
    const { spy, call } = setup();
    const res = await call("ncloud_update_asg", { autoScalingGroupNo: "1", minSize: 0, maxSize: 1, healthCheckTypeCode: "LOADB" });
    expect(res.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("ncloud_list_asgs", () => {
  it("이름 필터는 autoScalingGroupNameList(배열)로 보낸다", async () => {
    const { spy, call, schema } = setup();
    expect(Object.keys(schema("ncloud_list_asgs").shape)).not.toContain("autoScalingGroupName");
    await call("ncloud_list_asgs", { autoScalingGroupNameList: ["test-asg"] });
    expect(spy).toHaveBeenCalledWith("/vautoscaling/v2/getAutoScalingGroupList", { autoScalingGroupNameList: ["test-asg"] });
  });
});

describe("Scaling Policy", () => {
  it("put_scaling_policy: 쿨다운은 coolDown 키, policyNo·policyName 중 하나 필수", async () => {
    const { spy, call, schema } = setup();
    expect(Object.keys(schema("ncloud_put_scaling_policy").shape)).not.toContain("cooldown");
    const base = { autoScalingGroupNo: "1", adjustmentTypeCode: "CHANG", scalingAdjustment: 1 };
    const res = await call("ncloud_put_scaling_policy", base);
    expect(res.isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();

    await call("ncloud_put_scaling_policy", { ...base, policyName: "scale-out", coolDown: 120 });
    expect(spy).toHaveBeenCalledWith("/vautoscaling/v2/putScalingPolicy", { ...base, policyName: "scale-out", coolDown: 120 });
    await call("ncloud_put_scaling_policy", { ...base, policyNo: "7" });
    expect(spy).toHaveBeenLastCalledWith("/vautoscaling/v2/putScalingPolicy", { ...base, policyNo: "7" });
    expect(() => schema("ncloud_put_scaling_policy").parse({ ...base, adjustmentTypeCode: "FOO", policyNo: "7" })).toThrow();
  });

  it.each([
    ["ncloud_execute_policy", "/vautoscaling/v2/executePolicy", {}],
    ["ncloud_delete_scaling_policy", "/vautoscaling/v2/deleteScalingPolicy", { confirm: true }],
  ])("%s: 식별자는 policyNo", async (tool, path, extra) => {
    const { spy, call, schema } = setup();
    expect(() => schema(tool).parse({ autoScalingGroupNo: "1", policyName: "scale-out" })).toThrow();
    await call(tool, { autoScalingGroupNo: "1", policyNo: "7", ...extra });
    expect(spy).toHaveBeenCalledWith(path, { autoScalingGroupNo: "1", policyNo: "7" });
  });

  it("list_scaling_policies: 가이드에 없는 페이지 파라미터 대신 policyNoList", async () => {
    const { spy, call, schema } = setup();
    expect(Object.keys(schema("ncloud_list_scaling_policies").shape)).not.toContain("pageNo");
    await call("ncloud_list_scaling_policies", { autoScalingGroupNo: "1", policyNoList: ["7"] });
    expect(spy).toHaveBeenCalledWith("/vautoscaling/v2/getAutoScalingPolicyList", { autoScalingGroupNo: "1", policyNoList: ["7"] });
  });
});

describe("Scheduled Action", () => {
  const base = { autoScalingGroupNo: "1", scheduledActionName: "night-scale-in", minSize: 0, maxSize: 1 };

  it("put_scheduled_action: 반복은 recurrence + timeZone 로 보낸다", async () => {
    const { spy, call, schema } = setup();
    expect(Object.keys(schema("ncloud_put_scheduled_action").shape)).not.toContain("recurrenceInKST");
    await call("ncloud_put_scheduled_action", { ...base, recurrence: "0 22 * * *", timeZone: "UTC" });
    expect(spy).toHaveBeenCalledWith("/vautoscaling/v2/putScheduledUpdateGroupAction", { ...base, recurrence: "0 22 * * *", timeZone: "UTC" });
  });

  it("put_scheduled_action: 이름·번호 중 하나, startTime·recurrence 중 하나 필요", async () => {
    const { spy, call } = setup();
    const { scheduledActionName, ...noName } = base;
    expect((await call("ncloud_put_scheduled_action", { ...noName, recurrence: "0 22 * * *" })).isError).toBe(true);
    expect((await call("ncloud_put_scheduled_action", base)).isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    await call("ncloud_put_scheduled_action", { ...noName, scheduledActionNo: "9", startTime: "2026-12-01T09:00:00+0900" });
    expect(spy).toHaveBeenCalledWith("/vautoscaling/v2/putScheduledUpdateGroupAction", { ...noName, scheduledActionNo: "9", startTime: "2026-12-01T09:00:00+0900" });
  });

  it("put_scheduled_action: minSize·maxSize 필수, 시각 형식 검사", () => {
    const { schema } = setup();
    const s = schema("ncloud_put_scheduled_action");
    expect(() => s.parse({ autoScalingGroupNo: "1", scheduledActionName: "a", recurrence: "0 * * * *" })).toThrow();
    expect(() => s.parse({ ...base, startTime: "2026-12-01 09:00" })).toThrow();
    expect(() => s.parse({ ...base, startTime: "2026-12-01T09:00:00Z" })).not.toThrow();
  });

  it.each([
    ["pub", false],
    ["gov", true],
    ["fin", true],
  ] as const)("put_scheduled_action: %s 존 desiredCapacity 필수 여부 = %s", (zone, required) => {
    const { schema } = setup(zone);
    const parse = () => schema("ncloud_put_scheduled_action").parse({ ...base, recurrence: "0 22 * * *" });
    if (required) expect(parse).toThrow();
    else expect(parse).not.toThrow();
  });

  it("delete_scheduled_action: 식별자는 scheduledActionNo", async () => {
    const { spy, call, schema } = setup();
    expect(() => schema("ncloud_delete_scheduled_action").parse({ autoScalingGroupNo: "1", scheduledActionName: "a" })).toThrow();
    await call("ncloud_delete_scheduled_action", { autoScalingGroupNo: "1", scheduledActionNo: "9", confirm: true });
    expect(spy).toHaveBeenCalledWith("/vautoscaling/v2/deleteScheduledAction", { autoScalingGroupNo: "1", scheduledActionNo: "9" });
  });
});

describe("요청 직렬화", () => {
  it("create_asg 배열은 .N 형식 쿼리로 나간다", async () => {
    const server = new McpServer({ name: "test", version: "1.0.0" });
    const client = new NcloudClient({ accessKey: "a", secretKey: "b", baseUrl: "https://ncloud.apigw.ntruss.com", regionCode: "KR" });
    registerAutoScalingTools(server, client);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ createAutoScalingGroupResponse: { returnCode: "0" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const tools = (server as any)._registeredTools;
      const entry = tools instanceof Map ? tools.get("ncloud_create_asg") : tools["ncloud_create_asg"];
      await entry.handler(entry.inputSchema.parse({ ...ASG, accessControlGroupNoList: ["4001", "4002"] }), {} as any);
      const url = new URL(String((fetchMock.mock.calls[0] as any[])[0]));
      expect(url.pathname).toBe("/vautoscaling/v2/createAutoScalingGroup");
      expect(url.searchParams.get("vpcNo")).toBe("2001");
      expect(url.searchParams.get("subnetNo")).toBe("3001");
      expect(url.searchParams.get("accessControlGroupNoList.1")).toBe("4001");
      expect(url.searchParams.get("accessControlGroupNoList.2")).toBe("4002");
      expect(url.searchParams.get("responseFormatType")).toBe("json");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
