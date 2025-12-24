// utils/logColors.ts

export const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",

  // headers / sections
  section: "\x1b[36m", // cyan
  sectionAlt: "\x1b[35m", // magenta

  // actions (meaning)
  success: "\x1b[32m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
  processing: "\x1b[35m",

  // subjects (data)
  subject: "\x1b[90m", // light gray (NOT white)
};

/**
log semantic
 [SUBJECT]:
  [Action]: [subject  ]
*/
