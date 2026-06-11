import { describe, it, expect } from "vitest";
import { makeClientFactory, resolveGroups, registerGroups, TOOL_GROUPS } from "./registry.js";

// 전 도구를 가짜 서버에 등록시켜 구조 불변식을 검사한다(API 호출·비용 없음).
interface CapturedTool {
  name: string;
  schemaKeys: string[] | null;
  hasHandler: boolean;
}

function captureAllTools(): CapturedTool[] {
  const captured: CapturedTool[] = [];
  const fakeServer: any = {
    tool: (...args: any[]) => {
      const name = args[0];
      const handler = args[args.length - 1];
      let schema: any;
      for (let i = 1; i < args.length - 1; i++) {
        if (args[i] && typeof args[i] === "object") schema = args[i];
      }
      captured.push({
        name,
        schemaKeys: schema ? Object.keys(schema) : null,
        hasHandler: typeof handler === "function",
      });
    },
  };
  fakeServer.registerTool = (...a: any[]) => fakeServer.tool(...a);

  const creds = { accessKey: "x", secretKey: "y" };
  registerGroups(
    {
      server: fakeServer,
      client: makeClientFactory(creds, "KR"),
      regionCode: "KR",
      creds,
      // archive 그룹까지 전부 등록되도록 env 주입
      env: { ...process.env, NCLOUD_ARCHIVE_PROJECT_ID: "p", NCLOUD_ARCHIVE_DOMAIN_ID: "d" },
    },
    resolveGroups(undefined)
  );
  return captured;
}

describe("registry: 전 도구 구조 불변식 (자동 전수 점검)", () => {
  const tools = captureAllTools();

  it("전 그룹 등록 시 도구가 1000개 이상 등록된다", () => {
    // v1.1.1에서 endpoint 수정으로 일부 모듈 도구 집합이 바뀌므로 정확값 대신 하한선으로 확인
    expect(tools.length).toBeGreaterThan(1000);
  });

  it("모든 도구 이름은 ncloud_ 접두사를 쓴다", () => {
    const bad = tools.filter((t) => !t.name.startsWith("ncloud_")).map((t) => t.name);
    expect(bad).toEqual([]);
  });

  it("모든 도구는 zod 파라미터 스키마를 가진다", () => {
    const noSchema = tools.filter((t) => t.schemaKeys === null).map((t) => t.name);
    expect(noSchema).toEqual([]);
  });

  it("모든 도구는 핸들러를 가진다", () => {
    const noHandler = tools.filter((t) => !t.hasHandler).map((t) => t.name);
    expect(noHandler).toEqual([]);
  });

  it("도구 이름은 중복되지 않는다", () => {
    const names = tools.map((t) => t.name);
    const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
    expect(dupes).toEqual([]);
  });

  it("그룹 키는 중복되지 않고 common은 always", () => {
    const keys = TOOL_GROUPS.map((g) => g.key);
    expect([...new Set(keys)].length).toBe(keys.length);
    expect(TOOL_GROUPS.find((g) => g.key === "common")?.always).toBe(true);
  });

  // 파괴적 도구(delete/terminate/remove/destroy)는 confirm 게이트(CLAUDE.md 컨벤션 #5)를 가져야 한다.
  // pca/kms 5개 갭을 수정 완료하여 예외 목록은 비어 있다 — 이제 전수 통과를 단언한다.
  it("모든 파괴적 도구는 confirm 파라미터를 가진다 (예외 없음)", () => {
    const destructiveRe = /(delete|terminate|remove|destroy)/i;
    const missing = tools
      .filter((t) => destructiveRe.test(t.name))
      .filter((t) => !(t.schemaKeys && t.schemaKeys.includes("confirm")))
      .map((t) => t.name);
    expect(missing).toEqual([]);
  });
});

describe("makeClientFactory: setRegionAll 전파 (Task 4)", () => {
  const creds = { accessKey: "x", secretKey: "y" };

  it("서로 다른 base URL 클라이언트 모두에 리전 변경이 전파된다", () => {
    const factory = makeClientFactory(creds, "KR");
    const a = factory("https://cw.apigw.ntruss.com");
    const b = factory("https://nks.apigw.ntruss.com");
    expect(a.getRegionCode()).toBe("KR");
    expect(b.getRegionCode()).toBe("KR");

    factory.setRegionAll("JPN");

    expect(a.getRegionCode()).toBe("JPN");
    expect(b.getRegionCode()).toBe("JPN");
    expect(factory.getRegionCode()).toBe("JPN");
  });

  it("setRegionAll 이후 새로 생성된 클라이언트도 전파된 리전으로 만들어진다", () => {
    const factory = makeClientFactory(creds, "KR");
    factory.setRegionAll("JPN");

    const fresh = factory("https://billingapi.apigw.ntruss.com");
    expect(fresh.getRegionCode()).toBe("JPN");
  });

  it("같은 base URL 은 memoize 되어 동일 인스턴스를 반환한다", () => {
    const factory = makeClientFactory(creds, "KR");
    const a = factory("https://cw.apigw.ntruss.com");
    const b = factory("https://cw.apigw.ntruss.com");
    expect(a).toBe(b);
  });
});
