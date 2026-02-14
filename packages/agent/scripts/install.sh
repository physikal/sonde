#!/usr/bin/env bash
set -euo pipefail

# Create sonde system user if needed
if ! id -u sonde &>/dev/null; then
  useradd --system --shell /usr/sbin/nologin --home-dir /var/lib/sonde --create-home sonde
fi

mkdir -p /etc/sonde /var/lib/sonde
chown sonde:sonde /etc/sonde /var/lib/sonde
chmod 750 /etc/sonde /var/lib/sonde
