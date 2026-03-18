import sys
import tempfile
import unittest
from pathlib import Path


PYTHON_DIR = Path(__file__).resolve().parents[1] / "python"
if str(PYTHON_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_DIR))

from batch_resume_logic import compute_last_completed_batch, resolve_resume_batch_state, scan_existing_batch_root


class BatchResumeLogicTests(unittest.TestCase):
    def test_partial_first_batch_keeps_last_completed_at_minus_one(self):
        self.assertEqual(compute_last_completed_batch(0, batch_completed=False), -1)

    def test_partial_later_batch_keeps_previous_batch_as_last_completed(self):
        self.assertEqual(compute_last_completed_batch(2, batch_completed=False), 1)

    def test_completed_batch_keeps_same_completed_index(self):
        self.assertEqual(compute_last_completed_batch(2, batch_completed=True), 2)

    def test_resume_continues_incomplete_batch_when_manifest_points_to_it(self):
        state = resolve_resume_batch_state(
            auto_upload=False,
            persisted_start_batch=1,
            total_existing_files=640,
            last_incomplete_batch="Batch_02",
            files_in_incomplete_batch=140,
            batch_size=500,
            next_available_batch=2,
        )
        self.assertEqual(state["start_batch"], 1)
        self.assertEqual(state["files_to_complete_batch"], 360)
        self.assertEqual(state["incomplete_batch_num"], 1)
        self.assertEqual(state["resume_incomplete_batch"], True)

    def test_resume_does_not_backfill_completed_underfilled_batch(self):
        state = resolve_resume_batch_state(
            auto_upload=False,
            persisted_start_batch=2,
            total_existing_files=654,
            last_incomplete_batch="Batch_02",
            files_in_incomplete_batch=154,
            batch_size=500,
            next_available_batch=2,
        )
        self.assertEqual(state["start_batch"], 2)
        self.assertEqual(state["files_to_complete_batch"], 0)
        self.assertEqual(state["incomplete_batch_num"], 1)
        self.assertEqual(state["resume_incomplete_batch"], False)

    def test_without_manifest_resume_uses_detected_incomplete_batch(self):
        state = resolve_resume_batch_state(
            auto_upload=False,
            persisted_start_batch=0,
            total_existing_files=154,
            last_incomplete_batch="Batch_02",
            files_in_incomplete_batch=154,
            batch_size=500,
            next_available_batch=2,
        )
        self.assertEqual(state["start_batch"], 1)
        self.assertEqual(state["files_to_complete_batch"], 346)
        self.assertEqual(state["resume_incomplete_batch"], True)

    def test_without_incomplete_batch_resume_starts_after_existing_completed_batches(self):
        state = resolve_resume_batch_state(
            auto_upload=False,
            persisted_start_batch=0,
            total_existing_files=900,
            last_incomplete_batch=None,
            files_in_incomplete_batch=0,
            batch_size=500,
            next_available_batch=2,
        )
        self.assertEqual(state["start_batch"], 2)
        self.assertEqual(state["files_to_complete_batch"], 0)
        self.assertEqual(state["resume_incomplete_batch"], False)

    def test_auto_upload_resume_continues_partial_existing_batch(self):
        state = resolve_resume_batch_state(
            auto_upload=True,
            persisted_start_batch=2,
            total_existing_files=1246,
            last_incomplete_batch="Batch_03",
            files_in_incomplete_batch=246,
            batch_size=500,
            next_available_batch=3,
        )
        self.assertEqual(state["start_batch"], 2)
        self.assertEqual(state["files_to_complete_batch"], 254)
        self.assertEqual(state["incomplete_batch_num"], 2)
        self.assertEqual(state["resume_incomplete_batch"], True)

    def test_auto_upload_resume_continues_after_highest_existing_batch(self):
        state = resolve_resume_batch_state(
            auto_upload=True,
            persisted_start_batch=2,
            total_existing_files=1000,
            last_incomplete_batch=None,
            files_in_incomplete_batch=0,
            batch_size=500,
            next_available_batch=2,
        )
        self.assertEqual(state["start_batch"], 2)
        self.assertEqual(state["files_to_complete_batch"], 0)
        self.assertEqual(state["resume_incomplete_batch"], False)

    def test_auto_upload_completed_underfilled_batch_remains_completed(self):
        state = resolve_resume_batch_state(
            auto_upload=True,
            persisted_start_batch=2,
            total_existing_files=654,
            last_incomplete_batch="Batch_02",
            files_in_incomplete_batch=154,
            batch_size=500,
            next_available_batch=2,
        )
        self.assertEqual(state["start_batch"], 2)
        self.assertEqual(state["files_to_complete_batch"], 0)
        self.assertEqual(state["resume_incomplete_batch"], False)

    def test_resume_uses_highest_existing_batch_number_not_folder_count(self):
        state = resolve_resume_batch_state(
            auto_upload=True,
            persisted_start_batch=0,
            total_existing_files=600,
            last_incomplete_batch=None,
            files_in_incomplete_batch=0,
            batch_size=500,
            next_available_batch=4,
        )
        self.assertEqual(state["start_batch"], 4)
        self.assertEqual(state["files_to_complete_batch"], 0)
        self.assertEqual(state["resume_incomplete_batch"], False)

    def test_scan_existing_batch_root_reads_custom_staging_structure(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            staging_root = Path(temp_dir) / "custom_staging"
            staging_root.mkdir()
            (staging_root / "Batch_01").mkdir()
            (staging_root / "Batch_02").mkdir()
            (staging_root / "Batch_03").mkdir()
            (staging_root / "Batch_01" / "a.jpg").write_text("x")
            (staging_root / "Batch_01" / "b.jpg").write_text("x")
            (staging_root / "Batch_02" / "c.jpg").write_text("x")
            (staging_root / "Batch_03" / "d.jpg").write_text("x")
            (staging_root / "loose.tmp").write_text("x")

            scan = scan_existing_batch_root(str(staging_root), batch_size=2)

            self.assertEqual(scan["orphaned_root_files"], 1)
            self.assertEqual(scan["existing_batch_files"], 4)
            self.assertEqual(scan["last_incomplete_batch"], "Batch_03")
            self.assertEqual(scan["files_in_incomplete_batch"], 1)
            self.assertEqual(scan["batch_folders"], ["Batch_01", "Batch_02", "Batch_03"])
            self.assertEqual(scan["highest_existing_batch_num"], 2)
            self.assertEqual(scan["next_available_batch"], 3)


if __name__ == "__main__":
    unittest.main()
