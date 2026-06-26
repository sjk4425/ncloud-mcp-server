import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { registerBillingTools } from "./billing.js";

function createMockClient(): NcloudClient {
  return new NcloudClient({
    accessKey: "testAccessKey",
    secretKey: "testSecretKey",
    baseUrl: "https://billingapi.apigw.ntruss.com",
    regionCode: "KR",
  });
}

function getToolHandler(server: McpServer, toolName: string): any {
  const tools = (server as any)._registeredTools;
  const entry = tools instanceof Map ? tools.get(toolName) : tools[toolName];
  if (!entry) throw new Error(`Tool ${toolName} not found`);
  return entry.handler;
}

// REPORT 2장 #2 재현용: LB 상품은 productName이 빈 문자열/한글이고,
// 영문 "Load Balancer"는 productType.codeName / productItemKind.codeName 에만 존재.
const LB_ITEM = {
  productCode: "SPLOADB000000016",
  productName: "", // 빈 문자열 — NCP productName 필터로는 잡히지 않음
  productDescription: "어플리케이션 로드밸런서(VPC)",
  productType: { code: "VLB", codeName: "Load balancer" },
  productItemKind: { code: "LB", codeName: "Load Balancer (VPC)" },
  productCategory: { code: "NETWORKING", codeName: "Networking" },
  priceList: [
    {
      price: 26,
      unit: { code: "HR", codeName: "Hour" },
      productRatingType: { code: "PF_SM", codeName: "PF_SM" },
      payCurrency: { code: "KRW", codeName: "KRW" },
      // P3 price 모드에서 drop 되어야 할 대형 배열들
      promiseList: [{ a: 1 }, { a: 2 }],
      periodUnitList: [{ b: 1 }],
      countryUnitList: [{ c: 1 }],
      packageUnitList: [{ d: 1 }],
    },
  ],
  // prune 대상 빈 필드들 (REPORT 2장 원인 b)
  dbKind: {},
  osType: {},
  gpuCount: 0,
  generationCode: "",
};
const SERVER_ITEM = {
  productCode: "SVR000000000001",
  productName: "vCPU 2EA, Memory 4GB",
  productDescription: "표준 서버",
  productType: { codeName: "Server" },
  productItemKind: { codeName: "VPC Server" },
  priceList: [{ price: 40, unit: "Hour" }],
};

