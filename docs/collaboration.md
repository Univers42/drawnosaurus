# Drawing together

One computer runs drawnosaurus; everyone else opens a link in their browser. Nothing to
install on the other computers, no account anywhere. Pick the case that fits:

| Where your colleague is            | What you run            | The link looks like                                                          |
| ---------------------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| On the same Wi-Fi or wired network | `make up`               | `http://10.12.19.1:5273/boards/4w355vfvgm#room=…`                            |
| Anywhere on the internet           | `make up`, `make share` | `https://proper-ensure-suse-moss.trycloudflare.com/boards/4w355vfvgm#room=…` |

In both cases the link comes from the board's **Share** button — never from the address
bar, which says `localhost` and would send your colleague to their own computer.

## On the same network (LAN or Wi-Fi)

1. On the computer that runs drawnosaurus:

   ```sh
   make up
   ```

   It ends with the address other computers reach it at:

   ```
   ✔ up: http://localhost:5273
     on your network: http://10.12.19.1:5273  (docs/collaboration.md)
   ```

2. Open a board (from `http://localhost:5273`), press **Share** at the top right, and copy
   the link under **People on your network**.
3. Send it to your colleague — chat, mail, anything. They open it in their browser.
4. Draw. Each of you sees the other's cursor and every change as it happens, and the
   board is saved on your computer.

## Over the internet

1. With the stack running (`make up`):

   ```sh
   make share
   ```

   ```
   ✔ on the internet: https://proper-ensure-suse-moss.trycloudflare.com
   ```

2. Press **Share** on the board: a second link appears under **Anyone on the internet**.
   Send that one.
3. When you are done:

   ```sh
   make unshare
   ```

   The address stops working at once. Each `make share` gets a new random one, so an old
   link cannot be reused later.

This is a Cloudflare _quick tunnel_: the tunnel container dials out to Cloudflare, which
gives it a public HTTPS address and passes requests back through. No account, no port to
open on your router or firewall — it works from networks you do not control, such as a
school's. It is made for a working session, not for hosting a site: the address changes
every time, and Cloudflare may slow a tunnel down if it is used heavily.

## Who can do what

|                                            | You, on this computer | Anyone with a link |
| ------------------------------------------ | :-------------------: | :----------------: |
| Open and edit the board the link points to |          yes          |        yes         |
| See the list of all boards                 |          yes          |         no         |
| Create or delete boards                    |          yes          |         no         |

- **A link is a key.** Anyone who has it can open and edit that board — send it only to
  the people you want there.
- **Live changes are end-to-end encrypted.** The part of the link after `#room=` is the
  room key. Browsers never send what follows a `#` to a server, so the live link carries
  only sealed frames that neither drawnosaurus's server nor Cloudflare can read. The saved
  board itself is stored readable, on your computer.
- **Only the port you share is open.** Other computers reach port 5273 and nothing else:
  the API's own port and the database are bound to this computer only.
- `make unshare` closes the internet link. `make down` stops everything.

## When it does not work

**The link does not open on the other computer.** From that computer, run:

```sh
curl http://10.12.19.1:5273/healthz
```

(with the address `make up` printed). `{"status":"ok"}` means the network is fine — check
the link was copied whole. If it hangs or is refused, something between the two computers
blocks it:

- many school, office and guest Wi-Fi networks isolate the machines on them from one
  another. Nothing on your computer can change that — use `make share` instead, which
  goes around it;
- a firewall on the computer running drawnosaurus. If you administer it:
  `sudo ufw allow 5273/tcp` (Ubuntu), or allow incoming connections for Docker (macOS).

**`make up` printed no address, or the wrong one** — several network interfaces, a VPN:
find the right one (`ip -4 addr` or `hostname -I` on Linux, `ipconfig getifaddr en0` on
macOS) and pass it:

```sh
make up LAN_IP=192.168.1.20
```

**Port 5273 is taken:** `make up WEB_PORT=5500`. The links follow.

**`make share` says the tunnel did not come up:** the network blocks outgoing
connections to Cloudflare. `docker compose --profile share logs tunnel` says why.

**The header says "Connection lost — reconnecting…":** the live link dropped. It
reconnects by itself, and nothing drawn in the meantime is lost — it is sent once the
link is back. If it stays, check the stack is up: `docker compose ps`.

**Only the board list fails, with "Only the computer running drawnosaurus can list…":**
you opened the home page from another computer. That is on purpose — open boards from
their links.

## How it works

```
 your browser ──┐
 colleague's ───┼──▶ gateway :5273 ──┬──▶ web   (the app)
 via tunnel ────┘    (Caddy)         └──▶ api   (/v1, and the live websocket) ──▶ mongo
```

- **One address for everything.** The gateway (`docker/gateway/Caddyfile`) serves the app
  and its API on the same origin, so a page talks back to wherever it was opened from —
  `localhost`, `10.12.19.1`, or the tunnel's name — and one link works from all of them.
  It is also what keeps guests to the boards they are given.
- **The Share dialog asks the server where it can be reached** (`GET /v1/share`): the
  network address `make up` found, and the tunnel's public address when `make share` is
  running. Someone arriving through the tunnel is not told the network address.
- **Plain `http://` on the network is enough.** Browsers only offer their built-in
  cryptography to `https://` pages and to `localhost`, so a colleague opening
  `http://10.12.19.1:5273` has none. The live link then uses the same encryption written
  in JavaScript (`@noble/ciphers`, `@noble/hashes`): same key, same sealed frames, so the
  two of you read each other either way.

Checked end to end on the real stack: a browser on `localhost` and one on
`http://10.12.19.1:5273` (no built-in cryptography) drawing on the same board, then the
same through a `make share` tunnel — each saw the other's shapes, and the board was saved
with both. `e2e/share.spec.ts` keeps the parts a browser spec can reach from coming back:
the Share dialog's links, and two pages drawing together when one of them has no Web
Crypto.

## While developing

`make dev` serves the app with hot reload on port 5373. It is reachable from the network
too (`http://10.12.19.1:5373`), but without the gateway: nobody's access is limited, and
there is no tunnel. Use `make up` to work with someone else.
