export class AppError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 429 | 502 | 503,
    public code: string,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}
export function notFound() {
  return new AppError(404, 'NOT_FOUND', 'The requested record was not found.');
}
