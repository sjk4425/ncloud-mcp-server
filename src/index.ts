#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  makeClientFactory,
  resolveGroups,
  registerGroups,
  type RegisterCtx,
} from "./tools/registry.js";

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
const server = new McpServer({
  name: "ncloud-mcp-server",
  version: "1.1.1",
});

// 그룹 단위 도구 등록 (NCLOUD_TOOL_GROUPS 미설정 시 전체 ON = 기존 동작 동일)
const ctx: RegisterCtx = {
  server,
  client: makeClientFactory(creds, regionCode),
  regionCode,
  creds,
  env: process.env,
};
const groups = resolveGroups(process.env.NCLOUD_TOOL_GROUPS);
registerGroups(ctx, groups);
console.error(
  `ncloud-mcp-server: ${groups.length}개 그룹 등록 (${groups.map((g) => g.key).join(", ")})`
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