describe("billing: ncloud_get_product_price_list 검색 폴백 (REPORT P1 #2)", () => {
  let server: McpServer;
  let client: NcloudClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerBillingTools(server, client);
  });

  it("productName='Load Balancer' → productName을 API로 보내지 않고 후필터로 LB를 찾는다", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({
      totalRows: 2,
      productPriceList: [LB_ITEM, SERVER_ITEM],
    });
    const handler = getToolHandler(server, "ncloud_get_product_price_list");
    const result = await handler({ regionCode: "KR", productName: "Load Balancer" }, {} as any);

    // productName은 API 쿼리에 포함되지 않아야 한다
    const apiParams = spy.mock.calls[0][2] as Record<string, string>;
    expect(apiParams.productName).toBeUndefined();
    expect(apiParams.regionCode).toBe("KR");

    const data = JSON.parse(result.content[0].text);
    expect(data.searchMode).toBe(true);
    expect(data.matchedRows).toBe(1);
    expect(data.productPriceList).toHaveLength(1);
    expect(data.productPriceList[0].productCode).toBe("SPLOADB000000016");
    spy.mockRestore();
  });

  it("detailLevel='full' + prune: 빈 필드({}, '')는 제거, 0은 보존", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({
      totalRows: 1,
      productPriceList: [LB_ITEM],
    });
    const handler = getToolHandler(server, "ncloud_get_product_price_list");
    const result = await handler({ regionCode: "KR", productName: "로드밸런서", detailLevel: "full" }, {} as any);

    const item = JSON.parse(result.content[0].text).productPriceList[0];
    expect(item.dbKind).toBeUndefined(); // {} 제거
    expect(item.osType).toBeUndefined(); // {} 제거
    expect(item.generationCode).toBeUndefined(); // "" 제거
    expect(item.gpuCount).toBe(0); // 0 은 의미 있는 값 → 보존
    // full 모드에서는 대형 배열도 그대로 보존
    expect(item.priceList[0].promiseList).toBeDefined();
    // 들여쓰기 없는 compact 직렬화
    expect(result.content[0].text).not.toContain("\n");
    spy.mockRestore();
  });

  it("P3 detailLevel='price'(기본): 식별+가격 필드만 남기고 대형 배열/HW 메타는 제거", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({
      totalRows: 1,
      productPriceList: [LB_ITEM],
    });
    const handler = getToolHandler(server, "ncloud_get_product_price_list");
    // detailLevel 미지정 → 기본 price (핸들러는 undefined를 price로 취급)
    const result = await handler({ regionCode: "KR", productName: "로드밸런서" }, {} as any);

    const item = JSON.parse(result.content[0].text).productPriceList[0];
    // 식별 필드 보존
    expect(item.productCode).toBe("SPLOADB000000016");
    expect(item.productItemKind).toBe("Load Balancer (VPC)"); // codeName 으로 평탄화
    expect(item.productType).toBe("Load balancer");
    // 가격 필드 보존
    const pr = item.priceList[0];
    expect(pr.price).toBe(26);
    expect(pr.unit).toBe("Hour"); // unit.codeName
    expect(pr.productRatingType).toBe("PF_SM");
    expect(pr.payCurrency).toBe("KRW");
    // 대형 배열은 제거(용량 주범)
    expect(pr.promiseList).toBeUndefined();
    expect(pr.periodUnitList).toBeUndefined();
    expect(pr.countryUnitList).toBeUndefined();
    expect(pr.packageUnitList).toBeUndefined();
    // HW/OS 메타데이터도 미존재
    expect(item.gpuCount).toBeUndefined();
    expect(item.dbKind).toBeUndefined();
    spy.mockRestore();
  });

  it("검색어가 어디에도 없으면 0건, searchMode 메타는 유지", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({
      totalRows: 2,
      productPriceList: [LB_ITEM, SERVER_ITEM],
    });
    const handler = getToolHandler(server, "ncloud_get_product_price_list");
    const result = await handler({ regionCode: "KR", productName: "NoSuchProductXYZ" }, {} as any);

    const data = JSON.parse(result.content[0].text);
    expect(data.searchMode).toBe(true);
    expect(data.matchedRows).toBe(0);
    expect(data.productPriceList).toHaveLength(0);
    spy.mockRestore();
  });

  it("productName 미지정(비검색 모드)이면 응답을 그대로(prune만) 반환", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({
      totalRows: 1,
      productPriceList: [SERVER_ITEM],
    });
    const handler = getToolHandler(server, "ncloud_get_product_price_list");
    const result = await handler({ regionCode: "KR", productCategoryCode: "COMPUTE" }, {} as any);

    const apiParams = spy.mock.calls[0][2] as Record<string, string>;
    expect(apiParams.productCategoryCode).toBe("COMPUTE");
    const data = JSON.parse(result.content[0].text);
    expect(data.searchMode).toBeUndefined();
    expect(data.productPriceList).toHaveLength(1);
    spy.mockRestore();
  });
});

describe("billing: ncloud_get_product_list 검색 폴백", () => {
  let server: McpServer;
  let client: NcloudClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerBillingTools(server, client);
  });

  it("productList 컨테이너 키로 후필터한다", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({
      totalRows: 2,
      productList: [LB_ITEM, SERVER_ITEM],
    });
    const handler = getToolHandler(server, "ncloud_get_product_list");
    const result = await handler({ regionCode: "KR", productName: "Load Balancer" }, {} as any);

    const data = JSON.parse(result.content[0].text);
    expect(data.matchedRows).toBe(1);
    expect(data.productList[0].productCode).toBe("SPLOADB000000016");
    spy.mockRestore();
  });
});

// PLAN_response-size-guard 검증 (E 시나리오)
function makeMysqlItems(n: number, opts: { bigDesc?: boolean } = {}): any[] {
  return Array.from({ length: n }, (_, i) => ({
    productCode: `P${String(i).padStart(4, "0")}`,
    productName: `Cloud DB for MySQL tier ${i}`,
    productDescription: opts.bigDesc ? "x".repeat(2000) : `desc ${i}`,
    productType: { codeName: "MySQL" },
    productItemKind: { codeName: "Cloud DB" },
    priceList: [{ price: 100 + i, unit: { codeName: "Hour" }, productRatingType: { codeName: `R${i}` } }],
  }));
}

