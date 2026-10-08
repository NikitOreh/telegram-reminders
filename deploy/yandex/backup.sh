#!/usr/bin/env bash
set -euo pipefail

source_file=/opt/telegram-reminders/data.json
backup_dir=/var/backups/telegram-reminders
test -s "$source_file"
install -d -m 0700 "$backup_dir"
backup_file="$backup_dir/data-$(date -u +%Y%m%dT%H%M%SZ).json"
temporary_file="${backup_file}.tmp"
trap 'rm -f -- "$temporary_file"' EXIT
cp -- "$source_file" "$temporary_file"
python3 -m json.tool "$temporary_file" >/dev/null
chmod 0600 "$temporary_file"
mv -- "$temporary_file" "$backup_file"
find "$backup_dir" -maxdepth 1 -type f -name 'data-*.json' -mtime +14 -delete
