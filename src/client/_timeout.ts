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
 * `AbortSignal.timeout`을 적용한 fetch. 초과 시 사용자 친화 메시지로 변환해 던진다.
 * 호출자가 넘긴 `options.signal`은 덮어쓰므로 전달하지 말 것.
 */
export async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  const timeoutMs = getTimeoutMs();
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err: any) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      throw new Error(messages().timeout(Math.round(timeoutMs / 1000), url));
    }
    throw err;
  }
}
