// wa-sales-agent — personalized 1:1 WhatsApp outreach to the scraped restaurant leads ONLY.
//
// APPOINTMENT: sales agent for Restaurant Lead Data leads. No other contact is ever
//   readable or writable — allowlisted numbers only, enforced at every call site.
//
// Rails (do not remove):
//   - ONE DM per run by default (--n N staggers 5-14s apart); daily cap counts ALL outbound
//   - human pacing: composing presence 4-9s before send; 5-14s RANDOM gap between every send
//   - opt-out detector on any reply -> status "Not interested", lead frozen forever
//   - FAQ auto-answer (single shared baileys session); else replySummary="needsHuman…" -> send run prefers it with DM-#2 resend copy
//   - engines: baileys = send (session persists in .wa-sales-auth, no rescan)
//              web    = read replies (+ fallback sender), paired once in a window
//   - web reader ONLY accepts incoming bubbles (skips "You:" outgoing echoes — never self-answer)
//   - errors per lead are isolated (bad number -> Unreachable/Wrong no, never spins forever)
//
// Commands (run from repo root):
//   node tools/wa-sales-agent.cjs sync               # ensure CRM ids (LD001..) in workbook
//   node tools/wa-sales-agent.cjs dry                # queue + next message text, nothing sent
//   node tools/wa-sales-agent.cjs send               # ONE DM (baileys)
//   node tools/wa-sales-agent.cjs send --n 3         # 3 staggered DMs (5-14s apart)
//   node tools/wa-sales-agent.cjs send --web         # send via WhatsApp Web instead
//   node tools/wa-sales-agent.cjs check              # read replies (web), log + answer FAQs
//   node tools/wa-sales-agent.cjs reply --id LD007 --text "..." [--web]   # tracked manual reply
// Every run updates the Excel tracker at the end ("Report Entry in Excel, then close").
const {chromium} = require("../node_modules/playwright");
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const {makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion} =
  require(path.join(ROOT, "bot", "node_modules", "@whiskeysockets", "baileys"));
