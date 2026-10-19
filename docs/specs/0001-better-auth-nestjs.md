# 0001. Add Better Auth to NestJS

**Date**: 2026-10-17
**Status**: Proposed

## Summary

This feature adds email and password authentication to the existing NestJS API using Better Auth, a library that handles accounts and sign in. New users receive the PARTICIPANT role, and an ADMIN can change another user's role through one protected endpoint. The build keeps the existing PostgreSQL and Prisma setup.

## Context

The repository already uses NestJS with Express, PostgreSQL, and Prisma. The current Prisma schema has User and Post records, but the API has no account or session behavior. The feature needs public signup and sign in routes, protected API routes, a public root route, and a role change operation for administrators.

The initial Prisma migration exists locally but was not applied. The last migration attempt failed with P1001 while connecting to the configured PostgreSQL host. The database connection must work before the authentication schema can be migrated. The package manifest resolves NestJS 12, while the root `CLAUDE.md` still says NestJS 11.

The requested first version uses email and password only. Email verification, password reset, social sign in, and authentication screens are not part of this backend feature. Access control is limited to the two requested roles and one role change endpoint.

## Requirements

**User stories**:

* As a participant, I want to create an account, sign in, and use a session so that I can use protected API routes.
* As an administrator, I want to change another user's role so that I can grant or remove administrative access.

**Acceptance criteria**:

* **AC-1**: The NestJS Express application registers Better Auth using the community NestJS integration from the supplied guide, and `GET /api/auth/ok` returns the Better Auth health response.
* **AC-2**: A user can sign up and sign in with email and password, retrieve their current session, and sign out. The session is managed by Better Auth.
* **AC-3**: Every new account has the PARTICIPANT role. Signup cannot set or override the role. The database only permits PARTICIPANT and ADMIN.
* **AC-4**: An authenticated ADMIN can change another user's role to PARTICIPANT or ADMIN through the role endpoint. The response includes the updated user ID and role, and the change is logged with the acting user, target user, previous role, and new role.
* **AC-5**: The role endpoint returns an authentication error to anonymous callers, a permission error to non administrators, a validation error for an unsupported role, and a not found error for an unknown user.
* **AC-6**: The existing `GET /` route remains public. Better Auth sign in and signup routes remain usable without an existing session. Other NestJS routes require authentication by default.
* **AC-7**: The Prisma migration for the confirmed authentication schema applies to the intended PostgreSQL database, and Prisma Client is regenerated from that schema.

## Options considered

### Option 1: Better Auth with the community NestJS integration

