/**
 * Operational errors crossing profile lifecycle boundaries.
 * CLI code classifies these once at its top-level boundary.
 */

export class LifecycleError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.name = this.constructor.name;
    this.exitCode = exitCode;
  }
}

export class ArgumentError extends LifecycleError {
  constructor(message) {
    super(message, 2);
  }
}

export class MissingError extends LifecycleError {
  constructor(message) {
    super(message, 3);
  }
}

export class ExistsError extends LifecycleError {
  constructor(message) {
    super(message, 4);
  }
}

export class InvalidProfileError extends LifecycleError {
  constructor(message) {
    super(message, 5);
  }
}

export class LockUnavailableError extends LifecycleError {
  constructor(message) {
    super(message, 6);
  }
}

/**
 * @param {unknown} error
 * @returns {number}
 */
export function exitCodeFor(error) {
  return error instanceof LifecycleError ? error.exitCode : 1;
}
