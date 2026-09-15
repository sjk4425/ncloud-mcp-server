/**
 * 응답 본문 속 평문 시크릿 마스킹 (mcp-test-report-20260915 F-03).
 *
 * `ncloud_functions_get_action`은 액션 **소스 코드를 그대로** 반환한다. 현장에서는 액션 코드에
 * Access Key/Secret Key를 하드코딩하는 패턴이 흔해, 조회 한 번으로 계정 전체 권한의 자격증명이
 * LLM 컨텍스트·대화 로그·전송 구간에 남는다. 하드코딩 자체는 고객 환경 문제지만(F-09),
 * MCP가 그것을 **증폭하는 경로**가 되므로 서버 측에서 가린다.
 *
 * `_dryrun.ts`의 마스킹은 **필드 이름**을 보고 값을 가리는 방식이라(전송 객체), 자유 텍스트인
 * 소스 코드에는 쓸 수 없다. 여기서는 텍스트 안의 **값 패턴**을 찾아 가린다.
 *
 * 설계 원칙:
 *  - 오탐보다 미탐이 낫다는 쪽이 아니다 — 이 헬퍼가 가리는 건 코드 조회 결과이고, 원본이
 *    필요하면 `includeSecrets=true`로 명시 opt-in 할 수 있다. 그래도 `access_key_name = "..."`처럼
 *    이름이 "키"로 끝나지 않는 식별자는 건드리지 않도록 패턴을 좁혔다.
 *  - 가린 자리에 **길이**를 남긴다 — 모델이 "코드가 잘렸다"고 오해하지 않게 하고, 호출자는
 *    값이 실려 있었다는 사실은 확인할 수 있다.
 *  - 결과에 `count`를 돌려준다 — 도구는 이것으로 `secretsRedacted` 플래그를 세운다.
 */

/** 가린 자리 표기. 길이만 남긴다. */
function mask(value: string): string {
  return `<REDACTED:${value.length} chars>`;
}

/**
 * 값 자체가 식별 가능한 시크릿 형식 — 이름 없이 값만 봐도 가릴 수 있는 것들.
 * 순서대로 적용한다(PEM 블록을 먼저 통째로 가려야 안쪽 문자열이 다른 패턴에 부분 매칭되지 않는다).
 */
const VALUE_PATTERNS: RegExp[] = [
  // PEM 개인키 블록 전체
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  // Ncloud IAM 신형 키(access·secret 공통 접두)
  /ncp_iam_[A-Za-z0-9]{16,}/g,
  // AWS 계열 access key id
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  // HTTP Bearer 토큰
  /\bBearer\s+[A-Za-z0-9\-._~+/]{16,}=*/g,
];

/**
 * `이름 = "값"` 대입에서 이름이 시크릿을 뜻할 때 값을 가린다.
 * Python/JS/JSON/YAML/.env 표기를 모두 잡도록 구분자는 `:` 또는 `=`, 값은 따옴표로 감싼
 * 8자 이상만 본다(따옴표 없는 값·변수 참조 `params["secret_key"]`는 매칭되지 않는다).
 *
 * 이름 뒤에 바로 (선택적 닫는 따옴표와) 구분자가 와야 하므로 `secret_key_name`처럼
 * 접미가 붙은 식별자는 매칭되지 않는다.
 */
const ASSIGNMENT_PATTERN =
  /((?:access|secret|api|private|auth|client|app)[_\-]?(?:key|token|secret)|password|passwd|pwd|secret|token|x-ncp-iam-access-key|x-ncp-apigw-signature(?:-v\d)?)(\s*["']?\s*[:=]\s*)(["'])([^"'\r\n]{8,})\3/gi;

export interface RedactResult {
  text: string;
  /** 가린 건수. 0이면 `text`는 입력과 동일하다. */
  count: number;
}

/** 텍스트 안의 시크릿 값을 가린다. 입력이 문자열이 아니면 그대로 돌려준다(count 0). */
export function redactSecrets(input: string): RedactResult {
  if (typeof input !== "string" || input.length === 0) return { text: input, count: 0 };
  let count = 0;
  let text = input;
  for (const re of VALUE_PATTERNS) {
    text = text.replace(re, (m) => {
      count++;
      return mask(m);
    });
  }
  text = text.replace(ASSIGNMENT_PATTERN, (_m, name: string, sep: string, quote: string, value: string) => {
    count++;
    return `${name}${sep}${quote}${mask(value)}${quote}`;
  });
  return { text, count };
}

/**
 * 객체의 특정 경로(점 표기, 예: `content.exec.code`)에 있는 문자열을 가린다.
 * 입력은 수정하지 않고 얕은 복사본을 돌려준다. 경로가 없거나 문자열이 아니면 count 0.
 */
export function redactAtPath(obj: any, path: string): { value: any; count: number } {
  const keys = path.split(".");
  const clone = (v: any): any => (Array.isArray(v) ? [...v] : v !== null && typeof v === "object" ? { ...v } : v);
  const root = clone(obj);
  let cur = root;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (cur === null || typeof cur !== "object" || !(k in cur)) return { value: obj, count: 0 };
    cur[k] = clone(cur[k]);
    cur = cur[k];
  }
  const last = keys[keys.length - 1];
  if (cur === null || typeof cur !== "object" || typeof cur[last] !== "string") return { value: obj, count: 0 };
  const r = redactSecrets(cur[last]);
  if (r.count === 0) return { value: obj, count: 0 };
  cur[last] = r.text;
  return { value: root, count: r.count };
}
