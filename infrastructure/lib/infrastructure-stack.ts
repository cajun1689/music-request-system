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
  aws_cognito as cognito,
  aws_dynamodb as dynamodb,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_event_sources as eventSources,
  aws_lambda_nodejs as lambdaNodejs,
  aws_s3 as s3,
  aws_s3_deployment as s3deploy,
} from "aws-cdk-lib";
import { Construct } from "constructs";

const lambdaDefaults = {
  runtime: lambda.Runtime.NODEJS_20_X,
  memorySize: 256,
  timeout: Duration.seconds(15),
  bundling: {
    minify: true,
    sourceMap: true,
    target: "node20",
  },
} satisfies Partial<lambdaNodejs.NodejsFunctionProps>;

export class InfrastructureStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const customDomainNames = ["casperrequests.com", "www.casperrequests.com"];
    const cloudFrontCertificateArn =
      "arn:aws:acm:us-east-1:285633211360:certificate/0271c9cf-1aff-4180-8c14-7137c169b8da";

    const eventsTable = new dynamodb.Table(this, "EventsTable", {
      partitionKey: { name: "eventId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    eventsTable.addGlobalSecondaryIndex({
      indexName: "slug-index",
      partitionKey: { name: "slug", type: dynamodb.AttributeType.STRING },
    });

    const requestsTable = new dynamodb.Table(this, "RequestsTable", {
      partitionKey: { name: "eventId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "requestId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    requestsTable.addGlobalSecondaryIndex({
      indexName: "eventId-status-index",
      partitionKey: { name: "eventId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "status", type: dynamodb.AttributeType.STRING },
    });

    const connectionsTable = new dynamodb.Table(this, "ConnectionsTable", {
      partitionKey: { name: "connectionId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    connectionsTable.addGlobalSecondaryIndex({
      indexName: "eventId-index",
      partitionKey: { name: "eventId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "connectionId", type: dynamodb.AttributeType.STRING },
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
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const frontendBucket = new s3.Bucket(this, "FrontendBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const distribution = new cloudfront.Distribution(this, "FrontendDistribution", {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      domainNames: customDomainNames,
      certificate: acm.Certificate.fromCertificateArn(
        this,
        "FrontendCertificate",
        cloudFrontCertificateArn,
      ),
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
      userPoolName: "dj-music-request-users",
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: true,
        requireSymbols: false,
      },
      removalPolicy: RemovalPolicy.DESTROY,
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
      name: "dj-requests-websocket",
      protocolType: "WEBSOCKET",
      routeSelectionExpression: "$request.body.action",
    });

    const websocketStage = new apigatewayv2.CfnStage(this, "RequestsWebSocketStage", {
      apiId: websocketApi.ref,
      stageName: "prod",
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
          BRAND_ASSETS_BUCKET_NAME: brandAssetsBucket.bucketName,
          WEBSOCKET_ENDPOINT: websocketEndpoint,
        },
      });

    const createEventFn = makeLambda("CreateEventFn", "../../backend/lambdas/api/createEvent.ts");
    const getEventFn = makeLambda("GetEventFn", "../../backend/lambdas/api/getEvent.ts");
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

    eventsTable.grantReadWriteData(getEventFn);
    eventsTable.grantReadData(getEventBySlugFn);
    eventsTable.grantReadWriteData(createEventFn);
    eventsTable.grantReadWriteData(updateEventFn);
    requestsTable.grantReadWriteData(createRequestFn);
    requestsTable.grantReadData(getRequestsFn);
    requestsTable.grantReadWriteData(updateRequestFn);
    requestsTable.grantReadWriteData(resetRequestsFn);
    requestsTable.grantReadWriteData(detectPlayedFn);
    requestsTable.grantReadWriteData(autoDetectPlayedFn);
    requestsTable.grantReadWriteData(createPaypalOrderFn);
    requestsTable.grantReadWriteData(capturePaypalOrderFn);
    requestsTable.grantReadWriteData(paypalWebhookFn);
    eventsTable.grantReadWriteData(autoDetectPlayedFn);
    eventsTable.grantReadWriteData(pushTrackFn);
    requestsTable.grantReadWriteData(pushTrackFn);
    eventsTable.grantReadWriteData(submitGenreVoteFn);
    eventsTable.grantReadWriteData(resetGenreVotesFn);
    requestsTable.grantStreamRead(requestStreamFn);
    connectionsTable.grantReadWriteData(wsConnectFn);
    connectionsTable.grantReadWriteData(wsDisconnectFn);
    connectionsTable.grantReadWriteData(wsSubscribeFn);
    connectionsTable.grantReadWriteData(requestStreamFn);
    brandAssetsBucket.grantPut(uploadBrandAssetFn);

    requestStreamFn.addEventSource(
      new eventSources.DynamoEventSource(requestsTable, {
        startingPosition: lambda.StartingPosition.LATEST,
        batchSize: 10,
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
      restApiName: "dj-requests-api",
      deployOptions: { stageName: "prod" },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
        allowHeaders: ["Authorization", "Content-Type", "x-push-token"],
      },
    });

    const gatewayCorsHeaders = {
      "Access-Control-Allow-Origin": "'*'",
      "Access-Control-Allow-Headers": "'Content-Type,Authorization,x-push-token'",
      "Access-Control-Allow-Methods": "'GET,POST,PATCH,OPTIONS'",
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
    const genreVotesResource = eventByIdResource.addResource("genre-votes");
    const resetGenreVotesResource = genreVotesResource.addResource("reset");
    const paymentsResource = requestByIdResource.addResource("payments");
    const paypalOrderResource = paymentsResource.addResource("paypal-order");
    const paypalCaptureResource = paymentsResource.addResource("paypal-capture");
    const rootPaymentsResource = restApi.root.addResource("payments");
    const paypalWebhookResource = rootPaymentsResource.addResource("paypal-webhook");

    eventsResource.addMethod("POST", new apigateway.LambdaIntegration(createEventFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    slugResource.addMethod("GET", new apigateway.LambdaIntegration(getEventBySlugFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    eventByIdResource.addMethod("GET", new apigateway.LambdaIntegration(getEventFn));
    eventByIdResource.addMethod("PATCH", new apigateway.LambdaIntegration(updateEventFn), {
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
    genreVotesResource.addMethod("POST", new apigateway.LambdaIntegration(submitGenreVoteFn));
    resetGenreVotesResource.addMethod("POST", new apigateway.LambdaIntegration(resetGenreVotesFn), {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    paypalOrderResource.addMethod("POST", new apigateway.LambdaIntegration(createPaypalOrderFn));
    paypalCaptureResource.addMethod("POST", new apigateway.LambdaIntegration(capturePaypalOrderFn));
    paypalWebhookResource.addMethod("POST", new apigateway.LambdaIntegration(paypalWebhookFn));

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
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, "BrandAssetsBucketName", { value: brandAssetsBucket.bucketName });
  }

  private websocketLambdaUri(functionArn: string) {
    return `arn:aws:apigateway:${this.region}:lambda:path/2015-03-31/functions/${functionArn}/invocations`;
  }
}
