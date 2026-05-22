// import type { Morm } from "../morm/morm.js";

// export const testFine = async (morm: Morm) => {
//   try {
//     await morm.transaction(async (trx) => {
//       const start = Date.now();

//       const result = await trx.user.find({
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
//                   profile: {
//                     include: { fullname: true },
//                   },
//                   post: {
//                     count: true,
//                     where: { title: { contains: "a" } },
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

//       console.log(`Total time: ${Date.now() - start}ms`);
//       console.log(JSON.stringify(result, null, 2));
//     });
//   } catch (error) {
//     console.error("Failed to connect to the database:", error);
//     process.exit(1);
//   }
// };

// // results
//   ⚡ find "user" — 3 rows — 13ms
//   ⚡ find "profile" — 3 rows — 5ms
//   ⚡ find "user" — 2 rows — 1ms
//   ⚡ find "profile" — 2 rows — 2ms
//     Total time: 39ms
// [
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
