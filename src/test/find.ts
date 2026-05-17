import type { Morm } from "../morm/morm.js";
const profile_id = "7536046b-8d7a-4902-91b3-1f037483bd51";

export const testFine = async (morm: Morm) => {
  try {
    await morm.transaction(async (trx) => {});
  } catch (error) {
    console.error("Failed to connect to the database:", error);
    process.exit(1);
  }
};
