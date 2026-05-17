#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { NcloudClient } from "./client/ncloud-client.js";
import { S3CompatibleClient } from "./client/s3-compatible-client.js";
import { SwiftCompatibleClient } from "./client/swift-compatible-client.js";
import { registerCommonTools, registerComputeServerTools, registerComputeStorageTools, registerComputePublicIpTools, registerComputeLoginKeyTools, registerComputeInitScriptTools, registerComputePlacementTools, registerVpcTools, registerAcgTools, registerNetworkAclTools, registerNatGatewayTools, registerRouteTableTools, registerVpcPeeringTools, registerNetworkInterfaceTools, registerLoadBalancerTools, registerTargetGroupTools, registerAutoScalingTools, registerDatabaseMysqlTools, registerDatabasePostgresqlTools, registerDatabaseMssqlTools, registerDatabaseMongodbTools, registerDatabaseCacheTools, registerStorageObjectTools, registerStorageNcloudTools, registerContainersNksTools, registerContainersRegistryTools, registerActivityTracerTools, registerStorageNasTools, registerLogAnalyticsTools, registerCertificateManagerTools, registerSecurityMonitoringTools, registerCloudInsightTools, registerCloudInsightRuleTools, registerCloudInsightPluginTools, registerCloudInsightIntegrationTools, registerSourceCommitTools, registerSourceBuildTools, registerSourceDeployTools, registerSourcePipelineTools, registerGlobalEdgeTools, registerVodStationTools, registerLiveStationTools, registerImageOptimizerTools, registerSubAccountTools, registerApiGatewayTools, registerSensTools, registerSearchEngineServiceTools, registerCloudHadoopTools, registerCloudDataStreamingTools, registerDataStreamTools, registerCloudFunctionsTools, registerResourceManagerTools, registerGlobalDnsTools, registerGlobalTrafficManagerTools, registerStorageArchiveTools, registerDataCatalogTools, registerDataForestTools, registerCloudAdvisorTools, registerDataFlowTools, registerDataQueryTools, registerPrivateCaTools, registerKmsTools, registerBillingTools } from "./tools/index.js";

// Validate required environment variables
const accessKey = process.env.NCLOUD_ACCESS_KEY;
const secretKey = process.env.NCLOUD_SECRET_KEY;

if (!accessKey) {
  console.error("Error: NCLOUD_ACCESS_KEY 환경 변수가 설정되지 않았습니다.");
  process.exit(1);
}

if (!secretKey) {
  console.error("Error: NCLOUD_SECRET_KEY 환경 변수가 설정되지 않았습니다.");
  process.exit(1);
}

const regionCode = process.env.NCLOUD_REGION ?? "KR";
const baseUrl = process.env.NCLOUD_API_URL ?? "https://ncloud.apigw.ntruss.com";

// Create NcloudClient for general APIs
const client = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl,
  regionCode,
});

// Create NcloudClient for Cloud Insight APIs
const cloudInsightClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: "https://cw.apigw.ntruss.com",
  regionCode,
});

// Create NcloudClient for Container Registry APIs
const ncrClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: "https://ncr.apigw.ntruss.com",
  regionCode,
});

// Create NcloudClient for Cloud Activity Tracer APIs
const activityTracerClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: "https://cloudactivitytracer.apigw.ntruss.com",
  regionCode,
});

// Create NcloudClient for SourceCommit APIs
const sourceCommitClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: "https://sourcecommit.apigw.ntruss.com",
  regionCode,
});

// Create NcloudClient for SourceBuild APIs
const sourceBuildClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: "https://sourcebuild.apigw.ntruss.com",
  regionCode,
});

// Create NcloudClient for SourceDeploy APIs (VPC)
const sourceDeployClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: "https://vpcsourcedeploy.apigw.ntruss.com",
  regionCode,
});

// Create NcloudClient for SourcePipeline APIs (VPC)
const sourcePipelineClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: "https://vpcsourcepipeline.apigw.ntruss.com",
  regionCode,
});

// Create NcloudClient for Global Edge APIs
const globalEdgeClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: "https://edge.apigw.ntruss.com",
  regionCode,
});

// Create NcloudClient for VOD Station APIs
const vodStationClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: "https://vodstation.apigw.ntruss.com",
  regionCode,
});

