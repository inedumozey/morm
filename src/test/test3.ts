// import type { Morm } from "../morm/morm.js";

// export const testFine = async (morm: Morm) => {
//   try {
//     await morm.transaction(async (trx) => {
//       // FINAL ULTIMATE STRESS TEST

//       const start = Date.now();

//       // MEGA1 — 5 levels deep, all parameters, parallel at every level
//       const mega1 = await trx.user.find({
//         include: {
//           post: {
//             where: {
//               and: [
//                 { title: { contains: "a" } },
//                 { title: { notContains: "Build" } },
//                 {
//                   or: [
//                     { title: { startsWith: "G" } },
//                     { title: { startsWith: "N" } },
//                     { title: { startsWith: "J" } },
//                     { title: { startsWith: "R" } },
//                   ],
//                 },
//               ],
//             },
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
//                   role: true,
//                   post: {
//                     where: {
//                       or: [
//                         { title: { contains: "Type" } },
//                         { title: { contains: "Node" } },
//                         { title: { contains: "Post" } },
//                       ],
//                     },
//                     orderBy: { title: "desc" },
//                     take: 1,
//                     include: {
//                       id: true,
//                       title: true,
//                       user: {
//                         include: {
//                           id: true,
//                           username: true,
//                           profile: {
//                             exclude: {
//                               avatar: true,
//                               user_id: true,
//                               created_at: true,
//                               updated_at: true,
//                             },
//                           },
//                           post: {
//                             count: true,
//                             where: { title: { contains: "a" } },
//                           },
//                         },
//                       },
//                     },
//                   },
//                   profile: {
//                     include: { fullname: true, avatar: true },
//                   },
//                 },
//               },
//             },
//           },
//           profile: {
//             exclude: { avatar: true, user_id: true },
//           },
//         },
//         where: { is_active: true },
//         orderBy: { username: "asc" },
//         take: 3,
//       });

//       // MEGA2 — async functions at every level, 4 deep
//       const mega2 = await trx.user.find({
//         include: {
//           post: async () => {
//             const keyword = await Promise.resolve("a");
//             const limit = await Promise.resolve(1);
//             return {
//               where: {
//                 and: [
//                   { title: { contains: keyword } },
//                   { title: { notStartsWith: "Build" } },
//                 ],
//               },
//               orderBy: { title: "asc" },
//               take: limit,
//               include: {
//                 id: true,
//                 title: true,
//                 user: async () => ({
//                   include: {
//                     id: true,
//                     username: true,
//                     email: true,
//                     post: async () => ({
//                       count: true,
//                       where: { title: { contains: keyword } },
//                     }),
//                     profile: async () => ({
//                       include: { fullname: true },
//                     }),
//                   },
//                 }),
//               },
//             };
//           },
//           profile: async () => ({
//             exclude: {
//               avatar: true,
//               user_id: true,
//               created_at: true,
//               updated_at: true,
//             },
//           }),
//         },
//         where: {
//           and: [{ is_active: true }, { role: { not: "MARKED" } }],
//         },
//         orderBy: { username: "asc" },
//         take: 3,
//       });

//       // MEGA3 — post as entry point, complex nested user → posts → user
//       const mega3 = await trx.post.find({
//         include: {
//           user: {
//             include: {
//               id: true,
//               username: true,
//               email: true,
//               role: true,
//               post: {
//                 where: {
//                   or: [
//                     { title: { contains: "Type" } },
//                     { title: { contains: "Node" } },
//                     { title: { contains: "Post" } },
//                     { title: { contains: "Java" } },
//                   ],
//                 },
//                 orderBy: { title: "asc" },
//                 take: 1,
//                 include: {
//                   id: true,
//                   title: true,
//                   user: {
//                     include: {
//                       id: true,
//                       username: true,
//                       profile: {
//                         include: { fullname: true },
//                       },
//                       post: {
//                         count: true,
//                       },
//                     },
//                   },
//                 },
//               },
//               profile: {
//                 include: { fullname: true, avatar: true },
//               },
//             },
//             where: { is_active: true },
//           },
//         },
//         where: {
//           and: [
//             { title: { contains: "a" } },
//             {
//               or: [
//                 { title: { startsWith: "G" } },
//                 { title: { startsWith: "N" } },
//                 { title: { startsWith: "J" } },
//               ],
//             },
//           ],
//         },
//         orderBy: { title: "asc" },
//         take: 3,
//       });

//       // MEGA4 — aggregations at every level with where filters
//       const mega4 = await trx.user.find({
//         include: {
//           post: {
//             count: true,
//             where: {
//               and: [
//                 { title: { contains: "a" } },
//                 { title: { notContains: "React" } },
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
//         take: 5,
//       });

