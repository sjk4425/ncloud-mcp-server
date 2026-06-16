/**
 * NcloudClient 에러 메시지 i18n (v1.6.0, DESIGN_post-1.4.0 §6).
 *
 * 도구 description은 영문(MCP 호환 규칙)인데 클라이언트 에러 메시지는 한국어였다 →
 * README_EN 사용자에게 한국어 에러가 전달되는 문제. 메시지를 단일 모듈로 추출해 한/영
 * 병행 관리하고, `NCLOUD_LANG`으로 선택한다.
 *
 * 기본값은 호환성을 위해 `ko` 유지(기존 동작·테스트 보존). `NCLOUD_LANG=en`이면 영문.
 * v2.0.0에서 기본 `en` 전환을 검토한다.
 */

export type Lang = "ko" | "en";

/** `NCLOUD_LANG`을 해석. `en`만 영문, 그 외/미설정은 한국어(기본). */
export function getLang(): Lang {
  return process.env.NCLOUD_LANG?.toLowerCase() === "en" ? "en" : "ko";
}

export interface MessageBundle {
  /** HTTP 상태코드별 사용자 친화 메시지. */
  httpStatus: Record<number, string>;
  /** JSON 파싱 실패. body는 호출부에서 앞 500자로 자른 응답 본문. */
  parseFailure: (status: number, body: string) => string;
  /** API 게이트웨이/서비스 레벨 에러(코드+메시지 동반). */
  apiFailure: (code: string, message: string) => string;
  /** 비어 있는 응답 본문 + 실패 상태. diag는 선택적 진단 헤더 문자열. */
  emptyBody: (status: number, diag?: string) => string;
  /** 알 수 없는 상태코드 — 상태와 응답 본문을 그대로 노출. */
  unknownStatus: (status: number, body: string) => string;
  /** 타임아웃(초 단위 + 대상 URL). */
  timeout: (seconds: number, url: string) => string;
}

const ko: MessageBundle = {
  httpStatus: {
    401: "인증 실패: Access Key 또는 Secret Key가 올바르지 않습니다. 환경 변수 NCLOUD_ACCESS_KEY, NCLOUD_SECRET_KEY를 확인하세요.",
    403: "접근 거부: 해당 서비스에 대한 접근 권한이 없습니다. 서비스 이용 신청 여부 및 Sub Account 권한을 확인하세요.",
    413: "요청 크기 초과: 요청 본문이 너무 큽니다.",
    429: "요청 제한 초과: 잠시 후 다시 시도해주세요.",
    503: "서비스 일시 불가: Ncloud API 엔드포인트에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.",
    504: "요청 시간 초과: Ncloud API 응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.",
  },
  parseFailure: (status, body) => `API 응답 파싱 실패: HTTP ${status}\n\n응답: ${body}`,
  apiFailure: (code, message) => `API 호출 실패\n\n에러 코드: ${code}\n메시지: ${message}`,
  emptyBody: (status, diag) =>
    `API 호출 실패: HTTP ${status} (빈 응답)${diag ? `\n  진단 헤더: ${diag}` : ""}`,
  unknownStatus: (status, body) => `API 호출 실패: HTTP ${status}\n\n응답: ${body}`,
  timeout: (seconds, url) =>
    `API 호출 시간 초과(${seconds}s): ${url} — 네트워크 또는 Ncloud 게이트웨이 상태를 확인하세요.`,
};

const en: MessageBundle = {
  httpStatus: {
    401: "Authentication failed: the Access Key or Secret Key is invalid. Check the NCLOUD_ACCESS_KEY and NCLOUD_SECRET_KEY environment variables.",
    403: "Access denied: you do not have permission for this service. Check whether the service is subscribed and verify your Sub Account permissions.",
    413: "Request too large: the request body exceeds the allowed size.",
    429: "Rate limit exceeded: please try again in a moment.",
    503: "Service unavailable: cannot reach the Ncloud API endpoint. Please try again in a moment.",
    504: "Gateway timeout: the Ncloud API took too long to respond. Please try again in a moment.",
  },
  parseFailure: (status, body) => `Failed to parse API response: HTTP ${status}\n\nResponse: ${body}`,
  apiFailure: (code, message) => `API call failed\n\nError code: ${code}\nMessage: ${message}`,
  emptyBody: (status, diag) =>
    `API call failed: HTTP ${status} (empty response)${diag ? `\n  Diagnostic headers: ${diag}` : ""}`,
  unknownStatus: (status, body) => `API call failed: HTTP ${status}\n\nResponse: ${body}`,
  timeout: (seconds, url) =>
    `API call timed out (${seconds}s): ${url} — check your network or the Ncloud gateway status.`,
};

const BUNDLES: Record<Lang, MessageBundle> = { ko, en };

/** 현재 `NCLOUD_LANG`에 맞는 메시지 번들. 매 호출 시 env를 다시 읽어 런타임 변경을 반영. */
export function messages(): MessageBundle {
  return BUNDLES[getLang()];
}
