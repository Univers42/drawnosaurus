# Drawing together

**In one sentence:** open a board, press **Share** (top right), and send the first link.
Whoever opens it draws on the board with you, live — from another computer on your
network, or from anywhere through the internet link. Nothing to install, no account.

## Where to find everything

| What                                  | Where                                                               |
| ------------------------------------- | ------------------------------------------------------------------- |
| The link to send                      | A board → **Share** → the first link, with its **Copy link** button |
| The same link for a phone or a tablet | The **QR** button next to it: they scan it with their camera        |
| A link for someone on the Wi-Fi       | **Share** → **Share on the internet** (see below why)               |
| A link for someone far away           | **Share** → **Share on the internet**                               |
| The network link, from the terminal   | `make up` prints it on its last lines                               |
| This guide                            | `docs/collaboration.md`, and **Share** → **How does this work?**    |

## On the same network

1. On the computer that runs drawnosaurus: `make up`. It ends with the link for your
   network, and which network that is:

   ```
   ✔ up: http://localhost:5273
     for people on the wired network: http://c2r19s1.42madrid.com:5274
     this computer is not on the Wi-Fi: for anyone there, or elsewhere, run 'make share'
   ```

2. Open a board at `http://localhost:5273`, press **Share**, press **Copy link**.
3. Send it — chat, mail, anything — or press **QR** and let them scan it.
4. They open it and you draw together. Every change is saved on your computer.

**By name.** The first link uses your computer's _name_, not its address: at 42 Madrid
every seat has one (`c2r19s1.42madrid.com`), given out by the school's DNS, and it keeps
working if your computer's address changes. Where the network gives computers no name —
at home, usually — the first link is the address (`http://192.168.1.20:5274`), and
**Other links** often has the `.local` name as well.

**The wired network and the Wi-Fi are two networks.** A link reaches your computer over
the network your computer is on, and the dialog says which — `make up` looks at the
interface each address belongs to. A lab computer is on the wired network only, and the
school keeps the Wi-Fi apart from it: a laptop on the Wi-Fi cannot reach `10.12.x.x` at
all, by name or by address, and the page simply never loads. Nothing on your computer
changes that. **For someone on the Wi-Fi, use Share on the internet** — it goes around.
At home, where the router joins its Wi-Fi and its cables into one network, the network
link works from both. A computer that is on the wired network and the Wi-Fi at once gets
a link for each.

`virbr0` (`192.168.122.1`), in `ip addr`, is not the Wi-Fi: it is a virtual network that
libvirt makes for virtual machines inside this computer, and nothing outside can reach
it. The Wi-Fi card is the `wl…` interface (`wlp3s0` here); `ip -4 addr show wlp3s0`
shows no address while it is not connected.

