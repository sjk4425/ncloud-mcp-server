import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerCloudFunctionsTools } from "./compute-functions.js";

/**
 * mcp-test-report-20260915 F-01·F-03·F-06·F-08 회귀 테스트.
 *
 * F-01의 결함은 "경로가 v2.0(`/api/v2`)이고 본문이 어느 버전과도 다르다"였다. 그래서 여기서는
 * client.requestRaw에 넘어간 **경로·쿼리·본문 키 이름**을 직접 본다.
 */

function createMockClient(): NcloudClient {
  return new NcloudClient({
    accessKey: "testAccessKey",
    secretKey: "testSecretKey",
    baseUrl: "https://cloudfunctions.apigw.ntruss.com",
    regionCode: "KR",
  });
}

/**
 * SDK가 하는 것처럼 inputSchema로 파싱한 뒤 핸들러를 부른다 — 이 파일의 도구들은 zod
 * `.default()`(platform=vpc, type=basic, limits 등)에 의존하므로 raw 인자를 직접 넘기면
 * 실제 런타임과 다른 경로를 타게 된다.
 */
function getToolHandler(server: McpServer, toolName: string): any {
  const tools = (server as any)._registeredTools;
  const entry = tools instanceof Map ? tools.get(toolName) : tools[toolName];
  if (!entry) throw new Error(`Tool ${toolName} not found`);
  return (args: any, extra: any) => entry.handler(entry.inputSchema.parse(args), extra);
}

const text = (r: any) => r.content[0].text as string;

describe("Cloud Functions — API v2.1 경로 (F-01)", () => {
  let server: McpServer;
  let client: NcloudClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerCloudFunctionsTools(server, client);
  });

  it("소스 어디에도 v2.0 경로(`/api/v2` without `/ncf`)가 남아 있지 않다", () => {
    const src = readFileSync(fileURLToPath(new URL("./compute-functions.ts", import.meta.url)), "utf8");
    const v20 = src.match(/(?<!\/ncf)\/api\/v2\//g) ?? [];
    // 주석에서 v2.0 경로를 언급하는 곳(설계 배경 설명) 한 군데만 허용한다.
    expect(v20.length).toBeLessThanOrEqual(1);
    expect(src).toContain('const CF = "/ncf/api/v2"');
  });

  it("읽기 도구 전부 /ncf/api/v2 접두 경로로 호출한다", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ content: {} });
    const calls: Array<[string, any]> = [
      ["ncloud_functions_list_packages", {}],
      ["ncloud_functions_get_package", { packageName: "p" }],
      ["ncloud_functions_list_actions", { packageName: "p" }],
      ["ncloud_functions_get_action", { packageName: "p", actionName: "a" }],
      ["ncloud_functions_list_triggers", {}],
      ["ncloud_functions_get_trigger", { triggerName: "t" }],
      ["ncloud_functions_get_action_activations", { packageName: "p", actionName: "a" }],
      ["ncloud_functions_get_action_activation_detail", { packageName: "p", actionName: "a", activationId: "x" }],
      ["ncloud_functions_get_trigger_activations", { triggerName: "t" }],
      ["ncloud_functions_get_trigger_activation_detail", { triggerName: "t", activationId: "x" }],
      ["ncloud_functions_get_activations", {}],
    ];
    for (const [name, args] of calls) {
      await getToolHandler(server, name)(args, {} as any);
    }
    expect(spy).toHaveBeenCalledTimes(calls.length);
    for (const c of spy.mock.calls) {
      expect(c[0]).toBe("GET");
      expect(String(c[1])).toMatch(/^\/ncf\/api\/v2\//);
      expect(c[2]).toMatchObject({ platform: "vpc" });
    }
    spy.mockRestore();
  });

  it("activations 조회의 start/end는 밀리초 타임스탬프(정수)를 문자열로 실어 보낸다", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ content: { activations: [], totalCount: 0 } });
    await getToolHandler(server, "ncloud_functions_get_activations")({ start: 1757900000000, end: 1757990000000, pageNo: 2, pageSize: 50 }, {} as any);
    expect(spy).toHaveBeenCalledWith("GET", "/ncf/api/v2/activations", {
      platform: "vpc", pageNo: "2", pageSize: "50", start: "1757900000000", end: "1757990000000",
    });
    spy.mockRestore();
  });

  it("invoke_action은 POST /ncf/api/v2/packages/{p}/actions/{a}?platform&timeout 에 런타임 파라미터를 본문으로 보낸다", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ content: { activationId: "x" } });
    await getToolHandler(server, "ncloud_functions_invoke_action")({ packageName: "ksj-package", actionName: "server_on", params: { serverNo: "1" } }, {} as any);
    expect(spy).toHaveBeenCalledWith("POST", "/ncf/api/v2/packages/ksj-package/actions/server_on", { platform: "vpc", timeout: "60000" }, { serverNo: "1" });
    spy.mockRestore();
  });
});

