import { describe, expect, it } from "vitest";
import { mentionedFiles, namedColumns, templateKeys } from "../../src/core/verify/properties";
import { lexicalNeeds, decideRoute } from "../../src/core/synth/route";

describe("request cues", () => {
  it("reads explicit column lists without running into the next clause", () => {
    expect(namedColumns("Save clean.csv with columns name,email, retaining the first name.")?.columns).toEqual(["name", "email"]);
    expect(namedColumns("save reorder.csv with columns sku,quantity. For every row")?.columns).toEqual(["sku", "quantity"]);
    expect(namedColumns("with columns city, total and share.")?.columns).toEqual(["city", "total", "share"]);
    expect(namedColumns("with the same columns, keeping only rows")).toBeUndefined();
    expect(namedColumns("Sort by columns status and priority")).toBeUndefined();
    expect(namedColumns("Output columns: id, total")?.columns).toEqual(["id", "total"]);
  });
  it("reads JSON templates and file names", () => {
    expect(templateKeys('Save out.json as exactly {"total": number, "count": number}.')?.keys).toEqual(["total", "count"]);
    expect(mentionedFiles("Read a.csv and b.json, then save c.txt")).toEqual(["a.csv", "b.json", "c.txt"]);
  });
  it("routes unconnected actions to CONNECT and ignores prohibitions", () => {
    expect(lexicalNeeds("Send recipients.csv as an email attachment to manager@example.test")).toContain("email.send");
    expect(lexicalNeeds("Create the appointment on my Google Calendar")).toContain("calendar.create");
    expect(lexicalNeeds("Extract lines. Do not send messages or use another service.")).toEqual([]);
    expect(lexicalNeeds("Sort the email column of contacts.csv")).toEqual([]);
    const d = decideRoute({ request: "Total expenses by category", modelNeeds: ["sheet.write"], feasible: true, missing: "", files: 1 });
    expect(d.route).toBe("SYNTHESIZE");
  });
});
