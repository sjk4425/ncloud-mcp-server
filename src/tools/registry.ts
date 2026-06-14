/**
 * 그룹 단위 도구 레지스트리.
 *
 * 64개 서비스 모듈을 14개 그룹(+always common)으로 묶고, env `NCLOUD_TOOL_GROUPS`로
 * 선택적으로 로딩한다. 그룹별 register 클로저 안에서 base URL·특수 클라이언트를 캡슐화하고,
 * 클라이언트는 base URL별로 memoize 해 켜진 그룹만 생성한다.
 *
 * 하위호환: `NCLOUD_TOOL_GROUPS` 미설정 시 전체 ON = 기존 index.ts 동작과 100% 동일.
 *
 * 설계: DESIGN_modularization-and-response.md §2
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { defineTool } from "./_tool.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { S3CompatibleClient } from "../client/s3-compatible-client.js";
import { SwiftCompatibleClient } from "../client/swift-compatible-client.js";
import {
  registerCommonTools,
  registerComputeServerTools,
  registerComputeStorageTools,
  registerComputePublicIpTools,
  registerComputeLoginKeyTools,
  registerComputeInitScriptTools,
  registerComputePlacementTools,
  registerVpcTools,
  registerAcgTools,
  registerNetworkAclTools,
  registerNatGatewayTools,
  registerRouteTableTools,
  registerVpcPeeringTools,
  registerNetworkInterfaceTools,
  registerLoadBalancerTools,
  registerTargetGroupTools,
  registerAutoScalingTools,
  registerDatabaseMysqlTools,
  registerDatabasePostgresqlTools,
  registerDatabaseMssqlTools,
  registerDatabaseMongodbTools,
  registerDatabaseCacheTools,
  registerStorageObjectTools,
  registerStorageNcloudTools,
  registerContainersNksTools,
  registerContainersRegistryTools,
  registerActivityTracerTools,
  registerStorageNasTools,
  registerLogAnalyticsTools,
  registerCertificateManagerTools,
  registerSecurityMonitoringTools,
  registerCloudInsightTools,
  registerCloudInsightRuleTools,
  registerCloudInsightPluginTools,
  registerCloudInsightIntegrationTools,
  registerSourceCommitTools,
  registerSourceBuildTools,
  registerSourceDeployTools,
  registerSourcePipelineTools,
  registerGlobalEdgeTools,
  registerVodStationTools,
  registerLiveStationTools,
  registerImageOptimizerTools,
  registerSubAccountTools,
  registerApiGatewayTools,
  registerSensTools,
  registerSearchEngineServiceTools,
  registerCloudHadoopTools,
  registerCloudDataStreamingTools,
  registerDataStreamTools,
  registerCloudFunctionsTools,
  registerResourceManagerTools,
  registerGlobalDnsTools,
  registerGlobalTrafficManagerTools,
  registerStorageArchiveTools,
  registerDataCatalogTools,
  registerDataForestTools,
  registerCloudAdvisorTools,
  registerDataFlowTools,
  registerDataQueryTools,
  registerPrivateCaTools,
  registerKmsTools,
  registerBillingTools,
} from "./index.js";

const DEFAULT_BASE_URL =
  process.env.NCLOUD_API_URL ?? "https://ncloud.apigw.ntruss.com";

/**
 * 동적 로딩의 기본 그룹 세트(common은 always 라 제외).
 * - `NCLOUD_TOOL_GROUPS=dynamic` 옵트인 키워드가 켜는 핵심 IaaS 그룹 (v1.4.0)
 * - v2.0.0에서 "미설정 기본값"으로 전환 예정
 * Phase 0-2 실측(2026-06-14): common+compute+network+database = 367 tools / ~65k tokens
 * (전체 1,035 tools / ~177k tokens 대비 63% 절감). DESIGN_long-term-dynamic-groups.md §2.2 부록.
 */
export const DEFAULT_GROUP_KEYS = ["compute", "network", "database"];

