// Derive the scrypt hash that src/server.js checks the admin password against.
//
//   npm run admin:hash
//
// Prompts rather than taking an argument, so the password does not end up in
// shell history or in the process list. Paste the output over
// ADMIN_PASSWORD_HASH in src/server.js — the hash is safe to commit, the
// password is not.
import { randomBytes, scryptSync } from 'node:crypto';
import readline from 'node:readline';

const N = 16384, r = 8, p = 1;

const ask = (q) => new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  // Echo off, so it is not readable over a shoulder or in a screen share.
  const wasRaw = process.stdin.isTTY;
  rl.output.write(q);
  rl._writeToOutput = () => {};
  rl.question('', (answer) => {
    rl.close();
    if (wasRaw) process.stdout.write('\n');
    resolve(answer);
  });
});

const pw = await ask('New admin password: ');
if (pw.length < 8) {
  console.error('Refusing: use at least 8 characters.');
  process.exit(1);
}
const again = await ask('Confirm: ');
if (pw !== again) {
  console.error('Refusing: the two entries differ.');
  process.exit(1);
}

const salt = randomBytes(16);
const hash = scryptSync(pw, salt, 32, { N, r, p, maxmem: 64 * 1024 * 1024 });
console.log('\nReplace ADMIN_PASSWORD_HASH in src/server.js with:\n');
console.log(`  'scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${hash.toString('base64url')}'\n`);
