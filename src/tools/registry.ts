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
 * `NCLOUD_TOOL_GROUPS` env 값을 파싱해 등록할 그룹 집합을 결정한다.
 *
 * - 미설정/빈 값 → 전체 ON (기존 동작과 동일)
 * - `compute,network,billing` → 해당 그룹 + always(common)
 * - `all,-billing` → 전부 켜되 billing 제외 (감산)
 *
 * 알 수 없는 key는 stderr 경고만 출력하고 무시한다.
 */
export function resolveGroups(raw: string | undefined): ToolGroup[] {
  const known = new Set(TOOL_GROUPS.map((g) => g.key));
  const tokens = (raw ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

  // 미설정 → 전체 ON
  if (tokens.length === 0) {
    return TOOL_GROUPS;
  }

  const startAll = tokens.includes("all");
  const selected = new Set<string>(startAll ? known : []);

  for (const token of tokens) {
    if (token === "all") continue;
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
    if (isExclude) selected.delete(key);
    else selected.add(key);
  }

  return TOOL_GROUPS.filter((g) => g.always || selected.has(g.key));
}

/** 선택된 그룹을 순회하며 도구를 등록한다. */
export function registerGroups(ctx: RegisterCtx, groups: ToolGroup[]): void {
  for (const group of groups) {
    group.register(ctx);
  }
}