/**
 * base URL별로 memoize 된 NcloudClient 팩토리.
 * 호출 시 해당 base URL 클라이언트를 반환하고, 리전 변경을 캐시된 전 클라이언트에 전파한다.
 */
export interface ClientFactory {
  /** base URL별 NcloudClient 반환. 인자 생략 시 기본 base URL. */
  (baseUrl?: string): NcloudClient;
  /** 캐시된 전 클라이언트 + 이후 신규 생성분에 리전을 적용. */
  setRegionAll(regionCode: string): void;
  /** 팩토리가 보관 중인 현재 리전(단일 소스). */
  getRegionCode(): string;
}

export interface RegisterCtx {
  server: McpServer;
  client: ClientFactory;
  regionCode: string;
  creds: { accessKey: string; secretKey: string };
  env: NodeJS.ProcessEnv;
}

export interface ToolGroup {
  key: string;
  title: string;
  /** common 처럼 그룹 선택과 무관하게 항상 등록. */
  always?: boolean;
  register: (ctx: RegisterCtx) => void;
}

/** creds + regionCode 로 base URL별 memoized NcloudClient 팩토리를 만든다. */
export function makeClientFactory(
  creds: { accessKey: string; secretKey: string },
  regionCode: string
): ClientFactory {
  const cache = new Map<string, NcloudClient>();
  // 단일 소스로 보관 — 신규 클라이언트도 이 값으로 생성한다(생성 시점 초기 리전 고정 잠복 버그 해결).
  let currentRegion = regionCode;

  const factory = ((baseUrl = DEFAULT_BASE_URL) => {
    let c = cache.get(baseUrl);
    if (!c) {
      c = new NcloudClient({ ...creds, baseUrl, regionCode: currentRegion });
      cache.set(baseUrl, c);
    }
    return c;
  }) as ClientFactory;

  factory.setRegionAll = (code: string) => {
    currentRegion = code;
    for (const c of cache.values()) c.setRegionCode(code);
  };
  factory.getRegionCode = () => currentRegion;

  return factory;
}

/**
 * 이름이 바뀐/분해된 옛 그룹 key → 안내 메시지.
 * 자동 매핑은 하지 않고(사용자 풀 사실상 0, 기능 도입 직후 안정화 단계),
 * 옛 key를 만나면 새 key를 알려주고 무시한다.
 */
const MOVED_GROUP_KEYS: Record<string, string> = {
  integration: "'application'으로 이름이 바뀌었습니다. 'application'을 사용하세요.",
  global: "'cdn'(Global Edge)과 'network'(Global DNS/Traffic Manager)로 나뉘었습니다. 'cdn' 또는 'network'를 사용하세요.",
};