const pino = require(path.join(ROOT, "bot", "node_modules", "pino"));
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
// owner rule: 5-14s random gap between EVERY message send
const HUMAN_GAP = () => 5000 + Math.random() * 9000;
const L = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ---------- io ----------
function leadRead() {
  try {
    return JSON.parse(execFileSync("python", [path.join(__dirname, "wa-lead-io.py"), "read", XLSX], {encoding: "utf8", maxBuffer: 1e7}));
  } catch (e) {
    if (/Permission/.test(e.message)) throw new Error("Excel has the workbook open — close it and re-run.");
    throw e;
  }
}
function leadUpdate(crm, patch) {
  try {
    return execFileSync("python", [path.join(__dirname, "wa-lead-io.py"), "update", XLSX, JSON.stringify({crm, patch})], {encoding: "utf8"});
  } catch (e) {
    if (/Permission/.test(e.message)) throw new Error("Excel has the workbook open — close it and re-run.");
    throw e;
  }
}
function csvField(v) {
  let s = String(v ?? "").replace(/[\r\n]+/g, " ⏎ ").replace(/"/g, "'");
  if (/^[=+\-@]/.test(s)) s = "'" + s; // csv-formula injection guard
  return `"${s}"`;
}
function appendLog(rec) {
  const exists = fs.existsSync(LOG);
  // fixed field order so CSV columns stay aligned
  const row = [new Date().toISOString(), rec.crm || "", rec.name || "", rec.phone || "", rec.type || "",
               (String(rec.text || "")).replace(/[\r\n]+/g, " ⏎ ").replace(/"/g, "'"), rec.status || ""]
              .map(csvField).join(",");
  fs.writeFileSync(LOG, (exists ? "" : 'ts,crm,name,phone,type,text,status\n') + row + "\n", {flag: "a", encoding: "utf8"});
}
function sentToday() {
  if (!fs.existsSync(LOG)) return 0;
  const d = new Date().toISOString().slice(0, 10);
  return fs.readFileSync(LOG, "utf8").split("\n").filter(l => l.includes(d) && /dm[123]|dm-sent|resend-sent|reply-sent|auto-answer/.test(l)).length;
}

// ---------- messaging ----------
// hooks: ONE tailored benefit per outlet type (outcome first, not a feature dump)
const HOOKS = {
  cafe: "guest QR scan karke order karta hai — kitchen tak seedha pahunch jaata hai, no waiter-runner",
  bakery: "counter billing aur table order ek hi dashboard mein saath-saath chalte hain",
  "fine dining": "table ka QR order aur counter ka bill ek hi dashboard mein live sync hote hain",
  qsr: "counter billing sabse fast — 1 order = ₹1, table QR bhi included",
  restaurant: "dine-in table orders aur counter billing ek hi screen par aate hain"
};
const INTRO = {
  cafe: "Café chalata hai to billing aur table orders ek jagah hona kaam bahut aasan karta hai.",
  bakery: "Bakery ke counter billing aur table orders ek jagah manage ho to din aasan hota hai.",
  "fine dining": "Fine dining mein table orders aur bill ek dashboard mein dekhna bahut aasan karta hai.",
  qsr: "Fast service outlet mein speed hi sab kuch hai — billing aur orders simple hone chahiye.",
  restaurant: "Restaurant ka poora order-flow ek dashboard mein — counter, table QR, WhatsApp aur kitchen."
};
const greetFor = l => (l.ownerName ? l.ownerName + " ji" : "");
function outletKeyOf(l) {
  const t = (l.outletType || "").toLowerCase();
  return (t.includes("cafe") || t.includes("bakery")) ? "cafe"
      : t.includes("fine") ? "fine dining"
      : t.includes("quick") ? "qsr" : "restaurant";
}
// 3-message sequence (attempts-aware): intro -> demo invite (day 3) -> final (day 7), then stop.
// No "Manager sahab" — natural greeting; trial is always "pay after 10 days" so it stays consistent.
function compose(l) {
  const hook = HOOKS[outletKeyOf(l)];
  const intro = INTRO[outletKeyOf(l)];
  const a = l.attempts || 0;
  if (a >= 2) {
    return [
      `Hi 🙏 Nilesh yahan — FoodHubbie se aakhri follow-up.`,
      ``,
      `Billing/ordering ko aasan karna kabhi zaroori ho to system ready hai:`,
      `🌐 ${SITE}`,
      ``,
      `Ab aapke taraf se message nahi aayega. Interest kabhi bade to bas *"demo"* likh dijiye.`
    ].join("\n");
  }
  if (a >= 1) {
    return [
      `Hi 🙏 ${greetFor(l)}, Nilesh — FoodHubbie wale, pichhle message pe follow-up.`,
      ``,
      `Ek chhota demo dikha doon — billing, QR orders aur kitchen sab *saath chalte hue*, aapke hi menu se. 10 min.`,
      ``,
      `Pehle video walkthrough? 32-sec ka hai:`,
      `${VIDEO_URL}`,
      ``,
      `*Live demo* ya *video* — jo aapke liye aasan ho, bas bata dijiye.`
    ].join("\n");
  }
  return [
    `Namaste 🙏${greetFor(l) ? " " + greetFor(l) : ""}`,
    ``,
    `Main Nilesh, *FoodHubbie* se.`,
    ``,
    intro,
    `Aapke liye seedhi baat: ${hook}.`,
    ``,
    `*Pay-per-order pricing:*`,
    `• Counter billing — ₹1/order`,
    `• Table QR — ₹2/order`,
    `• WhatsApp order — ₹5/order`,
    `• Kitchen screen + reports — included`,
    ``,
    `Monthly fee *zero*. Setup ₹500 one-time, first bill mein adjust.`,
    `Cancelled order ka charge nahi.`,
    ``,
    `10-min ka demo aapke hi menu pe de doon? Bas *"haan"* likh dijiye.`,
    ``,
    `🌐 ${SITE}`
  ].join("\n");
}
const OPTOUT = /(stop|band karo|nahi chahiye|not interested|mat bhejo|raha nahi|unsub)/i;
const isOptOut = t => OPTOUT.test(t || "");
const faqAnswer = t => {
  if (/price|kitn(a|e)|charge|rate|monthly|fees/i.test(t))
    return [
      `Sure — puri pricing:`,
      ``,
      `• Counter billing — ₹1/order`,
      `• Table QR — ₹2/order`,
      `• WhatsApp order — ₹5/order`,
      `• Monthly subscription — ₹0`,
      `• One-time setup — ₹500 (first bill mein adjust)`,
      ``,
      `Cancelled order ka charge nahi lagta.`,
      `Chhota demo de doon? "haan" likh dijiye.`
    ].join("\n");
  if (/demo|dikha/i.test(t))
    return [
      `Absolutely! 😊`,
      ``,
      `Aapke hi restaurant ka menu use karke dikhata hoon — asli flow samajh aayega. Takreeban 10 min lagte hain.`,
      ``,
      `Kaunsa day aur time aapke liye aasan hai?`
    ].join("\n");
  if (/k[aie]se|kaam karta|kya hai|video/i.test(t))
    return [
      `FoodHubbie billing, table QR ordering, WhatsApp orders, kitchen screen aur reports — sab ek dashboard mein laata hai.`,
      ``,
      `Website: ${SITE}`,
      ``,
      `32-sec video walkthrough: ${VIDEO_URL}`,
      `Live demo bhi dikha sakta hoon.`
    ].join("\n");
  return null;
};

// ---------- allowlist guard + queue ----------
const daysSince = dmy => {
  if (!dmy) return -1;
  const p = String(dmy).split("/").map(Number);
  if (p.length < 3 || p.some(isNaN)) return -1;
  return Math.round((Date.now() - Date.UTC(p[2], p[1] - 1, p[0])) / 864e5);
};
function pickTargets(n) {
  const leads = leadRead().filter(l =>
      l.phone && !/^Duplicate$/.test(l.status || "") && l.status !== "Not interested" && (l.attempts || 0) < 3);
  const pendingReply = leads.filter(l => (l.replySummary || "").startsWith("needsHuman"));
  const dm2Due = leads.filter(l => (l.attempts || 0) === 1 && daysSince(l.lastContact) >= 3);
  const dm3Due = leads.filter(l => (l.attempts || 0) === 2 && daysSince(l.lastContact) >= 7);
  const manual = leads.filter(l => l.status === "Resend" && (l.attempts || 0) > 0); // manual mark jumps the wait
  const fresh = leads.filter(l => l.status === "New");
  // sequence-due follow-ups outrank cold starts
  return [...pendingReply, ...dm2Due, ...dm3Due, ...manual, ...fresh].slice(0, n);
}
function assertAllowlisted(phone, leads) {
  const want = String(phone).replace(/\D/g, "");
  if (!leads.some(l => String(l.phone || "").replace(/\D/g, "").endsWith(want)))
    throw new Error("REFUSED: number not in Restaurant Lead Data allowlist: " + phone);
}
function markUnreachable(crm) {
  leadUpdate(crm, {"status": "Unreachable/Wrong no"});
  appendLog({crm, type: "unreachable", status: "not-on-whatsapp"});
}

// ---------- baileys engine ----------
async function bootBaileys() {
  fs.mkdirSync(AUTH, {recursive: true});
  const creds = path.join(AUTH, "creds.json");
  for (let attempt = 0; attempt < 6; attempt++) {
    const {state, saveCreds} = await useMultiFileAuthState(AUTH);
    const {version} = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
      version, auth: state, printQRInTerminal: false, markOnlineOnConnect: false, syncFullHistory: false,
      logger: pino({level: "silent"})
    });
    sock.ev.on("creds.update", saveCreds); // BEFORE connection events, or pairing tokens are lost
    if (attempt === 0) L(fs.existsSync(creds) && (()=>{try{return JSON.parse(fs.readFileSync(creds,"utf8")).registered}catch{return false}})()
      ? "connecting with saved session…" : "waiting for QR scan…");
    const ok = await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("connect timeout — QR not scanned in 5 min")), 300000);
      sock.ev.on("connection.update", u => {
        if (u.qr && !fs.existsSync(creds)) { L("QR — WhatsApp ▸ Devices ▸ Link a device me scan karein:"); qrterm.generate(u.qr, {small: true}); }
        if (u.connection === "open") { clearTimeout(t); res(true); }
        if (u.connection === "close") {
          clearTimeout(t);
          const code = u.lastDisconnect?.error?.output?.statusCode;
          if (code === 515) { L("server restart after pairing (515) — reconnecting with saved session…"); setTimeout(() => res(false), 2500); }
          else rej(new Error("closed: " + code + " (baileys.wiki/connection-errors)"));
        }
      });
    });
    if (ok) return sock;
    try { sock.end?.(new Error("retrying")); } catch {}
    await sleep(2500);
  }
  throw new Error("could not stabilise after pairing");
}
async function baileySendDM(sock, phone, text) {
  const r = await sock.onWhatsApp(String(phone).replace(/\s/g, ""));
  if (!r || !r.length) { const e = new Error("not on WhatsApp: " + phone); e.code = "NOT_ON_WA"; throw e; }
  const jid = r[0].jid;
  await sock.sendPresenceUpdate("composing", jid);
  await sleep(4000 + Math.random() * 5000);
  await sock.sendMessage(jid, {text});
  return jid;
}
async function sendTracked(sock, lead, text, kind) {
  // one shared helper: allowlist -> send -> log -> workbook (never bypass these steps)
  assertAllowlisted(lead.phone, JSON.parse(execFileSync("python", [path.join(__dirname, "wa-lead-io.py"), "read", XLSX], {encoding: "utf8"})));
  try {
    await baileySendDM(sock, lead.phone, text);
  } catch (e) {
    if (e.code === "NOT_ON_WA") { markUnreachable(lead.crm); return false; }
    throw e;
  }
  appendLog({crm: lead.crm, name: lead.name, phone: lead.phone, type: kind, text, status: "ok"});
  return true;
}

