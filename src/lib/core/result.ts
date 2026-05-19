/**
 * Result type for error handling without exceptions.
 * All failable operations return Result<T, E> instead of throwing.
 */
export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

/**
 * Create a success result
 */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/**
 * Create an error result
 */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/**
 * Unwrap result or throw (use sparingly - only at boundaries)
 */
export function unwrap<T>(result: Result<T>): T {
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

/**
 * Unwrap result with default value
 */
export function unwrapOr<T>(result: Result<T>, defaultValue: T): T {
  return result.ok ? result.value : defaultValue;
}

/**
 * Map success value to a new value
 */
export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/**
 * Map error value to a new error
 */
export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

/**
 * Chain async results (flatMap for Results)
 */
export async function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Promise<Result<U, E>>
): Promise<Result<U, E>> {
  return result.ok ? fn(result.value) : result;
}

/**
 * Wrap async function to catch exceptions and return Result
 */
export async function tryCatch<T>(fn: () => Promise<T>): Promise<Result<T, Error>> {
  try {
    return ok(await fn());
  } catch (e) {
    return err(toError(e));
  }
}

/**
 * Converts an unknown error to an Error instance.
 * Use this in catch blocks to safely convert caught values.
 */
export function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

/**
 * Collect multiple results into a single result with all values
 * Returns first error encountered or all values
 */
export function collect<T, E>(results: Result<T, E>[]): Result<T[], E> {
  const values: T[] = [];
  for (const result of results) {
    if (!result.ok) return result;
    values.push(result.value);
  }
  return ok(values);
}

/**
 * Check if result is ok (type guard)
 */
export function isOk<T, E>(result: Result<T, E>): result is { ok: true; value: T } {
  return result.ok;
}

/**
 * Check if result is error (type guard)
 */
export function isErr<T, E>(result: Result<T, E>): result is { ok: false; error: E } {
  return !result.ok;
}
