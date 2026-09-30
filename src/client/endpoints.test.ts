import { describe, it, expect } from "vitest";
import {
  ZONES,
  ZONE_PROFILES,
  SERVICE_ENDPOINTS,
  resolveZone,
  defaultGateway,
  endpoint,
  isServiceAvailable,
  cloudFunctionsEndpoint,
  type ServiceKey,
} from "./endpoints.js";

describe("endpoints: Cloud Functions 호스트", () => {
  it("민간존은 리전별(KR/SGN/JPN, 그 외 KR), 공공존은 단일 호스트", () => {
    expect(cloudFunctionsEndpoint("public", "KR")).toBe("https://cloudfunctions.apigw.ntruss.com");
    expect(cloudFunctionsEndpoint("public", "SGN")).toBe("https://sg-cloudfunctions.apigw.ntruss.com");
    expect(cloudFunctionsEndpoint("public", "JPN")).toBe("https://jp-cloudfunctions.apigw.ntruss.com");
    expect(cloudFunctionsEndpoint("public", "USWN")).toBe("https://cloudfunctions.apigw.ntruss.com");
    expect(cloudFunctionsEndpoint("gov", "KR")).toBe("https://cloudfunctions.apigw.gov-ntruss.com");
    expect(cloudFunctionsEndpoint("gov", "KRS")).toBe("https://cloudfunctions.apigw.gov-ntruss.com");
  });
});

describe("endpoints: resolveZone (NCLOUD_ZONE)", () => {
  it("미설정/빈 값은 public (하위호환)", () => {
    expect(resolveZone({})).toBe("public");
    expect(resolveZone({ NCLOUD_ZONE: "" })).toBe("public");
    expect(resolveZone({ NCLOUD_ZONE: "   " })).toBe("public");
  });
  it("대소문자·공백 무시", () => {
    expect(resolveZone({ NCLOUD_ZONE: "gov" })).toBe("gov");
    expect(resolveZone({ NCLOUD_ZONE: " GOV " })).toBe("gov");
    expect(resolveZone({ NCLOUD_ZONE: "Public" })).toBe("public");
  });
  it("알 수 없는 값은 throw (다른 존으로 조용히 가지 않는다)", () => {
    expect(() => resolveZone({ NCLOUD_ZONE: "fin" })).toThrow(/NCLOUD_ZONE/);
    expect(() => resolveZone({ NCLOUD_ZONE: "government" })).toThrow(/public, gov/);
  });
});

describe("endpoints: 존 프로필", () => {
  it("기본 게이트웨이는 존별 도메인, NCLOUD_API_URL 이 있으면 우선", () => {
    expect(defaultGateway("public", {})).toBe("https://ncloud.apigw.ntruss.com");
    expect(defaultGateway("gov", {})).toBe("https://ncloud.apigw.gov-ntruss.com");
    expect(defaultGateway("gov", { NCLOUD_API_URL: "https://proxy.local" })).toBe("https://proxy.local");
  });
  it("리전 카탈로그: 민간존 5개 / 공공존 KR·KRS, COM 은 제외", () => {
    expect(ZONE_PROFILES.public.regions.map((r) => r.code)).toEqual(["KR", "JPN", "SGN", "USWN", "DEN"]);
    expect(ZONE_PROFILES.gov.regions.map((r) => r.code)).toEqual(["KR", "KRS"]);
    for (const z of ZONES) {
      expect(ZONE_PROFILES[z].regions.some((r) => r.code === "COM")).toBe(false);
      expect(ZONE_PROFILES[z].regions.some((r) => r.code === ZONE_PROFILES[z].defaultRegion)).toBe(true);
    }
  });
});

describe("endpoints: 서비스 엔드포인트 테이블", () => {
  const keys = Object.keys(SERVICE_ENDPOINTS) as ServiceKey[];

  it("모든 값은 https 이고 끝에 슬래시가 없다", () => {
    for (const k of keys) {
      for (const z of ZONES) {
        const url = endpoint(k, z);
        if (url === undefined) continue;
        expect(url, `${k}.${z}`).toMatch(/^https:\/\/[a-z0-9.-]+$/);
      }
    }
  });
  it("public 값에는 gov 도메인이, gov 값에는 민간 도메인이 섞이지 않는다", () => {
    for (const k of keys) {
      const pub = endpoint(k, "public");
      const gov = endpoint(k, "gov");
      if (pub) expect(pub, `${k}.public`).not.toMatch(/gov-/);
      if (gov) expect(gov, `${k}.gov`).toMatch(/gov-(ntruss|ncloud)\.com$/);
    }
  });
  it("불규칙 매핑 — 단순 도메인 치환으로는 틀리는 것들", () => {
    expect(endpoint("ncr", "gov")).toBe("https://gov-ncr.apigw.gov-ntruss.com");
    expect(endpoint("privateCa", "public")).toBe("https://pca.apigw.ntruss.com");
    expect(endpoint("privateCa", "gov")).toBe("https://privateca.apigw.gov-ntruss.com");
    expect(endpoint("vodStation", "gov")).toBe("https://vod-station.apigw.gov-ntruss.com");
    expect(endpoint("kms", "public")).toBe("https://ocapi.ncloud.com");
    expect(endpoint("kms", "gov")).toBe("https://ocapi.gov-ncloud.com");
  });
  it("규칙형 매핑은 서브도메인이 같다", () => {
    expect(endpoint("nks", "public")).toBe("https://nks.apigw.ntruss.com");
    expect(endpoint("nks", "gov")).toBe("https://nks.apigw.gov-ntruss.com");
    expect(endpoint("billing", "gov")).toBe("https://billingapi.apigw.gov-ntruss.com");
  });
  it("존 전용 서비스는 반대 존에서 undefined", () => {
    expect(isServiceAvailable("sens", "public")).toBe(true);
    expect(isServiceAvailable("sens", "gov")).toBe(false);
    expect(isServiceAvailable("wms", "gov")).toBe(true);
    expect(isServiceAvailable("wms", "public")).toBe(true); // management-wms 는 두 존 모두 문서화
    expect(isServiceAvailable("multiDrm", "public")).toBe(false);
    expect(isServiceAvailable("cloudAdvisor", "gov")).toBe(false);
  });
});
