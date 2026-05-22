// import type { Morm } from "../morm/morm.js";

// export const testFine = async (morm: Morm) => {
//   try {
//     await morm.transaction(async (trx) => {
//       // D1 — 3 levels deep with where + take + orderBy at each level
//       const d1 = await trx.user.find({
//         include: {
//           post: {
//             where: { title: { contains: "a" } },
//             orderBy: { title: "asc" },
//             take: 1,
//             include: {
//               id: true,
//               title: true,
//               user: {
//                 include: {
//                   id: true,
//                   username: true,
//                   post: {
//                     where: { title: { contains: "Node" } },
//                     orderBy: { title: "desc" },
//                     take: 1,
//                     include: { id: true, title: true },
//                   },
//                 },
//               },
//             },
//           },
//           profile: {
//             include: { fullname: true, avatar: true },
//           },
//         },
//         where: { is_active: true },
//         orderBy: { username: "asc" },
//         take: 2,
//       });

//       // D2 — user → post (count) + profile (exclude) at same level
//       const d2 = await trx.user.find({
//         include: {
//           post: {
//             count: true,
//             where: { title: { contains: "a" } },
//           },
//           profile: {
//             exclude: {
//               avatar: true,
//               user_id: true,
//               created_at: true,
//               updated_at: true,
//             },
//           },
//         },
//         orderBy: { username: "asc" },
//         take: 3,
//       });

//       // D3 — post → user (include projection + where) at same level
//       const d3 = await trx.post.find({
//         include: {
//           user: {
//             include: { id: true, username: true, role: true },
//             where: { is_active: true },
//           },
//         },
//         where: { title: { contains: "a" } },
//         orderBy: { title: "asc" },
//         take: 3,
//       });

//       // D4 — 4 levels deep
//       const d4 = await trx.user.find({
//         include: {
//           post: {
//             take: 1,
//             include: {
//               id: true,
//               title: true,
//               user: {
//                 include: {
//                   id: true,
//                   username: true,
//                   profile: {
//                     include: { fullname: true },
//                   },
//                   post: {
//                     take: 1,
//                     orderBy: { title: "desc" },
//                     include: {
//                       id: true,
//                       title: true,
//                       user: {
//                         include: { id: true, username: true, email: true },
//                       },
//                     },
//                   },
//                 },
//               },
//             },
//           },
//         },
//         take: 1,
//       });

//       // D5 — user → post (async where + take) + profile (async include)
//       const d5 = await trx.user.find({
//         include: {
//           post: async () => {
//             const keyword = await Promise.resolve("a");
//             return {
//               where: { title: { contains: keyword } },
//               orderBy: { title: "asc" },
//               take: 1,
//               include: { id: true, title: true },
//             };
//           },
//           profile: async () => ({
//             include: { fullname: true },
//           }),
//         },
//         take: 3,
//       });

//       // D6 — post → user (sum) nested inside user → post
//       const d6 = await trx.user.find({
//         include: {
//           post: {
//             where: { title: { contains: "a" } },
//             take: 1,
//             include: {
//               id: true,
//               title: true,
//               user: {
//                 sum: "account_number",
//               },
//             },
//           },
//         },
//         take: 2,
//       });

//       // D7 — multiple relations at every level with filters
//       const d7 = await trx.user.find({
//         include: {
//           post: {
//             where: {
//               and: [
//                 { title: { contains: "a" } },
//                 { title: { notStartsWith: "Build" } },
//               ],
//             },
//             orderBy: { title: "asc" },
//             include: {
//               id: true,
//               title: true,
//               user: {
//                 include: { id: true, username: true },
//               },
//             },
//           },
//           profile: {
//             include: { id: true, fullname: true },
//           },
//         },
//         where: { role: "ADMIN" },
//       });

//       // D8 — user → post (page 2 + take) + profile
//       const d8 = await trx.user.find({
//         include: {
//           post: {
//             take: 1,
//             page: 2,
//             orderBy: { title: "asc" },
//           },
//           profile: {
//             exclude: { avatar: true, user_id: true },
//           },
//         },
//         where: { username: "moses" },
//       });

//       // D9 — post → user (avg) + where on post
//       const d9 = await trx.post.find({
//         include: {
//           user: {
//             avg: "account_number",
//           },
//         },
//         where: {
//           or: [
//             { title: { startsWith: "Get" } },
//             { title: { startsWith: "Node" } },
//           ],
//         },
//         orderBy: { title: "asc" },
//       });

//       // D10 — user → post (mode insensitive + where + include) + profile
//       const d10 = await trx.user.find({
//         include: {
//           post: {
//             where: { title: { contains: "TYPESCRIPT" } },
//             mode: "insensitive",
//             include: { id: true, title: true },
//           },
//           profile: {
//             include: { fullname: true },
//           },
//         },
//         take: 3,
//       });

