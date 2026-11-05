const {chromium}=require('@playwright/test');
(async()=>{
  const b=await chromium.launch();
  const p=await b.newPage({viewport:{width:390,height:844}});
  await p.goto('https://foodhubbie-qrmenu.web.app/?o=pizza&b=Foodhubbie-pizza&t=2B5YC71M1M5L654D');
  await p.waitForFunction(() => !!document.querySelector('.screen.active'), { timeout: 15000 });
  await p.evaluate(() => { if (!document.getElementById('screenMenu')?.classList.contains('active')) document.getElementById('btnStartOrdering')?.click(); });
  await p.waitForSelector('#screenMenu.active', { state: 'attached', timeout: 15000 });
  await p.waitForTimeout(1000);
  
  // Type a search term
  await p.fill('#dishSearchInput', 'pizza');
  await p.waitForTimeout(1000);
  
  // Check recent searches appeared
  const recentCount = await p.locator('.recent-search-chip').count();
  console.log('Recent searches count after typing pizza:', recentCount);
  
  // Click on the recent search chip
  if (recentCount > 0) {
    await p.locator('.recent-search-chip').first().click();
    await p.waitForTimeout(500);
    const inputValue = await p.locator('#dishSearchInput').inputValue();
    console.log('Input value after clicking recent search:', inputValue);
  }
  
  await b.close();
})();

