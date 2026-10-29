import { connectDb, disconnectDb } from '../config/db';
import { env } from '../config/env';
import { backupDatabase } from '../utils/backup';

connectDb(env.MONGO_URI)
  .then(() => backupDatabase(env.BACKUP_DIR ?? './backups', env.BACKUP_KEEP))
  .then((r) => console.log(`Backup written: ${r.file} (${r.collections} collections, ${r.pruned} old removed)`))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(disconnectDb);
