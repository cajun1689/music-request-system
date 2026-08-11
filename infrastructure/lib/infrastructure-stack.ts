import * as path from "node:path";
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
  aws_apigateway as apigateway,
  aws_apigatewayv2 as apigatewayv2,
  aws_certificatemanager as acm,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_cloudwatch as cloudwatch,
  aws_cloudwatch_actions as cwActions,
  aws_cognito as cognito,
  aws_dynamodb as dynamodb,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_event_sources as eventSources,
  aws_lambda_nodejs as lambdaNodejs,
  aws_logs as logs,
  aws_s3 as s3,
  aws_s3_deployment as s3deploy,
  aws_sns as sns,
  aws_sns_subscriptions as snsSubscriptions,
  aws_sqs as sqs,
  aws_events as events,
  aws_events_targets as targets,
  aws_ssm as ssm,
  aws_wafv2 as wafv2,
} from "aws-cdk-lib";
import { Construct } from "constructs";

const lambdaDefaults = {
  runtime: lambda.Runtime.NODEJS_20_X,
  memorySize: 256,
  timeout: Duration.seconds(15),
  logRetention: logs.RetentionDays.ONE_MONTH,
  projectRoot: path.join(__dirname, "../../backend"),
  depsLockFilePath: path.join(__dirname, "../../backend/package-lock.json"),
  bundling: {
    minify: true,
    sourceMap: true,
    target: "node20",
  },
} satisfies Partial<lambdaNodejs.NodejsFunctionProps>;

