"""静的検査（要件 8.1、8.2）。ソースの記述を読み、要件の値や設定が書かれているかを確認する。"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]


def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")


MAIN = read("electron/main.cjs")
PRELOAD = read("electron/preload.cjs")
CONFIG = read("electron/recording/config.cjs")
CONTROLS = read("src/components/Controls.jsx")
METER = read("src/components/Meter.jsx")
CSS = read("src/styles.css")
INDEX = read("index.html")
RECORDER = read("src/recorder/recorder.js")
UI_SOURCES = "\n".join(
    read(p) for p in [
        "src/App.jsx",
        "src/components/Controls.jsx",
        "src/components/MicSelect.jsx",
        "src/components/Meter.jsx",
        "src/components/StatusLine.jsx",
        "src/recorder/recorder.js",
        "src/recorder/errors.js",
    ]
)


# --- F-025 / 7.2 セキュリティ（ADR-0009）---

def test_webpreferences_are_locked_down():
    assert re.search(r"contextIsolation:\s*true", MAIN)
    assert re.search(r"nodeIntegration:\s*false", MAIN)
    assert re.search(r"sandbox:\s*true", MAIN)


def test_preload_exposes_only_the_recording_api():
    m = re.search(r"exposeInMainWorld\('recorder',\s*\{(.*?)\n\}\);", PRELOAD, re.S)
    assert m, "exposeInMainWorld('recorder', {...}) が見つからない"
    keys = set(re.findall(r"^\s{2}(\w+):", m.group(1), re.M))
    assert keys == {
        "startRecording", "stopRecording", "sendChunk", "sendSkip", "onSaved", "onProgress", "onNotice",
    }


def test_ipc_channels_are_recording_only():
    channels = set(re.findall(r"ipc(?:Main|Renderer)\.(?:handle|on|invoke|send|removeListener)\('([^']+)'", MAIN + PRELOAD))
    channels |= set(re.findall(r"subscribe\('([^']+)'", PRELOAD))
    assert channels, "チャンネルが見つからない"
    assert all(c.startswith("rec:") for c in channels), channels


def test_only_media_and_display_capture_permissions():
    m = re.search(r"ALLOWED_PERMISSIONS = new Set\(\[(.*?)\]\)", MAIN)
    assert m
    assert set(re.findall(r"'([^']+)'", m.group(1))) == {"media", "display-capture"}


def test_loads_only_local_bundle_and_blocks_navigation():
    assert "loadFile(" in MAIN and "dist" in MAIN
    assert "loadURL(" not in MAIN
    assert "will-navigate" in MAIN
    assert "setWindowOpenHandler" in MAIN


# --- F-014 / F-016 / F-026 / F-025 ---

def test_window_is_fixed_292x80():
    assert re.search(r"WINDOW:\s*\{\s*width:\s*292,\s*height:\s*80\s*\}", CONFIG)
    for flag in ["resizable: false", "maximizable: false", "fullscreenable: false", "useContentSize: true"]:
        assert flag in MAIN, flag
    assert "setContentProtection(true)" in MAIN  # F-025
    assert "title: 'Video Recoder'" in MAIN  # F-016


def test_primary_display_is_fixed_and_no_picker():
    assert "screen.getPrimaryDisplay()" in MAIN
    assert "useSystemPicker: false" in MAIN


def test_downloads_is_fixed_and_no_dialog():
    assert "app.getPath('downloads')" in MAIN
    assert "dialog" not in MAIN


def test_cursor_is_not_captured():
    assert "cursor: 'never'" in RECORDER  # F-023


def test_index_html_is_japanese_and_titled():
    assert '<html lang="ja">' in INDEX
    assert "<title>Video Recoder</title>" in INDEX


# --- F-011 / F-012 / 7.5 ---

def test_buttons_have_aria_label_and_title():
    buttons = re.findall(r"<button[\s\S]*?>", CONTROLS)
    assert len(buttons) == 4
    for b in buttons:
        assert "aria-label=" in b and "title=" in b, b


def test_no_state_labels_are_displayed():
    # 画面に出る文字列（JSX のテキスト、文字列リテラル）に状態名を使わない。コメントは対象外。
    for word in ["待機中", "録画中", "一時停止中"]:
        for pattern in [f"'{word}'", f'"{word}"', f">{word}<"]:
            assert pattern not in UI_SOURCES, pattern


def test_button_and_window_sizes_in_css():
    assert re.search(r"\.app\s*\{[^}]*width:\s*292px;[^}]*height:\s*80px;", CSS, re.S)
    assert re.search(r"\.btn\s*\{[^}]*width:\s*30px;[^}]*height:\s*20px;", CSS, re.S)


def test_meter_is_accessible():
    assert 'role="meter"' in METER
    for attr in ["aria-valuemin", "aria-valuemax", "aria-valuenow"]:
        assert attr in METER


def test_reduced_motion_disables_ticker():
    assert "prefers-reduced-motion: reduce" in CSS


# --- 録画の仕様の値（要件 F-021、F-022、F-027、F-028、F-033）---

def test_recording_constants_match_requirements():
    assert re.search(r"FPS_DEFAULT = 12\b", CONFIG)
    assert re.search(r"RECORDING_LIMIT_MS: 2 \* 60 \* 60 \* 1000", CONFIG)
    assert re.search(r"SEGMENT_US: 180 \* 1000 \* 1000", CONFIG)
    assert re.search(r"START_MIN_FREE_BYTES: 3 \* GB", CONFIG)
    assert re.search(r"RUN_EXTRA_FREE_BYTES: Math.round\(0.5 \* GB\)", CONFIG)
    assert re.search(r"MUX_EXTRA_FREE_BYTES: Math.round\(0.2 \* GB\)", CONFIG)
    assert "avc1.640028" in CONFIG
    assert "AUDIO_BITRATE: 128_000" in CONFIG
    assert "AUDIO_SAMPLE_RATE: 48000" in CONFIG


def test_microphone_processing_is_off():
    # 7.2 / 2.2: エコーキャンセル、ノイズ抑制、自動音量調整は行わない
    assert "echoCancellation: false" in RECORDER
    assert "noiseSuppression: false" in RECORDER
    assert "autoGainControl: false" in RECORDER


def test_no_reencoding_in_main_process():
    # 停止時の多重化は再符号化しない（F-029）
    for p in (ROOT / "electron").rglob("*.cjs"):
        assert "VideoEncoder" not in p.read_text(encoding="utf-8"), p
        assert "AudioEncoder" not in p.read_text(encoding="utf-8"), p
