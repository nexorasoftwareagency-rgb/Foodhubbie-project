// scratch: build a temp served copy of Admin/dist with a push probe appended to sw.js
import fs from 'fs';
import path from 'path';
const root = process.argv[2];
const t = path.join(process.env.TEMP, 'fh-push-dist');
fs.rmSync(t, { recursive: true, force: true });
fs.cpSync(path.join(root, 'Admin/dist'), t, { recursive: true });
fs.appendFileSync(path.join(t, 'sw.js'),
  '\n// TEST PROBE (temp served copy only): visible evidence a push event reached this SW\n' +
  'self.addEventListener("push", function(e){ self.registration.showNotification("DBG-PUSH", {tag:"dbg-push", body: (e.data && e.data.text() || "").slice(0,300)}); });\n');
console.log('probe dist at', t);
