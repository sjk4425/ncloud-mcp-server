import { describe, it, expect, vi, beforeEach } from "vitest";
import fc from "fast-check";
import { NcloudClient } from "./ncloud-client.js";

// NcloudClient는 응답 본문을 response.text() 로 읽어 JSON.parse 한다(.json() 미사용).
// mock 응답에는 반드시 text()가 있어야 한다.
function jsonResponse(body: any, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function createMockFetch(responseBody: any, status = 200) {
  return vi.fn(async () => jsonResponse(responseBody, status));
}

describe("Feature: ncloud-mcp-server, Property 3: 인증 헤더 완전성", () => {
  it("every request includes all three auth headers", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 32 }),
        fc.string({ minLength: 1, maxLength: 32 }),
        fc.constantFrom("/vserver/v2/getServerInstanceList", "/vpc/v2/getVpcList"),
        async (accessKey, secretKey, action) => {
          const client = new NcloudClient({
            accessKey,
            secretKey,
            baseUrl: "https://ncloud.apigw.ntruss.com",
          });

          let capturedHeaders: Record<string, string> = {};
          vi.stubGlobal("fetch", vi.fn(async (_url: string, init: any) => {
            capturedHeaders = init.headers;
            return jsonResponse({
              getServerInstanceListResponse: { returnCode: "0", returnMessage: "success" },
            });
          }));

          await client.request(action, {});

          expect(capturedHeaders).toHaveProperty("x-ncp-apigw-timestamp");
          expect(capturedHeaders).toHaveProperty("x-ncp-iam-access-key");
          expect(capturedHeaders).toHaveProperty("x-ncp-apigw-signature-v2");
          expect(capturedHeaders["x-ncp-iam-access-key"]).toBe(accessKey);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Feature: ncloud-mcp-server, Property 4: JSON 응답 포맷 자동 추가", () => {
  it("every request URL includes responseFormatType=json", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(
          "/vserver/v2/getServerInstanceList",
          "/vpc/v2/getVpcList",
          "/vloadbalancer/v2/getLoadBalancerInstanceList"
        ),
        fc.record({
          serverInstanceNo: fc.option(fc.string({ minLength: 1, maxLength: 10 })),
        }),
        async (action, params) => {
          const client = new NcloudClient({
            accessKey: "testKey",
            secretKey: "testSecret",
            baseUrl: "https://ncloud.apigw.ntruss.com",
          });

          let capturedUrl = "";
          vi.stubGlobal("fetch", vi.fn(async (url: string) => {
            capturedUrl = url;
            return jsonResponse({ someResponse: { returnCode: "0" } });
          }));

          const cleanParams: Record<string, string> = {};
          for (const [k, v] of Object.entries(params)) {
            if (v !== null) cleanParams[k] = v;
          }

          await client.request(action, cleanParams);

          expect(capturedUrl).toContain("responseFormatType=json");
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Feature: ncloud-mcp-server, Property 5: 에러 응답 전파", () => {
  it("error responses with responseError propagate returnCode and returnMessage", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 10 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        async (returnCode, returnMessage) => {
          const client = new NcloudClient({
            accessKey: "testKey",
            secretKey: "testSecret",
            baseUrl: "https://ncloud.apigw.ntruss.com",
          });

          vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
            responseError: { returnCode, returnMessage },
          }, 400)));

          try {
            await client.request("/vserver/v2/getServerInstanceList", {});
            expect.fail("Should have thrown");
          } catch (e: any) {
            expect(e.message).toContain(returnCode);
            expect(e.message).toContain(returnMessage);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it("error responses with error propagate errorCode and message", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 10 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        async (errorCode, message) => {
          const client = new NcloudClient({
            accessKey: "testKey",
            secretKey: "testSecret",
            baseUrl: "https://ncloud.apigw.ntruss.com",
          });

          vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
            error: { errorCode, message },
          }, 400)));

          try {
            await client.request("/vserver/v2/getServerInstanceList", {});
            expect.fail("Should have thrown");
          } catch (e: any) {
            expect(e.message).toContain(errorCode);
            expect(e.message).toContain(message);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Feature: ncloud-mcp-server, Property 8: 리스트 파라미터 직렬화 라운드트립", () => {
  it("array of K elements produces exactly K indexed params preserving values", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !s.includes(".")),
        fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 10 }),
        (paramName, values) => {
          const client = new NcloudClient({
            accessKey: "key",
            secretKey: "secret",
            baseUrl: "https://ncloud.apigw.ntruss.com",
          });

          const result = client.serializeListParams({ [paramName]: values });

          // Should produce exactly K entries
          const keys = Object.keys(result);
          expect(keys.length).toBe(values.length);

          // Each key should be paramName.N (1-based)
          for (let i = 0; i < values.length; i++) {
            const expectedKey = `${paramName}.${i + 1}`;
            expect(result[expectedKey]).toBe(values[i]);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe("Feature: ncloud-mcp-server, Property 11: 기본 리전 폴백", () => {
  it("requests without explicit regionCode use the client active region", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("KR", "JPN", "SGN", "USWN", "DEN"),
        async (regionCode) => {
          const client = new NcloudClient({
            accessKey: "testKey",
            secretKey: "testSecret",
            baseUrl: "https://ncloud.apigw.ntruss.com",
            regionCode,
          });

          let capturedUrl = "";
          vi.stubGlobal("fetch", vi.fn(async (url: string) => {
            capturedUrl = url;
            return jsonResponse({
              getServerInstanceListResponse: { returnCode: "0", returnMessage: "success" },
            });
          }));

          await client.request("/vserver/v2/getServerInstanceList", {});

          expect(capturedUrl).toContain(`regionCode=${regionCode}`);
        }
      ),
      { numRuns: 100 }
    );
  });

  it("setRegionCode changes the fallback region for subsequent requests", async () => {
    const client = new NcloudClient({
      accessKey: "testKey",
      secretKey: "testSecret",
      baseUrl: "https://ncloud.apigw.ntruss.com",
      regionCode: "KR",
    });

    client.setRegionCode("JPN");
    expect(client.getRegionCode()).toBe("JPN");

    let capturedUrl = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      capturedUrl = url;
      return jsonResponse({
        getServerInstanceListResponse: { returnCode: "0", returnMessage: "success" },
      });
    }));

    await client.request("/vserver/v2/getServerInstanceList", {});
    expect(capturedUrl).toContain("regionCode=JPN");
  });
});


