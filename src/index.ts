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
import { resolveZone, ZONE_PROFILES, type Zone } from "./client/endpoints.js";

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

// 존 선택: NCLOUD_ZONE=public(기본)|gov. 잘못된 값이면 다른 존으로 조용히 가지 않고 종료한다.
let zone: Zone;
try {
  zone = resolveZone(process.env);
} catch (error) {
  console.error(`Error: ${(error as Error).message}`);
  process.exit(1);
}
const zoneProfile = ZONE_PROFILES[zone];

const regionCode = process.env.NCLOUD_REGION ?? zoneProfile.defaultRegion;
if (!zoneProfile.regions.some((r) => r.code === regionCode)) {
  // 치명적이지 않다(기존 동작은 검증 없음) — 존과 맞지 않는 리전을 눈에 띄게만 한다.
  console.error(
    `Warning: NCLOUD_REGION="${regionCode}"는 ${zoneProfile.label.ko} 리전 목록(${zoneProfile.regions.map((r) => r.code).join(", ")})에 없습니다. 그대로 사용합니다.`
  );
}
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
  client: makeClientFactory(creds, regionCode, zone, process.env),
  regionCode,
  zone,
  creds,
  env: process.env,
};
const plan = planGroups(process.env.NCLOUD_TOOL_GROUPS);
const manager = new GroupManager(ctx, plan);
manager.start();
const enableable = manager.enableableKeys();
console.error(
  `ncloud-mcp-server [${zoneProfile.label.ko}/${zone}, ${regionCode}]: ${manager.enabledGroupKeys().length}개 그룹 등록 (${manager.enabledGroupKeys().join(", ")})` +
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
