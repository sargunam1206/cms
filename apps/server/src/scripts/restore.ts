import { connectDb, disconnectDb } from '../config/db';
import { env } from '../config/env';
import { restoreDatabase } from '../utils/backup';

const [file, flag] = process.argv.slice(2);
if (!file || flag !== '--yes') {
  console.error('Usage: tsx --env-file=.env src/scripts/restore.ts <backup.json.gz> --yes\nThis REPLACES the data in the database named in MONGO_URI.');
  process.exit(1);
}
connectDb(env.MONGO_URI)
  .then(() => restoreDatabase(file))
  .then((n) => console.log(`Restored ${n} collections from ${file} into ${env.MONGO_URI}`))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(disconnectDb);
