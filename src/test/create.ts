import type { Morm } from "../morm/morm.js";

export const testCrteate = async (morm: Morm) => {
  try {
    await morm.transaction(async (trx: Morm) => {
      await trx.user.create({
        data: {
          username: "orphan",
          email: "orphan@gmail.com",
          account_number: 99,
          state: "Lagos",
        },
        skipDuplicates: true,
      });
    });
  } catch (error) {
    console.error("Failed to connect to the database:", error);
    process.exit(1);
  }
};
