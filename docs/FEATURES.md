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
| Everything before 2026-08-24 (mental poker core, ledger and banking, friends and spectating, cyberpunk theme, MCP seat, fairness tour, auto-approve buys, ...) | **notpritam** |
