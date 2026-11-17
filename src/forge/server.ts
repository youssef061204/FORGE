import { ForgeService } from "./service";
import { LocalStateStore } from "./store";
import { BedrockModelProvider, DemoModelProvider } from "./models";
import { IsolatedSandbox } from "./sandbox";
import { DynamoStateStore } from "./aws";
import { getConfig } from "./config";
import {
  BedrockEnvironmentModel,
  DevelopmentEnvironmentModel,
} from "./city-model";
import { GoogleConnection } from "./connectors";
const globalForge = globalThis as typeof globalThis & {
  forgeService?: ForgeService;
};
export function getService() {
  if (!globalForge.forgeService) {
    const config = getConfig();
    globalForge.forgeService = new ForgeService(
      config.STORE_PROVIDER === "dynamodb"
        ? new DynamoStateStore(config.DYNAMODB_TABLE!)
        : new LocalStateStore(),
      config.MODEL_PROVIDER === "bedrock"
        ? new BedrockModelProvider(config.BEDROCK_MODEL_ID!)
        : new DemoModelProvider(),
      new IsolatedSandbox(config.SANDBOX_PROVIDER),
      new GoogleConnection(),
      config.MODEL_PROVIDER === "bedrock"
        ? new BedrockEnvironmentModel(config.BEDROCK_MODEL_ID!)
        : new DevelopmentEnvironmentModel(),
    );
  }
  return globalForge.forgeService;
}
