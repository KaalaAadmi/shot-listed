# ShotListed pipeline host

Claims jobs from the web app and runs them: ffmpeg, perceptual hashes, tagging, embeddings. It never connects to Atlas; it talks to ShotListed's `/api/host/*` routes and to the storage service.

Jobs it can run today: `index-asset` (thumbnail, proxy, tags, embedding, hashes), `ingest-inspiration` (yt-dlp download of a shared reel) and `analyse-inspiration` (Gemini watches it), `check-take` (technical checks, then Gemini compares a take with its Film it card) and `clip-pack` (trimmed, numbered clips in one zip). Later phases add theirs in `pipeline/main.py`.

## Set up (Oracle Always Free Arm VM, Ubuntu)

```bash
sudo apt install -y ffmpeg libimage-exiftool-perl git
curl -LsSf https://astral.sh/uv/install.sh | sh
git clone <this repo> ~/shot-listed && cd ~/shot-listed/pipeline && uv sync
```

Create the host's own storage key in the **bucket-list** repo (not the Vercel one):

```bash
ADMIN_TOKEN=... npm run create-key -- --url https://<storage>.vercel.app --app shot-listed --name pipeline-host --scopes read,write,delete
```

Put `HOST_TOKEN` (`openssl rand -hex 32`) in Vercel and in `~/shot-listed/pipeline/.env`:

```
REEL_STUDIO_URL=https://<shot-listed>.vercel.app
HOST_TOKEN=
STORAGE_API_URL=https://<storage>.vercel.app
STORAGE_API_KEY=rsk_...
GEMINI_API_KEY=
VISION_MODEL=gemini-flash-lite-latest
GEMINI_MODEL=gemini-flash-latest
IG_COOKIES_FILE=/home/ubuntu/ig-cookies.txt
```

`IG_COOKIES_FILE` is the burner Instagram account's cookies in Netscape format. Log in to the burner in a browser, export with a "cookies.txt" extension, and copy the file to the host (`chmod 600`). Never use your main account. Instagram often challenges data-centre IPs; if downloads fail, the Inbox offers **Upload the video instead**, or run the host from a home machine.

`/etc/systemd/system/shot-listed-pipeline.service`:

```ini
[Unit]
Description=ShotListed pipeline host
After=network-online.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/shot-listed/pipeline
EnvironmentFile=/home/ubuntu/shot-listed/pipeline/.env
ExecStart=/home/ubuntu/.local/bin/uv run python -m pipeline.main
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now shot-listed-pipeline && journalctl -u shot-listed-pipeline -f
```

To try it on your Mac first: `set -a; source .env; set +a; uv run python -m pipeline.main`.

## Tests

`uv run pytest` runs the real ffmpeg and Pillow code on generated files; only the network is faked. One test checks that this host renders the same `library-tagger` prompt as the web bundle.
