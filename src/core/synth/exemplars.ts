/**
 * Hand-written, test-verified recipes covering the operator space. The three
 * most similar are shown to the model as examples. None is derived from an
 * evaluation corpus (tests/core/exemplars.test.ts enforces dissimilarity).
 */
import type { Recipe } from "../recipe/schema";

export type Exemplar = {
  id: string;
  request: string;
  files: Record<string, { name: string; text: string }>;
  recipe: Recipe;
  /** Expected text of the first output file, checked by tests. */
  expect: string;
  source?: "builtin" | "learned";
};

const csv = (slot: string, name: string, text: string) => ({ [slot]: { name, text } });

export const EXEMPLARS: Exemplar[] = [
  {
    id: "books-unread",
    request: "From books.csv, list the titles I haven't read yet as unread.csv with title and author.",
    files: csv("books", "books.csv", "title,author,pages,read\nDune,Herbert,612,yes\nEmma,Austen,474,no\nBeloved,Morrison,324,no\n"),
    recipe: {
      inputs: [{ slot: "books", format: "csv" }],
      steps: [
        { op: "filter", where: "not bool(read)" },
        { op: "select", columns: ["title", "author"] },
      ],
      outputs: [{ kind: "file", name: "unread.csv", format: "csv" }],
    },
    expect: "title,author\nEmma,Austen\nBeloved,Morrison\n",
  },
  {
    id: "rainfall-by-city",
    request: "Total the rainfall per city from readings.csv and save rain.json mapping each city to its total millimetres.",
    files: csv("readings", "readings.csv", "city,day,rain_mm\nOslo,1,2.5\nLima,1,0\nOslo,2,4\nLima,2,1.25\n"),
    recipe: {
      inputs: [{ slot: "readings", format: "csv" }],
      steps: [{ op: "summarize", by: ["city"], set: { total: "sum(num(rain_mm))" } }],
      outputs: [{ kind: "file", name: "rain.json", format: "json", shape: { map: { key: "city", value: "total" } } }],
    },
    expect: '{\n  "Oslo": 6.5,\n  "Lima": 1.25\n}\n',
  },
  {
    id: "workouts-longest",
    request: "Sort workouts.csv by minutes, longest first, and keep the top 2 as top-workouts.csv.",
    files: csv("workouts", "workouts.csv", "date,kind,minutes\n2026-03-01,run,30\n2026-03-02,swim,45\n2026-03-03,bike,9\n"),
    recipe: {
      inputs: [{ slot: "workouts", format: "csv" }],
      steps: [
        { op: "sort", by: ["num(minutes) desc"] },
        { op: "limit", n: 2 },
      ],
      outputs: [{ kind: "file", name: "top-workouts.csv", format: "csv" }],
    },
    expect: "date,kind,minutes\n2026-03-02,swim,45\n2026-03-01,run,30\n",
  },
  {
    id: "grades-average",
    request: "Average each student's score in grades.csv, rounded to one decimal, and save averages.csv with student and average, highest first.",
    files: csv("grades", "grades.csv", "student,subject,score\nAri,math,90\nBo,math,72\nAri,art,85\nBo,art,80\n"),
    recipe: {
      inputs: [{ slot: "grades", format: "csv" }],
      steps: [
        { op: "summarize", by: ["student"], set: { average: "round(mean(num(score)), 1)" } },
        { op: "sort", by: ["average desc"] },
      ],
      outputs: [{ kind: "file", name: "averages.csv", format: "csv" }],
    },
    expect: "student,average\nAri,87.5\nBo,76\n",
  },
  {
    id: "flights-delay-flag",
    request: "Add a late column to flights.csv that is yes when the delay is over 15 minutes, otherwise no. Save flights-flagged.csv.",
    files: csv("flights", "flights.csv", "flight,delay_min\nAC12,5\nWS7,40\nTS3,16\n"),
    recipe: {
      inputs: [{ slot: "flights", format: "csv" }],
      steps: [{ op: "derive", set: { late: "if(num(delay_min) > 15, 'yes', 'no')" } }],
      outputs: [{ kind: "file", name: "flights-flagged.csv", format: "csv" }],
    },
    expect: "flight,delay_min,late\nAC12,5,no\nWS7,40,yes\nTS3,16,yes\n",
  },
  {
    id: "shipments-join-carriers",
    request: "Attach each shipment's carrier name from carriers.csv using carrier_id, and save shipments-named.csv with id, destination and carrier.",
    files: {
      ...csv("shipments", "shipments.csv", "id,destination,carrier_id\nS1,Rome,C2\nS2,Kyiv,C1\nS3,Bern,C9\n"),
      ...csv("carriers", "carriers.csv", "carrier_id,carrier\nC1,Polar Post\nC2,Swift Line\n"),
    },
    recipe: {
      inputs: [
        { slot: "shipments", format: "csv" },
        { slot: "carriers", format: "csv" },
      ],
      steps: [
        { op: "join", with: "carriers", on: ["carrier_id"], kind: "left" },
        { op: "select", columns: ["id", "destination", "carrier"] },
      ],
      outputs: [{ kind: "file", name: "shipments-named.csv", format: "csv" }],
    },
    expect: "id,destination,carrier\nS1,Rome,Swift Line\nS2,Kyiv,Polar Post\nS3,Bern,\n",
  },
  {
    id: "members-without-visits",
    request: "Which members in members.csv have no visit in visits.csv? Save inactive.csv with their names.",
    files: {
      ...csv("members", "members.csv", "member_id,name\nM1,Ola\nM2,Tariq\nM3,Ines\n"),
      ...csv("visits", "visits.csv", "member_id,date\nM2,2026-05-01\nM2,2026-05-03\n"),
    },
    recipe: {
      inputs: [
        { slot: "members", format: "csv" },
        { slot: "visits", format: "csv" },
      ],
      steps: [
        { op: "join", with: "visits", on: ["member_id"], kind: "anti" },
        { op: "select", columns: ["name"] },
      ],
      outputs: [{ kind: "file", name: "inactive.csv", format: "csv" }],
    },
    expect: "name\nOla\nInes\n",
  },
  {
    id: "log-errors",
    request: "Pull every ERROR line out of server.log with its timestamp and message, and save errors.csv.",
    files: csv(
      "log",
      "server.log",
      "2026-04-01T10:00:01 INFO started\n2026-04-01T10:00:05 ERROR disk full\n2026-04-01T10:01:00 WARN slow\n2026-04-01T10:02:13 ERROR timeout on /api\n",
    ),
    recipe: {
      inputs: [{ slot: "log", format: "text" }],
      steps: [
        { op: "match", column: "line", pattern: "^(?<time>\\S+) ERROR (?<message>.*)$" },
        { op: "select", columns: ["time", "message"] },
      ],
      outputs: [{ kind: "file", name: "errors.csv", format: "csv" }],
    },
    expect: "time,message\n2026-04-01T10:00:05,disk full\n2026-04-01T10:02:13,timeout on /api\n",
  },
  {
    id: "log-level-counts",
    request: "Count how many lines of app.log there are for each level (INFO, WARN, ERROR) and save levels.json.",
    files: csv("log", "app.log", "09:00 INFO boot\n09:01 WARN low memory\n09:02 INFO ready\n09:03 ERROR crash\n"),
    recipe: {
      inputs: [{ slot: "log", format: "text" }],
      steps: [
        { op: "match", column: "line", pattern: "^\\S+ (?<level>[A-Z]+) " },
        { op: "summarize", by: ["level"], set: { lines: "count()" } },
      ],
      outputs: [{ kind: "file", name: "levels.json", format: "json", shape: { map: { key: "level", value: "lines" } } }],
    },
    expect: '{\n  "INFO": 2,\n  "WARN": 1,\n  "ERROR": 1\n}\n',
  },
  {
    id: "recipes-ingredients-unnest",
    request: "From recipes.json, list every ingredient with its recipe name, one per row, as ingredients.csv.",
    files: csv(
      "recipes",
      "recipes.json",
      '{"recipes":[{"name":"Pesto","ingredients":["basil","pine nuts","oil"]},{"name":"Toast","ingredients":["bread"]}]}',
    ),
    recipe: {
      inputs: [{ slot: "recipes", format: "json", path: "recipes" }],
      steps: [
        { op: "unnest", column: "ingredients", into: "ingredient" },
        { op: "select", columns: ["name", "ingredient"] },
      ],
      outputs: [{ kind: "file", name: "ingredients.csv", format: "csv" }],
    },
    expect: "name,ingredient\nPesto,basil\nPesto,pine nuts\nPesto,oil\nToast,bread\n",
  },
  {
    id: "repos-nested-fields",
    request: "Turn repos.json into repos.csv with name, the owner's login and the star count.",
    files: csv(
      "repos",
      "repos.json",
      '[{"name":"tide","owner":{"login":"mara"},"stats":{"stars":120}},{"name":"loom","owner":{"login":"ken"},"stats":{"stars":8}}]',
    ),
    recipe: {
      inputs: [{ slot: "repos", format: "json" }],
      steps: [
        { op: "derive", set: { owner_login: "owner.login", stars: "stats.stars" } },
        { op: "select", columns: ["name", "owner_login", "stars"] },
      ],
      outputs: [{ kind: "file", name: "repos.csv", format: "csv" }],
    },
    expect: "name,owner_login,stars\ntide,mara,120\nloom,ken,8\n",
  },
  {
    id: "plants-due",
    request: "Which plants in plants.csv are due for water? A plant is due when days since last watering is at least its interval. Save due.txt with one plant name per line.",
    files: csv("plants", "plants.csv", "plant,interval_days,days_since\nfern,3,4\ncactus,14,2\nbasil,2,2\n"),
    recipe: {
      inputs: [{ slot: "plants", format: "csv" }],
      steps: [{ op: "filter", where: "num(days_since) >= num(interval_days)" }],
      outputs: [{ kind: "file", name: "due.txt", format: "text", shape: { values: "plant" } }],
    },
    expect: "fern\nbasil\n",
  },
  {
    id: "survey-share",
    request: "From answers.csv compute what percentage of respondents chose each option, rounded to whole numbers, saved as shares.csv.",
    files: csv("answers", "answers.csv", "respondent,choice\nr1,tea\nr2,coffee\nr3,tea\nr4,water\n"),
    recipe: {
      inputs: [{ slot: "answers", format: "csv" }],
      steps: [
        { op: "summarize", by: ["choice"], set: { votes: "count()" } },
        { op: "derive", set: { percent: "round(votes * 100 / sum(votes))" } },
        { op: "select", columns: ["choice", "percent"] },
      ],
      outputs: [{ kind: "file", name: "shares.csv", format: "csv" }],
    },
    expect: "choice,percent\ntea,50\ncoffee,25\nwater,25\n",
  },
  {
    id: "episodes-month",
    request: "Count podcast episodes per month (YYYY-MM) from episodes.csv and save per-month.csv in month order.",
    files: csv("episodes", "episodes.csv", "title,published\nPilot,2026-01-05\nTwo,2026-01-20\nThree,2026-02-02\n"),
    recipe: {
      inputs: [{ slot: "episodes", format: "csv" }],
      steps: [
        { op: "derive", set: { month: "month_key(published)" } },
        { op: "summarize", by: ["month"], set: { episodes: "count()" } },
        { op: "sort", by: ["month"] },
      ],
      outputs: [{ kind: "file", name: "per-month.csv", format: "csv" }],
    },
    expect: "month,episodes\n2026-01,2\n2026-02,1\n",
  },
  {
    id: "subscribers-dedupe-latest",
    request: "subscribers.csv has repeated phone numbers. Keep only the latest signup for each phone and save subscribers-unique.csv.",
    files: csv("subscribers", "subscribers.csv", "phone,plan,signed_up\n555-01,basic,2026-01-01\n555-02,pro,2026-01-03\n555-01,pro,2026-02-10\n"),
    recipe: {
      inputs: [{ slot: "subscribers", format: "csv" }],
      steps: [
        { op: "sort", by: ["signed_up"] },
        { op: "dedupe", by: ["phone"], keep: "last" },
      ],
      outputs: [{ kind: "file", name: "subscribers-unique.csv", format: "csv" }],
    },
    expect: "phone,plan,signed_up\n555-02,pro,2026-01-03\n555-01,pro,2026-02-10\n",
  },
  {
    id: "parking-fines-stat",
    request: "What is the total of all fines in fines.csv? Save total.json as {\"total\": number}.",
    files: csv("fines", "fines.csv", "plate,fine\nAB1,40\nCD2,25.5\nEF3,60\n"),
    recipe: {
      inputs: [{ slot: "fines", format: "csv" }],
      steps: [{ op: "summarize", set: { total: "sum(num(fine))" } }],
      outputs: [
        { kind: "file", name: "total.json", format: "json", shape: "row" },
        { kind: "view", type: "stat", y: "total", title: "Total fines" },
      ],
    },
    expect: '{\n  "total": 125.5\n}\n',
  },
  {
    id: "rename-columns",
    request: "Rename the columns of raw.csv: nm to name and qty to quantity, keep everything else. Save tidy.csv.",
    files: csv("raw", "raw.csv", "nm,qty,bin\nbolt,40,A1\nnut,12,A2\n"),
    recipe: {
      inputs: [{ slot: "raw", format: "csv" }],
      steps: [{ op: "rename", map: { nm: "name", qty: "quantity" } }],
      outputs: [{ kind: "file", name: "tidy.csv", format: "csv" }],
    },
    expect: "name,quantity,bin\nbolt,40,A1\nnut,12,A2\n",
  },
  {
    id: "drop-private",
    request: "Remove the ssn and dob columns from staff.csv and save staff-public.csv.",
    files: csv("staff", "staff.csv", "name,ssn,dob,team\nLee,111,1990-01-01,ops\nKim,222,1988-02-02,dev\n"),
    recipe: {
      inputs: [{ slot: "staff", format: "csv" }],
      steps: [{ op: "drop", columns: ["ssn", "dob"] }],
      outputs: [{ kind: "file", name: "staff-public.csv", format: "csv" }],
    },
    expect: "name,team\nLee,ops\nKim,dev\n",
  },
  {
    id: "names-title-case",
    request: "Clean guests.txt: trim each line, skip blank lines, write names in Title Case, sorted A to Z, into guests-clean.txt.",
    files: csv("guests", "guests.txt", "  ada lovelace\n\nGRACE HOPPER \nalan turing\n"),
    recipe: {
      inputs: [{ slot: "guests", format: "text" }],
      steps: [
        { op: "derive", set: { line: "title(trim(line))" } },
        { op: "filter", where: "line != ''" },
        { op: "sort", by: ["line"] },
      ],
      outputs: [{ kind: "file", name: "guests-clean.txt", format: "text", shape: { values: "line" } }],
    },
    expect: "Ada Lovelace\nAlan Turing\nGrace Hopper\n",
  },
  {
    id: "temps-convert",
    request: "Convert the celsius column in temps.csv to fahrenheit (one decimal) in a new column f. Save temps-f.csv.",
    files: csv("temps", "temps.csv", "station,celsius\nN1,21.5\nN2,-3\n"),
    recipe: {
      inputs: [{ slot: "temps", format: "csv" }],
      steps: [{ op: "derive", set: { f: "round(num(celsius) * 9 / 5 + 32, 1)" } }],
      outputs: [{ kind: "file", name: "temps-f.csv", format: "csv" }],
    },
    expect: "station,celsius,f\nN1,21.5,70.7\nN2,-3,26.6\n",
  },
  {
    id: "orders-split-email-domain",
    request: "From signups.csv, count signups per email domain (the part after @), lowercase, and save domains.json.",
    files: csv("signups", "signups.csv", "user,email\nu1,a@Mail.test\nu2,b@corp.test\nu3,c@mail.test\n"),
    recipe: {
      inputs: [{ slot: "signups", format: "csv" }],
      steps: [
        { op: "derive", set: { domain: "lower(split_part(email, '@', 2))" } },
        { op: "summarize", by: ["domain"], set: { signups: "count()" } },
      ],
      outputs: [{ kind: "file", name: "domains.json", format: "json", shape: { map: { key: "domain", value: "signups" } } }],
    },
    expect: '{\n  "mail.test": 2,\n  "corp.test": 1\n}\n',
  },
  {
    id: "rides-weekday",
    request: "Add the weekday name of each ride date in rides.csv and save rides-days.csv.",
    files: csv("rides", "rides.csv", "ride,date\nR1,2026-06-01\nR2,2026-06-06\n"),
    recipe: {
      inputs: [{ slot: "rides", format: "csv" }],
      steps: [{ op: "derive", set: { weekday: "weekday(date)" } }],
      outputs: [{ kind: "file", name: "rides-days.csv", format: "csv" }],
    },
    expect: "ride,date,weekday\nR1,2026-06-01,Monday\nR2,2026-06-06,Saturday\n",
  },
  {
    id: "loans-overdue-days",
    request: "For each loan in loans.csv compute days late as returned minus due (0 if on time). Save lateness.csv with loan and days_late.",
    files: csv("loans", "loans.csv", "loan,due,returned\nL1,2026-02-01,2026-02-05\nL2,2026-02-10,2026-02-08\n"),
    recipe: {
      inputs: [{ slot: "loans", format: "csv" }],
      steps: [
        { op: "derive", set: { days_late: "greatest(days_between(due, returned), 0)" } },
        { op: "select", columns: ["loan", "days_late"] },
      ],
      outputs: [{ kind: "file", name: "lateness.csv", format: "csv" }],
    },
    expect: "loan,days_late\nL1,4\nL2,0\n",
  },
  {
    id: "bugs-open-by-severity",
    request: "Count open bugs in bugs.csv by severity and show a bar chart. Also save severity.csv.",
    files: csv("bugs", "bugs.csv", "id,severity,state\nB1,high,open\nB2,low,closed\nB3,high,open\nB4,low,open\n"),
    recipe: {
      inputs: [{ slot: "bugs", format: "csv" }],
      steps: [
        { op: "filter", where: "state == 'open'" },
        { op: "summarize", by: ["severity"], set: { bugs: "count()" } },
      ],
      outputs: [
        { kind: "file", name: "severity.csv", format: "csv" },
        { kind: "view", type: "bar", x: "severity", y: "bugs" },
      ],
    },
    expect: "severity,bugs\nhigh,2\nlow,1\n",
  },
  {
    id: "hikes-min-max",
    request: "For each trail in hikes.csv find the shortest and longest time. Save trail-times.csv.",
    files: csv("hikes", "hikes.csv", "trail,minutes\nRidge,95\nLake,40\nRidge,80\nLake,55\n"),
    recipe: {
      inputs: [{ slot: "hikes", format: "csv" }],
      steps: [{ op: "summarize", by: ["trail"], set: { shortest: "min(num(minutes))", longest: "max(num(minutes))" } }],
      outputs: [{ kind: "file", name: "trail-times.csv", format: "csv" }],
    },
    expect: "trail,shortest,longest\nRidge,80,95\nLake,40,55\n",
  },
  {
    id: "readings-keyword-filter",
    request: "Keep only the comments in feedback.csv that mention 'refund' (any capitalization). Save refunds.csv.",
    files: csv("feedback", "feedback.csv", "id,comment\n1,Great service\n2,I want a Refund now\n3,refund please\n"),
    recipe: {
      inputs: [{ slot: "feedback", format: "csv" }],
      steps: [{ op: "filter", where: "icontains(comment, 'refund')" }],
      outputs: [{ kind: "file", name: "refunds.csv", format: "csv" }],
    },
    expect: "id,comment\n2,I want a Refund now\n3,refund please\n",
  },
  {
    id: "status-in-list",
    request: "From jobs.csv keep jobs whose state is queued or running, sorted by priority number ascending. Save active-jobs.csv.",
    files: csv("jobs", "jobs.csv", "job,state,priority\nj1,done,1\nj2,running,3\nj3,queued,2\n"),
    recipe: {
      inputs: [{ slot: "jobs", format: "csv" }],
      steps: [
        { op: "filter", where: "state in ['queued', 'running']" },
        { op: "sort", by: ["num(priority)"] },
      ],
      outputs: [{ kind: "file", name: "active-jobs.csv", format: "csv" }],
    },
    expect: "job,state,priority\nj3,queued,2\nj2,running,3\n",
  },
  {
    id: "concat-full-name",
    request: "Build a full_name column from first and last in people.tsv and save names.csv with only full_name.",
    files: csv("people", "people.tsv", "first\tlast\nMae\tJemison\nKatherine\tJohnson\n"),
    recipe: {
      inputs: [{ slot: "people", format: "tsv" }],
      steps: [
        { op: "derive", set: { full_name: "concat(first, ' ', last)" } },
        { op: "select", columns: ["full_name"] },
      ],
      outputs: [{ kind: "file", name: "names.csv", format: "csv" }],
    },
    expect: "full_name\nMae Jemison\nKatherine Johnson\n",
  },
  {
    id: "coalesce-missing",
    request: "In contacts-raw.csv, use the mobile number when present, otherwise the landline, as phone. Save phones.csv with name and phone.",
    files: csv("contacts", "contacts-raw.csv", "name,mobile,landline\nAvi,,555-100\nBea,555-200,555-300\n"),
    recipe: {
      inputs: [{ slot: "contacts", format: "csv" }],
      steps: [
        { op: "derive", set: { phone: "coalesce(mobile, landline)" } },
        { op: "select", columns: ["name", "phone"] },
      ],
      outputs: [{ kind: "file", name: "phones.csv", format: "csv" }],
    },
    expect: "name,phone\nAvi,555-100\nBea,555-200\n",
  },
  {
    id: "lines-from-json-field",
    request: "Each note in journal.json has a body with several lines. Save lines.csv with the note id and each non-empty line.",
    files: csv("journal", "journal.json", '[{"id":"n1","body":"woke early\\nran 5k"},{"id":"n2","body":"rest day\\n"}]'),
    recipe: {
      inputs: [{ slot: "journal", format: "json" }],
      steps: [
        { op: "lines", column: "body", into: "line" },
        { op: "filter", where: "trim(line) != ''" },
        { op: "select", columns: ["id", "line"] },
      ],
      outputs: [{ kind: "file", name: "lines.csv", format: "csv" }],
    },
    expect: "id,line\nn1,woke early\nn1,ran 5k\nn2,rest day\n",
  },
  {
    id: "union-two-months",
    request: "Stack march.csv and april.csv into one file all-sales.csv.",
    files: {
      ...csv("march", "march.csv", "day,amount\n03-01,10\n03-02,4\n"),
      ...csv("april", "april.csv", "day,amount\n04-01,7\n"),
    },
    recipe: {
      inputs: [
        { slot: "march", format: "csv" },
        { slot: "april", format: "csv" },
      ],
      steps: [{ op: "union", with: "april" }],
      outputs: [{ kind: "file", name: "all-sales.csv", format: "csv" }],
    },
    expect: "day,amount\n03-01,10\n03-02,4\n04-01,7\n",
  },
  {
    id: "distinct-values-list",
    request: "List the distinct countries in visitors.csv alphabetically as countries.json (a JSON array).",
    files: csv("visitors", "visitors.csv", "visitor,country\nv1,Peru\nv2,Chad\nv3,Peru\n"),
    recipe: {
      inputs: [{ slot: "visitors", format: "csv" }],
      steps: [
        { op: "dedupe", by: ["country"] },
        { op: "sort", by: ["country"] },
      ],
      outputs: [{ kind: "file", name: "countries.json", format: "json", shape: { values: "country" } }],
    },
    expect: '[\n  "Chad",\n  "Peru"\n]\n',
  },
  {
    id: "count-distinct-per-group",
    request: "For each class in enrollments.csv, how many different students are enrolled? Save class-sizes.csv.",
    files: csv("enrollments", "enrollments.csv", "class,student\nbio,s1\nbio,s2\nbio,s1\nchem,s3\n"),
    recipe: {
      inputs: [{ slot: "enrollments", format: "csv" }],
      steps: [{ op: "summarize", by: ["class"], set: { students: "count_distinct(student)" } }],
      outputs: [{ kind: "file", name: "class-sizes.csv", format: "csv" }],
    },
    expect: "class,students\nbio,2\nchem,1\n",
  },
  {
    id: "group-two-keys",
    request: "Sum hours by project and person in timesheet.csv, saved as hours.csv sorted by project then person.",
    files: csv("timesheet", "timesheet.csv", "project,person,hours\napollo,jo,3\napollo,al,2\napollo,jo,1.5\nzeus,al,4\n"),
    recipe: {
      inputs: [{ slot: "timesheet", format: "csv" }],
      steps: [
        { op: "summarize", by: ["project", "person"], set: { hours: "sum(num(hours))" } },
        { op: "sort", by: ["project", "person"] },
      ],
      outputs: [{ kind: "file", name: "hours.csv", format: "csv" }],
    },
    expect: "project,person,hours\napollo,al,2\napollo,jo,4.5\nzeus,al,4\n",
  },
  {
    id: "json-rows-output",
    request: "Convert cities.csv to cities.json as a list of objects with name and population as a number.",
    files: csv("cities", "cities.csv", "name,population\nQuito,2800000\nBergen,285000\n"),
    recipe: {
      inputs: [{ slot: "cities", format: "csv" }],
      steps: [{ op: "derive", set: { population: "num(population)" } }],
      outputs: [{ kind: "file", name: "cities.json", format: "json" }],
    },
    expect: '[\n  {\n    "name": "Quito",\n    "population": 2800000\n  },\n  {\n    "name": "Bergen",\n    "population": 285000\n  }\n]\n',
  },
  {
    id: "threshold-and-columns",
    request: "From sensors.csv keep readings above 80 degrees and save hot.csv with only sensor and value columns, in that order.",
    files: csv("sensors", "sensors.csv", "time,sensor,value\n1,s1,79.9\n2,s2,81\n3,s1,90\n"),
    recipe: {
      inputs: [{ slot: "sensors", format: "csv" }],
      steps: [{ op: "filter", where: "num(value) > 80" }],
      outputs: [{ kind: "file", name: "hot.csv", format: "csv", columns: ["sensor", "value"] }],
    },
    expect: "sensor,value\ns2,81\ns1,90\n",
  },
  {
    id: "extract-number-from-text",
    request: "listings.csv has prices like 'USD 1,250'. Extract the number into price and save prices.csv sorted by price high to low.",
    files: csv("listings", "listings.csv", 'item,label\ndesk,"USD 1,250"\nlamp,USD 40\n'),
    recipe: {
      inputs: [{ slot: "listings", format: "csv" }],
      steps: [
        { op: "derive", set: { price: "num(extract(label, '([0-9][0-9,.]*)'))" } },
        { op: "sort", by: ["price desc"] },
        { op: "select", columns: ["item", "price"] },
      ],
      outputs: [{ kind: "file", name: "prices.csv", format: "csv" }],
    },
    expect: "item,price\ndesk,1250\nlamp,40\n",
  },
  {
    id: "match-keep-all",
    request: "Add an order_ref column to messages.csv holding any 'ORD-1234' style code found in the text (empty if none). Save refs.csv.",
    files: csv("messages", "messages.csv", "id,text\nm1,Where is ORD-5512?\nm2,Hello there\n"),
    recipe: {
      inputs: [{ slot: "messages", format: "csv" }],
      steps: [{ op: "derive", set: { order_ref: "coalesce(extract(text, '(ORD-\\d+)'), '')" } }],
      outputs: [{ kind: "file", name: "refs.csv", format: "csv" }],
    },
    expect: "id,text,order_ref\nm1,Where is ORD-5512?,ORD-5512\nm2,Hello there,\n",
  },
  {
    id: "connect-and-filter-dates",
    request: "From bookings.csv keep bookings in the first week of May 2026 (May 1 to May 7) and save may-week1.csv.",
    files: csv("bookings", "bookings.csv", "guest,date\nTo,2026-04-30\nUma,2026-05-01\nVic,2026-05-07\nWen,2026-05-08\n"),
    recipe: {
      inputs: [{ slot: "bookings", format: "csv" }],
      steps: [{ op: "filter", where: "date(date) >= '2026-05-01' and date(date) <= '2026-05-07'" }],
      outputs: [{ kind: "file", name: "may-week1.csv", format: "csv" }],
    },
    expect: "guest,date\nUma,2026-05-01\nVic,2026-05-07\n",
  },
  {
    id: "lookup-and-sum",
    request: "Price each line of cart.csv with prices.csv by sku, then total the cost into total.json as {\"total\": number}.",
    files: {
      ...csv("cart", "cart.csv", "sku,qty\nA,2\nB,1\n"),
      ...csv("prices", "prices.csv", "sku,price\nA,3.5\nB,10\n"),
    },
    recipe: {
      inputs: [
        { slot: "cart", format: "csv" },
        { slot: "prices", format: "csv" },
      ],
      steps: [
        { op: "join", with: "prices", on: ["sku"] },
        { op: "derive", set: { cost: "num(qty) * num(price)" } },
        { op: "summarize", set: { total: "sum(cost)" } },
      ],
      outputs: [{ kind: "file", name: "total.json", format: "json", shape: "row" }],
    },
    expect: '{\n  "total": 17\n}\n',
  },
  {
    id: "first-per-group",
    request: "For each runner in race.csv keep their fastest lap (lowest seconds) row. Save best-laps.csv.",
    files: csv("race", "race.csv", "runner,lap,seconds\nIo,1,62\nIo,2,59\nKai,1,70\nKai,2,71\n"),
    recipe: {
      inputs: [{ slot: "race", format: "csv" }],
      steps: [
        { op: "sort", by: ["num(seconds)"] },
        { op: "dedupe", by: ["runner"], keep: "first" },
        { op: "sort", by: ["runner"] },
      ],
      outputs: [{ kind: "file", name: "best-laps.csv", format: "csv" }],
    },
    expect: "runner,lap,seconds\nIo,2,59\nKai,1,70\n",
  },
  {
    id: "text-lines-filter",
    request: "Keep the lines of todo.md that are unchecked boxes ('- [ ]'), without the box, as open.txt.",
    files: csv("todo", "todo.md", "# list\n- [x] pay rent\n- [ ] call mom\n- [ ] fix bike\n"),
    recipe: {
      inputs: [{ slot: "todo", format: "text" }],
      steps: [{ op: "match", column: "line", pattern: "^- \\[ \\] (?<item>.+)$" }],
      outputs: [{ kind: "file", name: "open.txt", format: "text", shape: { values: "item" } }],
    },
    expect: "call mom\nfix bike\n",
  },
  {
    id: "line-chart-trend",
    request: "Show daily visits from traffic.csv as a line chart and save daily.csv with day and visits summed.",
    files: csv("traffic", "traffic.csv", "day,page,visits\n2026-07-01,home,10\n2026-07-01,blog,5\n2026-07-02,home,12\n"),
    recipe: {
      inputs: [{ slot: "traffic", format: "csv" }],
      steps: [
        { op: "summarize", by: ["day"], set: { visits: "sum(num(visits))" } },
        { op: "sort", by: ["day"] },
      ],
      outputs: [
        { kind: "file", name: "daily.csv", format: "csv" },
        { kind: "view", type: "line", x: "day", y: "visits" },
      ],
    },
    expect: "day,visits\n2026-07-01,15\n2026-07-02,12\n",
  },
];
