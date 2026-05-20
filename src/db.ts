// db.ts

import { Morm } from "./morm/morm.js";

const morm = async (db_url: string) => {
  try {
    const morm = await Morm.init(db_url, {
      transaction: { maxWait: 5000, timeout: 10000 },
      generate: {
        output: "./src",
      },
      debug: true,
    });
    console.log("Database connected!");

    morm?.enums([
      { name: "USER_ROLE", values: ["ADMIN", "SUPERADMIN", "STAFF", "MARKED"] },
    ]);

    morm!.model({
      table: "user",
      columns: [
        {
          name: "id",
          type: "uuid",
          primary: true,
          default: "uuid()",
        },
        {
          name: "username",
          type: "text",
          sanitize: { trim: true },
        },
        {
          name: "email",
          type: "text",
          sanitize: { trim: true, case: "lower" },
        },
        {
          name: "account_number",
          type: "INT",
          sanitize: { trim: true },
        },
        {
          name: "initials",
          type: "VARCHAR(4)",
          default: "Mr.",
          sanitize: { trim: true },
        },
        { name: "state", type: "text" },
        {
          name: "tags",
          type: "text[]",
        },
        {
          name: "is_active",
          type: "BOOLEAN",
          default: true,
        },
        {
          name: "role",
          type: "USER_ROLE",
          default: "ADMIN",
        },
        {
          name: "count",
          type: "int[]",
        },
        {
          name: "ids",
          type: "uuid[]",
        },
        {
          name: "dates",
          type: "DATE[]",
        },
        {
          name: "count_",
          type: "int[]",
        },
        {
          name: "countnum_",
          type: "BOOLEAN[]",
        },
        {
          name: "ids_",
          type: "uuid[]",
        },
        {
          name: "dates_",
          type: "DATE[]",
        },
        {
          name: "boolean",
          type: "BOOLEAN[]",
        },
        {
          name: "datestz_",
          type: "TIMESTAMPTZ[]",
        },
        {
          name: "time",
          type: "TIMETZ[]",
        },
      ],
    });

    morm!.model({
      table: "profile",
      columns: [
        { name: "id", type: "uuid", primary: true, default: "uuid()" },
        { name: "fullname", type: "text", notNull: true },
        { name: "avatar", type: "text" },
        {
          name: "user_id",
          type: "uuid",
          references: {
            table: "user",
            column: "id",
            relation: "nn",
          },
        },
        { name: "time", type: "REAL[]" },
      ],
    });

    // await morm?.migrate();
    // await morm?.migrate({ reset: true });

    return morm;
  } catch (err) {
    throw new Error(`Database connection error:, ${err}`);
  }
};

export default morm;
