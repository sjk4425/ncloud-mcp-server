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
 * 존 선택은 env `NCLOUD_ZONE` (기본 `public`) — 기존 민간존 사용자는 아무 변경 없이 동작한다.
 */

export type Zone = "public" | "gov" | "fin";
export const ZONES: readonly Zone[] = ["public", "gov", "fin"] as const;

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
  public: {
    zone: "public",
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
 * env `NCLOUD_ZONE` → Zone. 미설정/빈 값은 `public`(하위호환). 대소문자·공백 무시.
 * 알 수 없는 값은 조용히 민간존으로 가지 않도록 **throw** 한다(자격증명이 다른 존으로 가면 안 됨).
 */
export function resolveZone(env: NodeJS.ProcessEnv = process.env): Zone {
  const raw = (env.NCLOUD_ZONE ?? "").trim().toLowerCase();
  if (raw === "") return "public";
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
  cloudfunctions: { public: apigw("cloudfunctions", "public"), gov: apigw("cloudfunctions", "gov"), fin: "https://cloudfunctions.apigw.fin-ntruss.com" }, // fin: API v2.1(/ncf/api/v2), platform 쿼리 없음·VPC 전용 (compute-cloudfunctions, -v2-putaction)
  cloudfunctionsSgn: { public: "https://sg-cloudfunctions.apigw.ntruss.com" },
  cloudfunctionsJpn: { public: "https://jp-cloudfunctions.apigw.ntruss.com" },
  // ── network ──
  globaldns: { public: apigw("globaldns", "public"), gov: apigw("globaldns", "gov") },
  globaltrafficmanager: { public: apigw("globaltrafficmanager", "public"), gov: apigw("globaltrafficmanager", "gov") },
  // ── database ──
  clouddbServerless: { public: apigw("clouddb-serverless", "public") },
  // ── containers ──
  nks: { public: apigw("nks", "public"), gov: apigw("nks", "gov") },
  ncr: { public: apigw("ncr", "public"), gov: "https://gov-ncr.apigw.gov-ntruss.com" }, // 불규칙
  // ── monitoring ──
  cloudInsight: { public: apigw("cw", "public"), gov: apigw("cw", "gov") },
  cloudLogAnalytics: { public: apigw("cloudloganalytics", "public"), gov: apigw("cloudloganalytics", "gov") },
  // ── governance ──
  activityTracer: { public: apigw("cloudactivitytracer", "public"), gov: apigw("cloudactivitytracer", "gov") },
  cloudAdvisor: { public: apigw("cloud-advisor", "public") },
  resourceManager: { public: apigw("resourcemanager", "public"), gov: apigw("resourcemanager", "gov") },
  subAccount: { public: apigw("subaccount", "public"), gov: apigw("subaccount", "gov") },
  wms: { public: apigw("wms", "public"), gov: apigw("wms", "gov") }, // Web service Monitoring System — 두 존 제공(management-wms, 2026-09-30 확인)
  // ── devtools ──
  sourceCommit: { public: apigw("sourcecommit", "public"), gov: apigw("sourcecommit", "gov") },
  sourceBuild: { public: apigw("sourcebuild", "public"), gov: apigw("sourcebuild", "gov") },
  sourceDeploy: { public: apigw("vpcsourcedeploy", "public"), gov: apigw("vpcsourcedeploy", "gov") },
  sourcePipeline: { public: apigw("vpcsourcepipeline", "public"), gov: apigw("vpcsourcepipeline", "gov") },
  // ── analytics ──
  searchEngine: { public: apigw("vpcsearchengine", "public"), gov: apigw("vpcsearchengine", "gov") },
  dataStreaming: { public: apigw("clouddatastreamingservice", "public"), gov: apigw("clouddatastreamingservice", "gov") },
  dataStream: { public: apigw("datastream", "public") },
  dataStreamProduce: { public: "https://api.datastream.naverncp.com" }, // Data Stream 레코드 전송(produce) 전용 호스트

  dataCatalog: { public: apigw("datacatalog", "public") },
  dataForest: { public: apigw("df", "public") },
  dataFlow: { public: apigw("dataflow", "public") },
  dataQuery: { public: "https://kr.dataquery.naverncp.com" },
  // ── media ──
  vodStation: { public: apigw("vodstation", "public"), gov: "https://vod-station.apigw.gov-ntruss.com" }, // 불규칙
  liveStation: { public: apigw("livestation", "public") },
  imageOptimizer: { public: apigw("imageoptimizer", "public") },
  multiDrm: { public: "https://multi-drm.apigw.ntruss.com", gov: "https://multi-drm.apigw.gov-ntruss.com" }, // 두 존 제공(one-click-multi-drm-api-overview), x-ncp-region_code: KR
  // ── cdn ──
  // Global Edge 만 래핑한다. CDN+ / Global CDN 은 2026-12-31 서비스 종료 예정(신규 생성 불가)이라 두 존 모두 이식하지 않는다(2026-09-30 결정).
  globalEdge: { public: apigw("edge", "public"), gov: apigw("edge", "gov") }, // 두 존 제공(edge-overview, 오퍼레이션 18종 동일)
  // ── security ──
  certificateManager: { public: apigw("certificatemanager", "public"), gov: apigw("certificatemanager", "gov") },
  privateCa: { public: apigw("pca", "public"), gov: "https://privateca.apigw.gov-ntruss.com" }, // 불규칙
  securityMonitoring: { public: apigw("securitymonitoring", "public"), gov: apigw("securitymonitoring", "gov") },
  kms: { public: "https://ocapi.ncloud.com", gov: "https://ocapi.gov-ncloud.com" }, // apigw 아님
  // ── application ──
  // 세 서비스 모두 두 존 제공(ai-application-service-apigateway / sens-overview / ai-application-service-cloudoutboundmailer, 2026-09-30).
  // 민간존은 2026-09-17 Cloud Outbound Mailer 가 SENS 로 흡수(메일 = SENS /mail/v2, 레거시 Mailer 는 이관 프로젝트 한정),
  // 공공존은 SENS(Project/SMS/알림톡/브랜드메시지, 메일 채널 없음)와 Cloud Outbound Mailer 가 **별개 서비스**로 유지된다.
  apiGateway: { public: apigw("apigateway", "public"), gov: apigw("apigateway", "gov") },
  sens: { public: apigw("sens", "public"), gov: apigw("sens", "gov") },
  outboundMailer: { public: apigw("mail", "public"), gov: apigw("mail", "gov") },
  // ── billing ──
  billing: { public: apigw("billingapi", "public"), gov: apigw("billingapi", "gov") },
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
  public: {
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
  fin: {}, // storage 그룹 금융존 대조 전 — 빈 표이면 클라이언트가 명확한 오류를 낸다
};

/** Ncloud Storage — 민간·공공존 KR 단일 리전, 서명 리전은 문서의 리전 코드 `kr`. 금융존 가이드에는 없음(2026-09-30). */
export const NCLOUD_STORAGE_ENDPOINTS: Record<Zone, Record<string, S3RegionEndpoint>> = {
  public: { KR: { host: "kr.ncloudstorage.com", signingRegion: "kr" } },
  gov: { KR: { host: "kr.gov-ncloudstorage.com", signingRegion: "kr" } },
  fin: {},
};

export interface SwiftRegionEndpoint {
  /** Keystone v3 인증 URL (`/v3/auth/tokens` 앞까지). */
  auth: string;
  /** Swift API URL (`/v1/AUTH_{project}` 앞까지). */
  api: string;
}

/** Archive Storage(OpenStack Swift) — 두 존 모두 KR 단일 리전. */
export const ARCHIVE_STORAGE_ENDPOINTS: Record<Zone, Record<string, SwiftRegionEndpoint>> = {
  public: { KR: { auth: "https://kr.archive.ncloudstorage.com:5000", api: "https://kr.archive.ncloudstorage.com" } },
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
  const table: Record<Zone, Record<string, string>> = {
    public: { KR: "/vnks/v2", SGN: "/vnks/sgn-v2", JPN: "/vnks/jpn-v2" },
    gov: { KR: "/vnks/v2", KRS: "/vnks/krs-v2" },
    fin: {}, // containers 그룹 금융존 대조 전
  };
  return table[zone][regionCode.toUpperCase()] ?? "/vnks/v2";
}

/**
 * Container Registry(NCR) REST 경로 접두 — 역시 리전이 경로에 들어가며 존별로 규칙이 다르다.
 *   민간존: KR `/ncr/api/v2`, SGN `/ncr/sgn-api/v2`, JPN `/ncr/jpn-api/v2` (https://api.ncloud-docs.com/docs/containerregistry-getregistry)
 *   공공존: KR `/ncr/kr/v2`, KRS `/ncr/krs/v2`, 호스트 `gov-ncr.apigw.gov-ntruss.com` (https://api-gov.ncloud-docs.com/docs/containerregistry-getregistry)
 */
export function ncrPathPrefix(zone: Zone, regionCode: string): string {
  const table: Record<Zone, Record<string, string>> = {
    public: { KR: "/ncr/api/v2", SGN: "/ncr/sgn-api/v2", JPN: "/ncr/jpn-api/v2" },
    gov: { KR: "/ncr/kr/v2", KRS: "/ncr/krs/v2" },
    fin: {}, // containers 그룹 금융존 대조 전
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
  const seg = zone === "public" ? ({ SGN: "sgn-", JPN: "jpn-" } as Record<string, string>)[r] : ({ KRS: "krs-" } as Record<string, string>)[r];
  return `/api/${seg ?? ""}${version}`;
}
export function sesPathPrefix(zone: Zone, regionCode: string): string {
  return regionApiPrefix(zone, regionCode, "v2");
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
  if (zone === "public") {
    if (regionCode === "SGN") return SERVICE_ENDPOINTS.cloudfunctionsSgn.public;
    if (regionCode === "JPN") return SERVICE_ENDPOINTS.cloudfunctionsJpn.public;
  }
  return endpoint("cloudfunctions", zone) as string;
}
