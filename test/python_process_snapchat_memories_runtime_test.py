import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
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
    def __init__(self, response):
        self.response = response
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append({"url": url, **kwargs})
        return self.response


class ProcessSnapchatMemoriesRuntimeTests(unittest.TestCase):
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

    def test_stream_download_to_path_streams_bytes_with_redirects_enabled(self):
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
            self.assertTrue(session.calls[0]["allow_redirects"])
            self.assertEqual(response.chunk_size, 8192)

    def test_stream_download_to_path_rejects_blocked_redirect_chain(self):
        response = FakeResponse(
            chunks=[b"abc"],
            headers={"Content-Type": "image/jpeg"},
            history=[SimpleNamespace(url="https://evil.example/redirect")],
        )
        session = FakeSession(response)

        with tempfile.TemporaryDirectory() as temp_dir:
            target_path = Path(temp_dir) / "download.bin"
            with mock.patch.object(psm, "get_requests_session", return_value=session):
                with self.assertRaisesRegex(ValueError, "Blocked redirect target"):
                    psm.stream_download_to_path("https://cf-st.sc-cdn.net/media", str(target_path))

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


if __name__ == "__main__":
    unittest.main()
