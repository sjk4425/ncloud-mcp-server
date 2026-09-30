import { describe, it, expect, afterEach } from "vitest";
import {
  regionName,
  resolveRegionCode,
  invalidRegionMessage,
  RESOURCE_DETAIL_MAP,
  unsupportedResourceTypeMessage,
} from "./_validation.js";

// 공용 검증 헬퍼 (DESIGN_post-1.6.0 §5, v1.7.0).

describe("_validation: 리전", () => {
  const saved = process.env.NCLOUD_LANG;
  afterEach(() => {
    if (saved === undefined) delete process.env.NCLOUD_LANG;
    else process.env.NCLOUD_LANG = saved;
  });

  it("코드를 정규화한다(대소문자 무관)", () => {
    expect(resolveRegionCode("kr")).toBe("KR");
    expect(resolveRegionCode("JPN")).toBe("JPN");
  });
  it("한국어명을 코드로 해석한다", () => {
    expect(resolveRegionCode("한국")).toBe("KR");
    expect(resolveRegionCode("싱가포르")).toBe("SGN");
  });
  it("유효하지 않은 리전은 null", () => {
    expect(resolveRegionCode("XX")).toBeNull();
    expect(resolveRegionCode("화성")).toBeNull();
  });
  it("regionName: 코드 → 한국어명, 미지 코드는 그대로", () => {
    expect(regionName("KR")).toBe("한국");
    expect(regionName("ZZZ")).toBe("ZZZ");
  });
  it("invalidRegionMessage: NCLOUD_LANG=en이면 영문", () => {
    process.env.NCLOUD_LANG = "en";
    expect(invalidRegionMessage("XX")).toContain("Invalid region");
    delete process.env.NCLOUD_LANG;
    expect(invalidRegionMessage("XX")).toContain("유효하지 않은 리전");
    expect(invalidRegionMessage("XX")).toContain("KR, JPN, SGN, USWN, DEN (또는 한국, 일본, 싱가포르, 미국, 독일)");
  });

  // 존 통합: 공공존은 KR(KR-CENTRAL)/KRS(KR-SOUTH) 만 제공, 글로벌 리전 없음
  it("gov: KR/KRS 와 한국어명(한국/한국남부)만 유효", () => {
    expect(resolveRegionCode("krs", "gov")).toBe("KRS");
    expect(resolveRegionCode("한국남부", "gov")).toBe("KRS");
    expect(resolveRegionCode("한국", "gov")).toBe("KR");
    expect(resolveRegionCode("JPN", "gov")).toBeNull();
    expect(resolveRegionCode("싱가포르", "gov")).toBeNull();
  });
  it("pub: KRS 는 유효하지 않다", () => {
    expect(resolveRegionCode("KRS")).toBeNull();
    expect(resolveRegionCode("KRS", "pub")).toBeNull();
  });
  it("gov: regionName / invalidRegionMessage 는 공공존 카탈로그를 안내", () => {
    expect(regionName("KRS", "gov")).toBe("한국남부");
    expect(regionName("KRS")).toBe("KRS"); // public 카탈로그에 없으면 코드 그대로
    expect(invalidRegionMessage("JPN", "gov")).toContain("KR, KRS (또는 한국, 한국남부)");
  });
});

describe("_validation: 리소스 타입", () => {
  it("12종 타입이 모두 apiPath/paramKey를 가진다", () => {
    const keys = Object.keys(RESOURCE_DETAIL_MAP);
    expect(keys.length).toBe(12);
    for (const k of keys) {
      expect(RESOURCE_DETAIL_MAP[k].apiPath).toMatch(/^\/v/);
      expect(RESOURCE_DETAIL_MAP[k].paramKey).toBeTruthy();
    }
  });
  it("unsupportedResourceTypeMessage: 영문 전환", () => {
    process.env.NCLOUD_LANG = "en";
    expect(unsupportedResourceTypeMessage("foo")).toBe("Unsupported resource type: foo");
    delete process.env.NCLOUD_LANG;
    expect(unsupportedResourceTypeMessage("foo")).toBe("지원하지 않는 리소스 타입: foo");
  });
});