describe("NcloudClient 단위 테스트: requestRaw 메서드", () => {
  let client: NcloudClient;

  beforeEach(() => {
    client = new NcloudClient({
      accessKey: "testKey",
      secretKey: "testSecret",
      baseUrl: "https://cloudfunctions.apigw.ntruss.com",
    });
  });

  it("GET 요청 시 responseFormatType과 regionCode를 추가하지 않음", async () => {
    let capturedUrl = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      capturedUrl = url;
      return jsonResponse({ packages: [] });
    }));

    await client.requestRaw("GET", "/api/v2/packages", { platform: "vpc" });

    expect(capturedUrl).not.toContain("responseFormatType");
    expect(capturedUrl).not.toContain("regionCode");
    expect(capturedUrl).toContain("platform=vpc");
  });

  it("GET 요청 시 Content-Type: application/json 헤더 포함", async () => {
    let capturedHeaders: Record<string, string> = {};
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: any) => {
      capturedHeaders = init.headers;
      return jsonResponse({ packages: [] });
    }));

    await client.requestRaw("GET", "/api/v2/packages");

    expect(capturedHeaders["Content-Type"]).toBe("application/json");
  });

  it("GET 요청 시 인증 헤더 3개 포함", async () => {
    let capturedHeaders: Record<string, string> = {};
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: any) => {
      capturedHeaders = init.headers;
      return jsonResponse({ packages: [] });
    }));

    await client.requestRaw("GET", "/api/v2/packages");

    expect(capturedHeaders).toHaveProperty("x-ncp-apigw-timestamp");
    expect(capturedHeaders).toHaveProperty("x-ncp-iam-access-key");
    expect(capturedHeaders).toHaveProperty("x-ncp-apigw-signature-v2");
    expect(capturedHeaders["x-ncp-iam-access-key"]).toBe("testKey");
  });

  it("PUT 요청 시 body를 JSON으로 직렬화하여 전송", async () => {
    let capturedInit: any = {};
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: any) => {
      capturedInit = init;
      return jsonResponse({ name: "test-package" });
    }));

    const body = { description: "test", parameters: { key: "value" } };
    await client.requestRaw("PUT", "/api/v2/packages/test-pkg", { platform: "vpc" }, body);

    expect(capturedInit.method).toBe("PUT");
    expect(capturedInit.body).toBe(JSON.stringify(body));
  });

  it("POST 요청 시 body를 JSON으로 직렬화하여 전송", async () => {
    let capturedInit: any = {};
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: any) => {
      capturedInit = init;
      return jsonResponse({ activationId: "abc123" });
    }));

    const body = { param1: "value1" };
    await client.requestRaw("POST", "/api/v2/packages/-/actions/myAction", { platform: "vpc" }, body);

    expect(capturedInit.method).toBe("POST");
    expect(capturedInit.body).toBe(JSON.stringify(body));
  });

  it("DELETE 요청 시 body를 전송하지 않음", async () => {
    let capturedInit: any = {};
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: any) => {
      capturedInit = init;
      return jsonResponse({}, 204);
    }));

    await client.requestRaw("DELETE", "/api/v2/packages/test-pkg", { platform: "vpc" });

    expect(capturedInit.method).toBe("DELETE");
    expect(capturedInit.body).toBeUndefined();
  });

  it("204 No Content 응답 시 { success: true } 반환", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 204)));

    const result = await client.requestRaw("DELETE", "/api/v2/packages/test-pkg", { platform: "vpc" });
    expect(result).toEqual({ success: true });
  });

  it("queryParams가 없으면 URL에 쿼리 스트링 없이 호출", async () => {
    let capturedUrl = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      capturedUrl = url;
      return jsonResponse({ data: [] });
    }));

    await client.requestRaw("GET", "/api/v2/activations");

    expect(capturedUrl).toBe("https://cloudfunctions.apigw.ntruss.com/api/v2/activations");
  });

  it("에러 응답 시 handleErrorResponse를 통해 에러 throw", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      error: { errorCode: "404", message: "Not Found" },
    }, 404)));

    await expect(
      client.requestRaw("GET", "/api/v2/packages/nonexistent", { platform: "vpc" })
    ).rejects.toThrow("에러 코드: 404");
  });

  it("응답 래퍼 해제 동작", async () => {
    const innerData = { packages: [{ name: "pkg1" }] };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ getPackagesResponse: innerData })));

    const result = await client.requestRaw("GET", "/api/v2/packages", { platform: "vpc" });
    expect(result).toEqual(innerData);
  });
});

