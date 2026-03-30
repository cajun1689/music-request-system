# DJ Music Request System

Production-ready app for multi-DJ nights with guest requests, approvals, paid-request verification, and a Resolume ticker overlay.

## Features
- Guest request page with QR access and branding
- DJ dashboard with approve/veto/played actions
- Multi-DJ "Now Playing" slots
- Venmo tip workflow + DJ payment verification
- Recurring residency event support (sticky event ID + weekly queue reset)
- Resolume overlay page with live scrolling queue
- Admin panel for event setup, branding, links, and ops

## Architecture
- Frontend: React + TypeScript + Vite + Tailwind
- Backend: AWS Lambda + API Gateway (REST + WebSocket)
- Data: DynamoDB + Streams
- Auth: Cognito
- Hosting: S3 + CloudFront
- Infra: AWS CDK

## Setup Docs
- General setup + deployment: `docs/setup-and-deploy.md`
- Team operations playbook: `docs/team-operations.md`
- Resolume setup runbook: `docs/resolume-setup.md`

## Security Note
Do not commit real credentials or production secrets. Use `.env.example` as template and keep real values in local `.env` files or your CI/CD secret store.
