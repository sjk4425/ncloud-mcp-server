/**
 * 도구 핸들러 레벨 사용자 응답 메시지의 i18n (v1.6.1, DESIGN_post-1.6.0 §1·§5).
 *
 * 클라이언트 통신 에러(401/403/429/타임아웃 등)는 `client/messages.ts`가 담당한다.
 * 이 모듈은 핸들러가 **직접 반환**하는 검증 에러·dryRun 프리뷰·성공 메시지를
 * `NCLOUD_LANG`으로 ko/en 전환한다. 기존엔 이 문구들이 하드코딩 한글이라
 * `NCLOUD_LANG=en` 사용자에게도 한글이 노출됐다.
 *
 * `NCLOUD_LANG` 해석은 `client/messages.ts`의 `getLang()` 단일 소스를 재사용해
 * 두 레이어가 같은 언어로 동작하게 한다(해석 분기 방지).
 *
 * - 반복 템플릿(dryRun 프리뷰·길이 제한·CIDR·삭제 성공)은 헬퍼 함수로 통일.
 * - 일회성 문구는 `L({ ko, en })`로 인라인 ko/en 쌍을 준다.
 */

import { getLang } from "../client/messages.js";

export { getLang };

/** 한/영 명사 쌍. dryRun·삭제 헬퍼에서 리소스 명을 전달할 때 사용. */
export interface Noun {
  ko: string;
  en: string;
}

/** 언어별 문자열 쌍에서 현재 `NCLOUD_LANG` 값을 고른다. 일회성 문구용. */
export function L(pair: { ko: string; en: string }): string {
  return getLang() === "en" ? pair.en : pair.ko;
}

const VERB: Record<"create" | "upload" | "apply", { ko: string; en: string }> = {
  create: { ko: "생성", en: "created" },
  upload: { ko: "업로드", en: "uploaded" },
  apply: { ko: "적용", en: "applied" },
};

/**
 * dryRun 프리뷰 표준 메시지. 모든 `create_*`/업로드/적용 도구의 미리보기 안내를 통일한다.
 * @param noun 리소스 명사(ko/en). 예: `{ ko: "서버", en: "server" }`.
 * @param verb 동작 동사. 기본 `create`. 업로드/구성 적용 도구는 `upload`/`apply`.
 */
export function dryRunMessage(noun: Noun, verb: "create" | "upload" | "apply" = "create"): string {
  const v = VERB[verb];
  return getLang() === "en"
    ? `Preview only — the ${noun.en} will not be ${v.en}. Call again with dryRun=false to execute.`
    : `이 요청은 실제 ${noun.ko}를 ${v.ko}하지 않습니다. dryRun=false로 호출하면 실행됩니다.`;
}

/**
 * "필수 파라미터 누락" 검증 메시지(zod `required_error`용).
 * `required_error`는 스키마 정의 시점(서버 시작/그룹 등록)에 평가되므로, 시작 시
 * `NCLOUD_LANG`이 고정돼 있어 언어가 올바르게 반영된다.
 */
export function requiredError(field: string): string {
  return getLang() === "en"
    ? `Required parameter '${field}' is missing.`
    : `필수 파라미터 '${field}'가 누락되었습니다.`;
}

/** "필드 길이 제한 초과" 검증 메시지. */
export function maxLenMessage(field: string, n: number): string {
  return getLang() === "en"
    ? `Invalid parameter: '${field}' must be ${n} characters or fewer.`
    : `잘못된 파라미터: '${field}'은 ${n}자 이하여야 합니다.`;
}

/** "CIDR 형식 아님" 검증 메시지. example은 양쪽 언어 공통(예: "10.0.0.0/16"). */
export function cidrMessage(field: string, example: string): string {
  return getLang() === "en"
    ? `Invalid parameter: '${field}' must be in CIDR notation (e.g. ${example}).`
    : `잘못된 파라미터: '${field}'은 CIDR 형식이어야 합니다 (예: ${example})`;
}

/**
 * "삭제 완료" 성공 메시지. resource는 식별자까지 포함한 명사구.
 * 예: `{ ko: "버킷 'my-bucket'", en: "bucket 'my-bucket'" }`.
 */
export function deletedMessage(resource: Noun): string {
  return getLang() === "en"
    ? `✅ ${resource.en} has been deleted.`
    : `✅ ${resource.ko}이(가) 삭제되었습니다.`;
}