// Create NcloudClient for Live Station APIs
const liveStationClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: "https://livestation.apigw.ntruss.com",
  regionCode,
});

// Create NcloudClient for Image Optimizer APIs
const imageOptimizerClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: "https://imageoptimizer.apigw.ntruss.com",
  regionCode,
});

// Create NcloudClient for Sub Account (IAM) APIs
const subAccountClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: "https://subaccount.apigw.ntruss.com",
  regionCode,
});

// Create NcloudClient for Certificate Manager APIs (v2)
const certificateManagerClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: "https://certificatemanager.apigw.ntruss.com",
  regionCode,
});

// Create NcloudClient for API Gateway APIs
const apiGatewayClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: "https://apigateway.apigw.ntruss.com",
  regionCode,
});

// Create NcloudClient for SENS APIs
const sensClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: "https://sens.apigw.ntruss.com",
  regionCode,
});

// Create S3CompatibleClient for Object Storage APIs
const s3Client = new S3CompatibleClient({
  accessKey,
  secretKey,
  regionCode,
  storageType: "object",
});

// Create S3CompatibleClient for Ncloud Storage APIs
const ncloudStorageClient = new S3CompatibleClient({
  accessKey,
  secretKey,
  regionCode,
  storageType: "ncloud",
});

// Create MCP Server
const server = new McpServer({
  name: "ncloud-mcp-server",
  version: "1.0.0",
});

// Register all tools
registerCommonTools(server, client);
registerComputeServerTools(server, client);
registerComputeStorageTools(server, client);
registerComputePublicIpTools(server, client);
registerComputeLoginKeyTools(server, client);
registerComputeInitScriptTools(server, client);
registerComputePlacementTools(server, client);
registerVpcTools(server, client);
registerAcgTools(server, client);
registerNetworkAclTools(server, client);
registerNatGatewayTools(server, client);
registerRouteTableTools(server, client);
registerVpcPeeringTools(server, client);
registerNetworkInterfaceTools(server, client);
registerLoadBalancerTools(server, client);
registerTargetGroupTools(server, client);
registerAutoScalingTools(server, client);
registerDatabaseMysqlTools(server, client);
registerDatabasePostgresqlTools(server, client);
registerDatabaseMssqlTools(server, client);
registerDatabaseMongodbTools(server, client);
registerDatabaseCacheTools(server, client);
registerStorageObjectTools(server, s3Client);
registerStorageNcloudTools(server, ncloudStorageClient);
// Create NcloudClient for NKS (Ncloud Kubernetes Service) APIs
const nksClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: "https://nks.apigw.ntruss.com",
  regionCode,
});
registerContainersNksTools(server, nksClient);
registerContainersRegistryTools(server, ncrClient);
registerActivityTracerTools(server, activityTracerClient);
registerStorageNasTools(server, client);
registerLogAnalyticsTools(server, client);
registerCertificateManagerTools(server, certificateManagerClient);
registerSecurityMonitoringTools(server, client);
registerCloudInsightTools(server, cloudInsightClient);
registerCloudInsightRuleTools(server, cloudInsightClient);
registerCloudInsightPluginTools(server, cloudInsightClient);
registerCloudInsightIntegrationTools(server, cloudInsightClient);
registerSourceCommitTools(server, sourceCommitClient);
registerSourceBuildTools(server, sourceBuildClient);
registerSourceDeployTools(server, sourceDeployClient);
registerSourcePipelineTools(server, sourcePipelineClient);
registerGlobalEdgeTools(server, globalEdgeClient);
registerVodStationTools(server, vodStationClient);
registerLiveStationTools(server, liveStationClient);
registerImageOptimizerTools(server, imageOptimizerClient);
registerSubAccountTools(server, subAccountClient);
registerApiGatewayTools(server, apiGatewayClient);
registerSensTools(server, sensClient);

// Create NcloudClient for Search Engine Service APIs
const sesClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: "https://vpcsearchengine.apigw.ntruss.com",
  regionCode,
});
registerSearchEngineServiceTools(server, sesClient);
registerCloudHadoopTools(server, client);

// Create NcloudClient for Cloud Data Streaming Service (CDSS) APIs
const cdssClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: "https://clouddatastreamingservice.apigw.ntruss.com",
  regionCode,
});
registerCloudDataStreamingTools(server, cdssClient);

