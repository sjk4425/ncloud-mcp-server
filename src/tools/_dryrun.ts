/**
 * dryRun 프리뷰 표준 헬퍼 (MCP-BUG-REPORT_2026-09-01 B-8).
 *
 * 기존 프리뷰는 **입력 객체를 그대로 반향**했다. 입력 필드명이 API 파라미터명과
 * 다르거나(B-1) 필수 파라미터가 스키마에 아예 없으면(B-2·B-5·B-6) 프리뷰는 "정상"으로
 * 보이지만 실제 호출은 실패한다 — 미리보기가 결함을 가려버린다.
 *
 * 그래서 프리뷰는 입력이 아니라 **클라이언트에 실제로 넘길 요청 객체**를 보여준다.
 * `create_snapshot`(compute-storage.ts)이 쓰던 `{ endpoint, requestParams }` 형태를
 * 전 도구 공통 규약으로 올린 것이다.
 *
 * 사용 규칙:
 *  1. 핸들러에서 `apiParams`(전송 객체)를 **dryRun 분기보다 먼저** 만든다.
 *  2. 그 객체를 그대로 `requestParams`에 넘긴다. 입력 객체(`params`)를 넘기지 않는다.
 *  3. 기본값·경고 같은 부가 설명은 `notes`로 분리한다(전송 파라미터와 섞지 않는다).
 */

import { dryRunMessage, Noun } from "./_messages.js";

/**
 * 프리뷰에서 값을 가릴 파라미터. 이름에 이 패턴이 있으면 마스킹한다.
 *
 * 프리뷰가 **전송 객체 그대로**를 보여주게 되면서(B-8), 예전 손수 고른 필드 목록에는
 * 없던 자격증명이 프리뷰에 실리게 됐다 — MySQL·MongoDB·MSSQL·PostgreSQL 인스턴스 생성의
 * DB 계정 비밀번호, NAS의 CIFS 비밀번호, 서브 계정 로그인 비밀번호 등. 프리뷰 텍스트는
 * MCP 클라이언트로 반환돼 대화·로그에 남으므로 평문 노출을 만들면 안 된다.
 *
 * 식별자(`accessKey`, `loginId`)와 페이지네이션 토큰(`continuationToken`, `nextToken`)은
 * 비밀이 아니고 프리뷰에서 확인할 값이므로 가리지 않는다 — `keySecret`처럼 실제 비밀만 잡는다.
 */
const SECRET_KEY_PATTERN = /pass(word)?|secret|privatekey|credential/i;

/** 마스킹 표시. 길이만 남겨 "값이 실려 나간다"는 사실은 확인할 수 있게 한다. */
function maskSecret(value: unknown): string {
  const len = typeof value === "string" ? value.length : String(value ?? "").length;
  return `(redacted, ${len} chars)`;
}

/**
 * 전송 객체를 프리뷰용으로 정리한다.
 *  - `undefined` 필드 제거 — 실제 직렬화에서도 빠지므로 "전송된다"는 오해를 막는다.
 *  - 비밀 필드 마스킹 — 중첩 객체·배열까지 내려간다(`cloudMysqlUserList.N.password`처럼
 *    리스트 안에 비밀이 들어가는 도구가 있다).
 */
function redact(value: unknown): any {
  if (Array.isArray(value)) return value.map(redact);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue;
    out[key] = SECRET_KEY_PATTERN.test(key) ? maskSecret(v) : redact(v);
  }
  return out;
}

export interface DryRunPreviewOpts {
  /** 프리뷰 제목. 예: "🔍 Dry-Run Preview: Cache Instance Creation" */
  label: string;
  /** 호출 대상 경로. 예: "/vcache/v2/createCloudCacheInstance" */
  endpoint: string;
  /** 기본 "GET" — Ncloud 일반 API는 생성/삭제도 GET이다. POST/PUT 계열만 명시한다. */
  method?: string;
  /**
   * 실제 전송할 값(쿼리 파라미터 또는 JSON 본문). 입력 에코 금지.
   * 일부 API는 본문이 최상위 배열이므로(예: NKS addons) 배열도 허용한다.
   */
  requestParams: Record<string, unknown> | unknown[];
  /** dryRun 안내 문구에 쓸 리소스 명사(ko/en). */
  noun: Noun;
  /** 안내 문구 동사. 기본 "create". */
  verb?: "create" | "upload" | "apply";
  /** 기본값 안내·경고 등 부가 정보. requestParams와 분리해 최상위에 병합된다. */
  notes?: Record<string, unknown>;
}

/**
 * 표준 dryRun 프리뷰 객체를 만든다.
 *
 * `undefined` 필드는 실제 직렬화(`serializeListParams`/`JSON.stringify`)에서도
 * 빠지므로 프리뷰에서도 제거한다 — "값이 전송된다"는 오해를 막기 위해서다.
 */
export function dryRunPreview(opts: DryRunPreviewOpts): Record<string, unknown> {
  const sent = redact(opts.requestParams);
  return {
    label: opts.label,
    endpoint: opts.endpoint,
    method: opts.method ?? "GET",
    requestParams: sent,
    ...(opts.notes ?? {}),
    message: dryRunMessage(opts.noun, opts.verb),
  };
}
