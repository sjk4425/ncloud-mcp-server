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
| **Compute** | Server, Block Storage, Snapshot, Public IP, Init Script, Login Key, Placement Group, Fabric Cluster |
| **Networking** | VPC, Subnet, ACG, Network ACL, NAT Gateway, Route Table, VPC Peering, Network Interface, Load Balancer, Target Group, Global DNS, Global Traffic Manager |
| **Database** | Cloud DB for MySQL, PostgreSQL, MSSQL, MongoDB, Redis |
| **Storage** | Object Storage (S3-compatible), Ncloud Storage (S3-compatible), NAS, Archive Storage (Swift-compatible) |
| **Containers** | Ncloud Kubernetes Service (NKS), Container Registry |
| **Monitoring** | Cloud Insight (Dashboard, Event, Rule, Plugin, Schema, Data, Integration) |
| **DevTools** | SourceCommit, SourceBuild, SourceDeploy, SourcePipeline |
| **Media** | VOD Station, Live Station, Image Optimizer |
| **Security** | Certificate Manager, Private CA, KMS, Security Monitoring |
| **Application** | Cloud Functions, API Gateway, SENS (SMS/Push) |
| **Analytics** | Search Engine Service, Cloud Hadoop, Cloud Data Streaming Service, Data Stream, Data Catalog, Data Forest, Data Flow, Data Query |
| **Management** | Sub Account, Activity Tracer, Resource Manager, Log Analytics, Cloud Advisor, Billing |
| **Content Delivery** | Global Edge |
| **Auto Scaling** | Launch Configuration, Auto Scaling Group, Scaling Policy |

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
| `NCLOUD_TOOL_GROUPS` | - | Select which tool groups to load (see below). All groups ON when unset | all |
| `NCLOUD_RESPONSE_PRUNE` | - | When `1`, globally strips empty values (`null`/`""`/`[]`/`{}`) from responses | `0` |

### Tool Group Selection (`NCLOUD_TOOL_GROUPS`)

The server exposes ~1,000 tools. Loading only the groups you need reduces context tokens and improves tool-selection accuracy. The `common` group is always registered.

```
# Unset → all groups ON (same as before)
# Specific groups only (+ common):
NCLOUD_TOOL_GROUPS=compute,network,billing
# All groups, but exclude some (subtractive):
NCLOUD_TOOL_GROUPS=all,-billing
```

Available group keys: `compute`, `network`, `database`, `storage`, `containers`, `monitoring`, `devtools`, `analytics`, `media`, `global`, `security`, `integration`, `billing` (plus the always-on `common`).

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
