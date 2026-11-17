/**
 * The closed list of capabilities FORGE knows about. Some are connected, some
 * are known but not available. Routing uses this list so FORGE can say
 * precisely "I can't send email yet" instead of writing a file and pretending.
 */
export const CAPABILITIES = {
  "file.read": { label: "Read the files you choose", connected: true },
  "file.write": { label: "Save output files", connected: true },
  "view.show": { label: "Show a chart or table", connected: true },
  "notify.local": { label: "Show a notification on this computer", connected: true },
  "email.send": { label: "Send email", connected: false },
  "email.read": { label: "Read your email", connected: false },
  "calendar.create": { label: "Create calendar events", connected: false },
  "calendar.read": { label: "Read your calendar", connected: false },
  "web.fetch": { label: "Fetch pages or data from the internet", connected: false },
  "chat.post": { label: "Post to a chat app such as Slack", connected: false },
  "sms.send": { label: "Send text messages", connected: false },
  "sheet.write": { label: "Edit an online spreadsheet", connected: false },
  "drive.upload": { label: "Upload to cloud storage", connected: false },
  "payment.send": { label: "Move money", connected: false },
} as const;

export type CapabilityId = keyof typeof CAPABILITIES;
export const CAPABILITY_IDS = Object.keys(CAPABILITIES) as CapabilityId[];

export function isConnected(id: CapabilityId, enabled: Partial<Record<CapabilityId, boolean>> = {}) {
  return enabled[id] ?? CAPABILITIES[id].connected;
}
