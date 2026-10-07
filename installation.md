# Installation & Deployment (Ubuntu VM)

Step-by-step guide to run the backend on an Ubuntu 22.04 server (PostgreSQL 14) and expose it over HTTPS. Replace every `<placeholder>` with your own value, and use long random values for passwords and secrets.

## 1. Clone the repository

```bash
git clone https://github.com/Ilo06/Klaody-back.git
cd Klaody-back
```

## 2. Install PostgreSQL and pgvector

```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable --now postgresql
psql --version        # note the major version, e.g. 14
```

The pgvector package name must match your PostgreSQL major version (`postgresql-14-pgvector` for PG 14). Ubuntu 22.04's default repositories may not include it. Use one of these two options.

**Option A: official PostgreSQL (PGDG) repository**

```bash
sudo apt install -y postgresql-common
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh
sudo apt update
sudo apt install -y postgresql-14-pgvector
```

**Option B: build from source**

```bash
sudo apt install -y build-essential git postgresql-server-dev-14
cd /tmp
git clone --branch v0.8.0 https://github.com/pgvector/pgvector.git
cd pgvector && make && sudo make install
cd ~/Klaody-back
```

Create the user, the database and the extension:

```bash
sudo -u postgres psql <<'SQL'
CREATE USER klaody WITH PASSWORD '<DB_PASSWORD>';
CREATE DATABASE klaody OWNER klaody;
\c klaody
CREATE EXTENSION IF NOT EXISTS vector;
SQL
```

> The message `could not change directory ... Permission denied` is harmless: the `postgres` user simply cannot read your home folder.

Check the pgvector version:

```bash
sudo -u postgres psql -d klaody -c "SELECT extname, extversion FROM pg_extension WHERE extname='vector';"
```

**If the database already existed** (owned by `postgres`), the job queue fails to start with `permission denied for database klaody`. Give the ownership to the `klaody` user:

```bash
sudo -u postgres psql -c "ALTER DATABASE klaody OWNER TO klaody;"
sudo -u postgres psql -d klaody -c "ALTER SCHEMA public OWNER TO klaody;"
sudo -u postgres psql -d klaody -c "GRANT ALL PRIVILEGES ON DATABASE klaody TO klaody;"
```

The `pgboss` schema is created by the application on its first start, not by PostgreSQL. Once the server has started, check that it exists:

```bash
sudo -u postgres psql -d klaody -c "\dn"     # should list pgboss
```

To change the database password later:

```bash
sudo -u postgres psql -c "ALTER USER klaody WITH PASSWORD '<NEW_LONG_PASSWORD>';"
```

## 3. Install Node.js 22

If `npm: command not found`: the `node` package does not exist in apt, and `sudo apt install npm` installs an outdated version. Use NodeSource:

```bash
sudo apt update
sudo apt install -y curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v    # v22.x
npm -v
```

Alternative with nvm (no sudo):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22
```

## 4. Install and configure the backend

Create the `.env` file (see [Environment Variables](README.md#environment-variables) and `.env.example`):

```
DATABASE_URL="postgresql://klaody:<DB_PASSWORD>@localhost:5432/klaody"
JWT_SECRET=<long random string>
FILE_ROOT= ../storage
PORT=3000
```

Make sure `FILE_ROOT` exists and is writable by the user running the server.

```bash
npm install --legacy-peer-deps --force   # the flags are only needed if npm reports peer-dependency conflicts
npx prisma generate
npx prisma migrate deploy                # applies existing migrations (use this in production, not migrate dev)
npm run build
npm start                                # runs node dist/server.js
curl http://localhost:3000/healthz       # should return OK
```

The first start downloads ~150 MB of CLIP model weights. If the log shows `[indexing] disabled`, the job queue could not start: check the database ownership fix in step 2.

## 5. Keep it running with PM2

```bash
sudo npm i -g pm2
pm2 start npm --name klaody-back -- start
pm2 save
pm2 startup          # run the command it prints, then: pm2 save
pm2 logs klaody-back --lines 30
pm2 restart klaody-back
```

## 6. Open the ports

**a) Cloud provider firewall** (security group / security list): allow inbound TCP 80 and 443 from `0.0.0.0/0`. Open the application port (e.g. 3000) only for a quick test.

**b) VM firewall** (Ubuntu images on Oracle Cloud)

iptables reads rules in order. The `ACCEPT` rules for ports 80 and 443 must come **before** the `REJECT ... icmp-host-prohibited` rule, otherwise the traffic is rejected (symptoms: `No route to host` and Certbot failures).

Show the current order:

```bash
sudo iptables -L INPUT -n --line-numbers
```

Example of a wrong state (rules 6 and 7 come after the `REJECT` on line 5):

```
5    REJECT     all  --  0.0.0.0/0   0.0.0.0/0   reject-with icmp-host-prohibited
6    ACCEPT     tcp  --  0.0.0.0/0   0.0.0.0/0   tcp dpt:443
7    ACCEPT     tcp  --  0.0.0.0/0   0.0.0.0/0   tcp dpt:80
```

Fix: delete the misplaced rules (highest number first), then re-insert them before the `REJECT` (here at position 5):

```bash
sudo iptables -D INPUT 7
sudo iptables -D INPUT 6
sudo iptables -I INPUT 5 -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 5 -p tcp --dport 443 -j ACCEPT
```

> Do not run the `-I` command twice for the same port, or a duplicate rule appears (harmless). To remove it: `sudo iptables -D INPUT <number>`.

Make the rules persistent across reboots (otherwise certificate renewal will break after a restart):

```bash
sudo apt install -y iptables-persistent   # if netfilter-persistent is missing
sudo netfilter-persistent save
```

With `ufw` (only if it is active): `sudo ufw allow 22/tcp && sudo ufw allow 80,443/tcp`

> Never open port 5432 (PostgreSQL) to the internet.

## 7. Expose the API: Nginx + HTTPS

Prerequisite: a domain or subdomain (for example a free DuckDNS one) pointing to the VM's public IP.

```bash
sudo apt install -y nginx certbot python3-certbot-nginx

sudo tee /etc/nginx/sites-available/klaody <<'EOF'
server {
    listen 80;
    server_name <subdomain>.duckdns.org;
    client_max_body_size 5G;          # matches the 5 GB default max file size
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_request_buffering off;  # useful for large uploads
    }
}
EOF

sudo ln -s /etc/nginx/sites-available/klaody /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d <subdomain>.duckdns.org
curl https://<subdomain>.duckdns.org/healthz
```

Certbot renews the certificate automatically. To test the renewal: `sudo certbot renew --dry-run`.

**If Certbot fails** (`Error getting validation data`, `No route to host`), port 80 is blocked before reaching nginx. Check, in this order:

```bash
curl -4 ifconfig.me                  # public IP of the VM
nslookup <subdomain>.duckdns.org     # must return the same IP (otherwise update DuckDNS)
sudo systemctl status nginx --no-pager
sudo ss -tlnp | grep -E ':80|:443'
curl -I http://localhost
sudo iptables -L INPUT -n --line-numbers   # ACCEPT 80/443 before the REJECT (see step 6)
```

Also check the **ingress** rules for TCP 80 and 443 in your cloud provider's console. Test from outside the VM: `curl -I http://<subdomain>.duckdns.org`.

> `curl https://<subdomain>.duckdns.org` (without a path) returns `Cannot GET /`. This is expected: HTTPS and the nginx proxy work, the API simply has no `/` route. Use `/healthz` or another real route.