describe("NcloudClient 단위 테스트: HTTP 에러 코드별 메시지", () => {
  let client: NcloudClient;

  beforeEach(() => {
    client = new NcloudClient({
      accessKey: "testKey",
      secretKey: "testSecret",
      baseUrl: "https://ncloud.apigw.ntruss.com",
    });
  });

  it("HTTP 401 → 인증 실패 메시지", async () => {
    vi.stubGlobal("fetch", createMockFetch({}, 401));

    await expect(
      client.request("/vserver/v2/getServerInstanceList", {})
    ).rejects.toThrow(
      "인증 실패: Access Key 또는 Secret Key가 올바르지 않습니다. 환경 변수 NCLOUD_ACCESS_KEY, NCLOUD_SECRET_KEY를 확인하세요."
    );
  });

  it("HTTP 413 → 요청 크기 초과 메시지", async () => {
    vi.stubGlobal("fetch", createMockFetch({}, 413));

    await expect(
      client.request("/vserver/v2/getServerInstanceList", {})
    ).rejects.toThrow("요청 크기 초과: 요청 본문이 너무 큽니다.");
  });

  it("HTTP 429 → 요청 제한 초과 메시지", async () => {
    vi.stubGlobal("fetch", createMockFetch({}, 429));

    await expect(
      client.request("/vserver/v2/getServerInstanceList", {})
    ).rejects.toThrow("요청 제한 초과: 잠시 후 다시 시도해주세요.");
  });

  it("HTTP 503 → 서비스 일시 불가 메시지", async () => {
    vi.stubGlobal("fetch", createMockFetch({}, 503));

    await expect(
      client.request("/vserver/v2/getServerInstanceList", {})
    ).rejects.toThrow(
      "서비스 일시 불가: Ncloud API 엔드포인트에 연결할 수 없습니다. 잠시 후 다시 시도해주세요."
    );
  });

  it("HTTP 504 → 요청 시간 초과 메시지", async () => {
    vi.stubGlobal("fetch", createMockFetch({}, 504));

    await expect(
      client.request("/vserver/v2/getServerInstanceList", {})
    ).rejects.toThrow(
      "요청 시간 초과: Ncloud API 응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요."
    );
  });

  it("알 수 없는 HTTP 에러 코드 → 상태 코드와 응답 본문 포함", async () => {
    vi.stubGlobal("fetch", createMockFetch({ someField: "value" }, 500));

    await expect(
      client.request("/vserver/v2/getServerInstanceList", {})
    ).rejects.toThrow("API 호출 실패: HTTP 500");
  });
});

