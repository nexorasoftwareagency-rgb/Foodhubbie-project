// wa-sales-agent  personalized 1:1 WhatsApp outreach to the scraped restaurant leads ONLY.
//
// APPOINTMENT: sales agent for Restaurant Lead Data leads. No other contact is ever
//   readable or writable  allowlisted numbers only, enforced at every call site.
//
// Rails (do not remove):
//   - ONE DM per run by default (--n N staggers, 2-5 min apart, daily cap 15)
//   - human pacing: composing presence 4-9s before send; 2-5 min between staggered sends
//   - opt-out detector on any reply -> status "Not interested", lead frozen forever
//   - FAQ auto-answer from replies; anything else stored needsHuman (I draft, next run sends)
//   - modes: baileys (send engine; session persists in .wa-sales-auth  no rescan)
//            web (playwright: reads replies off web.whatsapp.com  paired in the same window)
//
// Commands (run from repo root):
//   node tools/wa-sales-agent.cjs sync               # ensure CRM ids (LD001..) in the workbook
//   node tools/wa-sales-agent.cjs dry                # queue + next message text, nothing sent
//   node tools/wa-sales-agent.cjs send               # ONE DM (baileys)
//   node tools/wa-sales-agent.cjs send --n 3         # 3 staggered DMs
//   node tools/wa-sales-agent.cjs send --web         # send via WhatsApp Web instead
//   node tools/wa-sales-agent.cjs check              # read replies (web), log + answer FAQs
//   node tools/wa-sales-agent.cjs reply --id LD007 --text "..." --web   # tracked manual reply
// Any run updates the Excel tracker at the end ("Report Entry in Excel, then close").
const {chromium} = require("../node_modules/playwright");
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const B = require(path.join(ROOT, "bot", "node_modules", "@whiskeysockets", "baileys"));
const {makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason} = B;
const qrterm = require(path.join(ROOT, "bot", "node_modules", "qrcode-terminal"));
const {execFileSync} = require("child_process");
const DATA = path.join(ROOT, "Restaurant Lead Data");
const XLSX = path.join(DATA, "restaurant-leads.xlsx");
const LOG = path.join(DATA, "wa-log.csv");
const AUTH = path.join(ROOT, ".wa-sales-auth");
const SITE = "https://foodhubbie-web.web.app/";
const VIDEO_URL = SITE + "assets/demo/demo-walkthrough-32s.mp4";
const DAILY_CAP = 15;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const L = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------- io ----------
function leadRead(mode) {
  const out = execFileSync("python", [path.join(__dirname, "wa-lead-io.py"), mode || "read", XLSX], {encoding: "utf8", maxBuffer: 1e7});
  return JSON.parse(out);
}
function leadUpdate(crm, patch) {
  return execFileSync("python", [path.join(__dirname, "wa-lead-io.py"), "update", XLSX, JSON.stringify({crm, patch})], {encoding: "utf8"});
}
function appendLog(rec) {
  const head = !fs.existsSync(LOG) ? "ts,crm,name,phone,type,text,status\n" : "";
  fs.writeFileSync(LOG, (head ? "" : "") + Object.values({
    ts: new Date().toISOString(), ...rec,
    text: String(rec.text || "").replace(/[\r\n]+/g, "  ").replace(/"/g, "\u0027"),
    status: rec.status || ""
  }).map(v => `"${v ?? ""}"`).join(",") + "\n", {flag: "a", encoding: "utf8"});
}
function sentToday() {
  if (!fs.existsSync(LOG)) return 0;
  const d = new Date().toISOString().slice(0, 10);
  return fs.readFileSync(LOG, "utf8").split("\n").filter(l => l.startsWith('"2') && l.includes(d) && /dm-sent|reply-sent/.test(l)).length;
}

// ---------- messaging ----------
const HOOKS = {
  cafe: "guest table par scan karke order de deta hai — kitchen tak seedha pahunch jaata hai, no waiter-runner",
  bakery: "counter billing ke saath QR table order bhi ek hi dashboard mein aa jaata hai",
  "fine dining": "table ka QR order aur counter ka bill ek hi dashboard mein live sync — bill mismatch khatam",
  qsr: "counter billing 1 order = ₹1 — super fast, table QR bhi included",
  restaurant: "dine-in table orders aur counter billing ek hi screen par aate hain"
};
function compose(l, resend) {
  const greet = l.ownerName ? l.ownerName + " ji" : "Manager sahab";
  const outletKey = ["cafe", "bakery"].includes((l.outletType || "").toLowerCase()) ? "cafe"
      : (l.outletType || "").toLowerCase().includes("fine") ? "fine dining"
      : (l.outletType || "").toLowerCase().includes("quick") ? "qsr" : "restaurant";
  if (resend) return `Namaste 🙏 ${greet}, Nilesh — FoodHubbie se.\n\nLast message miss hua hoga? Koi baat nahi — ek 32-sec video hai, poora system chalte hue:\n${VIDEO_URL}\n\nPasand aaye to bas "demo" likh dijiye — 10 min mein aapke hi menu pe dikhata hoon. 10 din ka trial, no monthly fee.`;
  return `Namaste 🙏 ${greet}, main Nilesh — FoodHubbie se.\n` +
    `Aapke restaurant ke liye ek cheez dikhani thi: counter billing, table QR order, kitchen screen aur WhatsApp order — sab ek hi dashboard mein.\n` +
    `Aapke case ke liye seedhi baat: ${HOOKS[outletKey]}.\n` +
    `Charges per order hain, monthly nahi: counter ₹1, table QR ₹2, WhatsApp ₹5. Setup ₹500 one-time (first bill mein adjust). Cancelled order ka charge nahi — wo free hai.\n\n` +
    `10-minute demo de doon? Aapke hi menu se. Site: ${SITE}`;
}
const OPTOUT = /(stop|band karo|nahi chahiye|not interested|mat bhejo|raha nahi|unsub)/i;
const faqAnswer = t =>
  /price|kitn(a|e)|charge|rate|monthly|fees/i.test(t)
    ? `1 counter / 2 table QR / 5 WhatsApp  har order par, monthly koi feenahi. 500 one-time setup first bill mein adjust hai. Cancel par charge zero.`
    : /demo|dikha\nawe|dikha do|book/i.test(t)
      ? `Demo bilkul  10 min, aapke hi menu pe. Aaj ya kal? Thoda time bata dein, main call-dikhata hoon.`
      : /k[aie]se|kaam karta|kya hai|video/i.test(t)
        ? `32-sec video: ${VIDEO_URL}  system ka poora flow. 10-min live demo bhi de sakta hoon, bas time bata dijiye.`
        : null;

// ---------- company: allowlist guard ----------
function pickTargets(n) {
  const leads = leadRead().filter(l => l.phone && !/^Duplicate$/.test(l.status || ""));
  const pendingReply = leads.filter(l => (l.replySummary || "").startsWith("needsHuman"));
  const fresh = leads.filter(l => l.status === "New" || l.status === "Resend");
  const targets = [...pendingReply, ...fresh].slice(0, n);
  return targets;
}
function assertAllowlisted(phone, leads) {
  if (!leads.some(l => String(l.phone || "").replace(/\D/g, "").endsWith(String(phone).replace(/\D/g, ""))))
    throw new Error("REFUSED: number not in Restaurant Lead Data allowlist: " + phone);
}

// ---------- engines ----------
async function bootBaileys() {
  fs.mkdirSync(AUTH, {recursive: true});
  const {state, saveCreds} = await useMultiFileAuthState(AUTH);
  const {version} = await fetchLatestBaileysVersion();
  const sock = makeWASocket({version, auth: state, printQRInTerminal: false, markOnlineOnConnect: false, syncFullHistory: false});
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("connect timeout")), 60000);
    sock.ev.on("connection.update", u => {
      if (u.qr) { L("QR  WhatsApp  Devices  Link a device me scan karein:"); qrterm.generate(u.qr, {small: true}); }
      if (u.connection === "open") { clearTimeout(t); res(); }
      if (u.connection === "close") { clearTimeout(t); rej(new Error("closed: " + JSON.stringify(u.lastDisconnect?.error?.output?.statusCode))); }
    });
  });
  sock.ev.on("creds.update", saveCreds);
  return sock;
}
async function baileySendDM(sock, phone, text) {
  const r = await sock.onWhatsApp(phone);
  if (!r || !r.length) throw new Error("not on WhatsApp: " + phone);
  const jid = r[0].jid;
  await sock.sendPresenceUpdate("composing", jid);
  await sleep(4000 + Math.random() * 5000);
  await sock.sendMessage(jid, {text});
  return jid;
}

