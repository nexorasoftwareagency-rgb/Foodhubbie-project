// Instagram outreach agent — resolve handle via IG search, then send the DM.
// Same rails as wa-sales-agent.cjs: allowlist = CRM rows, daily cap, long human gaps, CSV log, per-lead isolation.
//
//   node tools/ig-sales-agent.cjs send 5     -> for New leads: find their IG profile, DM it (headed first run = login)
//   node tools/ig-sales-agent.cjs status     -> queue + today counts
//
// IG automation is against Instagram's terms and can get the account actioned — cap is 12/day with 60-120s gaps.
const {chromium} = require(__dirname + "/../node_modules/playwright");
const {execFileSync} = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const XLSX = path.join(ROOT, "Restaurant Lead Data", "restaurant-leads.xlsx");
const PROFILE = path.join(process.env.TEMP, "opencode", "ig-profile");
const LOG = path.join(ROOT, "Restaurant Lead Data", "ig-log.csv");
const DAILY_CAP = 12;
const APP_ID = "936619743392459";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const L = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const today = () => new Date().toLocaleDateString("en-GB").replace(/\//g, "/");

const DM = name =>
  `Namaste 🙏${name ? " " + name + " ji" : ""} — Nilesh, FoodHubbie founder.\n\n` +
  `Aapke restaurant ke liye ek system banate hain jisme — QR table ordering, WhatsApp ordering, rider app aur live sales reports — sab ek hi dashboard par chalte hain. Aggregator commission 0.\n\n` +
  `10 minute ka demo, aapka menu aapki settings ke saath — live dikha denge.\n👉 https://foodhubbie-web.web.app/\n\n` +
  `Demo chahiye to bas "demo" reply kar dijiye.`;

function read() {
  try {
    return JSON.parse(execFileSync("python", [path.join(__dirname, "wa-lead-io.py"), "read", XLSX], {encoding: "utf8", maxBuffer: 1e8}));
  } catch (e) {
    if (/Permission/.test(e.message)) throw new Error("Excel has the workbook open - close it and re-run.");
    throw e;
  }
}
function update(crm, patch) {
  try {
    const tmp = path.join(process.env.TEMP, "ig-update.json");
    fs.writeFileSync(tmp, JSON.stringify({crm, patch}), "utf8");
    return execFileSync("python", [path.join(__dirname, "wa-lead-io.py"), "update", XLSX, tmp], {encoding: "utf8"});
  } catch (e) {
    if (/Permission/.test(e.message)) throw new Error("Excel has the workbook open - close it and re-run.");
    throw e;
  }
}
function logRow(o) {
  if (!fs.existsSync(LOG)) fs.writeFileSync(LOG, '"time","crm","name","handle","type","status","text"\r\n', "utf8");
  const esc = v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  fs.appendFileSync(LOG, [o.time || new Date().toISOString(), o.crm, o.name, o.handle, o.type, o.status, o.text].map(esc).join(",") + "\r\n", "utf8");
}
function sentToday() {
  if (!fs.existsSync(LOG)) return 0;
  return fs.readFileSync(LOG, "utf8").split(/\r?\n/).filter(l => /"dm-sent"/.test(l) && l.includes(new Date().toISOString().slice(0, 10))).length;
}
const handleOf = l => String(l.instagram || "").trim().replace(/^@/, "").replace(/\/$/, "").split("?")[0];
const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const tokens = s => norm(s).split(" ").filter(t => t.length >= 4);

async function openIg() {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    channel: "chrome", headless: false, viewport: {width: 1280, height: 900},
    args: ["--disable-blink-features=AutomationControlled"]
  });
  const p = ctx.pages()[0] || await ctx.newPage();
  await p.goto("https://www.instagram.com/", {waitUntil: "domcontentloaded", timeout: 60000}).catch(() => {});
  await sleep(3000);
  const loggedIn = await p.locator('svg[aria-label="Home"], a[href="/direct/inbox/"]').count().catch(() => 0);
  if (!loggedIn) {
    L("NOT LOGGED IN — log into Instagram in the open window (5 min), then it continues…");
    const ok = await p.waitForSelector('svg[aria-label="Home"], a[href="/direct/inbox/"]', {timeout: 300000}).then(() => true).catch(() => false);
    if (!ok) { await ctx.close(); throw new Error("Instagram login not completed"); }
    L("logged in.");
  }
  return {ctx, p};
}

