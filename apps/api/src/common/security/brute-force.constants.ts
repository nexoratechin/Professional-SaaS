/** Shared between tenant-user and platform-user login (AuthService/PlatformAuthService) so
 * both realms get the same brute-force protection. */
export const MAX_FAILED_LOGIN_ATTEMPTS = 5;
export const ACCOUNT_LOCKOUT_DURATION_MS = 15 * 60 * 1000;
