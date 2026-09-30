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

export type Zone = "public" | "gov";
export const ZONES: readonly Zone[] = ["public", "gov"] as const;

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
  cloudfunctions: { public: apigw("cloudfunctions", "public"), gov: apigw("cloudfunctions", "gov") },
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
  wms: { gov: apigw("wms", "gov") }, // 공공존 전용 (Web Service Monitoring)
  // ── devtools ──
  sourceCommit: { public: apigw("sourcecommit", "public"), gov: apigw("sourcecommit", "gov") },
  sourceBuild: { public: apigw("sourcebuild", "public"), gov: apigw("sourcebuild", "gov") },
  sourceDeploy: { public: apigw("vpcsourcedeploy", "public"), gov: apigw("vpcsourcedeploy", "gov") },
  sourcePipeline: { public: apigw("vpcsourcepipeline", "public"), gov: apigw("vpcsourcepipeline", "gov") },
  // ── analytics ──
  searchEngine: { public: apigw("vpcsearchengine", "public"), gov: apigw("vpcsearchengine", "gov") },
  dataStreaming: { public: apigw("clouddatastreamingservice", "public"), gov: apigw("clouddatastreamingservice", "gov") },
  dataStream: { public: apigw("datastream", "public") },
  dataCatalog: { public: apigw("datacatalog", "public") },
  dataForest: { public: apigw("df", "public") },
  dataFlow: { public: apigw("dataflow", "public") },
  dataQuery: { public: "https://kr.dataquery.naverncp.com" },
  // ── media ──
  vodStation: { public: apigw("vodstation", "public"), gov: "https://vod-station.apigw.gov-ntruss.com" }, // 불규칙
  liveStation: { public: apigw("livestation", "public") },
  imageOptimizer: { public: apigw("imageoptimizer", "public") },
  multiDrm: { gov: "https://multi-drm.apigw.gov-ntruss.com" }, // 공공존 전용
  // ── cdn ──
  globalEdge: { public: apigw("edge", "public") },
  cdnPlus: { gov: ZONE_PROFILES.gov.defaultGateway }, // 공공존 전용, 기본 게이트웨이
  globalCdn: { gov: ZONE_PROFILES.gov.defaultGateway }, // 공공존 전용, 기본 게이트웨이
  // ── security ──
  certificateManager: { public: apigw("certificatemanager", "public"), gov: apigw("certificatemanager", "gov") },
  privateCa: { public: apigw("pca", "public"), gov: "https://privateca.apigw.gov-ntruss.com" }, // 불규칙
  securityMonitoring: { public: apigw("securitymonitoring", "public"), gov: apigw("securitymonitoring", "gov") },
  kms: { public: "https://ocapi.ncloud.com", gov: "https://ocapi.gov-ncloud.com" }, // apigw 아님
  // ── application ──
  apiGateway: { public: apigw("apigateway", "public") },
  sens: { public: apigw("sens", "public") },
  outboundMailer: { public: apigw("mail", "public") },
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
