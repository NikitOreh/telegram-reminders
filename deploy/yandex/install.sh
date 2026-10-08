#!/usr/bin/env bash
set -euo pipefail

if (( EUID != 0 )); then
  echo 'Run with sudo: sudo bash deploy/yandex/install.sh /path/to/staged-project' >&2
  exit 1
fi

source_dir="${1:-$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)}"
project_dir=/opt/telegram-reminders
node_dir=/opt/node22

for required in bot.js package.json package-lock.json data.json .env; do
  if [[ ! -f "$source_dir/$required" ]]; then
    echo "Missing $required in $source_dir" >&2
    exit 1
  fi
done

if systemctl is-active --quiet telegram-reminders.service; then
  echo 'Stop the cloud bot before reinstalling to avoid replacing its live state' >&2
  exit 1
fi

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl python3 xz-utils

if [[ ! -x "$node_dir/bin/node" ]] || ! "$node_dir/bin/node" --version | grep -q '^v22\.'; then
  temp_dir="$(mktemp -d)"
  trap 'rm -rf -- "$temp_dir"' EXIT
  curl --fail --silent --show-error --location https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o "$temp_dir/SHASUMS256.txt"
  archive="$(awk '$2 ~ /^node-v22[.][0-9.]+-linux-x64[.]tar[.]xz$/ { print $2; exit }' "$temp_dir/SHASUMS256.txt")"
  if [[ -z "$archive" ]]; then
    echo 'Node.js 22 Linux x64 archive not found in official checksums' >&2
    exit 1
  fi
  curl --fail --silent --show-error --location "https://nodejs.org/dist/latest-v22.x/$archive" -o "$temp_dir/$archive"
  (cd "$temp_dir" && grep -F "  $archive" SHASUMS256.txt | sha256sum --check --status)
  install -d -m 0755 "$node_dir"
  tar -xJf "$temp_dir/$archive" -C "$node_dir" --strip-components=1
fi

if ! id reminderbot >/dev/null 2>&1; then
  useradd --system --home-dir "$project_dir" --shell /usr/sbin/nologin reminderbot
fi
install -d -o reminderbot -g reminderbot -m 0700 "$project_dir"
cp -a -- "$source_dir/." "$project_dir/"
chown -R reminderbot:reminderbot "$project_dir"
chmod 0600 "$project_dir/.env" "$project_dir/data.json"
runuser -u reminderbot -- env "PATH=$node_dir/bin:$PATH" "$node_dir/bin/npm" ci --omit=dev --prefix "$project_dir"
runuser -u reminderbot -- env "PATH=$node_dir/bin:$PATH" "$node_dir/bin/npm" run verify --prefix "$project_dir"
install -d -o reminderbot -g reminderbot -m 0700 /var/backups/telegram-reminders
install -m 0644 "$project_dir/deploy/yandex/telegram-reminders.service" /etc/systemd/system/
install -m 0644 "$project_dir/deploy/yandex/telegram-reminders-backup.service" /etc/systemd/system/
install -m 0644 "$project_dir/deploy/yandex/telegram-reminders-backup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable telegram-reminders-backup.timer
systemctl start telegram-reminders-backup.timer
echo 'Installed but bot not started or enabled. After stopping the Windows copy, run: sudo systemctl enable --now telegram-reminders'