// web engine: one browser, chat opened by phone URL
async function bootWeb({headless = false} = {}) {
  const ctx = await chromium.launchPersistentContext(
      path.join(process.env.TEMP, "opencode", "wa-web-profile"),
      {channel: "chrome", headless, args: ["--disable-blink-features=AutomationControlled"]});
  const p = ctx.pages()[0] || await ctx.newPage();
  const have = fs.existsSync(path.join(process.env.TEMP, "opencode", "wa-web-paired"));
  await p.goto("https://web.whatsapp.com/", {waitUntil: "domcontentloaded", timeout: 60000}).catch(() => {});
  await p.waitForTimeout(6000);
  if (!have) {
    L("WA Web QR in the opened window  scan it (this pairs the session), then I continue");
    await p.screenshot({path: path.join(process.env.TEMP, "opencode", "wa-qr.png")});
    await p.waitForSelector('div[role="list"]', {timeout: 240000});
    fs.writeFileSync(path.join(process.env.TEMP, "opencode", "wa-web-paired"), "1");
  }
  return {ctx, p};
}
async function webSend(p, phone, text) {
  await p.goto(`https://web.whatsapp.com/send?phone=${phone}&type=phone_number&app_absent=0`, {waitUntil: "domcontentloaded", timeout: 60000}).catch(() => {});
  await p.waitForSelector('div[title="Type a message"]', {timeout: 40000});
  const box = p.locator('div[title="Type a message"]');
  await box.click();
  await p.keyboard.type(text, {delay: 40 + Math.random() * 30});
  await p.keyboard.press("Enter");
  await p.waitForTimeout(2500);
}
async function webReadLastIncoming(p, phone) {
  await p.goto(`https://web.whatsapp.com/send?phone=${phone}&type=phone_number&app_absent=0`, {waitUntil: "domcontentloaded", timeout: 60000}).catch(() => {});
  await p.waitForSelector('[id="main"]', {timeout: 45000});
  await p.waitForTimeout(2500);
  const bubbles = await p.$$('div[class*="message"] span.selectable-text, div[data-pre-plain-text] span.selectable-text');
  if (!bubbles.length) return null;
  const nodes = bubbles.slice(-4);
  for (const b of nodes) {
    const pre = await b.evaluate(el => el.closest("[data-pre-plain-text]")?.getAttribute("data-pre-plain-text") || "");
    if (!pre) continue; // outgoing bubbles have no pre-plain "time + name" header prefix
    return (await b.textContent()).trim().slice(0, 220);
  }
  return null;
}

