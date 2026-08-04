/**
 * Turns any thrown value into a message safe to hand back to a user.
 *
 * Every Server Action in this app catches its own errors and returns
 * `{ ok: false, error: e.message }` for anything unrecognized — which
 * is exactly how a raw PrismaClientValidationError (full query shape,
 * field names, internal schema) or a ZodError (a JSON blob of issues)
 * ends up rendered verbatim in a joiner's browser instead of a sentence
 * a person can act on. Domain errors we throw ourselves on purpose
 * (`new Error('A name is required...')`) are written to be shown, so
 * those pass through unchanged — only errors from libraries that were
 * never meant to be user-facing get collapsed to the fallback.
 */
export function toSafeErrorMessage(
  e: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (!(e instanceof Error)) return fallback;
  const name = e.constructor?.name ?? '';
  if (name.startsWith('Prisma')) return fallback;
  if (name === 'ZodError') {
    const issues = (e as unknown as { issues?: { message: string }[] }).issues;
    return issues?.[0]?.message || fallback;
  }
  return e.message || fallback;
}
