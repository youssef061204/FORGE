import { z } from "zod";

const id = z.string().min(1).max(64);
const point = {
  x: z.number().min(0).max(2400),
  y: z.number().min(0).max(1800),
};
export const hazardKinds = [
  "flood",
  "wildfire",
  "earthquake",
  "tornado",
  "blackout",
  "storm",
  "gas",
  "traffic",
] as const;
export const cityPermissions = [
  "city.read",
  "city.roads",
  "city.signals",
  "city.vehicles",
  "city.population",
  "city.shelters",
  "city.grid",
  "city.buildings",
  "city.alerts",
] as const;
export const cityActionNames = [
  "road.close",
  "road.open",
  "signal.set",
  "vehicle.route",
  "vehicle.dispatch",
  "population.route",
  "shelter.activate",
  "grid.allocate",
  "grid.shed",
  "building.mode",
  "alert.broadcast",
] as const;
export const cityActionPermissions = {
  "road.close": "city.roads",
  "road.open": "city.roads",
  "signal.set": "city.signals",
  "vehicle.route": "city.vehicles",
  "vehicle.dispatch": "city.vehicles",
  "population.route": "city.population",
  "shelter.activate": "city.shelters",
  "grid.allocate": "city.grid",
  "grid.shed": "city.grid",
  "building.mode": "city.buildings",
  "alert.broadcast": "city.alerts",
} as const;
export const cityActionSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("road.close"), roadId: id }).strict(),
  z.object({ operation: z.literal("road.open"), roadId: id }).strict(),
  z
    .object({
      operation: z.literal("signal.set"),
      nodeId: id,
      phase: z.enum(["ns", "ew", "emergency"]),
      seconds: z.number().min(5).max(90),
    })
    .strict(),
  z
    .object({
      operation: z.literal("vehicle.route"),
      vehicleId: id,
      path: z.array(id).min(2).max(40),
    })
    .strict(),
  z
    .object({
      operation: z.literal("vehicle.dispatch"),
      vehicleId: id,
      destination: id,
    })
    .strict(),
  z
    .object({
      operation: z.literal("population.route"),
      pedestrianId: id,
      shelterId: id,
    })
    .strict(),
  z
    .object({ operation: z.literal("shelter.activate"), buildingId: id })
    .strict(),
  z
    .object({
      operation: z.literal("grid.allocate"),
      buildingId: id,
      power: z.number().min(0).max(1),
    })
    .strict(),
  z
    .object({
      operation: z.literal("grid.shed"),
      buildingId: id,
      power: z.number().min(0).max(1),
    })
    .strict(),
  z
    .object({
      operation: z.literal("building.mode"),
      buildingId: id,
      mode: z.enum(["normal", "emergency", "closed"]),
    })
    .strict(),
  z
    .object({
      operation: z.literal("alert.broadcast"),
      message: z.string().min(1).max(160),
    })
    .strict(),
]);
export type CityAction = z.infer<typeof cityActionSchema>;
export const metricsSchema = z.object({
  exposedPeople: z.number(),
  evacuationSeconds: z.number(),
  congestion: z.number(),
  hospitalPower: z.number(),
  gridLoad: z.number(),
  responseSeconds: z.number(),
  energyDemand: z.number(),
  evacuatedPeople: z.number(),
  shelterOccupancy: z.number(),
});
export type CityMetrics = z.infer<typeof metricsSchema>;
export const metricNames = [
  "exposedPeople",
  "evacuationSeconds",
  "congestion",
  "hospitalPower",
  "gridLoad",
  "responseSeconds",
  "energyDemand",
  "evacuatedPeople",
  "shelterOccupancy",
] as const;
export const goalContractSchema = z
  .object({
    goal: z.string().min(5).max(2000),
    hard: z
      .array(
        z
          .object({
            metric: z.enum(metricNames),
            operator: z.enum(["lte", "gte"]),
            value: z.number().min(0).max(100000),
          })
          .strict(),
      )
      .max(12),
    objectives: z
      .array(
        z
          .object({
            metric: z.enum(metricNames),
            direction: z.enum(["minimize", "maximize"]),
            weight: z.number().positive().max(10),
          })
          .strict(),
      )
      .min(1)
      .max(9),
    actions: z
      .array(z.enum(cityActionNames))
      .min(1)
      .max(11)
      .refine(
        (a) => new Set(a).size === a.length,
        "Duplicate requested actuator",
      ),
    forbiddenOutcomes: z.array(z.string().max(160)).max(12),
    priorities: z.array(z.string().max(100)).max(8),
    interpretation: z.string().min(1).max(1000),
  })
  .strict();
