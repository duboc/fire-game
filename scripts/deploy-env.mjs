// Write the Cloud Run env file deploy.sh passes to `gcloud run deploy
// --env-vars-file` (JSON is valid YAML). It replaces the service's whole env,
// which also clears any ADMIN_TOKEN a previous deploy left behind.
//
//   node scripts/deploy-env.mjs OUT.json
//
// Reads APPS and PERSIST from the environment. If VOTE_NAMES_FILE (default
// vote-names.txt — git-ignored, the event's real list) exists, its names go in
// as VOTE_NAMES after the same validation the server runs at boot, so a broken
// list stops the deploy here instead of crash-looping the new revision.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { Vote } from '../src/vote.js';
import { SEED_CATEGORIES } from '../src/vote-seed.js';

const out = process.argv[2];
if (!out) {
  console.error('usage: node scripts/deploy-env.mjs OUT.json');
  process.exit(2);
}
const env = { PERSIST: process.env.PERSIST || 'off', APPS: process.env.APPS || 'all' };
const file = process.env.VOTE_NAMES_FILE || 'vote-names.txt';
if (existsSync(file)) {
  const names = readFileSync(file, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  try {
    new Vote({ names, categories: SEED_CATEGORIES }); // throws on duplicates, lengths, bounds
  } catch (err) {
    console.error(`Refusing to deploy: ${file} — ${err.message}`);
    process.exit(1);
  }
  env.VOTE_NAMES = names.join('\n');
  console.error(`Vote names: ${names.length} from ${file}`);
} else {
  console.error(`Vote names: built-in sample list (no ${file})`);
}
writeFileSync(out, JSON.stringify(env));