// Instagram web search API (cookie-authenticated, returns JSON users)
async function resolveHandle(p, lead) {
  const q = encodeURIComponent(lead.name);
  const url = `https://www.instagram.com/web/search/topsearch/?context=blended&query=${q}&include_reel=false`;
  const data = await p.evaluate(async ({url, APP_ID}) => {
    const r = await fetch(url, {headers: {"x-ig-app-id": APP_ID}, credentials: "include"});
    return r.ok ? await r.json() : {error: r.status};
  }, {url, APP_ID}).catch(() => ({}));
  if (!data || !Array.isArray(data.users)) return {error: data && data.error ? "search " + data.error : "search failed"};
  const want = tokens(lead.name);
  const scored = data.users.map(u => {
    const u2 = u.user || {};
    const hay = norm((u2.username || "") + " " + (u2.full_name || ""));
    return {handle: u2.username || "", verified: !!u2.is_verified, hit: want.filter(t => hay.includes(t)).length, hay};
  }).filter(x => x.handle);
  scored.sort((a, b) => (b.hit - a.hit) || (b.verified - a.verified));
  const best = scored[0];
  if (!best || best.hit === 0) return {error: "no name match", candidates: scored.slice(0, 3).map(s => "@" + s.handle)};
  return {handle: best.handle, hit: best.hit};
}

async function sendDm(p, handle, text) {
  await p.goto("https://www.instagram.com/" + handle + "/", {waitUntil: "domcontentloaded", timeout: 60000});
  await sleep(2500 + Math.random() * 2000);
  const msgBtn = p.locator('div[role="button"]:has-text("Message"), button:has-text("Message"), div[role="button"]:has-text("Send message")').first();
  if (!(await msgBtn.count())) throw Object.assign(new Error("no Message button"), {code: "NO_MSG"});
  await msgBtn.click();
  await sleep(2500 + Math.random() * 1500);
  const box = p.locator('div[role="textbox"][contenteditable="true"], textarea[placeholder*="Message"]').last();
  await box.click();
  await p.keyboard.type(text, {delay: 35 + Math.random() * 30});
  await sleep(1500 + Math.random() * 1000);
  await p.keyboard.press("Enter");
  await sleep(2500);
}

async function send(n) {
  const all = read();
  const leads = all.filter(l => l.status === "New");
  if (!leads.length) return L("queue empty");
  const {ctx, p} = await openIg();
  let sent = 0;
  for (const l of leads.slice(0, n)) {
    if (sentToday() >= DAILY_CAP) { L("daily cap", DAILY_CAP, "reached"); break; }
    L("lead:", l.crm, l.name);
    let handle = handleOf(l);
    if (!handle) {
      const r = await resolveHandle(p, l);
      if (r.error) {
        L("   skip —", r.error, r.candidates ? JSON.stringify(r.candidates) : "");
        logRow({crm: l.crm, name: l.name, handle: "", type: "ig-resolve", status: r.error});
        await sleep(15000 + Math.random() * 15000);
        continue;
      }
      handle = r.handle;
      update(l.crm, {instagram: "@" + handle});
      L("   handle:", "@" + handle);
    }
    const text = DM(l.ownerName || "");
    update(l.crm, {"status": "Contacted", "channel used": "Instagram", "attempts": (l.attempts || 0) + 1,
                   "first contact": l.status === "New" ? today() : undefined, "last contact": today()});
    try {
      await sendDm(p, handle, text);
      logRow({crm: l.crm, name: l.name, handle: "@" + handle, type: "dm-sent", status: "ok", text});
      sent++;
      L("   sent");
    } catch (e) {
      update(l.crm, {status: l.status || "New", "attempts": l.attempts || 0,
                     "first contact": l.status === "New" ? "" : undefined, "last contact": l.lastContact || ""});
      logRow({crm: l.crm, name: l.name, handle: "@" + handle, type: "dm", status: e.code || String(e.message).slice(0, 60)});
      L("   failed:", String(e.message).slice(0, 80));
    }
    await sleep(60000 + Math.random() * 60000); // 60-120s between DMs
  }
  await ctx.close();
  L(`send done — DMs delivered: ${sent} | today: ${sentToday()}/${DAILY_CAP}`);
}

async function status() {
  const leads = read();
  const queued = leads.filter(l => l.status === "New").length;
  L("leads:", leads.length, "| handles on file:", leads.filter(handleOf).length, "| New queued:", queued, "| sent today:", sentToday(), "/", DAILY_CAP);
}

(async () => {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === "send") return send(parseInt(arg || "3", 10));
  if (cmd === "status") return status();
  console.error("usage: node tools/ig-sales-agent.cjs send|status [n]");
  process.exit(1);
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
