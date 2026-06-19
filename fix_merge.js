const fs = require('fs');
let code = fs.readFileSync('public/8ball/assets/src/patch.js', 'utf8');

// The file has:
// <<<<<<< HEAD
// (Section N)
// (Section O)
// =======
// >>>>>>> parent of 9b2fc91...

// I will remove Section N entirely, keep Section O, and remove markers.
let res = code.replace(/<<<<<<< HEAD[\s\S]*?\/\* ─── N: Throttled\/Cached Guide Rendering ────────────────────── \*\/[\s\S]*?\/\* ─── O: Throttled UI & PIXI Property dirtying ───────────────── \*\//, '/* ─── O: Throttled UI & PIXI Property dirtying ─────────────── */');
res = res.replace(/=======[\s\S]*?>>>>>>> parent of 9b2fc91[^\n]*\n/, '');

fs.writeFileSync('public/8ball/assets/src/patch.js', res);
console.log('Fixed merge markers');
