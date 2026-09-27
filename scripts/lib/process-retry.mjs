const RETRYABLE_WINDOWS_NATIVE_EXIT_CODES = new Set([
  0xC0000005,
  0xC0000409
]);

export function isRetryableNativeExitCode(exitCode, platform = process.platform) {
  return platform === "win32" && Number.isInteger(exitCode) && RETRYABLE_WINDOWS_NATIVE_EXIT_CODES.has(exitCode >>> 0);
}
