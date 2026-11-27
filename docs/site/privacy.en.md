# Where your data goes

Kaitu has no server. With sync on, your notes are stored in the drive or repository you chose; when you use AI, your messages and the notes it reads go to the model provider. Below is when, where and what.

## Kept on this computer

- Your notes live in the folder you chose: goals, records, notes, memories, projects and originals, all as Markdown, JSON and JSONL that any editor can open.
- Program state stays on this computer only: version history, AI service keys and other credentials, the search index, your avatar and interface settings. They stay here even when sync is on.
- Kaitu has no server that receives your notes. The standalone app turns off built-in telemetry and session-log reporting; installed as a DeepSeek Harness plugin, DeepSeek Harness's own settings apply.

## Synced to your cloud drive or repository

- Only after you pick iCloud, Google Drive, Nutstore or a synced folder in Settings → Change where notes live.
- Every note file in the folder syncs, including health records, finance details and memories marked sensitive. Your cloud service stores and syncs them; Kaitu is not in between.
- GitHub backup: when on, the text and structured files you selected are pushed to your linked repository, health, finance and sensitive memories included, along with agent drop-offs, not-yet-imported health samples and unsorted notes in the inbox. Program state, hidden folders, credential files and media are not uploaded. Public repositories are not uploaded to by default.
- Version history, keys, credentials and the index still stay on this computer.

## Sent to an AI this time

- Ask: your messages, and the Kaitu notes it reads to answer, go to the AI service you chose in AI & connections. By default it can only read and write your notes folder, health records included, not keys, credentials or version history.
- First-time organization: saving the original does not call a model. When you organize it with a connected AI, the submitted text goes to that AI, and the organizing task can read more notes under that connection's permissions.
- Full agent: only for a conversation where you turn it on. It can run commands and read or write any file on this computer, and what it reads may go to the AI service.
- Morning plan, daily organizer and news search: when on, they run on schedule with Ask's AI, read the notes they need and send them to the same AI service.
- Web search: queries go to Ask's current AI service by default, or to Perplexity or Exa if you switch.
- Other AIs over MCP (Claude, Codex, ChatGPT, Grok and others) can read and write your notes; through Kaitu tools none can read memories marked sensitive, keys, credentials or version history. Finance access follows each connection's switch in AI & connections: local MCP, local Ask and phone Ask can read finance by default, remote MCP cannot. Health records have no switch; every connection can read them. What they read goes to the AI service behind them.
- These limits cover Kaitu tools only. A full agent, or Claude Code or Codex opened directly in the notes folder, can read files directly, sensitive memories included; the GitHub backup organizer can read everything in the backup repository.
- Cloud relay: a cloud AI that works through your drive (such as Grok over Google Drive) can read every note file on the drive, including health records, finance details and memories marked sensitive.
- Phone channels: messages you send on WeChat, Telegram, Feishu or QQ, and the replies, pass through those platforms; Ask's AI answers them.
- Context pack and clipboard: only the text you copy and paste leaves Kaitu. Packs leave out raw health records and memories marked sensitive; you choose each time whether to include a finance summary; recognizable keys and local paths are removed.

## Other connections

- Weather sends the selected city's coordinates to Open-Meteo; the city may come from your current city in Footprints.
- The global footprint map (Natural Earth) is bundled locally. Below zoom 5, no requests are sent to map providers. Zooming into regional detail downloads visible water and major-river tiles from OpenFreeMap (from zoom 5) and terrain tiles from AWS Terrain Tiles (from zoom 6). The servers receive the requested map area, your IP address, and ordinary network metadata. Requests do not include your experience text, profile, or account. City-level experience locations are not live location tracking. Offline, the global map remains available and city details show a connection notice.
- Reference prices come from Yahoo; only ticker symbols are sent, not your holdings.
- GitHub progress uses the token you add to read the repositories you linked.
- Calendar subscriptions are read from the addresses you add; confirmed blocks can be written to this computer's calendar.
- Mail, Slack and Feishu collection reads only the accounts you authorize, and excerpts go into your notes folder.
- iPhone health inbox: the Shortcut sends health samples to the Google Apps Script you deploy yourself, which writes them to your Google Drive.
- Update checks contact GitHub; browsing the plugin catalog contacts the Kaitu website.
- Learning pages can load scripts and fonts from public CDNs (cdnjs, jsDelivr, esm.sh, unpkg) and public font services.

## Any time you can

- Take every note file with Settings → Export everything.
- Move back to this computer and stop syncing in Settings → Change where notes live.
- Change or disconnect the AI service in AI & connections.
