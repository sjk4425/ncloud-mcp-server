/**
 * 그룹 단위 도구 레지스트리.
 *
 * 64개 서비스 모듈을 13개 그룹(+always common)으로 묶고, env `NCLOUD_TOOL_GROUPS`로
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

export interface RegisterCtx {
  server: McpServer;
  /** base URL별로 memoize 된 NcloudClient 팩토리. 인자 생략 시 기본 base URL. */
  client: (baseUrl?: string) => NcloudClient;
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
): (baseUrl?: string) => NcloudClient {
  const cache = new Map<string, NcloudClient>();
  return (baseUrl = DEFAULT_BASE_URL) => {
    let c = cache.get(baseUrl);
    if (!c) {
      c = new NcloudClient({ ...creds, baseUrl, regionCode });
      cache.set(baseUrl, c);
    }
    return c;
  };
}

export const TOOL_GROUPS: ToolGroup[] = [
  {
    key: "common",
    title: "Common (Region/Zone)",
    always: true,
    register: ({ server, client }) => {
      registerCommonTools(server, client());
    },
  },
  {
    key: "compute",
    title: "Compute (Server, Storage, Public IP, Auto Scaling)",
    register: ({ server, client }) => {
      const c = client();
      registerComputeServerTools(server, c);
      registerComputeStorageTools(server, c);
      registerComputePublicIpTools(server, c);
      registerComputeLoginKeyTools(server, c);
      registerComputeInitScriptTools(server, c);
      registerComputePlacementTools(server, c);
      registerAutoScalingTools(server, c);
    },
  },
  {
    key: "network",
    title: "Network (VPC, ACG, LB, Target Group)",
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
    title: "Monitoring (Cloud Insight, Activity Tracer, Log Analytics, Cloud Advisor)",
    register: ({ server, client }) => {
      registerActivityTracerTools(server, client("https://cloudactivitytracer.apigw.ntruss.com"));
      registerLogAnalyticsTools(server, client("https://cloudloganalytics.apigw.ntruss.com"));
      registerSecurityMonitoringTools(server, client("https://securitymonitoring.apigw.ntruss.com"));
      const cw = client("https://cw.apigw.ntruss.com");
      registerCloudInsightTools(server, cw);
      registerCloudInsightRuleTools(server, cw);
      registerCloudInsightPluginTools(server, cw);
      registerCloudInsightIntegrationTools(server, cw);
      registerCloudAdvisorTools(server, client("https://cloud-advisor.apigw.ntruss.com"));
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
    key: "global",
    title: "Global (Edge, DNS, Traffic Manager)",
    register: ({ server, client }) => {
      registerGlobalEdgeTools(server, client("https://edge.apigw.ntruss.com"));
      registerGlobalDnsTools(server, client("https://globaldns.apigw.ntruss.com"));
      registerGlobalTrafficManagerTools(server, client("https://globaltrafficmanager.apigw.ntruss.com"));
    },
  },
  {
    key: "security",
    title: "Security (Certificate Manager, Private CA, KMS, Sub Account)",
    register: ({ server, client }) => {
      registerCertificateManagerTools(server, client("https://certificatemanager.apigw.ntruss.com"));
      registerPrivateCaTools(server, client("https://pca.apigw.ntruss.com"));
      registerKmsTools(server, client("https://ocapi.ncloud.com"));
      registerSubAccountTools(server, client("https://subaccount.apigw.ntruss.com"));
    },
  },
  {
    key: "integration",
    title: "Integration (API Gateway, SENS, Cloud Functions, Resource Manager)",
    register: ({ server, client, regionCode }) => {
      registerApiGatewayTools(server, client("https://apigateway.apigw.ntruss.com"));
      registerSensTools(server, client("https://sens.apigw.ntruss.com"));

      // Cloud Functions는 region별 base URL
      const cloudFunctionsBaseUrlMap: Record<string, string> = {
        KR: "https://cloudfunctions.apigw.ntruss.com",
        SGN: "https://sg-cloudfunctions.apigw.ntruss.com",
        JPN: "https://jp-cloudfunctions.apigw.ntruss.com",
      };
      const cfBaseUrl =
        cloudFunctionsBaseUrlMap[regionCode] ?? "https://cloudfunctions.apigw.ntruss.com";
      registerCloudFunctionsTools(server, client(cfBaseUrl));

      registerResourceManagerTools(server, client("https://resourcemanager.apigw.ntruss.com"));
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
