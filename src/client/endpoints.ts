/**
 * 존(민간존 `public` / 공공존 `gov`)별 엔드포인트·리전 카탈로그의 **단일 소스**.
 *
 * 두 존은 인증(x-ncp-apigw-timestamp / x-ncp-iam-access-key / x-ncp-apigw-signature-v2,
 * HMAC-SHA256)·파라미터·응답 형식이 동일하고, 다음만 다르다.
 *   - API Gateway 도메인: `*.apigw.ntruss.com` ↔ `*.apigw.gov-ntruss.com`
 *     (일부 서비스는 서브도메인 자체가 다름 — `SERVICE_ENDPOINTS` 참조)
 *   - 리전: 민간존 KR/SGN/JPN/USWN/DEN ↔ 공공존 KR(KR-CENTRAL)/KRS(KR-SOUTH)
 *   - 서비스 카탈로그: 존별로 제공되지 않는 서비스가 있다(`gov`/`public` 키 부재 = 미제공)
 *
 * 근거 문서
 *   - 민간존: https://api.ncloud-docs.com/docs/common-ncpapi ,
 *            https://api.ncloud-docs.com/docs/platform-region-getregionlist
 *   - 공공존: https://api-gov.ncloud-docs.com/docs/common-ncpapi-ncpapi ,
 *            https://api-gov.ncloud-docs.com/docs/platform-region-getregionlist ,
 *            https://api-gov.ncloud-docs.com/docs/compute-server (base `https://ncloud.apigw.gov-ntruss.com`)
 *
 * 존 선택은 env `NCLOUD_ZONE` (기본 `pub`) — 기존 민간존 사용자는 아무 변경 없이 동작한다.
 */

export type Zone = "pub" | "gov" | "fin";
export const ZONES: readonly Zone[] = ["pub", "gov", "fin"] as const;

export interface RegionInfo {
  /** API 리전 코드 (`regionCode`). */
  code: string;
  /** 한국어 표시명 — `ncloud_set_region` 입력 별칭 겸용. */
  ko: string;
  /** getRegionList 의 `regionName`. */
  en: string;
}

export interface ZoneProfile {
  zone: Zone;
  label: { ko: string; en: string };
  /** 대부분의 API(Server/VPC/DB/NAS 등)가 쓰는 기본 API Gateway. */
  defaultGateway: string;
  /** `{service}.apigw.{suffix}` 규칙형 서브도메인의 접미. */
  apigwSuffix: string;
  console: string;
  docs: string;
  /**
   * `ncloud_set_region` 화이트리스트. getRegionList 의 특수 리전 `COM`(Common, regionNo 0)은
   * 배포 리전이 아니므로 제외한다.
   */
  regions: readonly RegionInfo[];
  defaultRegion: string;
}