export const TOOL_GROUPS: ToolGroup[] = [
  {
    key: "common",
    title: "Common (Region/Zone)",
    always: true,
    register: ({ server, client }) => {
      registerCommonTools(server, client);
    },
  },
  {
    key: "compute",
    title: "Compute (Server, Storage, Public IP, Auto Scaling, Cloud Functions)",
    register: ({ server, client, regionCode }) => {
      const c = client();
      registerComputeServerTools(server, c);
      registerComputeStorageTools(server, c);
      registerComputePublicIpTools(server, c);
      registerComputeLoginKeyTools(server, c);
      registerComputeInitScriptTools(server, c);
      registerComputePlacementTools(server, c);
      registerAutoScalingTools(server, c);

      // Cloud Functions는 region별 base URL
      const cloudFunctionsBaseUrlMap: Record<string, string> = {
        KR: "https://cloudfunctions.apigw.ntruss.com",
        SGN: "https://sg-cloudfunctions.apigw.ntruss.com",
        JPN: "https://jp-cloudfunctions.apigw.ntruss.com",
      };
      const cfBaseUrl =
        cloudFunctionsBaseUrlMap[regionCode] ?? "https://cloudfunctions.apigw.ntruss.com";
      registerCloudFunctionsTools(server, client(cfBaseUrl));
    },
  },
  {
    key: "network",
    title: "Network (VPC, ACG, LB, Target Group, Global DNS, Traffic Manager)",
    register: ({ server, client }) => {
      const c = client();
      registerVpcTools(server, c);
      registerAcgTools(server, c);
      registerNetworkAclTools(server, c);
      registerNatGatewayTools(server, c);
      registerRouteTableTools(server, c);
      registerVpcPeeringTools(server, c);
      registerNetworkInterfaceTools(server, c);
      registerLoadBalancerTools(server, c);
      registerTargetGroupTools(server, c);
      registerGlobalDnsTools(server, client("https://globaldns.apigw.ntruss.com"));
      registerGlobalTrafficManagerTools(server, client("https://globaltrafficmanager.apigw.ntruss.com"));
    },
  },
  {
    key: "database",
    title: "Database (MySQL, PostgreSQL, MSSQL, MongoDB, Cache)",
    register: ({ server, client }) => {
      const c = client();
      registerDatabaseMysqlTools(server, c);
      registerDatabasePostgresqlTools(server, c);
      registerDatabaseMssqlTools(server, c);
      registerDatabaseMongodbTools(server, c);
      registerDatabaseCacheTools(server, c);
    },
  },
  {
    key: "storage",
    title: "Storage (Object, Ncloud, NAS, Archive)",
    register: ({ server, client, creds, regionCode, env }) => {
      const s3Client = new S3CompatibleClient({
        ...creds,
        regionCode,
        storageType: "object",
      });
      const ncloudStorageClient = new S3CompatibleClient({
        ...creds,
        regionCode,
        storageType: "ncloud",
      });
      registerStorageObjectTools(server, s3Client);
      registerStorageNcloudTools(server, ncloudStorageClient);
      registerStorageNasTools(server, client());

      // Archive Storage는 NCLOUD_ARCHIVE_PROJECT_ID/DOMAIN_ID 가 있을 때만 (Swift 클라이언트)
      const archiveProjectId = env.NCLOUD_ARCHIVE_PROJECT_ID;
      const archiveDomainId = env.NCLOUD_ARCHIVE_DOMAIN_ID;
      if (archiveProjectId && archiveDomainId) {
        const swiftClient = new SwiftCompatibleClient({
          ...creds,
          projectId: archiveProjectId,
          domainId: archiveDomainId,
          regionCode,
        });
        registerStorageArchiveTools(server, swiftClient);
      }
    },
  },
  {
    key: "containers",
    title: "Containers (NKS, Container Registry)",
    register: ({ server, client }) => {
      registerContainersNksTools(server, client("https://nks.apigw.ntruss.com"));
      registerContainersRegistryTools(server, client("https://ncr.apigw.ntruss.com"));
    },
  },
  {
    key: "monitoring",
    title: "Monitoring (Cloud Insight, Log Analytics)",
    register: ({ server, client }) => {
      registerLogAnalyticsTools(server, client("https://cloudloganalytics.apigw.ntruss.com"));
      const cw = client("https://cw.apigw.ntruss.com");
      registerCloudInsightTools(server, cw);
      registerCloudInsightRuleTools(server, cw);
      registerCloudInsightPluginTools(server, cw);
      registerCloudInsightIntegrationTools(server, cw);
    },
  },
  {
    key: "governance",
    title: "Management & Governance (Activity Tracer, Cloud Advisor, Resource Manager, Sub Account)",
    register: ({ server, client }) => {
      registerActivityTracerTools(server, client("https://cloudactivitytracer.apigw.ntruss.com"));
      registerCloudAdvisorTools(server, client("https://cloud-advisor.apigw.ntruss.com"));
      registerResourceManagerTools(server, client("https://resourcemanager.apigw.ntruss.com"));
      registerSubAccountTools(server, client("https://subaccount.apigw.ntruss.com"));
    },
  },
  {
    key: "devtools",
    title: "DevTools (SourceCommit, SourceBuild, SourceDeploy, SourcePipeline)",
    register: ({ server, client }) => {
      registerSourceCommitTools(server, client("https://sourcecommit.apigw.ntruss.com"));
      registerSourceBuildTools(server, client("https://sourcebuild.apigw.ntruss.com"));
      registerSourceDeployTools(server, client("https://vpcsourcedeploy.apigw.ntruss.com"));
      registerSourcePipelineTools(server, client("https://vpcsourcepipeline.apigw.ntruss.com"));
    },
  },
  {
    key: "analytics",
    title: "Analytics (SES, Hadoop, CDSS, Data Stream/Catalog/Forest/Flow/Query)",
    register: ({ server, client }) => {
      registerSearchEngineServiceTools(server, client("https://vpcsearchengine.apigw.ntruss.com"));
      registerCloudHadoopTools(server, client());
      registerCloudDataStreamingTools(server, client("https://clouddatastreamingservice.apigw.ntruss.com"));
      registerDataStreamTools(
        server,
        client("https://datastream.apigw.ntruss.com"),
        client("https://api.datastream.naverncp.com")
      );
      registerDataCatalogTools(server, client("https://datacatalog.apigw.ntruss.com"));
      registerDataForestTools(server, client("https://df.apigw.ntruss.com"));
      registerDataFlowTools(server, client("https://dataflow.apigw.ntruss.com"));
      registerDataQueryTools(server, client("https://kr.dataquery.naverncp.com"));
    },
  },
  {
    key: "media",
    title: "Media (VOD Station, Live Station, Image Optimizer)",
    register: ({ server, client }) => {
      registerVodStationTools(server, client("https://vodstation.apigw.ntruss.com"));
      registerLiveStationTools(server, client("https://livestation.apigw.ntruss.com"));
      registerImageOptimizerTools(server, client("https://imageoptimizer.apigw.ntruss.com"));
    },
  },
  {
    key: "cdn",
    title: "Content Delivery (Global Edge)",
    register: ({ server, client }) => {
      registerGlobalEdgeTools(server, client("https://edge.apigw.ntruss.com"));
    },
  },
  {
    key: "security",
    title: "Security (Certificate Manager, Private CA, KMS, Security Monitoring)",
    register: ({ server, client }) => {
      registerCertificateManagerTools(server, client("https://certificatemanager.apigw.ntruss.com"));
      registerPrivateCaTools(server, client("https://pca.apigw.ntruss.com"));
      registerKmsTools(server, client("https://ocapi.ncloud.com"));
      registerSecurityMonitoringTools(server, client("https://securitymonitoring.apigw.ntruss.com"));
    },
  },
  {
    key: "application",
    title: "Application (API Gateway, SENS)",
    register: ({ server, client }) => {
      registerApiGatewayTools(server, client("https://apigateway.apigw.ntruss.com"));
      registerSensTools(server, client("https://sens.apigw.ntruss.com"));
    },
  },
  {
    key: "billing",
    title: "Billing (List Price, Cost and Usage, Discount)",
    register: ({ server, client }) => {
      registerBillingTools(server, client("https://billingapi.apigw.ntruss.com"));
    },
  },
];

