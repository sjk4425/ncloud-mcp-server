import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NcloudClient } from "../client/ncloud-client.js";
import { defineTool } from "./_tool.js";

/**
 * STS (Security Token Service) — 세 존 제공, 규칙형 호스트 sts.apigw.<zone>.
 *
 * 가이드 슬러그가 서비스 접두 없이 등록돼 있다(`management-sts` 개요, `get-caller-identity`, `switch-role`, `management-sts-creatests`).
 * 이 모듈은 호출자 식별만 감싼다 — 어떤 키로 서버가 돌고 있는지(메인 계정 `Customer` / 서브 계정 `Sub` / 역할 `Role`)를
 * 확인하는 용도이며, Certificate Manager 2.0 처럼 메인 계정 전용 API 의 403 안내에도 쓴다.
 *   GET /api/v1/caller-identity → { id, loginAlias, userType: Customer | Sub | Role }   (2026-10-02 세 존 원문 대조)
 * 임시 자격 증명 발급(`POST /api/v1/credentials`)과 역할 전환(`POST /api/v1/switch-role`)은 새 키를 만드는 작업이라 감싸지 않는다.
 */
export function registerStsTools(server: McpServer, client: NcloudClient): void {
  defineTool(
    server,
    "ncloud_get_caller_identity",
    "Identify the owner of the API key this server is using (STS GET /api/v1/caller-identity): id, loginAlias and userType — Customer (main account), Sub (sub account) or Role. Use it to check whether a main-account-only API (e.g. Certificate Manager 2.0) can be called with the current key.",
    {},
    async () => {
      const result = await client.requestRaw("GET", "/api/v1/caller-identity");
      const userType = result?.userType;
      const label = userType === "Customer" ? "main account" : userType === "Sub" ? "sub account" : userType === "Role" ? "role (temporary credentials)" : undefined;
      return label ? { ...result, userTypeDescription: label } : result;
    }
  );
}
