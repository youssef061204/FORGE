import { z } from "zod";

export const livePermissions = [
  "gmail.read",
  "calendar.read",
  "calendar.write",
  "notification.emit",
] as const;
export const liveOperations = [
  "gmail.search",
  "calendar.list",
  "executable.run",
  "calendar.update",
  "calendar.create",
  "notification.emit",
] as const;
export const liveOperationPermissions = {
  "gmail.search": "gmail.read",
  "calendar.list": "calendar.read",
  "calendar.update": "calendar.write",
  "calendar.create": "calendar.write",
  "notification.emit": "notification.emit",
} as const;
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Invalid date",
  );
export const mailSchema = z
  .object({
    id: z.string().max(100),
    at: z.iso.datetime(),
    from: z.string().max(300),
    subject: z.string().max(300),
    body: z.string().max(10000),
  })
  .strict();
export const calendarEventSchema = z
  .object({
    id: z.string().max(200),
    title: z.string().max(300),
    date,
    allDay: z.boolean().optional(),
    etag: z.string().optional(),
  })
  .strict();
export const historySchema = z
  .object({
    from: date,
    to: date,
    emails: z.array(mailSchema).max(250),
    events: z.array(calendarEventSchema).max(250),
  })
  .strict();
export type History = z.infer<typeof historySchema>;
export const moduleInputSchema = z
  .object({
    email: mailSchema,
    events: z.array(calendarEventSchema).max(250),
    trustedSenders: z.array(z.string().max(300)).max(20),
  })
  .strict();
export const moduleOutputSchema = z
  .object({
    change: z
      .object({
        eventId: z.string().max(200).nullable(),
        title: z.string().min(1).max(200),
        date,
      })
      .strict()
      .nullable(),
    notify: z.boolean(),
  })
  .strict();
export const executableSchema = z
  .object({
    interface: z.enum(["deadline/v1", "city/v1"]),
    language: z.literal("typescript"),
    source: z.string().min(20).max(16000),
  })
  .strict();
export const trustSchema = z.object({
  digest: z.string(),
  current: z.enum([
    "GENERATED",
    "SECURITY_VERIFIED",
    "REPLAYED",
    "HUMAN_APPROVED",
    "SHADOW",
    "LIVE",
    "REVOKED",
    "UNTRUSTED",
  ]),
  stages: z.array(z.object({ stage: z.string(), at: z.string() })),
  grants: z.array(z.enum(livePermissions)),
  connector: z.enum(["fixture", "google"]).optional(),
  binding: z.string().optional(),
  replayId: z.string().optional(),
  imported: z.boolean().default(false),
});
export const proposedEffectSchema = z.object({
  operation: z.enum([
    "calendar.create",
    "calendar.update",
    "notification.emit",
  ]),
  emailRef: z.string(),
  title: z.string().max(300),
  date: date.optional(),
  eventRef: z.string().optional(),
  disposition: z.enum(["PROPOSED", "COMMITTED", "DEDUPLICATED"]),
  externalId: z.string().optional(),
  link: z.string().optional(),
});
export const replaySchema = z.object({
  id: z.string(),
  digest: z.string(),
  mode: z.enum(["REPLAY", "SHADOW", "LIVE"]),
  connector: z.enum(["fixture", "google"]),
  binding: z.string(),
  at: z.string(),
  from: date,
  to: date,
  emailsInspected: z.number(),
  calendarEventsEvaluated: z.number(),
  detectedChanges: z.number(),
  externalWrites: z.number(),
  blockedActions: z.number(),
  passed: z.boolean(),
  effects: z.array(proposedEffectSchema),
  timeline: z.array(
    z.object({
      at: z.string(),
      emailRef: z.string(),
      label: z.string(),
      status: z.enum(["ignored", "changed", "failed"]),
      effectIndexes: z.array(z.number()),
      executionId: z.string(),
    }),
  ),
  evaluation: z
    .object({
      labeled: z.literal(true),
      cases: z.number(),
      exactMatches: z.number(),
      precision: z.number().nullable(),
      recall: z.number().nullable(),
    })
    .optional(),
});
export type Replay = z.infer<typeof replaySchema>;
export type ProposedEffect = z.infer<typeof proposedEffectSchema>;
export const liveStateSchema = z.object({
  paused: z.boolean().default(false),
  trust: z.record(z.string(), trustSchema),
  processed: z.record(z.string(), z.string()).default({}),
  replays: z.array(replaySchema),
  schedules: z.record(
    z.string(),
    z.object({
      digest: z.string(),
      connector: z.enum(["fixture", "google"]),
      binding: z.string(),
      everySeconds: z.number().int().min(60).max(86400),
      enabled: z.boolean(),
      nextAt: z.string(),
      lastRun: z.string().optional(),
      lastError: z.string().optional(),
    }),
  ),
});
export const emptyLive = () => ({
  paused: false,
  trust: {},
  processed: {},
  replays: [],
  schedules: {},
});