//       // D11 — user → post (distinct + orderBy)
//       const d11 = await trx.user.find({
//         include: {
//           post: {
//             distinct: { title: true },
//             orderBy: { title: "asc" },
//           },
//         },
//         take: 2,
//       });

//       // D12 — user → post (after cursor + orderBy)
//       const d12 = await trx.user.find({
//         include: {
//           post: {
//             after: { id: "0c8d0400-85b7-4cee-9310-f0dd8d177bb9" },
//             orderBy: { id: "asc" },
//           },
//         },
//         where: { username: "moses" },
//       });

//       // D13 — user → post (exclude + where + orderBy + take + page)
//       const d13 = await trx.user.find({
//         include: {
//           post: {
//             exclude: {
//               body: true,
//               created_at: true,
//               updated_at: true,
//               user_id: true,
//             },
//             where: { title: { contains: "a" } },
//             orderBy: { title: "desc" },
//             take: 1,
//             page: 1,
//           },
//         },
//         take: 3,
//       });

//       // D14 — post → user (include + where + count on user's posts)
//       const d14 = await trx.post.find({
//         include: {
//           user: {
//             include: { id: true, username: true, email: true },
//             where: { role: "ADMIN" },
//           },
//         },
//         orderBy: { title: "asc" },
//         take: 3,
//       });

//       // D15 — user → post (count + where) + profile (exclude) combined
//       const d15 = await trx.user.find({
//         include: {
//           post: {
//             count: true,
//             where: {
//               or: [
//                 { title: { contains: "Type" } },
//                 { title: { contains: "Node" } },
//               ],
//             },
//           },
//           profile: {
//             exclude: {
//               avatar: true,
//               user_id: true,
//               created_at: true,
//               updated_at: true,
//             },
//           },
//         },
//         where: { is_active: true },
//         orderBy: { username: "asc" },
//         take: 3,
//       });

//       // D16 — 3 levels: user → post (take+where) → user (include) → profile
//       const d16 = await trx.user.find({
//         include: {
//           post: {
//             where: { title: { contains: "a" } },
//             take: 1,
//             include: {
//               id: true,
//               title: true,
//               user: {
//                 include: {
//                   id: true,
//                   username: true,
//                   profile: {
//                     include: { fullname: true, avatar: true },
//                   },
//                 },
//               },
//             },
//           },
//         },
//         take: 2,
//       });

//       // D17 — user → post (min + where) on incoming
//       const d17 = await trx.user.find({
//         include: {
//           post: {
//             min: "created_at",
//             where: { title: { contains: "a" } },
//           },
//         },
//         take: 3,
//       });

//       // D18 — post → user (max + where) on outgoing
//       const d18 = await trx.post.find({
//         include: {
//           user: {
//             max: "account_number",
//             where: { is_active: true },
//           },
//         },
//         take: 3,
//       });

//       // D19 — complex async function at multiple levels
//       const d19 = await trx.user.find({
//         include: {
//           post: async () => {
//             const active = await Promise.resolve(true);
//             return {
//               where: { title: { contains: "a" } },
//               orderBy: { title: "asc" },
//               take: 1,
//               include: {
//                 id: true,
//                 title: true,
//                 user: async () => ({
//                   include: { id: true, username: true },
//                 }),
//               },
//             };
//           },
//         },
//         where: { is_active: true },
//         take: 2,
//       });

//       // D20 — everything at once: where+orderBy+take+page+include+exclude+mode+count+nested
//       const d20 = await trx.user.find({
//         include: {
//           post: {
//             where: { title: { contains: "a" } },
//             orderBy: { title: "asc" },
//             take: 1,
//             page: 1,
//             mode: "sensitive",
//             include: {
//               id: true,
//               title: true,
//               user: {
//                 include: {
//                   id: true,
//                   username: true,
//                   email: true,
//                   post: {
//                     count: true,
//                     where: { title: { contains: "a" } },
//                   },
//                   profile: {
//                     include: { fullname: true },
//                   },
//                 },
//               },
//             },
//           },
//           profile: {
//             exclude: {
//               avatar: true,
//               user_id: true,
//               created_at: true,
//               updated_at: true,
//             },
//           },
//         },
//         where: { is_active: true },
//         orderBy: { username: "asc" },
//         take: 3,
//       });

