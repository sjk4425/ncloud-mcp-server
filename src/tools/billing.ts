import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";
import { prune, paginateWithGuard } from "./_response.js";
import { defineTool } from "./_tool.js";

/**
 * Ncloud Billing API Tools
 * Base URL: https://billingapi.apigw.ntruss.com/billing/v1
 *
 * Categories:
 * - List Price: 요금제/서비스/가격 조회
 * - Cost and Usage: 청구 비용/사용량 조회
 * - Discount: 할인/코인/크레딧 조회
 *
 * 모든 API는 조회(GET) 전용이며 파괴적 작업이 없습니다.
 */

// ─── 검색 폴백 헬퍼 (List Price 도구 전용) ───────────────────────────────
// 배경: NCP의 productName 필터는 productName 필드 하나만 검색하는데, LB 등 다수 상품은
// productName이 빈 문자열/한글이라 영문 키워드로 0건이 된다(REPORT 2장 #2).
// 대응: productName은 API로 보내지 않고, 받아온 목록을 아래 필드들에 대해
// 대소문자 무시 부분일치로 후필터한다(REPORT 4장 P1).

const SEARCH_FETCH_MAX_PAGES = 10; // 검색 모드에서 스캔할 최대 페이지(페이지당 1000행)

/** 검색 대상 필드에 대해 query(소문자) 부분일치 여부. */
function matchesProductQuery(p: any, q: string): boolean {
  const fields = [
    p?.productName,
    p?.productDescription,
    p?.productCode,
    p?.productType?.codeName,
    p?.productItemKind?.codeName,
  ];
  return fields.some((s) => typeof s === "string" && s.toLowerCase().includes(q));
}

/** NCP 응답(flat 또는 1-depth wrapper)에서 list와 totalRows를 추출. */
function extractList(result: any, listKey: string): { list: any[]; total: number } {
  let container = result;
  if (!Array.isArray(container?.[listKey]) && result && typeof result === "object") {
    for (const v of Object.values(result)) {
      if (v && typeof v === "object" && Array.isArray((v as any)[listKey])) {
        container = v;
        break;
      }
    }
  }
  const list = Array.isArray(container?.[listKey]) ? container[listKey] : [];
  const total = typeof container?.totalRows === "number" ? container.totalRows : list.length;
  return { list, total };
}

// ─── P3 slim projection (가격 도구 detailLevel="price") ───────────────────
// getProductPriceList 응답은 항목당 HW/OS 메타데이터와 promiseList/periodUnitList/
// countryUnitList/packageUnitList 등 대형 배열로 비대(REPORT_test-result B-2: 49행≈138KB).
// price 모드는 가격·식별 필드만 남겨 용량 주범을 제거한다. 필드명은 공식 docs 기준
// (https://api.ncloud-docs.com/docs/platform-listprice-getproductpricelist).

/** priceList 항목을 핵심 가격 필드로 축약. */
function slimPriceEntry(pr: any): any {
  const rating = pr?.productRatingType;
  return {
    price: pr?.price,
    unit: pr?.unit?.codeName,
    chargingUnitType: pr?.chargingUnitType?.codeName,
    ratingUnitType: pr?.ratingUnitType?.codeName,
    productRatingType: rating && typeof rating === "object" ? rating.codeName : rating,
    priceType: pr?.priceType?.codeName,
    conditionType: pr?.conditionType?.codeName,
    conditionPrice: pr?.conditionPrice,
    payCurrency: pr?.payCurrency?.codeName,
    freeUnit: pr?.freeUnit,
    freeValue: pr?.freeValue,
    meteringUnit: pr?.meteringUnit?.codeName,
    region: pr?.region?.regionCode,
  };
}

/** productPrice 항목을 식별 필드 + 축약 priceList 로 projection. */
function slimProductPrice(p: any): any {
  return {
    productCode: p?.productCode,
    productName: p?.productName,
    productDescription: p?.productDescription,
    productCategory: p?.productCategory?.codeName,
    productType: p?.productType?.codeName,
    productItemKind: p?.productItemKind?.codeName,
    priceList: Array.isArray(p?.priceList) ? p.priceList.map(slimPriceEntry) : undefined,
  };
}

// ─── 응답 크기 가드 (PLAN_response-size-guard) ────────────────────────────
// 슬림 투영·prune은 항목당 크기만 줄여, 매칭 건수가 많으면(예: productName="MySQL"
// 94건 ≈ 67KB) 슬림 후에도 클라이언트 토큰 한도를 초과한다. → ② 기본 pageSize 하향
// (정상 흐름을 페이지로 흡수) + ③ 하드 크기 가드(backstop)로 대응.

const LISTPRICE_DEFAULT_PAGE_SIZE = 50; // ② 기본 페이지 크기 (실측: 항목당 ~0.7KB → ~36KB/페이지)
const LISTPRICE_MAX_PAGE_SIZE = 1000; // NCP 상한
const LISTPRICE_GUARD_MAX_BYTES = 45000; // ③ 페이지 직렬화 임계 (실측: 36KB 통과 / 67KB 초과 사이)