export type GoalContract = z.infer<typeof goalContractSchema>;
export const nodeStateSchema = z.object({
  id,
  ...point,
  signal: z.enum(["ns", "ew", "emergency"]),
  signalSeconds: z.number(),
  signalRemaining: z.number(),
  powered: z.boolean().optional(),
});
export const roadSchema = z.object({
  id,
  from: id,
  to: id,
  length: z.number(),
  capacity: z.number().positive(),
  baseCapacity: z.number().positive().optional(),
  closed: z.boolean(),
  manualClosed: z.boolean(),
  bridge: z.boolean(),
  risk: z.number().min(0).max(1),
  floodDepth: z.number().min(0),
  smoke: z.number().min(0).max(1),
  damage: z.number().min(0).max(1),
  load: z.number().min(0),
});
export const buildingSchema = z.object({
  id,
  name: z.string(),
  kind: z.enum([
    "home",
    "office",
    "hospital",
    "fire",
    "police",
    "shelter",
    "school",
    "substation",
    "plant",
    "industrial",
    "transit",
    "foundry",
  ]),
  ...point,
  w: z.number(),
  h: z.number(),
  node: id,
  power: z.number().min(0).max(1),
  demand: z.number().positive(),
  damage: z.number().min(0).max(1),
  mode: z.enum(["normal", "emergency", "closed"]),
  critical: z.boolean(),
  capacity: z.number().int().min(0),
  occupancy: z.number().int().min(0),
  generator: z.boolean(),
  generatorActive: z.boolean().optional(),
  requestedPower: z.number().min(0).max(1).optional(),
  emergencyLoad: z.number().min(0).max(1).optional(),
  bedLoad: z.number().min(0).max(1).optional(),
});
export const vehicleSchema = z.object({
  id,
  kind: z.enum(["car", "bus", "ambulance", "fire", "police"]),
  path: z.array(id).max(50),
  progress: z.number().min(0).max(1),
  speed: z.number().positive(),
  wait: z.number().min(0),
  destination: id,
  dispatchAt: z.number().nullable(),
  responseSeconds: z.number().nullable(),
  ...point,
});
export const pedestrianSchema = z.object({
  id,
  path: z.array(id).max(50),
  progress: z.number().min(0).max(1),
  speed: z.number().positive(),
  destination: id,
  shelterId: id.nullable(),
  evacuated: z.boolean(),
  exposureSeconds: z.number().min(0),
  ...point,
});
export const hazardSchema = z.object({
  id,
  kind: z.enum(hazardKinds),
  ...point,
  radius: z.number().min(20).max(650),
  intensity: z.number().min(0).max(1),
  age: z.number().min(0),
  active: z.boolean(),
});
export const playerSchema = z.object({
  x: z.number().min(0).max(2240),
  y: z.number().min(0).max(1600),
  vx: z.number().min(-260).max(260),
  vy: z.number().min(-260).max(260),
  facing: z.enum(["up", "down", "left", "right"]),
  moving: z.boolean(),
  sprint: z.boolean(),
  sequence: z.number().int().min(0),
});
export type CityPlayer = z.infer<typeof playerSchema>;
export const playerInputSchema = z
  .object({
    dx: z.number().min(-1).max(1),
    dy: z.number().min(-1).max(1),
    sprint: z.boolean(),
    sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    elapsedMs: z.number().min(0).max(200),
  })
  .strict();
