export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, msg, details);
export const unauthorized = (msg = 'Not authenticated') => new AppError(401, msg);
export const forbidden = (msg = 'Not allowed') => new AppError(403, msg);
export const notFound = (what = 'Resource') => new AppError(404, `${what} not found`);
export const conflict = (msg: string) => new AppError(409, msg);
export const locked = (msg: string) => new AppError(423, msg);
