import json
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

import requests


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


class ProcessSnapchatMemoriesRuntimeTests(unittest.TestCase):
    def tearDown(self):
        psm.reset_runtime_disk_full_state()
        psm.ABORT_PROCESSING.clear()

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
            self.assertEqual(response.chunk_size, 8192)

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


if __name__ == "__main__":
    unittest.main()
