import type { Morm } from "../morm/morm.js";

export const testFine = async (morm: Morm) => {
  try {
    await morm.transaction(async (trx) => {
      const users = await trx.user.find({
        include: {
          profile: true, // should autocomplete
          post: {
            // should autocomplete
            where: {},
            take: 1,
          },
        },
      });
    });
  } catch (error) {
    console.error("Failed to connect to the database:", error);
    process.exit(1);
  }
};