export const ZONE_PROFILES: Record<Zone, ZoneProfile> = {
  pub: {
    zone: "pub",
    label: { ko: "민간존", en: "Public" },
    defaultGateway: "https://ncloud.apigw.ntruss.com",
    apigwSuffix: "apigw.ntruss.com",
    console: "https://console.ncloud.com",
    docs: "https://api.ncloud-docs.com/docs/home",
    regions: [
      { code: "KR", ko: "한국", en: "Korea" },
      { code: "JPN", ko: "일본", en: "Japan(New)" },
      { code: "SGN", ko: "싱가포르", en: "Singapore(New)" },
      { code: "USWN", ko: "미국", en: "US-West(New)" },
      { code: "DEN", ko: "독일", en: "Germany(New)" },
    ],
    defaultRegion: "KR",
  },
  gov: {
    zone: "gov",
    label: { ko: "공공존", en: "Government" },
    defaultGateway: "https://ncloud.apigw.gov-ntruss.com",
    apigwSuffix: "apigw.gov-ntruss.com",
    console: "https://console.gov-ncloud.com",
    docs: "https://api-gov.ncloud-docs.com/docs",
    regions: [
      { code: "KR", ko: "한국", en: "KR-CENTRAL" },
      { code: "KRS", ko: "한국남부", en: "KR-SOUTH" },
    ],
    defaultRegion: "KR",
  },
  // 금융존 — 근거: https://api-fin.ncloud-docs.com/docs/common-ncpapi (`*.apigw.fin-ntruss.com`, 인증 동일),
  //   https://api-fin.ncloud-docs.com/docs/compute-vserver (기본 게이트웨이 `fin-ncloud.apigw.fin-ntruss.com` — `fin-` 접두 주의),
  //   https://api-fin.ncloud-docs.com/docs/platform-region-getregionlist (COM / FKR "Korea(finance)").
  //   ⚠️ 금융존은 서비스별 호스트가 규칙형이 아니다(예: SES `fin-vpcsearchengine…`, Billing `billingapi.apigw-pub…`) —
  //   SERVICE_ENDPOINTS 의 `fin` 값은 그룹별 가이드 대조가 끝난 서비스만 리터럴로 적는다.
  fin: {
    zone: "fin",
    label: { ko: "금융존", en: "Financial" },
    defaultGateway: "https://fin-ncloud.apigw.fin-ntruss.com",
    apigwSuffix: "apigw.fin-ntruss.com",
    console: "https://console.fin-ncloud.com",
    docs: "https://api-fin.ncloud-docs.com/docs/api-overview",
    regions: [{ code: "FKR", ko: "한국(금융)", en: "Korea(finance)" }],
    defaultRegion: "FKR",
  },
};

export function isZone(value: unknown): value is Zone {
  return typeof value === "string" && (ZONES as readonly string[]).includes(value);
}

/**
 * env `NCLOUD_ZONE` → Zone. 미설정/빈 값은 `pub`(하위호환). 대소문자·공백 무시.
 * 알 수 없는 값은 조용히 민간존으로 가지 않도록 **throw** 한다(자격증명이 다른 존으로 가면 안 됨).
 */
export function resolveZone(env: NodeJS.ProcessEnv = process.env): Zone {
  const raw = (env.NCLOUD_ZONE ?? "").trim().toLowerCase();
  if (raw === "") return "pub";
  if (isZone(raw)) return raw;
  throw new Error(
    `NCLOUD_ZONE 환경 변수 값이 올바르지 않습니다: "${env.NCLOUD_ZONE}". 사용 가능한 값: ${ZONES.join(", ")}`
  );
}

/** 기본 API Gateway. `NCLOUD_API_URL` 이 있으면 존과 무관하게 그것을 우선한다(기존 동작 유지). */
export function defaultGateway(zone: Zone, env: NodeJS.ProcessEnv = process.env): string {
  return env.NCLOUD_API_URL ?? ZONE_PROFILES[zone].defaultGateway;
}

/** `{name}.apigw.{존 접미}` 규칙형 서브도메인 URL. */
function apigw(name: string, zone: Zone): string {
  return `https://${name}.${ZONE_PROFILES[zone].apigwSuffix}`;
}

/**
 * 서비스별 존 엔드포인트. 키가 없는 존 = 해당 존 미제공(레지스트리가 등록을 건너뜀).
 *
 * - `gov` 값의 출처: 공공존 API 가이드(https://api-gov.ncloud-docs.com/docs) 및 ncloud-gov-mcp-server v0.2.0.
 *   각 그룹을 통합하는 단계에서 해당 서비스 가이드로 재확인한다(아래 `verified` 주석 참고).
 * - 규칙형(서브도메인 동일)은 `apigw()` 로, 불규칙(서브도메인이 다름)은 리터럴로 적는다.
 */
