// index.ts

import express from "express";
import cors from "cors";
import router from "./routes/index.js";
import { HttpError, HttpStatus } from "./HttpError.js";
import "dotenv/config";

const app = express();
app.use(cors());
app.use(express.json());

// create the database
import db from "./db.js";
const db_name = "new_db";
const db_url = `postgresql://postgres:postgre@localhost:5432/${db_name}`;
const morm = await db(db_url);
const user = await morm.user.create({
  data: [
    { name: "Moses", account_number: 546 },
    { name: "inedu", account_number: 777, class: "A", initials: "IE" },
  ],
});

console.log(user);
await morm.transaction<void, MormDB>(async (trx) => {
  const user = await trx.user.create({
    data: { name: "Moses", account_number: 546 },
  });
  console.log(user);
});

app.listen(4000, () => console.log("Server running on port 4000"));
