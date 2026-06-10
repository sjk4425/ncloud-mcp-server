# Ncloud MCP Server

[한국어](./README.md)

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
| `NCLOUD_TOOL_GROUPS` | - | Select which tool groups to load. All groups ON when unset (details in [Tool Group Selection](#tool-group-selection-optional) below) | all |
| `NCLOUD_RESPONSE_PRUNE` | - | When `1`, globally strips empty values (`null`/`""`/`[]`/`{}`) from responses | `0` |

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

> The default setup loads **all** tools (~1,000) and works out of the box. Read this section **only if you want to reduce the number of tools**.

**What is it?** This server exposes ~1,000 tools. With `NCLOUD_TOOL_GROUPS` you can **load only the service groups you need**, so the AI sees fewer tools at once — lowering token cost and improving tool-selection accuracy.

> 💡 **Want everything? Just leave this unset.** Unset means "all groups" and behaves exactly as before. The options below are only needed when you want a subset.

**How to use it?** Add a single `NCLOUD_TOOL_GROUPS` line to the `env` of the `mcp.json` above, listing the group keys you want, comma-separated. (`common` holds shared Region/Zone tools and is always included automatically.)

| Value | Result |
|---|---|
| (unset) | **All groups ON** — default, same as before |
| `compute,network` | Only compute + network (+ auto common) |
| `compute,network,billing` | Only those three |
| `all,-billing` | Everything except billing (`-` means "exclude") |

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

**Example** (`mcp.json` — e.g. only compute, network, billing):

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
        "NCLOUD_TOOL_GROUPS": "compute,network,billing"
      }
    }
  }
}
```

> At startup the server logs which groups were loaded:
> `ncloud-mcp-server: 4개 그룹 등록 (common, compute, network, billing)`
> Unknown keys are ignored with a warning.

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