export const SERVICE_ENDPOINTS = {
  // ── compute ──
  // 민간존은 리전별 호스트(KR/SGN/JPN)가 따로 있다 — registry 에서 regionCode 로 분기. 공공존은 단일.
  cloudfunctions: { pub: apigw("cloudfunctions", "pub"), gov: apigw("cloudfunctions", "gov"), fin: "https://cloudfunctions.apigw.fin-ntruss.com" }, // fin: API v2.1(/ncf/api/v2), platform 쿼리 없음·VPC 전용 (compute-cloudfunctions, -v2-putaction)
  cloudfunctionsSgn: { pub: "https://sg-cloudfunctions.apigw.ntruss.com" },
  cloudfunctionsJpn: { pub: "https://jp-cloudfunctions.apigw.ntruss.com" },
  // ── network ──
  globaldns: { pub: apigw("globaldns", "pub"), gov: apigw("globaldns", "gov"), fin: "https://globaldns.apigw.fin-ntruss.com" }, // fin: networking-globaldns-* 14 op 동일
  globaltrafficmanager: { pub: apigw("globaltrafficmanager", "pub"), gov: apigw("globaltrafficmanager", "gov") }, // 금융존 미제공(2026-09-30, api-fin 404)
  // ── database ──
  clouddbServerless: { pub: apigw("clouddb-serverless", "pub") },
  // ── containers ──
  nks: { pub: apigw("nks", "pub"), gov: apigw("nks", "gov"), fin: "https://nks.apigw.fin-ntruss.com" }, // fin 경로 접두는 /nks/v2 (vnks 아님)
  ncr: { pub: apigw("ncr", "pub"), gov: "https://gov-ncr.apigw.gov-ntruss.com", fin: "https://ncr.apigw.fin-ntruss.com" }, // gov 불규칙, fin 규칙형(/ncr/api/v2)
  // ── monitoring ──
  cloudInsight: { pub: apigw("cw", "pub"), gov: apigw("cw", "gov"), fin: "https://cw.apigw.fin-ntruss.com" },
  cloudLogAnalytics: { pub: apigw("cloudloganalytics", "pub"), gov: apigw("cloudloganalytics", "gov"), fin: "https://cloudloganalytics.apigw.fin-ntruss.com" },
  // ── governance ──
  activityTracer: { pub: apigw("cloudactivitytracer", "pub"), gov: apigw("cloudactivitytracer", "gov"), fin: "https://cloudactivitytracer.apigw.fin-ntruss.com" },
  cloudAdvisor: { pub: apigw("cloud-advisor", "pub") }, // 민간존 전용 (api-gov·api-fin 에 management-cloud-advisor-* 없음)
  resourceManager: { pub: apigw("resourcemanager", "pub"), gov: apigw("resourcemanager", "gov"), fin: "https://resourcemanager.apigw.fin-ntruss.com" },
  subAccount: { pub: apigw("subaccount", "pub"), gov: apigw("subaccount", "gov"), fin: "https://subaccount.apigw.fin-ntruss.com" },
  // STS(임시 자격 증명·호출자 식별): 세 존 규칙형 호스트 (guide slugs management-sts, get-caller-identity, switch-role — 접두 없는 슬러그, 2026-10-02 대조)
  sts: { pub: apigw("sts", "pub"), gov: apigw("sts", "gov"), fin: "https://sts.apigw.fin-ntruss.com" },
  wms: { pub: apigw("wms", "pub"), gov: apigw("wms", "gov"), fin: "https://wms.apigw.fin-ntruss.com" }, // Web service Monitoring System — 세 존 제공(management-wms, 2026-09-30 확인)
  // ── devtools ──
  sourceCommit: { pub: apigw("sourcecommit", "pub"), gov: apigw("sourcecommit", "gov"), fin: "https://sourcecommit.apigw.fin-ntruss.com" },
  sourceBuild: { pub: apigw("sourcebuild", "pub"), gov: apigw("sourcebuild", "gov"), fin: "https://sourcebuild.apigw.fin-ntruss.com" },
  // SourceDeploy/SourcePipeline: 민간·공공존은 Classic(source*)·VPC(vpcsource*) 호스트가 따로 있고 이 서버는 VPC 를 쓴다.
  // 금융존은 호스트가 하나뿐(sourcedeploy.apigw.fin-ntruss.com — devtools-sourcedeploy 개요, vpc 접두 없음), 경로 동일.
  sourceDeploy: { pub: apigw("vpcsourcedeploy", "pub"), gov: apigw("vpcsourcedeploy", "gov"), fin: "https://sourcedeploy.apigw.fin-ntruss.com" },
  sourcePipeline: { pub: apigw("vpcsourcepipeline", "pub"), gov: apigw("vpcsourcepipeline", "gov"), fin: "https://sourcepipeline.apigw.fin-ntruss.com" },
  // ── analytics ──
  // 금융존 SES/CDSS 호스트는 `fin-` 접두가 붙는 불규칙형 (analytics-vpcsearchengine / analytics-clouddatastreamingservice 개요, 2026-09-30).
  searchEngine: { pub: apigw("vpcsearchengine", "pub"), gov: apigw("vpcsearchengine", "gov"), fin: "https://fin-vpcsearchengine.apigw.fin-ntruss.com" },
  dataStreaming: { pub: apigw("clouddatastreamingservice", "pub"), gov: apigw("clouddatastreamingservice", "gov"), fin: "https://fin-clouddatastreamingservice.apigw.fin-ntruss.com" },
  dataStream: { pub: apigw("datastream", "pub") },
  dataStreamProduce: { pub: "https://api.datastream.naverncp.com" }, // Data Stream 레코드 전송(produce) 전용 호스트

  dataCatalog: { pub: apigw("datacatalog", "pub") },
  dataForest: { pub: apigw("df", "pub") },
  dataFlow: { pub: apigw("dataflow", "pub") },
  dataQuery: { pub: "https://kr.dataquery.naverncp.com" },
  // ── media ──
  vodStation: { pub: apigw("vodstation", "pub"), gov: "https://vod-station.apigw.gov-ntruss.com", fin: "https://vodstation.apigw.fin-ntruss.com" }, // gov 불규칙; fin 은 Private 게이트웨이(vodstation 개요)
  // Live Station 금융존: 호스트는 민간존 게이트웨이 그대로이고 경로 접두만 `/api/fin-v2` (api-fin media-livestation 개요·전 op 원문, 2026-09-30). liveStationPathPrefix() 참고.
  liveStation: { pub: apigw("livestation", "pub"), fin: "https://livestation.apigw.ntruss.com" },
  multiDrm: { pub: "https://multi-drm.apigw.ntruss.com", gov: "https://multi-drm.apigw.gov-ntruss.com" }, // 두 존 제공(one-click-multi-drm-api-overview), x-ncp-region_code: KR
  // ── cdn ──
  // Global Edge 만 래핑한다. CDN+ / Global CDN 은 2026-12-31 서비스 종료 예정(신규 생성 불가)이라 두 존 모두 이식하지 않는다(2026-09-30 결정).
  globalEdge: { pub: apigw("edge", "pub"), gov: apigw("edge", "gov") }, // 두 존 제공(edge-overview, 오퍼레이션 18종 동일)
  // ── security ──
  certificateManager: { pub: apigw("certificatemanager", "pub"), gov: apigw("certificatemanager", "gov"), fin: "https://certificatemanager.apigw.fin-ntruss.com" },
  privateCa: { pub: apigw("pca", "pub"), gov: "https://privateca.apigw.gov-ntruss.com" }, // gov 불규칙; fin 미제공(security-privateca 없음)
  securityMonitoring: { pub: apigw("securitymonitoring", "pub"), gov: apigw("securitymonitoring", "gov") }, // fin 미제공
  // KMS: 민간·공공존은 API 2.0(ocapi.*, security-kms2-*, apigw 아님). 금융존 가이드에는 2.0 이 없고 v1 게이트웨이(kms.apigw.fin-ntruss.com,
  //   security-kms-* 6 op: encrypt/decrypt/createCustomKey/reencrypt/sign/verify, 경로 /keys/v2/{keyTag}/…)만 있다 → security-kms.ts 참고.
  kms: { pub: "https://ocapi.ncloud.com", gov: "https://ocapi.gov-ncloud.com", fin: "https://kms.apigw.fin-ntruss.com" },
  // ── application ──
  // 세 서비스 모두 두 존 제공(ai-application-service-apigateway / sens-overview / ai-application-service-cloudoutboundmailer, 2026-09-30).
  // 민간존은 2026-09-17 Cloud Outbound Mailer 가 SENS 로 흡수(메일 = SENS /mail/v2, 레거시 Mailer 는 이관 프로젝트 한정),
  // 공공존은 SENS(Project/SMS/알림톡/브랜드메시지, 메일 채널 없음)와 Cloud Outbound Mailer 가 **별개 서비스**로 유지된다.
  apiGateway: { pub: apigw("apigateway", "pub"), gov: apigw("apigateway", "gov"), fin: "https://apigateway.apigw.fin-ntruss.com" },
  sens: { pub: apigw("sens", "pub"), gov: apigw("sens", "gov"), fin: "https://sens.apigw.fin-ntruss.com" }, // sens-overview 세 존; 메일 채널은 민간존만
  outboundMailer: { pub: apigw("mail", "pub"), gov: apigw("mail", "gov"), fin: "https://mail.apigw.fin-ntruss.com" }, // gov·fin 은 별개 정식 서비스
  // ── billing ──
  // 금융존 Billing 은 공개형 게이트웨이 `apigw-pub` 도메인(platform-listprice/costandusage/discount 개요, 2026-09-30), 경로 /billing/v1 동일.
  billing: { pub: apigw("billingapi", "pub"), gov: apigw("billingapi", "gov"), fin: "https://billingapi.apigw-pub.fin-ntruss.com" },
} as const satisfies Record<string, Partial<Record<Zone, string>>>;