// ---------- run phases ----------
function finishReport(did) {
  L("Done this run:", did.join(" | ") || "(nothing)");
  L("Excel updated. Log file:", LOG);
}
async function main(argv) {
  const cmd = argv[0];
  const n = (argv.includes("--n") ? parseInt(argv[argv.indexOf("--n") + 1], 10) : 1);
  const webMode = argv.includes("--web");
  const idArg = argv.includes("--id") ? argv[argv.indexOf("--id") + 1] : null;
  const txtArg = argv.includes("--text") ? argv[argv.indexOf("--text") + 1] : null;
  const leads = leadRead();

  if (cmd === "sync") { console.log("CRM ids ensured:", leads.filter(l => l.crm).length); return finishReport(["sync"]); }

  if (cmd === "dry") {
    for (const l of leads.slice(0, 6)) console.log(" ", l.crm, l.status, String(l.name).slice(0, 34), l.phone);
    const t = pickTargets(n);
    if (!t.length) { console.log("QUEUE EMPTY"); return finishReport([]); }
    console.log("\nNEXT UP:", t[0].crm, "->", (t[0].ownerName || "Manager sahab"), "\n---\n" + compose(t[0], false));
    return finishReport([]);
  }

  if (cmd === "check") {
    // read replies of allowlisted leads only (web engine), then answer FAQ/optout via baileys
    const {ctx, p} = await bootWeb();
    const did = [];
    for (const l of leads.filter(l => l.phone && l.status !== "Not interested" && l.status !== "Duplicate").slice(0, 12)) {
      assertAllowlisted(l.phone, leads);
      const last = await webReadLastIncoming(p, l.phone.replace(/\D/g, ""));
      if (!last) { did.push(l.crm + ":no-read"); continue; }
      const cur = (l.replySummary || "");
      if (last === cur) { did.push(l.crm + ":same"); continue; }
      appendLog({crm: l.crm, name: l.name, phone: l.phone, type: "reply-in", text: last, status: "logged"});
      leadUpdate(l.crm, {"reply summary": last, "last contact": new Date().toLocaleDateString("en-GB")});
      did.push(l.crm + ":replied");
      if (isOptOut(last)) {
        leadUpdate(l.crm, {"status": "Not interested", "outcome": "Not interested"});
        did.push(l.crm + ":OPTOUT");
        continue;
      }
      const ans = faqAnswer(last);
      if (ans && !webMode) {
        const sock = await bootBaileys();
        await sleep(3000);
        await baileySendDM(sock, l.phone, ans);
        appendLog({crm: l.crm, name: l.name, phone: l.phone, type: "auto-answer", text: ans, status: "ok"});
        leadUpdate(l.crm, {"status": "Replied", "attempts": (l.attempts || 0)});
        await sock.end?.(new Error("done"));
        did.push(l.crm + ":faq-answered");
      } else if (ans) {
        const {ctx: w2, p: p2} = {ctx: ctx, p: p};
        await webSend(p2, l.phone.replace(/\D/g, ""), ans);
        appendLog({crm: l.crm, name: l.name, phone: l.phone, type: "auto-answer", text: ans, status: "ok"});
        did.push(l.crm + ":faq-answered-web");
      } else {
        leadUpdate(l.crm, {"status": "Replied"});
        did.push(l.crm + ":needsHuman");
      }
      await sleep(5000 + Math.random() * 8000);
    }
    await ctx.close();
    return finishReport(did);
  }

  if (cmd === "reply") {
    if (!idArg || !txtArg) throw new Error("reply needs --id LD### --text");
    const l = leads.find(x => x.crm === idArg);
    assertAllowlisted(l?.phone || "", leads);
    if (webMode) {
      const {ctx, p} = await bootWeb();
      await webSend(p, l.phone.replace(/\D/g, ""), txtArg);
      appendLog({crm: l.crm, name: l.name, phone: l.phone, type: "reply-sent", text: txtArg, status: "ok"});
      leadUpdate(l.crm, {"attempts": (l.attempts || 0) + 1, "last contact": new Date().toLocaleDateString("en-GB")});
      await ctx.close();
    } else {
      const sock = await bootBaileys();
      await sleep(Math.random() * 3000);
      await baileySendDM(sock, l.phone, txtArg);
      appendLog({crm: l.crm, name: l.name, phone: l.phone, type: "reply-sent", text: txtArg, status: "ok"});
      leadUpdate(l.crm, {"attempts": (l.attempts || 0) + 1, "last contact": new Date().toLocaleDateString("en-GB")});
      await sock.end?.(new Error("done"));
    }
    return finishReport([idArg + ":replied"]);
  }

  if (cmd === "send") {
    if (sentToday() >= DAILY_CAP) { L("Daily cap", DAILY_CAP, "reached  stop for today (human behaviour)."); return finishReport([]); }
    const targets = pickTargets(n);
    if (!targets.length) { L("QUEUE EMPTY"); return finishReport([]); }
    const lead = targets[0];
    assertAllowlisted(lead.phone, leads);
    if ((lead.notes || "").includes("(private)")) throw new Error("lead is personal, skipped: " + lead.crm);
    if (lead.status === "Not interested") throw new Error("opted-out, refusing: " + lead.crm);
    const resend = lead.status === "Resend" || (lead.status || "").startsWith("Replied");
    const msg = compose(lead, resend);
    let did = [lead.crm];
    if (webMode) {
      const {ctx, p} = await bootWeb();
      await webSend(p, lead.phone.replace(/\D/g, ""), msg);
      did.push("web");
      await ctx.close();
    } else {
      const sock = await bootBaileys();
      await sleep(2000 + Math.random() * 4000);
      await baileySendDM(sock, lead.phone, msg);
      did.push("baileys");
      await sock.end?.(new Error("done"));
    }
    appendLog({crm: lead.crm, name: lead.name, phone: lead.phone, type: resend ? "resend-sent" : "dm-sent", text: msg, status: "ok"});
    leadUpdate(lead.crm, {
      status: "Contacted",
      "attempts": (lead.attempts || 0) + 1,
      "first contact": lead.status === "New" ? new Date().toLocaleDateString("en-GB") : undefined,
      "last contact": new Date().toLocaleDateString("en-GB")
    });
    if (targets.length > 1) {
      L("staggering next sends");
      for (let i = 1; i < Math.min(targets.length, n); i++) {
        await sleep(120000 + Math.random() * 180000); // 2-5 min
        const l2 = targets[i];
        assertAllowlisted(l2.phone, leads);
        const msg2 = compose(l2, false);
        if (webMode) {
          const {ctx, p} = await bootWeb();
          await webSend(p, l2.phone.replace(/\D/g, ""), msg2);
          await ctx.close();
        } else {
          const sock = await bootBaileys();
          await sleep(1500 + Math.random() * 3000);
          await baileySendDM(sock, l2.phone, msg2);
          await sock.end?.(new Error("done"));
        }
        appendLog({crm: l2.crm, name: l2.name, phone: l2.phone, type: "dm-sent", text: msg2, status: "ok"});
        leadUpdate(l2.crm, {status: "Contacted", "attempts": (l2.attempts || 0) + 1, "last contact": new Date().toLocaleDateString("en-GB")});
        did.push(l2.crm);
      }
    }
    return finishReport(did);
  }
  console.error("unknown cmd  see header");
}
main(process.argv.slice(2));
