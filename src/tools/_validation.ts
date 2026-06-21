/**
 * 핸들러 공용 검증 헬퍼 + 검증 메시지 (v1.7.0, DESIGN_post-1.6.0 §5).
 *
 * v1.6.1에서 핸들러 검증 **문구**는 `_messages.ts`(`L`/템플릿)로 i18n됐다. 이 모듈은
 * 그 위에 **검증 로직 자체**(리전 화이트리스트·리소스 타입 매핑)를 한 곳에 모은다.
 * 검증 테이블이 늘어날 때 모듈마다 흩어지지 않게 하는 단일 소스다.
 *
 * - 반환 메시지는 `_messages.ts`의 `L`을 거쳐 `NCLOUD_LANG`으로 ko/en 전환.
 * - 공개 표면(도구 이름·schemaKeys)은 건드리지 않는다 — 런타임 응답 텍스트만 관여.
 */

import { L } from "./_messages.js";

// ─── 리전 ──────────────────────────────────────────────────────────────────

/** 한국어 리전명 → 코드. */
const REGION_NAME_MAP: Record<string, string> = {
  "한국": "KR",
  "일본": "JPN",
  "싱가포르": "SGN",
  "미국": "USWN",
  "독일": "DEN",
};

/** 리전 코드 → 한국어 리전명(유효 코드 화이트리스트 겸용). */
const REGION_CODE_MAP: Record<string, string> = {
  KR: "한국",
  JPN: "일본",
  SGN: "싱가포르",
  USWN: "미국",
  DEN: "독일",
};

/** 코드의 한국어 표시명. 미지의 코드는 코드 그대로 반환. */
export function regionName(code: string): string {
  return REGION_CODE_MAP[code] ?? code;
}

/**
 * 입력(코드 또는 한국어명)을 정규화된 리전 코드로 해석한다.
 * 화이트리스트에 없으면 `null`(호출자가 `invalidRegionMessage`로 안내).
 */
export function resolveRegionCode(input: string): string | null {
  const code = REGION_NAME_MAP[input] ?? input.toUpperCase();
  return REGION_CODE_MAP[code] ? code : null;
}

/** "유효하지 않은 리전" 검증 메시지(ko/en). */
export function invalidRegionMessage(input: string): string {
  return L({
    ko: `유효하지 않은 리전입니다: "${input}". 사용 가능한 리전: KR, JPN, SGN, USWN, DEN (또는 한국, 일본, 싱가포르, 미국, 독일)`,
    en: `Invalid region: "${input}". Available regions: KR, JPN, SGN, USWN, DEN (or 한국, 일본, 싱가포르, 미국, 독일).`,
  });
}

// ─── 리소스 타입(운영 상태 조회) ──────────────────────────────────────────────

/** 운영 상태 조회용 리소스 타입 → 상세 조회 API 경로·식별자 키. */
export const RESOURCE_DETAIL_MAP: Record<string, { apiPath: string; paramKey: string }> = {
  server: { apiPath: "/vserver/v2/getServerInstanceDetail", paramKey: "serverInstanceNo" },
  vpc: { apiPath: "/vpc/v2/getVpcDetail", paramKey: "vpcNo" },
  subnet: { apiPath: "/vpc/v2/getSubnetDetail", paramKey: "subnetNo" },
  loadbalancer: { apiPath: "/vloadbalancer/v2/getLoadBalancerInstanceDetail", paramKey: "loadBalancerInstanceNo" },
  targetGroup: { apiPath: "/vloadbalancer/v2/getTargetGroupDetail", paramKey: "targetGroupNo" },
  natGateway: { apiPath: "/vpc/v2/getNatGatewayInstanceDetail", paramKey: "natGatewayInstanceNo" },
  mysqlInstance: { apiPath: "/vmysql/v2/getCloudMysqlInstanceDetail", paramKey: "cloudMysqlInstanceNo" },
  blockStorage: { apiPath: "/vserver/v2/getBlockStorageInstanceDetail", paramKey: "blockStorageInstanceNo" },
  publicIp: { apiPath: "/vserver/v2/getPublicIpInstanceDetail", paramKey: "publicIpInstanceNo" },
  acg: { apiPath: "/vserver/v2/getAccessControlGroupDetail", paramKey: "accessControlGroupNo" },
  networkAcl: { apiPath: "/vpc/v2/getNetworkAclDetail", paramKey: "networkAclNo" },
  autoScalingGroup: { apiPath: "/vautoscaling/v2/getAutoScalingGroupDetail", paramKey: "autoScalingGroupNo" },
};

/** "지원하지 않는 리소스 타입" 검증 메시지(ko/en). */
export function unsupportedResourceTypeMessage(resourceType: string): string {
  return L({ ko: `지원하지 않는 리소스 타입: ${resourceType}`, en: `Unsupported resource type: ${resourceType}` });
}
