// Google Maps restaurant lead scraper (Node Playwright — already-installed dep, no extra packages).
// Usage:   node tools/gmaps-lead-scraper.cjs "<narrow-area query>" [max] [deepen 0/1]
// Example: node tools/gmaps-lead-scraper.cjs "cafes in navrangpura ahmedabad" 10 1
//
// Usage rules (promo/README.md ground rules):
//  - geo-narrow queries (per neighbourhood), <= ~100 listings/day, random pacing (built in)
//  - output goes to promo/leads/ (gitignored — business contacts never committed)
//  - scraped leads are for FOUNDER-SENT individual outreach only; never route through bot/promo transport
const {chromium}=require(__dirname+'/../node_modules/playwright');
const fs=require('fs');
const path=require('path');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const q=process.argv[2]; if(!q){console.error('query arg required');process.exit(1);}
const max=parseInt(process.argv[3]||'10',10);
const deepen=process.argv[4]==='1';
const OUT=path.join(__dirname,'..','promo','leads');
fs.mkdirSync(OUT,{recursive:true});
const file=path.join(OUT,q.replace(/[^a-z0-9]+/gi,'-').toLowerCase()+'-'+new Date().toISOString().slice(0,10)+'.csv');
(async()=>{
 const ctx=await chromium.launchPersistentContext(path.join(process.env.TEMP,'opencode','gmaps-profile'),{headless:true,viewport:{width:1500,height:900},locale:'en-IN'});
 const p=ctx.pages()[0]||await ctx.newPage();
 try{
  await p.goto('https://www.google.com/maps/search/'+encodeURIComponent(q),{waitUntil:'domcontentloaded',timeout:60000});
  await sleep(4000+Math.random()*2000);
  const consent=p.locator('button:has-text("Accept all"), button[aria-label*="Accept"]').first();
  if(await consent.count()){await consent.click({timeout:4000}).catch(()=>{});await sleep(3000);}
  for(let i=0;i<12&&i<Math.max(1,Math.ceil(max/6));i++){
   await p.evaluate(()=>{const f=document.querySelector('div[role=feed]');if(f)f.scrollTo(0,f.scrollHeight);}).catch(()=>{});
   await sleep(2500+Math.random()*3500);
   if(await p.locator('a.hfpxzc').count().catch(()=>0)>=max)break;
  }
  let rows=await p.$$eval('a.hfpxzc',as=>as.map(a=>({name:a.getAttribute('aria-label')||'',href:a.href||'',rating:''}))).catch(()=>[]);
  rows=rows.filter(r=>r.name).slice(0,max);
  console.error('collected',rows.length,'listings');
  if(deepen)for(let i=0;i<rows.length;i++){
   console.error('   detail',i+1,rows[i].name.slice(0,40));
   await p.goto(rows[i].href,{waitUntil:'domcontentloaded'}).catch(()=>{});
   await sleep(3000+Math.random()*2500);
   const d=await p.evaluate(()=>{
    const pick=t=>{const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('aria-label')||'').startsWith(t));return b?b.getAttribute('aria-label').slice(t.length).replace(/[,](.*)$/,'').replace(/\)/g,'').trim():''};
    return {phone:pick('Phone:'), website:pick('Website:'), rating:(document.querySelector('span[role="img"][aria-label*="stars"]')?.getAttribute('aria-label')||''), addr:(document.querySelector('button[data-item-id*="address"]')?.getAttribute('aria-label')||'').replace(/^Address: /,'').replace(/\)?$/,'')};
   }).catch(()=>({phone:'',website:'',rating:'',addr:''}));
   Object.assign(rows[i],d);
   await p.goBack().catch(()=>{}); await sleep(2200+Math.random()*1800);
  }
  const cols=deepen?['name','rating','phone','website','addr','href']:['name','rating','href'];
  const esc=v=>'"'+(v||'').toString().replace(/"/g,'""')+'"';
  fs.writeFileSync(file,[cols.join(',')].concat(rows.map(r=>cols.map(c=>esc(r[c])).join(','))).join('\r\n'),'utf8');
  console.error('SAVED',file);
 }catch(e){console.error('err',e.message);process.exitCode=1;}
 await ctx.close();
})();