//       // MEGA5 — cursor pagination + take + where + deep nested
//       const mega5 = await trx.user.find({
//         include: {
//           post: {
//             after: { id: "0c8d0400-85b7-4cee-9310-f0dd8d177bb9" },
//             orderBy: { id: "asc" },
//             include: {
//               id: true,
//               title: true,
//               user: {
//                 include: {
//                   id: true,
//                   username: true,
//                   post: {
//                     where: { title: { contains: "a" } },
//                     orderBy: { title: "desc" },
//                     take: 1,
//                     include: {
//                       id: true,
//                       title: true,
//                       user: {
//                         include: {
//                           id: true,
//                           username: true,
//                           profile: {
//                             include: { fullname: true },
//                           },
//                         },
//                       },
//                     },
//                   },
//                   profile: {
//                     include: { fullname: true },
//                   },
//                 },
//               },
//             },
//           },
//           profile: {
//             include: { id: true, fullname: true },
//           },
//         },
//         where: { username: "moses" },
//       });

//       // MEGA6 — everything at once: all operators, all aggregations, all projections
//       const mega6 = await trx.user.find({
//         include: {
//           post: {
//             where: {
//               and: [
//                 { title: { contains: "a" } },
//                 { title: { notContains: "React" } },
//                 { title: { notStartsWith: "Build" } },
//                 {
//                   or: [
//                     { title: { endsWith: "s" } },
//                     { title: { endsWith: "t" } },
//                     { title: { endsWith: "t" } },
//                   ],
//                 },
//               ],
//             },
//             orderBy: { title: "asc" },
//             take: 2,
//             page: 1,
//             mode: "sensitive",
//             exclude: {
//               body: true,
//               created_at: true,
//               updated_at: true,
//               user_id: true,
//             },
//             include: {
//               id: true,
//               title: true,
//               user: {
//                 include: {
//                   id: true,
//                   username: true,
//                   email: true,
//                   post: {
//                     where: {
//                       or: [
//                         { title: { contains: "Type" } },
//                         { title: { contains: "Node" } },
//                       ],
//                     },
//                     orderBy: { title: "desc" },
//                     take: 1,
//                     include: {
//                       id: true,
//                       title: true,
//                       user: {
//                         include: {
//                           id: true,
//                           username: true,
//                           profile: {
//                             exclude: {
//                               avatar: true,
//                               user_id: true,
//                               created_at: true,
//                               updated_at: true,
//                             },
//                           },
//                           post: {
//                             count: true,
//                             where: { title: { contains: "a" } },
//                           },
//                         },
//                       },
//                     },
//                   },
//                   profile: {
//                     include: { fullname: true },
//                   },
//                 },
//               },
//             },
//           },
//           profile: {
//             exclude: { avatar: true, user_id: true },
//           },
//         },
//         where: {
//           and: [
//             { is_active: true },
//             {
//               or: [
//                 { role: "ADMIN" },
//                 { role: "SUPERADMIN" },
//                 { role: "STAFF" },
//               ],
//             },
//           ],
//         },
//         orderBy: { username: "asc" },
//         take: 3,
//         distinct: { username: true },
//       });

//       console.log(`Total time: ${Date.now() - start}ms`);
//       console.log("mega1:", JSON.stringify(mega1, null, 2));
//       console.log("mega2:", JSON.stringify(mega2, null, 2));
//       console.log("mega3:", JSON.stringify(mega3, null, 2));
//       console.log("mega4:", JSON.stringify(mega4, null, 2));
//       console.log("mega5:", JSON.stringify(mega5, null, 2));
//       console.log("mega6:", JSON.stringify(mega6, null, 2));
//     });
//   } catch (error) {
//     console.error("Failed to connect to the database:", error);
//     process.exit(1);
//   }
// };