export type ServiceKey = keyof typeof SERVICE_ENDPOINTS;

/** 서비스의 존 엔드포인트. 해당 존에서 제공하지 않으면 `undefined`. */
export function endpoint(service: ServiceKey, zone: Zone): string | undefined {
  return (SERVICE_ENDPOINTS[service] as Partial<Record<Zone, string>>)[zone];
}

/** 해당 존에서 서비스를 제공하는지. */
export function isServiceAvailable(service: ServiceKey, zone: Zone): boolean {
  return endpoint(service, zone) !== undefined;
}

/**
 * S3 호환 스토리지(Object Storage / Ncloud Storage)와 Archive Storage(Swift)의 존별 호스트·서명 리전.
 * AWS SigV4 credential scope 의 리전 문자열은 문서의 "리전 이름" 열을 그대로 쓴다.
 *
 * 근거(2026-09-30 원문 확인)
 *   - Object Storage 민간존: https://api.ncloud-docs.com/docs/common-objectstorageapi-objectstorageapi
 *       한국 kr-standard kr.object.ncloudstorage.com · 미국서부 us-standard · 싱가포르 sg-standard ·
 *       일본 jp-standard jp.object.ncpstorage.com · 독일 de-standard
 *   - Object Storage 공공존: https://api-gov.ncloud-docs.com/docs/common-objectstorageapi-objectstorageapi
 *       수도권 gov-standard kr.object.gov-ncloudstorage.com · 남부권 gov2-standard krs.object.gov-ncloudstorage.com
 *   - Ncloud Storage 민간존: https://api.ncloud-docs.com/docs/storage-ncloudstorage — `{Bucket}.kr.ncloudstorage.com`, 리전 `kr` 만
 *   - Ncloud Storage 공공존: https://api-gov.ncloud-docs.com/docs/storage-ncloudstorage — `{Bucket}.kr.gov-ncloudstorage.com`, 리전 `kr` 만
 *   - Archive Storage 민간존: https://api.ncloud-docs.com/docs/common-archivestorageapi-archivestorageapi — kr.archive.ncloudstorage.com(:5000 인증)
 *   - Archive Storage 공공존: https://api-gov.ncloud-docs.com/docs/common-archivestorageapi-archivestorageapi — kr.archive.gov-ncloudstorage.com(:5000 인증)
 */
