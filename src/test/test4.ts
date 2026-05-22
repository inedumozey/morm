// import type { Morm } from "../morm/morm.js";

// export const testFine = async (morm: Morm) => {
//   try {
//     await morm.transaction(async (trx) => {
//       // F1 — basic findOne with profile
//       const f1 = await trx.user.findOne({
//         where: { id: "b79d6010-3efd-4662-b3ad-06259bdd1928" },
//         include: { profile: true },
//       });

//       // F2 — findOne with post (ONE-TO-MANY)
//       const f2 = await trx.user.findOne({
//         where: { id: "b79d6010-3efd-4662-b3ad-06259bdd1928" },
//         include: { post: true },
//       });

//       // F3 — findOne with nested include + projection
//       const f3 = await trx.user.findOne({
//         where: { id: "b79d6010-3efd-4662-b3ad-06259bdd1928" },
//         include: {
//           profile: { include: { fullname: true } },
//           post: { take: 1, orderBy: { title: "asc" } },
//         },
//       });

//       // F4 — findOne returns null
//       const f4 = await trx.user.findOne({
//         where: { id: "00000000-0000-0000-0000-000000000000" },
//         include: { profile: true },
//       });

//       // F5 — findOne with exclude
//       const f5 = await trx.user.findOne({
//         where: { id: "b79d6010-3efd-4662-b3ad-06259bdd1928" },
//         exclude: { state: true, account_number: true },
//       });

//       // F6 — findOne with mode
//       const f6 = await trx.user.findOne({
//         where: { id: "b79d6010-3efd-4662-b3ad-06259bdd1928" },
//         include: {
//           post: {
//             where: { title: { contains: "typescript" } },
//             mode: "insensitive",
//           },
//         },
//       });

//       // F7 — TypeScript red line test — orderBy should show red line
//       // const f7 = await trx.user.findOne({
//       //   where: { id: "b79d6010-3efd-4662-b3ad-06259bdd1928" },
//       //   orderBy: { username: "asc" }, // ← should red line
//       // });

//       console.log("f1:", JSON.stringify(f1, null, 2));
//       console.log("f2:", JSON.stringify(f2, null, 2));
//       console.log("f3:", JSON.stringify(f3, null, 2));
//       console.log("f4:", JSON.stringify(f4, null, 2));
//       console.log("f5:", JSON.stringify(f5, null, 2));
//       console.log("f6:", JSON.stringify(f6, null, 2));
//     });
//   } catch (error) {
//     console.error("Failed to connect to the database:", error);
//     process.exit(1);
//   }
// };

// // results
//   ⚡ findOne "user" — 11ms
//   ⚡ find "profile" — 1 rows — 2ms
//   ⚡ findOne "user" — 2ms
//   ⚡ find "post" — 2 rows — 3ms
//   ⚡ findOne "user" — 5ms
//   ⚡ find "profile" — 1 rows — 4ms
//   ⚡ findOne "user" — 2ms
//   ⚡ findOne "user" — 3ms
//   ⚡ findOne "user" — 5ms
//   ⚡ find "post" — 1 rows — 1ms
// f1: {
//   "id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//   "username": "moses",
//   "email": "moses@gmail.com",
//   "account_number": 1,
//   "state": "Lagos",
//   "is_active": true,
//   "role": "ADMIN",
//   "created_at": "2026-05-20T23:14:34.006Z",
//   "updated_at": "2026-05-20T23:14:34.006Z",
//   "profile": {
//     "id": "c1eca46f-7a07-4e7a-9dd9-866650abffca",
//     "fullname": "Moses Abraham",
//     "avatar": "moses.jpg",
//     "user_id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//     "created_at": "2026-05-20T23:16:12.400Z",
//     "updated_at": "2026-05-20T23:16:12.400Z"
//   }
// }
// f2: {
//   "id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//   "username": "moses",
//   "email": "moses@gmail.com",
//   "account_number": 1,
//   "state": "Lagos",
//   "is_active": true,
//   "role": "ADMIN",
//   "created_at": "2026-05-20T23:14:34.006Z",
//   "updated_at": "2026-05-20T23:14:34.006Z",
//   "post": [
//     {
//       "id": "f7eaeca6-46ef-4846-ba72-43ed612485b8",
//       "title": "Getting started with TypeScript",
//       "body": "TypeScript is a superset of JavaScript...",
//       "user_id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//       "created_at": "2026-05-20T23:18:35.018Z",
//       "updated_at": "2026-05-20T23:18:35.018Z"
//     },
//     {
//       "id": "0c8d0400-85b7-4cee-9310-f0dd8d177bb9",
//       "title": "Node.js best practices",
//       "body": "Node.js is a JavaScript runtime...",
//       "user_id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//       "created_at": "2026-05-20T23:18:35.018Z",
//       "updated_at": "2026-05-20T23:18:35.018Z"
//     }
//   ]
// }
// f3: {
//   "id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//   "username": "moses",
//   "email": "moses@gmail.com",
//   "account_number": 1,
//   "state": "Lagos",
//   "is_active": true,
//   "role": "ADMIN",
//   "created_at": "2026-05-20T23:14:34.006Z",
//   "updated_at": "2026-05-20T23:14:34.006Z",
//   "post": [
//     {
//       "id": "f7eaeca6-46ef-4846-ba72-43ed612485b8",
//       "title": "Getting started with TypeScript",
//       "body": "TypeScript is a superset of JavaScript...",
//       "user_id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//       "created_at": "2026-05-20T23:18:35.018Z",
//       "updated_at": "2026-05-20T23:18:35.018Z"
//     }
//   ],
//   "profile": {
//     "fullname": "Moses Abraham"
//   }
// }
// f4: null
// f5: {
//   "id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//   "username": "moses",
//   "email": "moses@gmail.com",
//   "is_active": true,
//   "role": "ADMIN",
//   "created_at": "2026-05-20T23:14:34.006Z",
//   "updated_at": "2026-05-20T23:14:34.006Z"
// }
// f6: {
//   "id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//   "username": "moses",
//   "email": "moses@gmail.com",
//   "account_number": 1,
//   "state": "Lagos",
//   "is_active": true,
//   "role": "ADMIN",
//   "created_at": "2026-05-20T23:14:34.006Z",
//   "updated_at": "2026-05-20T23:14:34.006Z",
//   "post": [
//     {
//       "id": "f7eaeca6-46ef-4846-ba72-43ed612485b8",
//       "title": "Getting started with TypeScript",
//       "body": "TypeScript is a superset of JavaScript...",
//       "user_id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//       "created_at": "2026-05-20T23:18:35.018Z",
//       "updated_at": "2026-05-20T23:18:35.018Z"
//     }
//   ]
// }