/**
 * env 파싱 결과 — "시작 시 ON 집합"과 "동적 enable 가능 범위"를 분리해 담는다.
 * DESIGN_long-term-dynamic-groups.md §2.3·§2.4.
 */
export interface GroupPlan {
  /** 시작 시 등록할 그룹(always 포함). */
  startup: ToolGroup[];
  /** 시작 시 ON 인 그룹 key 집합(always 포함). */
  startupKeys: Set<string>;
  /** `-key`로 운영자가 명시 제외한 그룹 — 동적 enable 도 거부(보안 경계). */
  blocked: Set<string>;
  /** 런타임 확장(메타 도구) 허용 여부 — `dynamic` 키워드가 있을 때만 true. */
  expandable: boolean;
}

/**
 * `NCLOUD_TOOL_GROUPS` env 값을 파싱해 그룹 플랜을 만든다.
 *
 * - 미설정/빈 값 → 전체 ON (기존 동작과 동일, 잠금)
 * - `dynamic` → 기본 세트(§2.2, common + DEFAULT_GROUP_KEYS)만 ON + **런타임 확장 허용**
 * - `compute,network,billing` → 해당 그룹 + always(common), **잠금(확장 불가)**
 * - `all,-billing` → 전부 켜되 billing 제외, **billing 은 동적 enable 도 차단**
 *
 * 런타임 확장(메타 도구)은 **`dynamic` 키워드가 있을 때만** 켜진다. 명시 리스트·`all`·미설정은
 * "딱 이것만"을 의미하는 잠금 상태 — LLM 이 스스로 도구 표면을 넓힐 수 없다.
 * 알 수 없는/옛 key 는 stderr 경고만 출력하고 무시한다.
 */
