/**
 * Silently swallows ENOENT/ENOTDIR (routine filesystem races), but logs a
 * warning for any other error code so genuine permission / fd-exhaustion
 * problems leave a breadcrumb.
 */
export function warnUnlessMissing(err: unknown, message: string): void {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ENOENT" || code === "ENOTDIR") return;
  console.warn(message, err);
}
