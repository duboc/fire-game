// Optional, best-effort persistence of final results to Firestore.
//
// The whole live game runs in memory (Firestore's 1 write/s per document limit
// makes it unusable for the real-time loop). We only touch Firestore ONCE, when
// a round ends, to keep a history/leaderboard. If Firestore isn't configured or
// the dependency isn't installed, this is a no-op and the game is unaffected.

let firestorePromise = null;

function isEnabled() {
  // Enabled when explicitly turned on, or when running on GCP with a project.
  if (process.env.PERSIST === 'off') return false;
  return process.env.PERSIST === 'on' || !!process.env.GOOGLE_CLOUD_PROJECT;
}

async function getDb() {
  if (!firestorePromise) {
    firestorePromise = (async () => {
      const mod = await import('@google-cloud/firestore');
      const Firestore = mod.Firestore ?? mod.default?.Firestore ?? mod.default;
      return new Firestore();
    })();
  }
  return firestorePromise;
}

/**
 * Persists a finished round. Never throws — logs and resolves on any failure so
 * the game loop is never affected.
 * @param {object} results from Game.results()
 */
export async function persistResults(results) {
  if (!isEnabled()) return { persisted: false, reason: 'disabled' };
  try {
    const db = await getDb();
    const collection = process.env.FIRESTORE_COLLECTION || 'tap_race_rounds';
    const doc = db.collection(collection).doc();
    await doc.set({ ...results, savedAt: new Date().toISOString() });
    console.log(`[persist] round saved → ${collection}/${doc.id}`);
    return { persisted: true, id: doc.id };
  } catch (err) {
    console.error('[persist] failed (game unaffected):', err?.message || err);
    return { persisted: false, reason: 'error' };
  }
}

export const persistence = { isEnabled };
