# Ncloud MCP Server

[한국어](./README.md)

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
| **Storage** | Object Storage (S3-compatible), NAS, Archive Storage (Swift-compatible) |
| **Containers** | Ncloud Kubernetes Service (NKS), Container Registry |
| **Monitoring** | Cloud Insight (Dashboard, Event, Rule, Plugin, Schema, Data, Integration) |
| **DevTools** | SourceCommit, SourceBuild, SourceDeploy, SourcePipeline |
| **Media** | VOD Station, Live Station, Image Optimizer |
| **Security** | Certificate Manager, Private CA, KMS, Security Monitoring |
| **Application** | Cloud Functions, API Gateway, SENS (SMS/Push) |
| **Analytics** | Search Engine Service, Cloud Hadoop, Cloud Data Streaming Service, Data Catalog, Data Forest, Data Flow, Data Query |
| **Management** | Sub Account, Activity Tracer, Resource Manager, Log Analytics, Cloud Advisor, Billing |
| **Content Delivery** | Global Edge |
| **Auto Scaling** | Launch Configuration, Auto Scaling Group, Scaling Policy |

## Notes

- This MCP server is built for the **Ncloud Public (민간존)** environment. API endpoints may differ for Financial or Government zones.
- API specifications are based on the [Ncloud Official API Documentation](https://api.ncloud-docs.com/docs/home).
- Primarily tested in the Korea (KR) region. Some APIs may behave differently in other regions.

## Prerequisites

- Node.js 20+
- Ncloud API credentials ([Get from portal](https://www.ncloud.com/mypage/manage/authkey))

## Installation

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

## MCP Client Configuration

### Kiro / Claude Desktop / Cursor

Add to your `mcp.json` (or equivalent MCP config file):

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
| US West | `USWN` |
| Germany | `DEN` |

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