export type PlayerInput = z.infer<typeof playerInputSchema>;
export const terrainSchema = z.object({
  cellSize: z.literal(80),
  cols: z.literal(28),
  rows: z.literal(20),
  cells: z
    .array(
      z.object({
        elevation: z.number().min(0).max(1),
        fuel: z.number().min(0).max(1),
        water: z.number().min(0).max(3),
        fire: z.number().min(0).max(1),
        smoke: z.number().min(0).max(1),
        gas: z.number().min(0).max(1),
        damage: z.number().min(0).max(1),
      }),
    )
    .length(560),
});
export const gridNodeSchema = z.object({
  id,
  buildingId: id,
  parent: id.nullable(),
  capacity: z.number().positive(),
  load: z.number().min(0),
  voltage: z.number().min(0).max(1),
  failed: z.boolean(),
  overloadSeconds: z.number().min(0),
});
export const citySchema = z.object({
  id,
  name: z.string(),
  map: z
    .object({
      source: z.literal("OpenStreetMap"),
      sourceHash: z.string().length(64),
      attribution: z.string(),
      bounds: z.array(z.number()).length(4),
      simulatedConditions: z.literal(true),
    })
    .optional(),
  label: z.literal("DIGITAL TWIN"),
  width: z.literal(2240),
  height: z.literal(1600),
  revision: z.number().int().min(0),
  seed: z.number().int().min(0).max(4294967295),
  seconds: z.number().min(0),
  clockMinutes: z.number().min(0).max(1440),
  paused: z.boolean(),
  player: playerSchema.optional(),
  terrain: terrainSchema.optional(),
  gridNodes: z.array(gridNodeSchema).max(90).optional(),
  nodes: z.array(nodeStateSchema).max(64),
  roads: z.array(roadSchema).max(160),
  buildings: z.array(buildingSchema).max(90),
  vehicles: z.array(vehicleSchema).max(120),
  pedestrians: z.array(pedestrianSchema).max(120),
  hazards: z.array(hazardSchema).max(16),
  weather: z.object({
    rain: z.number().min(0).max(1),
    wind: z.number().min(0).max(1),
    direction: z.number(),
    cloud: z.number().min(0).max(1),
  }),
  grid: z.object({
    capacity: z.number().positive(),
    available: z.number().min(0),
    baselineDemand: z.number().positive(),
  }),
  metrics: metricsSchema,
  events: z
    .array(
      z.object({
        id,
        at: z.number(),
        text: z.string().max(300),
        origin: z.enum(["simulation", "human", "capability"]),
        capabilityId: id.optional(),
        digest: z.string().optional(),
        operation: z.string().optional(),
      }),
    )
    .max(80),
  observations: z
    .array(
      z.object({
        id,
        trust: z.enum(["trusted", "untrusted"]),
        text: z.string().max(500),
      }),
    )
    .max(12),
  deployment: z
    .object({
      id,
      version: z.string(),
      digest: z.string(),
      binding: id,
      nextAt: z.number(),
      baselineRevision: z.number(),
      degraded: z.boolean(),
      degradation: z.string(),
      approvedAt: z.iso.datetime(),
    })
    .optional(),
});
export type City = z.infer<typeof citySchema>;
export const cityInputSchema = z
  .object({ environment: citySchema, goal: goalContractSchema })
  .strict();
export const cityOutputSchema = z
  .object({
    actions: z.array(cityActionSchema).max(48),
    assumptions: z.array(z.string().max(160)).max(8).optional(),
  })
  .strict();
