import json
import os
import sys
import io
import ast
import tempfile
import unittest
import zipfile
import contextlib
import threading
from pathlib import Path
from unittest import mock

import requests
from PIL import Image


PYTHON_DIR = Path(__file__).resolve().parents[1] / "python"
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

import process_snapchat_memories as psm


class FakeResponse:
    def __init__(self, *, status_code=200, chunks=None, headers=None, url=None, history=None):
        self.status_code = status_code
        self._chunks = list(chunks or [])
        self.headers = headers or {}
        self.url = url or "https://cf-st.sc-cdn.net/media"
        self.history = history or []
        self.chunk_size = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def iter_content(self, chunk_size=8192):
        self.chunk_size = chunk_size
        for chunk in self._chunks:
            yield chunk

    def raise_for_status(self):
        if self.status_code >= 400:
            error = requests.exceptions.HTTPError(f"HTTP {self.status_code}")
            error.response = self
            raise error


class FakeSession:
    def __init__(self, responses):
        if isinstance(responses, (list, tuple)):
            self.responses = list(responses)
        else:
            self.responses = [responses]
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append({"url": url, **kwargs})
        if not self.responses:
            raise AssertionError(f"Unexpected GET call to {url}")
        return self.responses.pop(0)

    def head(self, url, **kwargs):
        self.calls.append({"method": "HEAD", "url": url, **kwargs})
        if not self.responses:
            raise AssertionError(f"Unexpected HEAD call to {url}")
        return self.responses.pop(0)