// // results
//   ⚡ find "user" — 3 rows — 12ms
//   ⚡ find "profile" — 3 rows — 25ms
//   ⚡ find "user" — 1 rows — 1ms
//   ⚡ find "profile" — 1 rows — 2ms
//   ⚡ find "user" — 3 rows — 14ms
//   ⚡ find "profile" — 3 rows — 4ms
//   ⚡ find "user" — 2 rows — 1ms
//   ⚡ find "profile" — 2 rows — 3ms
//   ⚡ find "post" — 3 rows — 14ms
//   ⚡ find "user" — 1 rows — 6ms
//   ⚡ find "profile" — 1 rows — 2ms
//   ⚡ find "user" — 1 rows — 5ms
//   ⚡ find "profile" — 1 rows — 7ms
//   ⚡ find "user" — 5 rows — 3ms
//   ⚡ find "profile" — 4 rows — 1ms
//   ⚡ find "user" — 1 rows — 3ms
//   ⚡ find "profile" — 1 rows — 6ms
//   ⚡ find "post" — 1 rows — 7ms
//   ⚡ find "user" — 1 rows — 2ms
//   ⚡ find "profile" — 1 rows — 1ms
//   ⚡ find "user" — 1 rows — 3ms
//   ⚡ find "profile" — 1 rows — 54ms
//   ⚡ find "user" — 3 rows — 13ms
//   ⚡ find "profile" — 3 rows — 13ms
//   ⚡ find "user" — 1 rows — 8ms
//   ⚡ find "profile" — 1 rows — 8ms
// Total time: 371ms
// mega1: [
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
//       "fullname": "David Williams",
//       "created_at": "2026-05-20T23:16:12.400Z",
//       "updated_at": "2026-05-20T23:16:12.400Z"
//     },
//     "post": [
//       {
//         "id": "47b2b8c6-d713-426b-9729-cb9780002986",
//         "title": "React hooks explained",
//         "user": {
//           "id": "283f6928-9333-496f-b84f-156cd722e100",
//           "username": "david",
//           "email": "david@gmail.com",
//           "role": "SUPERADMIN",
//           "profile": {
//             "fullname": "David Williams",
//             "avatar": "david.jpg"
//           },
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
//       "id": "137ba3f4-57cb-479c-909d-8ccc2484efc0",
//       "fullname": "Grace Okafor",
//       "created_at": "2026-05-20T23:16:12.400Z",
//       "updated_at": "2026-05-20T23:16:12.400Z"
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
//       "fullname": "John Smith",
//       "created_at": "2026-05-20T23:16:12.400Z",
//       "updated_at": "2026-05-20T23:16:12.400Z"
//     },
//     "post": []
//   }
// ]
// mega2: [
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
// mega3: [
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
//       "email": "moses@gmail.com",
//       "role": "ADMIN",
//       "profile": {
//         "fullname": "Moses Abraham",
//         "avatar": "moses.jpg"
//       },
//       "post": [
//         {
//           "id": "f7eaeca6-46ef-4846-ba72-43ed612485b8",
//           "title": "Getting started with TypeScript",
//           "user": {
//             "id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//             "username": "moses",
//             "post": {
//               "count": 2
//             },
//             "profile": {
//               "fullname": "Moses Abraham"
//             }
//           }
//         }
//       ]
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
//       "email": "moses@gmail.com",
//       "role": "ADMIN",
//       "profile": {
//         "fullname": "Moses Abraham",
//         "avatar": "moses.jpg"
//       },
//       "post": [
//         {
//           "id": "f7eaeca6-46ef-4846-ba72-43ed612485b8",
//           "title": "Getting started with TypeScript",
//           "user": {
//             "id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//             "username": "moses",
//             "post": {
//               "count": 2
//             },
//             "profile": {
//               "fullname": "Moses Abraham"
//             }
//           }
//         }
//       ]
//     }
//   }
// ]
// mega4: [
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
//       "count": 1
//     }
//   },
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
//     "post": {
//       "count": 2
//     }
//   },
//   {
//     "id": "abfb28c1-7ca2-46e4-84c8-6881664a72c3",
//     "username": "orphan",
//     "email": "orphan@gmail.com",
//     "account_number": 99,
//     "state": "Lagos",
//     "is_active": true,
//     "role": "STAFF",
//     "created_at": "2026-05-21T21:36:27.647Z",
//     "updated_at": "2026-05-21T21:36:27.647Z",
//     "profile": null,
//     "post": {
//       "count": 0
//     }
//   }
// ]
// mega5: [
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
//                 "profile": {
//                   "fullname": "Moses Abraham"
//                 }
//               }
//             }
//           ]
//         }
//       }
//     ]
//   }
// ]
// mega6: [
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
//       "fullname": "David Williams",
//       "created_at": "2026-05-20T23:16:12.400Z",
//       "updated_at": "2026-05-20T23:16:12.400Z"
//     },
//     "post": []
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
//       "fullname": "Grace Okafor",
//       "created_at": "2026-05-20T23:16:12.400Z",
//       "updated_at": "2026-05-20T23:16:12.400Z"
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
//       "fullname": "John Smith",
//       "created_at": "2026-05-20T23:16:12.400Z",
//       "updated_at": "2026-05-20T23:16:12.400Z"
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
//           "post": []
//         }
//       }
//     ]
//   }
// ]
