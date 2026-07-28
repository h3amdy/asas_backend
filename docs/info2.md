Welcome to Ubuntu 24.04.3 LTS (GNU/Linux 6.8.0-117-generic x86_64)

 * Documentation:  https://help.ubuntu.com
 * Management:     https://landscape.canonical.com
 * Support:        https://ubuntu.com/pro

 System information as of Tue Jul 28 13:35:29 UTC 2026

  System load:  0.1                Processes:             136
  Usage of /:   21.9% of 47.39GB   Users logged in:       1
  Memory usage: 28%                IPv4 address for eth0: 168.231.115.146
  Swap usage:   0%                 IPv6 address for eth0: 2a02:4780:f:99c9::1

 * Strictly confined Kubernetes makes edge and IoT secure. Learn how MicroK8s
   just raised the bar for easy, resilient and secure K8s cluster deployment.

   https://ubuntu.com/engage/secure-kubernetes-at-the-edge

Expanded Security Maintenance for Applications is not enabled.

73 updates can be applied immediately.
1 of these updates is a standard security update.
To see these additional updates run: apt list --upgradable

Enable ESM Apps to receive additional future security updates.
See https://ubuntu.com/esm or run: sudo pro status


1 updates could not be installed automatically. For more details,
see /var/log/unattended-upgrades/unattended-upgrades.log

*** System restart required ***
Last login: Tue Jul 28 13:33:26 2026 from 127.0.0.1
root@srv992229:~# # 1. تأكد الخطة موجودة
curl http://localhost:3000/api/v1/owner/backups/plans

# 2. أنشئ أول backup
curl -X POST http://localhost:3000/api/v1/owner/backups/trigger \
  -H "Content-Type: application/json" \
  -d '{"triggeredBy": "MANUAL"}'

# 3. تابع الحالة
curl http://localhost:3000/api/v1/owner/backups/jobs

# 4. شاهد النسخ
curl http://localhost:3000/api/v1/owner/backups/instances

# 5. Dashboard
curl http://localhost:3000/api/v1/owner/backups/dashboard
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Error</title>
</head>
<body>
<pre>Cannot GET /api/v1/owner/backups/plans</pre>
</body>
</html>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Error</title>
</head>
<body>
<pre>Cannot POST /api/v1/owner/backups/trigger</pre>
</body>
</html>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Error</title>
</head>
<body>
<pre>Cannot GET /api/v1/owner/backups/jobs</pre>
</body>
</html>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Error</title>
</head>
<body>
<pre>Cannot GET /api/v1/owner/backups/instances</pre>
</body>
</html>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Error</title>
</head>
<body>
<pre>Cannot GET /api/v1/owner/backups/dashboard</pre>
</body>
</html>
root@srv992229:~# 