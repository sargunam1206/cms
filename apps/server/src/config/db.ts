import mongoose from 'mongoose';
import { logger } from './logger';

export async function connectDb(uri: string) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  logger.info({ db: mongoose.connection.name }, 'MongoDB connected');
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