// Create NcloudClient for Data Stream APIs (Topic, Connector, Schema)
const dataStreamClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: "https://datastream.apigw.ntruss.com",
  regionCode,
});
// Create NcloudClient for Data Stream Message API (different base URL)
const dataStreamMessageClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: "https://api.datastream.naverncp.com",
  regionCode,
});
registerDataStreamTools(server, dataStreamClient, dataStreamMessageClient);

// Create NcloudClient for Cloud Functions APIs (region-specific base URL)
const cloudFunctionsBaseUrlMap: Record<string, string> = {
  KR: "https://cloudfunctions.apigw.ntruss.com",
  SGN: "https://sg-cloudfunctions.apigw.ntruss.com",
  JPN: "https://jp-cloudfunctions.apigw.ntruss.com",
};
const cloudFunctionsBaseUrl = cloudFunctionsBaseUrlMap[regionCode] ?? "https://cloudfunctions.apigw.ntruss.com";
const cloudFunctionsClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: cloudFunctionsBaseUrl,
  regionCode,
});
registerCloudFunctionsTools(server, cloudFunctionsClient);

// Create NcloudClient for Resource Manager APIs
const resourceManagerClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: "https://resourcemanager.apigw.ntruss.com",
  regionCode,
});
registerResourceManagerTools(server, resourceManagerClient);

// Create NcloudClient for Global DNS APIs
const globalDnsClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: "https://globaldns.apigw.ntruss.com",
  regionCode,
});
registerGlobalDnsTools(server, globalDnsClient);

// Create NcloudClient for Global Traffic Manager APIs
const gtmClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: "https://globaltrafficmanager.apigw.ntruss.com",
  regionCode,
});
registerGlobalTrafficManagerTools(server, gtmClient);

// Create NcloudClient for Data Catalog APIs
const dataCatalogClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: "https://datacatalog.apigw.ntruss.com",
  regionCode,
});
registerDataCatalogTools(server, dataCatalogClient);

// Create NcloudClient for Data Forest APIs
const dataForestClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: "https://df.apigw.ntruss.com",
  regionCode,
});
registerDataForestTools(server, dataForestClient);

// Create NcloudClient for Cloud Advisor APIs
const cloudAdvisorClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: "https://cloud-advisor.apigw.ntruss.com",
  regionCode,
});
registerCloudAdvisorTools(server, cloudAdvisorClient);

// Create NcloudClient for Data Flow APIs
const dataFlowClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: "https://dataflow.apigw.ntruss.com",
  regionCode,
});
registerDataFlowTools(server, dataFlowClient);

// Create NcloudClient for Data Query APIs
const dataQueryClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: "https://kr.dataquery.naverncp.com",
  regionCode,
});
registerDataQueryTools(server, dataQueryClient);

// Create NcloudClient for Private CA APIs
const privateCaClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: "https://pca.apigw.ntruss.com",
  regionCode,
});
registerPrivateCaTools(server, privateCaClient);

// Create NcloudClient for KMS API 2.0
const kmsClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: "https://ocapi.ncloud.com",
  regionCode,
});
registerKmsTools(server, kmsClient);

// Create NcloudClient for Billing APIs (List Price, Cost and Usage, Discount)
const billingClient = new NcloudClient({
  accessKey,
  secretKey,
  baseUrl: "https://billingapi.apigw.ntruss.com",
  regionCode,
});
registerBillingTools(server, billingClient);

// Create SwiftCompatibleClient for Archive Storage APIs (optional — requires NCLOUD_ARCHIVE_PROJECT_ID and NCLOUD_ARCHIVE_DOMAIN_ID)
const archiveProjectId = process.env.NCLOUD_ARCHIVE_PROJECT_ID;
const archiveDomainId = process.env.NCLOUD_ARCHIVE_DOMAIN_ID;
if (archiveProjectId && archiveDomainId) {
  const swiftClient = new SwiftCompatibleClient({
    accessKey,
    secretKey,
    projectId: archiveProjectId,
    domainId: archiveDomainId,
    regionCode,
  });
  registerStorageArchiveTools(server, swiftClient);
}

// Connect via stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