export type CityInput = z.infer<typeof cityInputSchema>;
export const simulationControlSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("hazard.create"),
      kind: z.enum(hazardKinds),
      ...point,
      intensity: z.number().min(0.1).max(1),
      radius: z.number().min(30).max(450),
    })
    .strict(),
  z.object({ operation: z.literal("road.toggle"), roadId: id }).strict(),
  z
    .object({
      operation: z.literal("building.damage"),
      buildingId: id,
      damage: z.number().min(0).max(1),
    })
    .strict(),
  z
    .object({
      operation: z.literal("weather.set"),
      rain: z.number().min(0).max(1),
      wind: z.number().min(0).max(1),
    })
    .strict(),
  z
    .object({
      operation: z.literal("traffic.add"),
      count: z.number().int().min(1).max(25),
    })
    .strict(),
  z.object({ operation: z.literal("pause"), paused: z.boolean() }).strict(),
  z
    .object({
      operation: z.literal("sensor.inject"),
      text: z.string().min(1).max(500),
    })
    .strict(),
]);
export type SimulationControl = z.infer<typeof simulationControlSchema>;
const frameSchema = z.object({
  seed: z.number().optional(),
  nodes: z.array(nodeStateSchema).max(64).optional(),
  roads: z
    .array(
      z.object({ id, closed: z.boolean(), risk: z.number(), load: z.number() }),
    )
    .max(160)
    .optional(),
  buildings: z
    .array(
      z.object({
        id,
        power: z.number(),
        damage: z.number(),
        mode: buildingSchema.shape.mode,
        occupancy: z.number(),
      }),
    )
    .max(90)
    .optional(),
  weather: citySchema.shape.weather.optional(),
  clockMinutes: z.number().optional(),
  terrain: terrainSchema.optional(),
  seconds: z.number(),
  metrics: metricsSchema,
  vehicles: z
    .array(
      z.object({
        id,
        kind: vehicleSchema.shape.kind,
        x: z.number(),
        y: z.number(),
      }),
    )
    .max(18),
  pedestrians: z
    .array(
      z.object({ id, x: z.number(), y: z.number(), evacuated: z.boolean() }),
    )
    .max(18),
  hazards: z.array(hazardSchema).max(16),
});
export type FutureFrame = z.infer<typeof frameSchema>;
export const rolloutSchema = z.object({
  seed: z.number(),
  metrics: metricsSchema,
  score: z.number(),
  violations: z.array(z.string()).max(40),
  durationMs: z.number(),
  error: z.string().optional(),
});
export const candidateSchema = z.object({
  id,
  name: z.string().max(100),
  source: z.string().min(20).max(16000),
  hash: z.string(),
  algorithmHash: z.string().optional(),
  provider: z.string(),
  model: z.string(),
  requestIds: z.array(z.string()),
  durationMs: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  permissions: z.array(z.enum(cityPermissions)),
  status: z.enum([
    "generated",
    "testing",
    "compile_failed",
    "sandbox_failed",
    "unsafe",
    "eligible",
    "winner",
    "duplicate",
    "dominated",
  ]),
  checks: z
    .array(
      z.object({
        name: z.string(),
        passed: z.boolean(),
        details: z.string().max(600),
      }),
    )
    .max(12),
  attempts: z
    .array(
      z.object({
        attempt: z.number(),
        hash: z.string(),
        failure: z.string().max(600).optional(),
      }),
    )
    .max(2),
  rollouts: z.array(rolloutSchema).max(40),
  screening: z
    .object({
      predictedUnsafe: z.number().min(0).max(1).optional(),
      predictedUncertainty: z.number().min(0).max(1).optional(),
      predictedLoss: z.number().optional(),
      behavior: z.array(z.number()).max(20).optional(),
      cluster: z.number().int().optional(),
      allocation: z.string().max(300),
    })
    .optional(),
  frames: z.array(frameSchema).max(12),
  summary: z
    .object({
      mean: z.number(),
      median: z.number(),
      p95: z.number(),
      worst: z.number(),
      failureRate: z.number(),
      constraintViolations: z.number(),
      metricsMean: metricsSchema,
    })
    .optional(),
});
export type Candidate = z.infer<typeof candidateSchema>;
export const cityContestSchema = z.object({
  id,
  request: z.string().max(4000),
  at: z.iso.datetime(),
  status: z.enum([
    "observing",
    "generating",
    "testing",
    "futures",
    "review",
    "installed",
    "failed",
    "reused",
  ]),
  interpretation: z.string(),
  goal: goalContractSchema.optional(),
  snapshotHash: z.string(),
  environmentId: id,
  resolution: z.enum(["EXACT_MATCH", "COMPOSE", "EXTEND", "SYNTHESIZE"]),
  previousId: id.optional(),
  reuseIds: z.array(id).max(4).optional(),
  candidates: z.array(candidateSchema).max(4),
  seeds: z.array(z.number()).max(40),
  baseline: z.array(rolloutSchema).max(40),
  winner: id.optional(),
  releaseDigest: z.string().optional(),
  error: z.string().max(1000).optional(),
  stages: z
    .array(z.object({ name: z.string(), at: z.iso.datetime() }))
    .max(100),
  providerEvidence: z
    .array(
      z.object({
        provider: z.string(),
        model: z.string(),
        region: z.string(),
        profile: z.string(),
        requestIds: z.array(z.string()),
        durationMs: z.number(),
        inputTokens: z.number(),
        outputTokens: z.number(),
        schemaValid: z.boolean(),
      }),
    )
    .max(2)
    .optional(),
});
export type CityContest = z.infer<typeof cityContestSchema>;