Why port 5274, when you use 5273? 5273 only answers this computer; 5274 is the door for
everyone else, and it only lets them into the boards they have links to (see
[Who can do what](#who-can-do-what)). The links always carry the right port.

## Anywhere on the internet

1. In the **Share** dialog, press **Share on the internet**. About ten seconds later a
   second link appears there, `https://….trycloudflare.com/…`.
2. Send that one. It works from any network — another school, home, a phone on mobile
   data.
3. When you are done: **Stop sharing on the internet**. The link stops working at once.
   Restarting drawnosaurus (`make up`) closes it too. The next one gets a new address,
   so an old link cannot be reused.

From a terminal it is `make share` and `make unshare`.

It is a Cloudflare _quick tunnel_: drawnosaurus dials out to Cloudflare, which gives it a
public HTTPS address — no account, and no port to open on any router or firewall, so it
works from networks you do not control. The link is offered only once Cloudflare's DNS
publishes the new name, so the first person to open it is not told it does not exist. It
is made for a working session, not for hosting: Cloudflare may slow a tunnel that is used
heavily.

## Working on the same thing

- **You see what the others do while they do it.** A shape someone is drawing grows on
  your screen as they draw it; one they are moving, resizing or turning moves on yours
  before they let go. Their cursor and name follow their mouse.
- **The laser pointer (`K`) shows on every screen**, not only the presenter's: a trail
  follows their mouse while they hold the button down, in their colour, and fades out the
  way it does for them once they let go. It is a gesture, not a mark — it never becomes
  part of the drawing, so there is nothing to undo and nothing saved.
- **What someone has selected is theirs until they let go.** It is outlined in their
  colour with their name on it, and nobody else can select it, move it, resize it, edit
  its text, delete it or erase it — the eraser passes over it, and undo leaves it as they
  have it. A click on it says who is working on it. When they select something else, it
  is anyone's again.
- **Two people reaching for the same shape at once:** the one who took it first keeps it
  — both screens agree — and the other lets go without their change being applied.
- **A text shows while it is typed**, word by word, and nobody else can touch it until
  it is finished.
- **Whoever arrives gets everything on the board**, including what the others drew a
  moment ago and has not been saved yet: the people already there send it. A picture or a
  video is sent once; moving it afterwards sends only where it went.
- **When someone leaves** — closes the tab, reloads, loses their connection — what they
  held is released at once. A tab duplicated from another is a second person, and the two
  see each other.

## Can it be fully automatic?

Everything but the sending. drawnosaurus finds your computer's name and addresses, builds
the links with the room key in them, puts the best one first, opens the internet link on
a click, and shows a QR code. What it cannot do is make the link appear on your
colleague's screen by itself: a browser has no way to look around the network for
drawnosaurus, so someone has to send them the link — or show them the QR code.

## Who can do what

|                                            | You, on this computer | Anyone with a link |
| ------------------------------------------ | :-------------------: | :----------------: |
| Open and edit the board the link points to |          yes          |        yes         |
| See the list of all boards                 |          yes          |         no         |
| Create or delete boards                    |          yes          |         no         |
| Open or close the internet link            |          yes          |         no         |

- **A link is a key.** Anyone who has it can open and edit that board — send it only to
  the people you want there.
- **Live changes are end-to-end encrypted.** The part of the link after `#room=` is the
  room key. Browsers never send what follows a `#` to a server, so the live link carries
  only sealed frames that neither drawnosaurus's server nor Cloudflare can read. The
  saved board itself is stored readable, on your computer.
- **Nothing else is open.** Other computers reach port 5274 and nothing more: port 5273,
  the API and the database answer this computer only.

## When it does not work

**The link does not open on the other computer.** Try the other links, under **Other
links** — the address instead of the name, or the other way round. To see whether the
network is the problem, on that computer:

```sh
curl http://c2r19s1.42madrid.com:5274/healthz
```

(with your computer's name or address). `{"status":"ok"}`: the network is fine — check
the link was copied whole. If it hangs or is refused, something between the two computers
blocks it:

- they are on the Wi-Fi and your computer is on the wired network: at school the two are
  kept apart (see [On the same network](#on-the-same-network)), and many Wi-Fi networks
  also stop the devices on them from talking to each other. Nothing on your computer
  changes that — use **Share on the internet**, which goes around it;
- a firewall on the computer running drawnosaurus. If you administer it:
  `sudo ufw allow 5274/tcp` (Ubuntu), or allow incoming connections for Docker (macOS).

**The first link is not the right one** — several networks, a VPN: find the right
address (`ip -4 addr` or `hostname -I` on Linux, `ipconfig getifaddr en0` on macOS) and
start with it:

```sh
make up LAN_IPS=192.168.1.20
```

**Port 5274 is taken:** `make up SHARE_PORT=5500`. The links follow.

**Share on the internet says it did not open:** the network blocks connections to
Cloudflare. The message says what happened; there is no way around it from here.

**The header says "Connection lost — reconnecting…":** the live link dropped. It
reconnects by itself, and nothing drawn in the meantime is lost on either side: once the
link is back, each side sends the other what it missed. A link that dies without closing
— a laptop lid shut, a network changed — is noticed within about fifteen seconds and
reopened. If it stays, check the stack is up: `docker compose ps`.

**A video or a frame's name was missing after reloading a board saved before this was
fixed:** the server used to drop an embed's address, a frame's name and what was inside a
frame. Open the board once in the browser that made it: its local copy still has them,
and they are put back and saved again.

**"Only the computer running drawnosaurus can do that":** the home page, or deleting a
board, from another computer. That is on purpose — open boards from their links.

## How it works

```
 you, on this computer ── 127.0.0.1:5273 ──▶ gateway :80 ─┐
 the network ──────────── any address:5274 ─▶ gateway :81 ─┼─▶ web (the app)
 the internet ── Cloudflare ── tunnel ──────▶ gateway :82 ─┘   api (/v1, live websocket) ─▶ mongo
```

- **One origin.** The gateway (`docker/gateway/Caddyfile`) serves the app and its API
  together, so a page talks back to wherever it was opened from — `localhost`, the
  computer's name, an address, the tunnel's name — and one link works from all of them.
- **Who is asking is where they came in.** Each entrance tells the API who is on the
  other side, and guests are kept to the boards they have links to. Nothing in a request
  can change that: a door cannot be faked the way a header can.
- **The Share dialog asks the server where it can be reached** (`GET /v1/share`): the
  name and addresses `make up` found (`scripts/lan.sh`), and the internet link while it
  is open. Someone arriving from the internet is not told the network addresses.
- **Plain `http://` on the network is enough.** Browsers offer their built-in
  cryptography only to `https://` pages and `localhost`, so a colleague opening
  `http://c2r19s1.42madrid.com:5274` has none. The live link then uses the same
  encryption written in JavaScript (`@noble/ciphers`, `@noble/hashes`): same key, same
  sealed frames, so the two of you read each other either way.

Checked end to end on the real stack, in browsers driven through the dialog: the link
Share recommended opened on another browser over plain http by the computer's name, the
two drew together; **Share on the internet** gave a link in twelve seconds, a third
browser opened it at once and all three saw each other's shapes; **Stop** closed it.
`e2e/share.spec.ts` keeps what a browser spec can reach from coming back.

## While developing

`make dev` serves the app with hot reload on port 5373, reachable from the network too
(`http://10.12.19.1:5373`), but without the gateway: nobody's access is limited, and there
is no internet link. Use `make up` to work with someone else.