export class InfrastructureStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const deploymentStage = process.env.DEPLOY_STAGE?.trim() || "prod";
    const isProduction = deploymentStage === "prod";
    const customDomainNames = isProduction
      ? ["casperrequests.com", "www.casperrequests.com"]
      : [];
    const cloudFrontCertificateArn =
      "arn:aws:acm:us-east-1:285633211360:certificate/0271c9cf-1aff-4180-8c14-7137c169b8da";

    const eventsTable = new dynamodb.Table(this, "EventsTable", {
      partitionKey: { name: "eventId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    eventsTable.addGlobalSecondaryIndex({
      indexName: "slug-index",
      partitionKey: { name: "slug", type: dynamodb.AttributeType.STRING },
    });
    eventsTable.addGlobalSecondaryIndex({
      indexName: "organizationId-createdAt-index",
      partitionKey: { name: "organizationId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
    });

    const requestsTable = new dynamodb.Table(this, "RequestsTable", {
      partitionKey: { name: "eventId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "requestId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    requestsTable.addGlobalSecondaryIndex({
      indexName: "eventId-status-index",
      partitionKey: { name: "eventId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "status", type: dynamodb.AttributeType.STRING },
    });
    requestsTable.addGlobalSecondaryIndex({
      indexName: "organizationId-submittedAt-index",
      partitionKey: { name: "organizationId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "submittedAt", type: dynamodb.AttributeType.STRING },
    });

    const connectionsTable = new dynamodb.Table(this, "ConnectionsTable", {
      partitionKey: { name: "connectionId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAt",
      removalPolicy: RemovalPolicy.DESTROY,
    });

    connectionsTable.addGlobalSecondaryIndex({
      indexName: "eventId-index",
      partitionKey: { name: "eventId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "connectionId", type: dynamodb.AttributeType.STRING },
    });

    const organizationsTable = new dynamodb.Table(this, "OrganizationsTable", {
      partitionKey: { name: "organizationId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    organizationsTable.addGlobalSecondaryIndex({
      indexName: "stripeCustomerId-index",
      partitionKey: { name: "stripeCustomerId", type: dynamodb.AttributeType.STRING },
    });
    organizationsTable.addGlobalSecondaryIndex({
      indexName: "stripeConnectedAccountId-index",
      partitionKey: { name: "stripeConnectedAccountId", type: dynamodb.AttributeType.STRING },
    });
    organizationsTable.addGlobalSecondaryIndex({
      indexName: "accountMode-createdAt-index",
      partitionKey: { name: "accountMode", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
    });

    const membershipsTable = new dynamodb.Table(this, "MembershipsTable", {
      partitionKey: { name: "organizationId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    membershipsTable.addGlobalSecondaryIndex({
      indexName: "userId-index",
      partitionKey: { name: "userId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "organizationId", type: dynamodb.AttributeType.STRING },
    });

    const invitationsTable = new dynamodb.Table(this, "InvitationsTable", {
      partitionKey: { name: "invitationId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAt",
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    invitationsTable.addGlobalSecondaryIndex({
      indexName: "tokenHash-index",
      partitionKey: { name: "tokenHash", type: dynamodb.AttributeType.STRING },
    });
    invitationsTable.addGlobalSecondaryIndex({
      indexName: "organizationId-index",
      partitionKey: { name: "organizationId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
    });

    const bridgeDevicesTable = new dynamodb.Table(this, "BridgeDevicesTable", {
      partitionKey: { name: "deviceId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAt",
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    bridgeDevicesTable.addGlobalSecondaryIndex({
      indexName: "organizationId-index",
      partitionKey: { name: "organizationId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
    });

    const billingEventsTable = new dynamodb.Table(this, "BillingEventsTable", {
      partitionKey: { name: "eventId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAt",
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    billingEventsTable.addGlobalSecondaryIndex({
      indexName: "organizationId-createdAt-index",
      partitionKey: { name: "organizationId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
    });

    const usageCountersTable = new dynamodb.Table(this, "UsageCountersTable", {
      partitionKey: { name: "scopeId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "counterKey", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAt",
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const platformOperationsTable = new dynamodb.Table(this, "PlatformOperationsTable", {
      partitionKey: { name: "recordId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "retentionExpiresAt",
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    platformOperationsTable.addGlobalSecondaryIndex({
      indexName: "organizationId-createdAt-index",
      partitionKey: { name: "organizationId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
    });
    platformOperationsTable.addGlobalSecondaryIndex({
      indexName: "actorUserId-createdAt-index",
      partitionKey: { name: "actorUserId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
    });
    platformOperationsTable.addGlobalSecondaryIndex({
      indexName: "recordType-createdAt-index",
      partitionKey: { name: "recordType", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "createdAt", type: dynamodb.AttributeType.STRING },
    });

    const asyncFailureQueue = new sqs.Queue(this, "AsyncFailureQueue", {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: Duration.days(14),
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const brandAssetsBucket = new s3.Bucket(this, "BrandAssetsBucket", {
      blockPublicAccess: new s3.BlockPublicAccess({
        blockPublicAcls: true,
        ignorePublicAcls: true,
        blockPublicPolicy: false,
        restrictPublicBuckets: false,
      }),
      publicReadAccess: true,
      enforceSSL: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
        },
      ],
      versioned: true,
      lifecycleRules: [
        {
          noncurrentVersionExpiration: Duration.days(90),
          abortIncompleteMultipartUploadAfter: Duration.days(7),
        },
      ],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const frontendBucket = new s3.Bucket(this, "FrontendBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [{ noncurrentVersionExpiration: Duration.days(30) }],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const distribution = new cloudfront.Distribution(this, "FrontendDistribution", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      ...(isProduction
        ? {
            domainNames: customDomainNames,
            certificate: acm.Certificate.fromCertificateArn(
              this,
              "FrontendCertificate",
              cloudFrontCertificateArn,
            ),
          }
        : {}),
      defaultRootObject: "index.html",
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: Duration.minutes(1),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: Duration.minutes(1),
        },
      ],
    });

    new s3deploy.BucketDeployment(this, "InitialFrontendDeployment", {
      destinationBucket: frontendBucket,
      distribution,
      sources: [
        s3deploy.Source.data(
          "index.html",
          "<!doctype html><html><body><h1>Deploy frontend bundle to this bucket.</h1></body></html>",
        ),
      ],
    });

    const userPool = new cognito.UserPool(this, "DjUserPool", {
      userPoolName: isProduction
        ? "dj-music-request-users"
        : `dj-music-request-users-${deploymentStage}`,
      selfSignUpEnabled: true,
      autoVerify: { email: true },
      userVerification: {
        emailSubject: "Verify your Casper Requests account",
        emailBody: "Your Casper Requests verification code is {####}",
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      signInAliases: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const userPoolClient = new cognito.UserPoolClient(this, "DjUserPoolClient", {
      userPool,
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      preventUserExistenceErrors: true,
    });

    const websocketApi = new apigatewayv2.CfnApi(this, "RequestsWebSocketApi", {
      name: isProduction ? "dj-requests-websocket" : `dj-requests-websocket-${deploymentStage}`,
      protocolType: "WEBSOCKET",
      routeSelectionExpression: "$request.body.action",
    });

    const websocketStage = new apigatewayv2.CfnStage(this, "RequestsWebSocketStage", {
      apiId: websocketApi.ref,
      stageName: deploymentStage,
      autoDeploy: true,
    });

    const websocketEndpoint = `${websocketApi.ref}.execute-api.${this.region}.${this.urlSuffix}/${websocketStage.stageName}`;

    const makeLambda = (name: string, filePath: string) =>
      new lambdaNodejs.NodejsFunction(this, name, {
        ...lambdaDefaults,
        entry: path.join(__dirname, filePath),
        environment: {
          EVENTS_TABLE_NAME: eventsTable.tableName,
          REQUESTS_TABLE_NAME: requestsTable.tableName,
          CONNECTIONS_TABLE_NAME: connectionsTable.tableName,
          ORGANIZATIONS_TABLE_NAME: organizationsTable.tableName,
          MEMBERSHIPS_TABLE_NAME: membershipsTable.tableName,
          INVITATIONS_TABLE_NAME: invitationsTable.tableName,
          BRIDGE_DEVICES_TABLE_NAME: bridgeDevicesTable.tableName,
          BILLING_EVENTS_TABLE_NAME: billingEventsTable.tableName,
          USAGE_COUNTERS_TABLE_NAME: usageCountersTable.tableName,
          PLATFORM_OPERATIONS_TABLE_NAME: platformOperationsTable.tableName,
          PLATFORM_ALARM_PREFIX: this.stackName,
          ASYNC_FAILURE_QUEUE_URL: asyncFailureQueue.queueUrl,
          STRIPE_ENABLED: process.env.STRIPE_ENABLED === "true" ? "true" : "false",
          BRAND_ASSETS_BUCKET_NAME: brandAssetsBucket.bucketName,
          WEBSOCKET_ENDPOINT: websocketEndpoint,
          APP_BASE_URL:
            process.env.APP_BASE_URL
            ?? (isProduction
              ? "https://casperrequests.com"
              : `https://${distribution.distributionDomainName}`),
        },
      });

    const listEventsFn = makeLambda("ListEventsFn", "../../backend/lambdas/api/listEvents.ts");
    const createEventFn = makeLambda("CreateEventFn", "../../backend/lambdas/api/createEvent.ts");
    const getEventFn = makeLambda("GetEventFn", "../../backend/lambdas/api/getEvent.ts");
    const tenantApiFn = makeLambda("TenantApiFn", "../../backend/lambdas/api/tenantApi.ts");
    const getAdminEventFn = tenantApiFn;
    const platformApiFn = makeLambda(
      "PlatformApiFn",
      "../../backend/lambdas/api/platformApi.ts",
    );
    const platformApiResource = platformApiFn.node.defaultChild as lambda.CfnFunction;
    platformApiResource.timeout = 30;
    platformApiResource.memorySize = 512;
    const getEventBySlugFn = makeLambda(
      "GetEventBySlugFn",
      "../../backend/lambdas/api/getEventBySlug.ts",
    );
    const updateEventFn = makeLambda("UpdateEventFn", "../../backend/lambdas/api/updateEvent.ts");
    const createRequestFn = makeLambda(
      "CreateRequestFn",
      "../../backend/lambdas/api/createRequest.ts",
    );
    const getRequestsFn = makeLambda("GetRequestsFn", "../../backend/lambdas/api/getRequests.ts");
    const updateRequestFn = makeLambda(
      "UpdateRequestFn",
      "../../backend/lambdas/api/updateRequest.ts",
    );
    const uploadBrandAssetFn = makeLambda(
      "UploadBrandAssetFn",
      "../../backend/lambdas/api/uploadBrandAsset.ts",
    );
    const resetRequestsFn = makeLambda(
      "ResetRequestsFn",
      "../../backend/lambdas/api/resetRequests.ts",
    );
    const detectPlayedFn = makeLambda(
      "DetectPlayedFn",
      "../../backend/lambdas/api/detectPlayed.ts",
    );
    const autoDetectPlayedFn = makeLambda(
      "AutoDetectPlayedFn",
      "../../backend/lambdas/api/autoDetectPlayed.ts",
    );
    const submitGenreVoteFn = makeLambda(
      "SubmitGenreVoteFn",
      "../../backend/lambdas/api/submitGenreVote.ts",
    );
    const resetGenreVotesFn = makeLambda(
      "ResetGenreVotesFn",
      "../../backend/lambdas/api/resetGenreVotes.ts",
    );
    const adminAdjustGenreVotesFn = makeLambda(
      "AdminAdjustGenreVotesFn",
      "../../backend/lambdas/api/adminAdjustGenreVotes.ts",
    );
    const createPaypalOrderFn = makeLambda(
      "CreatePaypalOrderFn",
      "../../backend/lambdas/api/createPaypalOrder.ts",
    );
    const capturePaypalOrderFn = makeLambda(
      "CapturePaypalOrderFn",
      "../../backend/lambdas/api/capturePaypalOrder.ts",
    );
    const pushTrackFn = makeLambda(
      "PushTrackFn",
      "../../backend/lambdas/api/pushTrack.ts",
    );
    const pingSourceFn = makeLambda(
      "PingSourceFn",
      "../../backend/lambdas/api/pingSource.ts",
    );

    const reviewRequestByTokenFn = makeLambda(
      "ReviewRequestByTokenFn",
      "../../backend/lambdas/api/reviewRequestByToken.ts",
    );

    const toggleFireSaleByTokenFn = makeLambda(
      "ToggleFireSaleByTokenFn",
      "../../backend/lambdas/api/toggleFireSaleByToken.ts",
    );

    const syncLibraryFn = makeLambda(
      "SyncLibraryFn",
      "../../backend/lambdas/api/syncLibrary.ts",
    );
    const getLibraryFn = makeLambda(
      "GetLibraryFn",
      "../../backend/lambdas/api/getLibrary.ts",
    );
    const upvoteRequestFn = makeLambda(
      "UpvoteRequestFn",
      "../../backend/lambdas/api/upvoteRequest.ts",
    );
    const deleteEventFn = makeLambda(
      "DeleteEventFn",
      "../../backend/lambdas/api/deleteEvent.ts",
    );
    const cleanupEventsFn = makeLambda(
      "CleanupEventsFn",
      "../../backend/lambdas/api/cleanupEvents.ts",
    );
    const cleanupEventsResource = cleanupEventsFn.node.defaultChild as lambda.CfnFunction;
    cleanupEventsResource.timeout = 900;
    cleanupEventsResource.memorySize = 512;
    const createOrganizationFn = tenantApiFn;
    const listMyOrganizationsFn = tenantApiFn;
    const getOrganizationFn = tenantApiFn;
    const updateOrganizationFn = tenantApiFn;
    const listOrganizationMembersFn = tenantApiFn;
    const createOrganizationInvitationFn = tenantApiFn;
    const acceptOrganizationInvitationFn = tenantApiFn;
    const listOrganizationEventsFn = tenantApiFn;
    const createBridgePairingCodeFn = tenantApiFn;
    const publicSaasApiFn = makeLambda(
      "PublicSaasApiFn",
      "../../backend/lambdas/api/publicSaasApi.ts",
    );
    const pairBridgeDeviceFn = publicSaasApiFn;
    const listBridgeDevicesFn = tenantApiFn;
    const revokeBridgeDeviceFn = tenantApiFn;
    const createBillingCheckoutFn = tenantApiFn;
    const createBillingPortalFn = tenantApiFn;
    const createStripeConnectLinkFn = tenantApiFn;
    const getStripeConnectStatusFn = tenantApiFn;
    const createStripeTipCheckoutFn = publicSaasApiFn;
    const stripeWebhookFn = publicSaasApiFn;
    const migrateLegacyTenantFn = makeLambda(
      "MigrateLegacyTenantFn",
      "../../backend/lambdas/migrations/migrateLegacyTenant.ts",
    );
    const migrateLegacyTenantResource =
      migrateLegacyTenantFn.node.defaultChild as lambda.CfnFunction;
    migrateLegacyTenantResource.timeout = 900;
    migrateLegacyTenantResource.memorySize = 512;

    new events.Rule(this, "CleanupEventsSchedule", {
      schedule: events.Schedule.rate(Duration.hours(24)),
      targets: [
        new targets.LambdaFunction(cleanupEventsFn, {
          deadLetterQueue: asyncFailureQueue,
          retryAttempts: 2,
        }),
      ],
    });

    const sweepPendingPlayedFn = makeLambda(
      "SweepPendingPlayedFn",
      "../../backend/lambdas/scheduled/sweepPendingPlayed.ts",
    );
    eventsTable.grantReadWriteData(sweepPendingPlayedFn);
    requestsTable.grantReadWriteData(sweepPendingPlayedFn);

    new events.Rule(this, "SweepPendingPlayedSchedule", {
      schedule: events.Schedule.rate(Duration.minutes(2)),
      targets: [
        new targets.LambdaFunction(sweepPendingPlayedFn, {
          deadLetterQueue: asyncFailureQueue,
          retryAttempts: 2,
        }),
      ],
    });

    const nightlyResetFn = makeLambda(
      "NightlyResetFn",
      "../../backend/lambdas/scheduled/nightlyReset.ts",
    );
    eventsTable.grantReadWriteData(nightlyResetFn);
    requestsTable.grantReadWriteData(nightlyResetFn);

    new events.Rule(this, "NightlyResetSchedule", {
      // 4am Mountain is 10:00 UTC during daylight time and 11:00 UTC during standard time.
      // The Lambda checks America/Denver and no-ops for the non-matching UTC hour.
      schedule: events.Schedule.cron({ minute: "0", hour: "10,11" }),
      targets: [
        new targets.LambdaFunction(nightlyResetFn, {
          deadLetterQueue: asyncFailureQueue,
          retryAttempts: 2,
        }),
      ],
    });

    const openaiApiKeyParam = ssm.StringParameter.fromSecureStringParameterAttributes(
      this,
      "OpenAIApiKeyParam",
      { parameterName: "/music-request/openai-api-key" },
    );
    openaiApiKeyParam.grantRead(autoDetectPlayedFn);
    openaiApiKeyParam.grantRead(pushTrackFn);
    openaiApiKeyParam.grantRead(createRequestFn);
    autoDetectPlayedFn.addEnvironment("OPENAI_API_KEY_SSM_PARAM", "/music-request/openai-api-key");
    pushTrackFn.addEnvironment("OPENAI_API_KEY_SSM_PARAM", "/music-request/openai-api-key");
    createRequestFn.addEnvironment("OPENAI_API_KEY_SSM_PARAM", "/music-request/openai-api-key");

    const paypalWebhookFn = makeLambda(
      "PaypalWebhookFn",
      "../../backend/lambdas/api/paypalWebhook.ts",
    );
    const wsConnectFn = makeLambda("WsConnectFn", "../../backend/lambdas/websocket/connect.ts");
    const wsDisconnectFn = makeLambda(
      "WsDisconnectFn",
      "../../backend/lambdas/websocket/disconnect.ts",
    );
    const wsSubscribeFn = makeLambda(
      "WsSubscribeFn",
      "../../backend/lambdas/websocket/subscribe.ts",
    );
    const requestStreamFn = makeLambda(
      "RequestStreamFn",
      "../../backend/lambdas/streams/requestStream.ts",
    );

    eventsTable.grantReadData(listEventsFn);
    eventsTable.grantReadWriteData(getEventFn);
    eventsTable.grantReadData(getEventBySlugFn);
    eventsTable.grantReadWriteData(createEventFn);
    eventsTable.grantReadWriteData(updateEventFn);
    eventsTable.grantReadData(createRequestFn);
    organizationsTable.grantReadData(createRequestFn);
    usageCountersTable.grantReadWriteData(createRequestFn);
    requestsTable.grantReadWriteData(createRequestFn);
    requestsTable.grantReadWriteData(upvoteRequestFn);
    usageCountersTable.grantReadWriteData(upvoteRequestFn);
    requestsTable.grantReadData(getRequestsFn);
    eventsTable.grantReadData(getRequestsFn);
    bridgeDevicesTable.grantReadWriteData(getRequestsFn);
    requestsTable.grantReadWriteData(updateRequestFn);
    requestsTable.grantReadWriteData(resetRequestsFn);
    requestsTable.grantReadWriteData(detectPlayedFn);
    requestsTable.grantReadWriteData(autoDetectPlayedFn);
    requestsTable.grantReadWriteData(createPaypalOrderFn);
    eventsTable.grantReadData(createPaypalOrderFn);
    requestsTable.grantReadWriteData(capturePaypalOrderFn);
    eventsTable.grantReadData(capturePaypalOrderFn);
    requestsTable.grantReadWriteData(paypalWebhookFn);
    eventsTable.grantReadWriteData(autoDetectPlayedFn);
    eventsTable.grantReadWriteData(pushTrackFn);
    requestsTable.grantReadWriteData(pushTrackFn);
    eventsTable.grantReadWriteData(pingSourceFn);
    eventsTable.grantReadData(reviewRequestByTokenFn);
    requestsTable.grantReadWriteData(reviewRequestByTokenFn);
    eventsTable.grantReadWriteData(toggleFireSaleByTokenFn);
    eventsTable.grantReadWriteData(submitGenreVoteFn);
    eventsTable.grantReadWriteData(resetGenreVotesFn);
    eventsTable.grantReadWriteData(adminAdjustGenreVotesFn);
    requestsTable.grantStreamRead(requestStreamFn);
    connectionsTable.grantReadWriteData(wsConnectFn);
    eventsTable.grantReadData(wsConnectFn);
    organizationsTable.grantReadData(wsConnectFn);
    connectionsTable.grantReadWriteData(wsDisconnectFn);
    connectionsTable.grantReadWriteData(wsSubscribeFn);
    eventsTable.grantReadData(wsSubscribeFn);
    organizationsTable.grantReadData(wsSubscribeFn);
    connectionsTable.grantReadWriteData(requestStreamFn);
    eventsTable.grantReadWriteData(deleteEventFn);
    requestsTable.grantReadWriteData(deleteEventFn);
    eventsTable.grantReadWriteData(cleanupEventsFn);
    requestsTable.grantReadWriteData(cleanupEventsFn);
    organizationsTable.grantReadWriteData(cleanupEventsFn);
    membershipsTable.grantReadWriteData(cleanupEventsFn);
    invitationsTable.grantReadWriteData(cleanupEventsFn);
    bridgeDevicesTable.grantReadWriteData(cleanupEventsFn);
    usageCountersTable.grantReadWriteData(cleanupEventsFn);
    billingEventsTable.grantReadWriteData(cleanupEventsFn);
    platformOperationsTable.grantReadWriteData(cleanupEventsFn);
    connectionsTable.grantReadWriteData(cleanupEventsFn);
    brandAssetsBucket.grantReadWrite(cleanupEventsFn);
    brandAssetsBucket.grantRead(createRequestFn);
    brandAssetsBucket.grantPut(uploadBrandAssetFn);
    brandAssetsBucket.grantPut(syncLibraryFn);
    brandAssetsBucket.grantRead(getLibraryFn);
    eventsTable.grantReadData(syncLibraryFn);
    organizationsTable.grantReadData(syncLibraryFn);
    eventsTable.grantReadData(getLibraryFn);
    eventsTable.grantReadData(getAdminEventFn);

    const tenantAuthorizedFunctions = [
      createEventFn,
      getAdminEventFn,
      getEventBySlugFn,
      updateEventFn,
      deleteEventFn,
      updateRequestFn,
      resetRequestsFn,
      detectPlayedFn,
      autoDetectPlayedFn,
      uploadBrandAssetFn,
      resetGenreVotesFn,
      adminAdjustGenreVotesFn,
      getLibraryFn,
    ];
    tenantAuthorizedFunctions.forEach((fn) => membershipsTable.grantReadData(fn));
    eventsTable.grantReadData(uploadBrandAssetFn);
    eventsTable.grantReadData(updateRequestFn);
    eventsTable.grantReadData(resetRequestsFn);
    eventsTable.grantReadData(detectPlayedFn);
    eventsTable.grantReadData(resetGenreVotesFn);
    eventsTable.grantReadData(adminAdjustGenreVotesFn);

    organizationsTable.grantReadWriteData(createOrganizationFn);
    membershipsTable.grantReadWriteData(createOrganizationFn);
    organizationsTable.grantReadData(listMyOrganizationsFn);
    membershipsTable.grantReadData(listMyOrganizationsFn);
    organizationsTable.grantReadData(getOrganizationFn);
    membershipsTable.grantReadData(getOrganizationFn);
    eventsTable.grantReadData(getOrganizationFn);
    requestsTable.grantReadData(getOrganizationFn);
    organizationsTable.grantReadWriteData(updateOrganizationFn);
    membershipsTable.grantReadData(updateOrganizationFn);
    membershipsTable.grantReadData(listOrganizationMembersFn);
    membershipsTable.grantReadData(createOrganizationInvitationFn);
    organizationsTable.grantReadData(createOrganizationInvitationFn);
    invitationsTable.grantReadWriteData(createOrganizationInvitationFn);
    invitationsTable.grantReadWriteData(acceptOrganizationInvitationFn);
    membershipsTable.grantReadWriteData(acceptOrganizationInvitationFn);
    membershipsTable.grantReadData(listOrganizationEventsFn);
    eventsTable.grantReadData(listOrganizationEventsFn);
    organizationsTable.grantReadData(createEventFn);

    membershipsTable.grantReadData(createBridgePairingCodeFn);
    eventsTable.grantReadData(createBridgePairingCodeFn);
    organizationsTable.grantReadData(createBridgePairingCodeFn);
    bridgeDevicesTable.grantReadWriteData(createBridgePairingCodeFn);
    bridgeDevicesTable.grantReadWriteData(pairBridgeDeviceFn);
    eventsTable.grantReadData(pairBridgeDeviceFn);
    organizationsTable.grantReadData(pairBridgeDeviceFn);
    membershipsTable.grantReadData(listBridgeDevicesFn);
    bridgeDevicesTable.grantReadData(listBridgeDevicesFn);
    membershipsTable.grantReadData(revokeBridgeDeviceFn);
    bridgeDevicesTable.grantReadWriteData(revokeBridgeDeviceFn);

    [pushTrackFn, pingSourceFn, reviewRequestByTokenFn, toggleFireSaleByTokenFn, syncLibraryFn, getLibraryFn]
      .forEach((fn) => {
        bridgeDevicesTable.grantReadWriteData(fn);
        organizationsTable.grantReadData(fn);
      });
    organizationsTable.grantReadData(getRequestsFn);

    [createBillingCheckoutFn, createBillingPortalFn, createStripeConnectLinkFn, getStripeConnectStatusFn]
      .forEach((fn) => {
        membershipsTable.grantReadData(fn);
        organizationsTable.grantReadWriteData(fn);
      });
    organizationsTable.grantReadData(createStripeTipCheckoutFn);
    eventsTable.grantReadData(createStripeTipCheckoutFn);
    requestsTable.grantReadWriteData(createStripeTipCheckoutFn);
    organizationsTable.grantReadWriteData(stripeWebhookFn);
    requestsTable.grantReadWriteData(stripeWebhookFn);
    billingEventsTable.grantReadWriteData(stripeWebhookFn);

    organizationsTable.grantReadWriteData(migrateLegacyTenantFn);
    membershipsTable.grantReadWriteData(migrateLegacyTenantFn);
    eventsTable.grantReadWriteData(migrateLegacyTenantFn);
    requestsTable.grantReadWriteData(migrateLegacyTenantFn);
    migrateLegacyTenantFn.addEnvironment("USER_POOL_ID", userPool.userPoolId);
    migrateLegacyTenantFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cognito-idp:ListUsers"],
        resources: [userPool.userPoolArn],
      }),
    );

    organizationsTable.grantReadWriteData(platformApiFn);
    membershipsTable.grantReadWriteData(platformApiFn);
    invitationsTable.grantReadWriteData(platformApiFn);
    eventsTable.grantReadData(platformApiFn);
    requestsTable.grantReadData(platformApiFn);
    bridgeDevicesTable.grantReadWriteData(platformApiFn);
    billingEventsTable.grantReadData(platformApiFn);
    usageCountersTable.grantReadData(platformApiFn);
    platformOperationsTable.grantReadWriteData(platformApiFn);
    brandAssetsBucket.grantRead(platformApiFn);
    platformApiFn.addEnvironment("USER_POOL_ID", userPool.userPoolId);
    platformApiFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "cognito-idp:ListUsers",
          "cognito-idp:AdminGetUser",
          "cognito-idp:AdminDisableUser",
          "cognito-idp:AdminEnableUser",
          "cognito-idp:AdminResetUserPassword",
        ],
        resources: [userPool.userPoolArn],
      }),
    );
    platformApiFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["cloudwatch:DescribeAlarms", "cloudwatch:GetMetricData"],
        resources: ["*"],
      }),
    );
    platformApiFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["sqs:GetQueueAttributes"],
        resources: [asyncFailureQueue.queueArn],
      }),
    );

    requestStreamFn.addEventSource(
      new eventSources.DynamoEventSource(requestsTable, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 10,
        bisectBatchOnError: true,
        retryAttempts: 3,
        onFailure: new eventSources.SqsDlq(asyncFailureQueue),
      }),
    );

    requestStreamFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["execute-api:ManageConnections"],
        resources: [
          `arn:aws:execute-api:${this.region}:${this.account}:${websocketApi.ref}/${websocketStage.stageName}/POST/@connections/*`,
        ],
      }),
    );

    const websocketConnectIntegration = new apigatewayv2.CfnIntegration(
      this,
      "WebSocketConnectIntegration",
      {
        apiId: websocketApi.ref,
        integrationType: "AWS_PROXY",
        integrationUri: this.websocketLambdaUri(wsConnectFn.functionArn),
      },
    );

    const websocketDisconnectIntegration = new apigatewayv2.CfnIntegration(
      this,
      "WebSocketDisconnectIntegration",
      {
        apiId: websocketApi.ref,
        integrationType: "AWS_PROXY",
        integrationUri: this.websocketLambdaUri(wsDisconnectFn.functionArn),
      },
    );

    const websocketSubscribeIntegration = new apigatewayv2.CfnIntegration(
      this,
      "WebSocketSubscribeIntegration",
      {
        apiId: websocketApi.ref,
        integrationType: "AWS_PROXY",
        integrationUri: this.websocketLambdaUri(wsSubscribeFn.functionArn),
      },
    );

    new apigatewayv2.CfnRoute(this, "WebSocketConnectRoute", {
      apiId: websocketApi.ref,
      routeKey: "$connect",
      authorizationType: "NONE",
      target: `integrations/${websocketConnectIntegration.ref}`,
    });

    new apigatewayv2.CfnRoute(this, "WebSocketDisconnectRoute", {
      apiId: websocketApi.ref,
      routeKey: "$disconnect",
      authorizationType: "NONE",
      target: `integrations/${websocketDisconnectIntegration.ref}`,
    });

    new apigatewayv2.CfnRoute(this, "WebSocketSubscribeRoute", {
      apiId: websocketApi.ref,
      routeKey: "subscribe",
      authorizationType: "NONE",
      target: `integrations/${websocketSubscribeIntegration.ref}`,
    });

    const wsInvokePermissions = [wsConnectFn, wsDisconnectFn, wsSubscribeFn];
    wsInvokePermissions.forEach((fn, idx) => {
      fn.addPermission(`WebSocketInvokePermission${idx}`, {
        principal: new iam.ServicePrincipal("apigateway.amazonaws.com"),
        action: "lambda:InvokeFunction",
        sourceArn: `arn:aws:execute-api:${this.region}:${this.account}:${websocketApi.ref}/*`,
      });
    });

    const restApi = new apigateway.RestApi(this, "DjRequestsRestApi", {
      restApiName: isProduction ? "dj-requests-api" : `dj-requests-api-${deploymentStage}`,
      deployOptions: {
        stageName: deploymentStage,
        throttlingRateLimit: 200,
        throttlingBurstLimit: 400,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allowHeaders: [
          "Authorization",
          "Content-Type",
          "x-push-token",
          "x-device-id",
          "x-support-session-id",
          "stripe-signature",
        ],
      },
    });

    const gatewayCorsHeaders = {
      "Access-Control-Allow-Origin": "'*'",
      "Access-Control-Allow-Headers":
        "'Content-Type,Authorization,x-push-token,x-device-id,x-support-session-id,stripe-signature'",
      "Access-Control-Allow-Methods": "'GET,POST,PATCH,DELETE,OPTIONS'",
    };
    restApi.addGatewayResponse("Default4xxCors", {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: gatewayCorsHeaders,
    });
    restApi.addGatewayResponse("Default5xxCors", {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: gatewayCorsHeaders,
    });
    restApi.addGatewayResponse("UnauthorizedCors", {
      type: apigateway.ResponseType.UNAUTHORIZED,
      responseHeaders: gatewayCorsHeaders,
    });
    restApi.addGatewayResponse("AccessDeniedCors", {
      type: apigateway.ResponseType.ACCESS_DENIED,
      responseHeaders: gatewayCorsHeaders,
    });

    const apiWebAcl = new wafv2.CfnWebACL(this, "ApiWebAcl", {
      scope: "REGIONAL",
      defaultAction: { allow: {} },
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: `${deploymentStage}-casper-requests-waf`,
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: "AWSManagedCommonRules",
          priority: 0,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              name: "AWSManagedRulesCommonRuleSet",
              vendorName: "AWS",
              ruleActionOverrides: [
                {
                  name: "SizeRestrictions_BODY",
                  actionToUse: { count: {} },
                },
              ],
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `${deploymentStage}-common-rules`,
            sampledRequestsEnabled: true,
          },
        },
        {
          name: "PerIpRateLimit",
          priority: 1,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              aggregateKeyType: "IP",
              limit: 5000,
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: `${deploymentStage}-ip-rate-limit`,
            sampledRequestsEnabled: true,
          },
        },
      ],
    });
    const apiWebAclAssociation = new wafv2.CfnWebACLAssociation(this, "ApiWebAclAssociation", {
      resourceArn:
        `arn:${this.partition}:apigateway:${this.region}::/restapis/`
        + `${restApi.restApiId}/stages/${restApi.deploymentStage.stageName}`,
      webAclArn: apiWebAcl.attrArn,
    });
    apiWebAclAssociation.node.addDependency(restApi.deploymentStage);

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, "ApiAuthorizer", {
      cognitoUserPools: [userPool],
    });

    const eventsResource = restApi.root.addResource("events");
    const bySlugResource = eventsResource.addResource("by-slug");
    const slugResource = bySlugResource.addResource("{slug}");
    const eventByIdResource = eventsResource.addResource("{eventId}");
    const requestsResource = eventByIdResource.addResource("requests");
    const requestByIdResource = requestsResource.addResource("{requestId}");
    const assetsResource = eventByIdResource.addResource("assets");
    const resetRequestsResource = eventByIdResource.addResource("reset-requests");
    const detectPlayedResource = eventByIdResource.addResource("detect-played");
    const autoDetectPlayedResource = eventByIdResource.addResource("auto-detect-played");
    const pushTrackResource = eventByIdResource.addResource("push-track");
    const reviewRequestResource = eventByIdResource.addResource("review-request");
    const libraryResource = eventByIdResource.addResource("library");
    const genreVotesResource = eventByIdResource.addResource("genre-votes");
    const resetGenreVotesResource = genreVotesResource.addResource("reset");
    const adminAdjustGenreVotesResource = genreVotesResource.addResource("admin-adjust");
    const paymentsResource = requestByIdResource.addResource("payments");
    const paypalOrderResource = paymentsResource.addResource("paypal-order");
    const paypalCaptureResource = paymentsResource.addResource("paypal-capture");
    const stripeCheckoutResource = paymentsResource.addResource("stripe-checkout");
    const rootPaymentsResource = restApi.root.addResource("payments");
    const paypalWebhookResource = rootPaymentsResource.addResource("paypal-webhook");
    const stripeWebhookResource = rootPaymentsResource.addResource("stripe-webhook");
    const adminResource = restApi.root.addResource("admin");
    const adminEventsResource = adminResource.addResource("events");
    const adminEventResource = adminEventsResource.addResource("{eventId}");
    const adminRequestsResource = adminEventResource.addResource("requests");
    const adminLibraryResource = adminEventResource.addResource("library");
    const meResource = restApi.root.addResource("me");
    const myOrganizationsResource = meResource.addResource("organizations");
    const organizationsResource = restApi.root.addResource("organizations");
    const organizationResource = organizationsResource.addResource("{organizationId}");
    const organizationMembersResource = organizationResource.addResource("members");
    const organizationMemberResource = organizationMembersResource.addResource("{userId}");
    const organizationInvitationsResource = organizationResource.addResource("invitations");
    const organizationEventsResource = organizationResource.addResource("events");
    const organizationBillingResource = organizationResource.addResource("billing");
    const billingCheckoutResource = organizationBillingResource.addResource("checkout");
    const billingPortalResource = organizationBillingResource.addResource("portal");
    const organizationStripeResource = organizationResource.addResource("stripe");
    const stripeConnectResource = organizationStripeResource.addResource("connect");
    const stripeStatusResource = organizationStripeResource.addResource("status");
    const organizationDevicesResource = organizationResource.addResource("devices");
    const organizationDeviceResource = organizationDevicesResource.addResource("{deviceId}");
    const invitationsResource = restApi.root.addResource("invitations");
    const invitationResource = invitationsResource.addResource("{token}");
    const acceptInvitationResource = invitationResource.addResource("accept");
    const bridgeResource = restApi.root.addResource("bridge");
    const bridgePairingCodesResource = bridgeResource.addResource("pairing-codes");
    const bridgePairResource = bridgeResource.addResource("pair");
    const bridgeRefreshResource = bridgeResource.addResource("refresh");
    const bridgeUnpairResource = bridgeResource.addResource("unpair");
    const platformResource = restApi.root.addResource("platform");
    const platformProxyResource = platformResource.addProxy({ anyMethod: false });

    eventsResource.addMethod("GET", new apigateway.LambdaIntegration(listEventsFn));
    eventsResource.addMethod("POST", new apigateway.LambdaIntegration(createEventFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    slugResource.addMethod("GET", new apigateway.LambdaIntegration(getEventBySlugFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    eventByIdResource.addMethod("GET", new apigateway.LambdaIntegration(getEventFn));
    adminEventResource.addMethod("GET", new apigateway.LambdaIntegration(getAdminEventFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    adminRequestsResource.addMethod("GET", new apigateway.LambdaIntegration(tenantApiFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    adminLibraryResource.addMethod("GET", new apigateway.LambdaIntegration(getLibraryFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    eventByIdResource.addMethod("PATCH", new apigateway.LambdaIntegration(updateEventFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    eventByIdResource.addMethod("DELETE", new apigateway.LambdaIntegration(deleteEventFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    requestsResource.addMethod("POST", new apigateway.LambdaIntegration(createRequestFn));
    requestsResource.addMethod("GET", new apigateway.LambdaIntegration(getRequestsFn));
    requestByIdResource.addMethod("PATCH", new apigateway.LambdaIntegration(updateRequestFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    assetsResource.addMethod("POST", new apigateway.LambdaIntegration(uploadBrandAssetFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    resetRequestsResource.addMethod("POST", new apigateway.LambdaIntegration(resetRequestsFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    detectPlayedResource.addMethod("POST", new apigateway.LambdaIntegration(detectPlayedFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    autoDetectPlayedResource.addMethod("POST", new apigateway.LambdaIntegration(autoDetectPlayedFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    pushTrackResource.addMethod("POST", new apigateway.LambdaIntegration(pushTrackFn));
    const pingSourceResource = eventByIdResource.addResource("ping-source");
    pingSourceResource.addMethod("POST", new apigateway.LambdaIntegration(pingSourceFn));
    reviewRequestResource.addMethod("POST", new apigateway.LambdaIntegration(reviewRequestByTokenFn));
    const fireSaleResource = eventByIdResource.addResource("fire-sale");
    fireSaleResource.addMethod("POST", new apigateway.LambdaIntegration(toggleFireSaleByTokenFn));
    libraryResource.addMethod("POST", new apigateway.LambdaIntegration(syncLibraryFn));
    libraryResource.addMethod("GET", new apigateway.LambdaIntegration(getLibraryFn));
    genreVotesResource.addMethod("POST", new apigateway.LambdaIntegration(submitGenreVoteFn));
    resetGenreVotesResource.addMethod("POST", new apigateway.LambdaIntegration(resetGenreVotesFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    adminAdjustGenreVotesResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(adminAdjustGenreVotesFn),
      {
        authorizer,
        authorizationType: apigateway.AuthorizationType.COGNITO,
      },
    );
    const upvoteResource = requestByIdResource.addResource("upvote");
    upvoteResource.addMethod("POST", new apigateway.LambdaIntegration(upvoteRequestFn));
    paypalOrderResource.addMethod("POST", new apigateway.LambdaIntegration(createPaypalOrderFn));
    paypalCaptureResource.addMethod("POST", new apigateway.LambdaIntegration(capturePaypalOrderFn));
    stripeCheckoutResource.addMethod("POST", new apigateway.LambdaIntegration(createStripeTipCheckoutFn));
    paypalWebhookResource.addMethod("POST", new apigateway.LambdaIntegration(paypalWebhookFn));
    stripeWebhookResource.addMethod("POST", new apigateway.LambdaIntegration(stripeWebhookFn));
    platformProxyResource.addMethod("ANY", new apigateway.LambdaIntegration(platformApiFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    myOrganizationsResource.addMethod("GET", new apigateway.LambdaIntegration(listMyOrganizationsFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    organizationsResource.addMethod("POST", new apigateway.LambdaIntegration(createOrganizationFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    organizationResource.addMethod("GET", new apigateway.LambdaIntegration(getOrganizationFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    organizationResource.addMethod("PATCH", new apigateway.LambdaIntegration(updateOrganizationFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    organizationMembersResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(listOrganizationMembersFn),
      { authorizer, authorizationType: apigateway.AuthorizationType.COGNITO },
    );
    organizationMemberResource.addMethod(
      "PATCH",
      new apigateway.LambdaIntegration(tenantApiFn),
      { authorizer, authorizationType: apigateway.AuthorizationType.COGNITO },
    );
    organizationMemberResource.addMethod(
      "DELETE",
      new apigateway.LambdaIntegration(tenantApiFn),
      { authorizer, authorizationType: apigateway.AuthorizationType.COGNITO },
    );
    organizationInvitationsResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(createOrganizationInvitationFn),
      { authorizer, authorizationType: apigateway.AuthorizationType.COGNITO },
    );
    organizationEventsResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(listOrganizationEventsFn),
      { authorizer, authorizationType: apigateway.AuthorizationType.COGNITO },
    );
    acceptInvitationResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(acceptOrganizationInvitationFn),
      { authorizer, authorizationType: apigateway.AuthorizationType.COGNITO },
    );
    billingCheckoutResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(createBillingCheckoutFn),
      { authorizer, authorizationType: apigateway.AuthorizationType.COGNITO },
    );
    billingPortalResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(createBillingPortalFn),
      { authorizer, authorizationType: apigateway.AuthorizationType.COGNITO },
    );
    stripeConnectResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(createStripeConnectLinkFn),
      { authorizer, authorizationType: apigateway.AuthorizationType.COGNITO },
    );
    stripeStatusResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(getStripeConnectStatusFn),
      { authorizer, authorizationType: apigateway.AuthorizationType.COGNITO },
    );
    organizationDevicesResource.addMethod(
      "GET",
      new apigateway.LambdaIntegration(listBridgeDevicesFn),
      { authorizer, authorizationType: apigateway.AuthorizationType.COGNITO },
    );
    organizationDeviceResource.addMethod(
      "DELETE",
      new apigateway.LambdaIntegration(revokeBridgeDeviceFn),
      { authorizer, authorizationType: apigateway.AuthorizationType.COGNITO },
    );
    bridgePairingCodesResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(createBridgePairingCodeFn),
      { authorizer, authorizationType: apigateway.AuthorizationType.COGNITO },
    );
    bridgePairResource.addMethod("POST", new apigateway.LambdaIntegration(pairBridgeDeviceFn));
    bridgeRefreshResource.addMethod("POST", new apigateway.LambdaIntegration(publicSaasApiFn));
    bridgeUnpairResource.addMethod("POST", new apigateway.LambdaIntegration(publicSaasApiFn));

    const paypalClientId = process.env.PAYPAL_CLIENT_ID ?? "";
    const paypalClientSecret = process.env.PAYPAL_CLIENT_SECRET ?? "";
    const paypalEnvironment = process.env.PAYPAL_ENVIRONMENT ?? "sandbox";
    const paypalWebhookId = process.env.PAYPAL_WEBHOOK_ID ?? "";
    createPaypalOrderFn.addEnvironment("PAYPAL_CLIENT_ID", paypalClientId);
    createPaypalOrderFn.addEnvironment("PAYPAL_CLIENT_SECRET", paypalClientSecret);
    createPaypalOrderFn.addEnvironment("PAYPAL_ENVIRONMENT", paypalEnvironment);
    capturePaypalOrderFn.addEnvironment("PAYPAL_CLIENT_ID", paypalClientId);
    capturePaypalOrderFn.addEnvironment("PAYPAL_CLIENT_SECRET", paypalClientSecret);
    capturePaypalOrderFn.addEnvironment("PAYPAL_ENVIRONMENT", paypalEnvironment);
    paypalWebhookFn.addEnvironment("PAYPAL_CLIENT_ID", paypalClientId);
    paypalWebhookFn.addEnvironment("PAYPAL_CLIENT_SECRET", paypalClientSecret);
    paypalWebhookFn.addEnvironment("PAYPAL_ENVIRONMENT", paypalEnvironment);
    paypalWebhookFn.addEnvironment("PAYPAL_WEBHOOK_ID", paypalWebhookId);

    const stripeSecretKeyParameterName = `/music-request/${deploymentStage}/stripe-secret-key`;
    const stripeWebhookSecretParameterName =
      `/music-request/${deploymentStage}/stripe-webhook-secret`;
    const stripeSecretKeyParameter = ssm.StringParameter.fromSecureStringParameterAttributes(
      this,
      "StripeSecretKeyParameter",
      { parameterName: stripeSecretKeyParameterName },
    );
    const stripeWebhookSecretParameter = ssm.StringParameter.fromSecureStringParameterAttributes(
      this,
      "StripeWebhookSecretParameter",
      { parameterName: stripeWebhookSecretParameterName },
    );
    const stripeDjPriceId = process.env.STRIPE_DJ_PRICE_ID ?? process.env.STRIPE_PRICE_ID ?? "";
    const stripeOrganizationPriceId = process.env.STRIPE_ORGANIZATION_PRICE_ID ?? "";
    stripeSecretKeyParameter.grantRead(tenantApiFn);
    stripeSecretKeyParameter.grantRead(publicSaasApiFn);
    stripeSecretKeyParameter.grantRead(cleanupEventsFn);
    stripeSecretKeyParameter.grantRead(platformApiFn);
    stripeWebhookSecretParameter.grantRead(publicSaasApiFn);
    tenantApiFn.addEnvironment("STRIPE_SECRET_KEY_SSM_PARAM", stripeSecretKeyParameterName);
    tenantApiFn.addEnvironment("STRIPE_DJ_PRICE_ID", stripeDjPriceId);
    tenantApiFn.addEnvironment("STRIPE_ORGANIZATION_PRICE_ID", stripeOrganizationPriceId);
    platformApiFn.addEnvironment("STRIPE_SECRET_KEY_SSM_PARAM", stripeSecretKeyParameterName);
    platformApiFn.addEnvironment("STRIPE_DJ_PRICE_ID", stripeDjPriceId);
    platformApiFn.addEnvironment("STRIPE_ORGANIZATION_PRICE_ID", stripeOrganizationPriceId);
    publicSaasApiFn.addEnvironment("STRIPE_SECRET_KEY_SSM_PARAM", stripeSecretKeyParameterName);
    publicSaasApiFn.addEnvironment(
      "STRIPE_WEBHOOK_SECRET_SSM_PARAM",
      stripeWebhookSecretParameterName,
    );
    cleanupEventsFn.addEnvironment("STRIPE_SECRET_KEY_SSM_PARAM", stripeSecretKeyParameterName);

    // --- CloudWatch alarms ---
    const alarmTopic = new sns.Topic(this, "AlarmTopic", {
      displayName: "Casper Requests Alarms",
    });

    const alarmEmail = process.env.ALARM_EMAIL?.trim();
    if (alarmEmail) {
      alarmTopic.addSubscription(new snsSubscriptions.EmailSubscription(alarmEmail));
    }

    const criticalFunctions = {
      CreateRequest: createRequestFn,
      PushTrack: pushTrackFn,
      CapturePaypalOrder: capturePaypalOrderFn,
      PaypalWebhook: paypalWebhookFn,
      RequestStream: requestStreamFn,
      UpdateRequest: updateRequestFn,
      UpdateEvent: updateEventFn,
      ReviewRequestByToken: reviewRequestByTokenFn,
      AutoDetectPlayed: autoDetectPlayedFn,
      DetectPlayed: detectPlayedFn,
      PingSource: pingSourceFn,
      UpvoteRequest: upvoteRequestFn,
      ResetRequests: resetRequestsFn,
      SyncLibrary: syncLibraryFn,
      SweepPendingPlayed: sweepPendingPlayedFn,
      NightlyReset: nightlyResetFn,
      WsConnect: wsConnectFn,
      WsDisconnect: wsDisconnectFn,
      WsSubscribe: wsSubscribeFn,
      TenantApi: tenantApiFn,
      PublicSaasApi: publicSaasApiFn,
      PlatformApi: platformApiFn,
    };
    const criticalEntries = Object.entries(criticalFunctions);
    for (let groupIndex = 0; groupIndex < criticalEntries.length; groupIndex += 9) {
      const group = criticalEntries.slice(groupIndex, groupIndex + 9);
      const metrics = Object.fromEntries(
        group.map(([label, fn], index) => [
          `m${index}`,
          fn.metricErrors({
            period: Duration.minutes(5),
            label,
          }),
        ]),
      );
      const alarm = new cloudwatch.Alarm(this, `CriticalLambdaErrorsGroup${groupIndex / 9 + 1}`, {
        metric: new cloudwatch.MathExpression({
          expression: "SUM(METRICS())",
          period: Duration.minutes(5),
          usingMetrics: metrics,
        }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        alarmDescription:
          `Critical Lambda errors >= 1 in 5 min (${group.map(([label]) => label).join(", ")})`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      alarm.addAlarmAction(new cwActions.SnsAction(alarmTopic));
    }

    // Throttling indicates capacity issues — different signal from errors.
    const throttleFunctions = {
      CreateRequest: createRequestFn,
      PushTrack: pushTrackFn,
      RequestStream: requestStreamFn,
      TenantApi: tenantApiFn,
      PlatformApi: platformApiFn,
    };
    const lambdaThrottleAlarm = new cloudwatch.Alarm(this, "CriticalLambdaThrottleAlarm", {
      metric: new cloudwatch.MathExpression({
        expression: "SUM(METRICS())",
        period: Duration.minutes(5),
        usingMetrics: Object.fromEntries(
          Object.entries(throttleFunctions).map(([label, fn], index) => [
            `m${index}`,
            fn.metricThrottles({ period: Duration.minutes(5), label }),
          ]),
        ),
      }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: "Critical Lambda throttles >= 5 in 5 min",
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    lambdaThrottleAlarm.addAlarmAction(new cwActions.SnsAction(alarmTopic));

    const api5xxAlarm = new cloudwatch.Alarm(this, "RestApi5xxAlarm", {
      metric: restApi.metricServerError({ period: Duration.minutes(5) }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: "REST API 5xx errors >= 5 in 5 min",
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    api5xxAlarm.addAlarmAction(new cwActions.SnsAction(alarmTopic));

    const api4xxAlarm = new cloudwatch.Alarm(this, "RestApi4xxAlarm", {
      metric: restApi.metricClientError({ period: Duration.minutes(5) }),
      threshold: 50,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: "REST API 4xx surge — possible client/regression issue (>=50 in 5 min)",
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    api4xxAlarm.addAlarmAction(new cwActions.SnsAction(alarmTopic));

    // DynamoDB throttle alarms
    for (const [label, table] of Object.entries({ Events: eventsTable, Requests: requestsTable })) {
      const alarm = new cloudwatch.Alarm(this, `${label}TableThrottleAlarm`, {
        metric: table.metric("ThrottledRequests", { period: Duration.minutes(5), statistic: "Sum" }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        alarmDescription: `${label} table throttled requests >= 1 in 5 min`,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      alarm.addAlarmAction(new cwActions.SnsAction(alarmTopic));
    }

    const tenantTableThrottleAlarm = new cloudwatch.Alarm(this, "TenantTablesThrottleAlarm", {
      metric: new cloudwatch.MathExpression({
        expression: "MAX([organizations,memberships,invitations,devices,billing,usage,platform])",
        period: Duration.minutes(5),
        usingMetrics: {
          organizations: organizationsTable.metric("ThrottledRequests", { statistic: "Sum" }),
          memberships: membershipsTable.metric("ThrottledRequests", { statistic: "Sum" }),
          invitations: invitationsTable.metric("ThrottledRequests", { statistic: "Sum" }),
          devices: bridgeDevicesTable.metric("ThrottledRequests", { statistic: "Sum" }),
          billing: billingEventsTable.metric("ThrottledRequests", { statistic: "Sum" }),
          usage: usageCountersTable.metric("ThrottledRequests", { statistic: "Sum" }),
          platform: platformOperationsTable.metric("ThrottledRequests", { statistic: "Sum" }),
        },
      }),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: "A SaaS tenant table reported throttled requests",
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    tenantTableThrottleAlarm.addAlarmAction(new cwActions.SnsAction(alarmTopic));

    const asyncFailureAlarm = new cloudwatch.Alarm(this, "AsyncFailureQueueAlarm", {
      metric: asyncFailureQueue.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: "An asynchronous job or stream record reached the dead-letter queue",
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    asyncFailureAlarm.addAlarmAction(new cwActions.SnsAction(alarmTopic));

    new CfnOutput(this, "AlarmTopicArn", { value: alarmTopic.topicArn });
    new CfnOutput(this, "AsyncFailureQueueUrl", { value: asyncFailureQueue.queueUrl });

    new CfnOutput(this, "RestApiUrl", { value: restApi.url });
    new CfnOutput(this, "WebSocketUrl", {
      value: `wss://${websocketEndpoint}`,
    });
    new CfnOutput(this, "WebSocketManagementEndpoint", {
      value: websocketEndpoint,
    });
    new CfnOutput(this, "CloudFrontUrl", {
      value: `https://${distribution.distributionDomainName}`,
    });
    new CfnOutput(this, "CloudFrontDistributionId", {
      value: distribution.distributionId,
    });
    new CfnOutput(this, "FrontendBucketName", {
      value: frontendBucket.bucketName,
    });
    new CfnOutput(this, "FrontendUrl", {
      value: isProduction
        ? "https://casperrequests.com"
        : `https://${distribution.distributionDomainName}`,
    });
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, "LegacyMigrationFunctionName", {
      value: migrateLegacyTenantFn.functionName,
    });
    new CfnOutput(this, "BrandAssetsBucketName", { value: brandAssetsBucket.bucketName });
  }

  private websocketLambdaUri(functionArn: string) {
    return `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${functionArn}/invocations`;
  }
}
