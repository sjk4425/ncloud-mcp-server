/**
 * 핸들러 레벨 메시지 i18n 헬퍼 단위 테스트 (v1.6.1, DESIGN_post-1.6.0 §1).
 *
 * NCLOUD_LANG 기본(ko)/en 전환과 템플릿 헬퍼의 동작을 고정한다.
 * 기본값이 ko로 유지돼 기존 한국어 응답이 보존되는지(하위호환)도 함께 검증.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  L,
  dryRunMessage,
  requiredError,
  maxLenMessage,
  cidrMessage,
  deletedMessage,
} from "./_messages.js";

afterEach(() => {
  delete process.env.NCLOUD_LANG;
});

describe("_messages: 기본 언어(ko) — 미설정 시 한국어 보존", () => {
  it("L: 미설정이면 ko 측 반환", () => {
    expect(L({ ko: "한국어", en: "english" })).toBe("한국어");
  });

  it("requiredError: 미설정이면 한국어 누락 메시지", () => {
    expect(requiredError("vpcNo")).toBe("필수 파라미터 'vpcNo'가 누락되었습니다.");
  });

  it("dryRunMessage: 미설정이면 한국어 프리뷰 메시지", () => {
    expect(dryRunMessage({ ko: "서버", en: "server" })).toContain("이 요청은 실제 서버를");
  });

  it("maxLenMessage / cidrMessage / deletedMessage: 한국어", () => {
    expect(maxLenMessage("vpcName", 30)).toBe("잘못된 파라미터: 'vpcName'은 30자 이하여야 합니다.");
    expect(cidrMessage("subnet", "10.0.1.0/24")).toContain("CIDR 형식");
    expect(deletedMessage({ ko: "버킷 'b'", en: "bucket 'b'" })).toBe("✅ 버킷 'b'이(가) 삭제되었습니다.");
  });
});

describe("_messages: NCLOUD_LANG=en — 영문 전환", () => {
  it("L: en 측 반환", () => {
    process.env.NCLOUD_LANG = "en";
    expect(L({ ko: "한국어", en: "english" })).toBe("english");
  });

  it("requiredError: 영문 누락 메시지", () => {
    process.env.NCLOUD_LANG = "en";
    expect(requiredError("vpcNo")).toBe("Required parameter 'vpcNo' is missing.");
  });

  it("dryRunMessage: 동사별 영문 (create/upload/apply)", () => {
    process.env.NCLOUD_LANG = "en";
    expect(dryRunMessage({ ko: "서버", en: "server" })).toBe(
      "Preview only — the server will not be created. Call again with dryRun=false to execute."
    );
    expect(dryRunMessage({ ko: "오브젝트", en: "object" }, "upload")).toContain("will not be uploaded");
    expect(dryRunMessage({ ko: "규칙", en: "rule" }, "apply")).toContain("will not be applied");
  });

  it("maxLenMessage / cidrMessage / deletedMessage: 영문", () => {
    process.env.NCLOUD_LANG = "en";
    expect(maxLenMessage("vpcName", 30)).toBe("Invalid parameter: 'vpcName' must be 30 characters or fewer.");
    expect(cidrMessage("subnet", "10.0.1.0/24")).toBe("Invalid parameter: 'subnet' must be in CIDR notation (e.g. 10.0.1.0/24).");
    expect(deletedMessage({ ko: "버킷 'b'", en: "bucket 'b'" })).toBe("✅ bucket 'b' has been deleted.");
  });

  it("NCLOUD_LANG 대소문자 무시 (EN)", () => {
    process.env.NCLOUD_LANG = "EN";
    expect(L({ ko: "한국어", en: "english" })).toBe("english");
  });

  it("알 수 없는 값은 ko로 폴백", () => {
    process.env.NCLOUD_LANG = "fr";
    expect(L({ ko: "한국어", en: "english" })).toBe("한국어");
  });
});
