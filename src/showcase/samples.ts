/**
 * Synthetic sample datasets, generated deterministically from a seed so every
 * visitor, test and tape sees exactly the same rows. No real people or firms.
 */
import { rng } from "../core/verify/variants";

export type Sample = {
  id: string;
  title: string;
  blurb: string;
  file: { name: string; format: "csv" | "json" | "text"; text: string };
  requests: { text: string; level: 1 | 2 | 3 }[];
};

const pick = <T,>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length)];
const pad = (n: number) => String(n).padStart(2, "0");
const day = (r: () => number, month: number) => `2026-${pad(month)}-${pad(1 + Math.floor(r() * 28))}`;
const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
const csv = (rows: (string | number)[][]) =>
  rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? `"${String(c).replaceAll('"', '""')}"` : String(c))).join(",")).join("\n") + "\n";

function orders() {
  const r = rng(101);
  const items: [string, number][] = [["notebook", 4.5], ["pen", 1.2], ["backpack", 38], ["lamp", 24], ["mug", 9.5], ["stapler", 12]];
  const regions = ["North", "South", "East", "West"];
  const rows: (string | number)[][] = [["order_id", "date", "region", "item", "quantity", "price"]];
  for (let i = 1; i <= 48; i++) {
    const [item, price] = pick(r, items);
    rows.push([`A${1000 + i}`, day(r, 1 + (i % 3)), pick(r, regions), item, 1 + Math.floor(r() * 6), money(price)]);
  }
  return csv(rows);
}

function expenses() {
  const r = rng(202);
  const cats: [string, string[], number][] = [["groceries", ["Corner Market", "Fresh & Co"], 60], ["transport", ["Metro Card", "City Bikes"], 25], ["dining", ["Noodle Bar", "Cafe Blue"], 30], ["utilities", ["Power Co-op", "Waterworks"], 80], ["fun", ["Cinema 8", "Climbing Gym"], 40]];
  const rows: (string | number)[][] = [["date", "category", "merchant", "amount"]];
  for (let i = 0; i < 40; i++) {
    const [cat, merchants, base] = pick(r, cats);
    const refund = r() < 0.06;
    rows.push([day(r, 1 + (i % 3)), cat, pick(r, merchants), money((refund ? -1 : 1) * base * (0.3 + r() * 1.8))]);
  }
  return csv(rows);
}

function contacts() {
  const r = rng(303);
  const people = ["Mira Okafor", "Jonas Lind", "Priya Raman", "Tomás Vidal", "Aiko Sato", "Lena Novak", "Kwame Mensah", "Sara Haddad", "Ivo Petrov", "Nia Brooks", "Omar Farouk", "Elsa Berg"];
  const companies = ["Northwind Labs", "Bluefin Studio", "Cobalt & Pine", "Harbor Health"];
  const rows: (string | number)[][] = [["name", "email", "phone", "company"]];
  for (const p of people) {
    const [first, last] = p.split(" ");
    const email = `${first.toLowerCase().replace("á", "a")}.${last.toLowerCase()}@example.test`;
    const phone = r() < 0.2 ? "" : `555-01${pad(Math.floor(r() * 99))}`;
    const company = pick(r, companies);
    rows.push([p, email, phone, company]);
    if (r() < 0.45) rows.push([r() < 0.5 ? p.toUpperCase() : first, ` ${email.toUpperCase()} `, phone, company]);
  }
  return csv(rows);
}

function tickets() {
  const r = rng(404);
  const agents = ["Rae", "Dev", "Kim", "Sol"];
  const rows: (string | number)[][] = [["ticket", "opened", "closed", "status", "priority", "agent"]];
  for (let i = 1; i <= 36; i++) {
    const opened = day(r, 10);
    const closed = r() < 0.6;
    const d = Number(opened.slice(8));
    rows.push([`T-${300 + i}`, opened, closed ? `2026-10-${pad(Math.min(31, d + 1 + Math.floor(r() * 9)))}` : "", closed ? "closed" : pick(r, ["open", "open", "waiting"]), pick(r, ["low", "normal", "normal", "high", "urgent"]), pick(r, agents)]);
  }
  return csv(rows);
}