describe("Cloud Functions — create_action 본문 계약 (F-01, F-08)", () => {
  let server: McpServer;
  let client: NcloudClient;
  const BASIC = {
    packageName: "ksj-package", actionName: "ksj-repo-start",
    exec_kind: "python:3.13", exec_code: "def main(args):\n    return {'ok': True}", exec_main: "main",
    vpc_no: 21538, subnet_no: 45007,
  };

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerCloudFunctionsTools(server, client);
  });

  it("basic/vpc: type 쿼리 + limits 기본값 + exec.binary + vpc 배열 형태로 PUT 한다", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ content: { name: "ksj-repo-start", type: "basic" } });
    const res = await getToolHandler(server, "ncloud_functions_create_action")(BASIC, {} as any);
    expect(res.isError).toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
    const [method, path, query, body] = spy.mock.calls[0];
    expect(method).toBe("PUT");
    expect(path).toBe("/ncf/api/v2/packages/ksj-package/actions/ksj-repo-start");
    expect(query).toEqual({ platform: "vpc", type: "basic" });
    expect(body).toEqual({
      exec: { kind: "python:3.13", binary: false, code: BASIC.exec_code, main: "main" },
      limits: { timeout: 60000, memory: 128 },
      vpc: [{ vpcNo: 21538, subnetNo: 45007 }],
    });
    // 예전 결함 형태가 다시 나오면 안 된다.
    expect(body).not.toHaveProperty("vpc_no");
    expect(body).not.toHaveProperty("subnet_no");
    expect(body).not.toHaveProperty("web");
    spy.mockRestore();
  });

  it("web: raw_http/custom_options는 하이픈 키(raw-http/custom-options)로 전송된다", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ content: {} });
    await getToolHandler(server, "ncloud_functions_create_action")({ ...BASIC, type: "web", raw_http: true, custom_options: false }, {} as any);
    const body = spy.mock.calls[0][3] as any;
    expect(body["raw-http"]).toBe(true);
    expect(body["custom-options"]).toBe(false);
    expect(body).not.toHaveProperty("raw_http");
    expect(body).not.toHaveProperty("custom_options");
    expect(spy.mock.calls[0][2]).toEqual({ platform: "vpc", type: "web" });
    spy.mockRestore();
  });

  it("basic 타입에 raw_http를 주면 API 호출 없이 거절한다", async () => {
    const spy = vi.spyOn(client, "requestRaw");
    const res = await getToolHandler(server, "ncloud_functions_create_action")({ ...BASIC, raw_http: true }, {} as any);
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("web");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("platform=vpc 인데 vpc_no/subnet_no 가 없으면 API 호출 없이 거절한다 (스펙: vpc Required)", async () => {
    const spy = vi.spyOn(client, "requestRaw");
    const { vpc_no, subnet_no, ...noVpc } = BASIC;
    const res = await getToolHandler(server, "ncloud_functions_create_action")(noVpc, {} as any);
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("vpc_no");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("platform=classic 이면 vpc 필드를 싣지 않는다", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ content: {} });
    const { vpc_no, subnet_no, ...noVpc } = BASIC;
    await getToolHandler(server, "ncloud_functions_create_action")({ ...noVpc, platform: "classic" }, {} as any);
    expect(spy.mock.calls[0][3]).not.toHaveProperty("vpc");
    expect(spy.mock.calls[0][2]).toEqual({ platform: "classic", type: "basic" });
    spy.mockRestore();
  });

  it("지원 종료 런타임(python:3.11, nodejs:16)은 기본 거절, allowDeprecatedRuntime=true 면 전송한다", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ content: {} });
    for (const kind of ["python:3.11", "nodejs:16"]) {
      const res = await getToolHandler(server, "ncloud_functions_create_action")({ ...BASIC, exec_kind: kind }, {} as any);
      expect(res.isError).toBe(true);
      expect(text(res)).toContain("2025-09-18");
    }
    expect(spy).not.toHaveBeenCalled();
    const ok = await getToolHandler(server, "ncloud_functions_create_action")({ ...BASIC, exec_kind: "nodejs:16", allowDeprecatedRuntime: true }, {} as any);
    expect(ok.isError).toBeUndefined();
    expect((spy.mock.calls[0][3] as any).exec.kind).toBe("nodejs:16");
    spy.mockRestore();
  });

  it("java/dotnet 은 exec_binary=true 없이는 거절한다", async () => {
    const spy = vi.spyOn(client, "requestRaw");
    const res = await getToolHandler(server, "ncloud_functions_create_action")({ ...BASIC, exec_kind: "java:21" }, {} as any);
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("exec_binary");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("sequence: exec.kind 를 'sequence'로 고정하고 components 만 싣는다 (limits/vpc 없음)", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ content: {} });
    await getToolHandler(server, "ncloud_functions_create_action")({
      actionName: "seq1", type: "sequence", exec_components: ["ksj-package/a", "-/b"], description: "d",
    }, {} as any);
    const [, path, query, body] = spy.mock.calls[0];
    expect(path).toBe("/ncf/api/v2/packages/-/actions/seq1");
    expect(query).toEqual({ platform: "vpc", type: "sequence" });
    expect(body).toEqual({ description: "d", exec: { kind: "sequence", components: ["ksj-package/a", "-/b"] } });
    spy.mockRestore();
  });

  it("sequence 에 components 가 없거나 '{pkg}/{action}' 형식이 아니면 거절한다", async () => {
    const spy = vi.spyOn(client, "requestRaw");
    const h = getToolHandler(server, "ncloud_functions_create_action");
    expect((await h({ actionName: "s", type: "sequence" }, {} as any)).isError).toBe(true);
    expect((await h({ actionName: "s", type: "sequence", exec_components: ["justname"] }, {} as any)).isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("dryRun=true: API 호출 없이 실제 전송 객체(PUT 경로·쿼리·본문)를 보여준다 (F-08)", async () => {
    const spy = vi.spyOn(client, "requestRaw");
    const res = await getToolHandler(server, "ncloud_functions_create_action")({ ...BASIC, dryRun: true }, {} as any);
    expect(spy).not.toHaveBeenCalled();
    const preview = JSON.parse(text(res));
    expect(preview.method).toBe("PUT");
    expect(preview.endpoint).toBe("/ncf/api/v2/packages/ksj-package/actions/ksj-repo-start");
    expect(preview.requestParams.query).toEqual({ platform: "vpc", type: "basic" });
    expect(preview.requestParams.body.vpc).toEqual([{ vpcNo: 21538, subnetNo: 45007 }]);
    expect(preview.requestParams.body.limits).toEqual({ timeout: 60000, memory: 128 });
    spy.mockRestore();
  });

  it("dryRun 도 검증을 거친다 — 거절 사유가 있으면 프리뷰 대신 에러", async () => {
    const res = await getToolHandler(server, "ncloud_functions_create_action")({ ...BASIC, exec_kind: "python:3.11", dryRun: true }, {} as any);
    expect(res.isError).toBe(true);
  });

  it("생성 응답에 실려 오는 소스 코드의 시크릿도 가린다", async () => {
    vi.spyOn(client, "requestRaw").mockResolvedValue({
      content: { name: "a", exec: { binary: false, code: 'secret_key = "dummy-secret-value-for-tests-0123456789a"' } },
    });
    const res = await getToolHandler(server, "ncloud_functions_create_action")(BASIC, {} as any);
    const out = JSON.parse(text(res));
    expect(out.secretsRedacted).toBe(true);
    expect(out.content.exec.code).toContain("<REDACTED:40 chars>");
  });
});

describe("Cloud Functions — get_action 시크릿 마스킹 (F-03)", () => {
  let server: McpServer;
  let client: NcloudClient;
  const LEAKY = {
    content: {
      name: "server_on",
      exec: {
        binary: false,
        kind: "python:3.11",
        main: "main",
        code: 'def main(args):\n    access_key = "ABCDEFGHIJKLMNOPQRST"\n    secret_key = "dummy-secret-value-for-tests-0123456789a"\n    return {}',
      },
    },
  };

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerCloudFunctionsTools(server, client);
  });

  it("기본: 시크릿을 가리고 secretsRedacted/redactedCount 를 붙인다", async () => {
    vi.spyOn(client, "requestRaw").mockResolvedValue(LEAKY);
    const res = await getToolHandler(server, "ncloud_functions_get_action")({ packageName: "ksj-package", actionName: "server_on" }, {} as any);
    const out = JSON.parse(text(res));
    expect(out.secretsRedacted).toBe(true);
    expect(out.redactedCount).toBe(2);
    expect(text(res)).not.toContain("ABCDEFGHIJKLMNOPQRST");
    expect(text(res)).not.toContain("dummy-secret-value-for-tests-0123456789a");
    expect(out.content.exec.code).toContain("def main(args):"); // 나머지 코드는 온전하다
    expect(out.content.exec.kind).toBe("python:3.11");
  });

  it("includeSecrets=true: 원문을 돌려주되 secretsDetected 경고를 붙인다", async () => {
    vi.spyOn(client, "requestRaw").mockResolvedValue(LEAKY);
    const res = await getToolHandler(server, "ncloud_functions_get_action")({ packageName: "ksj-package", actionName: "server_on", includeSecrets: true }, {} as any);
    const out = JSON.parse(text(res));
    expect(out.secretsDetected).toBe(2);
    expect(out.secretsRedacted).toBeUndefined();
    expect(text(res)).toContain("ABCDEFGHIJKLMNOPQRST");
    expect(out.warning).toContain("UNREDACTED");
  });

  it("시크릿이 없으면 응답 형태를 바꾸지 않는다", async () => {
    const clean = { content: { name: "a", exec: { binary: false, code: "def main(args):\n    return {}" } } };
    vi.spyOn(client, "requestRaw").mockResolvedValue(clean);
    const res = await getToolHandler(server, "ncloud_functions_get_action")({ packageName: "p", actionName: "a" }, {} as any);
    expect(JSON.parse(text(res))).toEqual(clean);
  });

  it("binary=true(base64 아카이브)는 스캔하지 않고 그 사실을 적는다", async () => {
    vi.spyOn(client, "requestRaw").mockResolvedValue({ content: { exec: { binary: true, code: "UEsDBBQA" } } });
    const res = await getToolHandler(server, "ncloud_functions_get_action")({ packageName: "p", actionName: "a" }, {} as any);
    expect(JSON.parse(text(res)).secretsScan).toContain("skipped");
  });
});