export function planGroups(raw: string | undefined): GroupPlan {
  const known = new Set(TOOL_GROUPS.map((g) => g.key));
  const tokens = (raw ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  // 미설정 → 전체 ON (잠금)
  if (tokens.length === 0) {
    const startupKeys = new Set(known);
    return { startup: TOOL_GROUPS, startupKeys, blocked: new Set(), expandable: false };
  }

  let startAll = false;
  let expandable = false;
  const selected = new Set<string>();
  const blocked = new Set<string>();

  for (const token of tokens) {
    if (token === "all") {
      startAll = true;
      continue;
    }
    if (token === "dynamic") {
      // "확장 허용 모드" + 핵심 세트 주입을 겸한다.
      expandable = true;
      for (const k of DEFAULT_GROUP_KEYS) selected.add(k);
      continue;
    }
    const isExclude = token.startsWith("-");
    const key = isExclude ? token.slice(1) : token;
    if (MOVED_GROUP_KEYS[key]) {
      console.error(`Warning: 그룹 key '${key}'는 ${MOVED_GROUP_KEYS[key]} (이번 요청에서는 무시됨)`);
      continue;
    }
    if (!known.has(key)) {
      console.error(`Warning: 알 수 없는 NCLOUD_TOOL_GROUPS 그룹 "${key}" — 무시합니다.`);
      continue;
    }
    if (isExclude) {
      blocked.add(key);
      selected.delete(key);
    } else {
      selected.add(key);
    }
  }

  const startupKeys = new Set<string>(startAll ? known : selected);
  for (const b of blocked) startupKeys.delete(b);
  for (const g of TOOL_GROUPS) if (g.always) startupKeys.add(g.key);

  return {
    startup: TOOL_GROUPS.filter((g) => startupKeys.has(g.key)),
    startupKeys,
    blocked,
    expandable,
  };
}

/**
 * 하위호환 래퍼 — 시작 시 등록할 그룹만 반환한다.
 * 기존 호출부(index.ts 초기 버전·dump/measure 스크립트·테스트)와 동일 시그니처 유지.
 */
export function resolveGroups(raw: string | undefined): ToolGroup[] {
  return planGroups(raw).startup;
}

/** 선택된 그룹을 순회하며 도구를 등록한다. */
export function registerGroups(ctx: RegisterCtx, groups: ToolGroup[]): void {
  for (const group of groups) {
    group.register(ctx);
  }
}

/** ncloud_enable_tool_group 한 번의 결과(throw 금지 — 항상 정상 응답으로 안내). */
export interface EnableOutcome {
  status: "enabled" | "already-enabled" | "blocked" | "unknown" | "moved";
  group: string;
  message: string;
  /** 이번 enable 로 새로 등록된 도구 수. */
  registeredToolCount?: number;
  /** 대표 도구 예시(최대 5개). */
  sampleTools?: string[];
  /** unknown/moved 시 안내할 동적 enable 가능 그룹 목록. */
  availableGroups?: string[];
  /** list_changed 미지원 클라이언트용 폴백 안내(§2.5). */
  fallbackHint?: string;
}

/**
 * 세션 동안의 그룹 ON/OFF 상태를 보관하고, 런타임에 그룹을 lazy 등록한다.
 *
 * - `start()`: 시작 시 ON 그룹 등록 + (동적 enable 가능 시) 메타 도구 등록.
 * - `enable(key)`: 그룹 register 클로저를 그대로 실행(현 레지스트리 구조 무변경).
 *   connect 이후 등록이므로 SDK 가 tools/list_changed 를 발송(통지 폭주는 서버 생성 시
 *   debouncedNotificationMethods 로 1회로 합침 — index.ts).
 */
export class GroupManager {
  private enabledKeys = new Set<string>();
  private countCache = new Map<string, number>();

  constructor(
    private ctx: RegisterCtx,
    public readonly plan: GroupPlan
  ) {}

  /** 시작 시 ON 그룹 등록 + (동적 enable 가능 시) 메타 도구 등록. */
  start(): void {
    for (const group of this.plan.startup) {
      group.register(this.ctx);
      this.enabledKeys.add(group.key);
    }
    if (this.plan.expandable && this.enableableKeys().length > 0) {
      registerMetaTools(this.ctx.server, this);
    }
  }

  /** 현재 ON 인 그룹 key (always 포함). */
  enabledGroupKeys(): string[] {
    return [...this.enabledKeys];
  }

  /** 동적으로 켤 수 있는 그룹 key (시작 ON·always·blocked 제외). */
  enableableKeys(): string[] {
    return TOOL_GROUPS.filter(
      (g) => !g.always && !this.plan.startupKeys.has(g.key) && !this.plan.blocked.has(g.key)
    ).map((g) => g.key);
  }

  /** 그룹이 등록하는 도구 수를 가짜 서버에 dry-run 등록해 센다(API 호출 없음). */
  private toolCountOf(key: string): number {
    const cached = this.countCache.get(key);
    if (cached !== undefined) return cached;
    const group = TOOL_GROUPS.find((g) => g.key === key);
    if (!group) return 0;
    let n = 0;
    const fakeServer = {
      registerTool: () => {
        n++;
      },
      tool: () => {
        n++;
      },
    } as unknown as McpServer;
    group.register({ ...this.ctx, server: fakeServer });
    this.countCache.set(key, n);
    return n;
  }

  /** ncloud_list_tool_groups 응답 페이로드. */
  catalog() {
    const groups = TOOL_GROUPS.filter((g) => !g.always).map((g) => {
      const blocked = this.plan.blocked.has(g.key);
      const enabled = this.enabledKeys.has(g.key);
      return {
        key: g.key,
        title: g.title,
        toolCount: this.toolCountOf(g.key),
        status: blocked ? "blocked" : enabled ? "enabled" : "available",
        ...(blocked
          ? { note: `Operator-disabled via NCLOUD_TOOL_GROUPS=...,-${g.key}; cannot be enabled at runtime.` }
          : {}),
      };
    });
    return {
      expandable: this.plan.expandable,
      enabledGroups: [...this.enabledKeys],
      groups,
      hint: "Call ncloud_enable_tool_group with a group key to load its tools into this session.",
    };
  }

  /** 그룹을 런타임에 활성화한다. 중복·미지원·차단·옛 key 는 모두 정상 응답으로 안내. */
  enable(rawKey: string): EnableOutcome {
    const key = (rawKey ?? "").trim().toLowerCase();

    // moved key (옛 이름) — unknown 과 분리해 새 이름을 안내(§2.4)
    if (MOVED_GROUP_KEYS[key]) {
      return {
        status: "moved",
        group: key,
        message: `Group '${key}' ${MOVED_GROUP_KEYS[key]}`,
        availableGroups: this.enableableKeys(),
      };
    }

    const group = TOOL_GROUPS.find((g) => g.key === key);
    if (!group) {
      return {
        status: "unknown",
        group: key,
        message: `No tool group named '${key}'. Choose one of the available groups.`,
        availableGroups: this.enableableKeys(),
      };
    }
    if (this.plan.blocked.has(key)) {
      return {
        status: "blocked",
        group: key,
        message: `Group '${key}' was explicitly disabled by the operator (NCLOUD_TOOL_GROUPS=...,-${key}) and cannot be enabled at runtime.`,
      };
    }
    if (group.always || this.enabledKeys.has(key)) {
      return {
        status: "already-enabled",
        group: key,
        message: `Group '${key}' is already enabled. No tools were added.`,
        registeredToolCount: 0,
      };
    }

    // 등록하며 도구 이름 수집 — server.registerTool 을 일시 래핑(SDK 내부 의존 없음).
    const names: string[] = [];
    const server = this.ctx.server as unknown as {
      registerTool: (name: string, config: unknown, cb: unknown) => unknown;
    };
    const orig = server.registerTool.bind(server);
    server.registerTool = (name, config, cb) => {
      names.push(name);
      return orig(name, config, cb);
    };
    try {
      group.register(this.ctx);
    } finally {
      server.registerTool = orig;
    }
    this.enabledKeys.add(key);
    this.countCache.set(key, names.length);

    return {
      status: "enabled",
      group: key,
      message: `Enabled group '${key}'. ${names.length} tools are now available in this session.`,
      registeredToolCount: names.length,
      sampleTools: pickSampleTools(names),
      fallbackHint: `If the new tools do not appear, restart your MCP client with NCLOUD_TOOL_GROUPS=all (or add '${key}' to your config).`,
    };
  }
}

/**
 * 등록된 도구 이름에서 서비스별로 고루 대표 예시를 뽑는다.
 * 그룹은 모듈을 고정 순서로 등록하므로 단순 `slice(0, N)`은 첫 모듈에 쏠린다
 * (예: governance → Activity Tracer만 보이고 Sub Account는 누락). `ncloud_<service>_...`
 * 의 service(두 번째 토큰)별로 버킷팅한 뒤 라운드로빈해 각 서비스가 최소 1개씩 보이게 한다.
 */
function pickSampleTools(names: string[], max = 8): string[] {
  const buckets = new Map<string, string[]>();
  for (const n of names) {
    const svc = n.split("_")[1] ?? n;
    let bucket = buckets.get(svc);
    if (!bucket) {
      bucket = [];
      buckets.set(svc, bucket);
    }
    bucket.push(n);
  }
  const lists = [...buckets.values()];
  const out: string[] = [];
  for (let i = 0; out.length < max; i++) {
    let progressed = false;
    for (const list of lists) {
      if (i < list.length) {
        out.push(list[i]);
        progressed = true;
        if (out.length >= max) break;
      }
    }
    if (!progressed) break;
  }
  return out;
}

/** enable 도구 description 에 내장할 그룹 카탈로그 문자열을 만든다(§2.1, 불변 조건 2). */
function buildEnableCatalogText(): string {
  return TOOL_GROUPS.filter((g) => !g.always)
    .map((g) => {
      const m = g.title.match(/\(([^)]*)\)/);
      return `${g.key} (${m ? m[1] : g.title})`;
    })
    .join(", ");
}

