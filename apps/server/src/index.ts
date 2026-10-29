import { createApp } from './app';
import { connectDb } from './config/db';
import { env } from './config/env';
import { logger } from './config/logger';
import { startJobs } from './jobs';

async function main() {
  await connectDb(env.MONGO_URI);
  startJobs();
  createApp().listen(env.PORT, () => logger.info(`API listening on http://localhost:${env.PORT}`));
}

main().catch((err) => {
  logger.error(err, 'Failed to start');
  process.exit(1);
});