//       console.log("d1:", JSON.stringify(d1, null, 2));
//       console.log("d2:", JSON.stringify(d2, null, 2));
//       console.log("d3:", JSON.stringify(d3, null, 2));
//       console.log("d4:", JSON.stringify(d4, null, 2));
//       console.log("d5:", JSON.stringify(d5, null, 2));
//       console.log("d6:", JSON.stringify(d6, null, 2));
//       console.log("d7:", JSON.stringify(d7, null, 2));
//       console.log("d8:", JSON.stringify(d8, null, 2));
//       console.log("d9:", JSON.stringify(d9, null, 2));
//       console.log("d10:", JSON.stringify(d10, null, 2));
//       console.log("d11:", JSON.stringify(d11, null, 2));
//       console.log("d12:", JSON.stringify(d12, null, 2));
//       console.log("d13:", JSON.stringify(d13, null, 2));
//       console.log("d14:", JSON.stringify(d14, null, 2));
//       console.log("d15:", JSON.stringify(d15, null, 2));
//       console.log("d16:", JSON.stringify(d16, null, 2));
//       console.log("d17:", JSON.stringify(d17, null, 2));
//       console.log("d18:", JSON.stringify(d18, null, 2));
//       console.log("d19:", JSON.stringify(d19, null, 2));
//       console.log("d20:", JSON.stringify(d20, null, 2));
//     });
//   } catch (error) {
//     console.error("Failed to connect to the database:", error);
//     process.exit(1);
//   }
// };

// // results

