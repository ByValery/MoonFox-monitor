# Changelog

## 0.7.0 - 2026-08-25

The big one: MoonFox moved off the old PowerShell/JSON runtime onto a Python + SQLite backend, and gained a full network map. Everything below shipped as one continuous line of work and is being published as a single release.

**New backend**

- Replaced the PowerShell/JSON runtime path with a Python + SQLite backend, with automatic migration from `data/db.json` to `data/moonfox.db` on first run.
- Website service types with optimized health-check paths for Jellyfin, Nextcloud, Home Assistant, Grafana and Prometheus.
- Background monitoring thread with SQLite WAL storage for 24/7 usage; every connection is explicitly closed after use (stress-tested at 9000+ requests / 90+ concurrent check cycles with a flat file-descriptor count).
- Site and device checks run concurrently via a thread pool and no longer hold the SQLite write lock during network I/O, so one slow or unreachable host no longer blocks the rest of the app or delays the whole check cycle; a failing check for one object no longer discards results already computed for the others in that cycle.
- Indexed history queries for charts by selected period; `/api/state` returns lightweight state instead of the full history archive.
- Basic Telegram sending, diagnostics and local network scanning carried over to the new backend.

**Карта (network map)**

- New "Карта" page: place router/firewall/switch/server/PC/laptop/phone/Wi-Fi/printer/cloud icons on a scrollable canvas, drag them into place, and connect them with solid (wired) or dashed (Wi-Fi) lines. A node can optionally link to an existing monitored site or device, and its border color then live-follows that object's status. The layout is saved server-side (survives restarts, included in export/import) and is untouched by "Очистить историю"/"Сбросить всё".
- Map nodes show an IP/address line under the label, auto-filled from a linked site/device or entered manually. Hovering a node reveals quick actions: 🌐 open its address in a new tab, 🔍 run the same Ping/DNS/SSL/ports/Traceroute diagnostics used for sites and devices, 🔗 start connecting it to another node, and ✂️ open a list of its current connections to disconnect one specific line — handy the moment a node (a router, say) has more than one link and it's not obvious which line on the map is which.
- Each connection line has a ▶ control that sends a real ping to the far end and animates the result along the wire (round-trip time on success, "Нет ответа" on failure).
- Node cards grow to fit long labels (up to two lines) instead of clipping them, and lines/ping animations anchor to each node's real on-screen center, so they stay correctly attached while a node is being dragged or has a longer label.
- The toolbar's own "Соединить" no longer shifts every other button sideways when "Отменить соединение" and its hint text appear after you click it.

**Security hardening**

- Added Origin/Referer validation on all `/api/*` requests, closing a CSRF hole that let any page open in the same browser (even a plain `<img>` tag) trigger destructive endpoints like `/api/reset/all` with no interaction from the user.
- Site/device/graph/map-node ids are now validated on import and on any direct save of the network map, so a crafted "shared config" or "backup" file can't smuggle in a string built to break out of the small inline scripts the interface uses for its buttons; map-node and connection ids are escaped correctly wherever they're inserted into the page.
- The static file path check is hardened against a theoretical sibling-directory bypass, and the Telegram bot token field is now a password field with a show/hide toggle instead of plain text.
- CSV report export neutralizes a site/device name starting with `=`, `+`, `-` or `@` (e.g. a hostname picked up from a LAN neighbour's PTR record during a network scan), closing a CSV/formula-injection path into Excel/Sheets.
- The number of TCP ports a single site/device check will use is capped at 32, and incoming API request bodies are capped at 100 MB — both were previously unbounded.

**Reliability fixes**

- A site returning any error page (404, 401, a Nextcloud/Jellyfin health endpoint requiring auth, etc.) is no longer always reported as "Недоступен" with response code 0 — the real status code is recorded and only 500+ counts as down.
- The SSL certificate check now reads the port from the site's own URL instead of always probing 443.
- A bad/non-numeric "интервал проверки" value can no longer permanently kill the background monitoring thread; interval/timeout settings are validated and clamped on save, and the scheduler falls back to a safe default if a bad value slips through some other way.
- Deleting a site or device no longer wipes the history of a different object that happened to share the same name.
- The Настройки page no longer silently freezes forever after touching a field and navigating away without saving.
- Clicking a second confirmation dialog while one is still open no longer leaves the first hanging forever with no feedback.
- Events in "Последние события" are no longer misfiled under the wrong tab because a device name happens to contain "site" as a substring (e.g. "off-site-cam").
- The Ping tab of the Диагностика dialog no longer silently renders an empty grid for every site and device.

**Interface polish**

- The "Действия" column in the compact preview cards is now measured directly from the real on-screen width of its buttons and re-tunes on window resize, instead of guessing a fixed percentage that left it too narrow on some widths and too wide with a dangling gap on others.

## 0.6.5 - 2026-06-27

- Added configurable chart period, chart selection and manual Y-axis maximum for overview and custom charts.
- Added independent custom charts with selected websites or devices.
- Added report export for HTML and CSV.
- Added object pause mode for websites and devices.
- Added configurable history retention by days or record count.
- Added column visibility controls and stable preview table layout.
- Added unified styled confirmation and information dialogs.
- Improved chart time scaling for long periods such as 3, 12 and 24 hours.
- Improved GitHub package preparation and release archive hygiene.

## 0.6.0 - 2026-06-09

- Added website and device diagnostics: Ping, DNS, SSL, ports, Traceroute and WHOIS/RDAP.
- Added private local network scanning and quick device import.
- Added Telegram bot commands with chat ID authorization.
- Added Russian and English interface localization.
- Added configurable website and device check intervals.
- Added line, bar and pie chart modes.
- Added persistent ordering for websites and devices.
- Added configurable overview row counts.
- Added dynamic availability artwork and updated MoonFox branding.
- Improved database writes, static file access protection and GitHub release hygiene.