describe("billing: 응답 크기 가드 (PLAN E 시나리오)", () => {
  let server: McpServer;
  let client: NcloudClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerBillingTools(server, client);
  });

  it("E-1: 94건 매칭 → 기본 pageSize 50로 page1 반환 + hasMore/nextPageNo", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({
      totalRows: 94,
      productPriceList: makeMysqlItems(94),
    });
    const handler = getToolHandler(server, "ncloud_get_product_price_list");
    const result = await handler({ regionCode: "KR", productName: "MySQL" }, {} as any);

    const data = JSON.parse(result.content[0].text);
    expect(data.matchedRows).toBe(94);
    expect(data.pageNo).toBe(1);
    expect(data.pageSize).toBe(50);
    expect(data.returnedRows).toBe(50);
    expect(data.productPriceList).toHaveLength(50);
    expect(data.hasMore).toBe(true);
    expect(data.nextPageNo).toBe(2);
    expect(data.truncated).toBeUndefined(); // 가드 미발동
    spy.mockRestore();
  });

  it("E-2: pageNo=2 이어받기 — page1+page2 합치면 94건 누락·중복 없음", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({
      totalRows: 94,
      productPriceList: makeMysqlItems(94),
    });
    const handler = getToolHandler(server, "ncloud_get_product_price_list");
    const page1 = JSON.parse((await handler({ regionCode: "KR", productName: "MySQL" }, {} as any)).content[0].text);
    const page2 = JSON.parse((await handler({ regionCode: "KR", productName: "MySQL", pageNo: 2 }, {} as any)).content[0].text);

    expect(page2.returnedRows).toBe(44);
    expect(page2.hasMore).toBe(false);
    expect(page2.nextPageNo).toBeNull();

    const codes = [...page1.productPriceList, ...page2.productPriceList].map((p: any) => p.productCode);
    expect(codes).toHaveLength(94);
    expect(new Set(codes).size).toBe(94); // 중복 없음
    spy.mockRestore();
  });

  it("E-3: 안정 정렬 — NCP가 역순으로 줘도 page1은 productCode 최소값부터", async () => {
    const reversed = makeMysqlItems(94).reverse();
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({
      totalRows: 94,
      productPriceList: reversed,
    });
    const handler = getToolHandler(server, "ncloud_get_product_price_list");
    const data = JSON.parse((await handler({ regionCode: "KR", productName: "MySQL" }, {} as any)).content[0].text);

    expect(data.productPriceList[0].productCode).toBe("P0000");
    expect(data.productPriceList[49].productCode).toBe("P0049");
    spy.mockRestore();
  });

  it("E-4: 단일 페이지가 임계 초과 → 항목 단위 truncate + JSON 유효 + truncated 메타", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({
      totalRows: 50,
      productPriceList: makeMysqlItems(50, { bigDesc: true }),
    });
    const handler = getToolHandler(server, "ncloud_get_product_price_list");
    const result = await handler({ regionCode: "KR", productName: "MySQL" }, {} as any);

    // JSON 유효성(파싱 성공) — 글자 수 컷이 아니라 항목 단위 컷이어야 함
    const data = JSON.parse(result.content[0].text);
    expect(data.truncated).toBe(true);
    expect(data.returnedRows).toBeLessThan(50);
    expect(data.returnedRows).toBeGreaterThan(0);
    expect(data.productPriceList).toHaveLength(data.returnedRows);
    expect(data.nextPageNo).toBeNull(); // 가드 발동 시 페이지 건너뛰기 손실 방지
    expect(data.hasMore).toBe(true); // 데이터가 더 있음(거짓 false 금지 — 조용한 손실 방지)
    expect(data.suggestedPageSize).toBe(data.returnedRows); // 회복용 pageSize 힌트
    spy.mockRestore();
  });
});

