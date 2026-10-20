# Where your data goes

Kaitu describes three places your notes can go: kept on this computer, synced to your cloud drive, or sent to an AI this time. Below is when, where and what.

## Kept on this computer

- Your notes live in the folder you chose: goals, records, notes, memories, projects and originals, all as Markdown, JSON and JSONL that any editor can open.
- Program state stays on this computer only: version history, AI service keys and other credentials, the search index, your avatar and interface settings. They stay here even when sync is on.

## Synced to your cloud drive

- Only after you pick iCloud, Google Drive, Nutstore or a synced folder in Settings → Change where notes live.
- Every note file in the folder syncs, finance details included. Your cloud service stores and syncs them; Kaitu is not in between.
- Version history, keys, credentials and the index still stay on this computer.

## Sent to an AI this time

- Ask: your messages, and the Kaitu notes it reads to answer, go to the AI service you chose in AI & connections. By default it can only read and write your notes folder, not keys, credentials or version history.
- Full agent: only for a conversation where you turn it on. It can run commands and read or write any file on this computer, and what it reads may go to the AI service.
- Morning plan, daily organizer and news search: when on, they run on schedule with Ask's AI, read the notes they need and send them to the same AI service.
- Web search: queries go to Ask's current AI service by default, or to Perplexity, Exa or Tavily if you switch.
- Other AIs over MCP (Claude, Codex, ChatGPT, Grok and others) can read and write your notes; ones connected over the internet can't read finance details or memories marked sensitive, and none can read keys, credentials or version history. What they read goes to the AI service behind them.
- Cloud relay: a cloud AI that works through your drive (such as Grok over Google Drive) can read every note file on the drive, finance details included.
- Phone channels: messages you send on WeChat, Telegram, Feishu or QQ, and the replies, pass through those platforms; Ask's AI answers them.
- Context pack and clipboard: only the text you copy and paste leaves Kaitu. Packs leave out health records, finance details and memories marked sensitive, and recognizable keys and local paths are removed.

## Other connections

- The global footprint map (Natural Earth) is bundled locally. Below zoom 5, no requests are sent to map providers. Zooming into regional detail downloads visible water and major-river tiles from OpenFreeMap (from zoom 5) and terrain tiles from AWS Terrain Tiles (from zoom 6). The servers receive the requested map area, your IP address, and ordinary network metadata. Requests do not include your experience text, profile, or account. City-level experience locations are not live location tracking. Offline, the global map remains available and city details show a connection notice.
- Reference prices come from Yahoo; only ticker symbols are sent, not your holdings.
- GitHub progress uses the token you add to read the repositories you linked.
- Calendar subscriptions are read from the addresses you add; confirmed blocks can be written to this computer's calendar.
- Mail, Slack and Feishu collection reads only the accounts you authorize, and excerpts go into your notes folder.

## Any time you can

- Take every note file with Settings → Export everything.
- Move back to this computer and stop syncing in Settings → Change where notes live.
- Change or disconnect the AI service in AI & connections.
