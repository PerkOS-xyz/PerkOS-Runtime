#!/usr/bin/env python3
"""Floor voice bridge. Same script on macOS and Ubuntu.

Posts transcripts to the Floor UI. Mic is optional.
  python3 bridge.py wake the team
  python3 bridge.py --mic
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

FLOOR = os.environ.get("FLOOR_URL", "http://127.0.0.1:3000").rstrip("/")


def post(text: str) -> None:
    raw = text.strip()
    if not raw:
        return
    req = urllib.request.Request(
        f"{FLOOR}/api/command",
        data=json.dumps({"text": raw}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as res:
            print(res.read().decode(), flush=True)
    except urllib.error.URLError as exc:
        print(f"floor-unreachable {exc}", file=sys.stderr)
        sys.exit(1)


def mic_loop() -> None:
    try:
        import speech_recognition as sr  # type: ignore
    except ImportError:
        print("pip install SpeechRecognition pyaudio  (Ubuntu: portaudio19-dev)", file=sys.stderr)
        sys.exit(2)
    rec = sr.Recognizer()
    print("mic on. speak. ctrl-c to stop.", flush=True)
    while True:
        with sr.Microphone() as src:
            rec.adjust_for_ambient_noise(src, duration=0.4)
            print("listening", flush=True)
            try:
                audio = rec.listen(src, timeout=12, phrase_time_limit=10)
            except sr.WaitTimeoutError:
                continue
        try:
            text = rec.recognize_google(audio)
        except sr.UnknownValueError:
            print("unheard", flush=True)
            continue
        except sr.RequestError as exc:
            print(f"stt {exc}", file=sys.stderr)
            continue
        print(f"heard {text}", flush=True)
        post(text)


def main() -> None:
    args = sys.argv[1:]
    if args == ["--mic"]:
        mic_loop()
        return
    if args:
        post(" ".join(args))
        return
    print("type a command. ctrl-d to exit.", flush=True)
    for line in sys.stdin:
        post(line)


if __name__ == "__main__":
    main()
