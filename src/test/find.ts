import type { Morm } from "../morm/morm.js";

export const testFine = async (morm: Morm) => {
  try {
    await morm.transaction(async (trx) => {
      const start = Date.now();

      const result = await trx.user.find({
        include: {
          post: {
            where: { title: { contains: "a" } },
            orderBy: { title: "asc" },
            take: 1,
            include: {
              id: true,
              title: true,
              user: {
                include: {
                  id: true,
                  username: true,
                  profile: {
                    include: { fullname: true },
                  },
                  post: {
                    count: true,
                    where: { title: { contains: "a" } },
                  },
                },
              },
            },
          },
          profile: {
            exclude: { avatar: true, user_id: true },
          },
        },
        where: { is_active: true },
        orderBy: { username: "asc" },
        take: 3,
      });

      console.log(`Total time: ${Date.now() - start}ms`);
      console.log(JSON.stringify(result, null, 2));
    });
  } catch (error) {
    console.error("Failed to connect to the database:", error);
    process.exit(1);
  }
};