//   ⚡ find "user" — 2 rows — 15ms
//   ⚡ find "profile" — 2 rows — 3ms
//   ⚡ find "user" — 1 rows — 3ms
//   ⚡ find "user" — 3 rows — 2ms
//   ⚡ find "profile" — 3 rows — 3ms
//   ⚡ find "post" — 3 rows — 5ms
//   ⚡ find "user" — 1 rows — 4ms
//   ⚡ find "user" — 1 rows — 2ms
//   ⚡ find "user" — 1 rows — 1ms
//   ⚡ find "profile" — 1 rows — 5ms
//   ⚡ find "user" — 1 rows — 6ms
//   ⚡ find "user" — 3 rows — 4ms
//   ⚡ find "profile" — 3 rows — 3ms
//   ⚡ find "user" — 2 rows — 2ms
//   ⚡ find "user" — 1 rows — 4ms
//   ⚡ find "profile" — 1 rows — 2ms
//   ⚡ find "post" — 2 rows — 5ms
//   ⚡ find "user" — 1 rows — 3ms
//   ⚡ find "user" — 1 rows — 4ms
//   ⚡ find "profile" — 1 rows — 38ms
//   ⚡ find "post" — 2 rows — 3ms
//   ⚡ find "user" — 3 rows — 8ms
//   ⚡ find "profile" — 3 rows — 3ms
//   ⚡ find "post" — 1 rows — 6ms
//   ⚡ find "user" — 2 rows — 8ms
//   ⚡ find "post" — 3 rows — 2ms
//   ⚡ find "user" — 1 rows — 3ms
//   ⚡ find "post" — 1 rows — 9ms
//   ⚡ find "user" — 3 rows — 2ms
//   ⚡ find "post" — 3 rows — 2ms
//   ⚡ find "user" — 1 rows — 7ms
//   ⚡ find "user" — 3 rows — 10ms
//   ⚡ find "profile" — 3 rows — 14ms
//   ⚡ find "user" — 2 rows — 1ms
//   ⚡ find "user" — 2 rows — 0ms
//   ⚡ find "profile" — 2 rows — 40ms
//   ⚡ find "user" — 3 rows — 2ms
//   ⚡ find "post" — 3 rows — 5ms
//   ⚡ find "user" — 2 rows — 1ms
//   ⚡ find "user" — 2 rows — 1ms
//   ⚡ find "user" — 3 rows — 2ms
//   ⚡ find "profile" — 3 rows — 1ms
//   ⚡ find "user" — 2 rows — 1ms
//   ⚡ find "profile" — 2 rows — 3ms
// d1: [
//   {
//     "id": "283f6928-9333-496f-b84f-156cd722e100",
//     "username": "david",
//     "email": "david@gmail.com",
//     "account_number": 4,
//     "state": "Lagos",
//     "is_active": true,
//     "role": "SUPERADMIN",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "profile": {
//       "fullname": "David Williams",
//       "avatar": "david.jpg"
//     },
//     "post": [
//       {
//         "id": "47b2b8c6-d713-426b-9729-cb9780002986",
//         "title": "React hooks explained",
//         "user": {
//           "id": "283f6928-9333-496f-b84f-156cd722e100",
//           "username": "david",
//           "post": []
//         }
//       }
//     ]
//   },
//   {
//     "id": "e8eaf393-3a6a-4d42-b02f-ccbec70aeec0",
//     "username": "grace",
//     "email": "grace@gmail.com",
//     "account_number": 5,
//     "state": "Rivers",
//     "is_active": true,
//     "role": "STAFF",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "profile": {
//       "fullname": "Grace Okafor",
//       "avatar": "grace.jpg"
//     },
//     "post": []
//   }
// ]
// d2: [
//   {
//     "id": "283f6928-9333-496f-b84f-156cd722e100",
//     "username": "david",
//     "email": "david@gmail.com",
//     "account_number": 4,
//     "state": "Lagos",
//     "is_active": true,
//     "role": "SUPERADMIN",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "profile": {
//       "id": "408a61cd-912a-4160-8ade-13f842b7c724",
//       "fullname": "David Williams"
//     },
//     "post": {
//       "count": 1
//     }
//   },
//   {
//     "id": "e8eaf393-3a6a-4d42-b02f-ccbec70aeec0",
//     "username": "grace",
//     "email": "grace@gmail.com",
//     "account_number": 5,
//     "state": "Rivers",
//     "is_active": true,
//     "role": "STAFF",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "profile": {
//       "id": "137ba3f4-57cb-479c-909d-8ccc2484efc0",
//       "fullname": "Grace Okafor"
//     },
//     "post": {
//       "count": 0
//     }
//   },
//   {
//     "id": "eb7c20fd-8c15-44fd-86d2-7d5ca8800d7e",
//     "username": "john",
//     "email": "john@gmail.com",
//     "account_number": 2,
//     "state": "Abuja",
//     "is_active": true,
//     "role": "STAFF",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "profile": {
//       "id": "fb2f4cb6-df2d-4ac0-aca7-c47c32c4ddf7",
//       "fullname": "John Smith"
//     },
//     "post": {
//       "count": 1
//     }
//   }
// ]
// d3: [
//   {
//     "id": "f7eaeca6-46ef-4846-ba72-43ed612485b8",
//     "title": "Getting started with TypeScript",
//     "body": "TypeScript is a superset of JavaScript...",
//     "user_id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//     "created_at": "2026-05-20T23:18:35.018Z",
//     "updated_at": "2026-05-20T23:18:35.018Z",
//     "user": {
//       "id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//       "username": "moses",
//       "role": "ADMIN"
//     }
//   },
//   {
//     "id": "ec95eaaa-4d23-4369-ba85-406e149d7c8e",
//     "title": "JavaScript async/await",
//     "body": "Async/await makes asynchronous code easier...",
//     "user_id": "868f68a8-3b39-4158-b5b0-285c35255204",
//     "created_at": "2026-05-20T23:18:35.018Z",
//     "updated_at": "2026-05-20T23:18:35.018Z",
//     "user": null
//   },
//   {
//     "id": "0c8d0400-85b7-4cee-9310-f0dd8d177bb9",
//     "title": "Node.js best practices",
//     "body": "Node.js is a JavaScript runtime...",
//     "user_id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//     "created_at": "2026-05-20T23:18:35.018Z",
//     "updated_at": "2026-05-20T23:18:35.018Z",
//     "user": {
//       "id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//       "username": "moses",
//       "role": "ADMIN"
//     }
//   }
// ]
// d4: [
//   {
//     "id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//     "username": "moses",
//     "email": "moses@gmail.com",
//     "account_number": 1,
//     "state": "Lagos",
//     "is_active": true,
//     "role": "ADMIN",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "post": [
//       {
//         "id": "0c8d0400-85b7-4cee-9310-f0dd8d177bb9",
//         "title": "Node.js best practices",
//         "user": {
//           "id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//           "username": "moses",
//           "profile": {
//             "fullname": "Moses Abraham"
//           },
//           "post": [
//             {
//               "id": "0c8d0400-85b7-4cee-9310-f0dd8d177bb9",
//               "title": "Node.js best practices",
//               "user": {
//                 "id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//                 "username": "moses",
//                 "email": "moses@gmail.com"
//               }
//             }
//           ]
//         }
//       }
//     ]
//   }
// ]
// d5: [
//   {
//     "id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//     "username": "moses",
//     "email": "moses@gmail.com",
//     "account_number": 1,
//     "state": "Lagos",
//     "is_active": true,
//     "role": "ADMIN",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "profile": {
//       "fullname": "Moses Abraham"
//     },
//     "post": [
//       {
//         "id": "f7eaeca6-46ef-4846-ba72-43ed612485b8",
//         "title": "Getting started with TypeScript"
//       }
//     ]
//   },
//   {
//     "id": "eb7c20fd-8c15-44fd-86d2-7d5ca8800d7e",
//     "username": "john",
//     "email": "john@gmail.com",
//     "account_number": 2,
//     "state": "Abuja",
//     "is_active": true,
//     "role": "STAFF",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "profile": {
//       "fullname": "John Smith"
//     },
//     "post": [
//       {
//         "id": "92bb93e9-5eca-40aa-b1d0-b67948f93167",
//         "title": "PostgreSQL tips and tricks"
//       }
//     ]
//   },
//   {
//     "id": "868f68a8-3b39-4158-b5b0-285c35255204",
//     "username": "sarah",
//     "email": "sarah@gmail.com",
//     "account_number": 3,
//     "state": "Kano",
//     "is_active": false,
//     "role": "STAFF",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "profile": {
//       "fullname": "Sarah Johnson"
//     },
//     "post": [
//       {
//         "id": "ec95eaaa-4d23-4369-ba85-406e149d7c8e",
//         "title": "JavaScript async/await"
//       }
//     ]
//   }
// ]
// d6: [
//   {
//     "id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//     "username": "moses",
//     "email": "moses@gmail.com",
//     "account_number": 1,
//     "state": "Lagos",
//     "is_active": true,
//     "role": "ADMIN",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "post": [
//       {
//         "id": "0c8d0400-85b7-4cee-9310-f0dd8d177bb9",
//         "title": "Node.js best practices",
//         "user": {
//           "sum": {
//             "account_number": 1
//           }
//         }
//       }
//     ]
//   },
//   {
//     "id": "eb7c20fd-8c15-44fd-86d2-7d5ca8800d7e",
//     "username": "john",
//     "email": "john@gmail.com",
//     "account_number": 2,
//     "state": "Abuja",
//     "is_active": true,
//     "role": "STAFF",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "post": [
//       {
//         "id": "92bb93e9-5eca-40aa-b1d0-b67948f93167",
//         "title": "PostgreSQL tips and tricks",
//         "user": {
//           "sum": {
//             "account_number": 2
//           }
//         }
//       }
//     ]
//   }
// ]
// d7: [
//   {
//     "id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//     "username": "moses",
//     "email": "moses@gmail.com",
//     "account_number": 1,
//     "state": "Lagos",
//     "is_active": true,
//     "role": "ADMIN",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "profile": {
//       "id": "c1eca46f-7a07-4e7a-9dd9-866650abffca",
//       "fullname": "Moses Abraham"
//     },
//     "post": [
//       {
//         "id": "f7eaeca6-46ef-4846-ba72-43ed612485b8",
//         "title": "Getting started with TypeScript",
//         "user": {
//           "id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//           "username": "moses"
//         }
//       },
//       {
//         "id": "0c8d0400-85b7-4cee-9310-f0dd8d177bb9",
//         "title": "Node.js best practices",
//         "user": {
//           "id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//           "username": "moses"
//         }
//       }
//     ]
//   }
// ]
// d8: [
//   {
//     "id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//     "username": "moses",
//     "email": "moses@gmail.com",
//     "account_number": 1,
//     "state": "Lagos",
//     "is_active": true,
//     "role": "ADMIN",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "post": [
//       {
//         "id": "0c8d0400-85b7-4cee-9310-f0dd8d177bb9",
//         "title": "Node.js best practices",
//         "body": "Node.js is a JavaScript runtime...",
//         "user_id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//         "created_at": "2026-05-20T23:18:35.018Z",
//         "updated_at": "2026-05-20T23:18:35.018Z"
//       }
//     ],
//     "profile": {
//       "id": "c1eca46f-7a07-4e7a-9dd9-866650abffca",
//       "fullname": "Moses Abraham",
//       "created_at": "2026-05-20T23:16:12.400Z",
//       "updated_at": "2026-05-20T23:16:12.400Z"
//     }
//   }
// ]
// d9: [
//   {
//     "id": "f7eaeca6-46ef-4846-ba72-43ed612485b8",
//     "title": "Getting started with TypeScript",
//     "body": "TypeScript is a superset of JavaScript...",
//     "user_id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//     "created_at": "2026-05-20T23:18:35.018Z",
//     "updated_at": "2026-05-20T23:18:35.018Z",
//     "user": {
//       "avg": {
//         "account_number": 1
//       }
//     }
//   },
//   {
//     "id": "0c8d0400-85b7-4cee-9310-f0dd8d177bb9",
//     "title": "Node.js best practices",
//     "body": "Node.js is a JavaScript runtime...",
//     "user_id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//     "created_at": "2026-05-20T23:18:35.018Z",
//     "updated_at": "2026-05-20T23:18:35.018Z",
//     "user": {
//       "avg": {
//         "account_number": 1
//       }
//     }
//   }
// ]
// d10: [
//   {
//     "id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//     "username": "moses",
//     "email": "moses@gmail.com",
//     "account_number": 1,
//     "state": "Lagos",
//     "is_active": true,
//     "role": "ADMIN",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "profile": {
//       "fullname": "Moses Abraham"
//     },
//     "post": [
//       {
//         "id": "f7eaeca6-46ef-4846-ba72-43ed612485b8",
//         "title": "Getting started with TypeScript"
//       }
//     ]
//   },
//   {
//     "id": "eb7c20fd-8c15-44fd-86d2-7d5ca8800d7e",
//     "username": "john",
//     "email": "john@gmail.com",
//     "account_number": 2,
//     "state": "Abuja",
//     "is_active": true,
//     "role": "STAFF",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "profile": {
//       "fullname": "John Smith"
//     },
//     "post": []
//   },
//   {
//     "id": "868f68a8-3b39-4158-b5b0-285c35255204",
//     "username": "sarah",
//     "email": "sarah@gmail.com",
//     "account_number": 3,
//     "state": "Kano",
//     "is_active": false,
//     "role": "STAFF",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "profile": {
//       "fullname": "Sarah Johnson"
//     },
//     "post": []
//   }
// ]
// d11: [
//   {
//     "id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//     "username": "moses",
//     "email": "moses@gmail.com",
//     "account_number": 1,
//     "state": "Lagos",
//     "is_active": true,
//     "role": "ADMIN",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "post": [
//       {
//         "id": "f7eaeca6-46ef-4846-ba72-43ed612485b8",
//         "title": "Getting started with TypeScript",
//         "body": "TypeScript is a superset of JavaScript...",
//         "user_id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//         "created_at": "2026-05-20T23:18:35.018Z",
//         "updated_at": "2026-05-20T23:18:35.018Z"
//       },
//       {
//         "id": "0c8d0400-85b7-4cee-9310-f0dd8d177bb9",
//         "title": "Node.js best practices",
//         "body": "Node.js is a JavaScript runtime...",
//         "user_id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//         "created_at": "2026-05-20T23:18:35.018Z",
//         "updated_at": "2026-05-20T23:18:35.018Z"
//       }
//     ]
//   },
//   {
//     "id": "eb7c20fd-8c15-44fd-86d2-7d5ca8800d7e",
//     "username": "john",
//     "email": "john@gmail.com",
//     "account_number": 2,
//     "state": "Abuja",
//     "is_active": true,
//     "role": "STAFF",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "post": [
//       {
//         "id": "92bb93e9-5eca-40aa-b1d0-b67948f93167",
//         "title": "PostgreSQL tips and tricks",
//         "body": "PostgreSQL is a powerful database...",
//         "user_id": "eb7c20fd-8c15-44fd-86d2-7d5ca8800d7e",
//         "created_at": "2026-05-20T23:18:35.018Z",
//         "updated_at": "2026-05-20T23:18:35.018Z"
//       }
//     ]
//   }
// ]
// d12: [
//   {
//     "id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//     "username": "moses",
//     "email": "moses@gmail.com",
//     "account_number": 1,
//     "state": "Lagos",
//     "is_active": true,
//     "role": "ADMIN",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "post": [
//       {
//         "id": "f7eaeca6-46ef-4846-ba72-43ed612485b8",
//         "title": "Getting started with TypeScript",
//         "body": "TypeScript is a superset of JavaScript...",
//         "user_id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//         "created_at": "2026-05-20T23:18:35.018Z",
//         "updated_at": "2026-05-20T23:18:35.018Z"
//       }
//     ]
//   }
// ]
// d13: [
//   {
//     "id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//     "username": "moses",
//     "email": "moses@gmail.com",
//     "account_number": 1,
//     "state": "Lagos",
//     "is_active": true,
//     "role": "ADMIN",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "post": [
//       {
//         "id": "0c8d0400-85b7-4cee-9310-f0dd8d177bb9",
//         "title": "Node.js best practices"
//       }
//     ]
//   },
//   {
//     "id": "eb7c20fd-8c15-44fd-86d2-7d5ca8800d7e",
//     "username": "john",
//     "email": "john@gmail.com",
//     "account_number": 2,
//     "state": "Abuja",
//     "is_active": true,
//     "role": "STAFF",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "post": [
//       {
//         "id": "92bb93e9-5eca-40aa-b1d0-b67948f93167",
//         "title": "PostgreSQL tips and tricks"
//       }
//     ]
//   },
//   {
//     "id": "868f68a8-3b39-4158-b5b0-285c35255204",
//     "username": "sarah",
//     "email": "sarah@gmail.com",
//     "account_number": 3,
//     "state": "Kano",
//     "is_active": false,
//     "role": "STAFF",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "post": [
//       {
//         "id": "ec95eaaa-4d23-4369-ba85-406e149d7c8e",
//         "title": "JavaScript async/await"
//       }
//     ]
//   }
// ]
// d14: [
//   {
//     "id": "0c11985c-51c2-438e-98f7-d3ebed0cc59d",
//     "title": "Building REST APIs",
//     "body": "REST APIs are the backbone of modern apps...",
//     "user_id": "283f6928-9333-496f-b84f-156cd722e100",
//     "created_at": "2026-05-20T23:18:35.018Z",
//     "updated_at": "2026-05-20T23:18:35.018Z",
//     "user": null
//   },
//   {
//     "id": "f7eaeca6-46ef-4846-ba72-43ed612485b8",
//     "title": "Getting started with TypeScript",
//     "body": "TypeScript is a superset of JavaScript...",
//     "user_id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//     "created_at": "2026-05-20T23:18:35.018Z",
//     "updated_at": "2026-05-20T23:18:35.018Z",
//     "user": {
//       "id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//       "username": "moses",
//       "email": "moses@gmail.com"
//     }
//   },
//   {
//     "id": "ec95eaaa-4d23-4369-ba85-406e149d7c8e",
//     "title": "JavaScript async/await",
//     "body": "Async/await makes asynchronous code easier...",
//     "user_id": "868f68a8-3b39-4158-b5b0-285c35255204",
//     "created_at": "2026-05-20T23:18:35.018Z",
//     "updated_at": "2026-05-20T23:18:35.018Z",
//     "user": null
//   }
// ]
// d15: [
//   {
//     "id": "283f6928-9333-496f-b84f-156cd722e100",
//     "username": "david",
//     "email": "david@gmail.com",
//     "account_number": 4,
//     "state": "Lagos",
//     "is_active": true,
//     "role": "SUPERADMIN",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "profile": {
//       "id": "408a61cd-912a-4160-8ade-13f842b7c724",
//       "fullname": "David Williams"
//     },
//     "post": {
//       "count": 0
//     }
//   },
//   {
//     "id": "e8eaf393-3a6a-4d42-b02f-ccbec70aeec0",
//     "username": "grace",
//     "email": "grace@gmail.com",
//     "account_number": 5,
//     "state": "Rivers",
//     "is_active": true,
//     "role": "STAFF",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "profile": {
//       "id": "137ba3f4-57cb-479c-909d-8ccc2484efc0",
//       "fullname": "Grace Okafor"
//     },
//     "post": {
//       "count": 0
//     }
//   },
//   {
//     "id": "eb7c20fd-8c15-44fd-86d2-7d5ca8800d7e",
//     "username": "john",
//     "email": "john@gmail.com",
//     "account_number": 2,
//     "state": "Abuja",
//     "is_active": true,
//     "role": "STAFF",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "profile": {
//       "id": "fb2f4cb6-df2d-4ac0-aca7-c47c32c4ddf7",
//       "fullname": "John Smith"
//     },
//     "post": {
//       "count": 0
//     }
//   }
// ]
// d16: [
//   {
//     "id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//     "username": "moses",
//     "email": "moses@gmail.com",
//     "account_number": 1,
//     "state": "Lagos",
//     "is_active": true,
//     "role": "ADMIN",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "post": [
//       {
//         "id": "0c8d0400-85b7-4cee-9310-f0dd8d177bb9",
//         "title": "Node.js best practices",
//         "user": {
//           "id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//           "username": "moses",
//           "profile": {
//             "fullname": "Moses Abraham",
//             "avatar": "moses.jpg"
//           }
//         }
//       }
//     ]
//   },
//   {
//     "id": "eb7c20fd-8c15-44fd-86d2-7d5ca8800d7e",
//     "username": "john",
//     "email": "john@gmail.com",
//     "account_number": 2,
//     "state": "Abuja",
//     "is_active": true,
//     "role": "STAFF",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "post": [
//       {
//         "id": "92bb93e9-5eca-40aa-b1d0-b67948f93167",
//         "title": "PostgreSQL tips and tricks",
//         "user": {
//           "id": "eb7c20fd-8c15-44fd-86d2-7d5ca8800d7e",
//           "username": "john",
//           "profile": {
//             "fullname": "John Smith",
//             "avatar": "john.jpg"
//           }
//         }
//       }
//     ]
//   }
// ]
// d17: [
//   {
//     "id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//     "username": "moses",
//     "email": "moses@gmail.com",
//     "account_number": 1,
//     "state": "Lagos",
//     "is_active": true,
//     "role": "ADMIN",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "post": {
//       "min": {
//         "created_at": "2026-05-20T23:18:35.018Z"
//       }
//     }
//   },
//   {
//     "id": "eb7c20fd-8c15-44fd-86d2-7d5ca8800d7e",
//     "username": "john",
//     "email": "john@gmail.com",
//     "account_number": 2,
//     "state": "Abuja",
//     "is_active": true,
//     "role": "STAFF",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "post": {
//       "min": {
//         "created_at": "2026-05-20T23:18:35.018Z"
//       }
//     }
//   },
//   {
//     "id": "868f68a8-3b39-4158-b5b0-285c35255204",
//     "username": "sarah",
//     "email": "sarah@gmail.com",
//     "account_number": 3,
//     "state": "Kano",
//     "is_active": false,
//     "role": "STAFF",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "post": {
//       "min": {
//         "created_at": "2026-05-20T23:18:35.018Z"
//       }
//     }
//   }
// ]
// d18: [
//   {
//     "id": "f7eaeca6-46ef-4846-ba72-43ed612485b8",
//     "title": "Getting started with TypeScript",
//     "body": "TypeScript is a superset of JavaScript...",
//     "user_id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//     "created_at": "2026-05-20T23:18:35.018Z",
//     "updated_at": "2026-05-20T23:18:35.018Z",
//     "user": {
//       "max": {
//         "account_number": 1
//       }
//     }
//   },
//   {
//     "id": "0c8d0400-85b7-4cee-9310-f0dd8d177bb9",
//     "title": "Node.js best practices",
//     "body": "Node.js is a JavaScript runtime...",
//     "user_id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//     "created_at": "2026-05-20T23:18:35.018Z",
//     "updated_at": "2026-05-20T23:18:35.018Z",
//     "user": {
//       "max": {
//         "account_number": 1
//       }
//     }
//   },
//   {
//     "id": "92bb93e9-5eca-40aa-b1d0-b67948f93167",
//     "title": "PostgreSQL tips and tricks",
//     "body": "PostgreSQL is a powerful database...",
//     "user_id": "eb7c20fd-8c15-44fd-86d2-7d5ca8800d7e",
//     "created_at": "2026-05-20T23:18:35.018Z",
//     "updated_at": "2026-05-20T23:18:35.018Z",
//     "user": {
//       "max": {
//         "account_number": 2
//       }
//     }
//   }
// ]
// d19: [
//   {
//     "id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//     "username": "moses",
//     "email": "moses@gmail.com",
//     "account_number": 1,
//     "state": "Lagos",
//     "is_active": true,
//     "role": "ADMIN",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "post": [
//       {
//         "id": "f7eaeca6-46ef-4846-ba72-43ed612485b8",
//         "title": "Getting started with TypeScript",
//         "user": {
//           "id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//           "username": "moses"
//         }
//       }
//     ]
//   },
//   {
//     "id": "eb7c20fd-8c15-44fd-86d2-7d5ca8800d7e",
//     "username": "john",
//     "email": "john@gmail.com",
//     "account_number": 2,
//     "state": "Abuja",
//     "is_active": true,
//     "role": "STAFF",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "post": [
//       {
//         "id": "92bb93e9-5eca-40aa-b1d0-b67948f93167",
//         "title": "PostgreSQL tips and tricks",
//         "user": {
//           "id": "eb7c20fd-8c15-44fd-86d2-7d5ca8800d7e",
//           "username": "john"
//         }
//       }
//     ]
//   }
// ]
// d20: [
//   {
//     "id": "283f6928-9333-496f-b84f-156cd722e100",
//     "username": "david",
//     "email": "david@gmail.com",
//     "account_number": 4,
//     "state": "Lagos",
//     "is_active": true,
//     "role": "SUPERADMIN",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "profile": {
//       "id": "408a61cd-912a-4160-8ade-13f842b7c724",
//       "fullname": "David Williams"
//     },
//     "post": [
//       {
//         "id": "47b2b8c6-d713-426b-9729-cb9780002986",
//         "title": "React hooks explained",
//         "user": {
//           "id": "283f6928-9333-496f-b84f-156cd722e100",
//           "username": "david",
//           "email": "david@gmail.com",
//           "profile": {
//             "fullname": "David Williams"
//           },
//           "post": {
//             "count": 1
//           }
//         }
//       }
//     ]
//   },
//   {
//     "id": "e8eaf393-3a6a-4d42-b02f-ccbec70aeec0",
//     "username": "grace",
//     "email": "grace@gmail.com",
//     "account_number": 5,
//     "state": "Rivers",
//     "is_active": true,
//     "role": "STAFF",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "profile": {
//       "id": "137ba3f4-57cb-479c-909d-8ccc2484efc0",
//       "fullname": "Grace Okafor"
//     },
//     "post": []
//   },
//   {
//     "id": "eb7c20fd-8c15-44fd-86d2-7d5ca8800d7e",
//     "username": "john",
//     "email": "john@gmail.com",
//     "account_number": 2,
//     "state": "Abuja",
//     "is_active": true,
//     "role": "STAFF",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z",
//     "profile": {
//       "id": "fb2f4cb6-df2d-4ac0-aca7-c47c32c4ddf7",
//       "fullname": "John Smith"
//     },
//     "post": [
//       {
//         "id": "92bb93e9-5eca-40aa-b1d0-b67948f93167",
//         "title": "PostgreSQL tips and tricks",
//         "user": {
//           "id": "eb7c20fd-8c15-44fd-86d2-7d5ca8800d7e",
//           "username": "john",
//           "email": "john@gmail.com",
//           "profile": {
//             "fullname": "John Smith"
//           },
//           "post": {
//             "count": 1
//           }
//         }
//       }
//     ]
//   }
// ]
