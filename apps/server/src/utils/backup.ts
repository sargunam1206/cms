import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import mongoose from 'mongoose';

const gzip = promisify(zlib.gzip);
const { EJSON } = mongoose.mongo.BSON;

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');

/** Writes every collection to one gzipped Extended-JSON file (keeps ObjectIds and Dates intact) and prunes old backups. */
export async function backupDatabase(dir: string, keep: number) {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Database not connected');
  await fs.mkdir(dir, { recursive: true });
  const data: Record<string, unknown[]> = {};
  for (const c of await db.listCollections().toArray()) {
    if (c.name.startsWith('system.')) continue;
    data[c.name] = await db.collection(c.name).find().toArray();
  }
  const file = path.join(dir, `cms-${stamp(new Date())}.json.gz`);
  await fs.writeFile(file, await gzip(EJSON.stringify(data, { relaxed: false })));

  const old = (await fs.readdir(dir)).filter((f) => /^cms-.*\.json\.gz$/.test(f)).sort().reverse().slice(keep);
  await Promise.all(old.map((f) => fs.rm(path.join(dir, f))));
  return { file, collections: Object.keys(data).length, pruned: old.length };
}

/** Replaces the contents of every collection in the backup. Destructive: callers must confirm first. */
export async function restoreDatabase(file: string) {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Database not connected');
  const raw = zlib.gunzipSync(await fs.readFile(file)).toString('utf8');
  const data = EJSON.parse(raw) as Record<string, object[]>;
  for (const [name, docs] of Object.entries(data)) {
    const col = db.collection(name);
    await col.deleteMany({});
    if (docs.length) await col.insertMany(docs as never[]);
  }
  return Object.keys(data).length;
}