class ProcessSnapchatMemoriesRuntimeTests(unittest.TestCase):
    def tearDown(self):
        psm.reset_runtime_disk_full_state()
        psm.ABORT_PROCESSING.clear()

    def _image_bytes(self, color, image_format="PNG", size=(8, 8)):
        buf = io.BytesIO()
        Image.new("RGBA", size, color).save(buf, format=image_format)
        return buf.getvalue()

    def _webp_image_bytes(self, color, size=(8, 8)):
        buf = io.BytesIO()
        Image.new("RGBA", size, color).save(buf, format="WEBP")
        return buf.getvalue()

    def test_reload_manifest_processed_count_updates_final_auto_upload_success_total(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            processing_root = Path(temp_dir)
            output_dir = processing_root / "Processed_Memories_2026-03-18"
            output_dir.mkdir()
            (processing_root / ".batch_progress.json").write_text(
                json.dumps({"processed_count": 7}),
                encoding="utf-8",
            )

            with mock.patch.object(psm, "OUTPUT_DIR", str(output_dir)):
                refreshed_count = psm.reload_manifest_processed_count(3)
                success_count = psm.resolve_final_auto_upload_success_count(refreshed_count, total_files_organized=5)

            self.assertEqual(refreshed_count, 7)
            self.assertEqual(success_count, 7)

    def test_resolve_files_in_batch_for_accounting_counts_only_new_writes(self):
        existing_total_before_resume = 723
        files_in_batch = psm.resolve_files_in_batch_for_accounting(477)

        self.assertEqual(files_in_batch, 477)
        self.assertEqual(existing_total_before_resume + files_in_batch, 1200)

    def test_folder_destination_adapter_preserves_batch_relative_path_from_staging(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            staging_dir = Path(temp_dir) / "staging"
            destination_dir = Path(temp_dir) / "destination"
            staged_file = staging_dir / "Batch_02" / "example.jpg"
            staged_file.parent.mkdir(parents=True)
            staged_file.write_bytes(b"abc123")

            adapter = psm.FolderDestinationAdapter(
                str(destination_dir),
                upload_mode="copy",
                staging_dir=str(staging_dir),
            )
            adapter.prepare()

            dest_path = Path(adapter.put(str(staged_file)))

            self.assertEqual(dest_path, destination_dir / "Batch_02" / "example.jpg")
            self.assertEqual(dest_path.read_bytes(), b"abc123")
            self.assertTrue(adapter.verify(str(staged_file), str(dest_path)))

    def test_resolve_retry_display_name_falls_back_when_report_file_is_none(self):
        display_name = psm.resolve_retry_display_name(
            {
                "file": None,
                "date": "2021-05-28 20:50:07 UTC",
            },
            fallback_index=0,
        )

        self.assertEqual(display_name, "2021-05-28 20:50:07 UTC")

    def test_resolve_total_accounted_for_verification_adds_prior_logical_progress(self):
        total_accounted = psm.resolve_total_accounted_for_verification(
            logical_processed_before_run=3306,
            current_results_count=605,
        )

        self.assertEqual(total_accounted, 3911)

    def test_emit_runtime_disk_full_emits_structured_event_once(self):
        events = []

        with tempfile.TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "Processed_Memories_2026-03-19"
            output_dir.mkdir()
            target_path = output_dir / "Batch_01" / "example.jpg"

            with mock.patch.object(psm, "OUTPUT_DIR", str(output_dir)):
                first = psm.emit_runtime_disk_full(
                    events.append,
                    path_value=str(target_path),
                    error=OSError(psm.errno.ENOSPC, "No space left on device"),
                )
                second = psm.emit_runtime_disk_full(
                    events.append,
                    path_value=str(target_path),
                    error=OSError(psm.errno.ENOSPC, "No space left on device"),
                )

        self.assertEqual(len(events), 1)
        self.assertEqual(first["type"], "disk_full")
        self.assertEqual(first["scope"], "output")
        self.assertEqual(first["path"], str(target_path))
        self.assertEqual(second, first)
        self.assertTrue(psm.ABORT_PROCESSING.is_set())

    def test_emit_runtime_disk_full_classifies_staging_scope(self):
        events = []

        with tempfile.TemporaryDirectory() as temp_dir:
            staging_dir = Path(temp_dir) / ".staging"
            staging_dir.mkdir()
            target_path = staging_dir / "Batch_01" / "example.jpg"

            with mock.patch.object(psm, "AUTO_STAGING_DIR", str(staging_dir)):
                payload = psm.emit_runtime_disk_full(
                    events.append,
                    path_value=str(target_path),
                    message="DateBack stopped because the local staging drive ran out of space.",
                    error=OSError(psm.errno.ENOSPC, "No space left on device"),
                )

        self.assertEqual(payload["scope"], "staging")
        self.assertEqual(events[0]["scope"], "staging")

    def test_resolve_auto_upload_retry_batch_dir_continues_after_delivered_batches(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            staging_dir = Path(temp_dir) / "staging"
            destination_dir = Path(temp_dir) / "destination"
            staging_dir.mkdir()
            (destination_dir / "Batch_08").mkdir(parents=True)
            for idx in range(500):
                (destination_dir / "Batch_08" / f"file_{idx}.jpg").write_text("x")

            ledger = psm.UploadLedger(str(Path(temp_dir) / ".upload_ledger.jsonl"))

            output_dir = Path(
                psm.resolve_auto_upload_retry_batch_dir(
                    str(staging_dir),
                    str(destination_dir),
                    ledger,
                    batch_size=500,
                )
            )

            self.assertEqual(output_dir, staging_dir / "Batch_09")

    def test_resolve_auto_upload_retry_batch_dir_reuses_incomplete_destination_batch(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            staging_dir = Path(temp_dir) / "staging"
            destination_dir = Path(temp_dir) / "destination"
            staging_dir.mkdir()
            (destination_dir / "Batch_08").mkdir(parents=True)
            for idx in range(411):
                (destination_dir / "Batch_08" / f"file_{idx}.jpg").write_text("x")

            ledger = psm.UploadLedger(str(Path(temp_dir) / ".upload_ledger.jsonl"))

            output_dir = Path(
                psm.resolve_auto_upload_retry_batch_dir(
                    str(staging_dir),
                    str(destination_dir),
                    ledger,
                    batch_size=500,
                )
            )

            self.assertEqual(output_dir, staging_dir / "Batch_08")

    def test_is_allowed_download_url_rejects_sibling_domains(self):
        self.assertFalse(psm.is_allowed_download_url("https://evil-snapchat.com/media.jpg"))
        self.assertFalse(psm.is_allowed_download_url("https://evilsc-cdn.net/media.jpg"))
        self.assertFalse(psm.is_allowed_download_url("https://snapchat.com.evil.example/media.jpg"))

    def test_is_allowed_download_url_accepts_exact_or_subdomain_matches(self):
        self.assertTrue(psm.is_allowed_download_url("https://sc-cdn.net/media.jpg"))
        self.assertTrue(psm.is_allowed_download_url("https://cf-st.sc-cdn.net/media.jpg"))
        self.assertTrue(psm.is_allowed_download_url("https://snapchat.com/media.jpg"))
        self.assertTrue(psm.is_allowed_download_url("https://accounts.snapchat.com/media.jpg"))

    def test_stream_download_to_path_streams_bytes_without_automatic_redirects(self):
        response = FakeResponse(
            chunks=[b"abc", b"def"],
            headers={"Content-Type": "image/jpeg"},
        )
        session = FakeSession(response)

        with tempfile.TemporaryDirectory() as temp_dir:
            target_path = Path(temp_dir) / "download.bin"
            with mock.patch.object(psm, "get_requests_session", return_value=session):
                written = psm.stream_download_to_path("https://cf-st.sc-cdn.net/media", str(target_path))

            self.assertEqual(written, 6)
            self.assertEqual(target_path.read_bytes(), b"abcdef")
            self.assertEqual(len(session.calls), 1)
            self.assertEqual(session.calls[0]["url"], "https://cf-st.sc-cdn.net/media")
            self.assertTrue(session.calls[0]["stream"])
            self.assertFalse(session.calls[0]["allow_redirects"])
            self.assertEqual(response.chunk_size, psm.DOWNLOAD_CHUNK_BYTES)

    def test_stream_download_to_path_rejects_truncated_content_length(self):
        response = FakeResponse(
            chunks=[b"abc"],
            headers={"Content-Type": "image/jpeg", "Content-Length": "6"},
        )
        session = FakeSession(response)

        with tempfile.TemporaryDirectory() as temp_dir:
            target_path = Path(temp_dir) / "download.bin"
            with mock.patch.object(psm, "get_requests_session", return_value=session):
                with self.assertRaisesRegex(ValueError, "Truncated download"):
                    psm.stream_download_to_path("https://cf-st.sc-cdn.net/media", str(target_path))

    def test_get_remote_file_size_honors_retry_after_header(self):
        throttled = FakeResponse(status_code=429, headers={"Retry-After": "3"})
        final = FakeResponse(status_code=200, headers={"Content-Length": "123"})
        session = FakeSession([throttled, final])

        with mock.patch.object(psm, "get_requests_session", return_value=session), \
             mock.patch.object(psm.time, "sleep") as sleep_mock:
            size = psm.get_remote_file_size("https://cf-st.sc-cdn.net/media", retries=2)

        self.assertEqual(size, 123)
        sleep_mock.assert_called_once_with(3)
        self.assertEqual(len(session.calls), 2)

    def test_process_module_has_no_bare_except_handlers(self):
        tree = ast.parse(Path(psm.__file__).read_text(encoding="utf-8"))
        bare_handlers = [
            node.lineno
            for node in ast.walk(tree)
            if isinstance(node, ast.ExceptHandler) and node.type is None
        ]

        self.assertEqual(bare_handlers, [])

    def test_stream_download_to_path_follows_allowed_redirect_manually(self):
        redirect_response = FakeResponse(
            status_code=302,
            headers={"Location": "https://cf-st.sc-cdn.net/final.jpg"},
            url="https://snapchat.com/start",
        )
        final_response = FakeResponse(
            chunks=[b"abc"],
            headers={"Content-Type": "image/jpeg"},
            url="https://cf-st.sc-cdn.net/final.jpg",
        )
        session = FakeSession([redirect_response, final_response])

        with tempfile.TemporaryDirectory() as temp_dir:
            target_path = Path(temp_dir) / "download.bin"
            with mock.patch.object(psm, "get_requests_session", return_value=session):
                written = psm.stream_download_to_path("https://snapchat.com/start", str(target_path))

            self.assertEqual(written, 3)
            self.assertEqual(target_path.read_bytes(), b"abc")
            self.assertEqual([call["url"] for call in session.calls], [
                "https://snapchat.com/start",
                "https://cf-st.sc-cdn.net/final.jpg",
            ])
            self.assertTrue(all(call["allow_redirects"] is False for call in session.calls))

    def test_stream_download_to_path_rejects_blocked_redirect_before_following(self):
        redirect_response = FakeResponse(
            status_code=302,
            headers={"Location": "https://evil.example/final.jpg"},
            url="https://snapchat.com/start",
        )
        session = FakeSession([redirect_response])

        with tempfile.TemporaryDirectory() as temp_dir:
            target_path = Path(temp_dir) / "download.bin"
            with mock.patch.object(psm, "get_requests_session", return_value=session):
                with self.assertRaisesRegex(ValueError, "Blocked redirect target"):
                    psm.stream_download_to_path("https://snapchat.com/start", str(target_path))

            self.assertEqual(len(session.calls), 1)
            self.assertEqual(session.calls[0]["url"], "https://snapchat.com/start")

    def test_stream_download_to_path_rejects_oversized_downloads(self):
        response = FakeResponse(
            chunks=[b"1234", b"56"],
            headers={"Content-Type": "image/jpeg"},
        )
        session = FakeSession(response)

        with tempfile.TemporaryDirectory() as temp_dir:
            target_path = Path(temp_dir) / "download.bin"
            with mock.patch.object(psm, "get_requests_session", return_value=session), \
                 mock.patch.object(psm, "MAX_DOWNLOAD_BYTES", 5):
                with self.assertRaisesRegex(ValueError, "Download exceeded max size limit"):
                    psm.stream_download_to_path("https://cf-st.sc-cdn.net/media", str(target_path))

    def test_stream_download_to_path_rejects_empty_downloads(self):
        response = FakeResponse(
            chunks=[],
            headers={"Content-Type": "image/jpeg"},
        )
        session = FakeSession(response)

        with tempfile.TemporaryDirectory() as temp_dir:
            target_path = Path(temp_dir) / "download.bin"
            with mock.patch.object(psm, "get_requests_session", return_value=session):
                with self.assertRaisesRegex(ValueError, "Downloaded file is empty"):
                    psm.stream_download_to_path("https://cf-st.sc-cdn.net/media", str(target_path))

    def test_stream_download_to_path_rejects_html_responses(self):
        response = FakeResponse(
            chunks=[b"<html></html>"],
            headers={"Content-Type": "text/html; charset=utf-8"},
        )
        session = FakeSession(response)

        with tempfile.TemporaryDirectory() as temp_dir:
            target_path = Path(temp_dir) / "download.bin"
            with mock.patch.object(psm, "get_requests_session", return_value=session):
                with self.assertRaisesRegex(ValueError, "Unexpected content type"):
                    psm.stream_download_to_path("https://cf-st.sc-cdn.net/media", str(target_path))

    def test_select_memories_history_json_rejects_duplicate_json_members(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            zip_path = Path(temp_dir) / "mydata~123.zip"
            with zipfile.ZipFile(zip_path, "w") as zf:
                zf.writestr("mydata~123/json/memories_history.json", '{"Saved Media": []}')
                zf.writestr("other/json/memories_history.json", '{"Saved Media": []}')

            with zipfile.ZipFile(zip_path, "r") as zf:
                with self.assertRaisesRegex(ValueError, "multiple memories_history.json"):
                    psm.select_memories_history_json_member(zf)

    def test_read_memories_history_json_rejects_oversized_json_member(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            zip_path = Path(temp_dir) / "mydata~123.zip"
            with zipfile.ZipFile(zip_path, "w") as zf:
                zf.writestr("mydata~123/json/memories_history.json", '{"Saved Media": []}')

            with zipfile.ZipFile(zip_path, "r") as zf:
                with mock.patch.object(psm, "MAX_JSON_BYTES", 4):
                    with self.assertRaisesRegex(ValueError, "memories_history.json is too large"):
                        psm.read_memories_history_json(zf, "mydata~123/json/memories_history.json")

    def test_nested_overlay_role_matching_avoids_loose_main_substrings(self):
        self.assertEqual(psm.parse_nested_overlay_role("main.jpg"), "main")
        self.assertEqual(psm.parse_nested_overlay_role("snap-main.mp4"), "main")
        self.assertEqual(psm.parse_nested_overlay_role("snap_overlay.png"), "overlay")
        self.assertIsNone(psm.parse_nested_overlay_role("domain_screenshot.jpg"))
        self.assertIsNone(psm.parse_nested_overlay_role("remaining_photo.jpg"))

    def test_process_from_zip_ignores_mismatched_manifest_in_verify_mode(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output_root = Path(temp_dir) / "output"
            output_root.mkdir()
            zip_path = Path(temp_dir) / "mydata~1700000000000.zip"
            image_id = "11111111-1111-4111-8111-111111111111"
            memories = [
                {
                    "Date": "2024-01-02 03:04:05 UTC",
                    "Media Type": "Image",
                    "Download Link": "",
                    "Media Download Url": "",
                }
            ]
            with zipfile.ZipFile(zip_path, "w") as zf:
                zf.writestr("json/memories_history.json", json.dumps({"Saved Media": memories}))
                image_info = zipfile.ZipInfo(f"memories/2024-01-02_{image_id}-main.jpg")
                image_info.date_time = (2024, 1, 2, 3, 4, 4)
                zf.writestr(image_info, b"image-bytes")

            (output_root / ".batch_progress.json").write_text(json.dumps({
                "last_completed_batch": 1,
                "total_batches": 1,
                "processed_indices": [0],
                "processed_count": 1,
                "zip_fingerprint": "old-export-fingerprint"
            }), encoding="utf-8")

            stats = psm.process_from_zip(str(zip_path), output_root=str(output_root), trust_manifest=False)

            self.assertEqual(stats["success"], 1)
            self.assertEqual(stats["skipped"], 0)
            self.assertEqual(stats["actual_files_on_disk"], 1)

    def test_process_from_zip_rejects_mismatched_manifest_in_trust_mode(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output_root = Path(temp_dir) / "output"
            output_root.mkdir()
            zip_path = Path(temp_dir) / "mydata~1700000000000.zip"
            with zipfile.ZipFile(zip_path, "w") as zf:
                zf.writestr("json/memories_history.json", json.dumps({"Saved Media": []}))

            (output_root / ".batch_progress.json").write_text(json.dumps({
                "last_completed_batch": 1,
                "total_batches": 1,
                "processed_indices": [0],
                "processed_count": 1,
                "zip_fingerprint": "old-export-fingerprint"
            }), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "ZIP export does not match previous run"):
                psm.process_from_zip(str(zip_path), output_root=str(output_root), trust_manifest=True)

    def test_process_from_zip_uses_local_memory_files_when_download_urls_are_blank(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output_root = Path(temp_dir) / "output"
            output_root.mkdir()
            zip_path = Path(temp_dir) / "mydata~1700000000000.zip"
            image_id = "11111111-1111-4111-8111-111111111111"
            video_id = "22222222-2222-4222-8222-222222222222"
            memories = [
                {
                    "Date": "2024-01-02 03:04:05 UTC",
                    "Media Type": "Image",
                    "Download Link": "",
                    "Media Download Url": "",
                },
                {
                    "Date": "2024-01-02 03:05:07 UTC",
                    "Media Type": "Video",
                    "Download Link": "",
                    "Media Download Url": "",
                },
            ]

            with zipfile.ZipFile(zip_path, "w") as zf:
                zf.writestr("json/memories_history.json", json.dumps({"Saved Media": memories}))

                image_info = zipfile.ZipInfo(f"memories/2024-01-02_{image_id}-main.jpg")
                image_info.date_time = (2024, 1, 2, 3, 4, 4)
                zf.writestr(image_info, b"image-bytes")

                video_info = zipfile.ZipInfo(f"memories/2024-01-02_{video_id}-main.mp4")
                video_info.date_time = (2024, 1, 2, 3, 5, 6)
                zf.writestr(video_info, b"video-bytes")

            stats = psm.process_from_zip(str(zip_path), output_root=str(output_root))

            self.assertEqual(stats["success"], 2)
            self.assertEqual(stats["missing"], 0)
            self.assertEqual(stats["skipped"], 0)

            processed_files = sorted(
                p.name
                for p in Path(stats["processed_dir"]).glob("Batch_*/*")
                if p.is_file()
            )
            self.assertEqual(
                processed_files,
                [
                    "2024-01-02_03-04-05.jpg",
                    "2024-01-02_03-05-07.mp4",
                ],
            )
            self.assertEqual(
                (Path(stats["processed_dir"]) / "Batch_01" / "2024-01-02_03-04-05.jpg").read_bytes(),
                b"image-bytes",
            )
            self.assertEqual(
                (Path(stats["processed_dir"]) / "Batch_01" / "2024-01-02_03-05-07.mp4").read_bytes(),
                b"video-bytes",
            )

    def test_process_from_zip_merges_top_level_image_overlay_sibling(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output_root = Path(temp_dir) / "output"
            output_root.mkdir()
            zip_path = Path(temp_dir) / "mydata~1700000000000.zip"
            image_id = "11111111-1111-4111-8111-111111111111"
            memories = [
                {
                    "Date": "2024-01-02 03:04:05 UTC",
                    "Media Type": "Image",
                    "Download Link": "",
                    "Media Download Url": "",
                }
            ]

            with zipfile.ZipFile(zip_path, "w") as zf:
                zf.writestr("json/memories_history.json", json.dumps({"Saved Media": memories}))
                main_info = zipfile.ZipInfo(f"memories/2024-01-02_{image_id}-main.jpg")
                main_info.date_time = (2024, 1, 2, 3, 4, 4)
                zf.writestr(main_info, self._image_bytes((255, 0, 0, 255)))
                overlay_info = zipfile.ZipInfo(f"memories/2024-01-02_{image_id}-overlay.jpg")
                overlay_info.date_time = (2024, 1, 2, 3, 4, 4)
                zf.writestr(overlay_info, self._image_bytes((0, 0, 255, 128)))

            stats = psm.process_from_zip(str(zip_path), output_root=str(output_root))

            self.assertEqual(stats["success"], 1)
            output_file = Path(stats["processed_dir"]) / "Batch_01" / "2024-01-02_03-04-05.jpg"
            with Image.open(output_file) as img:
                pixel = img.convert("RGB").getpixel((0, 0))
            self.assertNotEqual(pixel, (255, 0, 0))
            self.assertGreater(pixel[2], 50)

            report = json.loads((output_root / "detailed_report.json").read_text(encoding="utf-8"))
            self.assertIn("Overlay Merge", report[0]["reason"])

    def test_process_from_zip_overlays_static_image_onto_top_level_video_sibling(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output_root = Path(temp_dir) / "output"
            output_root.mkdir()
            zip_path = Path(temp_dir) / "mydata~1700000000000.zip"
            video_id = "22222222-2222-4222-8222-222222222222"
            memories = [
                {
                    "Date": "2024-01-02 03:05:07 UTC",
                    "Media Type": "Video",
                    "Download Link": "",
                    "Media Download Url": "",
                }
            ]

            with zipfile.ZipFile(zip_path, "w") as zf:
                zf.writestr("json/memories_history.json", json.dumps({"Saved Media": memories}))
                video_info = zipfile.ZipInfo(f"memories/2024-01-02_{video_id}-main.mp4")
                video_info.date_time = (2024, 1, 2, 3, 5, 6)
                zf.writestr(video_info, b"fake-video")
                overlay_info = zipfile.ZipInfo(f"memories/2024-01-02_{video_id}-overlay.jpg")
                overlay_info.date_time = (2024, 1, 2, 3, 5, 6)
                zf.writestr(overlay_info, self._image_bytes((0, 0, 255, 128)))

            ffmpeg_calls = []

            def fake_ffmpeg(cmd, check, stdout, stderr, timeout=None):
                ffmpeg_calls.append(cmd)
                self.assertEqual(timeout, psm.FFMPEG_TIMEOUT_SECONDS)
                Path(cmd[-1]).write_bytes(b"merged-video")
                return mock.Mock(returncode=0)

            with mock.patch.object(psm.subprocess, "run", side_effect=fake_ffmpeg):
                stats = psm.process_from_zip(str(zip_path), output_root=str(output_root))

            self.assertEqual(stats["success"], 1)
            self.assertEqual(len(ffmpeg_calls), 1)
            self.assertIn("-loop", ffmpeg_calls[0])
            self.assertTrue(ffmpeg_calls[0][-1].endswith(".mp4"))
            self.assertTrue(
                any(
                    isinstance(arg, str) and "overlay=0:0" in arg
                    for arg in ffmpeg_calls[0]
                )
            )
            output_file = Path(stats["processed_dir"]) / "Batch_01" / "2024-01-02_03-05-07.mp4"
            self.assertEqual(output_file.read_bytes(), b"merged-video")

            report = json.loads((output_root / "detailed_report.json").read_text(encoding="utf-8"))
            self.assertIn("Overlay Merge", report[0]["reason"])

    def test_process_from_zip_normalizes_mislabeled_webp_video_overlay_for_ffmpeg(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output_root = Path(temp_dir) / "output"
            output_root.mkdir()
            zip_path = Path(temp_dir) / "mydata~1700000000000.zip"
            video_id = "22222222-2222-4222-8222-222222222222"
            memories = [
                {
                    "Date": "2024-01-02 03:05:07 UTC",
                    "Media Type": "Video",
                    "Download Link": "",
                    "Media Download Url": "",
                }
            ]

            with zipfile.ZipFile(zip_path, "w") as zf:
                zf.writestr("json/memories_history.json", json.dumps({"Saved Media": memories}))
                video_info = zipfile.ZipInfo(f"memories/2024-01-02_{video_id}-main.mp4")
                video_info.date_time = (2024, 1, 2, 3, 5, 6)
                zf.writestr(video_info, b"fake-video")
                overlay_info = zipfile.ZipInfo(f"memories/2024-01-02_{video_id}-overlay.png")
                overlay_info.date_time = (2024, 1, 2, 3, 5, 6)
                zf.writestr(overlay_info, self._webp_image_bytes((0, 0, 255, 128)))

            def fake_ffmpeg(cmd, check, stdout, stderr, timeout=None):
                self.assertEqual(timeout, psm.FFMPEG_TIMEOUT_SECONDS)
                overlay_path = cmd[cmd.index("-i", cmd.index("-loop")) + 1]
                self.assertEqual(Path(overlay_path).read_bytes()[:8], b"\x89PNG\r\n\x1a\n")
                Path(cmd[-1]).write_bytes(b"merged-video")
                return mock.Mock(returncode=0)

            with mock.patch.object(psm.subprocess, "run", side_effect=fake_ffmpeg):
                stats = psm.process_from_zip(str(zip_path), output_root=str(output_root))

            self.assertEqual(stats["success"], 1)
            output_file = Path(stats["processed_dir"]) / "Batch_01" / "2024-01-02_03-05-07.mp4"
            self.assertEqual(output_file.read_bytes(), b"merged-video")

    def test_process_from_zip_keeps_output_names_unique_across_batches(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output_root = Path(temp_dir) / "output"
            output_root.mkdir()
            zip_path = Path(temp_dir) / "mydata~1700000000000.zip"
            first_id = "11111111-1111-4111-8111-111111111111"
            second_id = "22222222-2222-4222-8222-222222222222"
            duplicate_memory = {
                "Date": "2024-01-02 03:04:05 UTC",
                "Media Type": "Image",
                "Download Link": "",
                "Media Download Url": "",
            }
            missing_memory = {
                "Date": "2024-01-03 03:04:05 UTC",
                "Media Type": "Image",
                "Download Link": "",
                "Media Download Url": "",
            }
            memories = [duplicate_memory] + [missing_memory.copy() for _ in range(499)] + [duplicate_memory.copy()]

            with zipfile.ZipFile(zip_path, "w") as zf:
                zf.writestr("json/memories_history.json", json.dumps({"Saved Media": memories}))
                first_info = zipfile.ZipInfo(f"memories/2024-01-02_{first_id}-main.jpg")
                first_info.date_time = (2024, 1, 2, 3, 4, 4)
                zf.writestr(first_info, b"first-image")
                second_info = zipfile.ZipInfo(f"memories/2024-01-02_{second_id}-main.jpg")
                second_info.date_time = (2024, 1, 2, 3, 4, 4)
                zf.writestr(second_info, b"second-image")

            stats = psm.process_from_zip(str(zip_path), output_root=str(output_root))

            self.assertEqual(stats["success"], 2)
            processed_dir = Path(stats["processed_dir"])
            self.assertEqual(
                sorted(p.name for p in processed_dir.glob("Batch_*/*") if p.is_file()),
                ["2024-01-02_03-04-05.jpg", "2024-01-02_03-04-05_1.jpg"],
            )

    def test_process_from_zip_merges_top_level_overlay_from_companion_zip(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output_root = Path(temp_dir) / "output"
            output_root.mkdir()
            zip_path = Path(temp_dir) / "mydata~1700000000000.zip"
            companion_path = Path(temp_dir) / "mydata~1700000000000-2.zip"
            image_id = "33333333-3333-4333-8333-333333333333"
            memories = [
                {
                    "Date": "2024-01-02 03:06:09 UTC",
                    "Media Type": "Image",
                    "Download Link": "",
                    "Media Download Url": "",
                }
            ]

            with zipfile.ZipFile(zip_path, "w") as zf:
                zf.writestr("json/memories_history.json", json.dumps({"Saved Media": memories}))
                main_info = zipfile.ZipInfo(f"memories/2024-01-02_{image_id}-main.jpg")
                main_info.date_time = (2024, 1, 2, 3, 6, 8)
                zf.writestr(main_info, self._image_bytes((255, 0, 0, 255)))

            with zipfile.ZipFile(companion_path, "w") as zf:
                overlay_info = zipfile.ZipInfo(f"memories/2024-01-02_{image_id}-overlay.jpg")
                overlay_info.date_time = (2024, 1, 2, 3, 6, 8)
                zf.writestr(overlay_info, self._image_bytes((0, 0, 255, 128)))

            stats = psm.process_from_zip(str(zip_path), output_root=str(output_root))

            self.assertEqual(stats["success"], 1)
            output_file = Path(stats["processed_dir"]) / "Batch_01" / "2024-01-02_03-06-09.jpg"
            with Image.open(output_file) as img:
                pixel = img.convert("RGB").getpixel((0, 0))
            self.assertNotEqual(pixel, (255, 0, 0))
            self.assertGreater(pixel[2], 50)

    def test_process_from_zip_warns_when_metadata_rows_have_no_media_or_url(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output_root = Path(temp_dir) / "output"
            output_root.mkdir()
            zip_path = Path(temp_dir) / "mydata~1700000000000.zip"
            image_id = "11111111-1111-4111-8111-111111111111"
            memories = [
                {
                    "Date": "2024-01-02 03:04:05 UTC",
                    "Media Type": "Image",
                    "Download Link": "",
                    "Media Download Url": "",
                },
                {
                    "Date": "2025-05-06 07:08:09 UTC",
                    "Media Type": "Video",
                    "Download Link": "",
                    "Media Download Url": "",
                },
            ]

            with zipfile.ZipFile(zip_path, "w") as zf:
                zf.writestr("json/memories_history.json", json.dumps({"Saved Media": memories}))

                image_info = zipfile.ZipInfo(f"memories/2024-01-02_{image_id}-main.jpg")
                image_info.date_time = (2024, 1, 2, 3, 4, 4)
                zf.writestr(image_info, b"image-bytes")

            stdout = io.StringIO()
            with contextlib.redirect_stdout(stdout):
                stats = psm.process_from_zip(str(zip_path), output_root=str(output_root))

            self.assertEqual(stats["success"], 1)
            self.assertEqual(stats["missing"], 1)
            self.assertNotIn("All 2 memories accounted for", stdout.getvalue())
            self.assertIn("1 memory could not be recovered from this export", stdout.getvalue())

    def test_recover_pending_ignores_stale_temp_files(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            staging_dir = Path(temp_dir) / "staging"
            staging_dir.mkdir()
            real_file = staging_dir / "Batch_01" / "real.jpg"
            temp_file = staging_dir / "Batch_01" / "real.jpg.tmp.abcd1234"
            real_file.parent.mkdir(parents=True)
            real_file.write_bytes(b"real")
            temp_file.write_bytes(b"partial")

            ledger = psm.UploadLedger(str(Path(temp_dir) / ".upload_ledger.jsonl"))
            adapter = psm.FolderDestinationAdapter(str(Path(temp_dir) / "dest"), staging_dir=str(staging_dir))
            manager = psm.AutoUploadManager(
                str(staging_dir),
                adapter,
                ledger,
                progress_callback=None,
                cache_gb=1,
                cache_low_gb=0.5,
            )

            recovered = manager.recover_pending()

            self.assertEqual(recovered, 1)
            self.assertIn(os.path.realpath(real_file), manager._pending)
            self.assertNotIn(os.path.realpath(temp_file), manager._pending)

    def test_save_batch_progress_can_raise_when_required(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "Processed_Memories_2026-03-18"
            output_dir.mkdir()
            events = []

            with mock.patch.object(psm, "OUTPUT_DIR", str(output_dir)), \
                 mock.patch.object(psm, "atomic_write_text", side_effect=OSError("disk failed")):
                with self.assertRaisesRegex(OSError, "disk failed"):
                    psm.save_batch_progress(
                        0,
                        1,
                        total_files=1,
                        processed_indices={0},
                        output_dir=str(output_dir),
                        raise_on_error=True,
                        progress_callback=events.append,
                    )

            self.assertEqual(events[0]["type"], "processing_fatal")
            self.assertEqual(events[0]["message"], "Could not save resume manifest.")
            self.assertEqual(events[0]["last_error"], "disk failed")

    def test_apply_retry_timestamp_sets_original_file_time(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            target_path = Path(temp_dir) / "retry.jpg"
            target_path.write_bytes(b"abc")

            psm.apply_retry_timestamp(str(target_path), "2021-05-28 20:50:07 UTC")

            expected = psm.datetime(2021, 5, 28, 20, 50, 7, tzinfo=psm.timezone.utc).timestamp()
            self.assertEqual(int(target_path.stat().st_mtime), int(expected))


class BuildFileIndexCompanionModeTests(unittest.TestCase):
    """Tests for build_file_index_from_zip registry behavior (clear and additive modes)."""

    def tearDown(self):
        psm._companion_zip_registry = {}
        psm.file_size_index = {}
        psm.zip_name_index = {}
        psm.zip_sid_index = {}
        psm.zip_datetime_media_index = {}
        psm.zip_date_media_index = {}
        psm.zip_claimed_members = set()
        psm.zip_overlay_sibling_index = {}

    def _make_zip(self, members):
        """Return a BytesIO ZipFile containing the given {member_path: bytes} dict."""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w') as zf:
            for name, data in members.items():
                zf.writestr(name, data)
        buf.seek(0)
        return buf

    def test_clear_true_resets_registry(self):
        """clear=True should wipe _companion_zip_registry before indexing."""
        buf = self._make_zip({'media/snap1.jpg': b'x'})
        with zipfile.ZipFile(buf) as zf:
            psm.build_file_index_from_zip(zf, clear=True, source_zip_path='/fake/primary.zip')
        self.assertIn('media/snap1.jpg', psm._companion_zip_registry)
        # Second clear=True call should wipe the first registration
        buf2 = self._make_zip({'media/snap2.jpg': b'y'})
        with zipfile.ZipFile(buf2) as zf2:
            psm.build_file_index_from_zip(zf2, clear=True, source_zip_path='/fake/other.zip')
        self.assertNotIn('media/snap1.jpg', psm._companion_zip_registry)
        self.assertIn('media/snap2.jpg', psm._companion_zip_registry)

    def test_clear_false_additive(self):
        """clear=False should ADD entries to existing index without wiping it."""
        buf1 = self._make_zip({'media/snap1.jpg': b'a'})
        with zipfile.ZipFile(buf1) as zf1:
            psm.build_file_index_from_zip(zf1, clear=True, source_zip_path='/fake/primary.zip')
        buf2 = self._make_zip({'media/snap2.jpg': b'b'})
        with zipfile.ZipFile(buf2) as zf2:
            psm.build_file_index_from_zip(zf2, clear=False, source_zip_path='/fake/companion-2.zip')
        self.assertIn('media/snap1.jpg', psm._companion_zip_registry)
        self.assertIn('media/snap2.jpg', psm._companion_zip_registry)
        self.assertEqual(psm._companion_zip_registry['media/snap1.jpg'], '/fake/primary.zip')
        self.assertEqual(psm._companion_zip_registry['media/snap2.jpg'], '/fake/companion-2.zip')

    def test_no_source_zip_path_skips_registry(self):
        """When source_zip_path is None, entries should NOT appear in registry."""
        buf = self._make_zip({'media/snap3.jpg': b'c'})
        with zipfile.ZipFile(buf) as zf:
            psm.build_file_index_from_zip(zf, clear=True, source_zip_path=None)
        self.assertNotIn('media/snap3.jpg', psm._companion_zip_registry)


class BuildCompanionZipIndexesTests(unittest.TestCase):
    """Tests for _build_companion_zip_indexes sibling detection by filename pattern."""

    def _write_zip(self, path, members):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with zipfile.ZipFile(path, 'w') as zf:
            for name, data in members.items():
                zf.writestr(name, data)

    def tearDown(self):
        psm._companion_zip_registry = {}
        psm.file_size_index = {}
        psm.zip_name_index = {}
        psm.zip_sid_index = {}
        psm.zip_datetime_media_index = {}
        psm.zip_date_media_index = {}
        psm.zip_claimed_members = set()
        psm.zip_overlay_sibling_index = {}

    def test_detects_numbered_companions(self):
        """Companions mydata~TS-2.zip and mydata~TS-3.zip should be detected."""
        with tempfile.TemporaryDirectory() as tmpdir:
            primary = os.path.join(tmpdir, 'mydata~1234.zip')
            self._write_zip(primary, {'media/a.jpg': b'a'})
            self._write_zip(os.path.join(tmpdir, 'mydata~1234-2.zip'), {'media/b.jpg': b'b'})
            self._write_zip(os.path.join(tmpdir, 'mydata~1234-3.zip'), {'media/c.jpg': b'c'})
            with zipfile.ZipFile(primary) as zf:
                psm.build_file_index_from_zip(zf, clear=True, source_zip_path=primary)
            psm._build_companion_zip_indexes(primary)
            self.assertIn('media/b.jpg', psm._companion_zip_registry)
            self.assertIn('media/c.jpg', psm._companion_zip_registry)

    def test_rejects_corrupt_numbered_companion_zip(self):
        """A corrupt companion should fail preflight instead of silently dropping media."""
        with tempfile.TemporaryDirectory() as tmpdir:
            primary = os.path.join(tmpdir, 'mydata~1234.zip')
            self._write_zip(primary, {'media/a.jpg': b'a'})
            Path(os.path.join(tmpdir, 'mydata~1234-2.zip')).write_bytes(b'not a zip')
            with zipfile.ZipFile(primary) as zf:
                psm.build_file_index_from_zip(zf, clear=True, source_zip_path=primary)

            with self.assertRaisesRegex(ValueError, "Could not read companion ZIP"):
                psm._build_companion_zip_indexes(primary)

    def test_ignores_different_timestamp(self):
        """A ZIP with a different timestamp prefix must NOT be indexed as a companion."""
        with tempfile.TemporaryDirectory() as tmpdir:
            primary = os.path.join(tmpdir, 'mydata~1234.zip')
            self._write_zip(primary, {'media/a.jpg': b'a'})
            self._write_zip(os.path.join(tmpdir, 'mydata~9999-2.zip'), {'media/z.jpg': b'z'})
            with zipfile.ZipFile(primary) as zf:
                psm.build_file_index_from_zip(zf, clear=True, source_zip_path=primary)
            psm._build_companion_zip_indexes(primary)
            self.assertNotIn('media/z.jpg', psm._companion_zip_registry)

    def test_no_companions_is_noop(self):
        """When no companion ZIPs exist, no error is raised and registry is unchanged."""
        with tempfile.TemporaryDirectory() as tmpdir:
            primary = os.path.join(tmpdir, 'mydata~1234.zip')
            self._write_zip(primary, {'media/a.jpg': b'a'})
            with zipfile.ZipFile(primary) as zf:
                psm.build_file_index_from_zip(zf, clear=True, source_zip_path=primary)
            before = dict(psm._companion_zip_registry)
            psm._build_companion_zip_indexes(primary)
            self.assertEqual(psm._companion_zip_registry, before)


class StreamZipMemberCompanionRoutingTests(unittest.TestCase):
    """Tests that stream_zip_member_to_temp routes to the correct companion ZIP."""

    def _write_zip(self, path, members):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with zipfile.ZipFile(path, 'w') as zf:
            for name, data in members.items():
                zf.writestr(name, data)

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        psm.TEMP_DIR = self.tmpdir

    def tearDown(self):
        import shutil
        shutil.rmtree(self.tmpdir, ignore_errors=True)
        psm._companion_zip_registry = {}
        psm.file_size_index = {}
        psm.zip_name_index = {}
        psm.zip_sid_index = {}
        psm.zip_datetime_media_index = {}
        psm.zip_date_media_index = {}
        psm.zip_claimed_members = set()
        psm.zip_overlay_sibling_index = {}

    def test_routes_to_companion_zip(self):
        """When companion ZIP is registered, recursive call reads from it."""
        companion_path = os.path.join(self.tmpdir, 'mydata~1234-2.zip')
        self._write_zip(companion_path, {'media/b.jpg': b'COMPANION_DATA'})
        # Register a member to live in the companion ZIP
        psm._companion_zip_registry['media/b.jpg'] = companion_path
        primary_buf = io.BytesIO()
        with zipfile.ZipFile(primary_buf, 'w') as zf:
            zf.writestr('media/a.jpg', b'PRIMARY_DATA')
        primary_buf.seek(0)
        with zipfile.ZipFile(primary_buf) as primary_zf:
            # Call stream_zip_member_to_temp with the primary ZIP.
            # Since 'media/b.jpg' is registered in a companion, it will open the companion
            # and recurse, reading from there.
            # Note: The recursive call will also check the registry, which will find the same entry,
            # so we test that behavior by having the companion NOT re-index itself in this scenario.
            temp_path, nbytes = psm.stream_zip_member_to_temp(
                zip_file=primary_zf,
                member_name='media/b.jpg',
                zip_lock=None,
                mem_id='test1',
                suffix_hint='.jpg'
            )
        with open(temp_path, 'rb') as f:
            self.assertEqual(f.read(), b'COMPANION_DATA')
        self.assertEqual(nbytes, len(b'COMPANION_DATA'))
        os.unlink(temp_path)

    def test_missing_companion_raises_exception(self):
        """If the companion ZIP file is gone, an exception should propagate (caught by caller)."""
        psm._companion_zip_registry['media/gone.jpg'] = '/nonexistent/path/companion.zip'
        primary_buf = io.BytesIO()
        with zipfile.ZipFile(primary_buf, 'w') as zf:
            zf.writestr('media/a.jpg', b'x')
        primary_buf.seek(0)
        with zipfile.ZipFile(primary_buf) as primary_zf:
            with self.assertRaises(Exception):
                psm.stream_zip_member_to_temp(
                    zip_file=primary_zf,
                    member_name='media/gone.jpg',
                    zip_lock=None,
                    mem_id='test2',
                    suffix_hint='.jpg'
                )

    def test_concurrent_companion_reads_do_not_fallback_to_primary_zip(self):
        """Concurrent reads of the same companion member should all use the companion ZIP."""
        primary_path = os.path.join(self.tmpdir, 'mydata~1234.zip')
        companion_path = os.path.join(self.tmpdir, 'mydata~1234-2.zip')
        member_name = 'media/shared.jpg'
        self._write_zip(primary_path, {member_name: b'PRIMARY_DATA'})
        self._write_zip(companion_path, {member_name: b'COMPANION_DATA'})
        psm._companion_zip_registry[member_name] = companion_path

        original_zip_file = zipfile.ZipFile
        first_companion_open_started = threading.Event()
        release_first_companion_open = threading.Event()
        first_open_gate_used = threading.Event()

        def gated_zip_file(path_value, *args, **kwargs):
            opened = original_zip_file(path_value, *args, **kwargs)
            if path_value == companion_path and not first_open_gate_used.is_set():
                first_open_gate_used.set()
                first_companion_open_started.set()
                release_first_companion_open.wait(timeout=2)
            return opened

        results = []
        errors = []
        results_lock = threading.Lock()

        def read_member(label):
            try:
                with original_zip_file(primary_path, 'r') as primary_zf:
                    temp_path, _ = psm.stream_zip_member_to_temp(
                        zip_file=primary_zf,
                        member_name=member_name,
                        zip_lock=None,
                        mem_id=label,
                        suffix_hint='.jpg'
                    )
                try:
                    with open(temp_path, 'rb') as fh:
                        data = fh.read()
                finally:
                    os.unlink(temp_path)
                with results_lock:
                    results.append(data)
            except Exception as exc:
                with results_lock:
                    errors.append(exc)

        with mock.patch.object(psm.zipfile, 'ZipFile', gated_zip_file):
            first = threading.Thread(target=read_member, args=('first',))
            first.start()
            self.assertTrue(first_companion_open_started.wait(timeout=2))

            second = threading.Thread(target=read_member, args=('second',))
            second.start()
            second.join(timeout=2)

            release_first_companion_open.set()
            first.join(timeout=2)

        self.assertFalse(first.is_alive())
        self.assertFalse(second.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(sorted(results), [b'COMPANION_DATA', b'COMPANION_DATA'])


class CompanionFoundEventTests(unittest.TestCase):
    """Tests that _build_companion_zip_indexes emits a JSON companion_found event."""

    def _write_zip(self, path, members):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with zipfile.ZipFile(path, 'w') as zf:
            for name, data in members.items():
                zf.writestr(name, data)

    def tearDown(self):
        psm._companion_zip_registry = {}
        psm.file_size_index = {}
        psm.zip_name_index = {}
        psm.zip_sid_index = {}
        psm.zip_datetime_media_index = {}
        psm.zip_date_media_index = {}
        psm.zip_claimed_members = set()
        psm.zip_overlay_sibling_index = {}

    def test_emits_json_event(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            primary = os.path.join(tmpdir, 'mydata~1234.zip')
            self._write_zip(primary, {'media/a.jpg': b'a'})
            self._write_zip(os.path.join(tmpdir, 'mydata~1234-2.zip'), {'media/b.jpg': b'b'})
            with zipfile.ZipFile(primary) as zf:
                psm.build_file_index_from_zip(zf, clear=True, source_zip_path=primary)
            with contextlib.redirect_stdout(io.StringIO()) as captured:
                psm._build_companion_zip_indexes(primary)
            output = captured.getvalue().strip()
            first_line = output.split('\n')[0]
            event = json.loads(first_line)
            self.assertEqual(event['type'], 'companion_found')
            self.assertEqual(event['companion_count'], 1)
            self.assertIn('mydata~1234-2.zip', event['companions'])


class ComputeZipSetFingerprintTests(unittest.TestCase):
    """Tests for compute_zip_set_fingerprint."""

    def _write_zip(self, path, members):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with zipfile.ZipFile(path, 'w') as zf:
            for name, data in members.items():
                zf.writestr(name, data)

    def tearDown(self):
        psm._companion_zip_registry = {}
        psm.file_size_index = {}
        psm.zip_name_index = {}
        psm.zip_sid_index = {}
        psm.zip_datetime_media_index = {}
        psm.zip_date_media_index = {}
        psm.zip_claimed_members = set()
        psm.zip_overlay_sibling_index = {}

    def test_fingerprint_includes_companions(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            primary = os.path.join(tmpdir, 'mydata~1234.zip')
            companion = os.path.join(tmpdir, 'mydata~1234-2.zip')
            self._write_zip(primary, {'media/a.jpg': b'a'})
            self._write_zip(companion, {'media/b.jpg': b'b'})
            with zipfile.ZipFile(primary) as zf:
                psm.build_file_index_from_zip(zf, clear=True, source_zip_path=primary)
            with zipfile.ZipFile(companion) as zf:
                psm.build_file_index_from_zip(zf, clear=False, source_zip_path=companion)
            fp = psm.compute_zip_set_fingerprint(primary)
            self.assertIn('mydata~1234.zip', fp)
            self.assertIn('mydata~1234-2.zip', fp)

    def test_fingerprint_changes_when_companion_added(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            primary = os.path.join(tmpdir, 'mydata~1234.zip')
            self._write_zip(primary, {'media/a.jpg': b'a'})
            with zipfile.ZipFile(primary) as zf:
                psm.build_file_index_from_zip(zf, clear=True, source_zip_path=primary)
            fp_before = psm.compute_zip_set_fingerprint(primary)
            companion = os.path.join(tmpdir, 'mydata~1234-2.zip')
            self._write_zip(companion, {'media/b.jpg': b'b'})
            with zipfile.ZipFile(companion) as zf:
                psm.build_file_index_from_zip(zf, clear=False, source_zip_path=companion)
            fp_after = psm.compute_zip_set_fingerprint(primary)
            self.assertNotEqual(fp_before, fp_after)


if __name__ == "__main__":
    unittest.main()