describe("NcloudClient 단위 테스트: 응답 래퍼 해제", () => {
  let client: NcloudClient;

  beforeEach(() => {
    client = new NcloudClient({
      accessKey: "testKey",
      secretKey: "testSecret",
      baseUrl: "https://ncloud.apigw.ntruss.com",
    });
  });

  it("'{actionName}Response' 래퍼가 있으면 내부 객체를 반환", async () => {
    const innerData = {
      returnCode: "0",
      returnMessage: "success",
      totalRows: 2,
      serverInstanceList: [{ id: "1" }, { id: "2" }],
    };
    vi.stubGlobal(
      "fetch",
      createMockFetch({ getServerInstanceListResponse: innerData })
    );

    const result = await client.request("/vserver/v2/getServerInstanceList", {});
    expect(result).toEqual(innerData);
  });

  it("'Response' 접미사가 없으면 원본 응답 그대로 반환", async () => {
    const rawBody = { returnCode: "0", data: [1, 2, 3] };
    vi.stubGlobal("fetch", createMockFetch(rawBody));

    const result = await client.request("/vserver/v2/getServerInstanceList", {});
    expect(result).toEqual(rawBody);
  });

  it("키가 여러 개이면 래퍼 해제하지 않고 원본 반환", async () => {
    const rawBody = {
      getServerInstanceListResponse: { returnCode: "0" },
      extraKey: "extra",
    };
    vi.stubGlobal("fetch", createMockFetch(rawBody));

    const result = await client.request("/vserver/v2/getServerInstanceList", {});
    expect(result).toEqual(rawBody);
  });

  it("createVpcResponse 래퍼도 정상 해제", async () => {
    const innerData = {
      returnCode: "0",
      returnMessage: "success",
      vpcList: [{ vpcNo: "123" }],
    };
    vi.stubGlobal("fetch", createMockFetch({ createVpcResponse: innerData }));

    const result = await client.request("/vpc/v2/createVpc", {
      ipv4CidrBlock: "10.0.0.0/16",
    });
    expect(result).toEqual(innerData);
  });

  it("postRequest에서도 래퍼 해제 동작", async () => {
    const innerData = { returnCode: "0", items: [] };
    vi.stubGlobal(
      "fetch",
      createMockFetch({ queryDataResponse: innerData })
    );

    const result = await client.postRequest("/cw_fea/real/cw/api/data/query", {
      metric: "cpu",
    });
    expect(result).toEqual(innerData);
  });
});

