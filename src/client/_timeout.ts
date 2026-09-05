/**
 * 공통 fetch 타임아웃 헬퍼.
 *
 * NcloudClient / S3CompatibleClient / SwiftCompatibleClient 가 동일한 타임아웃
 * 정책(기본 30s, env `NCLOUD_TIMEOUT_MS` 오버라이드)을 공유한다.
 *
 * 설계: DESIGN_short-term-improvements.md §3
 */

import { messages } from "./messages.js";

/** 요청 타임아웃(ms). 기본 30s, env `NCLOUD_TIMEOUT_MS`로 오버라이드. */
export function getTimeoutMs(): number {
  const raw = process.env.NCLOUD_TIMEOUT_MS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 30000;
}

/**
 * 로그·에러 메시지에 실을 URL에서 **쿼리스트링을 제거**한다.
 *
 * Ncloud는 생성 계열도 GET이 많아 비밀번호가 쿼리스트링에 실린다
 * (`create_mysql_instance`의 `cloudMysqlUserPassword`, `create_nas_volume`의
 * `cifsUserPassword`, `get_root_password`의 RSA `privateKey` 등).
 * 타임아웃 메시지는 그대로 MCP 클라이언트로 반환돼 대화·로그에 남고,
 * `NCLOUD_DEBUG=1` 로그는 stderr로 나간다 — 어느 쪽이든 평문 노출이다.
 *
 * 경로까지는 남긴다. 어느 API에서 났는지가 진단에 필요하고 경로에는 비밀이 없다.
 */
export function redactUrl(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : `${url.slice(0, q)}?<query redacted>`;
}

/**
 * `AbortSignal.timeout`을 적용한 fetch. 초과 시 사용자 친화 메시지로 변환해 던진다.
 * 호출자가 넘긴 `options.signal`은 덮어쓰므로 전달하지 말 것.
 */
export async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const timeoutMs = getTimeoutMs();
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err: any) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new Error(messages().timeout(Math.round(timeoutMs / 1000), redactUrl(url)));
    }
    throw err;
  }
}
