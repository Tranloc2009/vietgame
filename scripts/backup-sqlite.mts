import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SqliteMatchStore } from '../src/server/db/sqliteStore';

function parseArg(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return null;
}

const sourceDb =
  parseArg('--db') ||
  process.env.SQLITE_DB_PATH ||
  path.resolve(process.cwd(), 'data/vdn-preview.sqlite');

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outPath =
  parseArg('--out') ||
  path.resolve(process.cwd(), 'backups', `vdn-backup-${stamp}.sqlite`);

if (!fs.existsSync(sourceDb)) {
  console.error(`[VDN Backup] Source SQLite file not found: ${sourceDb}`);
  process.exit(1);
}

const sourceStore = new SqliteMatchStore(sourceDb);
try {
  const backupResult = sourceStore.hotBackupToFile(outPath);
  const fileBuf = fs.readFileSync(backupResult.backupPath);
  const fileSha256 = crypto.createHash('sha256').update(fileBuf).digest('hex');

  // Open backup read-only/freshly to verify replay integrity of every stored match
  const verifyStore = new SqliteMatchStore(backupResult.backupPath);
  try {
    const matches = verifyStore.listMatches();
    let replayVerified = 0;
    const failedMatchIds: string[] = [];
    for (const m of matches) {
      const rep = verifyStore.verifyMatchReplay(m.matchId);
      if (rep?.verified) replayVerified += 1;
      else failedMatchIds.push(m.matchId);
    }

    const summary = {
      ok: failedMatchIds.length === 0 && backupResult.integrityOk,
      sourceDb,
      backupPath: backupResult.backupPath,
      sizeBytes: backupResult.sizeBytes,
      fileSha256,
      integrityCheck: backupResult.integrityOk ? 'ok' : 'failed',
      matchCount: matches.length,
      replayVerified,
      failedMatchIds,
      createdAtUtc: Date.now(),
    };
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.ok) process.exit(1);
  } finally {
    verifyStore.close();
  }
} finally {
  sourceStore.close();
}