// ---------- web engine (reader) ----------
async function bootWeb({headless = false} = {}) {
  const dir = path.join(process.env.TEMP, "opencode", "wa-web-profile");
  const ctx = await chromium.launchPersistentContext(dir, {channel: "chrome", headless, args: ["--disable-blink-features=AutomationControlled"]});
  const p = ctx.pages()[0] || await ctx.newPage();
  await p.goto("https://web.whatsapp.com/", {waitUntil: "domcontentloaded", timeout: 60000}).catch(() => {});
  L("WhatsApp Web opening… (paired window stays; scan once if asked)");
  const ready = await p.waitForSelector('div[role="list"]', {timeout: 45000}).then(() => true).catch(() => null);
  if (!ready) {
    L("pairing needed — scan the QR in the opened window (5 min)");
    await p.waitForSelector('div[role="list"]', {timeout: 300000});
  }
  return {ctx, p};
}
async function webOpenChat(p, phone) {
  await p.goto(`https://web.whatsapp.com/send?phone=${phone}&type=phone_number&app_absent=0`, {waitUntil: "domcontentloaded", timeout: 60000}).catch(() => {});
  await p.waitForSelector('[id="main"], div[title="Type a message"]', {timeout: 45000});
  await p.waitForTimeout(2500);
}
async function webReadLastIncoming(p, phone) {
  await webOpenChat(p, phone);
  const pre = await p.$$eval('[data-pre-plain-text]', els =>
      els.slice(-6).map(e => e.getAttribute("data-pre-plain-text") + "\u0001" + (e.querySelector("span.selectable-text")?.textContent || "")));
  for (let i = pre.length - 1; i >= 0; i--) {
    const item = pre[i], meta = item.split("\u0001")[0] || "";
    const body = (item.split("\u0001")[1] || "").trim();
    if (!body) continue;
    if (/:\s*You:/.test(meta) || /You:/.test(meta.split(/\]\s*/)[1] || "")) continue; // our own echo — never treat as reply
    return body.slice(0, 220);
  }
  return null;
}
async function webSend(p, phone, text) {
  await webOpenChat(p, phone);
  const box = p.locator('div[title="Type a message"]');
  await box.click();
  await p.keyboard.type(text, {delay: 40 + Math.random() * 30});
  await p.keyboard.press("Enter");
  await p.waitForTimeout(2500);
}

