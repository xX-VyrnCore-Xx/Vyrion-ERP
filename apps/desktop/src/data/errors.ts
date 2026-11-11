export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Field-level problems, keyed by field name ("_" for problems of the record as a whole). */
export class ValidationError extends AppError {
  constructor(readonly errors: Record<string, string>) {
    super(Object.values(errors).join("; ") || "Dati non validi", "validation");
  }
}

export class NotFoundError extends AppError {
  constructor(what = "Record") {
    super(`${what} non trovato`, "not_found");
  }
}

/** The change collides with the current state (duplicate, still in use, wrong status...). */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, "conflict");
  }
}

/** Someone changed the record since it was read. */
export class VersionConflictError extends AppError {
  constructor(
    readonly expected: number,
    readonly current: number,
  ) {
    super("Il record è stato modificato da un'altra operazione", "version_conflict");
  }
}

/** The record is final (e.g. an issued invoice) and cannot be changed. */
export class LockedError extends AppError {
  constructor(reason: string) {
    super(reason, "locked");
  }
}
