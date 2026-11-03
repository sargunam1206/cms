import { createApp } from './app';
import { connectDb } from './config/db';
import { env } from './config/env';
import { logger } from './config/logger';
import { startJobs } from './jobs';

async function main() {
  await connectDb(env.MONGO_URI);
  startJobs();
  const server = createApp().listen(env.PORT, () => logger.info(`API listening on http://localhost:${env.PORT}`));
  // Node closes idle keep-alive connections after 5 s, which races with clients (and proxies such as nginx or a
  // load balancer) that reuse them and shows up as sporadic "connection reset" errors. Keep them open longer than
  // any proxy's idle timeout (commonly 60 s).
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
}

main().catch((err) => {
  logger.error(err, 'Failed to start');
  process.exit(1);
});