describe("NcloudClient 단위 테스트: 두 가지 에러 형식 파싱", () => {
  let client: NcloudClient;

  beforeEach(() => {
    client = new NcloudClient({
      accessKey: "testKey",
      secretKey: "testSecret",
      baseUrl: "https://ncloud.apigw.ntruss.com",
    });
  });

  it("형식 1 (API Gateway): error.errorCode와 error.message 추출", async () => {
    vi.stubGlobal(
      "fetch",
      createMockFetch(
        { error: { errorCode: "210", message: "Permission Denied" } },
        401
      )
    );

    await expect(
      client.request("/vserver/v2/getServerInstanceList", {})
    ).rejects.toThrow("에러 코드: 210");

    vi.stubGlobal(
      "fetch",
      createMockFetch(
        { error: { errorCode: "210", message: "Permission Denied" } },
        401
      )
    );

    await expect(
      client.request("/vserver/v2/getServerInstanceList", {})
    ).rejects.toThrow("메시지: Permission Denied");
  });

  it("형식 2 (서비스): responseError.returnCode와 returnMessage 추출", async () => {
    vi.stubGlobal(
      "fetch",
      createMockFetch(
        {
          responseError: {
            returnCode: "300",
            returnMessage: "요청한 리소스를 찾을 수 없습니다.",
          },
        },
        404
      )
    );

    await expect(
      client.request("/vserver/v2/getServerInstanceDetail", {
        serverInstanceNo: "99999",
      })
    ).rejects.toThrow("에러 코드: 300");

    vi.stubGlobal(
      "fetch",
      createMockFetch(
        {
          responseError: {
            returnCode: "300",
            returnMessage: "요청한 리소스를 찾을 수 없습니다.",
          },
        },
        404
      )
    );

    await expect(
      client.request("/vserver/v2/getServerInstanceDetail", {
        serverInstanceNo: "99999",
      })
    ).rejects.toThrow("메시지: 요청한 리소스를 찾을 수 없습니다.");
  });

  it("형식 1: HTTP 200이지만 body에 error가 있으면 에러 throw", async () => {
    vi.stubGlobal(
      "fetch",
      createMockFetch(
        { error: { errorCode: "100", message: "Bad Request" } },
        200
      )
    );

    await expect(
      client.request("/vserver/v2/getServerInstanceList", {})
    ).rejects.toThrow("에러 코드: 100");
  });

  it("형식 2: HTTP 200이지만 body에 responseError가 있으면 에러 throw", async () => {
    vi.stubGlobal(
      "fetch",
      createMockFetch(
        {
          responseError: {
            returnCode: "900",
            returnMessage: "Internal Server Error",
          },
        },
        200
      )
    );

    await expect(
      client.request("/vserver/v2/getServerInstanceList", {})
    ).rejects.toThrow("에러 코드: 900");
  });

  it("postRequest에서도 형식 1 에러 처리", async () => {
    vi.stubGlobal(
      "fetch",
      createMockFetch(
        { error: { errorCode: "401", message: "Unauthorized" } },
        401
      )
    );

    await expect(
      client.postRequest("/cw_fea/real/cw/api/data/query", {})
    ).rejects.toThrow("메시지: Unauthorized");
  });

  it("postRequest에서도 형식 2 에러 처리", async () => {
    vi.stubGlobal(
      "fetch",
      createMockFetch(
        {
          responseError: {
            returnCode: "500",
            returnMessage: "서버 내부 오류",
          },
        },
        500
      )
    );

    await expect(
      client.postRequest("/cw_fea/real/cw/api/data/query", {})
    ).rejects.toThrow("메시지: 서버 내부 오류");
  });
});