// ── 2026-06-25 상품 분류 코드 개편 대응 ──────────────────────────────────
describe("billing: 분류 코드 개편 (2026-06-25)", () => {
  let server: McpServer;
  let client: NcloudClient;

  beforeEach(() => {
    server = new McpServer({ name: "test", version: "1.0.0" });
    client = createMockClient();
    registerBillingTools(server, client);
  });

  it("slim 투영: 신규 분류 필드를 코드 객체({code,codeName})에서 노출", async () => {
    const item = {
      productCode: "VSVR000000000001",
      productName: "vCPU 2EA",
      productType: { codeName: "STAND" },
      productItemKind: { codeName: "VPC Server" },
      productItemKindDetail: { code: "VM", codeName: "VM" },
      productTypeDetail: { code: "A100", codeName: "A100" },
      priceList: [{ price: 40, unit: { codeName: "Hour" } }],
    };
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ totalRows: 1, productPriceList: [item] });
    const handler = getToolHandler(server, "ncloud_get_product_price_list");
    const result = await handler({ regionCode: "KR" }, {} as any);

    const out = JSON.parse(result.content[0].text).productPriceList[0];
    expect(out.productItemKindDetail).toBe("VM");
    expect(out.productTypeDetail).toBe("A100");
    expect(out.productType).toBe("STAND");
    spy.mockRestore();
  });

  it("slim 투영: 분류 필드가 flat 문자열로 와도(공지 표기) 그대로 노출", async () => {
    const item = {
      productCode: "BST000000000001",
      productName: "Block Storage",
      productTypeCode: "SSD", // flat
      productItemKindDetailCode: "BSTAD", // flat
      productTypeDetailCode: "CB1", // flat
      priceList: [{ price: 1, unit: "GB" }],
    };
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ totalRows: 1, productPriceList: [item] });
    const handler = getToolHandler(server, "ncloud_get_product_price_list");
    const result = await handler({ regionCode: "KR" }, {} as any);

    const out = JSON.parse(result.content[0].text).productPriceList[0];
    expect(out.productType).toBe("SSD");
    expect(out.productItemKindDetail).toBe("BSTAD");
    expect(out.productTypeDetail).toBe("CB1");
    spy.mockRestore();
  });

  it("키워드 검색이 신규 세부 분류 필드(BM 등)도 매칭", async () => {
    const bmItem = {
      productCode: "BM000000000001",
      productName: "", // 비어있음 — 세부 분류로만 식별
      productItemKindDetail: { code: "BM", codeName: "BM" },
      priceList: [{ price: 100, unit: "Hour" }],
    };
    const vmItem = {
      productCode: "VM000000000001",
      productName: "vCPU 2EA",
      productItemKindDetail: { code: "VM", codeName: "VM" },
      priceList: [{ price: 40, unit: "Hour" }],
    };
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ totalRows: 2, productPriceList: [bmItem, vmItem] });
    const handler = getToolHandler(server, "ncloud_get_product_price_list");
    const result = await handler({ regionCode: "KR", productName: "BM" }, {} as any);

    const data = JSON.parse(result.content[0].text);
    expect(data.matchedRows).toBe(1);
    expect(data.productPriceList[0].productCode).toBe("BM000000000001");
    spy.mockRestore();
  });

  it("요청 파라미터 productItemKindDetailCode를 List Price 도구가 API로 전달", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ totalRows: 0, productList: [] });
    const handler = getToolHandler(server, "ncloud_get_product_list");
    await handler({ regionCode: "KR", productItemKindDetailCode: "VM" }, {} as any);

    const apiParams = spy.mock.calls[0][2] as Record<string, string>;
    expect(apiParams.productItemKindDetailCode).toBe("VM");
    spy.mockRestore();
  });

  it("요청 파라미터 productItemKindDetailCode를 Cost 도구(getContractUsageList)가 API로 전달", async () => {
    const spy = vi.spyOn(client, "requestRaw").mockResolvedValue({ totalRows: 0 });
    const handler = getToolHandler(server, "ncloud_get_contract_usage_list");
    await handler({ startMonth: "202601", endMonth: "202601", productItemKindDetailCode: "BM" }, {} as any);

    const apiParams = spy.mock.calls[0][2] as Record<string, string>;
    expect(apiParams.productItemKindDetailCode).toBe("BM");
    spy.mockRestore();
  });
});
