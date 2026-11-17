import type { Server as HttpServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { User } from '../users/model';

let io: Server | null = null;
const room = (userId: unknown) => `user:${String(userId)}`;

/**
 * Real-time channel for the bell. A connection must present a valid access token; it joins only its own room,
 * so nobody can listen to anyone else's notifications. The connection is closed when the token expires and the
 * client reconnects with a fresh one. Without a connection the app simply refreshes the bell on a timer.
 */
export function initRealtime(server: HttpServer) {
  io = new Server(server, { cors: { origin: env.CLIENT_ORIGIN, credentials: true }, serveClient: false });

  io.use(async (socket, next) => {
    try {
      const token = (socket.handshake.auth as { token?: string })?.token;
      if (!token) return next(new Error('Not authenticated'));
      const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as { sub: string; exp: number };
      const user = await User.findById(payload.sub).select('status').lean();
      if (!user || user.status !== 'active') return next(new Error('Account disabled'));
      socket.data.userId = payload.sub;
      socket.data.exp = payload.exp;
      next();
    } catch {
      next(new Error('Session expired'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(room(socket.data.userId));
    const ms = Math.max(1000, socket.data.exp * 1000 - Date.now());
    const timer = setTimeout(() => socket.disconnect(true), ms);
    socket.on('disconnect', () => clearTimeout(timer));
  });
  logger.info('Real-time notifications ready');
  return io;
}

export function emitToUser(userId: unknown, event: string, payload: unknown) {
  io?.to(room(userId)).emit(event, payload);
}

export async function closeRealtime() {
  if (io) await io.close();
  io = null;
}
