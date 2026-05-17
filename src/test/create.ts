import type { Morm } from "../morm/morm.js";

export const testCrteate = async (morm: Morm) => {
  try {
    await morm.transaction(async (trx: Morm) => {
      const states: string[] = ["Lagos", "Abuja", "Kano", "Rivers", "Oyo"];

      const data = Array.from({ length: 30 }, (_, i) => ({
        username: `user${i + 1}`,
        email: `user${i + 1}@gmail.com`,
        account_number: i + 1,
        initials: `U${i + 1}`.slice(0, 4),
        state: states[i % 5]!,
      }));

      await trx.user.create({ data, skipDuplicates: true });
    });
  } catch (error) {
    console.error("Failed to connect to the database:", error);
    process.exit(1);
  }
};
