/**
 * Where a failure's text was written. This CLI authors every local message
 * and shows it as is; a remote one wraps TeamHub's or a provider's own prose,
 * which is never shown, so the code's template replaces it.
 */
export type ErrorOrigin = "local" | "remote";

export class CliError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
    readonly origin: ErrorOrigin = "local",
  ) {
    super(message);
  }
}
