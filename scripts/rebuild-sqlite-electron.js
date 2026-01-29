const { spawnSync } = require('child_process');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status);
}

// Read your installed electron version
const electronPkg = require('../node_modules/electron/package.json');
const electronVersion = electronPkg.version;

console.log('[rebuild] electron version:', electronVersion);

run('npm', [
  'rebuild',
  'better-sqlite3',
  '--runtime=electron',
  `--target=${electronVersion}`,
  '--dist-url=https://electronjs.org/headers',
  '--build-from-source'
]);

console.log('[rebuild] done');