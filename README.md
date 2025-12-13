## MORM = ORM

```
import express from "express";
import "dotenv/config";

const app = express();

// usage
import { Morm } from "./morm/morm.js";
const db = async (db_name: string) => {
  const db_url = `postgresql://postgres:postgres@localhost:5432/${db_name}`;

  const morm = Morm.init(db_url, {}, (err: any, res: any) => {
    if (err) {
      console.log(err);
    } else {
      console.log("Database connected");
    }
  });
  return morm;
};

const morm = await db("drmo");

export const Profile = morm?.model({
  table: "profile",
  enums: [
    { name: "PROFILE_ROLES", values: ["ADMIN", "SUPERADMIN", "STUDENT"] },
  ],
  columns: [
    {
      name: "id",
      type: "UUID",
      primary: true,
      default: "uuid()",
    },
    {
      name: "user_id",
      type: "uuid",
      references: {
        table: "users",
        column: "id",
        relation: "nn",
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
    },
  ],
});

const User = morm?.model({
  table: "users",
  enums: [{ name: "USER_ROLES", values: ["ADMIN", "STUDENT"] }],
  columns: [
    { name: "id", type: "uuid", primary: true, default: "uuid()" },
    { name: "int", type: "int", default: "10" },
    {
      name: "referrer_id",
      type: "uuid",
      notNull: false,
      references: {
        table: "users",
        column: "id",
        relation: "nm", // or ONE-TO-MANY
        onDelete: "CASCADE",
        onUpdate: "CASCADE",
      },
    },
  ],
});

// await morm?.migrate({ clean: true });
await morm?.migrate({ clean: true, reset: true });

app.listen(4000, () => console.log("Server running on port 4000"));

```
