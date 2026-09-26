import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createServer } from 'node:net';

const dir = fileURLToPath(new URL('.', import.meta.url));
const rpc = 'http://127.0.0.1:18547';
// Refuse to run against a pre-existing process on the validation port.
await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(18547, '127.0.0.1', () => probe.close(resolve));
});
const args = [
  '--fork-url', process.env.ENS_REVIEW_UPSTREAM || 'https://ethereum-sepolia-rpc.publicnode.com',
  '--host', '127.0.0.1', '--port', '18547', '--no-storage-caching', '--silent',
];
if (process.env.ENS_REVIEW_BLOCK) args.push('--fork-block-number', process.env.ENS_REVIEW_BLOCK);
let log = '', child, spawnError;
const anvil = spawn(process.env.ENS_REVIEW_ANVIL || homedir() + '/.foundry/bin/anvil', args, {
  stdio: ['ignore', 'pipe', 'pipe'],
});
anvil.on('error', error => { spawnError = error; });
anvil.stdout.on('data', b => { log += b; });
anvil.stderr.on('data', b => { log += b; });
const stop = () => { child?.kill(); anvil.kill('SIGTERM'); };
const timer = setTimeout(stop, 180000);
const interrupt = () => { process.exitCode = 130; stop(); };
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
try {
  let ready = false;
  for (let n = 0; n < 100; n++) {
    if (spawnError) throw spawnError;
    if (anvil.exitCode !== null || anvil.signalCode !== null) throw new Error('Anvil exited: ' + log.slice(-1200));
    try {
      const r = await fetch(rpc, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'web3_clientVersion', params: [] }),
        signal: AbortSignal.timeout(1000),
      });
      const j = await r.json();
      if (j.result?.toLowerCase().includes('anvil')) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('Anvil did not become ready');
  child = spawn(process.execPath, [dir + 'fork-suite.mjs'], {
    cwd: dir, stdio: 'inherit', env: { ...process.env, ENS_REVIEW_MANAGED_FORK: '1' },
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  });
} finally {
  clearTimeout(timer);
  stop();
  writeFileSync(dir + 'anvil.log', log);
}