/** productCode 기준 안정 정렬 비교자 — NCP 응답 순서가 호출마다 달라질 수 있어 서버에서 고정. */
function byProductCode(a: any, b: any): number {
  return String(a?.productCode ?? "").localeCompare(String(b?.productCode ?? ""));
}

/** 사용자 pageSize를 [1, 상한]으로 클램프, 미지정 시 기본값. */
function resolvePageSize(userPageSize?: number): number {
  if (userPageSize === undefined) return LISTPRICE_DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(1, Math.floor(userPageSize)), LISTPRICE_MAX_PAGE_SIZE);
}

/** baseParams로 페이지를 순회하며 목록 전체를 모은다(최대 SEARCH_FETCH_MAX_PAGES×1000). */
async function scanAll(
  client: NcloudClient,
  path: string,
  listKey: string,
  baseParams: Record<string, string>
): Promise<{ scanned: any[]; totalRows: number }> {
  const scanned: any[] = [];
  let totalRows = 0;
  for (let pageNo = 1; pageNo <= SEARCH_FETCH_MAX_PAGES; pageNo++) {
    const params = { ...baseParams, pageNo: String(pageNo), pageSize: "1000" };
    const result = await client.requestRaw("GET", path, params);
    const { list, total } = extractList(result, listKey);
    totalRows = total;
    scanned.push(...list);
    if (list.length === 0 || scanned.length >= totalRows) break;
  }
  return { scanned, totalRows };
}

/**
 * List Price 계열 공통 조회: 전체 스캔 → (검색 시) 후필터 → 안정 정렬 → 항목 가공
 * → 페이지네이션 + 하드 가드. 검색·비검색 모두 동일 경로(안정 페이지네이션 보장).
 */
async function runListPriceQuery(opts: {
  client: NcloudClient;
  path: string;
  listKey: string;
  baseParams: Record<string, string>;
  productName?: string;
  pageNo?: number;
  pageSize?: number;
  project?: (item: any) => any;
}): Promise<Record<string, any>> {
  const { client, path, listKey, baseParams, productName, pageNo, pageSize } = opts;
  const project = opts.project ?? ((x: any) => x);

  const { scanned, totalRows: categoryTotal } = await scanAll(client, path, listKey, baseParams);
  const scanTruncated = scanned.length < categoryTotal; // 최대 페이지 한도로 전부 스캔 못함

  // 검색 모드: productName을 API로 보내지 않고 5개 필드 부분일치 후필터(REPORT 4장 P1)
  let candidates = scanned;
  const searchMeta: Record<string, any> = {};
  if (productName) {
    const q = productName.toLowerCase();
    candidates = scanned.filter((p) => matchesProductQuery(p, q));
    searchMeta.searchMode = true;
    searchMeta.query = productName;
    searchMeta.matchedRows = candidates.length;
    searchMeta.scannedRows = scanned.length;
    searchMeta.categoryTotalRows = categoryTotal; // 필터 전 카테고리 전체
  } else {
    searchMeta.totalRows = candidates.length; // 비검색: 페이징 대상 전체
  }

  // 안정 정렬(원본 productCode) 후 항목 가공(prune ∘ project)
  candidates = [...candidates].sort(byProductCode);
  const projected = candidates.map((x) => prune(project(x)));

  const { items, meta } = paginateWithGuard(projected, {
    pageNo,
    pageSize: resolvePageSize(pageSize),
    maxBytes: LISTPRICE_GUARD_MAX_BYTES,
  });

  // 사람이 읽는 안내 문구
  const denom = candidates.length;
  const start = (meta.pageNo - 1) * meta.pageSize;
  let note: string;
  if (meta.truncated) {
    note = `응답이 커서 ${meta.returnedRows}건만 반환했습니다. pageSize=${meta.suggestedPageSize} 이하로 다시 조회하면 전체를 누락 없이 순회할 수 있고, productCategoryCode/productItemKindCode로 좁혀도 됩니다.`;
  } else if (meta.hasMore) {
    note = `전체 ${denom}건 중 ${start + 1}~${start + meta.returnedRows}건 표시. 다음은 pageNo=${meta.nextPageNo}.`;
  } else {
    note = `전체 ${denom}건 중 ${denom === 0 ? 0 : start + 1}~${start + meta.returnedRows}건 표시(마지막 페이지).`;
  }

  return {
    ...searchMeta,
    ...meta,
    ...(scanTruncated ? { scanTruncated: true } : {}),
    note,
    [listKey]: items,
  };
}