function serverLog() {
  const r = rng(505);
  const paths = ["/api/cart", "/api/login", "/api/search", "/health", "/api/orders"];
  const lines: string[] = [];
  let t = 8 * 3600;
  for (let i = 0; i < 60; i++) {
    t += 3 + Math.floor(r() * 40);
    const ts = `2026-11-03T${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;
    const roll = r();
    const level = roll < 0.12 ? "ERROR" : roll < 0.27 ? "WARN" : "INFO";
    const path = pick(r, paths);
    const msg = level === "ERROR" ? pick(r, ["timeout calling payments", "database connection reset", "unexpected null in cart"]) : level === "WARN" ? pick(r, ["slow response 1840ms", "retrying upstream", "cache miss storm"]) : `GET ${path} 200`;
    lines.push(`${ts} ${level} ${level === "INFO" ? msg : `${path} ${msg}`}`);
  }
  return lines.join("\n") + "\n";
}

function inventory() {
  const r = rng(606);
  const items = ["hex bolt M6", "wing nut", "washer 10mm", "cable tie", "hinge", "drawer slide", "caster wheel", "shelf pin", "anchor plug", "wood screw"];
  const suppliers = ["Acorn Supply", "Delta Parts", "Kestrel Hardware"];
  const rows: (string | number)[][] = [["sku", "name", "stock", "reorder_point", "supplier"]];
  items.forEach((name, i) => {
    const point = 10 * (1 + Math.floor(r() * 6));
    rows.push([`SKU-${110 + i}`, name, Math.floor(r() * point * 2), point, pick(r, suppliers)]);
  });
  return csv(rows);
}

function catalog() {
  const r = rng(707);
  const products = ["Trail Runner", "City Sneaker", "Rain Shell", "Fleece Pullover", "Wool Beanie", "Day Pack", "Water Bottle", "Headlamp"];
  const cats = ["footwear", "footwear", "outerwear", "outerwear", "accessories", "bags", "accessories", "accessories"];
  return (
    JSON.stringify(
      {
        store: "Example Outfitters",
        products: products.map((name, i) => ({
          sku: `P${200 + i}`,
          name,
          category: cats[i],
          pricing: { price: Number(money(8 + r() * 140)), currency: "USD" },
          stock: { available: r() > 0.25, warehouse: pick(r, ["east", "west"]) },
          tags: [cats[i], ...(r() > 0.5 ? ["sale"] : []), ...(r() > 0.6 ? ["new"] : [])],
        })),
      },
      null,
      2,
    ) + "\n"
  );
}

function survey() {
  const r = rng(808);
  const ages = ["18-24", "25-34", "35-44", "45-54", "55+"];
  const comments = ["Love it", "Too pricey for what it is", "Shipping was slow", "The price is fair", "", "Great support team", "Would like more colors", "price went up again", ""];
  const rows: (string | number)[][] = [["respondent", "age_group", "satisfaction", "recommend", "comment"]];
  for (let i = 1; i <= 30; i++) rows.push([`R${100 + i}`, pick(r, ages), 1 + Math.floor(r() * 5), r() < 0.62 ? "yes" : "no", pick(r, comments)]);
  return csv(rows);
}

export const SAMPLES: Sample[] = [
  {
    id: "orders",
    title: "Shop orders",
    blurb: "48 orders across four regions",
    file: { name: "orders.csv", format: "csv", text: orders() },
    requests: [
      { level: 1, text: "Total sales by item, as quantity times price. Save totals.json mapping each item to its total." },
      { level: 2, text: "Show total sales per region as a bar chart, and save region-sales.csv." },
      { level: 3, text: "Find the 3 items with the most revenue in March 2026 and save top-march.csv with item and revenue." },
    ],
  },
  {
    id: "expenses",
    title: "Household expenses",
    blurb: "40 card payments, a few refunds",
    file: { name: "expenses.csv", format: "csv", text: expenses() },
    requests: [
      { level: 1, text: "Sum spending by category and save by-category.csv, biggest first." },
      { level: 2, text: "Total spending per month (YYYY-MM) as a line chart; save monthly.csv." },
      { level: 3, text: "List every expense over 100 with its merchant, largest first, as big-spends.csv." },
    ],
  },
  {
    id: "contacts",
    title: "Contacts with duplicates",
    blurb: "The same people typed twice",
    file: { name: "contacts.csv", format: "csv", text: contacts() },
    requests: [
      { level: 1, text: "Remove duplicate contacts: treat emails as the same when they only differ in case or spaces, keep the first row. Save clean-contacts.csv." },
      { level: 2, text: "Count how many unique contacts each company has (by email, ignoring case and spaces). Save per-company.json." },
      { level: 3, text: "List the contacts with no phone number as missing-phone.csv with name and email, one row per person." },
    ],
  },
  {
    id: "tickets",
    title: "Support tickets",
    blurb: "36 tickets from October",
    file: { name: "tickets.csv", format: "csv", text: tickets() },
    requests: [
      { level: 1, text: "Count the tickets that are not closed, by priority. Save open-by-priority.json." },
      { level: 2, text: "For closed tickets, average the days from opened to closed per agent, rounded to 1 decimal. Save agent-speed.csv." },
      { level: 3, text: "Which open or waiting tickets were opened on or before 2026-10-10? Save stale.csv sorted by opened date." },
    ],
  },
  {
    id: "serverlog",
    title: "Server log",
    blurb: "An hour of app.log lines",
    file: { name: "app.log", format: "text", text: serverLog() },
    requests: [
      { level: 1, text: "Count the log lines per level (INFO, WARN, ERROR). Save levels.json." },
      { level: 2, text: "Extract every ERROR line into errors.csv with time, path and message." },
      { level: 3, text: "Which paths had warnings or errors, and how many of each? Save trouble.csv with path, level and count." },
    ],
  },
  {
    id: "inventory",
    title: "Workshop inventory",
    blurb: "10 parts and their reorder points",
    file: { name: "inventory.csv", format: "csv", text: inventory() },
    requests: [
      { level: 1, text: "Which items are below their reorder point? Save low-stock.csv with sku, name and stock." },
      { level: 2, text: "Total stock per supplier as a bar chart; save stock-by-supplier.csv." },
      { level: 3, text: "Make reorder.csv for items below their reorder point with sku, supplier and order_qty = 2 times reorder_point minus stock." },
    ],
  },
  {
    id: "catalog",
    title: "Product catalog (nested JSON)",
    blurb: "8 products with nested pricing and stock",
    file: { name: "catalog.json", format: "json", text: catalog() },
    requests: [
      { level: 1, text: "Flatten catalog.json into catalog.csv with sku, name, category and price." },
      { level: 2, text: "List the names of products under 40 dollars that are available, as cheap.json (a JSON array of names)." },
      { level: 3, text: "Average price per category, rounded to 2 decimals, as a bar chart; save category-prices.csv." },
    ],
  },
  {
    id: "survey",
    title: "Survey answers",
    blurb: "30 responses, 1–5 satisfaction",
    file: { name: "survey.csv", format: "csv", text: survey() },
    requests: [
      { level: 1, text: "Average satisfaction by age group, rounded to 1 decimal. Save satisfaction.csv in age group order." },
      { level: 2, text: 'What share of respondents would recommend us? Save recommend.json as {"yes_percent": number} rounded to a whole number.' },
      { level: 3, text: "Pull out the comments that mention price (any capitalization) with respondent and satisfaction. Save price-comments.csv." },
    ],
  },
];

export function sampleById(id: string) {
  return SAMPLES.find((s) => s.id === id);
}
