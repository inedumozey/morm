import express from "express";
import cors from "cors";
import router from "./routes/index.js";
import { HttpError, HttpStatus } from "./HttpError.js";
import "dotenv/config";

const app = express();
app.use(cors());
app.use(express.json());

// create the database
app.post("/", async (req, res) => {
  const { app_id } = req.body;
  try {
    if (!app_id) {
      throw new HttpError("App ID is missing", HttpStatus.NOT_FOUND);
    }
    // create new database
    res.status(HttpStatus.OK).json({ message: "App created successfully" });
  } catch (err: any) {
    return res.status(500).json({
      message: err.message,
      status_code: err.status,
    });
  }
});

/**
 * MORM STORAGE
 * model-types.ts
 * sql/buildColumnSQL.ts
 * utils/canonicalType.ts
 * utils/relationValidator.ts
 * utils/junctionBuilder.ts
 * utils/validateColumnType.ts
 * utils/sanitize.ts
 * utils/checkParser.ts
 * migrations/alterColumn.ts
 * migrations/alterColumnCheck.ts
 * migrations/alterColumnNullity.ts
 * migrations/alterColumnTypes.ts
 * migrations/alterColumnUnique.ts
 * migrations/enumRegistry.ts
 * migrations/indexMigrations.ts
 * migrations/resetDatabase.ts
 */
app.use("/docs", router.docsRouter);

// usage
import { Morm } from "./morm/morm.js";
const db = async (db_name: string) => {
  const db_url = `postgresql://postgres:postgres@localhost:5432/${db_name}`;

  const morm = Morm.init(
    db_url,
    { transaction: { maxWait: 5000, timeout: 10000 } },
    (err: any, res: any) => {
      if (err) {
        console.log(err);
      } else {
        console.log("Database connected");
      }
    },
  );
  return morm;
};

const morm = await db("drhmo");
await morm?.transaction(async (tx) => {
  // console.log({ tx });
});

morm?.enums([
  { name: "USER_ROLE", values: ["ADMIN", "SUPERADMIN", "STAFF", "MARKED"] },
]);

// const Profile = morm?.model({
//   table: "profile",
//   columns: [
//     {
//       name: "id",
//       type: "uuid",
//       primary: true,
//       default: "uuid()",
//     },
//     {
//       name: "acount_id",
//       type: "uuid",
//       references: {
//         table: "account",
//         column: "id",
//         relation: "nn",
//         onDelete: "RESTRICT",
//         onUpdate: "NO ACTION",
//       },
//     },
//   ],
// });

// const account = morm?.model({
//   table: "account",
//   columns: [
//     {
//       name: "id",
//       type: "UUID",
//       primary: true,
//       default: "uuid()",
//     },
//   ],
// });

// const User = morm?.model({
//   table: "principal",
//   columns: [
//     { name: "ID", type: "uuid", primary: true, default: "uuid()" },
//     { name: "role", type: "USER_ROLE", default: "ADMIN" },
//     { name: "name", type: "text" },
//     {
//       name: "account_id",
//       type: "uuid",
//       references: {
//         table: "account",
//         column: "id",
//         relation: "nn", // ONE-TO-MANY
//         onDelete: "SET NULL",
//         onUpdate: "SET DEFAULT",
//       },
//     },
//     {
//       name: "referrer_ids",
//       type: "uuid[]",
//       references: {
//         table: "principal",
//         column: "id",
//         relation: "mm", // MANY-TO-MANY
//       },
//     },
//     {
//       name: "position_id",
//       type: "UUID[]",
//       references: {
//         table: "position",
//         column: "id",
//         relation: "mm", // MANY-TO-MANY
//       },
//     },
//   ],
// });

// const Profile = morm!.model({
//   table: "profile",
//   columns: [
//     { name: "id", type: "uuid", primary: true, default: "uuid()" },
//     {
//       name: "user_id",
//       type: "uuid",
//       // unique: true,
//       // notNull: true,
//       // default: "uuid()",
//       references: {
//         table: "users",
//         column: "id",
//         relation: "nn",
//         onDelete: "RESTRICT",
//         onUpdate: "CASCADE",
//       },
//     },
//   ],
// });

// const Book = morm!.model({
//   table: "book",
//   columns: [
//     { name: "id", type: "uuid", primary: true, default: "uuid()" },
//     {
//       name: "author_id",
//       type: "uuid",
//       // unique: true,
//       // notNull: true,
//       references: {
//         table: "users",
//         column: "id",
//         relation: "nm",
//         onDelete: "RESTRICT",
//         onUpdate: "CASCADE",
//       },
//     },
//   ],
// });

const User = morm!.model({
  table: "users",
  columns: [
    { name: "id", type: "uuid", primary: true, default: "uuid()" },
    { name: "name", type: "text", default: "mos" },
    // { name: "account", type: "text", unique: true },
  ],
});

await morm?.migrate();
// await morm?.migrate({ reset: true });

app.listen(4000, () => console.log("Server running on port 4000"));
