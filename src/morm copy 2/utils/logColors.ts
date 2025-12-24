// utils/logColors.ts

export const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  // semantic meanings
  error: "\x1b[31m", // red
  warn: "\x1b[33m", // yellow
  success: "\x1b[32m", // green
  info: "\x1b[36m", // cyan
  processing: "\x1b[35m", // magenta

  // aliases (temporary backward compatibility)
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};
