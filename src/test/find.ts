import type { Morm } from "../morm/morm.js";

export const testFine = async (morm: Morm) => {
  try {
    await morm.transaction(async (trx) => {
      const users = await trx.user.find({
        where: { username: async () => "user1" },
        take: async () => 3,
        include: { id: true },
      });
      console.log(users[0]?.id);
    });
  } catch (error) {
    console.error("Failed to connect to the database:", error);
    process.exit(1);
  }
};
