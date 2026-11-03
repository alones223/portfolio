/**
 * One-click portfolio launcher (Windows / macOS / Linux).
 * Usage: node scripts/open-site.js [--admin] [--no-browser]
 */
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const root = path.resolve(__dirname, '..');
const wantAdmin = process.argv.includes('--admin');
const noBrowser = process.argv.includes('--no-browser');
const port = Number(process.env.PORT || 3000);
const url = wantAdmin
  ? `http://localhost:${port}/admin`
  : `http://localhost:${port}/`;

function log(msg) {
  process.stdout.write(`${msg}\n`);
}

function whichNode() {
  try {
    return execSync(process.platform === 'win32' ? 'where node' : 'which node', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split(/\r?\n/)
      .find(Boolean);
  } catch {
    return null;
  }
}

function probe(timeoutMs = 800) {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: '127.0.0.1', port, path: '/', timeout: timeoutMs },
      (res) => {
        res.resume();
        resolve(Boolean(res.statusCode && res.statusCode < 500));
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function openBrowser(target) {
  if (noBrowser) return;
  const plat = process.platform;
  try {
    if (plat === 'darwin') {
      spawn('open', ['-a', 'Google Chrome', target], { detached: true, stdio: 'ignore' }).unref();
    } else if (plat === 'win32') {
      spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (err) {
    log(`Could not open browser: ${err.message}`);
    log(`Open manually: ${target}`);
  }
}

function ensureDeps() {
  const nm = path.join(root, 'node_modules');
  if (fs.existsSync(nm)) return;
  log('Installing dependencies (first run)...');
  execSync('npm install', { cwd: root, stdio: 'inherit' });
}

async function waitReady(ms = 20000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (await probe()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  process.chdir(root);

  if (!whichNode()) {
    log('Node.js not found. Install Node 20+ from https://nodejs.org then run this again.');
    process.exit(1);
  }

  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) {
    log(`Node ${process.versions.node} is too old. Need Node 20+.`);
    process.exit(1);
  }

  ensureDeps();

  if (await probe()) {
    log(`Already running -> ${url}`);
    openBrowser(url);
    return;
  }

  log(`Starting portfolio on port ${port}...`);
  const child = spawn(
    process.execPath,
    ['--env-file-if-exists=.env', 'server.js'],
    {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      env: process.env,
    }
  );
  child.unref();

  if (!(await waitReady())) {
    log('Server did not become ready in time. Check logs.');
    process.exit(1);
  }

  log(`Ready -> ${url}`);
  openBrowser(url);
}

main().catch((err) => {
  log(err.stack || String(err));
  process.exit(1);
});