describe("Cloud Functions — create_trigger 본문 계약 (F-01, F-06, F-08)", () => {
  let server: McpServer;
  let client: NcloudClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerCloudFunctionsTools(server, client);
  });

  it("cron: type 은 쿼리, cronOption 은 최상위 본문 필드(`trigger` 래퍼 없음)", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ content: { name: "nightly-stop", triggerType: "cron" } });
    const res = await getToolHandler(server, "ncloud_functions_create_trigger")({
      triggerName: "nightly-stop", type: "cron", cronOption: "0 20 * * 1-5", description: "stop", parameters: { serverNo: "145353154" },
    }, {} as any);
    expect(spy).toHaveBeenCalledWith("PUT", "/ncf/api/v2/triggers/nightly-stop", { platform: "vpc", type: "cron" }, {
      description: "stop", parameters: { serverNo: "145353154" }, cronOption: "0 20 * * 1-5",
    });
    const out = JSON.parse(text(res));
    expect(out.cronFormat).toMatch(/time zone/i);
    spy.mockRestore();
  });

  it("cron: 5필드가 아니면 API 호출 없이 거절한다", async () => {
    const spy = vi.spyOn(client, "requestRaw");
    const h = getToolHandler(server, "ncloud_functions_create_trigger");
    for (const bad of ["0 8 * *", "0 0 8 * * *", "every day", ""]) {
      const res = await h({ triggerName: "t", type: "cron", cronOption: bad }, {} as any);
      expect(res.isError).toBe(true);
    }
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("다른 타입의 필드가 섞여 오면 조용히 버리지 않고 거절한다", async () => {
    const spy = vi.spyOn(client, "requestRaw");
    const res = await getToolHandler(server, "ncloud_functions_create_trigger")({
      triggerName: "t", type: "cron", cronOption: "0 8 * * *", objectStorageLink: [{ bucketName: "b", eventRuleName: "r" }],
    }, {} as any);
    expect(res.isError).toBe(true);
    expect(text(res)).toContain("objectStorageLink");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("github: credential/events/link 를 최상위로 싣고, 응답의 accessToken 은 가린다", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({
      content: { name: "gh", triggerType: "github", credential: { username: "u", accessToken: "ghp_0123456789abcdefghijklmnop", repository: "org/repo" } },
    });
    const res = await getToolHandler(server, "ncloud_functions_create_trigger")({
      triggerName: "gh", type: "github",
      credential: { username: "u", accessToken: "ghp_0123456789abcdefghijklmnop", repository: "org/repo" },
      events: ["push"], link: { productName: "p", apiName: "a", stageName: "s" },
    }, {} as any);
    expect(spy.mock.calls[0][3]).toEqual({
      credential: { username: "u", accessToken: "ghp_0123456789abcdefghijklmnop", repository: "org/repo" },
      events: ["push"], link: { productName: "p", apiName: "a", stageName: "s" },
    });
    expect(text(res)).not.toContain("ghp_0123456789abcdefghijklmnop");
    expect(JSON.parse(text(res)).secretsRedacted).toBe(true);
    spy.mockRestore();
  });

  it("github: credential 또는 events 가 없으면 거절한다", async () => {
    const res = await getToolHandler(server, "ncloud_functions_create_trigger")({ triggerName: "gh", type: "github", events: ["push"] }, {} as any);
    expect(res.isError).toBe(true);
  });

  it("object_storage / source_commit / secret_manager: 링크 배열이 비면 거절, 있으면 그대로 싣는다", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ content: {} });
    const h = getToolHandler(server, "ncloud_functions_create_trigger");
    expect((await h({ triggerName: "t", type: "object_storage" }, {} as any)).isError).toBe(true);
    expect((await h({ triggerName: "t", type: "source_commit", sourceCommitLink: [] }, {} as any)).isError).toBe(true);
    expect((await h({ triggerName: "t", type: "secret_manager" }, {} as any)).isError).toBe(true);
    expect(spy).not.toHaveBeenCalled();

    await h({ triggerName: "t", type: "secret_manager", secretManagerLink: [{ secretName: "s" }] }, {} as any);
    expect(spy).toHaveBeenCalledWith("PUT", "/ncf/api/v2/triggers/t", { platform: "vpc", type: "secret_manager" }, { secretManagerLink: [{ secretName: "s" }] });
    spy.mockRestore();
  });

  it("insight: insightLink 는 선택이며 없으면 빈 본문 {} 을 보낸다 (스펙: 필드 없을 때 {} 필수)", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ content: {} });
    await getToolHandler(server, "ncloud_functions_create_trigger")({ triggerName: "t", type: "insight" }, {} as any);
    expect(spy.mock.calls[0][3]).toEqual({});
    spy.mockRestore();
  });

  it("dryRun=true: API 호출 없이 전송 객체와 cron 형식 안내를 보여준다", async () => {
    const spy = vi.spyOn(client, "requestRaw");
    const res = await getToolHandler(server, "ncloud_functions_create_trigger")({ triggerName: "t", type: "cron", cronOption: "0 8 * * *", dryRun: true }, {} as any);
    expect(spy).not.toHaveBeenCalled();
    const preview = JSON.parse(text(res));
    expect(preview.endpoint).toBe("/ncf/api/v2/triggers/t");
    expect(preview.requestParams.query).toEqual({ platform: "vpc", type: "cron" });
    expect(preview.requestParams.body).toEqual({ cronOption: "0 8 * * *" });
    expect(preview.cronFormat).toMatch(/time zone/i);
    spy.mockRestore();
  });

  it("get_trigger: cron 트리거 응답에 cronFormat 안내를 붙이고, 다른 타입은 그대로 둔다", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ content: { name: "c", type: "cron", execOption: [{ key: "cron", value: "0 8 * * *" }] } });
    const res = await getToolHandler(server, "ncloud_functions_get_trigger")({ triggerName: "c" }, {} as any);
    expect(JSON.parse(text(res)).cronFormat).toMatch(/does NOT state which time zone/);
    spy.mockResolvedValue({ content: { name: "g", type: "github" } });
    const res2 = await getToolHandler(server, "ncloud_functions_get_trigger")({ triggerName: "g" }, {} as any);
    expect(JSON.parse(text(res2))).toEqual({ content: { name: "g", type: "github" } });
    spy.mockRestore();
  });
});