export interface S3RegionEndpoint {
  /** 서비스 루트 호스트(버킷 제외). */
  host: string;
  /** SigV4 credential scope 리전 이름. */
  signingRegion: string;
}

export const OBJECT_STORAGE_ENDPOINTS: Record<Zone, Record<string, S3RegionEndpoint>> = {
  pub: {
    KR: { host: "kr.object.ncloudstorage.com", signingRegion: "kr-standard" },
    USWN: { host: "us.object.ncloudstorage.com", signingRegion: "us-standard" },
    SGN: { host: "sg.object.ncloudstorage.com", signingRegion: "sg-standard" },
    JPN: { host: "jp.object.ncpstorage.com", signingRegion: "jp-standard" },
    DEN: { host: "de.object.ncloudstorage.com", signingRegion: "de-standard" },
  },
  gov: {
    KR: { host: "kr.object.gov-ncloudstorage.com", signingRegion: "gov-standard" },
    KRS: { host: "krs.object.gov-ncloudstorage.com", signingRegion: "gov2-standard" },
  },
  // 금융존: https://api-fin.ncloud-docs.com/docs/common-objectstorageapi-objectstorageapi — 리전 "금융" fin-standard kr.object.fin-ncloudstorage.com (단일)
  fin: { FKR: { host: "kr.object.fin-ncloudstorage.com", signingRegion: "fin-standard" } },
};

