# Next UFC

The next UFC event in your Omarchy bar. Click it for the full fight card,
then step through every upcoming event with the arrows.

![Next UFC fight card](preview.png)

- **Bar pill** with the headliners and a countdown to the main card
  (`Moicano vs. Nolan · 6d`), turning to `LIVE` in the urgent colour once the
  first bout starts. Short on bar space? Switch to the compact fist **UFC
  badge**, which fills red and reads `LIVE` while an event is on.
- **Fight card popup** with the date and time in your time zone, venue,
  broadcaster, and every bout split into main card, prelims and early prelims,
  with records, countries, weight classes and five-round fights marked.
- **Browse ahead** through every scheduled event with ‹ › or `h` / `l`.
- **Live results**: while an event is on, it refreshes every two minutes and
  highlights each winner as bouts finish.

## Install

```bash
omarchy plugin add https://github.com/leewynne/omarchy-next-ufc.git --enable
```

The widget lands in the right section of the bar. Move it with
`omarchy bar move leewynne.next-ufc --section center` or by dragging it.

Requires an Omarchy release with the plugin shell (`omarchy plugin`) and
`curl`, which Omarchy ships.

## Use

| Action | Does |
|---|---|
| Left click | Open the fight card |
| Middle click | Refresh |
| Right click | Open the next event on ESPN |

Inside the popup: `←` `→` or `h` `l` change event, `↑` `↓` or `j` `k`
scroll the card, `Enter` opens the event on ESPN, `r` refreshes, `Esc` closes,
and `Tab` moves to the neighbouring bar panel.

It can also be driven over IPC, for a keybinding for instance:

```bash
omarchy-shell shell toggle leewynne.next-ufc '{}'
omarchy-shell leewynne.next-ufc next
omarchy-shell leewynne.next-ufc previous
omarchy-shell leewynne.next-ufc refresh
```

## Settings

Change these from the bar settings, or with `omarchy bar set`:

```bash
omarchy bar set leewynne.next-ufc label badge
omarchy bar set leewynne.next-ufc clock 24h
omarchy bar set leewynne.next-ufc refreshMinutes 60 --json
```

| Key | Values | Default |
|---|---|---|
| `label` | `fighters` (`Gane vs. Hokit · 6d`) or `badge` (fist + `UFC`, red `LIVE` during an event) | `fighters` |
| `clock` | `locale`, `24h`, `12h` | `locale` |
| `refreshMinutes` | 5–240 | `30` |

## Data

Schedules, cards and results come from ESPN's public UFC scoreboard
(`site.api.espn.com`). The plugin makes one request every `refreshMinutes`
(every two minutes while an event is live) and sends nothing else. No account
or API key is needed.

ESPN's feed is undocumented and could change; if the card stops loading,
please open an issue.

UFC is a registered trademark of Zuffa, LLC. This plugin is a fan project and
is not affiliated with, endorsed or sponsored by the UFC, Zuffa, TKO or ESPN.

## Remove

```bash
omarchy plugin remove leewynne.next-ufc
```

This removes the plugin folder and its bar entry. It stores nothing else.

## Develop

```bash
./tests/run
```

The model (`Model.js`) is plain JavaScript shared by the QML and the node
tests. `tests/fixtures/scoreboard.json` is a trimmed real ESPN response.

## License

MIT
