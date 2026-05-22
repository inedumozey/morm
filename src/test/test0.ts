// import type { Morm } from "../morm/morm.js";

// export const testFine = async (morm: Morm) => {
//   try {
//     await morm.transaction(async (trx) => {
//       const post = await trx.post.find({});
//       const user = await trx.user.find({});
//       const tag = await trx.tag.find({});
//       const profile = await trx.profile.find();
//       console.log("post: ", JSON.stringify(post, null, 2));
//       console.log("user: ", JSON.stringify(user, null, 2));
//       console.log("tag: ", JSON.stringify(tag, null, 2));
//       console.log("profile: ", JSON.stringify(profile, null, 2));
//     });
//   } catch (error) {
//     console.error("Failed to connect to the database:", error);
//     process.exit(1);
//   }
// };

// // results

// ⚡ find "post" — 6 rows — 11ms
//   ⚡ find "user" — 6 rows — 5ms
//   ⚡ find "tag" — 5 rows — 4ms
//   ⚡ find "profile" — 5 rows — 3ms
// post:  [
//   {
//     "id": "f7eaeca6-46ef-4846-ba72-43ed612485b8",
//     "title": "Getting started with TypeScript",
//     "body": "TypeScript is a superset of JavaScript...",
//     "user_id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//     "created_at": "2026-05-20T23:18:35.018Z",
//     "updated_at": "2026-05-20T23:18:35.018Z"
//   },
//   {
//     "id": "0c8d0400-85b7-4cee-9310-f0dd8d177bb9",
//     "title": "Node.js best practices",
//     "body": "Node.js is a JavaScript runtime...",
//     "user_id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//     "created_at": "2026-05-20T23:18:35.018Z",
//     "updated_at": "2026-05-20T23:18:35.018Z"
//   },
//   {
//     "id": "92bb93e9-5eca-40aa-b1d0-b67948f93167",
//     "title": "PostgreSQL tips and tricks",
//     "body": "PostgreSQL is a powerful database...",
//     "user_id": "eb7c20fd-8c15-44fd-86d2-7d5ca8800d7e",
//     "created_at": "2026-05-20T23:18:35.018Z",
//     "updated_at": "2026-05-20T23:18:35.018Z"
//   },
//   {
//     "id": "47b2b8c6-d713-426b-9729-cb9780002986",
//     "title": "React hooks explained",
//     "body": "React hooks allow you to use state...",
//     "user_id": "283f6928-9333-496f-b84f-156cd722e100",
//     "created_at": "2026-05-20T23:18:35.018Z",
//     "updated_at": "2026-05-20T23:18:35.018Z"
//   },
//   {
//     "id": "0c11985c-51c2-438e-98f7-d3ebed0cc59d",
//     "title": "Building REST APIs",
//     "body": "REST APIs are the backbone of modern apps...",
//     "user_id": "283f6928-9333-496f-b84f-156cd722e100",
//     "created_at": "2026-05-20T23:18:35.018Z",
//     "updated_at": "2026-05-20T23:18:35.018Z"
//   },
//   {
//     "id": "ec95eaaa-4d23-4369-ba85-406e149d7c8e",
//     "title": "JavaScript async/await",
//     "body": "Async/await makes asynchronous code easier...",
//     "user_id": "868f68a8-3b39-4158-b5b0-285c35255204",
//     "created_at": "2026-05-20T23:18:35.018Z",
//     "updated_at": "2026-05-20T23:18:35.018Z"
//   }
// ]
// user:  [
//   {
//     "id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//     "username": "moses",
//     "email": "moses@gmail.com",
//     "account_number": 1,
//     "state": "Lagos",
//     "is_active": true,
//     "role": "ADMIN",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z"
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
//     "updated_at": "2026-05-20T23:14:34.006Z"
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
//     "updated_at": "2026-05-20T23:14:34.006Z"
//   },
//   {
//     "id": "283f6928-9333-496f-b84f-156cd722e100",
//     "username": "david",
//     "email": "david@gmail.com",
//     "account_number": 4,
//     "state": "Lagos",
//     "is_active": true,
//     "role": "SUPERADMIN",
//     "created_at": "2026-05-20T23:14:34.006Z",
//     "updated_at": "2026-05-20T23:14:34.006Z"
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
//     "updated_at": "2026-05-20T23:14:34.006Z"
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
//     "updated_at": "2026-05-21T21:36:27.647Z"
//   }
// ]
// tag:  [
//   {
//     "id": "3484d33a-11ef-486f-9416-e1a61f92b12f",
//     "name": "javascript",
//     "created_at": "2026-05-20T23:17:34.157Z",
//     "updated_at": "2026-05-20T23:17:34.157Z"
//   },
//   {
//     "id": "eb1b01a3-4472-4b61-9f81-0070de39e192",
//     "name": "typescript",
//     "created_at": "2026-05-20T23:17:34.157Z",
//     "updated_at": "2026-05-20T23:17:34.157Z"
//   },
//   {
//     "id": "5d400801-957c-46b1-a35c-9ff66320d7bd",
//     "name": "nodejs",
//     "created_at": "2026-05-20T23:17:34.157Z",
//     "updated_at": "2026-05-20T23:17:34.157Z"
//   },
//   {
//     "id": "56bffd81-ba54-4aba-9085-165040b6476f",
//     "name": "postgresql",
//     "created_at": "2026-05-20T23:17:34.157Z",
//     "updated_at": "2026-05-20T23:17:34.157Z"
//   },
//   {
//     "id": "7611029a-d07f-4a3f-89b2-0dd2766c4b2d",
//     "name": "react",
//     "created_at": "2026-05-20T23:17:34.157Z",
//     "updated_at": "2026-05-20T23:17:34.157Z"
//   }
// ]
// profile:  [
//   {
//     "id": "c1eca46f-7a07-4e7a-9dd9-866650abffca",
//     "fullname": "Moses Abraham",
//     "avatar": "moses.jpg",
//     "user_id": "b79d6010-3efd-4662-b3ad-06259bdd1928",
//     "created_at": "2026-05-20T23:16:12.400Z",
//     "updated_at": "2026-05-20T23:16:12.400Z"
//   },
//   {
//     "id": "fb2f4cb6-df2d-4ac0-aca7-c47c32c4ddf7",
//     "fullname": "John Smith",
//     "avatar": "john.jpg",
//     "user_id": "eb7c20fd-8c15-44fd-86d2-7d5ca8800d7e",
//     "created_at": "2026-05-20T23:16:12.400Z",
//     "updated_at": "2026-05-20T23:16:12.400Z"
//   },
//   {
//     "id": "3558154f-5cd7-4237-8d4e-ab1078858037",
//     "fullname": "Sarah Johnson",
//     "avatar": "sarah.jpg",
//     "user_id": "868f68a8-3b39-4158-b5b0-285c35255204",
//     "created_at": "2026-05-20T23:16:12.400Z",
//     "updated_at": "2026-05-20T23:16:12.400Z"
//   },
//   {
//     "id": "408a61cd-912a-4160-8ade-13f842b7c724",
//     "fullname": "David Williams",
//     "avatar": "david.jpg",
//     "user_id": "283f6928-9333-496f-b84f-156cd722e100",
//     "created_at": "2026-05-20T23:16:12.400Z",
//     "updated_at": "2026-05-20T23:16:12.400Z"
//   },
//   {
//     "id": "137ba3f4-57cb-479c-909d-8ccc2484efc0",
//     "fullname": "Grace Okafor",
//     "avatar": "grace.jpg",
//     "user_id": "e8eaf393-3a6a-4d42-b02f-ccbec70aeec0",
//     "created_at": "2026-05-20T23:16:12.400Z",
//     "updated_at": "2026-05-20T23:16:12.400Z"
//   }
// ]
