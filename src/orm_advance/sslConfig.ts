// morm/sslConfig.ts
export type SSLConfigOptions = {
  NODE_ENV?: string;
  allowSSL?: boolean;
  rejectUnauthorized?: boolean;
  customSSLConfig?: object | null;
  dbUrl?: string;
};

export function getSSLConfig(opts: SSLConfigOptions = {}) {
  const {
    NODE_ENV = "development",
    allowSSL,
    rejectUnauthorized,
    customSSLConfig,
    dbUrl,
  } = opts;

  // Highest priority: explicit custom SSL object
  if (customSSLConfig) return customSSLConfig;

  // Next: explicit allowSSL boolean
  if (typeof allowSSL === "boolean") {
    return allowSSL
      ? {
          rejectUnauthorized:
            typeof rejectUnauthorized === "boolean"
              ? rejectUnauthorized
              : false,
        }
      : false;
  }

  // Auto-detect from URL (sslmode=require or ssl=true)
  const lower = (dbUrl || "").toLowerCase();
  if (lower.includes("sslmode=require") || lower.includes("ssl=true")) {
    return {
      rejectUnauthorized:
        typeof rejectUnauthorized === "boolean" ? rejectUnauthorized : false,
    };
  }

  // default: production => enable SSL
  if (NODE_ENV === "production") {
    return {
      rejectUnauthorized:
        typeof rejectUnauthorized === "boolean" ? rejectUnauthorized : true,
    };
  }

  // default dev/test: no SSL
  return false;
}
