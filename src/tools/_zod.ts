/**
 * zod 스키마 공통 헬퍼 — "필수 파라미터 누락" 메시지.
 *
 * zod 3 의 `{ required_error }` 와 zod 4 의 `{ error }` 는 표현이 달라, 호출부는 이 헬퍼가 돌려주는
 * 생성 파라미터만 넘긴다(`z.string(reqField("vpcNo"))`, `z.enum([...], reqField("type"))`).
 * zod 버전에 따른 차이는 이 파일 안에만 둔다.
 *
 * 메시지는 스키마 정의 시점(서버 시작/그룹 등록)에 만들어지므로 시작 시 `NCLOUD_LANG` 이 반영된다.
 */

import { requiredError } from "./_messages.js";

/** 값이 없을(undefined) 때만 `message` 를 쓰고, 그 밖의 오류는 zod 기본 메시지를 쓴다. */
export function reqMsg(message: string) {
  return { required_error: message };
}

/** 필수 파라미터 `field` 가 누락됐을 때의 표준 메시지(`requiredError`)를 쓰는 생성 파라미터. */
export function reqField(field: string) {
  return reqMsg(requiredError(field));
}
