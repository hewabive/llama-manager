#!/usr/bin/env bash
set -euo pipefail

TARGET_USER="${1:-${SUDO_USER:-}}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo $0 <user-that-runs-llama-manager>" >&2
  exit 1
fi

if [[ -z "$TARGET_USER" ]]; then
  echo "Usage: sudo $0 <user-that-runs-llama-manager>" >&2
  exit 1
fi

if ! id "$TARGET_USER" >/dev/null 2>&1; then
  echo "Unknown user: $TARGET_USER" >&2
  exit 1
fi

if [[ "$(stat -fc %T /sys/fs/cgroup 2>/dev/null || true)" != "cgroup2fs" ]]; then
  echo "cgroup v2 unified is not mounted at /sys/fs/cgroup." >&2
  echo "On RHEL/Rocky 8 boot with systemd.unified_cgroup_hierarchy=1, then re-run." >&2
  exit 1
fi

if ! grep -qw cpuset /sys/fs/cgroup/cgroup.controllers; then
  echo "The cpuset controller is not available at the root cgroup (kernel too old?)." >&2
  exit 1
fi

UID_N="$(id -u "$TARGET_USER")"
DROPIN_DIR=/etc/systemd/system/user@.service.d
DROPIN_FILE="$DROPIN_DIR/delegate-cpuset.conf"

install -d -m 0755 "$DROPIN_DIR"
cat >"$DROPIN_FILE" <<'CONF'
[Service]
Delegate=cpu cpuset memory pids
CONF
echo "Wrote $DROPIN_FILE"

systemctl daemon-reload
echo "Reloaded systemd unit files."

loginctl enable-linger "$TARGET_USER"
echo "Enabled linger for $TARGET_USER (uid $UID_N)."

CTRL_FILE="/sys/fs/cgroup/user.slice/user-$UID_N.slice/user@$UID_N.service/cgroup.controllers"

echo
if [[ -r "$CTRL_FILE" ]] && grep -qw cpuset "$CTRL_FILE"; then
  echo "OK: cpuset is now delegated to $TARGET_USER."
  echo "llama-manager will report numaEnforcement = cgroup-v2."
else
  echo "Delegation is staged but not active in the running user manager yet."
  echo "Apply it one of these ways:"
  echo "  - have $TARGET_USER log out and back in (cleanest), or"
  echo "  - systemctl restart user@$UID_N.service   (kills $TARGET_USER's session processes)"
  echo
  echo "Then verify as $TARGET_USER:"
  echo "  grep -w cpuset $CTRL_FILE   # cpuset should be listed"
fi

echo
echo "This assumes llama-manager runs as user $TARGET_USER (user session)."
echo "If it runs as a system service, add Delegate=cpu cpuset memory pids to"
echo "that unit instead. See docs/NUMA_PINNING.md."
