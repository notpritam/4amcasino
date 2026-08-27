# Feature credits

Every feature in 4AM Casino carries the name of the person who asked for it. When you ship a
feature, add a row here and mention the requester in the code comment nearest the feature's
core (see `/api/rooms/:id/hands` for the pattern).

| Feature | Requested by |
| --- | --- |
| Per-hand personal results: your net for every hand, where you folded, showdown outcome, paid-to-fold total | **siwans** |
| Live ahead-of-turn actions: options track the table, Call arms at a price and disarms if raised | **notpritam** |
| Round table: seats positioned live around an isometric oval, your seat pinned at the bottom | **notpritam** |
| Banker sees every seat and can stand a player up (two-tap kick) | **notpritam** |
| Banker badge on seats, docked side chat, fullscreen toggle, controls merged onto the table | **notpritam** |
| Leaderboard rank (#1, #2, #3...) on player profiles; profile header merged for space | **notpritam** |
| Chip physics: bets slide chip stacks to the pot, sweep in at street end, pot pulses; chip-slide and pot-collect sounds | **notpritam** |
| Big draggable hole cards (move anywhere, resize, remembered), giant winner reveal, larger table oval | **notpritam** |
| Text diet: icon labels, terse status lines; control strip moved below the table | **notpritam** |
| Blinking turn highlight: breathing glow, PLAYING pill, scale-up on the to-act seat | **notpritam** |
| Real chip stacks: denominations colored by tier off the big blind, isometric piles that grow with bets and the pot | **notpritam** |
| Pending buys shown at the seat (+N soon until the banker approves); seated / in-hand player counts in the header | **notpritam** |
| Auto-organised seating: only occupied seats, evenly spread; unseated members see + spots in the gaps | **notpritam** |
| Controls never hide mid-hand: Fold / Call / Raise stay in place off-turn and arm as pre-actions | **notpritam** |
| Mid-hand kick: the banker can stand anyone up any time; it means auto-kicked from the next deal | **notpritam** |
| Raise highlight: amber glowing badge that pops on the raiser seat; quiet chips for calls, bold ALL-IN | **notpritam** |
| The 3D world: three.js purple-cyberpunk table at /room/:id/3d, customisable characters (color, head, hat) synced to everyone, fully playable via the HUD | **notpritam** |
| 3D fun: live character preview, glow-trim + blast customisation, tap-to-shove pokes (POW), fold slumps, bust-out blasts, overhead turn arrow | **notpritam** |
| 3D casino room: carpet, neon walls, suit signs, house sign, slot machines, bar, chandelier | **notpritam** |
| Living casino ambience: spinning roulette, orbiting holo cards, blinking JACKPOT, sweeping spotlights, dust motes, wall art, bar cat | **notpritam** |
| Card reveal choreography: board cards flip back-to-face with a cascading flop, in 2D and in the 3D world (drop + flip onto the felt) | **notpritam** |
| New-design landing page (round isometric table preview, 3D world story) and README refresh with fresh screenshots | **notpritam** |
| TV replays: banker toggle that saves every player's hand key post-hand; the server decrypts folded hole cards into the transcript and replays show ALL cards from the deal, WSOP broadcast style | **notpritam** |
| Save hand: download the full signed hand record (transcript + players) as JSON from the replay page | **notpritam** |
| Ready check: auto-deal never starts betting until everyone clicks "I'm ready"; 20 seconds, then it deals without the stragglers | **notpritam** |
| Misclick guard: Fold / Check-Call / Raise hold fixed positions in every state and go dead for a beat whenever the options change | **notpritam** |
| Run it twice: when everyone is all-in before the river the players vote (15s, unanimous); the remaining streets deal twice from the untouched deck and every pot splits between the boards | **notpritam** |
| Showdown shows every player's cards: the result banner lists each player with THEIR two cards, the hand they made, and their net - not just the winning five | **notpritam** |
| Thunder reveal: lightning flash + thunder crack on every showdown, in 2D and the 3D world | **notpritam** |
| The table cards in the result banner, next to the winning five | **notpritam** |
| Position badges: bold D / SB / BB discs on the seat avatars | **notpritam** |
| Fold-key escrow: a folding client hands its per-hand key to the server (only the server, never the transcript), so a folder who leaves can never strand the hand - the server computes their unmask shares with publicly verifiable DLEQ proofs (`recovered_share`). Tradeoff: after your fold the server can decrypt your two cards, nobody else's | **notpritam** |
| Last-hand strip: a collapsible recap at the bottom of the table - previous hand's winner, board, everyone's revealed cards and nets, one click to open or cut out (remembered), with a jump to the full replay | **notpritam** |
| 1% table commission, mandatory and automatic: every pot pays 1% (floored per pot) to the banker on the ledger - the donation that keeps the platform running; shown in the result banner | **notpritam** |
| Leavers stop stalling: a player who leaves before betting starts aborts the deal in ~4s and the redeal skips them; the ready check drops leavers instantly instead of waiting out their deadline | **notpritam** |
| Profile settle-up: your own profile lists who you owe and who owes you, per room, to conclude the game; both sides mark "settled" and the debt resolves on the platform too | **notpritam** |
| Add friend + send points from any player's profile: befriend them and move points through any room you share, straight from their page | **notpritam** |
| Linear-style profile: full-width three-column layout (identity left, money and game middle, history right), settle-up grouped per room and collapsible with the bottom line in the header, URL-backed tabs | **notpritam** |
| Hand history with your cards: the profile's transaction wall compressed into per-hand rows - outcome, YOUR hole cards, net - expandable to the board and a replay link; raw money moves on their own tab | **notpritam** |
| Wider screens everywhere: hands, ledger, leaderboard, and replay pages stop hugging a skinny center column | **notpritam** |
| Full-screen lobby and pages: lobby goes three-column (actions / game + rooms / friends), the ledger splits report-beside-table, hands and leaderboard become card grids on big monitors | **notpritam** |
| Best hand showcase: a player's biggest win as a snapshot on their profile - their cards, the board, the amount, one click to the replay - reachable from the leaderboard's "best +N"; the owner can hide it | **notpritam** |
| BB-style app shell: a persistent icon-led left sidebar - nav, your rooms as a thread list with active highlight, settings/theme/GitHub/account at the bottom - collapsible to an icon rail; mobile keeps the drawer | **notpritam** |
| Player-wise settle-up (primary): one combined line per person across every room, expandable to the per-room breakdown; the by-room view stays one toggle away | **notpritam** |
| Hands that tell the story: "won with a Flush" titles, and each history row expands to who you beat and what THEY held; win/lost/folded/showdown filters ride the URL on both the profile rail and the hands page | **notpritam** |
| Replay to GIF: one button renders the whole hand as an animated GIF (board, actions, reveals, winnings), downloads it, and opens a ready tweet - brag on Twitter in two clicks | **notpritam** |
| Everything before 2026-08-24 (mental poker core, ledger and banking, friends and spectating, cyberpunk theme, MCP seat, fairness tour, auto-approve buys, ...) | **notpritam** |
