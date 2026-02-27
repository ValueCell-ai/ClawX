/**
 * Application quit state.
 *
 * Exposed as a function accessor (not a bare `export let`) so that every
 * import site reads the *live* value.  With `export let`, bundlers that
 * compile to CJS may snapshot the variable at import time, causing
 * `isQuitting` to stay `false` forever and preventing the window from
 * closing on Windows/Linux.
 */
let _isQuitting = false;

export function isQuitting(): boolean {
  return _isQuitting;
}

export function setQuitting(value = true): void {
  _isQuitting = value;
}
