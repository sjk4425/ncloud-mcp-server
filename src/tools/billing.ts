import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NcloudClient } from "../client/ncloud-client.js";

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
export function registerBillingTools(server: McpServer, client: NcloudClient): void {

  // ============================================================
  // List Price APIs — /product/...
  // ============================================================

  // ncloud_get_price_list — 요금제 목록 조회
  server.tool(
    "ncloud_get_price_list",
    "Get price list by price numbers. Retrieves pricing plan details including charging unit, rating unit, conditions, and promise discounts.",
    {
      priceNoList: z.array(z.string()).describe("List of price numbers to query (1~99 items, required)"),
      promiseNoList: z.array(z.string()).optional().describe("List of promise numbers to filter"),
      payCurrencyCode: z.enum(["KRW", "USD", "JPY"]).optional().describe("Payment currency code"),
    },
    async ({ priceNoList, promiseNoList, payCurrencyCode }) => {
      try {
        const params: Record<string, string> = { responseFormatType: "json" };
        priceNoList.forEach((no, i) => { params[`priceNoList.${i + 1}`] = no; });
        if (promiseNoList) promiseNoList.forEach((no, i) => { params[`promiseNoList.${i + 1}`] = no; });
        if (payCurrencyCode) params["payCurrencyCode"] = payCurrencyCode;
        const result = await client.requestRaw("GET", "/billing/v1/product/getPriceList", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_product_category_list — 서비스 카테고리 목록 조회
  server.tool(
    "ncloud_get_product_category_list",
    "Get product category list for Ncloud billing. Returns available service categories like COMPUTE, DATABASE, NETWORKING, etc.",
    {
      productCategoryCode: z.string().optional().describe("Product category code to filter (e.g. COMPUTE)"),
    },
    async ({ productCategoryCode }) => {
      try {
        const params: Record<string, string> = { responseFormatType: "json" };
        if (productCategoryCode) params["productCategoryCode"] = productCategoryCode;
        const result = await client.requestRaw("GET", "/billing/v1/product/getProductCategoryList", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  // ncloud_get_product_list — 서비스 목록 조회
  server.tool(
    "ncloud_get_product_list",
    "Get product (service) list for billing. Returns available products with their codes, names, descriptions, and categories. Use regionCode and optional filters to narrow results.",
    {
      regionCode: z.string().describe("Region code (e.g. KR, JPN, SGN)"),
      pageNo: z.number().optional().describe("Page number"),
      pageSize: z.number().optional().describe("Page size (max 1000, default 1000)"),
      productItemKindCode: z.string().optional().describe("Product item kind code (e.g. VSVR, SW)"),
      productCategoryCode: z.string().optional().describe("Product category code (e.g. COMPUTE)"),
      productCode: z.string().optional().describe("Product code to filter"),
      productName: z.string().optional().describe("Product name to search"),
    },
    async ({ regionCode, pageNo, pageSize, productItemKindCode, productCategoryCode, productCode, productName }) => {
      try {
        const params: Record<string, string> = { responseFormatType: "json", regionCode };
        if (pageNo !== undefined) params["pageNo"] = String(pageNo);
        if (pageSize !== undefined) params["pageSize"] = String(pageSize);
        if (productItemKindCode) params["productItemKindCode"] = productItemKindCode;
        if (productCategoryCode) params["productCategoryCode"] = productCategoryCode;
        if (productCode) params["productCode"] = productCode;
        if (productName) params["productName"] = productName;
        const result = await client.requestRaw("GET", "/billing/v1/product/getProductList", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_product_price_list — 서비스 및 가격 목록 조회
  server.tool(
    "ncloud_get_product_price_list",
    "Get product and price list. Returns products with their associated pricing information including monthly/hourly rates, conditions, and discount details.",
    {
      regionCode: z.string().describe("Region code (e.g. KR, JPN, SGN)"),
      pageNo: z.number().optional().describe("Page number"),
      pageSize: z.number().optional().describe("Page size (max 1000, default 1000)"),
      productItemKindCode: z.string().optional().describe("Product item kind code (e.g. VSVR)"),
      productCategoryCode: z.string().optional().describe("Product category code (e.g. COMPUTE)"),
      productCode: z.string().optional().describe("Product code to filter"),
      productName: z.string().optional().describe("Product name to search"),
      payCurrencyCode: z.enum(["KRW", "USD", "JPY"]).optional().describe("Payment currency code"),
    },
    async ({ regionCode, pageNo, pageSize, productItemKindCode, productCategoryCode, productCode, productName, payCurrencyCode }) => {
      try {
        const params: Record<string, string> = { responseFormatType: "json", regionCode };
        if (pageNo !== undefined) params["pageNo"] = String(pageNo);
        if (pageSize !== undefined) params["pageSize"] = String(pageSize);
        if (productItemKindCode) params["productItemKindCode"] = productItemKindCode;
        if (productCategoryCode) params["productCategoryCode"] = productCategoryCode;
        if (productCode) params["productCode"] = productCode;
        if (productName) params["productName"] = productName;
        if (payCurrencyCode) params["payCurrencyCode"] = payCurrencyCode;
        const result = await client.requestRaw("GET", "/billing/v1/product/getProductPriceList", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  // ============================================================
  // Cost and Usage APIs — /cost/...
  // ============================================================

  // ncloud_get_demand_cost_list — 월 청구 비용 목록 조회
  server.tool(
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
      try {
        const params: Record<string, string> = { responseFormatType: "json", startMonth, endMonth };
        if (pageNo !== undefined) params["pageNo"] = String(pageNo);
        if (pageSize !== undefined) params["pageSize"] = String(pageSize);
        if (isOrganization !== undefined) params["isOrganization"] = String(isOrganization);
        if (isPartner !== undefined) params["isPartner"] = String(isPartner);
        if (memberNoList) memberNoList.forEach((no, i) => { params[`memberNoList.${i + 1}`] = no; });
        const result = await client.requestRaw("GET", "/billing/v1/cost/getDemandCostList", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_product_demand_cost_list — 서비스별 청구 비용 목록 조회
  server.tool(
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
      try {
        const params: Record<string, string> = { responseFormatType: "json", startMonth, endMonth };
        if (pageNo !== undefined) params["pageNo"] = String(pageNo);
        if (pageSize !== undefined) params["pageSize"] = String(pageSize);
        if (isOrganization !== undefined) params["isOrganization"] = String(isOrganization);
        if (isPartner !== undefined) params["isPartner"] = String(isPartner);
        if (memberNoList) memberNoList.forEach((no, i) => { params[`memberNoList.${i + 1}`] = no; });
        if (productDemandTypeCode) params["productDemandTypeCode"] = productDemandTypeCode;
        const result = await client.requestRaw("GET", "/billing/v1/cost/getProductDemandCostList", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  // ncloud_get_contract_demand_cost_list — 계약 청구 비용 목록 조회
  server.tool(
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
      try {
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
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_contract_summary_list — 사용자 계약 요약 목록 조회
  server.tool(
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
      try {
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
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  // ncloud_get_contract_usage_list — 계약 사용량 목록 조회
  server.tool(
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
      try {
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
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_contract_usage_list_by_daily — 일별 계약 사용량 목록 조회
  server.tool(
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
      try {
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
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_cost_relation_code_list — 비용 연관 코드 목록 조회
  server.tool(
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
      try {
        const params: Record<string, string> = { responseFormatType: "json" };
        if (contractTypeCode) params["contractTypeCode"] = contractTypeCode;
        if (productItemKindCode) params["productItemKindCode"] = productItemKindCode;
        if (productRatingTypeCode) params["productRatingTypeCode"] = productRatingTypeCode;
        if (meteringTypeCode) params["meteringTypeCode"] = meteringTypeCode;
        if (productCategoryCode) params["productCategoryCode"] = productCategoryCode;
        const result = await client.requestRaw("GET", "/billing/v1/cost/getCostRelationCodeList", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  // ============================================================
  // Discount APIs — /discount/...
  // ============================================================

  // ncloud_get_discount_list — 할인 목록 조회
  server.tool(
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
      try {
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
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_coin_history_list — 코인 이력 목록 조회
  server.tool(
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
      try {
        const params: Record<string, string> = { responseFormatType: "json" };
        if (pageNo !== undefined) params["pageNo"] = String(pageNo);
        if (pageSize !== undefined) params["pageSize"] = String(pageSize);
        if (discountNoList) discountNoList.forEach((no, i) => { params[`discountNoList.${i + 1}`] = no; });
        if (isOrganization !== undefined) params["isOrganization"] = String(isOrganization);
        if (isPartner !== undefined) params["isPartner"] = String(isPartner);
        if (memberNoList) memberNoList.forEach((no, i) => { params[`memberNoList.${i + 1}`] = no; });
        const result = await client.requestRaw("GET", "/billing/v1/discount/getCoinHistoryList", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_credit_history_list — 크레딧 이력 목록 조회
  server.tool(
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
      try {
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
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );


  // ncloud_get_product_demand_cost_by_discount_list — 할인 반영 청구 내역 조회
  server.tool(
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
      try {
        const params: Record<string, string> = { responseFormatType: "json", startMonth, endMonth };
        if (pageNo !== undefined) params["pageNo"] = String(pageNo);
        if (pageSize !== undefined) params["pageSize"] = String(pageSize);
        if (productDemandTypeCodeList) productDemandTypeCodeList.forEach((code, i) => { params[`productDemandTypeCodeList.${i + 1}`] = code; });
        if (isOrganization !== undefined) params["isOrganization"] = String(isOrganization);
        if (isPartner !== undefined) params["isPartner"] = String(isPartner);
        if (memberNoList) memberNoList.forEach((no, i) => { params[`memberNoList.${i + 1}`] = no; });
        const result = await client.requestRaw("GET", "/billing/v1/discount/getProductDemandCostByDiscountList", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

  // ncloud_get_product_discount_history_list — 서비스 할인 이력 목록 조회
  server.tool(
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
      try {
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
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (error: any) {
        return { content: [{ type: "text" as const, text: error.message }], isError: true };
      }
    }
  );

} // end of registerBillingTools
