import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  EventBridgeClient,
  PutEventsCommand,
} from "@aws-sdk/client-eventbridge";
import {
  CloudWatchLogsClient,
  PutLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { emptyState, stateSchema, type State } from "./records";
import type { StateStore } from "./store";
import type { ForgeEvent } from "./spec";
import { z } from "zod";
import { assertPaidActionAllowed } from "./cost-policy";

const region = () => process.env.AWS_REGION ?? "ca-central-1";
// Single-tenant prototype snapshot with optimistic concurrency. See AWS.md for sizing limits.
export class DynamoStateStore implements StateStore {
  private client: DynamoDBDocumentClient;
  constructor(
    private table: string,
    client?: DynamoDBDocumentClient,
  ) {
    assertPaidActionAllowed("Amazon DynamoDB state storage");
    this.client =
      client ??
      DynamoDBDocumentClient.from(new DynamoDBClient({ region: region() }));
  }
  private async load() {
    assertPaidActionAllowed("Amazon DynamoDB state storage");
    const response = await this.client.send(
      new GetCommand({
        TableName: this.table,
        Key: { pk: "FORGE#STATE" },
        ConsistentRead: true,
      }),
    );
    const item = response.Item;
    return {
      state: item
        ? stateSchema.parse(JSON.parse(z.string().parse(item.payload)))
        : emptyState(),
      revision: item ? z.number().parse(item.revision) : 0,
    };
  }
  async read() {
    return (await this.load()).state;
  }
  async transaction<T>(fn: (state: State) => Promise<T> | T): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { state, revision } = await this.load();
      const result = await fn(state);
      stateSchema.parse(state);
      const payload = JSON.stringify(state);
      if (Buffer.byteLength(payload) > 350000)
        throw new Error(
          "Prototype DynamoDB snapshot capacity reached; export and partition historical traces before continuing",
        );
      try {
        assertPaidActionAllowed("Amazon DynamoDB state storage");
        await this.client.send(
          new PutCommand({
            TableName: this.table,
            Item: { pk: "FORGE#STATE", revision: revision + 1, payload },
            ConditionExpression: revision
              ? "revision = :previous"
              : "attribute_not_exists(pk)",
            ...(revision
              ? { ExpressionAttributeValues: { ":previous": revision } }
              : {}),
          }),
        );
        return result;
      } catch (e) {
        if (
          !(e instanceof Error) ||
          e.name !== "ConditionalCheckFailedException" ||
          attempt === 3
        )
          throw e;
      }
    }
    throw new Error("Concurrent state modification; retry");
  }
}
export interface EventBus {
  publish(capabilityId: string, event: ForgeEvent): Promise<string>;
}
export class LocalEventBus implements EventBus {
  constructor(
    private dispatch: (
      id: string,
      event: ForgeEvent,
    ) => Promise<{ id: string }>,
  ) {}
  async publish(capabilityId: string, event: ForgeEvent) {
    return (await this.dispatch(capabilityId, event)).id;
  }
}
export class EventBridgeEventBus implements EventBus {
  private client: EventBridgeClient;
  constructor(
    private bus: string,
    client?: EventBridgeClient,
  ) {
    assertPaidActionAllowed("Amazon EventBridge event publishing");
    this.client = client ?? new EventBridgeClient({ region: region() });
  }
  async publish(capabilityId: string, event: ForgeEvent) {
    assertPaidActionAllowed("Amazon EventBridge event publishing");
    const response = await this.client.send(
      new PutEventsCommand({
        Entries: [
          {
            EventBusName: this.bus,
            Source: "forge.capabilities",
            DetailType: "CapabilityTrigger",
            Detail: JSON.stringify({ capabilityId, event }),
          },
        ],
      }),
    );
    if (response.FailedEntryCount || !response.Entries?.[0]?.EventId)
      throw new Error(
        `EventBridge rejected event: ${response.Entries?.[0]?.ErrorCode ?? "unknown"}`,
      );
    return response.Entries[0].EventId;
  }
}
export interface AuditSink {
  write(action: string, details: Record<string, unknown>): Promise<void>;
}
export class CloudWatchAuditSink implements AuditSink {
  private client: CloudWatchLogsClient;
  constructor(
    private group: string,
    client?: CloudWatchLogsClient,
  ) {
    assertPaidActionAllowed("Amazon CloudWatch audit export");
    this.client = client ?? new CloudWatchLogsClient({ region: region() });
  }
  async write(action: string, details: Record<string, unknown>) {
    assertPaidActionAllowed("Amazon CloudWatch audit export");
    await this.client.send(
      new PutLogEventsCommand({
        logGroupName: this.group,
        logStreamName: "forge",
        logEvents: [
          {
            timestamp: Date.now(),
            message: JSON.stringify({ action, ...details }),
          },
        ],
      }),
    );
  }
}
