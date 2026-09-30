import { describe, it, expect } from "vitest";
import {
  makeClientFactory,
  resolveGroups,
  registerGroups,
  planGroups,
  GroupManager,
  DEFAULT_GROUP_KEYS,
  TOOL_GROUPS,
} from "./registry.js";

// 전 도구를 가짜 서버에 등록시켜 구조 불변식을 검사한다(API 호출·비용 없음).
interface CapturedTool {
  name: string;
  description: string | null;
  schemaKeys: string[] | null;
  annotations: Record<string, any> | undefined;
  hasHandler: boolean;
}

function captureAllTools(): CapturedTool[] {
  const captured: CapturedTool[] = [];
  const fakeServer: any = {
    // 구 API: server.tool(name, description, schema, handler) — defineTool 전환 후 사용처 0이어야 함
    tool: (...args: any[]) => {
      const name = args[0];
      const handler = args[args.length - 1];
      let schema: any;
      for (let i = 1; i < args.length - 1; i++) {
        if (args[i] && typeof args[i] === "object") schema = args[i];
      }
      captured.push({
        name,
        description: typeof args[1] === "string" ? args[1] : null,
        schemaKeys: schema ? Object.keys(schema) : null,
        annotations: undefined,
        hasHandler: typeof handler === "function",
      });
    },
    // 신 API: server.registerTool(name, config, handler) — defineTool 래퍼가 사용
    registerTool: (name: string, config: any, handler: any) => {
      captured.push({
        name,
        description: config?.description ?? null,
        schemaKeys: config?.inputSchema ? Object.keys(config.inputSchema) : null,
        annotations: config?.annotations,
        hasHandler: typeof handler === "function",
      });
    },
  };

  const creds = { accessKey: "x", secretKey: "y" };
  registerGroups(
    {
      server: fakeServer,
      client: makeClientFactory(creds, "KR"),
      regionCode: "KR",
      zone: "public",
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

  // ─── MCP tool annotations 불변식 (defineTool 휴리스틱, DESIGN_mid-term §3) ────

  it("모든 도구는 registerTool 경유로 annotations를 가진다 (server.tool 직접 호출 0건)", () => {
    const noAnnotations = tools.filter((t) => t.annotations === undefined).map((t) => t.name);
    expect(noAnnotations).toEqual([]);
  });

  it("파괴적 이름 패턴(delete/terminate/remove/destroy) 도구는 destructiveHint === true", () => {
    const destructiveRe = /(delete|terminate|remove|destroy)/i;
    const wrong = tools
      .filter((t) => destructiveRe.test(t.name))
      .filter((t) => t.annotations?.destructiveHint !== true)
      .map((t) => t.name);
    expect(wrong).toEqual([]);
  });

  it("readOnlyHint: true 도구에 destructiveHint: true가 공존하지 않는다", () => {
    const conflicted = tools
      .filter((t) => t.annotations?.readOnlyHint === true && t.annotations?.destructiveHint === true)
      .map((t) => t.name);
    expect(conflicted).toEqual([]);
  });

  // 기존 hook이 하던 검사를 테스트로 승격 — 표기 변형(⚠️ Destructive / [⚠️ DESTRUCTIVE]) 허용
  it("파괴적 도구 description에 ⚠️ Destructive 경고 문구가 존재한다", () => {
    const destructiveRe = /(delete|terminate|remove|destroy)/i;
    const missing = tools
      .filter((t) => destructiveRe.test(t.name))
      .filter((t) => !(t.description && t.description.includes("⚠️") && /destructive/i.test(t.description)))
      .map((t) => t.name);
    expect(missing).toEqual([]);
  });

  // ─── confirm 게이트 ↔ destructiveHint 불변식 (DESIGN_post-1.4.0 §2, v1.5.0) ───
  //
  // confirm 게이트가 defineTool(`destructive` 옵션)로 추출된 뒤의 핵심 불변식.
  // 게이트의 단일 진실 공급원은 이제 annotations(`destructiveHint`)와 `confirm` 파라미터다.

  // 의도적으로 confirm 게이트를 두지 않는 파괴-동사 도구의 명시적 예외 목록.
  // (데이터 삭제가 아니라 라이프사이클/캐시/인증서 조작 — 원 설계상 비게이트)
  const CONFIRM_GATE_ALLOWLIST = new Set([
    "ncloud_dataforest_kill_container", // 실행 중 컨테이너 강제 종료(재기동 가능)
    "ncloud_dataforest_kill_master", // 마스터 프로세스 강제 종료(재기동 가능)
    "ncloud_edge_purge", // CDN 캐시 무효화(데이터 손실 아님)
    "ncloud_pca_revoke_end_cert", // 인증서 폐기(별도 도구 흐름)
  ]);

  it("confirm 파라미터를 가진 도구는 destructiveHint: true를 가진다 (게이트 ⇒ 파괴 힌트)", () => {
    const wrong = tools
      .filter((t) => t.schemaKeys?.includes("confirm"))
      .filter((t) => t.annotations?.destructiveHint !== true)
      .map((t) => t.name);
    expect(wrong).toEqual([]);
  });

  it("destructiveHint: true 도구는 confirm 게이트를 가진다 (allowlist 제외)", () => {
    // 새 파괴 도구를 confirm 없이 추가하면(=destructiveHint만 부여) 여기서 잡힌다.
    const missing = tools
      .filter((t) => t.annotations?.destructiveHint === true)
      .filter((t) => !t.schemaKeys?.includes("confirm"))
      .filter((t) => !CONFIRM_GATE_ALLOWLIST.has(t.name))
      .map((t) => t.name);
    expect(missing).toEqual([]);
  });

  it("allowlist는 실재하고 비게이트 상태다 (목록이 낡지 않도록)", () => {
    // allowlist에 올렸으나 이제 게이트가 생겼거나(불필요) 사라진 도구(오타)를 잡는다.
    const stale: string[] = [];
    for (const name of CONFIRM_GATE_ALLOWLIST) {
      const t = tools.find((x) => x.name === name);
      if (!t) stale.push(`${name} (도구 없음)`);
      else if (t.schemaKeys?.includes("confirm")) stale.push(`${name} (confirm 생김 → allowlist 불필요)`);
    }
    expect(stale).toEqual([]);
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

// ─── 존 통합 (민간존 public / 공공존 gov) ─────────────────────────────────────
describe("makeClientFactory: 존별 기본 게이트웨이", () => {
  const creds = { accessKey: "x", secretKey: "y" };
  const baseUrlOf = (c: unknown) => (c as { baseUrl: string }).baseUrl;

  it("zone 생략 = public, 기본 base URL 은 민간존 게이트웨이(하위호환)", () => {
    const factory = makeClientFactory(creds, "KR", undefined, {});
    expect(factory.getZone()).toBe("public");
    expect(baseUrlOf(factory())).toBe("https://ncloud.apigw.ntruss.com");
  });
  it("zone=gov 이면 기본 base URL 은 공공존 게이트웨이", () => {
    const factory = makeClientFactory(creds, "KR", "gov", {});
    expect(factory.getZone()).toBe("gov");
    expect(baseUrlOf(factory())).toBe("https://ncloud.apigw.gov-ntruss.com");
  });
  it("NCLOUD_API_URL 은 존과 무관하게 기본 base URL 을 덮어쓴다", () => {
    const factory = makeClientFactory(creds, "KR", "gov", { NCLOUD_API_URL: "https://proxy.local" });
    expect(baseUrlOf(factory())).toBe("https://proxy.local");
  });
});

describe("common 그룹: 존별 리전 카탈로그", () => {
  const creds = { accessKey: "x", secretKey: "y" };

  function captureCommon(zone: "public" | "gov") {
    const captured: CapturedTool[] = [];
    const fakeServer: any = {
      registerTool: (name: string, config: any, handler: any) => {
        captured.push({
          name,
          description: config?.description ?? null,
          schemaKeys: config?.inputSchema ? Object.keys(config.inputSchema) : null,
          annotations: config?.annotations,
          hasHandler: typeof handler === "function",
        });
      },
    };
    registerGroups(
      {
        server: fakeServer,
        client: makeClientFactory(creds, "KR", zone, {}),
        regionCode: "KR",
        zone,
        creds,
        env: {},
      },
      TOOL_GROUPS.filter((g) => g.key === "common")
    );
    return captured;
  }

  it("public: set_region description 은 v1.16.0 문구와 글자 단위로 동일하다(회귀 방지)", () => {
    const tool = captureCommon("public").find((t) => t.name === "ncloud_set_region")!;
    expect(tool.description).toBe(
      "Set the active Ncloud region by code (KR, JPN, SGN, USWN, DEN) or Korean name (한국, 일본, 싱가포르, 미국, 독일)"
    );
  });
  it("gov: set_region description 은 KR/KRS 만 안내하고 글로벌 리전을 언급하지 않는다", () => {
    const tool = captureCommon("gov").find((t) => t.name === "ncloud_set_region")!;
    expect(tool.description).toContain("(Gov)");
    expect(tool.description).toContain("KR, KRS");
    expect(tool.description).toContain("한국, 한국남부");
    expect(tool.description).not.toMatch(/JPN|SGN|USWN|DEN/);
  });
  it("common 도구 이름 집합은 존과 무관하게 동일하다", () => {
    const pub = captureCommon("public").map((t) => t.name).sort();
    const gov = captureCommon("gov").map((t) => t.name).sort();
    expect(gov).toEqual(pub);
  });
});

describe("compute 그룹: 존별 Cloud Functions API 버전", () => {
  const creds = { accessKey: "x", secretKey: "y" };

  function captureCompute(zone: "public" | "gov") {
    const captured: CapturedTool[] = [];
    const fakeServer: any = {
      registerTool: (name: string, config: any, handler: any) => {
        captured.push({
          name,
          description: config?.description ?? null,
          schemaKeys: config?.inputSchema ? Object.keys(config.inputSchema) : null,
          annotations: config?.annotations,
          hasHandler: typeof handler === "function",
        });
      },
    };
    registerGroups(
      { server: fakeServer, client: makeClientFactory(creds, "KR", zone, {}), regionCode: "KR", zone, creds, env: {} },
      TOOL_GROUPS.filter((g) => g.key === "compute")
    );
    return captured;
  }

  it("public: Cloud Functions 는 API v2.1 (/ncf/api/v2)", () => {
    const t = captureCompute("public").find((x) => x.name === "ncloud_functions_create_action")!;
    expect(t.description).toContain("/ncf/api/v2");
    expect(t.description).toContain("v2.1");
  });
  it("gov: Cloud Functions 는 API v2.0 (/api/v2, Classic 전용), 트리거는 cron/github 만", () => {
    const tools = captureCompute("gov");
    const action = tools.find((x) => x.name === "ncloud_functions_create_action")!;
    expect(action.description).toContain("v2.0");
    expect(action.description).toContain("Classic");
    const trigger = tools.find((x) => x.name === "ncloud_functions_create_trigger")!;
    expect(trigger.description).toContain("only cron and github");
    expect(trigger.description).not.toContain("object_storage →");
  });
  it("compute 도구 이름 집합은 존과 무관하게 동일하다", () => {
    const pub = captureCompute("public").map((t) => t.name).sort();
    const gov = captureCompute("gov").map((t) => t.name).sort();
    expect(gov).toEqual(pub);
    expect(pub).toContain("ncloud_change_block_storage_size");
  });
});

describe("network 그룹: 존별 등록", () => {
  const creds = { accessKey: "x", secretKey: "y" };
  const LISTENER_CERT_TOOLS = [
    "ncloud_add_lb_listener_certificate",
    "ncloud_remove_lb_listener_certificate",
    "ncloud_list_lb_listener_certificates",
  ];

  function captureNetwork(zone: "public" | "gov") {
    const names: string[] = [];
    const fakeServer: any = { registerTool: (name: string) => names.push(name) };
    registerGroups(
      { server: fakeServer, client: makeClientFactory(creds, "KR", zone, {}), regionCode: "KR", zone, creds, env: {} },
      TOOL_GROUPS.filter((g) => g.key === "network")
    );
    return names;
  }

  it("public: LB 리스너 인증서 도구 3종이 등록된다", () => {
    const names = captureNetwork("public");
    for (const t of LISTENER_CERT_TOOLS) expect(names).toContain(t);
  });
  it("gov: 리스너 인증서 도구 3종만 빠지고 나머지는 public 과 동일하다 (공공존 LB 가이드에 해당 오퍼레이션 없음)", () => {
    const pub = captureNetwork("public");
    const gov = captureNetwork("gov");
    for (const t of LISTENER_CERT_TOOLS) expect(gov).not.toContain(t);
    expect(gov.sort()).toEqual(pub.filter((n) => !LISTENER_CERT_TOOLS.includes(n)).sort());
  });
});

describe("storage 그룹: 존별 등록", () => {
  const creds = { accessKey: "x", secretKey: "y" };

  function captureStorage(zone: "public" | "gov") {
    const captured: CapturedTool[] = [];
    const fakeServer: any = {
      registerTool: (name: string, config: any, handler: any) => {
        captured.push({ name, description: config?.description ?? null, schemaKeys: null, annotations: config?.annotations, hasHandler: typeof handler === "function" });
      },
    };
    registerGroups(
      {
        server: fakeServer,
        client: makeClientFactory(creds, "KR", zone, {}),
        regionCode: "KR",
        zone,
        creds,
        env: { NCLOUD_ARCHIVE_PROJECT_ID: "p", NCLOUD_ARCHIVE_DOMAIN_ID: "d" },
      },
      TOOL_GROUPS.filter((g) => g.key === "storage")
    );
    return captured;
  }

  it("도구 이름 집합은 존과 무관하게 동일하다 (Object·Ncloud·NAS·Archive 모두 공공존 제공)", () => {
    const pub = captureStorage("public").map((t) => t.name).sort();
    const gov = captureStorage("gov").map((t) => t.name).sort();
    expect(gov).toEqual(pub);
    expect(pub.some((n) => n.startsWith("ncloud_ncs_"))).toBe(true);
    expect(pub.some((n) => n.includes("archive"))).toBe(true);
  });
  it("Ncloud Storage description 은 존의 호스트를 안내한다", () => {
    const pub = captureStorage("public").find((t) => t.name === "ncloud_ncs_list_buckets")!;
    const gov = captureStorage("gov").find((t) => t.name === "ncloud_ncs_list_buckets")!;
    expect(pub.description).toContain("kr.ncloudstorage.com");
    expect(pub.description).not.toContain("gov-");
    expect(gov.description).toContain("kr.gov-ncloudstorage.com");
  });
});

describe("monitoring 그룹: 존별 등록", () => {
  const creds = { accessKey: "x", secretKey: "y" };
  function captureMonitoring(zone: "public" | "gov") {
    const captured: CapturedTool[] = [];
    const fakeServer: any = {
      registerTool: (name: string, config: any, handler: any) => {
        captured.push({ name, description: config?.description ?? null, schemaKeys: config?.inputSchema ? Object.keys(config.inputSchema) : null, annotations: config?.annotations, hasHandler: typeof handler === "function" });
      },
    };
    registerGroups(
      { server: fakeServer, client: makeClientFactory(creds, "KR", zone, {}), regionCode: "KR", zone, creds, env: {} },
      TOOL_GROUPS.filter((g) => g.key === "monitoring")
    );
    return captured;
  }
  it("도구 이름 집합은 존과 무관하게 동일하다 (Cloud Insight v1·Log Analytics 오퍼레이션 목록 동일)", () => {
    const pub = captureMonitoring("public").map((t) => t.name).sort();
    const gov = captureMonitoring("gov").map((t) => t.name).sort();
    expect(gov).toEqual(pub);
    expect(pub).toContain("ncloud_search_logs");
  });
});

describe("governance 그룹: 존별 등록", () => {
  const creds = { accessKey: "x", secretKey: "y" };
  function captureGovernance(zone: "public" | "gov") {
    const names: string[] = [];
    const fakeServer: any = { registerTool: (name: string) => names.push(name) };
    registerGroups(
      { server: fakeServer, client: makeClientFactory(creds, "KR", zone, {}), regionCode: "KR", zone, creds, env: {} },
      TOOL_GROUPS.filter((g) => g.key === "governance")
    );
    return names;
  }
  it("public: Cloud Advisor + WMS 모두 등록", () => {
    const names = captureGovernance("public");
    expect(names.some((n) => n.startsWith("ncloud_advisor_"))).toBe(true);
    expect(names).toContain("ncloud_wms_list_monitors");
  });
  it("gov: Cloud Advisor 만 빠지고(공공존 미제공) 나머지는 public 과 동일", () => {
    const pub = captureGovernance("public");
    const gov = captureGovernance("gov");
    expect(gov.some((n) => n.startsWith("ncloud_advisor_"))).toBe(false);
    expect(gov.sort()).toEqual(pub.filter((n) => !n.startsWith("ncloud_advisor_")).sort());
  });
});

describe("devtools 그룹: 존별 등록", () => {
  const creds = { accessKey: "x", secretKey: "y" };
  function captureDevtools(zone: "public" | "gov") {
    const names: string[] = [];
    const fakeServer: any = { registerTool: (name: string) => names.push(name) };
    registerGroups(
      { server: fakeServer, client: makeClientFactory(creds, "KR", zone, {}), regionCode: "KR", zone, creds, env: {} },
      TOOL_GROUPS.filter((g) => g.key === "devtools")
    );
    return names;
  }
  it("도구 이름 집합은 존과 무관하게 동일하다 (SourceCommit/Build/Deploy/Pipeline 모두 공공존 제공)", () => {
    const pub = captureDevtools("public").sort();
    const gov = captureDevtools("gov").sort();
    expect(gov).toEqual(pub);
    expect(pub.length).toBeGreaterThan(20);
  });
});

describe("analytics 그룹: 존별 등록", () => {
  const creds = { accessKey: "x", secretKey: "y" };
  function captureAnalytics(zone: "public" | "gov") {
    const names: string[] = [];
    const fakeServer: any = { registerTool: (name: string) => names.push(name) };
    registerGroups(
      { server: fakeServer, client: makeClientFactory(creds, "KR", zone, {}), regionCode: "KR", zone, creds, env: {} },
      TOOL_GROUPS.filter((g) => g.key === "analytics")
    );
    return names;
  }
  const PUBLIC_ONLY_PREFIXES = ["ncloud_datastream_", "ncloud_datacatalog_", "ncloud_dataforest_", "ncloud_dataflow_", "ncloud_dataquery_"];
  const isDataService = (n: string) => PUBLIC_ONLY_PREFIXES.some((p) => n.startsWith(p));
  it("public: Data Stream/Catalog/Forest/Flow/Query 와 SES/CDSS G3 도구가 모두 등록된다", () => {
    const names = captureAnalytics("public");
    for (const p of PUBLIC_ONLY_PREFIXES) expect(names.some((n) => n.startsWith(p)), p).toBe(true);
    expect(names).toContain("ncloud_ses_create_cluster_g3");
    expect(names).toContain("ncloud_cdss_create_cluster_g3");
  });
  it("gov: Data* 서비스와 SES 8종·CDSS 6종(민간존 전용 오퍼레이션)만 빠지고 나머지는 동일", () => {
    const pub = captureAnalytics("public");
    const gov = captureAnalytics("gov");
    expect(gov.some(isDataService)).toBe(false);
    const sesOnly = ["ncloud_ses_get_cluster_detail", "ncloud_ses_get_server_generations", "ncloud_ses_get_server_specs", "ncloud_ses_get_cluster_server_images", "ncloud_ses_get_subnet_list_g3", "ncloud_ses_create_cluster_g3", "ncloud_ses_get_node_spec_for_change_g3", "ncloud_ses_change_disk_size"];
    const cdssOnly = ["ncloud_cdss_create_cluster_g3", "ncloud_cdss_get_subnet_list_g3", "ncloud_cdss_get_node_spec_for_change_g3", "ncloud_cdss_get_server_generations", "ncloud_cdss_get_server_spec_list", "ncloud_cdss_get_cluster_server_images"];
    for (const t of [...sesOnly, ...cdssOnly]) { expect(pub).toContain(t); expect(gov).not.toContain(t); }
    const expected = pub.filter((n) => !isDataService(n) && !sesOnly.includes(n) && !cdssOnly.includes(n)).sort();
    expect(gov.sort()).toEqual(expected);
    expect(gov).toContain("ncloud_ses_list_clusters");
    expect(gov).toContain("ncloud_cdss_list_clusters");
    expect(gov.some((n) => n.startsWith("ncloud_hadoop_") || n.includes("hadoop"))).toBe(true);
  });
});

describe("media 그룹: 존별 등록", () => {
  const creds = { accessKey: "x", secretKey: "y" };
  function captureMedia(zone: "public" | "gov") {
    const names: string[] = [];
    const fakeServer: any = { registerTool: (name: string) => names.push(name) };
    registerGroups(
      { server: fakeServer, client: makeClientFactory(creds, "KR", zone, {}), regionCode: "KR", zone, creds, env: {} },
      TOOL_GROUPS.filter((g) => g.key === "media")
    );
    return names;
  }
  it("public: VOD Station·Live Station·Image Optimizer·Multi DRM(복제 포함) 등록", () => {
    const names = captureMedia("public");
    expect(names).toContain("ncloud_vodstation_update_channel");
    expect(names.some((n) => n.startsWith("ncloud_livestation_"))).toBe(true);
    expect(names).toContain("ncloud_drm_list_sites");
    expect(names).toContain("ncloud_drm_copy_policy");
  });
  it("gov: Live Station·Image Optimizer·VOD 채널 수정·DRM 정책 복제만 빠지고 나머지는 동일", () => {
    const pub = captureMedia("public");
    const gov = captureMedia("gov");
    const publicOnly = (n: string) => n.startsWith("ncloud_livestation_") || n.startsWith("ncloud_imageoptimizer_") || n === "ncloud_vodstation_update_channel" || n === "ncloud_drm_copy_policy";
    expect(gov.some(publicOnly)).toBe(false);
    expect(gov.sort()).toEqual(pub.filter((n) => !publicOnly(n)).sort());
    expect(gov).toContain("ncloud_vodstation_list_channels");
    expect(gov).toContain("ncloud_drm_get_license_statistics");
  });
});

describe("cdn 그룹: 존별 등록", () => {
  const creds = { accessKey: "x", secretKey: "y" };
  function captureCdn(zone: "public" | "gov") {
    const names: string[] = [];
    const fakeServer: any = { registerTool: (name: string) => names.push(name) };
    registerGroups(
      { server: fakeServer, client: makeClientFactory(creds, "KR", zone, {}), regionCode: "KR", zone, creds, env: {} },
      TOOL_GROUPS.filter((g) => g.key === "cdn")
    );
    return names;
  }
  it("Global Edge 도구 집합은 존과 무관하게 동일하고, CDN+/Global CDN 도구는 없다", () => {
    const pub = captureCdn("public").sort();
    const gov = captureCdn("gov").sort();
    expect(gov).toEqual(pub);
    expect(pub.length).toBeGreaterThan(10);
    expect(pub.some((n) => /cdnplus|cdn_plus|globalcdn|global_cdn/.test(n))).toBe(false);
  });
});

describe("security 그룹: 존별 등록", () => {
  const creds = { accessKey: "x", secretKey: "y" };
  function captureSecurity(zone: "public" | "gov") {
    const names: string[] = [];
    const fakeServer: any = { registerTool: (name: string) => names.push(name) };
    registerGroups(
      { server: fakeServer, client: makeClientFactory(creds, "KR", zone, {}), regionCode: "KR", zone, creds, env: {} },
      TOOL_GROUPS.filter((g) => g.key === "security")
    );
    return names;
  }
  it("gov 에만 사설 인증서 발급(issuePrivate)이 추가되고 나머지는 public 과 동일", () => {
    const pub = captureSecurity("public");
    const gov = captureSecurity("gov");
    expect(pub).not.toContain("ncloud_issue_private_certificate");
    expect(gov).toContain("ncloud_issue_private_certificate");
    expect(gov.filter((n) => n !== "ncloud_issue_private_certificate").sort()).toEqual(pub.sort());
    expect(pub).toContain("ncloud_kms_create_key");
  });
});

describe("database 그룹: 존별 등록", () => {
  const creds = { accessKey: "x", secretKey: "y" };
  const CACHE_USER_TOOLS = ["ncloud_list_cache_users", "ncloud_add_cache_users", "ncloud_change_cache_users", "ncloud_delete_cache_users"];

  function captureDatabase(zone: "public" | "gov") {
    const names: string[] = [];
    const fakeServer: any = { registerTool: (name: string) => names.push(name) };
    registerGroups(
      { server: fakeServer, client: makeClientFactory(creds, "KR", zone, {}), regionCode: "KR", zone, creds, env: {} },
      TOOL_GROUPS.filter((g) => g.key === "database")
    );
    return names;
  }

  it("public: Serverless 도구는 있고 Cache 사용자 도구는 없다", () => {
    const names = captureDatabase("public");
    expect(names.some((n) => n.startsWith("ncloud_serverless_"))).toBe(true);
    for (const t of CACHE_USER_TOOLS) expect(names).not.toContain(t);
  });
  it("gov: Serverless 도구는 없고(공공존 미제공) Cache 사용자 도구 4종이 추가되며, 나머지는 public 과 동일하다", () => {
    const pub = captureDatabase("public");
    const gov = captureDatabase("gov");
    expect(gov.some((n) => n.startsWith("ncloud_serverless_"))).toBe(false);
    for (const t of CACHE_USER_TOOLS) expect(gov).toContain(t);
    const pubCore = pub.filter((n) => !n.startsWith("ncloud_serverless_")).sort();
    const govCore = gov.filter((n) => !CACHE_USER_TOOLS.includes(n)).sort();
    expect(govCore).toEqual(pubCore);
  });
});

// ─── 동적 그룹 로딩 (v1.4.0, DESIGN_long-term-dynamic-groups.md §3) ─────────────
describe("동적 그룹 로딩: planGroups / GroupManager", () => {
  const creds = { accessKey: "x", secretKey: "y" };

  // tools 를 수집하는 가짜 서버 + GroupManager 를 만든다.
  function makeManager(rawEnv: string | undefined) {
    const captured: CapturedTool[] = [];
    const fakeServer: any = {
      registerTool: (name: string, config: any, handler: any) => {
        captured.push({
          name,
          description: config?.description ?? null,
          schemaKeys: config?.inputSchema ? Object.keys(config.inputSchema) : null,
          annotations: config?.annotations,
          hasHandler: typeof handler === "function",
        });
      },
      tool: () => {
        throw new Error("server.tool 직접 호출 금지 — defineTool 경유여야 함");
      },
    };
    const plan = planGroups(rawEnv);
    const manager = new GroupManager(
      {
        server: fakeServer,
        client: makeClientFactory(creds, "KR"),
        regionCode: "KR",
        zone: "public",
        creds,
        env: { ...process.env, NCLOUD_ARCHIVE_PROJECT_ID: "p", NCLOUD_ARCHIVE_DOMAIN_ID: "d" },
      },
      plan
    );
    return { manager, captured, names: () => captured.map((t) => t.name) };
  }

  it("dynamic 키워드는 기본 세트(common + DEFAULT_GROUP_KEYS)만 시작 ON 한다", () => {
    const { manager } = makeManager("dynamic");
    manager.start();
    expect(manager.enabledGroupKeys().sort()).toEqual(["common", ...DEFAULT_GROUP_KEYS].sort());
  });

  it("start: dynamic 모드는 메타 도구 2개를 등록한다", () => {
    const { manager, names } = makeManager("dynamic");
    manager.start();
    expect(names()).toContain("ncloud_list_tool_groups");
    expect(names()).toContain("ncloud_enable_tool_group");
  });

  it("enable 흐름: 기본 세트 시작 → enable('analytics') → 도구 등록, 증가분 = 그룹 도구 수", () => {
    const { manager, names } = makeManager("dynamic");
    manager.start();
    const before = names().length;
    const out = manager.enable("analytics");
    expect(out.status).toBe("enabled");
    expect(out.registeredToolCount).toBeGreaterThan(0);
    expect(names().length - before).toBe(out.registeredToolCount);
    expect(manager.enabledGroupKeys()).toContain("analytics");
    expect(names().some((n) => n.startsWith("ncloud_"))).toBe(true);
  });

  it("sampleTools 는 첫 N개 쏠림이 아니라 그룹 전반을 고루 대표한다", () => {
    const { manager } = makeManager("dynamic");
    manager.start();
    // governance: Activity Tracer → Cloud Advisor → Resource Manager → Sub Account 순 등록.
    // 단순 slice(0,5)면 앞쪽 모듈(get/advisor)에만 쏠리던 케이스.
    const out = manager.enable("governance");
    expect(out.status).toBe("enabled");
    const sample = out.sampleTools ?? [];
    expect(sample.length).toBeGreaterThan(0);
    // 토큰(두 번째)별 분포가 고루 퍼져야 한다(첫 모듈 쏠림이면 1~2종에 그침).
    const buckets = new Set(sample.map((n) => n.split("_")[1]));
    expect(buckets.size).toBeGreaterThanOrEqual(4);
  });

  it("멱등: 같은 그룹 2회 enable → 중복 등록 0, 정상 응답", () => {
    const { manager, names } = makeManager("dynamic");
    manager.start();
    manager.enable("analytics");
    const after1 = names().length;
    const out2 = manager.enable("analytics");
    expect(out2.status).toBe("already-enabled");
    expect(out2.registeredToolCount).toBe(0);
    expect(names().length).toBe(after1);
  });

  it("차단: all,-billing 에서 enable('billing') → 거부 응답 + 미등록", () => {
    const { manager, names } = makeManager("all,-billing");
    manager.start();
    expect(manager.enabledGroupKeys()).not.toContain("billing");
    const before = names().length;
    const out = manager.enable("billing");
    expect(out.status).toBe("blocked");
    expect(names().length).toBe(before);
    expect(names().some((n) => n.startsWith("ncloud_billing") || n.includes("list_price"))).toBe(false);
  });

  it("미지원(unknown) key: enable('nope') → unknown + 사용 가능 목록 (moved 아님)", () => {
    const { manager } = makeManager("dynamic");
    manager.start();
    const out = manager.enable("nope");
    expect(out.status).toBe("unknown");
    expect(out.availableGroups).toBeDefined();
    expect(out.availableGroups!.length).toBeGreaterThan(0);
  });

  it("moved key: enable('integration') → moved (unknown 과 분리)", () => {
    const { manager } = makeManager("dynamic");
    manager.start();
    const out = manager.enable("integration");
    expect(out.status).toBe("moved");
    expect(out.message).toMatch(/application/);
  });

  it("명시 리스트(dynamic 없음)는 잠금 — 메타 도구 미등록 (확장 불가)", () => {
    const { manager, names } = makeManager("compute,network");
    manager.start();
    expect(manager.enabledGroupKeys().sort()).toEqual(["common", "compute", "network"].sort());
    expect(names()).not.toContain("ncloud_enable_tool_group");
    expect(names()).not.toContain("ncloud_list_tool_groups");
  });

  it("dynamic 은 확장 ON(메타 등록), 같은 시작 집합이라도 명시 리스트는 잠금", () => {
    const dyn = makeManager("dynamic");
    dyn.manager.start();
    expect(dyn.names()).toContain("ncloud_enable_tool_group");

    const locked = makeManager("compute,network,database"); // dynamic 의 시작 집합과 동일하지만 잠금
    locked.manager.start();
    expect(locked.names()).not.toContain("ncloud_enable_tool_group");
  });

  it("all 모드(전부 ON)에서는 enable 대상이 없어 메타 도구 미등록", () => {
    const { manager, names } = makeManager(undefined); // 미설정 = 전체 ON
    manager.start();
    expect(manager.enableableKeys()).toEqual([]);
    expect(names()).not.toContain("ncloud_enable_tool_group");
  });

  it("catalog: 14개 그룹 + status(enabled/available/blocked) + 도구 수", () => {
    const { manager } = makeManager("all,-billing");
    manager.start();
    const cat = manager.catalog();
    expect(cat.groups.length).toBe(TOOL_GROUPS.filter((g) => !g.always).length);
    const billing = cat.groups.find((g) => g.key === "billing");
    expect(billing?.status).toBe("blocked");
    const analytics = cat.groups.find((g) => g.key === "analytics");
    expect(analytics?.status).toBe("enabled"); // all 로 켜짐
    expect(analytics?.toolCount).toBeGreaterThan(0);
  });

  // §3: 전수 불변식이 "동적으로 켜진 도구"에도 동일 적용 — enable 경유 경로로 captureAllTools 재수행
  describe("enable 경유 경로의 전수 불변식", () => {
    const { manager, captured } = makeManager("dynamic");
    manager.start();
    // 기본 세트 외 모든 그룹을 동적 enable 해 전 도구를 enable 경로로 수집
    for (const key of manager.enableableKeys()) manager.enable(key);

    it("enable 경유로도 1000개 이상 등록된다", () => {
      expect(captured.length).toBeGreaterThan(1000);
    });
    it("모든 도구는 ncloud_ 접두사", () => {
      expect(captured.filter((t) => !t.name.startsWith("ncloud_")).map((t) => t.name)).toEqual([]);
    });
    it("모든 도구는 스키마·핸들러·annotations 를 가진다", () => {
      expect(captured.filter((t) => t.schemaKeys === null).map((t) => t.name)).toEqual([]);
      expect(captured.filter((t) => !t.hasHandler).map((t) => t.name)).toEqual([]);
      expect(captured.filter((t) => t.annotations === undefined).map((t) => t.name)).toEqual([]);
    });
    it("파괴적 도구는 confirm 파라미터 + destructiveHint", () => {
      const re = /(delete|terminate|remove|destroy)/i;
      const noConfirm = captured
        .filter((t) => re.test(t.name))
        .filter((t) => !(t.schemaKeys && t.schemaKeys.includes("confirm")))
        .map((t) => t.name);
      expect(noConfirm).toEqual([]);
      const wrongHint = captured
        .filter((t) => re.test(t.name))
        .filter((t) => t.annotations?.destructiveHint !== true)
        .map((t) => t.name);
      expect(wrongHint).toEqual([]);
    });
  });
});
