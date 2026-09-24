// Thrown by validation helpers; the global error handler in app.ts turns it into
// `res.status(err.status).json({ error: err.message })`.
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