// ---------- run phases ----------
function finishReport(did) {
  L("Done this run:", did.join(" | ") || "(nothing)");
  L("Excel updated. Session closed. Log:", LOG);
}
async function main(argv) {
  const cmd = argv[0];
  const n = argv.includes("--n") ? Math.max(1, parseInt(argv[argv.indexOf("--n") + 1], 10)) : 1;
  const webMode = argv.includes("--web");
  const idArg = argv.includes("--id") ? argv[argv.indexOf("--id") + 1] : null;
  const txtArg = argv.includes("--text") ? argv[argv.indexOf("--text") + 1] : null;
  const leads = leadRead();
  const today = () => new Date().toLocaleDateString("en-GB");
  const did = [];

  if (cmd === "sync") { did.push("crm: " + leads.filter(l => l.crm).length); return finishReport(did); }

  if (cmd === "dry") {
    for (const l of leads.slice(0, 6)) console.log(" ", l.crm, l.status, String(l.name).slice(0, 34), l.phone);
    const t = pickTargets(n);
    if (!t.length) { console.log("QUEUE EMPTY"); return finishReport([]); }
    console.log("\nNEXT UP:", t[0].crm, "->", t[0].ownerName || "-", "(pending:" + t[0].status + ", attempts:" + (t[0].attempts || 0) + ")\n---\n" + compose(t[0]));
    return finishReport([]);
  }

  if (cmd === "check") {
    const {ctx, p} = await bootWeb();
    let sock = null;
    const needSock = async () => sock || (sock = await bootBaileys());
    for (const l of leads.filter(l => l.phone && ![ "Not interested", "Duplicate", "Unreachable/Wrong no"].includes(l.status)).slice(0, 12)) {
      assertAllowlisted(l.phone, leads);
      let last = null;
      try { last = await webReadLastIncoming(p, l.phone.replace(/\D/g, "")); }
      catch (e) { did.push(l.crm + ":no-chat/" + e.message.split("\n")[0].slice(0, 40)); continue; }
      const cur = (l.replySummary || "");
      if (!last || last === cur) { did.push(l.crm + (last ? ":same" : ":none")); continue; }
      appendLog({crm: l.crm, name: l.name, phone: l.phone, type: "reply-in", text: last, status: "logged"});
      did.push(l.crm + ":replied");
      if (isOptOut(last)) {
        leadUpdate(l.crm, {"reply summary": last, "status": "Not interested", "outcome": "Not interested", "last contact": today()});
        did.push(l.crm + ":OPTOUT");
        continue;
      }
      leadUpdate(l.crm, {"reply summary": last, "last contact": today()});
      const ans = faqAnswer(last);
      if (ans) {
        const okS = await needSock().then(async s => {
          await sleep(HUMAN_GAP());                       // 5-14s gap before this send
          return sendTracked(s, l, ans, "auto-answer");
        });
        if (okS) { leadUpdate(l.crm, {"status": "Replied", "attempts": (l.attempts || 0)}); did.push(l.crm + ":faq-answered"); }
      } else {
        leadUpdate(l.crm, {"status": "Replied", "reply summary": "needsHuman: " + last});
        did.push(l.crm + ":needsHuman");
      }
      await sleep(4000 + Math.random() * 6000);           // reading pacing between chats
    }
    if (sock) await sock.end?.(new Error("done"));
    await ctx.close();
    return finishReport(did);
  }

  if (cmd === "reply") {
    if (!idArg || !txtArg) throw new Error("reply needs --id LD### --text \"...\"");
    const l = leads.find(x => x.crm === idArg);
    if (!l) throw new Error("unknown CRM: " + idArg);
    assertAllowlisted(l.phone, leads);
    await sleep(HUMAN_GAP());                             // 5-14s gap before this send
    if (webMode) {
      const {ctx, p} = await bootWeb();
      await webSend(p, l.phone.replace(/\D/g, ""), txtArg);
      await ctx.close();
    } else {
      const sock = await bootBaileys();
      await baileySendDM(sock, l.phone, txtArg);
      await sock.end?.(new Error("done"));
    }
    appendLog({crm: l.crm, name: l.name, phone: l.phone, type: "reply-sent", text: txtArg, status: "ok"});
    leadUpdate(l.crm, {"attempts": (l.attempts || 0) + 1, "last contact": today()});
    return finishReport([l.crm + ":replied"]);
  }

  if (cmd === "send") {
    if (sentToday() >= DAILY_CAP) { L("Daily cap", DAILY_CAP, "reached — stop for today (human behaviour)."); return finishReport([]); }
    const targets = pickTargets(n);
    if (!targets.length) { L("QUEUE EMPTY"); return finishReport([]); }
    const lead = targets[0];
    assertAllowlisted(lead.phone, leads);
    if (lead.status === "Not interested") throw new Error("opted-out, refusing: " + lead.crm);
    const kind = ["dm1", "dm2", "dm3"][lead.attempts || 0]; // attempts 0->dm1, 1->dm2, 2->dm3
    const msg = compose(lead);
    if (webMode) {
      const {ctx, p} = await bootWeb();
      await webSend(p, lead.phone.replace(/\D/g, ""), msg);
      await ctx.close();
      appendLog({crm: lead.crm, name: lead.name, phone: lead.phone, type: kind, text: msg, status: "ok"});
      leadUpdate(lead.crm, {status: "Contacted", "attempts": (lead.attempts || 0) + 1, "first contact": lead.status === "New" ? today() : undefined, "last contact": today()});
      did.push(lead.crm + ":web");
    } else {
      const sock = await bootBaileys();
      const okS = await sendTracked(sock, lead, msg, kind);
      if (okS) leadUpdate(lead.crm, {status: "Contacted", "attempts": (lead.attempts || 0) + 1, "first contact": lead.status === "New" ? today() : undefined, "last contact": today()});
      did.push(lead.crm + (okS ? ":baileys" : ":unreachable"));
      if (targets.length > 1) {
        L("staggering remaining sends…");
        for (let i = 1; i < Math.min(targets.length, n); i++) {
          await sleep(HUMAN_GAP());                       // 5-14s random gap (owner rule) — EVERY send
          const l2 = targets[i];
          assertAllowlisted(l2.phone, leads);
          const ok2 = await sendTracked(sock, l2, compose(l2), ["dm1", "dm2", "dm3"][l2.attempts || 0]);
          if (ok2) leadUpdate(l2.crm, {status: "Contacted", "attempts": (l2.attempts || 0) + 1, "first contact": l2.status === "New" ? today() : undefined, "last contact": today()});
          did.push(l2.crm + (ok2 ? ":ok" : ":unreachable"));
        }
      }
      await sock.end?.(new Error("done"));
    }
    return finishReport(did);
  }

  console.error("unknown cmd — see header");
}
main(process.argv.slice(2)).catch(e => { console.error("ERROR:", e.message); process.exit(1); });