/**
 * 메타 도구(그룹 카탈로그 조회 + 런타임 활성화)를 등록한다.
 * `start()`에서 동적 enable 가능 시에만 호출 — always 그룹과 같은 수명으로 동작한다.
 */
export function registerMetaTools(server: McpServer, manager: GroupManager): void {
  defineTool(
    server,
    "ncloud_list_tool_groups",
    "List all Ncloud tool groups with their services, tool counts, and current enabled/available/blocked status. Use this to discover which group to enable for a requested service.",
    {},
    async () => manager.catalog(),
    // 로컬 상태만 조회 — 외부 API 무관
    { annotations: { readOnlyHint: true, openWorldHint: false } }
  );

  defineTool(
    server,
    "ncloud_enable_tool_group",
    `Enable an Ncloud tool group at runtime so its tools become callable in the current session (no server restart needed). Available groups: ${buildEnableCatalogText()}. Enabling is idempotent — already-enabled groups return without adding tools.`,
    {
      group: z
        .string()
        .describe("Group key to enable, e.g. 'analytics', 'storage', 'monitoring'. See ncloud_list_tool_groups for the full list."),
    },
    async ({ group }) => manager.enable(group),
    // 로컬 상태 변경(도구 등록), 클라우드 무관 — 멱등(§2.1)
    { annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false } }
  );
}