export function registerBillingTools(server: McpServer, client: NcloudClient): void {

  // ============================================================
  // List Price APIs — /product/...
  // ============================================================

  // ncloud_get_price_list — 요금제 목록 조회
  defineTool(
    server,
    "ncloud_get_price_list",
    "Get price list by price numbers. Retrieves pricing plan details including charging unit, rating unit, conditions, and promise discounts.",
    {
      priceNoList: z.array(z.string()).describe("List of price numbers to query (1~99 items, required)"),
      promiseNoList: z.array(z.string()).optional().describe("List of promise numbers to filter"),
      payCurrencyCode: z.enum(["KRW", "USD", "JPY"]).optional().describe("Payment currency code"),
    },
    async ({ priceNoList, promiseNoList, payCurrencyCode }) => {
      const params: Record<string, string> = { responseFormatType: "json" };
      priceNoList.forEach((no, i) => { params[`priceNoList.${i + 1}`] = no; });
      if (promiseNoList) promiseNoList.forEach((no, i) => { params[`promiseNoList.${i + 1}`] = no; });
      if (payCurrencyCode) params["payCurrencyCode"] = payCurrencyCode;
      const result = await client.requestRaw("GET", "/billing/v1/product/getPriceList", params);
      return result;
    }
  );

  // ncloud_get_product_category_list — 서비스 카테고리 목록 조회
  defineTool(
    server,
    "ncloud_get_product_category_list",
    "Get product category list for Ncloud billing. Returns available service categories like COMPUTE, DATABASE, NETWORKING, etc.",
    {
      productCategoryCode: z.string().optional().describe("Product category code to filter (e.g. COMPUTE)"),
    },
    async ({ productCategoryCode }) => {
      const params: Record<string, string> = { responseFormatType: "json" };
      if (productCategoryCode) params["productCategoryCode"] = productCategoryCode;
      const result = await client.requestRaw("GET", "/billing/v1/product/getProductCategoryList", params);
      return result;
    }
  );


  // ncloud_get_product_list — 서비스 목록 조회
  defineTool(
    server,
    "ncloud_get_product_list",
    "Get product (service) list for billing. Returns available products with their codes, names, descriptions, and categories. Use regionCode and optional filters to narrow results. Paginated (default 50/page, sorted by productCode); the response includes totalRows/returnedRows/hasMore/nextPageNo — follow nextPageNo to page through all results.",
    {
      regionCode: z.string().describe("Region code (e.g. KR, JPN, SGN)"),
      pageNo: z.number().optional().describe("Page number (default 1). Use nextPageNo from the response to page through results."),
      pageSize: z.number().optional().describe("Page size (default 50, max 1000). Results are server-sorted by productCode for stable pagination."),
      productItemKindCode: z.string().optional().describe("Product item kind code (e.g. VSVR, SW)"),
      productCategoryCode: z.string().optional().describe("Product category code (e.g. COMPUTE)"),
      productCode: z.string().optional().describe("Product code to filter"),
      productName: z.string().optional().describe("Keyword search (case-insensitive substring). Matches across productName, productDescription, productCode, productType.codeName, productItemKind.codeName — works even when the NCP productName field is empty/Korean (e.g. 'Load Balancer')."),
    },
    async ({ regionCode, pageNo, pageSize, productItemKindCode, productCategoryCode, productCode, productName }) => {
      const baseParams: Record<string, string> = { responseFormatType: "json", regionCode };
      if (productItemKindCode) baseParams["productItemKindCode"] = productItemKindCode;
      if (productCategoryCode) baseParams["productCategoryCode"] = productCategoryCode;
      if (productCode) baseParams["productCode"] = productCode;

      const result = await runListPriceQuery({
        client,
        path: "/billing/v1/product/getProductList",
        listKey: "productList",
        baseParams,
        productName,
        pageNo,
        pageSize,
      });
      return result;
    }
  );

  // ncloud_get_product_price_list — 서비스 및 가격 목록 조회
  defineTool(
    server,
    "ncloud_get_product_price_list",
    "Get product and price list. Returns products with their associated pricing information including monthly/hourly rates, conditions, and discount details. Paginated (default 50/page, sorted by productCode); the response includes totalRows/returnedRows/hasMore/nextPageNo (and truncated=true if a single page was size-capped) — follow nextPageNo to page through all results.",
    {
      regionCode: z.string().describe("Region code (e.g. KR, JPN, SGN)"),
      pageNo: z.number().optional().describe("Page number (default 1). Use nextPageNo from the response to page through results."),
      pageSize: z.number().optional().describe("Page size (default 50, max 1000). Results are server-sorted by productCode for stable pagination."),
      productItemKindCode: z.string().optional().describe("Product item kind code (e.g. VSVR)"),
      productCategoryCode: z.string().optional().describe("Product category code (e.g. COMPUTE)"),
      productCode: z.string().optional().describe("Product code to filter"),
      productName: z.string().optional().describe("Keyword search (case-insensitive substring). Matches across productName, productDescription, productCode, productType.codeName, productItemKind.codeName — works even when the NCP productName field is empty/Korean (e.g. 'Load Balancer')."),
      payCurrencyCode: z.enum(["KRW", "USD", "JPY"]).optional().describe("Payment currency code"),
      detailLevel: z.enum(["price", "full"]).optional().default("price").describe("'price' (default): slim response with identity + price fields only (much smaller). 'full': raw payload with all metadata. Tip: for broad category queries combine productCategoryCode + productName to keep responses small."),
    },
    async ({ regionCode, pageNo, pageSize, productItemKindCode, productCategoryCode, productCode, productName, payCurrencyCode, detailLevel }) => {
      const baseParams: Record<string, string> = { responseFormatType: "json", regionCode };
      if (productItemKindCode) baseParams["productItemKindCode"] = productItemKindCode;
      if (productCategoryCode) baseParams["productCategoryCode"] = productCategoryCode;
      if (productCode) baseParams["productCode"] = productCode;
      if (payCurrencyCode) baseParams["payCurrencyCode"] = payCurrencyCode;

      // P3: detailLevel="full" 아니면 price 모드(기본) — 항목을 가격·식별 필드로 축약
      const project = detailLevel === "full" ? (x: any) => x : slimProductPrice;

      const result = await runListPriceQuery({
        client,
        path: "/billing/v1/product/getProductPriceList",
        listKey: "productPriceList",
        baseParams,
        productName,
        pageNo,
        pageSize,
        project,
      });
      return result;
    }
  );


  // ============================================================
  // Cost and Usage APIs — /cost/...
  // ============================================================

  // ncloud_get_demand_cost_list — 월 청구 비용 목록 조회
  defineTool(
    server,
    "ncloud_get_demand_cost_list",
    "Get monthly billing cost list. Returns total billing amounts including discounts, VAT, and payment status for the specified period (max 3 months).",
    {
      startMonth: z.string().describe("Start month in yyyyMM format (e.g. 202401)"),
      endMonth: z.string().describe("End month in yyyyMM format (e.g. 202403, max 3 months range)"),
      pageNo: z.number().optional().describe("Page number"),
      pageSize: z.number().optional().describe("Page size (max 1000, default 1000)"),
      isOrganization: z.boolean().optional().describe("Query as Organization master (integrated view)"),
      isPartner: z.boolean().optional().describe("Query as Partner representative"),
      memberNoList: z.array(z.string()).optional().describe("Member number list (master/partner only)"),
    },
    async ({ startMonth, endMonth, pageNo, pageSize, isOrganization, isPartner, memberNoList }) => {
      const params: Record<string, string> = { responseFormatType: "json", startMonth, endMonth };
      if (pageNo !== undefined) params["pageNo"] = String(pageNo);
      if (pageSize !== undefined) params["pageSize"] = String(pageSize);
      if (isOrganization !== undefined) params["isOrganization"] = String(isOrganization);
      if (isPartner !== undefined) params["isPartner"] = String(isPartner);
      if (memberNoList) memberNoList.forEach((no, i) => { params[`memberNoList.${i + 1}`] = no; });
      const result = await client.requestRaw("GET", "/billing/v1/cost/getDemandCostList", params);
      return result;
    }
  );

  // ncloud_get_product_demand_cost_list — 서비스별 청구 비용 목록 조회
  defineTool(
    server,
    "ncloud_get_product_demand_cost_list",
    "Get billing cost list grouped by product/service type. Returns per-service billing amounts with discount breakdowns for the specified period (max 3 months).",
    {
      startMonth: z.string().describe("Start month in yyyyMM format (e.g. 202401)"),
      endMonth: z.string().describe("End month in yyyyMM format (e.g. 202403, max 3 months range)"),
      pageNo: z.number().optional().describe("Page number"),
      pageSize: z.number().optional().describe("Page size (max 1000, default 1000)"),
      isOrganization: z.boolean().optional().describe("Query as Organization master (integrated view)"),
      isPartner: z.boolean().optional().describe("Query as Partner representative"),
      memberNoList: z.array(z.string()).optional().describe("Member number list (master/partner only)"),
      productDemandTypeCode: z.string().optional().describe("Product demand type code to filter"),
    },
    async ({ startMonth, endMonth, pageNo, pageSize, isOrganization, isPartner, memberNoList, productDemandTypeCode }) => {
      const params: Record<string, string> = { responseFormatType: "json", startMonth, endMonth };
      if (pageNo !== undefined) params["pageNo"] = String(pageNo);
      if (pageSize !== undefined) params["pageSize"] = String(pageSize);
      if (isOrganization !== undefined) params["isOrganization"] = String(isOrganization);
      if (isPartner !== undefined) params["isPartner"] = String(isPartner);
      if (memberNoList) memberNoList.forEach((no, i) => { params[`memberNoList.${i + 1}`] = no; });
      if (productDemandTypeCode) params["productDemandTypeCode"] = productDemandTypeCode;
      const result = await client.requestRaw("GET", "/billing/v1/cost/getProductDemandCostList", params);
      return result;
    }
  );


  // ncloud_get_contract_demand_cost_list — 계약 청구 비용 목록 조회
  defineTool(
    server,
    "ncloud_get_contract_demand_cost_list",
    "Get contract-level billing cost list. Returns detailed billing per contract including usage quantities, pricing, and discount amounts for the specified period (max 3 months).",
    {
      startMonth: z.string().describe("Start month in yyyyMM format (e.g. 202401)"),
      endMonth: z.string().describe("End month in yyyyMM format (e.g. 202403, max 3 months range)"),
      pageNo: z.number().optional().describe("Page number"),
      pageSize: z.number().optional().describe("Page size (max 1000, default 1000)"),
      isOrganization: z.boolean().optional().describe("Query as Organization master (integrated view)"),
      isPartner: z.boolean().optional().describe("Query as Partner representative"),
      memberNoList: z.array(z.string()).optional().describe("Member number list (master/partner only)"),
      contractNo: z.string().optional().describe("Contract number to filter"),
      demandTypeCode: z.string().optional().describe("Demand type code"),
      demandTypeDetailCode: z.string().optional().describe("Demand type detail code"),
      regionCode: z.string().optional().describe("Region code (e.g. KR)"),
    },
    async ({ startMonth, endMonth, pageNo, pageSize, isOrganization, isPartner, memberNoList, contractNo, demandTypeCode, demandTypeDetailCode, regionCode }) => {
      const params: Record<string, string> = { responseFormatType: "json", startMonth, endMonth };
      if (pageNo !== undefined) params["pageNo"] = String(pageNo);
      if (pageSize !== undefined) params["pageSize"] = String(pageSize);
      if (isOrganization !== undefined) params["isOrganization"] = String(isOrganization);
      if (isPartner !== undefined) params["isPartner"] = String(isPartner);
      if (memberNoList) memberNoList.forEach((no, i) => { params[`memberNoList.${i + 1}`] = no; });
      if (contractNo) params["contractNo"] = contractNo;
      if (demandTypeCode) params["demandTypeCode"] = demandTypeCode;
      if (demandTypeDetailCode) params["demandTypeDetailCode"] = demandTypeDetailCode;
      if (regionCode) params["regionCode"] = regionCode;
      const result = await client.requestRaw("GET", "/billing/v1/cost/getContractDemandCostList", params);
      return result;
    }
  );

  // ncloud_get_contract_summary_list — 사용자 계약 요약 목록 조회
  defineTool(
    server,
    "ncloud_get_contract_summary_list",
    "Get contract summary list. Returns a summary of contracts grouped by region and contract type with counts for the specified month.",
    {
      contractMonth: z.string().describe("Contract month in yyyyMM format (e.g. 202404)"),
      pageNo: z.number().optional().describe("Page number"),
      pageSize: z.number().optional().describe("Page size (max 1000, default 1000)"),
      isOrganization: z.boolean().optional().describe("Query as Organization master (integrated view)"),
      isPartner: z.boolean().optional().describe("Query as Partner representative"),
      memberNoList: z.array(z.string()).optional().describe("Member number list (master/partner only)"),
      contractTypeCode: z.string().optional().describe("Contract type code (e.g. VSVR)"),
      contractStatusCode: z.enum(["ALL", "NOML", "NLEND"]).optional().describe("Contract status: ALL (default), NOML (normal), NLEND (terminated)"),
      regionCode: z.string().optional().describe("Region code (e.g. KR)"),
    },
    async ({ contractMonth, pageNo, pageSize, isOrganization, isPartner, memberNoList, contractTypeCode, contractStatusCode, regionCode }) => {
      const params: Record<string, string> = { responseFormatType: "json", contractMonth };
      if (pageNo !== undefined) params["pageNo"] = String(pageNo);
      if (pageSize !== undefined) params["pageSize"] = String(pageSize);
      if (isOrganization !== undefined) params["isOrganization"] = String(isOrganization);
      if (isPartner !== undefined) params["isPartner"] = String(isPartner);
      if (memberNoList) memberNoList.forEach((no, i) => { params[`memberNoList.${i + 1}`] = no; });
      if (contractTypeCode) params["contractTypeCode"] = contractTypeCode;
      if (contractStatusCode) params["contractStatusCode"] = contractStatusCode;
      if (regionCode) params["regionCode"] = regionCode;
      const result = await client.requestRaw("GET", "/billing/v1/cost/getContractSummaryList", params);
      return result;
    }
  );


  // ncloud_get_contract_usage_list — 계약 사용량 목록 조회
  defineTool(
    server,
    "ncloud_get_contract_usage_list",
    "Get contract usage list. Returns usage details per contract including metering type, usage quantity, and service period for the specified months (max 3 months).",
    {
      startMonth: z.string().describe("Start month in yyyyMM format (e.g. 202401)"),
      endMonth: z.string().describe("End month in yyyyMM format (e.g. 202403, max 3 months range)"),
      pageNo: z.number().optional().describe("Page number"),
      pageSize: z.number().optional().describe("Page size (max 1000, default 1000)"),
      isOrganization: z.boolean().optional().describe("Query as Organization master (integrated view)"),
      isPartner: z.boolean().optional().describe("Query as Partner representative"),
      memberNoList: z.array(z.string()).optional().describe("Member number list (master/partner only)"),
      contractNo: z.string().optional().describe("Contract number to filter"),
      contractTypeCode: z.string().optional().describe("Contract type code"),
      contractStatusCode: z.enum(["NOML", "NLEND"]).optional().describe("Contract status: NOML (normal), NLEND (terminated)"),
      regionCode: z.string().optional().describe("Region code (e.g. KR)"),
    },
    async ({ startMonth, endMonth, pageNo, pageSize, isOrganization, isPartner, memberNoList, contractNo, contractTypeCode, contractStatusCode, regionCode }) => {
      const params: Record<string, string> = { responseFormatType: "json", startMonth, endMonth };
      if (pageNo !== undefined) params["pageNo"] = String(pageNo);
      if (pageSize !== undefined) params["pageSize"] = String(pageSize);
      if (isOrganization !== undefined) params["isOrganization"] = String(isOrganization);
      if (isPartner !== undefined) params["isPartner"] = String(isPartner);
      if (memberNoList) memberNoList.forEach((no, i) => { params[`memberNoList.${i + 1}`] = no; });
      if (contractNo) params["contractNo"] = contractNo;
      if (contractTypeCode) params["contractTypeCode"] = contractTypeCode;
      if (contractStatusCode) params["contractStatusCode"] = contractStatusCode;
      if (regionCode) params["regionCode"] = regionCode;
      const result = await client.requestRaw("GET", "/billing/v1/cost/getContractUsageList", params);
      return result;
    }
  );

  // ncloud_get_contract_usage_list_by_daily — 일별 계약 사용량 목록 조회
  defineTool(
    server,
    "ncloud_get_contract_usage_list_by_daily",
    "Get daily contract usage list. Returns daily usage breakdown per contract for the specified date range (max 3 months).",
    {
      useStartDay: z.string().describe("Start day in yyyyMMdd format (e.g. 20240101)"),
      useEndDay: z.string().describe("End day in yyyyMMdd format (e.g. 20240131, max 3 months range)"),
      pageNo: z.number().optional().describe("Page number"),
      pageSize: z.number().optional().describe("Page size (max 1000, default 1000)"),
      isOrganization: z.boolean().optional().describe("Query as Organization master (integrated view)"),
      isPartner: z.boolean().optional().describe("Query as Partner representative"),
      memberNoList: z.array(z.string()).optional().describe("Member number list (master/partner only)"),
      contractNo: z.string().optional().describe("Contract number to filter"),
      contractTypeCode: z.string().optional().describe("Contract type code"),
      productItemKindCode: z.string().optional().describe("Product item kind code"),
      regionCode: z.string().optional().describe("Region code (e.g. KR)"),
    },
    async ({ useStartDay, useEndDay, pageNo, pageSize, isOrganization, isPartner, memberNoList, contractNo, contractTypeCode, productItemKindCode, regionCode }) => {
      const params: Record<string, string> = { responseFormatType: "json", useStartDay, useEndDay };
      if (pageNo !== undefined) params["pageNo"] = String(pageNo);
      if (pageSize !== undefined) params["pageSize"] = String(pageSize);
      if (isOrganization !== undefined) params["isOrganization"] = String(isOrganization);
      if (isPartner !== undefined) params["isPartner"] = String(isPartner);
      if (memberNoList) memberNoList.forEach((no, i) => { params[`memberNoList.${i + 1}`] = no; });
      if (contractNo) params["contractNo"] = contractNo;
      if (contractTypeCode) params["contractTypeCode"] = contractTypeCode;
      if (productItemKindCode) params["productItemKindCode"] = productItemKindCode;
      if (regionCode) params["regionCode"] = regionCode;
      const result = await client.requestRaw("GET", "/billing/v1/cost/getContractUsageListByDaily", params);
      return result;
    }
  );

  // ncloud_get_cost_relation_code_list — 비용 연관 코드 목록 조회
  defineTool(
    server,
    "ncloud_get_cost_relation_code_list",
    "Get cost relation code list. Returns mapping between contract types, product item kinds, rating types, metering types, demand types, and product categories. Useful for understanding billing code relationships.",
    {
      contractTypeCode: z.string().optional().describe("Contract type code (e.g. VSVR)"),
      productItemKindCode: z.string().optional().describe("Product item kind code"),
      productRatingTypeCode: z.string().optional().describe("Product rating type code"),
      meteringTypeCode: z.string().optional().describe("Metering type code"),
      productCategoryCode: z.string().optional().describe("Product category code (e.g. COMPUTE)"),
    },
    async ({ contractTypeCode, productItemKindCode, productRatingTypeCode, meteringTypeCode, productCategoryCode }) => {
      const params: Record<string, string> = { responseFormatType: "json" };
      if (contractTypeCode) params["contractTypeCode"] = contractTypeCode;
      if (productItemKindCode) params["productItemKindCode"] = productItemKindCode;
      if (productRatingTypeCode) params["productRatingTypeCode"] = productRatingTypeCode;
      if (meteringTypeCode) params["meteringTypeCode"] = meteringTypeCode;
      if (productCategoryCode) params["productCategoryCode"] = productCategoryCode;
      const result = await client.requestRaw("GET", "/billing/v1/cost/getCostRelationCodeList", params);
      return result;
    }
  );


  // ============================================================
  // Discount APIs — /discount/...
  // ============================================================

  // ncloud_get_discount_list — 할인 목록 조회
  defineTool(
    server,
    "ncloud_get_discount_list",
    "Get discount list. Returns all discounts (product discounts, credits, coins) assigned to the account with their validity periods and amounts.",
    {
      pageNo: z.number().optional().describe("Page number"),
      pageSize: z.number().optional().describe("Page size (max 1000, default 1000)"),
      isOrganization: z.boolean().optional().describe("Query as Organization master (integrated view)"),
      isPartner: z.boolean().optional().describe("Query as Partner representative"),
      memberNoList: z.array(z.string()).optional().describe("Member number list (master/partner only)"),
      discountTypeCode: z.enum(["PRODUCT", "CREDIT", "COIN"]).optional().describe("Discount type: PRODUCT (service discount), CREDIT, COIN"),
      startMonth: z.string().optional().describe("Start month in yyyyMM format (max 3 months range)"),
      endMonth: z.string().optional().describe("End month in yyyyMM format"),
      isValidDiscount: z.boolean().optional().describe("Filter only valid (active) discounts"),
    },
    async ({ pageNo, pageSize, isOrganization, isPartner, memberNoList, discountTypeCode, startMonth, endMonth, isValidDiscount }) => {
      const params: Record<string, string> = { responseFormatType: "json" };
      if (pageNo !== undefined) params["pageNo"] = String(pageNo);
      if (pageSize !== undefined) params["pageSize"] = String(pageSize);
      if (isOrganization !== undefined) params["isOrganization"] = String(isOrganization);
      if (isPartner !== undefined) params["isPartner"] = String(isPartner);
      if (memberNoList) memberNoList.forEach((no, i) => { params[`memberNoList.${i + 1}`] = no; });
      if (discountTypeCode) params["discountTypeCode"] = discountTypeCode;
      if (startMonth) params["startMonth"] = startMonth;
      if (endMonth) params["endMonth"] = endMonth;
      if (isValidDiscount !== undefined) params["isValidDiscount"] = String(isValidDiscount);
      const result = await client.requestRaw("GET", "/billing/v1/discount/getDiscountList", params);
      return result;
    }
  );

  // ncloud_get_coin_history_list — 코인 이력 목록 조회
  defineTool(
    server,
    "ncloud_get_coin_history_list",
    "Get coin history list. Returns coin balance, usage history, and status for all or specific coins assigned to the account.",
    {
      pageNo: z.number().optional().describe("Page number"),
      pageSize: z.number().optional().describe("Page size (max 1000, default 1000)"),
      discountNoList: z.array(z.string()).optional().describe("Coin discount numbers to query (from getDiscountList)"),
      isOrganization: z.boolean().optional().describe("Query as Organization master (integrated view)"),
      isPartner: z.boolean().optional().describe("Query as Partner representative"),
      memberNoList: z.array(z.string()).optional().describe("Member number list (master/partner only)"),
    },
    async ({ pageNo, pageSize, discountNoList, isOrganization, isPartner, memberNoList }) => {
      const params: Record<string, string> = { responseFormatType: "json" };
      if (pageNo !== undefined) params["pageNo"] = String(pageNo);
      if (pageSize !== undefined) params["pageSize"] = String(pageSize);
      if (discountNoList) discountNoList.forEach((no, i) => { params[`discountNoList.${i + 1}`] = no; });
      if (isOrganization !== undefined) params["isOrganization"] = String(isOrganization);
      if (isPartner !== undefined) params["isPartner"] = String(isPartner);
      if (memberNoList) memberNoList.forEach((no, i) => { params[`memberNoList.${i + 1}`] = no; });
      const result = await client.requestRaw("GET", "/billing/v1/discount/getCoinHistoryList", params);
      return result;
    }
  );

  // ncloud_get_credit_history_list — 크레딧 이력 목록 조회
  defineTool(
    server,
    "ncloud_get_credit_history_list",
    "Get credit history list. Returns credit balance, usage history per service, and validity periods for all or specific credits.",
    {
      pageNo: z.number().optional().describe("Page number"),
      pageSize: z.number().optional().describe("Page size (max 1000, default 1000)"),
      discountNoList: z.array(z.string()).optional().describe("Credit discount numbers to query (from getDiscountList)"),
      isOrganization: z.boolean().optional().describe("Query as Organization master (integrated view)"),
      isPartner: z.boolean().optional().describe("Query as Partner representative"),
      memberNoList: z.array(z.string()).optional().describe("Member number list (master/partner only)"),
      startMonth: z.string().optional().describe("Start month in yyyyMM format"),
      endMonth: z.string().optional().describe("End month in yyyyMM format"),
    },
    async ({ pageNo, pageSize, discountNoList, isOrganization, isPartner, memberNoList, startMonth, endMonth }) => {
      const params: Record<string, string> = { responseFormatType: "json" };
      if (pageNo !== undefined) params["pageNo"] = String(pageNo);
      if (pageSize !== undefined) params["pageSize"] = String(pageSize);
      if (discountNoList) discountNoList.forEach((no, i) => { params[`discountNoList.${i + 1}`] = no; });
      if (isOrganization !== undefined) params["isOrganization"] = String(isOrganization);
      if (isPartner !== undefined) params["isPartner"] = String(isPartner);
      if (memberNoList) memberNoList.forEach((no, i) => { params[`memberNoList.${i + 1}`] = no; });
      if (startMonth) params["startMonth"] = startMonth;
      if (endMonth) params["endMonth"] = endMonth;
      const result = await client.requestRaw("GET", "/billing/v1/discount/getCreditHistoryList", params);
      return result;
    }
  );


  // ncloud_get_product_demand_cost_by_discount_list — 할인 반영 청구 내역 조회
  defineTool(
    server,
    "ncloud_get_product_demand_cost_by_discount_list",
    "Get billing history with discount details applied. Returns per-service billing amounts showing how each discount (product discount, credit) was applied for the specified period (max 6 months).",
    {
      startMonth: z.string().describe("Start month in yyyyMM format (e.g. 202401)"),
      endMonth: z.string().describe("End month in yyyyMM format (e.g. 202406, max 6 months range)"),
      pageNo: z.number().optional().describe("Page number"),
      pageSize: z.number().optional().describe("Page size (max 1000, default 1000)"),
      productDemandTypeCodeList: z.array(z.string()).optional().describe("Product demand type codes to filter"),
      isOrganization: z.boolean().optional().describe("Query as Organization master (integrated view)"),
      isPartner: z.boolean().optional().describe("Query as Partner representative"),
      memberNoList: z.array(z.string()).optional().describe("Member number list (master/partner only)"),
    },
    async ({ startMonth, endMonth, pageNo, pageSize, productDemandTypeCodeList, isOrganization, isPartner, memberNoList }) => {
      const params: Record<string, string> = { responseFormatType: "json", startMonth, endMonth };
      if (pageNo !== undefined) params["pageNo"] = String(pageNo);
      if (pageSize !== undefined) params["pageSize"] = String(pageSize);
      if (productDemandTypeCodeList) productDemandTypeCodeList.forEach((code, i) => { params[`productDemandTypeCodeList.${i + 1}`] = code; });
      if (isOrganization !== undefined) params["isOrganization"] = String(isOrganization);
      if (isPartner !== undefined) params["isPartner"] = String(isPartner);
      if (memberNoList) memberNoList.forEach((no, i) => { params[`memberNoList.${i + 1}`] = no; });
      const result = await client.requestRaw("GET", "/billing/v1/discount/getProductDemandCostByDiscountList", params);
      return result;
    }
  );

  // ncloud_get_product_discount_history_list — 서비스 할인 이력 목록 조회
  defineTool(
    server,
    "ncloud_get_product_discount_history_list",
    "Get product discount history list. Returns service discount details including discount rate, eligible services, and per-service usage/applied amounts.",
    {
      pageNo: z.number().optional().describe("Page number"),
      pageSize: z.number().optional().describe("Page size (max 1000, default 1000)"),
      discountNoList: z.array(z.string()).optional().describe("Discount numbers to query (from getDiscountList)"),
      isOrganization: z.boolean().optional().describe("Query as Organization master (integrated view)"),
      isPartner: z.boolean().optional().describe("Query as Partner representative"),
      memberNoList: z.array(z.string()).optional().describe("Member number list (master/partner only)"),
      startMonth: z.string().optional().describe("Start month in yyyyMM format"),
      endMonth: z.string().optional().describe("End month in yyyyMM format"),
    },
    async ({ pageNo, pageSize, discountNoList, isOrganization, isPartner, memberNoList, startMonth, endMonth }) => {
      const params: Record<string, string> = { responseFormatType: "json" };
      if (pageNo !== undefined) params["pageNo"] = String(pageNo);
      if (pageSize !== undefined) params["pageSize"] = String(pageSize);
      if (discountNoList) discountNoList.forEach((no, i) => { params[`discountNoList.${i + 1}`] = no; });
      if (isOrganization !== undefined) params["isOrganization"] = String(isOrganization);
      if (isPartner !== undefined) params["isPartner"] = String(isPartner);
      if (memberNoList) memberNoList.forEach((no, i) => { params[`memberNoList.${i + 1}`] = no; });
      if (startMonth) params["startMonth"] = startMonth;
      if (endMonth) params["endMonth"] = endMonth;
      const result = await client.requestRaw("GET", "/billing/v1/discount/getProductDiscountHistoryList", params);
      return result;
    }
  );

} // end of registerBillingTools
