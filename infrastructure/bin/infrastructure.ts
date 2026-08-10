#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { InfrastructureStack } from "../lib/infrastructure-stack";

const app = new cdk.App();
const deploymentStage = process.env.DEPLOY_STAGE?.trim() || "prod";
const stackId = deploymentStage === "prod"
  ? "InfrastructureStack"
  : `InfrastructureStack${deploymentStage[0].toUpperCase()}${deploymentStage.slice(1)}`;
new InfrastructureStack(app, stackId, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
});
