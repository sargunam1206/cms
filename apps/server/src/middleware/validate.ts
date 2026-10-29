import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';

type Part = 'body' | 'query' | 'params';

/** Replaces req[part] with the parsed (coerced, defaulted) value. */
export const validate =
  (schema: ZodTypeAny, part: Part = 'body') =>
  (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) return next(result.error);
    if (part === 'query') Object.defineProperty(req, 'query', { value: result.data });
    else req[part] = result.data;
    next();
  };
