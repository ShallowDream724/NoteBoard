"""Launch an isolated Windows release build without first-run font downloads.

Run as a background job, then read .tmp/native-qa/<name>.json for its CDP port.
The normal application settings path is untouched. No UI automation is needed
to dismiss setup prompts, and no production-only testing switches are added.
"""
import argparse
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import tempfile

import psutil


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--name', default='acceptance')
    parser.add_argument('--exe', type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r'[a-z0-9-]{1,64}', args.name):
        parser.error('--name must be 1–64 lowercase letters, digits or hyphens')
    root = Path(__file__).resolve().parent.parent
    exe = (args.exe or root / 'src-tauri/target/release/noteboard.exe').resolve(strict=True)
    if any((p.info['name'] or '').lower() == 'noteboard.exe' for p in psutil.process_iter(['name'])):
        raise RuntimeError('Close the existing NoteBoard window before isolated native QA')
    records = root / '.tmp/native-qa'
    records.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix=f'{args.name}-', dir=records))
    settings_dir = profile / 'appdata/NoteBoard'
    settings_dir.mkdir(parents=True)
    # CSS generic families are valid on every test host and never refer to the
    # optional font pack. Explicit provenance also prevents later auto adoption.
    settings = {'schemaVersion': 1, 'typography': {
        'monoFontFamily': 'monospace', 'monoFontFamilyZh': 'sans-serif',
        'monoFontFamilySource': 'user', 'monoFontFamilyZhSource': 'user',
    }}
    (settings_dir / 'settings.json').write_text(json.dumps(settings, indent=2) + '\n', encoding='utf-8')
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    env = os.environ.copy()
    env.update(APPDATA=str(profile / 'appdata'), LOCALAPPDATA=str(profile / 'local'),
               WEBVIEW2_USER_DATA_FOLDER=str(profile / 'webview'),
               WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=f'--remote-debugging-port={port}')
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = 0
    with (profile / 'native.log').open('wb') as log:
        process = subprocess.Popen([str(exe)], cwd=root, env=env, startupinfo=startup,
                                   stdin=subprocess.DEVNULL, stdout=log, stderr=log)
    record = {'pid': process.pid, 'port': port, 'exe': str(exe), 'profile': str(profile),
              'createdAt': psutil.Process(process.pid).create_time(), 'systemFontsPreconfigured': True}
    (records / f'{args.name}.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(record), flush=True)
    print('Native QA exited:', process.wait(), flush=True)


if __name__ == '__main__':
    main()
