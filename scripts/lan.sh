#!/bin/sh
# Where other computers reach this one, for `make up` and the Share dialog.
#
#   scripts/lan.sh ips                     this computer's network addresses, one per line
#   scripts/lan.sh kind IP                 the network an address is on: wired, wifi, unknown
#   scripts/lan.sh origins PORT [IP ...]   the links to offer, best first, comma-separated,
#                                          each as KIND|ORIGIN
#
# Addresses: the one the default route leaves from first — the interface a colleague's
# machine reaches — then every other real interface, so a computer on both the wired
# network and the Wi-Fi gets a link for each. Docker, libvirt, VPN and other virtual
# interfaces are left out: nobody else can reach those.
#
# Links: the computer's DNS name first, when the network's own DNS resolves it to one of
# those addresses. At 42 Madrid every seat has one (c2r19s1.42madrid.com), and it
# survives a change of address. Then each address. Then, only when there is no DNS name, the mDNS `.local`
# name, which home networks resolve but not every device does.
#
# Each link says which kind of network it reaches this computer over, because that is
# who can open it: a computer on the wired network only is out of reach of a laptop on
# the Wi-Fi wherever the two are kept apart — at 42 Madrid they are — and the dialog has
# to say so rather than offer a link that fails without a word.
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

# The interface an address is on.
iface_of() {
	ip -4 -o addr show 2>/dev/null |
		awk -v ip="$1" '{ split($4, a, "/"); if (a[1] == ip) { print $2; exit } }'
}

# wired, wifi or unknown: the kind of network an address is on. A virtual interface —
# one with no device behind it — is unknown, not wired: nothing says who can reach it.
kind() {
	dev=$(iface_of "$1")
	if [ -n "$dev" ] && [ -d "/sys/class/net/$dev" ]; then
		if [ -d "/sys/class/net/$dev/wireless" ] || [ -e "/sys/class/net/$dev/phy80211" ]; then
			echo wifi
		elif [ -e "/sys/class/net/$dev/device" ]; then
			echo wired
		else
			echo unknown
		fi
		return 0
	fi
	# macOS: the hardware port behind the device that has the address.
	if command -v networksetup >/dev/null 2>&1; then
		for dev in en0 en1 en2 en3 en4 en5 en6 en7 en8 en9; do
			[ "$(ipconfig getifaddr "$dev" 2>/dev/null)" = "$1" ] || continue
			port=$(networksetup -listallhardwareports 2>/dev/null |
				awk -v dev="$dev" '/^Hardware Port:/ { sub(/^Hardware Port: /, ""); port = $0 }
					$0 == "Device: " dev { print port; exit }')
			case "$port" in
			Wi-Fi | AirPort) echo wifi ;;
			*Ethernet* | *LAN*) echo wired ;;
			*) echo unknown ;;
			esac
			return 0
		done
	fi
	echo unknown
}

# The addresses a name resolves to through DNS — not /etc/hosts, which can say anything.
resolve() {
	if command -v dig >/dev/null 2>&1; then
		dig +short +time=1 +tries=1 "$1" A 2>/dev/null
	elif command -v host >/dev/null 2>&1; then
		host -W 1 -t A "$1" 2>/dev/null | awk '/has address/ { print $4 }'
	fi
}

# This computer's name on the network's DNS, and the address it resolves to, if the DNS
# agrees it is one of `$@`.
dns_name() {
	name=$(hostname -f 2>/dev/null || hostname)
	case "$name" in *.*) ;; *) return 0 ;; esac
	case "$name" in *.local | *.localdomain | localhost*) return 0 ;; esac
	answers=$(resolve "$name")
	for ip in "$@"; do
		if printf '%s\n' "$answers" | grep -qxF "$ip"; then
			printf '%s %s\n' "$name" "$ip"
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
	named=$(dns_name "$@")
	{
		# The name reaches this computer over the network its address is on.
		if [ -n "$named" ]; then
			printf '%s %s\n' "$(kind "${named#* }")" "${named%% *}"
		fi
		for ip in "$@"; do printf '%s %s\n' "$(kind "$ip")" "$ip"; done
		# A `.local` name answers on every network this computer is on.
		if [ -z "$named" ]; then
			local_name=$(mdns_name)
			if [ -n "$local_name" ]; then
				kinds=$(for ip in "$@"; do kind "$ip"; done | sort -u)
				case "$kinds" in *"
"*) kinds=unknown ;; esac
				printf '%s %s\n' "$kinds" "$local_name"
			fi
		fi
	} | awk -v port="$port" 'NF == 2 { printf "%s%s|http://%s:%s", (n++ ? "," : ""), $1, $2, port }'
	printf '\n'
}

case "${1:-}" in
ips) ips ;;
kind) shift && kind "$1" ;;
origins) shift && origins "$@" ;;
*)
	echo "usage: $0 ips | kind IP | origins PORT [IP ...]" >&2
	exit 2
	;;
esac
