// index.ts

import express from "express";
import cors from "cors";
import router from "./routes/index.js";
import { HttpError, HttpStatus } from "./HttpError.js";
import "dotenv/config";
import db from "./db.js";

const app = express();
app.use(cors());
app.use(express.json());

// create the database
const db_name = "new_db";
const db_url = `postgresql://postgres:postgre@localhost:5432/${db_name}`;

const morm = await db(db_url);

// await morm?.migrate();
// await morm?.migrate({ reset: true });

try {
  await morm?.transaction(async (db) => {
    const result = await db.user.create({
      data: [
        { name: "Moses", account_number: 546 },
        { name: "inedu", account_number: 777 },
      ],
    });
    console.log(result);
  });
} catch (err: any) {
  console.log(err.message);
}

app.listen(4000, () => console.log("Server running on port 4000"));