Use `better-auth` with `@thallesp/nestjs-better-auth`, following the supplied guide. Register the integration in the NestJS app and use the existing Prisma database for auth records (basis: supplied guide and the integration package's documented registration and guard behavior).

**Pros**:

* Matches the requested guide and provides NestJS route protection and session access.
* Reuses the existing API framework and database.
* Keeps the first release to one authentication system and one role endpoint.

**Cons**:

* The NestJS integration is community maintained.
* Body parsing moves under the integration's control, so other routes need explicit parser configuration.
* The package versions must be checked against the installed NestJS 12 and Prisma 7 versions before implementation.

### Option 2: Handle Better Auth through a custom NestJS adapter

Use Better Auth without the community NestJS integration and build the NestJS route and session bridge directly (basis: standard NestJS request handling and dependency injection).

**Pros**:

* The project controls request handling and dependency injection.
* It avoids depending on the community NestJS integration package.

**Cons**:

* The project must maintain routing, raw body handling, session access, and route protection itself.
* It departs from the guide the engineer asked to follow and creates more project code.

## Decision

**Chosen option**: Option 1: Better Auth with the community NestJS integration.

Follow the supplied NestJS guide, use Better Auth with the existing Prisma PostgreSQL database, enable email and password sign in, and add only the agreed role endpoint. Configure the role as a Better Auth additional field with input disabled and a PARTICIPANT default. Use `AuthModule.forRootAsync` instead of `forRoot` so Nest can inject the existing Prisma service into the Better Auth configuration.

**Implementation skills**: `better-auth-best-practices` (`better-auth/skills`, `.agents/skills/better-auth-best-practices/`)

## Rationale

The engineer explicitly asked to follow the Better Auth NestJS integration guide (basis: supplied guide and the integration package's module API). The repository already has the NestJS, Express, Prisma, and PostgreSQL foundation, so this choice adds the requested behavior without introducing a second application framework or database. Use the integration's asynchronous module registration to inject the existing Prisma service into the Better Auth configuration. This preserves Nest dependency injection while using the same integration and route behavior from the guide.

The integration is community maintained, but its current module supports asynchronous registration and provides parser configuration for regular NestJS routes (basis: integration module source). The build must keep that parser configuration and check the installed versions against NestJS 12 and Prisma 7. This costs less than maintaining a custom Better Auth bridge.

## Feature design

**Data model sketch**:

| Entity | Key fields and rules | Relationships |
|---|---|---|
| User | `id` is an auto incrementing integer primary key. `email` is required and unique. `name` remains optional as in the existing schema, though signup requires it. `emailVerified` is required and defaults to false. `image` is optional. `createdAt` and `updatedAt` are required. `role` uses `UserRole` and defaults to PARTICIPANT. | One User has many Sessions, Accounts, and existing Posts. |
| UserRole | Enum values are PARTICIPANT and ADMIN. | Used by User and the role endpoint. |
| Session | String `id`, unique `token`, required `expiresAt`, `createdAt`, `updatedAt`, optional `ipAddress` and `userAgent`, required integer `userId`. | Each Session belongs to one User. |
| Account | String `id`, required `accountId`, `providerId`, integer `userId`, `createdAt`, and `updatedAt`; provider tokens, token expiry dates, scope, and password hash are optional. The pair `providerId` and `accountId` is unique. | Each Account belongs to one User. |
| Verification | String `id`, required `identifier`, `value`, and `expiresAt`; `createdAt` and `updatedAt` are optional. | Standalone verification record. |
| Post | Keep the existing fields, primary key, and author relationship unchanged. | Each Post remains linked to one User. |

Use Better Auth's serial ID generation so auth created User IDs remain compatible with the current integer User and Post relationship (basis: Better Auth's Prisma adapter and numeric ID guidance). Better Auth represents these IDs as strings in its API responses; Prisma stores them as integers. User deletion is not enabled in this feature. Sessions and Accounts are removed with their User.

**State transitions**:

User roles can be PARTICIPANT or ADMIN. Signup creates PARTICIPANT. An ADMIN can change another user's role to either value through the role endpoint. There is no signup transition that grants ADMIN.

**API surface**:

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/api/auth/sign-up/email` | POST | `name`, `email`, `password` | User and session | Public | Better Auth validation error, duplicate email |
| `/api/auth/sign-in/email` | POST | `email`, `password` | User and session cookie | Public | Invalid credentials, rate limit |
| `/api/auth/get-session` | GET | Better Auth session cookie | Current session and user, or no session | Session cookie | Expired or invalid session |
| `/api/auth/sign-out` | POST | Better Auth session cookie | Sign out result | Session cookie | Expired or invalid session |
| `/api/auth/ok` | GET | None | `{ "status": "ok" }` | Public | Service unavailable |
| `/admin/users/:userId/role` | PATCH | Decimal integer `userId` path value, `role` body value from UserRole | Updated user ID as a string and role | ADMIN session required | 400 invalid ID or role, 401 no session, 403 not ADMIN, 404 unknown user |
| `/` | GET | None | Existing greeting response | Public | Existing application errors |

**Value sourcing**:

| Action | Value produced or displayed | Source |
|---|---|---|
| Sign up | Email, name, and password | Signup request. The password is handled by Better Auth and is not returned as a user field. |
| Sign up | User ID | User database primary key generated as an integer and represented as a string by Better Auth. |
| Sign up | Initial role | UserRole database default and Better Auth field default, both PARTICIPANT. |
| Sign in and session lookup | Current user and session | Better Auth session cookie and User and Session records. |
| Sign out | Session invalidation result | Better Auth session handling. |
| Change role | Target user | Decimal integer `userId` path parameter mapped to the matching User database row. |
| Change role | New role | `role` request body, validated against UserRole. |
| Change role | Acting user | User identity from the Better Auth session. |
| Change role | Updated user ID and role | Updated User database row. The integer ID is returned as a string. |
| Change role | Audit event | Acting user session, target User row, prior role, requested role, and operation time. |
| Health check | Status value | Constant response from the Better Auth health endpoint. |
| Root route | Greeting | Existing AppService response. |

**Key invariants**:

* Email is unique.
* User roles are limited to PARTICIPANT and ADMIN.
* Signup cannot provide a role. The Better Auth role field is not accepted as signup input, and a new account always has PARTICIPANT.
* Only an ADMIN can change another user's role.
* Role changes record the actor, target, previous value, and new value in structured application logs.
* Secrets and passwords are never written to logs.
* Passwords are stored only as Better Auth password hashes, never as plain text.

**Security model**:

Signup and sign in are public Better Auth operations. The integration's global guard protects NestJS routes by default. The root greeting remains explicitly public. The role endpoint requires a valid session whose user has role ADMIN. Participants cannot change roles, and signup data cannot grant ADMIN.

The first ADMIN is provisioned by a trusted operator changing the role of an existing account directly in the database. No public bootstrap endpoint is added. Email addresses and authentication sessions are sensitive account data. Store the Better Auth secret and connection strings in ignored environment configuration. Use Better Auth's built in rate limiting for public authentication routes and its standard session cookie protections.

**Configuration required**:

* `DATABASE_URL`: existing PostgreSQL connection used by Prisma.
* `BETTER_AUTH_SECRET`: private random secret used by Better Auth. Keep it out of source control.
* `BETTER_AUTH_URL`: public base URL of the Better Auth API.
* `BETTER_AUTH_TRUSTED_ORIGINS` (optional): comma separated browser origins, needed when a client uses an origin different from `BETTER_AUTH_URL`.

**Critical test scenarios**:

* Happy path: sign up, confirm the account has PARTICIPANT, sign in, retrieve the session, and sign out, verifies **AC-2** and **AC-3**.
* Failure case: signup cannot create an ADMIN even when the request includes a role, verifies **AC-3**.
* Auth and permission: an anonymous caller receives 401 and a PARTICIPANT receives 403 from the role endpoint, verifies **AC-5**.
* Admin path: an ADMIN changes another user's role, and the result and structured audit event contain the expected values, verifies **AC-4**.
* Failure case: an unsupported role receives 400 and an unknown user receives 404, verifies **AC-5**.
* Integration: the auth health endpoint works, the root route remains public, and a protected NestJS route rejects an anonymous request, verifies **AC-1** and **AC-6**.
* Database: the migration applies and client generation succeeds against the configured database, verifies **AC-7**.

## Build plan

The project has no recorded delivery approach. Use one end to end Tracer Bullet, completing the database, authentication, and role endpoint together before expanding scope.

1. Add the auth packages and configure Better Auth with the existing Prisma service through `AuthModule.forRootAsync`. Use the confirmed UserRole and Better Auth entities, preserving the Post relationship. Apply the migration only after the database connection succeeds, then regenerate Prisma Client, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-7**.
2. Disable Nest's body parser as required by the guide, then configure the integration's parsers for other NestJS routes. Register the Better Auth module, keep its authentication routes public, and explicitly mark `GET /` with `@AllowAnonymous()`, satisfies **AC-1**, **AC-2**, **AC-6**.
3. Add the ADMIN protected role endpoint with enum validation, database update, standard HTTP errors, and structured role change logging, satisfies **AC-3**, **AC-4**, **AC-5**.
4. Add focused tests for signup defaults, email and password sessions, route access, role changes, error cases, and the auth health endpoint, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-5**, **AC-6**.

## Consequences

**Positive**:

* The API gains email and password authentication without a separate authentication service.
* The current Prisma database remains the source of user, account, and session data.
* The role rules have one clear default and one ADMIN protected change endpoint.

**Negative and tradeoffs**:

* The NestJS integration is community maintained and needs version compatibility checks.
* Body parsing is configured through the auth integration, so future NestJS routes must preserve its parser setup.
* Email verification and password reset are not available until a mail delivery choice is made.
* The database migration cannot be applied until the P1001 connection failure is resolved.
* Structured role audit events depend on the application's log retention and collection setup.

**Neutral**:

* The integration protects NestJS routes by default, so future public routes must be explicitly marked anonymous.
* The first ADMIN requires a trusted operator to update the database after account creation.

## Follow-up

* [ ] Restore a working PostgreSQL connection before applying the migration. The last `prisma migrate dev` attempt failed with P1001.
* [ ] Add the Better Auth skill conventions to `src/module/auth/AGENTS.md` when the auth module is created. The repository's root guidance does not yet point to this skill.
* [ ] Reconcile the NestJS version in `CLAUDE.md`, which says 11, with the package manifest, which resolves version 12.
* [ ] Revisit email verification and password reset when an email delivery provider is selected.

## References

**Project sources**:

* Root `CLAUDE.md`, which defines NestJS module and dependency injection conventions.
* The Better Auth integration guide supplied by the engineer.
* `better-auth-best-practices`, consulted for Prisma adapters, role fields, sessions, and configuration.

**Practices and standards**:

* Least privilege for role restricted operations.
* Keep passwords and application secrets out of logs and source control.

**Links**:

* Better Auth NestJS integration: https://github.com/ThallesP/nestjs-better-auth
* Async NestJS module configuration: https://github.com/ThallesP/nestjs-better-auth/blob/36ca28e10e5346ee601d8656993a2e5cf6472306/src/auth-module.ts#L338-L404
* NestJS body parser and anonymous route behavior: https://github.com/ThallesP/nestjs-better-auth/blob/36ca28e10e5346ee601d8656993a2e5cf6472306/README.md#L35-L56
* Better Auth Prisma adapter: https://github.com/better-auth/better-auth/blob/abee9506c3580690c079e1979494b188b9bea38e8/docs/content/docs/adapters/prisma.mdx#L12-L29
* Better Auth numeric ID support: https://github.com/better-auth/better-auth/blob/abee9506c3580690c079e1979494b188b9bea38e8/docs/content/docs/concepts/database.mdx#L792-L821
