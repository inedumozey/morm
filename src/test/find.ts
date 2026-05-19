import type { Morm } from "../morm/morm.js";

export const testFine = async (morm: Morm) => {
  try {
    await morm.transaction(async (trx) => {
      const users = await trx.user.find({
        where: {
          account_number: { gte: 5, lte: 10 },
        },
      });

      console.log(users);
    });
  } catch (error) {
    console.error("Failed to connect to the database:", error);
    process.exit(1);
  }
};
