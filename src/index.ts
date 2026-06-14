#!/usr/bin/env node

import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  makeClientFactory,
  planGroups,
  GroupManager,
  type RegisterCtx,
} from "./tools/registry.js";

// 버전은 package.json 단일 소스에서 읽는다 (하드코딩 드리프트 방지).
// dist/index.js 기준 ../package.json → 프로젝트 루트 package.json 으로 해석된다.
const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

// Validate required environment variables
const accessKey = process.env.NCLOUD_ACCESS_KEY;
const secretKey = process.env.NCLOUD_SECRET_KEY;

if (!accessKey) {
  console.error("Error: NCLOUD_ACCESS_KEY 환경 변수가 설정되지 않았습니다.");
  process.exit(1);
}

if (!secretKey) {
  console.error("Error: NCLOUD_SECRET_KEY 환경 변수가 설정되지 않았습니다.");
  process.exit(1);
}

const regionCode = process.env.NCLOUD_REGION ?? "KR";
const creds = { accessKey, secretKey };

// Create MCP Server
// debouncedNotificationMethods: 동적 그룹 enable 시 그룹당 수백 개 도구가 연속 등록되며
// registerTool 마다 list_changed 가 발송되는 통지 폭주를 1회로 합친다(Phase 0-4).
const server = new McpServer(
  {
    name: "ncloud-mcp-server",
    version: pkg.version,
  },
  { debouncedNotificationMethods: ["notifications/tools/list_changed"] }
);

// 그룹 단위 도구 등록 (NCLOUD_TOOL_GROUPS 미설정 시 전체 ON = 기존 동작 동일)
const ctx: RegisterCtx = {
  server,
  client: makeClientFactory(creds, regionCode),
  regionCode,
  creds,
  env: process.env,
};
const plan = planGroups(process.env.NCLOUD_TOOL_GROUPS);
const manager = new GroupManager(ctx, plan);
manager.start();
const enableable = manager.enableableKeys();
console.error(
  `ncloud-mcp-server: ${manager.enabledGroupKeys().length}개 그룹 등록 (${manager.enabledGroupKeys().join(", ")})` +
    (plan.expandable && enableable.length > 0
      ? ` · 동적 enable 가능: ${enableable.join(", ")}`
      : "")
);

// Connect via stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
