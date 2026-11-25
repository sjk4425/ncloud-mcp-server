/**
 * Ncloud Storage 공통 요청 헤더 컨텍스트 (2026-11-24 민간존 릴리스).
 *
 * `x-amz-expected-bucket-owner` 는 가이드(storage-ncloudstorage)의 **공통 요청 헤더**라 모든 오퍼레이션에 붙을 수 있다.
 * 도구 40여 개의 핸들러마다 파라미터를 받아 헤더로 옮기면 누락이 생기므로, 도구 등록 단계에서 공통 파라미터
 * `expectedBucketOwner` 를 붙이고(`withNcsCommonParams`) 핸들러 실행을 이 컨텍스트로 감싼다. 핸들러 안에서 이어지는
 * `S3CompatibleClient.request()` 호출이 같은 컨텍스트를 상속하므로 클라이언트가 서명 직전에 헤더를 넣는다
 * (`_retry-context.ts` 와 같은 방식).
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface StorageRequestContext {
  /** 요청 대상 버킷의 예상 소유자 계정 ID — `x-amz-expected-bucket-owner`. */
  expectedBucketOwner?: string;
}

const storage = new AsyncLocalStorage<StorageRequestContext>();

/** `fn` 실행 동안(이어지는 await 포함) Ncloud Storage 공통 헤더 컨텍스트를 활성화한다. */
export function withStorageContext<T>(ctx: StorageRequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** 현재 컨텍스트가 요구하는 공통 헤더. 컨텍스트 밖이면 빈 객체. */
export function storageContextHeaders(): Record<string, string> {
  const ctx = storage.getStore();
  return ctx?.expectedBucketOwner ? { "x-amz-expected-bucket-owner": ctx.expectedBucketOwner } : {};
}