/** Ncloud Storage — 민간·공공존 KR 단일 리전, 서명 리전은 문서의 리전 코드 `kr`. 금융존 가이드에는 없음(storage-ncloudstorage 404, 2026-09-30) → fin 빈 표. */
export const NCLOUD_STORAGE_ENDPOINTS: Record<Zone, Record<string, S3RegionEndpoint>> = {
  pub: { KR: { host: "kr.ncloudstorage.com", signingRegion: "kr" } },
  gov: { KR: { host: "kr.gov-ncloudstorage.com", signingRegion: "kr" } },
  fin: {},
};

export interface SwiftRegionEndpoint {
  /** Keystone v3 인증 URL (`/v3/auth/tokens` 앞까지). */
  auth: string;
  /** Swift API URL (`/v1/AUTH_{project}` 앞까지). */
  api: string;
}

/** Archive Storage(OpenStack Swift) — 민간·공공존 KR 단일 리전. 금융존 가이드에는 없음(common-archivestorageapi 404, 2026-09-30) → fin 빈 표. */
export const ARCHIVE_STORAGE_ENDPOINTS: Record<Zone, Record<string, SwiftRegionEndpoint>> = {
  pub: { KR: { auth: "https://kr.archive.ncloudstorage.com:5000", api: "https://kr.archive.ncloudstorage.com" } },
  gov: { KR: { auth: "https://kr.archive.gov-ncloudstorage.com:5000", api: "https://kr.archive.gov-ncloudstorage.com" } },
  fin: {},
};

/** 존에 S3 호환/Swift 엔드포인트 표가 하나라도 있는지 — registry 가 스토리지 도구 등록 여부를 정할 때 쓴다. */
export function hasStorageEndpoints(table: Record<Zone, Record<string, unknown>>, zone: Zone): boolean {
  return Object.keys(table[zone]).length > 0;
}

/**
 * NKS(Ncloud Kubernetes Service) REST 경로 접두 — 리전이 **경로**에 들어간다(호스트는 존별 단일).
 *   민간존: KR `/vnks/v2`, SGN `/vnks/sgn-v2`, JPN `/vnks/jpn-v2`  (https://api.ncloud-docs.com/docs/nks-getclusterlist 등 각 op 페이지)
 *   공공존: KR `/vnks/v2`, KRS `/vnks/krs-v2`                      (https://api-gov.ncloud-docs.com/docs/nks-getclusterlist)
 * 표에 없는 리전은 `/vnks/v2`.
 */
export function nksPathPrefix(zone: Zone, regionCode: string): string {
  // 금융존은 접두 자체가 다르다: `/nks/v2` (https://api-fin.ncloud-docs.com/docs/nks-getclusterlist, nks-addsubnet — `vnks` 아님).
  const table: Record<Zone, Record<string, string>> = {
    pub: { KR: "/vnks/v2", SGN: "/vnks/sgn-v2", JPN: "/vnks/jpn-v2" },
    gov: { KR: "/vnks/v2", KRS: "/vnks/krs-v2" },
    fin: { FKR: "/nks/v2" },
  };
  return table[zone][regionCode.toUpperCase()] ?? (zone === "fin" ? "/nks/v2" : "/vnks/v2");
}

