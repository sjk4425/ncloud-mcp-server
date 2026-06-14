# Ncloud MCP Server

[한국어](./README.md)

[![CI](https://github.com/sjk4425/ncloud-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/sjk4425/ncloud-mcp-server/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/ncloud-mcp-server.svg)](https://www.npmjs.com/package/ncloud-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for managing Naver Cloud Platform (Ncloud) infrastructure directly from AI assistants.

## Features

Provides **1,000+ API tools** across **60+ Ncloud services** via MCP protocol.

| Category | Services |
|----------|----------|
| **Compute** | Server, Block Storage, Snapshot, Public IP, Init Script, Login Key, Placement Group, Fabric Cluster, Auto Scaling, Cloud Functions |
| **Networking** | VPC, Subnet, ACG, Network ACL, NAT Gateway, Route Table, VPC Peering, Network Interface, Load Balancer, Target Group, Global DNS, Global Traffic Manager |
| **Database** | Cloud DB for MySQL, PostgreSQL, MSSQL, MongoDB, Cache (Redis/Valkey) |
| **Storage** | Object Storage (S3-compatible), Ncloud Storage (S3-compatible), NAS, Archive Storage (Swift-compatible) |
| **Containers** | Ncloud Kubernetes Service (NKS), Container Registry |
| **Security** | Certificate Manager, Private CA, KMS, Security Monitoring |
| **Monitoring** | Cloud Insight, Log Analytics |
| **Management & Governance** | Activity Tracer, Cloud Advisor, Resource Manager, Sub Account |
| **DevTools** | SourceCommit, SourceBuild, SourceDeploy, SourcePipeline |
| **Analytics** | Search Engine Service, Cloud Hadoop, Cloud Data Streaming Service, Data Stream, Data Catalog, Data Forest, Data Flow, Data Query |
| **Media** | VOD Station, Live Station, Image Optimizer |
| **Content Delivery (CDN)** | Global Edge |
| **Application** | API Gateway, SENS (SMS/Push) |
| **Billing** | Billing (list price, cost & usage, discount) |

> ℹ️ Each category maps 1:1 to a `NCLOUD_TOOL_GROUPS` group key. To load only a subset of tools, see the [Tool Group Selection](#tool-group-selection-optional) table below.

Every tool carries standard MCP **tool annotations** (`readOnlyHint`/`destructiveHint`/`idempotentHint`), so supporting clients can auto-approve read-only tools and show confirmation UX for destructive ones. The `confirm` parameter gate on destructive tools is kept as a second line of defense.

## Prerequisites

- Node.js 20+
- Ncloud API credentials ([Get from portal](https://www.ncloud.com/mypage/manage/authkey))

## Notes

- This MCP server is built for the **Ncloud Public (민간존)** environment. API endpoints may differ for Financial or Government zones.
- API specifications are based on the [Ncloud Official API Documentation](https://api.ncloud-docs.com/docs/home).
- Primarily tested in the Korea (KR) region. Some APIs may behave differently in other regions.

## Installation

### npx (Recommended — no install required)

Use directly without installation:

```bash
npx -y ncloud-mcp-server
```

See the [MCP Client Configuration](#mcp-client-configuration) section below for setup details.

### Build from source

```bash
# Clone the repository
git clone https://github.com/sjk4425/ncloud-mcp-server.git
cd ncloud-mcp-server

# Install dependencies and build
npm install
npm run build
```

## Environment Variables

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `NCLOUD_ACCESS_KEY` | ✅ | Ncloud API Access Key | - |
| `NCLOUD_SECRET_KEY` | ✅ | Ncloud API Secret Key | - |
| `NCLOUD_REGION` | - | Region code | `KR` |
| `NCLOUD_API_URL` | - | API base URL | `https://ncloud.apigw.ntruss.com` |
| `NCLOUD_ARCHIVE_PROJECT_ID` | - | Archive Storage project ID | - |
| `NCLOUD_ARCHIVE_DOMAIN_ID` | - | Archive Storage domain ID | - |
| `NCLOUD_TOOL_GROUPS` | - | Select which tool groups to load at startup. All groups ON when unset. Include the `dynamic` keyword to start with core groups only and allow mid-session expansion; any other value is locked (details in [Tool Group Selection](#tool-group-selection-optional) below) | all |
| `NCLOUD_RESPONSE_PRUNE` | - | When `1`, globally strips empty values (`null`/`""`/`[]`/`{}`) from responses | `0` |
| `NCLOUD_TIMEOUT_MS` | - | API request timeout in milliseconds. On timeout the call is aborted and a friendly message is returned (HTTP 429 is auto-retried up to 2 times) | `30000` |

## MCP Client Configuration

### Using npx (Recommended)

Add to your `mcp.json` (or equivalent MCP config file):

```json
{
  "mcpServers": {
    "ncloud": {
      "command": "npx",
      "args": ["-y", "ncloud-mcp-server"],
      "env": {
        "NCLOUD_ACCESS_KEY": "your-access-key",
        "NCLOUD_SECRET_KEY": "your-secret-key",
        "NCLOUD_REGION": "KR"
      }
    }
  }
}
```

### Using source build

```json
{
  "mcpServers": {
    "ncloud": {
      "command": "node",
      "args": ["path/to/ncloud-mcp-server/dist/index.js"],
      "env": {
        "NCLOUD_ACCESS_KEY": "your-access-key",
        "NCLOUD_SECRET_KEY": "your-secret-key",
        "NCLOUD_REGION": "KR"
      }
    }
  }
}
```

## Tool Group Selection (Optional)

> The default setup loads **all** tools (~1,000) and works out of the box. **Want everything? Just leave this unset** — unset means "all groups," same as before. Read this section only if you want to *start light (recommended: `dynamic`) or load a subset of tools*.

**Why?** With everything on, tool definitions alone occupy a large chunk of session context (`tools/list` ≈ 694 KB / ~177k tokens). With `NCLOUD_TOOL_GROUPS` you load only the groups you need, so the AI sees fewer tools at once — lowering token cost and improving tool-selection accuracy. Set it by adding one `NCLOUD_TOOL_GROUPS` line to the `env` of your `mcp.json`. (`common` holds shared Region/Zone tools and is always included automatically.)

### At a glance — which value to use

| What you want | Setting | Behavior |
|---|---|---|
| **(recommended)** start light, auto-expand when needed | `dynamic` | core set on at startup, the rest enabled mid-session on demand |
| Use a specific group daily | `dynamic,analytics` | core set **+ analytics on from the start**, the rest expandable |
| Everything on from the start | (unset) or `all` | all 14 groups ON (legacy behavior) |
| Exactly these groups, no runtime expansion | `compute,network` | only those — runtime expansion **locked** |
| Everything except a few | `all,-billing` | all but billing (`-`-excluded group is also refused for enable) |

> **Key rule:** mid-session expansion is on **only when the `dynamic` keyword is present.** Listing groups without `dynamic` (e.g. `compute,network`) means "exactly these" — a **locked** state; `all`/unset already has everything on, so expansion is moot. The full list of group keys is in **Fine-grained control** below.

### Recommended: `dynamic` (dynamic groups)

Instead of loading everything, the server **starts light with only the core groups** and **enables a group mid-session, without a restart**, whenever the AI is asked about another service.

```json
{
  "mcpServers": {
    "ncloud": {
      "command": "npx",
      "args": ["-y", "ncloud-mcp-server"],
      "env": {
        "NCLOUD_ACCESS_KEY": "your-access-key",
        "NCLOUD_SECRET_KEY": "your-secret-key",
        "NCLOUD_REGION": "KR",
        "NCLOUD_TOOL_GROUPS": "dynamic"
      }
    }
  }
}
```

> **In one line:** `dynamic` = "**expansion mode on** + start light with the core set." Groups you don't use aren't loaded upfront (saving tokens) and are enabled only when needed.

- ON at startup: `common` + `compute` + `network` + `database` (~367 tools / ~65k tokens — a 63% reduction vs. all-on)
- The AI reaches the remaining groups through always-on meta tools:
  - `ncloud_list_tool_groups` — list all 14 groups with services, tool counts, and current on/off status
  - `ncloud_enable_tool_group` — activate a group at runtime (idempotent)

**`dynamic` vs `all` — what's different**

| | Loaded at startup | Unused groups | Tokens (startup) |
|---|---|---|---|
| `all` / (unset) | **all 14** groups | already on | ~177k |
| `dynamic` | core set only | enabled **when needed** | ~65k |

Both let you eventually use every group, but `dynamic` loads "core first, the rest on demand," keeping the startup context light. That saving is the whole point of `dynamic`.

**Flow** (e.g. a Live Station request)

```
1. Server starts: core groups + meta tools only
2. User: "Show my Live Station channels"
3. AI: finds the media group in the catalog → ncloud_enable_tool_group("media")
4. Server: registers media tools + sends tools/list_changed → client refreshes its tool list
5. AI: calls the now-visible Live Station tool → continues
```

- Enabled state lasts **for the session only** (the next session resets to the default).
- **Adding a group key to `dynamic` makes that group ON immediately at startup** (not enabled on demand). E.g. `dynamic,analytics` turns on the core set **plus analytics from the start**, leaving only the other groups for runtime enable. List the groups you use daily this way to skip the enable call.

**Client compatibility** — dynamically added tools appear immediately only if the client supports the `tools/list_changed` notification.

| Client | `tools/list_changed` | Notes |
|---|---|---|
| Claude Code | ✅ Supported (verified) | New tools callable in the same session right after enable |
| Claude Desktop | ✅ Supported (MCP standard) | unverified |
| **Kiro** | ❌ Not applied (verified) | enable succeeds but new tools stay invisible until restart — see note below |
| Cursor | ⚠️ Unverified | may require a manual refresh on tool-list changes — self-test recommended |
| Codex | ⚠️ Unverified | self-test recommended |

> 💡 **For any client not listed (or marked "unverified"), you can check in 30 seconds.** Set `NCLOUD_TOOL_GROUPS=dynamic`, then ask the AI *"enable the media group and list my Live Station channels."* If the new tool gets called in the same session → supported; if the AI can't find it → unsupported, so pre-list the groups instead.

> **On clients that don't apply `list_changed` (e.g. Kiro), `dynamic`'s mid-session expansion does not work** — enable succeeds but the new tools never appear in the tool list, so they can't be called. In that case, **pre-list** the groups you use — e.g. start them on with `dynamic,governance,media`, or use an explicit list (`compute,network,...`) or `all`. (The enable response gives the same fallback: add the group to `NCLOUD_TOOL_GROUPS` and restart.) Falling back is exactly today's experience — no regression.

> ℹ️ **Permission boundary:** exposing an MCP tool does not grant permission. Actual Ncloud authorization is ultimately bounded by your Access Key's Sub Account permissions. Dynamic loading does not bypass existing safeguards (confirm gates, destructive warnings).

### Fine-grained control — specific groups only / locked

Listing group keys *without* `dynamic` turns on **only those groups** and locks runtime expansion (for strict / least-privilege environments). E.g. `"NCLOUD_TOOL_GROUPS": "compute,network,billing"`. You can also exclude a group with `-` (e.g. `all,-billing`); an excluded group is refused for dynamic enable too (operator security boundary).

> At startup the server logs which groups were loaded:
> `ncloud-mcp-server: 4개 그룹 등록 (common, compute, network, billing)`
> Unknown keys are ignored with a warning.

**Group key → included services**

| Group key | Included services |
|---|---|
| `compute` | Server, Block Storage, Snapshot, Public IP, Login Key, Init Script, Placement Group, Fabric Cluster, Auto Scaling, Cloud Functions |
| `network` | VPC, Subnet, ACG, Network ACL, NAT Gateway, Route Table, VPC Peering, Network Interface, Load Balancer, Target Group, Global DNS, Global Traffic Manager |
| `database` | Cloud DB for MySQL / PostgreSQL / MSSQL / MongoDB / Cache (Redis/Valkey) |
| `storage` | Object Storage, Ncloud Storage, NAS, Archive Storage |
| `containers` | Ncloud Kubernetes Service (NKS), Container Registry |
| `monitoring` | Cloud Insight, Cloud Log Analytics |
| `governance` | Activity Tracer, Cloud Advisor, Resource Manager, Sub Account |
| `devtools` | SourceCommit, SourceBuild, SourceDeploy, SourcePipeline |
| `analytics` | Search Engine Service, Cloud Hadoop, Cloud Data Streaming Service, Data Stream/Catalog/Forest/Flow/Query |
| `media` | VOD Station, Live Station, Image Optimizer |
| `cdn` | Global Edge |
| `security` | Certificate Manager, Private CA, KMS, Security Monitoring |
| `application` | API Gateway, SENS |
| `billing` | Billing (pricing, cost & usage, discounts) |
| `common` *(always ON)* | Region / Zone shared |

> ℹ️ **Group key changes (v1.2.0):** `integration` was renamed to `application`, and `global` was split into `cdn` (Global Edge) and `network` (Global DNS/Traffic Manager). Old keys are not auto-aliased — switch to the new keys (specifying an old key prints a guidance message on the server and is ignored).

## Usage Examples

Manage Ncloud infrastructure using natural language through your MCP client:

```
"List all my servers"
"Create an Ubuntu server in KR-2 zone"
"Show subnets in my-vpc"
"Check Cloud DB for MySQL instance status"
"Create a new bucket in Object Storage"
"Show target groups attached to the load balancer"
"Query top CPU usage servers from Cloud Insight"
```

## Supported Regions

| Region | Code |
|--------|------|
| Korea | `KR` |
| Japan | `JPN` |
| Singapore | `SGN` |

> **Note:** US West (`USWN`) and Germany (`DEN`) regions only support the Classic environment and are not compatible with this VPC-based MCP server.

## Troubleshooting

| Symptom | Cause | Solution |
|---------|-------|----------|
| Server exits immediately on start | Environment variables not set | Ensure `NCLOUD_ACCESS_KEY` and `NCLOUD_SECRET_KEY` are configured |
| `인증 실패` (HTTP 401) | Invalid API credentials | Verify key status is **active** on the [portal](https://www.ncloud.com/mypage/manage/authkey). Check for extra whitespace or newlines in key values |
| `접근 거부` (HTTP 403) | Insufficient permissions | Confirm service subscription. For Sub Accounts, grant API permissions for the target service |
| `유효하지 않은 리전입니다` | Invalid region code | Use supported regions (KR, JPN, SGN). Change via `ncloud_set_region` tool |
| `서비스 일시 불가` (HTTP 503) | Cannot reach API endpoint | Check network connectivity. Allow outbound access to `ncloud.apigw.ntruss.com` in firewall/proxy environments |
| `요청 시간 초과` (HTTP 504) | API response timeout | Retry after a moment. If persistent, check Ncloud status page |
| `요청 제한 초과` (HTTP 429) | API rate limit reached | Wait and retry with intervals between requests |

## Project Structure

```
ncloud-mcp-server/
├── src/
│   ├── index.ts              # MCP server entry point (stdio transport)
│   ├── auth/
│   │   └── signature.ts      # HMAC-SHA256 signature generation
│   ├── client/
│   │   ├── ncloud-client.ts  # Ncloud API HTTP client
│   │   ├── s3-compatible-client.ts   # Object Storage (S3-compatible)
│   │   └── swift-compatible-client.ts # Archive Storage (Swift-compatible)
│   └── tools/                # Service-specific MCP tools (63 files)
│       ├── compute-server.ts
│       ├── vpc.ts
│       ├── cloud-insight.ts
│       └── ...
├── package.json
├── tsconfig.json
├── LICENSE
└── README.md
```

## Development

```bash
# Build
npm run build

# Test
npm test

# Type check
npx tsc --noEmit
```

## Contributing

Issues and PRs are welcome. When contributing:

1. Fork and work on a feature branch
2. Verify build with `npm run build`
3. Ensure tests pass with `npm test`
4. Submit a PR

## License

[MIT](./LICENSE)