describe("Cloud Functions — 트리거·액션 연결 (F-01)", () => {
  let server: McpServer;
  let client: NcloudClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerCloudFunctionsTools(server, client);
  });

  it("link: POST /ncf/api/v2/triggers/{t}/link-action 에 { action, package } 본문", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ content: { status: "active" } });
    await getToolHandler(server, "ncloud_functions_link_trigger_action")({ triggerName: "nightly-stop", actionName: "ksj-repo-stop", packageName: "ksj-package" }, {} as any);
    expect(spy).toHaveBeenCalledWith("POST", "/ncf/api/v2/triggers/nightly-stop/link-action", { platform: "vpc" }, { action: "ksj-repo-stop", package: "ksj-package" });
    spy.mockRestore();
  });

  it("link: '{pkg}/{action}' 한 덩어리로 넘겨도 분리해서 싣고, 패키지 미지정이면 '-'", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ content: {} });
    const h = getToolHandler(server, "ncloud_functions_link_trigger_action");
    await h({ triggerName: "t", actionName: "ksj-package/ksj-repo-stop" }, {} as any);
    expect(spy.mock.calls[0][3]).toEqual({ action: "ksj-repo-stop", package: "ksj-package" });
    await h({ triggerName: "t", actionName: "solo" }, {} as any);
    expect(spy.mock.calls[1][3]).toEqual({ action: "solo", package: "-" });
    spy.mockRestore();
  });

  it("unlink: confirm 게이트 통과 시 DELETE /link-action 에 본문으로 보낸다 (쿼리 actionName 아님)", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue(undefined);
    const h = getToolHandler(server, "ncloud_functions_unlink_trigger_action");
    const gated = await h({ triggerName: "t", actionName: "a", packageName: "p", confirm: false }, {} as any);
    expect(text(gated)).toContain("⚠️");
    expect(spy).not.toHaveBeenCalled();
    const res = await h({ triggerName: "t", actionName: "a", packageName: "p", confirm: true }, {} as any);
    expect(spy).toHaveBeenCalledWith("DELETE", "/ncf/api/v2/triggers/t/link-action", { platform: "vpc" }, { action: "a", package: "p" });
    expect(text(res)).toContain("204");
    spy.mockRestore();
  });

  it("delete_action / delete_trigger / delete_package: confirm 없이는 호출하지 않고, 통과 시 DELETE 경로가 v2.1 이다", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue(undefined);
    await getToolHandler(server, "ncloud_functions_delete_action")({ packageName: "p", actionName: "a" }, {} as any);
    await getToolHandler(server, "ncloud_functions_delete_trigger")({ triggerName: "t" }, {} as any);
    await getToolHandler(server, "ncloud_functions_delete_package")({ packageName: "p" }, {} as any);
    expect(spy).not.toHaveBeenCalled();
    await getToolHandler(server, "ncloud_functions_delete_action")({ packageName: "p", actionName: "a", confirm: true }, {} as any);
    await getToolHandler(server, "ncloud_functions_delete_trigger")({ triggerName: "t", confirm: true }, {} as any);
    await getToolHandler(server, "ncloud_functions_delete_package")({ packageName: "p", confirm: true }, {} as any);
    expect(spy.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ["DELETE", "/ncf/api/v2/packages/p/actions/a"],
      ["DELETE", "/ncf/api/v2/triggers/t"],
      ["DELETE", "/ncf/api/v2/packages/p"],
    ]);
    spy.mockRestore();
  });

  it("create_package: 본문이 비어도 {} 를 보내고, dryRun 은 호출하지 않는다", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ content: { name: "p" } });
    const h = getToolHandler(server, "ncloud_functions_create_package");
    await h({ packageName: "p" }, {} as any);
    expect(spy).toHaveBeenCalledWith("PUT", "/ncf/api/v2/packages/p", { platform: "vpc" }, {});
    spy.mockClear();
    const res = await h({ packageName: "p", description: "d", dryRun: true }, {} as any);
    expect(spy).not.toHaveBeenCalled();
    expect(JSON.parse(text(res)).requestParams.body).toEqual({ description: "d" });
    spy.mockRestore();
  });
});
