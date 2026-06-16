/**
 * 읽기 전용 호출 재시도 컨텍스트 (v1.6.0, DESIGN_post-1.4.0 §4).
 *
 * `fetchWithRetry`는 기본적으로 HTTP 429만 재시도한다(비멱등 위험 보존). 그러나 조회 도구는
 * 멱등하므로 503·504·네트워크 오류도 안전하게 재시도할 수 있다. 문제는 핸들러가
 * `NcloudClient.request()`를 직접 호출해(~1,000 호출부) 읽기/쓰기 구분을 인자로 흘릴 수
 * 없다는 점이다.
 *
 * 해법: `defineTool`이 이미 `readOnlyHint`를 알고 있으므로, 읽기 전용 핸들러 실행을
 * AsyncLocalStorage 컨텍스트(`{ retryOn5xx: true }`)로 감싼다. 핸들러 안에서 await로
 * 이어지는 `request()`/`requestRaw()` 호출이 같은 컨텍스트를 상속하므로, `fetchWithRetry`가
 * `getRetryContext()`로 읽어 5xx/네트워크 재시도 여부를 결정한다. 호출부 코드는 무변경.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface RetryContext {
  /** 읽기 전용(조회) 호출이면 true — 503/504/네트워크 오류도 429와 동일 백오프로 재시도. */
  retryOn5xx: boolean;
}

const storage = new AsyncLocalStorage<RetryContext>();

/** `fn` 실행 동안(이어지는 await 포함) 재시도 컨텍스트를 활성화한다. */
export function withRetryContext<T>(ctx: RetryContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** 현재 활성 재시도 컨텍스트. 컨텍스트 밖(쓰기 도구·직접 호출)이면 undefined. */
export function getRetryContext(): RetryContext | undefined {
  return storage.getStore();
}
