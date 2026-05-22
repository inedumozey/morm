import type { Morm } from "../morm/morm.js";

export const testFineOne = async (morm: Morm) => {
  try {
    await morm.transaction(async (trx) => {
      const users = await trx.user.findOne({});
    });
  } catch (error) {
    console.error("Failed to connect to the database:", error);
    process.exit(1);
  }
};
