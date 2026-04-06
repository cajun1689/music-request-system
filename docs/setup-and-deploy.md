# Setup and Deploy Guide

## Prerequisites
- Node.js 20+ and npm
- AWS CLI v2 authenticated to target account
- AWS CDK CLI (`npx cdk` is enough)
- Git + GitHub CLI (`gh`) if publishing from local machine

## Project Structure
- `frontend/` React web app
- `backend/lambdas/` API + WebSocket + stream handlers
- `infrastructure/` CDK stack
- `docs/` ops guides

## 1) Install Dependencies
```bash
cd infrastructure
npm install

cd ../frontend
npm install
```

## 2) Deploy AWS Infrastructure
```bash
cd infrastructure
# Optional but required for auto-paid verification:
# export PAYPAL_CLIENT_ID="<paypal client id>"
# export PAYPAL_CLIENT_SECRET="<paypal client secret>"
# export PAYPAL_ENVIRONMENT="sandbox"   # or "live"
# export PAYPAL_WEBHOOK_ID="<paypal webhook id>"
npx cdk bootstrap
npx cdk deploy --require-approval never --outputs-file cdk-outputs.json
```

From `cdk-outputs.json`, collect:
- `RestApiUrl`
- `WebSocketUrl`
- `UserPoolId`
- `UserPoolClientId`
- CloudFront distribution ID and frontend bucket name (from stack resources)

## 3) Configure Frontend Environment
Create `frontend/.env.production`:
```env
VITE_API_BASE_URL=<RestApiUrl without trailing slash>
VITE_WEBSOCKET_URL=<WebSocketUrl>
VITE_USER_POOL_ID=<UserPoolId>
VITE_USER_POOL_CLIENT_ID=<UserPoolClientId>
```

## 4) Build + Publish Frontend
```bash
cd frontend
npm run build
aws s3 sync dist s3://<frontend-bucket-name> --delete
aws cloudfront create-invalidation --distribution-id <distribution-id> --paths "/*"
```

## 5) Create Initial Admin User
```bash
aws cognito-idp admin-create-user \
  --user-pool-id <UserPoolId> \
  --username <admin-email> \
  --user-attributes Name=email,Value=<admin-email> Name=email_verified,Value=true \
  --message-action SUPPRESS

aws cognito-idp admin-set-user-password \
  --user-pool-id <UserPoolId> \
  --username <admin-email> \
  --password '<strong-password>' \
  --permanent
```

## 6) Domain + HTTPS
If using custom domain:
- Register domain in Route 53 Domains
- Create hosted zone
- Request ACM cert in `us-east-1`
- Point apex + `www` alias records to CloudFront
- Ensure CloudFront aliases + ACM cert are set

## 7) Smoke Test
1. Login at `/login`
2. Create event in Admin
3. Open guest URL `/event/<eventId>`
4. Submit request
5. Approve request in dashboard
6. Mark played and verify overlay updates
