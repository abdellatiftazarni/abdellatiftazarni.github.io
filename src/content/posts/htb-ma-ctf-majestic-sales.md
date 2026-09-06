---
title: "Majestic Sales — HTB Morocco Meetups Summer CTF Cup (Web Medium)"
published: 2026-09-06
description: "Writeup for the Majestic Sales challenge from the Hack The Box Morocco Meetups Summer CTF Cup. SQL injection in the JWT kid header parameter allows forging an admin JWT token to bypass authentication."
image: ""
tags: [HackTheBox, CTF, Web, Medium, JWT, SQLi, SQL-Injection, Authentication-Bypass]
category: Writeups
draft: false
---

## Challenge Info

| Field      | Value                                  |
|------------|----------------------------------------|
| Event      | HTB Morocco Meetups Summer CTF Cup     |
| Category   | Web                                    |
| Difficulty | Medium                                 |
| Objective  | Gain admin access to retrieve the flag |

---

## Overview

**Majestic Sales** is a medium web challenge that combines **SQL injection** with **JWT token forgery**. The application uses JWT for authentication and fetches the signing secret from a database using the `kid` (Key ID) field from the JWT header — without sanitizing it. By injecting a SQL `UNION` payload into the `kid` field, we can make the application use our own arbitrary string as the JWT secret, allowing us to forge a valid admin token.

**Topics covered:**
- JWT structure and the `kid` header parameter
- SQL injection inside a JWT header field
- UNION-based SQL injection to inject a custom value
- JWT token forgery with a controlled secret

---

## Reconnaissance

The application presents a login and registration page:

![Login and registration page](/assets/images/writeups/htb-ma-ctf/majestic-sales/image-1.png)

After registering and logging in, we are issued a JWT and redirected to `/dashboard`. The dashboard shows no interesting functionality — only a message:

> **🚨 Login as "admin" to view the flag here 🚨**

This tells us the goal: forge a JWT with `"username": "admin"`.

---

## Source Code Analysis

### JWT Middleware

In `middleware/AuthMiddleware.js`, the application validates incoming JWTs:

```js
if (kid === undefined) return res.status(500).send(response('kid is missing or doesn\'t exist!'));
db.getAppKey(kid)
```

The middleware extracts the `kid` value directly from the JWT header and passes it to `db.getAppKey()`. The `kid` field is meant to tell the server *which* key to use for verifying the signature — but here it's passed unsanitized into a database query.

### The SQL Injection

In `database.js`, the `getAppKey()` function builds the query using string concatenation:

```js
let query = `SELECT * FROM app_config WHERE kid = '${kid}';`;
```

The `kid` value is inserted directly into the SQL query with **no parameterization or escaping**, making this vulnerable to SQL injection.

### Database Schema

From the source code, we can see the `app_config` table structure:

```sql
CREATE TABLE app_config (id, kid UNIQUE, tenant, secret);
```

The table has **4 columns** and the `secret` — the JWT signing key — is the **4th column**. This is the value we need to control.

---

## Exploitation

### Strategy

The plan is to use a **UNION-based SQL injection** in the `kid` field to make the query return a row where the `secret` column contains a value *we choose*. We can then sign a forged JWT with that same value, and the server will accept it as valid.

### Constructing the Payload

A `UNION SELECT` injection that returns 4 columns (matching the original table) and puts our chosen secret (`ninho`) in the 4th position:

```
kid: 0' UNION SELECT 1,2,3,'ninho'-- -
```

- `0'` — closes the original `WHERE kid = '...'` condition with a value that doesn't exist, so the original query returns no rows.
- `UNION SELECT 1,2,3,'ninho'` — appends our own row with `ninho` as the secret (column 4).
- `-- -` — comments out the rest of the original query.

### Forging the JWT

We construct a JWT with:
- **Header**: `alg: HS256`, `kid: 0' UNION SELECT 1,2,3,'ninho'-- -`
- **Payload**: `username: admin`, `tenant: uk_office`
- **Signature**: signed with the secret `ninho`

The resulting forged token:

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6IjAnIFVOSU9OIFNFTEVDVCAxLDIsMywnbmluaG8nLS0gLSJ9.eyJ1c2VybmFtZSI6ImFkbWluIiwidGVuYW50IjoidWtfb2ZmaWNlIiwiaWF0IjoxNzg4MjA3NTQ2fQ.6bEcsThrLff_gxqozEXWWa6nI09aEA_po-oLh-gh9HQ
```

When the server receives this JWT:
1. It reads `kid = "0' UNION SELECT 1,2,3,'ninho'-- -"` from the header.
2. It runs the injected query, which returns `ninho` as the secret.
3. It verifies the JWT signature using `ninho` — which matches because *we* signed it with `ninho`.
4. The token is accepted and we are authenticated as `admin`.

### Result

Setting the forged JWT as the session cookie and visiting `/dashboard`:

![Admin dashboard with the flag](/assets/images/writeups/htb-ma-ctf/majestic-sales/image-2.png)

The admin panel loads and reveals the flag.

---

## Flag

```
HTB{0rd3r_of_th3_un10n_1nj3c70r5}
```
