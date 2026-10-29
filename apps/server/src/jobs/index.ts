import cron from 'node-cron';
import { logger } from '../config/logger';
import { env } from '../config/env';
import { backupDatabase } from '../utils/backup';
import { inTz, now, TZ } from '../utils/time';
import { carryForward } from '../modules/leave/service';
import { finalizeMissedCheckouts } from '../modules/attendance/service';

export function startJobs() {
  // 00:15 office time: close yesterday's punches that never checked out
  cron.schedule(
    '15 0 * * *',
    async () => {
      try {
        const n = await finalizeMissedCheckouts();
        logger.info({ n }, 'Finalized missed check-outs');
      } catch (err) {
        logger.error(err, 'finalizeMissedCheckouts failed');
      }
    },
    { timezone: TZ },
  );

  // 00:30 on 1 January: roll last year's unused leave into this year's opening balances (idempotent)
  cron.schedule(
    '30 0 1 1 *',
    async () => {
      try {
        const year = inTz(now()).year() - 1;
        const r = await carryForward(year);
        logger.info(r, 'Leave carry-forward done');
      } catch (err) {
        logger.error(err, 'Leave carry-forward failed');
      }
    },
    { timezone: TZ },
  );

  // 01:00 daily database backup, only when BACKUP_DIR is set
  if (env.BACKUP_DIR) {
    cron.schedule(
      '0 1 * * *',
      async () => {
        try {
          logger.info(await backupDatabase(env.BACKUP_DIR!, env.BACKUP_KEEP), 'Database backup written');
        } catch (err) {
          logger.error(err, 'Database backup failed');
        }
      },
      { timezone: TZ },
    );
  }
}
