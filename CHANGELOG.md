# Changelog

All notable changes to this project will be documented in this file.

## [1.0.3] - 2026-05-21

### Added
- `mcpName` field in package.json for MCP Registry integration
- `server.json` for official MCP Registry publishing
- `CHANGELOG.md` for version tracking
- Keywords update in package.json (`ncp`, `devops`)

### Changed
- Registered to official MCP Registry (`io.github.sjk4425/ncloud`)

## [1.0.2] - 2026-05-19

### Changed
- README.md formatting improvements (Korean/English)
- Added detailed service descriptions and usage examples

## [1.0.1] - 2026-05-17

### Added
- npm package publishing support (`npx ncloud-mcp-server`)
- npm version badge in README
- `.npmignore` to exclude test files from npm package
- npx installation guide in README

### Changed
- Build script updated (`tsc` → `npx tsc`)

## [1.0.0] - 2026-05-17

### Added
- Initial release
- 60+ Ncloud services, 1,000+ MCP tools
- Compute (Server, Block Storage, Snapshot, Public IP, Init Script, Login Key, Placement Group, Fabric Cluster)
- Networking (VPC, Subnet, ACG, Network ACL, NAT Gateway, Route Table, VPC Peering, Network Interface, Load Balancer, Target Group, Global DNS, Global Traffic Manager)
- Database (MySQL, PostgreSQL, MSSQL, MongoDB, Redis)
- Storage (Object Storage S3-compatible, NAS, Archive Storage Swift-compatible)
- Containers (NKS, Container Registry)
- Monitoring (Cloud Insight - Dashboard, Event, Rule, Plugin, Schema, Data, Integration)
- DevTools (SourceCommit, SourceBuild, SourceDeploy, SourcePipeline)
- Media (VOD Station, Live Station, Image Optimizer)
- Security (Certificate Manager, Private CA, KMS, Security Monitoring)
- Application (Cloud Functions, API Gateway, SENS)
- Analytics (Search Engine Service, Cloud Hadoop, CDSS, Data Catalog, Data Forest, Data Flow, Data Query)
- Management (Sub Account, Activity Tracer, Resource Manager, Log Analytics, Cloud Advisor, Billing)
- Content Delivery (Global Edge)
- Auto Scaling (Launch Configuration, ASG, Scaling Policy)
- HMAC-SHA256 signature authentication
- Destructive operation confirm gate
- Dry-run support for create operations
- S3-compatible client for Object Storage
- Swift-compatible client for Archive Storage
