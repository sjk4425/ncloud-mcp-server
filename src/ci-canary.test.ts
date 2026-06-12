import { describe, it, expect } from "vitest";

// CI 검증용 고의 실패 테스트 (DESIGN_mid-term §0 완료 기준).
// CI 빨간불 확인 후 이 파일은 삭제된다 — main에 머지 금지.
describe("ci-canary: 의도적 실패", () => {
  it("CI가 테스트 실패를 빨간불로 보고해야 한다", () => {
    expect(true).toBe(false);
  });
});