/**
 * Container Registry(NCR) REST 경로 접두 — 역시 리전이 경로에 들어가며 존별로 규칙이 다르다.
 *   민간존: KR `/ncr/api/v2`, SGN `/ncr/sgn-api/v2`, JPN `/ncr/jpn-api/v2` (https://api.ncloud-docs.com/docs/containerregistry-getregistry)
 *   공공존: KR `/ncr/kr/v2`, KRS `/ncr/krs/v2`, 호스트 `gov-ncr.apigw.gov-ntruss.com` (https://api-gov.ncloud-docs.com/docs/containerregistry-getregistry)
 */
export function ncrPathPrefix(zone: Zone, regionCode: string): string {
  const table: Record<Zone, Record<string, string>> = {
    pub: { KR: "/ncr/api/v2", SGN: "/ncr/sgn-api/v2", JPN: "/ncr/jpn-api/v2" },
    gov: { KR: "/ncr/kr/v2", KRS: "/ncr/krs/v2" },
    fin: { FKR: "/ncr/api/v2" }, // https://api-fin.ncloud-docs.com/docs/containerregistry-getregistry
  };
  return table[zone][regionCode.toUpperCase()] ?? table[zone]["KR"] ?? "/ncr/api/v2";
}

/**
 * Search Engine Service(SES) / Cloud Data Streaming Service(CDSS) REST 경로 접두 — 리전이 경로에 들어간다.
 *   SES  민간존 KR `/api/v2` · SGN `/api/sgn-v2` · JPN `/api/jpn-v2`, 공공존 KR `/api/v2` · KRS `/api/krs-v2`
 *        (analytics-vpcsearchengine-cluster-getclusterinfolist, 두 존 원문 2026-09-30)
 *   CDSS 민간존 KR `/api/v1` · SGN `/api/sgn-v1` · JPN `/api/jpn-v1`, 공공존 KR `/api/v1` · KRS `/api/krs-v1`
 *        (analytics-clouddatastreamingservice-cluster-getclusterinfolist)
 */
function regionApiPrefix(zone: Zone, regionCode: string, version: string): string {
  const r = regionCode.toUpperCase();
  // 금융존(FKR)은 리전 세그먼트 없이 `/api/v2` · `/api/v1` (fin cluster-getclusterinfolist 원문, 2026-09-30).
  const seg = zone === "pub" ? ({ SGN: "sgn-", JPN: "jpn-" } as Record<string, string>)[r] : zone === "gov" ? ({ KRS: "krs-" } as Record<string, string>)[r] : undefined;
  return `/api/${seg ?? ""}${version}`;
}
export function sesPathPrefix(zone: Zone, regionCode: string): string {
  return regionApiPrefix(zone, regionCode, "v2");
}
/**
 * Live Station 경로 접두. 민간존 `/api/v2`, 금융존 `/api/fin-v2` (같은 호스트 livestation.apigw.ntruss.com —
 * api-fin media-livestation-channel-channellist 등 원문, 2026-09-30). 공공존은 미제공.
 */
export function liveStationPathPrefix(zone: Zone): string {
  return zone === "fin" ? "/api/fin-v2" : "/api/v2";
}
export function cdssPathPrefix(zone: Zone, regionCode: string): string {
  return regionApiPrefix(zone, regionCode, "v1");
}

/**
 * Cloud Functions base URL. 민간존은 리전별 호스트(KR / SGN / JPN — 미지의 리전은 KR 호스트),
 * 공공존은 단일 호스트(`cloudfunctions.apigw.gov-ntruss.com`, API v2.0 Classic 전용).
 * 근거: https://api.ncloud-docs.com/docs/compute-cloudfunctions , https://api-gov.ncloud-docs.com/docs/compute-cloudfunctions
 */
export function cloudFunctionsEndpoint(zone: Zone, regionCode: string): string {
  if (zone === "pub") {
    if (regionCode === "SGN") return SERVICE_ENDPOINTS.cloudfunctionsSgn.pub;
    if (regionCode === "JPN") return SERVICE_ENDPOINTS.cloudfunctionsJpn.pub;
  }
  return endpoint("cloudfunctions", zone) as string;
}
