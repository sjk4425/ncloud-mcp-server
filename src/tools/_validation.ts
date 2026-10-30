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

import { z } from "zod";
import { L, requiredError } from "./_messages.js";
import { ZONE_PROFILES, type Zone, type RegionInfo } from "../client/endpoints.js";

// ─── 리전 ──────────────────────────────────────────────────────────────────
//
// 리전 카탈로그는 존별로 다르다(민간존 KR/JPN/SGN/USWN/DEN, 공공존 KR/KRS) — 단일 소스는
// `client/endpoints.ts` 의 ZONE_PROFILES 이고 여기서는 조회·검증만 한다. zone 인자 기본값은
// `public`(기존 호출부 하위호환)이며, 도구 핸들러는 `client.getZone()` 을 넘긴다.

/** 존의 set_region 화이트리스트(COM 등 특수 리전 제외). */
export function regionCatalog(zone: Zone = "pub"): readonly RegionInfo[] {
  return ZONE_PROFILES[zone].regions;
}

/** 코드의 한국어 표시명. 미지의 코드는 코드 그대로 반환. */
export function regionName(code: string, zone: Zone = "pub"): string {
  return regionCatalog(zone).find((r) => r.code === code)?.ko ?? code;
}

/**
 * 입력(코드 또는 한국어명)을 정규화된 리전 코드로 해석한다.
 * 화이트리스트에 없으면 `null`(호출자가 `invalidRegionMessage`로 안내).
 */
export function resolveRegionCode(input: string, zone: Zone = "pub"): string | null {
  const catalog = regionCatalog(zone);
  const byName = catalog.find((r) => r.ko === input);
  const code = byName?.code ?? input.toUpperCase();
  return catalog.some((r) => r.code === code) ? code : null;
}

/** "유효하지 않은 리전" 검증 메시지(ko/en). */
export function invalidRegionMessage(input: string, zone: Zone = "pub"): string {
  const catalog = regionCatalog(zone);
  const codes = catalog.map((r) => r.code).join(", ");
  const names = catalog.map((r) => r.ko).join(", ");
  return L({
    ko: `유효하지 않은 리전입니다: "${input}". 사용 가능한 리전: ${codes} (또는 ${names})`,
    en: `Invalid region: "${input}". Available regions: ${codes} (or ${names}).`,
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

// ─── analytics 계열(SES·CDSS) 생성 입력 규칙 ────────────────────────────────────
//
// 세 존 가이드 공통(createSearchEngineCluster / createCDSSCluster, 2026-10-29 대조). G2 생성 도구에 검사가 없어
// dryRun 이 잘못된 값을 그대로 통과시켰다(금융존 테스트). 스키마에 넣어 dryRun 에서도 걸러지게 한다.

/** 이름·관리자 ID: 3~15자, 영소문자로 시작, 영소문자·숫자·'-', 영소문자·숫자로 끝, '-' 연속 금지. */
const ANALYTICS_NAME = /^[a-z](?!.*--)[a-z0-9-]{1,13}[a-z0-9]$/;

export function analyticsName(field: string) {
  return z.string({ required_error: requiredError(field) }).regex(ANALYTICS_NAME, {
    message: `${field}: 3-15 chars of lowercase letters, numbers and '-' — start with a letter, end with a letter or number, no consecutive '-'`,
  });
}

/** 비밀번호: 8~20자, 금지 문자 ' " ` ₩ / & 와 공백. (영문·숫자·특수문자 조합 여부는 서버가 검사) */
export function analyticsPassword(field: string) {
  return z
    .string({ required_error: requiredError(field) })
    .min(8, { message: `${field}: 8-20 chars` })
    .max(20, { message: `${field}: 8-20 chars` })
    .regex(/^[^'"`₩/&\s]+$/, { message: `${field}: must not contain ' " \` ₩ / & or spaces` });
}

/** 스토리지 크기: 100~2000GB, 10GB 단위. */
export function storageSize100to2000(field: string) {
  return z.number({ required_error: requiredError(field) }).int().refine((n) => n >= 100 && n <= 2000 && n % 10 === 0, {
    message: `${field}: 100-2000 GB in 10 GB steps`,
  });
}
