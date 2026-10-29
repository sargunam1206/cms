import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors';
import { logger } from '../config/logger';

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ message: 'Route not found' });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ message: err.message, details: err.details });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ message: 'Validation failed', details: err.flatten() });
  }
  if (err instanceof mongoose.Error.CastError) {
    return res.status(400).json({ message: `Invalid ${err.path}` });
  }
  if (err instanceof mongoose.Error.ValidationError) {
    return res.status(400).json({ message: err.message });
  }
  if (typeof err === 'object' && err && 'code' in err && err.code === 11000) {
    const keys = Object.keys((err as { keyValue?: object }).keyValue ?? {});
    return res.status(409).json({ message: `Duplicate value for ${keys.join(', ') || 'unique field'}` });
  }
  // body-parser / http-errors style client errors (payload too large, malformed JSON)
  const status = typeof err === 'object' && err ? (err as { status?: number; statusCode?: number }).status ?? (err as { statusCode?: number }).statusCode : undefined;
  if (status && status >= 400 && status < 500) {
    return res.status(status).json({ message: status === 413 ? 'Request body too large' : 'Bad request' });
  }
  logger.error({ err, path: req.path }, 'Unhandled error');
  res.status(500).json({ message: 'Internal server error' });
}
