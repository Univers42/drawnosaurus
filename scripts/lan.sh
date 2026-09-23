#!/bin/sh
# Where other computers reach this one, for `make up` and the Share dialog.
#
#   scripts/lan.sh ips                     this computer's network addresses, one per line
#   scripts/lan.sh origins PORT [IP ...]   the links to offer, best first, comma-separated
#
# Addresses: the one the default route leaves from first — the interface a colleague's
# machine reaches — then every other real interface, so a computer on both the wired
# network and the Wi-Fi gets a link for each. Docker, libvirt, VPN and other virtual
# interfaces are left out: nobody else can reach those.
#
# Links: the computer's DNS name first, when the network's own DNS resolves it to one of
# those addresses. At 42 Madrid every seat has one (c2r19s1.42madrid.com), and it is the
# link that works from the wired network and the Wi-Fi alike and survives a change of
# address. Then each address. Then, only when there is no DNS name, the mDNS `.local`
# name, which home networks resolve but not every device does.
set -eu

ips() {
	{
		# The source address of the route to the internet.
		ip route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p'
		# Every other IPv4 address on a real interface.
		ip -4 -o addr show 2>/dev/null |
			awk '{ split($4, a, "/"); print $2, a[1] }' |
			grep -Ev '^(lo|docker|br-|veth|virbr|vnet|tailscale|tun|tap|wg|zt|podman|cni|flannel|vmnet|vboxnet|lxc|lxd)' |
			awk '{ print $2 }'
		# macOS: Wi-Fi and Ethernet.
		ipconfig getifaddr en0 2>/dev/null || true
		ipconfig getifaddr en1 2>/dev/null || true
	} | awk 'NF && !seen[$0]++'
}

# The addresses a name resolves to through DNS — not /etc/hosts, which can say anything.
resolve() {
	if command -v dig >/dev/null 2>&1; then
		dig +short +time=1 +tries=1 "$1" A 2>/dev/null
	elif command -v host >/dev/null 2>&1; then
		host -W 1 -t A "$1" 2>/dev/null | awk '/has address/ { print $4 }'
	fi
}

# This computer's name on the network's DNS, if the DNS agrees it is one of `$@`.
dns_name() {
	name=$(hostname -f 2>/dev/null || hostname)
	case "$name" in *.*) ;; *) return 0 ;; esac
	case "$name" in *.local | *.localdomain | localhost*) return 0 ;; esac
	answers=$(resolve "$name")
	for ip in "$@"; do
		if printf '%s\n' "$answers" | grep -qxF "$ip"; then
			printf '%s\n' "$name"
			return 0
		fi
	done
}

mdns_name() {
	short=$(hostname -s 2>/dev/null || hostname)
	if [ "$(uname)" = Darwin ] ||
		{ command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet avahi-daemon 2>/dev/null; }; then
		printf '%s.local\n' "$short"
	fi
}

origins() {
	port=$1
	shift
	# shellcheck disable=SC2046 # one address per word, on purpose
	[ "$#" -gt 0 ] || set -- $(ips)
	[ "$#" -gt 0 ] || return 0
	name=$(dns_name "$@")
	{
		[ -n "$name" ] && printf '%s\n' "$name"
		for ip in "$@"; do printf '%s\n' "$ip"; done
		[ -z "$name" ] && mdns_name
	} | awk -v port="$port" 'NF { printf "%shttp://%s:%s", (n++ ? "," : ""), $0, port }'
	printf '\n'
}

case "${1:-}" in
ips) ips ;;
origins) shift && origins "$@" ;;
*)
	echo "usage: $0 ips | origins PORT [IP ...]" >&2
	exit 2
	;;
esac
