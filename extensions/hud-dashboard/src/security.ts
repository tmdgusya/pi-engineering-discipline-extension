const SECRET_PATTERNS = [
  /api[_-]?key/i,
  /secret/i,
  /token/i,
  /password/i,
  /credential/i,
  /auth/i,
  /bearer/i,
  /private[_-]?key/i,
  /session[_-]?id/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
];

const REDACTED_VALUE = "[REDACTED]";

function looksLikeSecret(key: string): boolean {
  return SECRET_PATTERNS.some(pattern => pattern.test(key));
}

export function redactSecrets<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (looksLikeSecret(key)) {
      result[key] = REDACTED_VALUE;
    } else if (value !== null && typeof value === "object") {
      if (Array.isArray(value)) {
        result[key] = value.map(item =>
          typeof item === "object" && item !== null
            ? redactSecrets(item as Record<string, unknown>)
            : item
        );
      } else {
        result[key] = redactSecrets(value as Record<string, unknown>);
      }
    } else {
      result[key] = value;
    }
  }

  return result as T;
}

export function redactSecretsInString(str: string): string {
  let result = str;

  const patterns = [
    /([A-Z_]+API[_\s]?KEY)\s*[:=]\s*['"`]?([a-zA-Z0-9_\-]+)['"`]?/gi,
    /([A-Z_]+SECRET)\s*[:=]\s*['"`]?([a-zA-Z0-9_\-]+)['"`]?/gi,
    /([A-Z_]+TOKEN)\s*[:=]\s*['"`]?([a-zA-Z0-9_\-]+)['"`]?/gi,
    /bearer\s+([a-zA-Z0-9_\-\.]+)/gi,
    /sk\-[a-zA-Z0-9]{20,}/g,
  ];

  for (const pattern of patterns) {
    result = result.replace(pattern, (_, key, value) =>
      value ? `${key}: ${REDACTED_VALUE}` : REDACTED_VALUE
    );
  }

  return result;
}

export function escapeHtml(str: string): string {
  const htmlEntities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
    "/": "&#x2F;",
    "`": "&#x60;",
    "=": "&#x3D;",
  };

  return str.replace(/[&<>"'`=/]/g, char => htmlEntities[char] || char);
}

const MAX_DISPLAY_LENGTH = 10000;

export function sanitizeForDisplay(text: string): string {
  let sanitized = escapeHtml(text);

  const dangerousPatterns = [
    /javascript:/gi,
    /data:/gi,
    /vbscript:/gi,
    /on\w+\s*=/gi,
  ];

  for (const pattern of dangerousPatterns) {
    sanitized = sanitized.replace(pattern, "");
  }

  if (sanitized.length > MAX_DISPLAY_LENGTH) {
    sanitized = sanitized.slice(0, MAX_DISPLAY_LENGTH) + "... [truncated]";
  }

  return sanitized;
}

// IPC message signing — basic integrity, not cryptographic

const MESSAGE_PREFIX = "HUDv1:";
const MAX_MESSAGE_AGE_MS = 5000;

interface SignedMessage<T> {
  prefix: string;
  timestamp: number;
  payload: T;
  checksum: string;
}

export function signMessage<T>(payload: T): SignedMessage<T> {
  const timestamp = Date.now();
  const data = JSON.stringify({ payload, timestamp });
  const checksum = simpleHash(data);

  return { prefix: MESSAGE_PREFIX, timestamp, payload, checksum };
}

export function verifyMessage<T>(signed: SignedMessage<T>): { valid: boolean; payload?: T; reason?: string } {
  if (signed.prefix !== MESSAGE_PREFIX) {
    return { valid: false, reason: "Invalid prefix" };
  }

  const age = Date.now() - signed.timestamp;
  if (age > MAX_MESSAGE_AGE_MS) {
    return { valid: false, reason: "Message too old" };
  }
  if (age < -MAX_MESSAGE_AGE_MS) {
    return { valid: false, reason: "Message from future" };
  }

  const data = JSON.stringify({ payload: signed.payload, timestamp: signed.timestamp });
  if (simpleHash(data) !== signed.checksum) {
    return { valid: false, reason: "Checksum mismatch" };
  }

  return { valid: true, payload: signed.payload };
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}

// Permission model

export type Permission =
  | "hud:read"
  | "hud:write"
  | "state:read"
  | "state:write"
  | "tool:execute"
  | "metrics:read";

interface PermissionGrant {
  permission: Permission;
  grantedAt: number;
  expiresAt?: number;
}

const permissionStore = new Map<string, PermissionGrant>();

export function grantPermission(extensionId: string, permission: Permission, ttlMs?: number): void {
  permissionStore.set(`${extensionId}:${permission}`, {
    permission,
    grantedAt: Date.now(),
    expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
  });
}

export function hasPermission(extensionId: string, permission: Permission): boolean {
  const key = `${extensionId}:${permission}`;
  const grant = permissionStore.get(key);
  if (!grant) return false;

  if (grant.expiresAt && Date.now() > grant.expiresAt) {
    permissionStore.delete(key);
    return false;
  }

  return true;
}

export function revokeAllPermissions(extensionId: string): void {
  for (const key of permissionStore.keys()) {
    if (key.startsWith(`${extensionId}:`)) {
      permissionStore.delete(key);
    }
  }
}

export function revokePermission(extensionId: string, permission: Permission): void {
  permissionStore.delete(`${extensionId}:${permission}`);
}

export function cleanupExpiredPermissions(): void {
  const now = Date.now();
  for (const [key, grant] of permissionStore.entries()) {
    if (grant.expiresAt && now > grant.expiresAt) {
      permissionStore.delete(key);
    }
  }
}

// API version check

const COMPATIBLE_API_MAJOR = "0.65";

export function checkApiCompatibility(version: string): boolean {
  const match = version.match(/^(\d+\.\d+)/);
  if (!match) return false;
  return match[1] === COMPATIBLE_API_MAJOR;
}

// Security audit log

interface SecurityEvent {
  timestamp: number;
  type: "secret_detected" | "permission_granted" | "permission_revoked" | "message_rejected" | "permission_rejected";
  details: string;
  severity: "low" | "medium" | "high";
}

const securityLog: SecurityEvent[] = [];
const MAX_LOG_SIZE = 1000;

export function logSecurityEvent(
  type: SecurityEvent["type"],
  details: string,
  severity: SecurityEvent["severity"] = "low"
): void {
  securityLog.push({ timestamp: Date.now(), type, details, severity });

  if (securityLog.length > MAX_LOG_SIZE) {
    securityLog.shift();
  }
}

export function getSecurityLog(count = 100): readonly SecurityEvent[] {
  return securityLog.slice(-count);
}

export function hasHighSeverityEvents(): boolean {
  const recentWindow = Date.now() - 60000;
  return securityLog.some(e => e.severity === "high" && e.timestamp > recentWindow);
}
